import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import type { Prisma } from "@holymedia/database";
import { AuditService } from "../audit/audit.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";
import { ProviderService } from "../providers/provider.service.js";
import {
  evaluateMetaAppReviewPrecondition,
  evaluateMetaAppReviewRenamePolicy,
  invariantChanges,
  SECOND_META_APP_REVIEW,
} from "./meta-app-review-write.policy.js";

const READ_SCOPE = "adforge:mcp:read";
const WRITE_SCOPE = "adforge:mcp:write";
const OPERATIONS = new Set([
  "archive_entities",
  "archive_object",
  "change_budget",
  "change_name",
  "clone_ad",
  "clone_adset",
  "clone_campaign",
  "configure_schedule",
  "create_ab_test_ads",
  "create_ad",
  "create_ad_group",
  "create_adset",
  "create_audience",
  "create_audience_variant",
  "create_campaign",
  "create_creative",
  "create_keyword",
  "create_object",
  "pause",
  "replace_creative",
  "resume",
  "update_ad",
  "update_adset",
  "update_campaign",
  "update_object",
  "update_placements",
  "update_status",
  "update_targeting",
]);

type PreviewInput = {
  provider: "GOOGLE_ADS" | "META_ADS";
  accountId: string;
  objectId: string;
  operation: string;
  payload: Record<string, unknown>;
};

@Injectable()
export class McpPreviewService {
  private readonly config: AppConfig = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProviderService) private readonly providers: ProviderService,
  ) {}

  public async create(principal: ServiceTokenPrincipal, input: PreviewInput) {
    this.ensureRead(principal);
    if (!OPERATIONS.has(input.operation))
      throw new ForbiddenException("This MCP operation is not available.");
    const account = await this.account(principal, input.accountId);
    if (account.provider !== input.provider)
      throw new ForbiddenException("Provider and account do not match.");

    const previewToken = `hmpp_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const diff: Record<string, unknown> = this.diff(
      input.operation,
      input.objectId,
      input.payload,
    );
    const resourcePolicy = evaluateMetaAppReviewRenamePolicy(
      this.config,
      {
        provider: input.provider,
        operation: input.operation,
        externalObjectId: input.objectId.trim(),
        payload: input.payload,
      },
      account,
    );
    if (
      this.isSecondReview(
        input.provider,
        input.objectId.trim(),
        account.externalAccountId,
      ) &&
      resourcePolicy.kind === "allowed"
    ) {
      await this.assertControlledPrincipal(principal, account.id);
      const before = await this.providers.readMetaControlledCampaign(
        principal.workspaceId,
        account.connectionId,
        account.id,
        input.objectId.trim(),
      );
      const check = evaluateMetaAppReviewPrecondition(
        this.config,
        before,
        resourcePolicy.requestedName,
      );
      if (check.kind !== "allowed")
        throw new ForbiddenException(
          check.kind === "blocked"
            ? check.message
            : "Controlled preview unavailable.",
        );
      if (
        before.id !== input.objectId.trim() ||
        before.accountId !== account.externalAccountId
      )
        throw new ForbiddenException("Campaign/account mismatch.");
      diff.before = before.name;
      diff.controlled = {
        version: 1,
        workspaceId: principal.workspaceId,
        serviceTokenId: principal.tokenId,
        serviceIdentityId: principal.serviceIdentityId,
        connectionId: account.connectionId,
        accountId: account.id,
        externalAccountId: account.externalAccountId,
        campaignId: before.id,
        currentName: before.name,
        status: before.status,
        requestedName: resourcePolicy.requestedName,
        operation: "change_name",
        allowedFields: ["name"],
        retrievedAt: new Date().toISOString(),
      };
    }
    const preview = await this.database.client.mcpPreview.create({
      data: {
        workspaceId: principal.workspaceId,
        serviceTokenId: principal.tokenId,
        provider: input.provider,
        accountId: account.id,
        externalObjectId: input.objectId.trim(),
        operation: input.operation,
        payload: input.payload as Prisma.InputJsonValue,
        diff: diff as Prisma.InputJsonValue,
        previewTokenDigest: digest(previewToken),
        expiresAt,
      },
    });
    await this.audit.record({
      eventType: "mcp_preview_created",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata: {
        provider: input.provider,
        operation: input.operation,
        accountRestricted: principal.accountIds.length > 0,
      },
    });
    const appReviewPolicy = evaluateMetaAppReviewRenamePolicy(
      this.config,
      preview,
      account,
    );
    const policyReason =
      appReviewPolicy.kind === "allowed"
        ? null
        : appReviewPolicy.kind === "blocked"
          ? appReviewPolicy.reason
          : this.commitPolicyReason(preview, account);
    const confirmedWriteAvailable =
      principal.scopes.includes(WRITE_SCOPE) && !policyReason;
    const providerRequest = this.providerRequest(
      input,
      preview.externalObjectId,
    );
    return {
      status: "preview",
      mode: confirmedWriteAvailable ? "preview_confirm" : "preview_only",
      preview_token: previewToken,
      expires_at: expiresAt.toISOString(),
      provider: input.provider,
      account_id: account.externalAccountId,
      object_id: input.objectId.trim(),
      operation: input.operation,
      diff,
      provider_request: providerRequest,
      risk_flags: ["explicit_confirmation_required", "server_side_policy"],
      execution_mode: "simulated_no_write",
      confirmed_write_available: confirmedWriteAvailable,
      app_review_commit_available: confirmedWriteAvailable,
      commit_available_after_confirmation: confirmedWriteAvailable,
      commit_tool: confirmedWriteAvailable
        ? "commit_meta_confirmed_write"
        : null,
      required_oauth_permission:
        input.provider === "META_ADS" ? "ads_management" : null,
      write_readiness: confirmedWriteAvailable
        ? "ready_after_explicit_confirmation"
        : this.writeReadiness(principal, policyReason),
    };
  }

  public async confirm(principal: ServiceTokenPrincipal, previewToken: string) {
    this.ensureRead(principal);
    const preview = await this.find(principal, previewToken);
    if (preview.consumedAt)
      throw new ForbiddenException("Preview has already been consumed.");
    if (preview.expiresAt <= new Date())
      throw new ForbiddenException("Preview has expired.");
    if (
      preview.provider === "META_ADS" &&
      preview.externalObjectId === SECOND_META_APP_REVIEW.campaignId &&
      this.config.metaAppReviewSecondRenameEnabled
    ) {
      const account = await this.account(principal, preview.accountId);
      await this.assertControlledPrincipal(principal, account.id);
      this.assertSnapshot(principal, preview, account);
    }
    if (preview.confirmedAt) return this.view(preview, "confirmed");
    const updated = await this.database.client.mcpPreview.update({
      where: { id: preview.id },
      data: { confirmedAt: new Date() },
    });
    await this.audit.record({
      eventType: "mcp_preview_confirmed",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
    });
    return this.view(updated, "confirmed");
  }

  public async commit(principal: ServiceTokenPrincipal, previewToken: string) {
    try {
      return await this.commitAuthorized(principal, previewToken);
    } catch (error) {
      await this.audit.record({
        eventType: "mcp_commit_attempt_failed",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "service_token",
        targetId: principal.tokenId,
        success: false,
        metadata: {
          serviceTokenId: principal.tokenId,
          serviceIdentityId: principal.serviceIdentityId,
          errorType:
            error instanceof Error ? error.constructor.name : "Unknown",
        },
      });
      throw error;
    }
  }

  private async commitAuthorized(
    principal: ServiceTokenPrincipal,
    previewToken: string,
  ) {
    if (!principal.scopes.includes(WRITE_SCOPE))
      throw new ForbiddenException("Write scope is required for commit.");
    const preview = await this.find(principal, previewToken);
    if (preview.consumedAt)
      throw new ForbiddenException("Preview has already been consumed.");
    if (preview.expiresAt <= new Date())
      throw new ForbiddenException("Preview has expired.");
    if (!preview.confirmedAt)
      throw new ForbiddenException(
        "Explicit preview confirmation is required.",
      );

    const account = await this.account(principal, preview.accountId);
    const payload = payloadRecord(preview.payload);
    const appReviewPolicy = evaluateMetaAppReviewRenamePolicy(
      this.config,
      preview,
      account,
    );
    const policyReason =
      appReviewPolicy.kind === "allowed"
        ? null
        : appReviewPolicy.kind === "blocked"
          ? appReviewPolicy.reason
          : this.commitPolicyReason(preview, account);
    const consumed = await this.database.client.mcpPreview.updateMany({
      where: { id: preview.id, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new ForbiddenException("Preview has already been consumed.");
    if (policyReason) {
      await this.audit.record({
        eventType: "mcp_commit_blocked",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        success: false,
        metadata: {
          reason: policyReason,
          provider: preview.provider,
          accountId: account.externalAccountId,
          campaignId: preview.externalObjectId,
          operation: preview.operation,
          requestedName:
            typeof payload.new_name === "string" ? payload.new_name : null,
          serviceTokenId: principal.tokenId,
        },
      });
      return {
        status: "blocked",
        preview_token: "redacted",
        execution_mode: "simulated_no_write",
        preview_only: this.config.previewOnly,
        provider_write_enabled: false,
        reread: null,
        message:
          appReviewPolicy.kind === "blocked"
            ? appReviewPolicy.message
            : "HolyMedia MCP работает в режиме чтения и не изменяет рекламные кампании.",
      };
    }
    try {
      if (appReviewPolicy.kind === "allowed")
        return await this.commitMetaAppReviewRename(
          principal,
          preview,
          account,
          payload,
          appReviewPolicy.requestedName,
        );
      const committed = await this.providers.mutateCampaign(
        principal.workspaceId,
        account.connectionId,
        account.id,
        preview.externalObjectId,
        preview.operation as "change_name" | "pause" | "resume",
        payload,
      );
      await this.audit.record({
        eventType: "mcp_commit_completed",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        metadata: {
          provider: preview.provider,
          operation: preview.operation,
        },
      });
      return {
        status: "committed",
        preview_token: "redacted",
        execution_mode: "confirmed_write",
        provider_write_enabled: true,
        reread: committed.reread,
      };
    } catch (error) {
      await this.audit.record({
        eventType: "mcp_commit_failed",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        success: false,
        metadata: { provider: preview.provider, operation: preview.operation },
      });
      throw error;
    }
  }

  private commitPolicyReason(
    preview: { provider: string; operation: string; externalObjectId: string },
    account: { id: string; externalAccountId: string },
  ): string | null {
    if (this.config.previewOnly) return "preview_only";
    if (!this.config.confirmedWriteEnabled) return "confirmed_write_disabled";
    if (preview.provider !== "META_ADS") return "provider_write_unavailable";
    if (!this.config.writeOperationAllowlist.includes(preview.operation))
      return "operation_not_allowlisted";
    if (!this.config.writeObjectAllowlist.includes(preview.externalObjectId))
      return "object_not_allowlisted";
    if (
      !this.config.writeAccountAllowlist.includes(account.id) &&
      !this.config.writeAccountAllowlist.includes(account.externalAccountId)
    )
      return "account_not_allowlisted";
    if (!["change_name", "pause", "resume"].includes(preview.operation))
      return "operation_not_supported";
    return null;
  }

  private async commitMetaAppReviewRename(
    principal: ServiceTokenPrincipal,
    preview: {
      id: string;
      provider: string;
      operation: string;
      externalObjectId: string;
      diff: unknown;
      confirmedAt: Date | null;
    },
    account: { id: string; connectionId: string; externalAccountId: string },
    payload: Record<string, unknown>,
    requestedName: string,
  ) {
    const controlled = this.isSecondReview(
      preview.provider,
      preview.externalObjectId,
      account.externalAccountId,
    );
    const identity = controlled
      ? await this.assertControlledPrincipal(principal, account.id)
      : null;
    const snapshot = controlled
      ? this.assertSnapshot(principal, { ...preview, payload }, account)
      : null;
    const before = await this.providers.readMetaControlledCampaign(
      principal.workspaceId,
      account.connectionId,
      account.id,
      preview.externalObjectId,
    );
    if (
      snapshot &&
      (before.name !== snapshot.currentName ||
        before.status !== "PAUSED" ||
        before.id !== preview.externalObjectId ||
        before.accountId !== account.externalAccountId)
    ) {
      await this.audit.record({
        eventType: "meta_app_review_rename_blocked",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        success: false,
        metadata: {
          reason: "preview_state_changed",
          serviceTokenId: principal.tokenId,
          connectionId: account.connectionId,
        },
      });
      throw new ForbiddenException(
        "Campaign changed after preview. Create and confirm a new preview.",
      );
    }
    const precondition = evaluateMetaAppReviewPrecondition(
      this.config,
      before,
      requestedName,
    );
    const metadata = {
      provider: "META_ADS",
      accountId: account.externalAccountId,
      campaignId: preview.externalObjectId,
      operation: "change_name",
      previousName: before.name,
      requestedName: String(payload.new_name ?? ""),
      campaignStatus: before.status,
      serviceTokenId: principal.tokenId,
      serviceIdentityId: principal.serviceIdentityId,
      tokenPrefix: identity?.tokenPrefix ?? null,
      connectionId: account.connectionId,
      previewId: preview.id,
      confirmedAt: preview.confirmedAt?.toISOString() ?? null,
    };
    if (precondition.kind === "blocked") {
      await this.audit.record({
        eventType: "meta_app_review_rename_blocked",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        success: false,
        metadata: { ...metadata, reason: precondition.reason },
      });
      return {
        status: "blocked",
        execution_mode: "simulated_no_write",
        provider_write_enabled: false,
        reread: null,
        message: precondition.message,
      };
    }
    if (before.name === requestedName) {
      await this.audit.record({
        eventType: "meta_app_review_rename_already_applied",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        metadata,
      });
      return {
        status: "already_applied",
        execution_mode: "no_write_current_state",
        provider_write_enabled: false,
        reread: before,
        message:
          "Кампания уже имеет запрошенное название; изменение не выполнялось.",
      };
    }
    await this.audit.record({
      eventType: "meta_app_review_rename_prechecked",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata,
    });
    const mutation = await this.providers.mutateCampaign(
      principal.workspaceId,
      account.connectionId,
      account.id,
      preview.externalObjectId,
      "change_name",
      { new_name: requestedName },
    );
    const after = await this.providers.readMetaControlledCampaign(
      principal.workspaceId,
      account.connectionId,
      account.id,
      preview.externalObjectId,
    );
    const changedFields = invariantChanges(before, after);
    const verified =
      after.name === requestedName &&
      after.status === "PAUSED" &&
      changedFields.length === 0;
    await this.audit.record({
      eventType: verified
        ? "meta_app_review_rename_completed"
        : "meta_app_review_rename_verification_failed",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      success: verified,
      metadata: {
        ...metadata,
        metaMutationAccepted: mutation.result.providerAccepted,
        postWriteName: after.name,
        postWriteStatus: after.status,
        invariantChangedFields: changedFields.join(","),
        postWriteVerified: verified,
      },
    });
    if (!verified)
      return {
        status: "verification_failed",
        execution_mode: "confirmed_write",
        provider_write_enabled: true,
        reread: after,
        message:
          "Название отправлено в Meta, но проверка состояния кампании не прошла. Другие поля не изменялись HolyMedia MCP.",
      };
    return {
      status: "committed",
      execution_mode: "confirmed_write",
      provider_write_enabled: true,
      reread: after,
      previous_name: before.name,
      provider_write_result: mutation.result,
      provider_write_result_source: "HolyMedia Meta adapter",
      verification_source: "Meta Graph API campaign direct read",
      verification_retrieved_at: new Date().toISOString(),
      message:
        "Название кампании изменено и подтверждено повторным чтением из Meta.",
    };
  }

  private isSecondReview(
    provider: string,
    campaignId: string,
    externalAccountId: string,
  ) {
    return (
      this.config.metaAppReviewSecondRenameEnabled &&
      provider === "META_ADS" &&
      campaignId === SECOND_META_APP_REVIEW.campaignId &&
      externalAccountId === SECOND_META_APP_REVIEW.accountId
    );
  }

  private async assertControlledPrincipal(
    principal: ServiceTokenPrincipal,
    accountId: string,
  ) {
    const token = await this.database.client.serviceToken.findFirst({
      where: {
        id: principal.tokenId,
        serviceIdentityId: principal.serviceIdentityId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        serviceIdentity: {
          workspaceId: principal.workspaceId,
          revokedAt: null,
          workspace: { accessStatus: "ACTIVE" },
          createdBy: {
            status: "active",
            memberships: { some: { workspaceId: principal.workspaceId } },
          },
        },
      },
      select: { tokenPrefix: true, scopes: true, accountIds: true },
    });
    if (
      !token ||
      !Array.isArray(token.scopes) ||
      !token.scopes.includes(READ_SCOPE) ||
      !token.scopes.includes(WRITE_SCOPE) ||
      !principal.scopes.includes(WRITE_SCOPE) ||
      (token.accountIds !== null &&
        (!Array.isArray(token.accountIds) ||
          token.accountIds.some((id) => typeof id !== "string"))) ||
      (Array.isArray(token.accountIds) &&
        token.accountIds.length > 0 &&
        !token.accountIds.includes(accountId))
    )
      throw new ForbiddenException(
        "A valid controlled-write key with workspace membership and account access is required.",
      );
    return token;
  }

  private assertSnapshot(
    principal: ServiceTokenPrincipal,
    preview: {
      diff: unknown;
      payload: unknown;
      externalObjectId: string;
      operation: string;
    },
    account: { id: string; connectionId: string; externalAccountId: string },
  ) {
    const snapshot = payloadRecord(payloadRecord(preview.diff).controlled);
    const requestedName = payloadRecord(preview.payload).new_name;
    if (
      snapshot.version !== 1 ||
      snapshot.workspaceId !== principal.workspaceId ||
      snapshot.serviceTokenId !== principal.tokenId ||
      snapshot.serviceIdentityId !== principal.serviceIdentityId ||
      snapshot.connectionId !== account.connectionId ||
      snapshot.accountId !== account.id ||
      snapshot.externalAccountId !== account.externalAccountId ||
      snapshot.campaignId !== preview.externalObjectId ||
      snapshot.operation !== "change_name" ||
      preview.operation !== "change_name" ||
      JSON.stringify(snapshot.allowedFields) !== '["name"]' ||
      snapshot.status !== "PAUSED" ||
      typeof snapshot.currentName !== "string" ||
      typeof requestedName !== "string" ||
      snapshot.requestedName !== requestedName.trim() ||
      Object.keys(payloadRecord(preview.payload)).length !== 1
    )
      throw new ForbiddenException(
        "Preview binding is invalid. Create and confirm a new preview.",
      );
    return snapshot;
  }

  private providerRequest(input: PreviewInput, objectId: string) {
    if (input.provider === "META_ADS" && input.operation === "change_name") {
      const name =
        typeof input.payload.new_name === "string"
          ? input.payload.new_name.trim()
          : "";
      return {
        http_method: "POST",
        endpoint: `/${objectId}`,
        body: { name },
      };
    }
    return null;
  }

  private writeReadiness(
    principal: ServiceTokenPrincipal,
    policyReason: string | null,
  ): string {
    if (!principal.scopes.includes(WRITE_SCOPE))
      return "service_token_write_scope_required";
    return policyReason ?? "provider_permission_check_required";
  }

  private async account(principal: ServiceTokenPrincipal, accountId: string) {
    const normalized = accountId.trim();
    // PostgreSQL validates the UUID branch of an OR expression even when the
    // external account-id branch would match. Never pass a Meta `act_*` id to
    // the UUID column: MCP accepts both internal UUIDs and provider IDs.
    const identifiers: Array<Record<string, string>> = [
      { externalAccountId: normalized },
    ];
    if (isUuid(normalized)) identifiers.unshift({ id: normalized });
    const account = await this.database.client.providerAccount.findFirst({
      where: {
        workspaceId: principal.workspaceId,
        enabled: true,
        // A DEGRADED connection can still have a valid credential. It may be
        // read and pre-checked, while every mutation remains subject to the
        // policy enforced in commit(). Disconnected/revoked connections stay
        // unavailable.
        connection: {
          workspaceId: principal.workspaceId,
          status: { in: ["CONNECTED", "DEGRADED"] },
        },
        ...(principal.accountIds.length
          ? { id: { in: principal.accountIds } }
          : {}),
        OR: identifiers,
      },
    });
    if (!account)
      throw new ForbiddenException(
        "Account is not available to this service token.",
      );
    if (account.provider !== "GOOGLE_ADS" && account.provider !== "META_ADS")
      throw new ForbiddenException(
        "This provider does not support campaign previews.",
      );
    return account;
  }

  private async find(principal: ServiceTokenPrincipal, previewToken: string) {
    const value = previewToken.trim();
    if (!/^hmpp_[A-Za-z0-9_-]{20,120}$/.test(value))
      throw new ForbiddenException("Preview token is invalid.");
    const preview = await this.database.client.mcpPreview.findFirst({
      where: {
        previewTokenDigest: digest(value),
        workspaceId: principal.workspaceId,
        serviceTokenId: principal.tokenId,
        ...(principal.accountIds.length
          ? { accountId: { in: principal.accountIds } }
          : {}),
      },
    });
    if (!preview) throw new ForbiddenException("Preview token is invalid.");
    return preview;
  }

  private diff(
    operation: string,
    objectId: string,
    payload: Record<string, unknown>,
  ) {
    if (operation === "change_name") {
      const newName =
        typeof payload.new_name === "string" ? payload.new_name.trim() : "";
      if (!newName || newName.length > 255)
        throw new ForbiddenException("new_name is required.");
      return {
        object_id: objectId.trim(),
        field: "name",
        before: null,
        after: newName,
      };
    }
    if (operation === "change_budget") {
      const budget = Number(payload.daily_budget);
      if (!Number.isFinite(budget) || budget < 0)
        throw new ForbiddenException("daily_budget is invalid.");
      return {
        object_id: objectId.trim(),
        field: "daily_budget",
        before: null,
        after: budget,
      };
    }
    if (operation === "pause" || operation === "resume") {
      return {
        object_id: objectId.trim(),
        field: "status",
        before: null,
        after: operation === "pause" ? "PAUSED" : "ENABLED",
      };
    }
    return {
      object_id: objectId.trim(),
      operation,
      before: null,
      after: payload,
    };
  }

  private view(
    preview: {
      id: string;
      operation: string;
      expiresAt: Date;
      confirmedAt: Date | null;
    },
    status: string,
  ) {
    return {
      status,
      preview_id: preview.id,
      operation: preview.operation,
      confirmed_at: preview.confirmedAt?.toISOString() ?? null,
      expires_at: preview.expiresAt.toISOString(),
    };
  }

  private ensureRead(principal: ServiceTokenPrincipal) {
    if (
      !principal.scopes.includes(READ_SCOPE) &&
      !principal.scopes.includes("adforge:mcp")
    )
      throw new ForbiddenException("Service token does not have read access.");
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

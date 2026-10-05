import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { Prisma } from "@holymedia/database";
import { createLogger } from "@holymedia/observability";
import { PreviewError } from "./mcp-preview.error.js";
import { AuditService } from "../audit/audit.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";
import { ProviderService } from "../providers/provider.service.js";
import type { HumanPrincipal } from "../auth/auth.types.js";
import {
  assertGoogleWriteAccount,
  customerId,
  keywordBatch,
  GOOGLE_KEYWORD_PREVIEW_TTL_MS,
  GoogleAdsWriteError,
  googleWriteFailure,
  writeFailureFromError,
  type GoogleKeywordSnapshot,
  type GoogleKeywordMutation,
  type GoogleMutationResult,
} from "../providers/google-ads-write.js";
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

  public create(
    principal: ServiceTokenPrincipal,
    input: PreviewInput & { provider: "META_ADS" },
  ): ReturnType<McpPreviewService["createMeta"]>;
  public create(
    principal: ServiceTokenPrincipal,
    input: PreviewInput & { provider: "GOOGLE_ADS" },
  ): ReturnType<McpPreviewService["createGoogleKeywords"]>;
  public create(
    principal: ServiceTokenPrincipal,
    input: PreviewInput,
  ):
    | ReturnType<McpPreviewService["createMeta"]>
    | ReturnType<McpPreviewService["createGoogleKeywords"]>;
  public create(principal: ServiceTokenPrincipal, input: PreviewInput) {
    this.ensureRead(principal);
    if (input.provider === "GOOGLE_ADS")
      return this.createGoogleKeywords(principal, input);
    return this.createMeta(principal, input);
  }
  private async createMeta(
    principal: ServiceTokenPrincipal,
    input: PreviewInput,
  ) {
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
    if (!principal.scopes.includes(WRITE_SCOPE))
      throw new PreviewError("write_scope_required");
    const preview = await this.find(principal, previewToken);
    if (preview.provider === "GOOGLE_ADS")
      throw new PreviewError("preview_not_confirmed");
    if (preview.consumedAt) throw new PreviewError("preview_already_consumed");
    if (preview.expiresAt <= new Date())
      throw new PreviewError("preview_expired");
    const controlled =
      preview.provider === "META_ADS" &&
      preview.externalObjectId === SECOND_META_APP_REVIEW.campaignId &&
      this.config.metaAppReviewSecondRenameEnabled;
    const account = await this.account(principal, preview.accountId);
    if (controlled) {
      await this.assertControlledPrincipal(principal, account.id);
      this.assertSnapshot(principal, preview, account);
    }
    if (preview.confirmedAt) return this.view(preview, "confirmed");
    const confirmedAt = new Date();
    const updated = await this.database.client.mcpPreview.updateMany({
      where: {
        id: preview.id,
        workspaceId: principal.workspaceId,
        serviceTokenId: principal.tokenId,
        previewTokenDigest: preview.previewTokenDigest,
        accountId: account.id,
        operation: preview.operation,
        externalObjectId: preview.externalObjectId,
        confirmedAt: null,
        consumedAt: null,
        expiresAt: { gt: confirmedAt },
        payload: {
          equals: payloadRecord(preview.payload) as Prisma.InputJsonObject,
        },
        diff: { equals: payloadRecord(preview.diff) as Prisma.InputJsonObject },
        account: {
          workspaceId: principal.workspaceId,
          enabled: true,
          connectionId: account.connectionId,
          externalAccountId: account.externalAccountId,
          connection: {
            workspaceId: principal.workspaceId,
            status: { in: ["CONNECTED", "DEGRADED"] },
          },
        },
        ...(controlled
          ? {
              serviceToken: {
                serviceIdentityId: principal.serviceIdentityId,
                revokedAt: null,
                scopes: { array_contains: [READ_SCOPE, WRITE_SCOPE] },
                AND: [
                  {
                    OR: [
                      { expiresAt: null },
                      { expiresAt: { gt: confirmedAt } },
                    ],
                  },
                  {
                    OR: [
                      { accountIds: { equals: Prisma.AnyNull } },
                      { accountIds: { equals: [] } },
                      { accountIds: { array_contains: [account.id] } },
                    ],
                  },
                ],
                serviceIdentity: {
                  workspaceId: principal.workspaceId,
                  revokedAt: null,
                  workspace: { accessStatus: "ACTIVE" },
                  createdBy: {
                    status: "active",
                    memberships: {
                      some: { workspaceId: principal.workspaceId },
                    },
                  },
                },
              },
            }
          : {}),
      },
      data: { confirmedAt },
    });
    if (updated.count !== 1) {
      const current = await this.find(principal, previewToken);
      if (current.consumedAt)
        throw new PreviewError("preview_already_consumed");
      if (current.expiresAt <= new Date())
        throw new PreviewError("preview_expired");
      if (controlled) {
        await this.assertControlledPrincipal(principal, account.id);
        this.assertSnapshot(
          principal,
          current,
          await this.account(principal, current.accountId),
        );
      }
      if (current.confirmedAt) return this.view(current, "confirmed");
      throw new PreviewError("confirmation_context_mismatch");
    }
    try {
      await this.audit.record({
        eventType: "mcp_preview_confirmed",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        metadata: {
          serviceTokenId: principal.tokenId,
          serviceIdentityId: principal.serviceIdentityId,
          connectionId: account.connectionId,
          accountId: account.id,
          operation: preview.operation,
        },
      });
    } catch (error) {
      createLogger("holymedia-mcp-preview").error(
        {
          previewId: preview.id,
          workspaceId: principal.workspaceId,
          errorType:
            error instanceof Error ? error.constructor.name : "Unknown",
        },
        "Preview confirmation audit failed",
      );
    }
    return this.view({ ...preview, confirmedAt }, "confirmed");
  }

  public async commit(principal: ServiceTokenPrincipal, previewToken: string) {
    try {
      return await this.commitAuthorized(principal, previewToken);
    } catch (error) {
      let googlePreview: Awaited<ReturnType<McpPreviewService["find"]>> | null =
        null;
      try {
        const found = await this.find(principal, previewToken);
        if (found.provider === "GOOGLE_ADS") googlePreview = found;
      } catch {
        /* No cross-principal preview disclosure. */
      }
      if (googlePreview && Array.isArray(googlePreview.beforeState)) {
        const requested = payloadRecord(googlePreview.payload).status;
        for (const row of googlePreview.beforeState) {
          const state = payloadRecord(row);
          if (
            typeof state.resource_name !== "string" ||
            typeof state.account_id !== "string" ||
            typeof requested !== "string"
          )
            continue;
          await this.googleAuditRow(
            principal,
            googlePreview.id,
            state.account_id,
            state as GoogleKeywordSnapshot,
            requested,
            "rejected",
            error instanceof GoogleAdsWriteError
              ? (error.failures[0]?.google_error_code ?? error.writeCode)
              : error instanceof PreviewError
                ? error.code
                : "internal_error",
          );
        }
      }
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
      throw new PreviewError(
        "write_scope_required",
        "Write scope is required for commit.",
      );
    const preview = await this.find(principal, previewToken);
    if (preview.provider === "GOOGLE_ADS")
      return this.commitGoogleKeywords(principal, preview);
    if (preview.consumedAt)
      throw new PreviewError(
        "preview_already_consumed",
        "Preview has already been consumed.",
      );
    if (preview.expiresAt <= new Date())
      throw new PreviewError("preview_expired", "Preview has expired.");
    if (!preview.confirmedAt)
      throw new PreviewError(
        "preview_not_confirmed",
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
      throw new PreviewError(
        "preview_already_consumed",
        "Preview has already been consumed.",
      );
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
      select: {
        tokenPrefix: true,
        scopes: true,
        accountIds: true,
        resourceAccessMode: true,
        serviceIdentity: { select: { createdById: true } },
      },
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
        !token.accountIds.includes(accountId)) ||
      (token.resourceAccessMode === "STATIC_ALLOWLIST" &&
        (!Array.isArray(token.accountIds) ||
          !token.accountIds.includes(accountId)))
    )
      throw new PreviewError(
        "confirmation_context_mismatch",
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
      throw new PreviewError(
        "confirmation_context_mismatch",
        "Preview binding is invalid. Create and confirm a new preview.",
      );
    return snapshot;
  }

  private async createGoogleKeywords(
    principal: ServiceTokenPrincipal,
    input: PreviewInput,
  ) {
    if (
      !["pause", "update_status"].includes(input.operation) ||
      input.payload.entity_type !== "keyword" ||
      Object.keys(input.payload).some(
        (k) => !["entity_type", "status", "items"].includes(k),
      )
    )
      throw new GoogleAdsWriteError(
        "google_operation_not_supported",
        "Google Ads поддерживает только keyword ENABLED/PAUSED через generic status preview.",
      );
    const status =
      input.operation === "pause" ? "PAUSED" : input.payload.status;
    if (
      !["ENABLED", "PAUSED"].includes(String(status)) ||
      (input.operation === "pause" &&
        input.payload.status !== undefined &&
        input.payload.status !== "PAUSED")
    )
      throw new GoogleAdsWriteError(
        "google_keyword_status_invalid",
        "Разрешены только статусы ENABLED и PAUSED.",
      );
    const account = await this.account(principal, customerId(input.accountId));
    if (account.provider !== "GOOGLE_ADS")
      throw new PreviewError("confirmation_context_mismatch");
    assertGoogleWriteAccount(this.config, account.externalAccountId);
    await this.assertControlledPrincipal(principal, account.id);
    const identities = keywordBatch(
      account.externalAccountId,
      input.payload.items,
    );
    const before = await this.providers.readGoogleKeywordStates(
      principal.workspaceId,
      account.connectionId,
      account.id,
      identities,
    );
    const mutations: GoogleKeywordMutation[] = identities.map((x) => ({
      ...x,
      status: status as "ENABLED" | "PAUSED",
    }));
    const changed = mutations.filter((x, i) => before[i]!.status !== x.status);
    if (!changed.length) throw new PreviewError("preview_no_change");
    const validation = await this.providers.validateGoogleKeywordStatuses(
      principal.workspaceId,
      account.connectionId,
      account.id,
      changed,
    );
    if (validation.length !== changed.length)
      throw new GoogleAdsWriteError(
        "google_response_invalid",
        "Google Ads вернул неполный результат validation.",
      );
    const byResource = new Map(
      changed.map((x, i) => [x.resource_name, validation[i]!]),
    );
    const items = before.map((x, i) => ({
      ...x,
      before_status: x.status,
      after_status: mutations[i]!.status,
      google_validation: byResource.get(x.resource_name) ?? {
        success: true,
        error: null,
        status: "not_required_no_op",
      },
      warnings: x.status === status ? ["no_op: статус уже установлен"] : [],
    }));
    if (validation.some((x) => !x.success))
      return {
        status: "validation_failed",
        provider: "GOOGLE_ADS",
        account_id: customerId(account.externalAccountId),
        operation_count: changed.length,
        items,
        provider_validation: "failed",
        provider_mutation_sent: false,
      };
    const previewToken = `hmpp_${randomBytes(32).toString("base64url")}`,
      nonce = `hmap_${randomBytes(32).toString("base64url")}`,
      expiresAt = new Date(Date.now() + GOOGLE_KEYWORD_PREVIEW_TTL_MS);
    const payload = { entity_type: "keyword", status, items: identities };
    const preview = await this.database.client.mcpPreview.create({
      data: {
        workspaceId: principal.workspaceId,
        principalType: "SERVICE_TOKEN",
        serviceTokenId: principal.tokenId,
        provider: "GOOGLE_ADS",
        accountId: account.id,
        connectionId: account.connectionId,
        externalObjectId: identities[0]!.resource_name,
        operation: "GOOGLE_KEYWORD_STATUS",
        payload: payload as Prisma.InputJsonValue,
        diff: { items, provider_validation: "passed" } as Prisma.InputJsonValue,
        beforeState: before as Prisma.InputJsonValue,
        requestedState: mutations as Prisma.InputJsonValue,
        snapshotDigest: digest(canonicalJson([before, mutations])),
        previewTokenDigest: digest(previewToken),
        approvalTokenDigest: digest(nonce),
        expiresAt,
        commitStatus: "PREVIEWED",
      },
    });
    await this.audit.record({
      eventType: "mcp_preview_created",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata: {
        provider: "GOOGLE_ADS",
        accountId: account.externalAccountId,
        serviceTokenId: principal.tokenId,
        serviceIdentityId: principal.serviceIdentityId,
        operation: "GOOGLE_KEYWORD_STATUS",
        providerValidation: "passed",
        operationCount: changed.length,
      },
    });
    return {
      status: "preview",
      preview_id: preview.id,
      preview_token: previewToken,
      expires_at: expiresAt.toISOString(),
      provider: "GOOGLE_ADS",
      account_id: customerId(account.externalAccountId),
      operation_count: changed.length,
      items,
      provider_validation: "passed",
      approval_url: `${this.config.publicBaseUrl}/mcp/approve#${nonce}`,
      commit_tool: "commit_preview",
      provider_mutation_sent: false,
      summary: `Google Ads: ${changed.length} ключевых слов → ${status}. Подтвердите preview в HolyMedia.`,
    };
  }

  /** Reuses the existing browser route, cookie session and CSRF decision guard. */
  public async googleApprovalView(human: HumanPrincipal, nonce: string) {
    const context = await this.googleBrowserContext(human, nonce);
    if (!context) return null;
    const { preview, account } = context,
      stored = this.googleStored(preview, account);
    return {
      provider: "Google Ads",
      account: account.displayName || account.externalAccountId,
      campaign: stored.before
        .map((x) => x.campaign_name || x.campaign_id)
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(", "),
      operation: preview.operation,
      field: "status",
      before: `${stored.before.length} keywords`,
      after: String(payloadRecord(preview.payload).status),
      // Render the same immutable, digest-bound state that commit executes.
      items: stored.before.map((row, index) => ({
        ...row,
        before_status: row.status,
        after_status: stored.mutations[index]!.status,
        warnings:
          row.status === stored.mutations[index]!.status
            ? ["no_op: статус уже установлен"]
            : [],
      })),
      expires_at: preview.expiresAt.toISOString(),
      approved: Boolean(preview.confirmedAt && preview.approvedByUserId),
    };
  }
  public async decideGoogleApproval(
    human: HumanPrincipal,
    nonce: string,
    decision: "approve" | "cancel",
  ) {
    const context = await this.googleBrowserContext(human, nonce);
    if (!context) return null;
    const { preview, account } = context;
    this.googleStored(preview, account);
    if (preview.confirmedAt)
      throw new PreviewError("preview_already_confirmed");
    const now = new Date();
    const updated = await this.database.client.mcpPreview.updateMany({
      where: {
        id: preview.id,
        workspaceId: preview.workspaceId,
        principalType: "SERVICE_TOKEN",
        serviceTokenId: preview.serviceTokenId,
        provider: "GOOGLE_ADS",
        approvalTokenDigest: digest(nonce),
        confirmedAt: null,
        consumedAt: null,
        cancelledAt: null,
        expiresAt: { gt: now },
      },
      data:
        decision === "approve"
          ? {
              confirmedAt: now,
              approvedByUserId: human.userId,
              approvalSessionId: human.sessionId,
              commitStatus: "CONFIRMED",
            }
          : { cancelledAt: now, commitStatus: "CANCELLED" },
    });
    if (updated.count !== 1)
      throw new PreviewError("confirmation_context_mismatch");
    await this.audit.record({
      eventType:
        decision === "approve"
          ? "mcp_preview_web_approved"
          : "mcp_preview_web_cancelled",
      actorType: "HUMAN",
      actorUserId: human.userId,
      workspaceId: preview.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata: {
        provider: "GOOGLE_ADS",
        decision,
        accountId: account.externalAccountId,
      },
    });
    return { status: decision === "approve" ? "approved" : "cancelled" };
  }
  private async googleBrowserContext(human: HumanPrincipal, nonce: string) {
    if (!/^hmap_[A-Za-z0-9_-]{43}$/.test(nonce))
      throw new PreviewError("approval_not_found");
    const preview = await this.database.client.mcpPreview.findFirst({
      where: {
        approvalTokenDigest: digest(nonce),
        principalType: "SERVICE_TOKEN",
        provider: "GOOGLE_ADS",
        serviceToken: { serviceIdentity: { createdById: human.userId } },
      },
      include: { serviceToken: { select: { serviceIdentityId: true } } },
    });
    if (
      !preview ||
      preview.provider !== "GOOGLE_ADS" ||
      preview.principalType !== "SERVICE_TOKEN"
    )
      return null;
    this.googleUsable(preview);
    if (!preview.serviceTokenId || !preview.serviceToken)
      throw new PreviewError("approval_not_found");
    const principal: ServiceTokenPrincipal = {
      kind: "service",
      tokenId: preview.serviceTokenId,
      serviceIdentityId: preview.serviceToken.serviceIdentityId,
      workspaceId: preview.workspaceId,
      scopes: [READ_SCOPE, WRITE_SCOPE],
      accountIds: [],
    };
    const account = await this.account(principal, preview.accountId);
    assertGoogleWriteAccount(this.config, account.externalAccountId);
    const token = await this.assertControlledPrincipal(principal, account.id);
    if (token.serviceIdentity.createdById !== human.userId)
      throw new PreviewError("approval_not_found");
    return { preview, account };
  }
  private googleUsable(preview: {
    expiresAt: Date;
    consumedAt: Date | null;
    cancelledAt: Date | null;
  }) {
    if (preview.cancelledAt) throw new PreviewError("preview_cancelled");
    if (preview.consumedAt) throw new PreviewError("preview_already_consumed");
    if (preview.expiresAt <= new Date())
      throw new PreviewError("preview_expired");
  }
  private googleStored(
    preview: {
      operation: string;
      connectionId: string | null;
      payload: unknown;
      beforeState: unknown;
      requestedState: unknown;
      snapshotDigest: string | null;
      externalObjectId: string;
      diff: unknown;
    },
    account: { connectionId: string; externalAccountId: string },
  ) {
    const payload = payloadRecord(preview.payload);
    if (
      preview.operation !== "GOOGLE_KEYWORD_STATUS" ||
      preview.connectionId !== account.connectionId ||
      payload.entity_type !== "keyword" ||
      !["ENABLED", "PAUSED"].includes(String(payload.status)) ||
      Object.keys(payload).sort().join(",") !== "entity_type,items,status" ||
      payloadRecord(preview.diff).provider_validation !== "passed"
    )
      throw new PreviewError("confirmation_context_mismatch");
    const identities = keywordBatch(account.externalAccountId, payload.items),
      mutations = identities.map((x) => ({
        ...x,
        status: payload.status as "ENABLED" | "PAUSED",
      }));
    const before = preview.beforeState as GoogleKeywordSnapshot[];
    if (
      !Array.isArray(before) ||
      before.length !== identities.length ||
      preview.externalObjectId !== identities[0]!.resource_name ||
      canonicalJson(preview.requestedState) !== canonicalJson(mutations) ||
      preview.snapshotDigest !== digest(canonicalJson([before, mutations])) ||
      before.some(
        (x, i) =>
          x.account_id !== customerId(account.externalAccountId) ||
          x.resource_name !== identities[i]!.resource_name ||
          x.campaign_id !== identities[i]!.campaign_id ||
          x.ad_group_id !== identities[i]!.ad_group_id ||
          x.criterion_id !== identities[i]!.criterion_id ||
          !["ENABLED", "PAUSED"].includes(x.status),
      )
    )
      throw new PreviewError("confirmation_context_mismatch");
    return { before, identities, mutations };
  }
  private async commitGoogleKeywords(
    principal: ServiceTokenPrincipal,
    preview: Awaited<ReturnType<McpPreviewService["find"]>>,
  ) {
    await this.audit.record({
      eventType: "mcp_google_commit_attempted",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata: {
        provider: "GOOGLE_ADS",
        serviceTokenId: principal.tokenId,
        serviceIdentityId: principal.serviceIdentityId,
        accountId: preview.accountId,
        operation: preview.operation,
      },
    });
    this.googleUsable(preview);
    const account = await this.account(principal, preview.accountId);
    assertGoogleWriteAccount(this.config, account.externalAccountId);
    const token = await this.assertControlledPrincipal(principal, account.id);
    if (
      !preview.confirmedAt ||
      !preview.approvalSessionId ||
      !preview.approvedByUserId ||
      preview.approvedByUserId !== token.serviceIdentity.createdById
    )
      throw new PreviewError("preview_not_confirmed");
    if (this.config.previewOnly || !this.config.confirmedWriteEnabled)
      throw new GoogleAdsWriteError(
        "confirmed_write_disabled",
        "Подтверждённая запись выключена на сервере.",
      );
    const stored = this.googleStored(preview, account);
    let current: GoogleKeywordSnapshot[];
    try {
      current = await this.providers.readGoogleKeywordStates(
        principal.workspaceId,
        account.connectionId,
        account.id,
        stored.identities,
      );
    } catch (error) {
      if (
        error instanceof GoogleAdsWriteError &&
        error.writeCode === "google_keyword_unavailable"
      )
        throw new PreviewError("google_preview_stale");
      throw error;
    }
    if (canonicalJson(current) !== canonicalJson(stored.before))
      throw new PreviewError("google_preview_stale");
    const now = new Date();
    const claimed = await this.database.client.mcpPreview.updateMany({
      where: {
        id: preview.id,
        principalType: "SERVICE_TOKEN",
        serviceTokenId: principal.tokenId,
        workspaceId: principal.workspaceId,
        provider: "GOOGLE_ADS",
        accountId: account.id,
        connectionId: account.connectionId,
        operation: "GOOGLE_KEYWORD_STATUS",
        confirmedAt: { not: null },
        approvedByUserId: preview.approvedByUserId,
        approvalSessionId: preview.approvalSessionId,
        cancelledAt: null,
        consumedAt: null,
        expiresAt: { gt: now },
        payload: { equals: preview.payload as Prisma.InputJsonValue },
        beforeState: { equals: preview.beforeState as Prisma.InputJsonValue },
        requestedState: {
          equals: preview.requestedState as Prisma.InputJsonValue,
        },
        snapshotDigest: preview.snapshotDigest,
        serviceToken: {
          serviceIdentityId: principal.serviceIdentityId,
          revokedAt: null,
          scopes: { array_contains: [READ_SCOPE, WRITE_SCOPE] },
          AND: [
            { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
            {
              OR: [
                {
                  resourceAccessMode: "ALL_CONNECTED",
                  OR: [
                    { accountIds: { equals: Prisma.AnyNull } },
                    { accountIds: { equals: [] } },
                    { accountIds: { array_contains: [account.id] } },
                  ],
                },
                {
                  resourceAccessMode: "STATIC_ALLOWLIST",
                  accountIds: { array_contains: [account.id] },
                },
              ],
            },
          ],
          serviceIdentity: {
            workspaceId: principal.workspaceId,
            createdById: preview.approvedByUserId,
            revokedAt: null,
            workspace: { accessStatus: "ACTIVE" },
            createdBy: {
              status: "active",
              memberships: { some: { workspaceId: principal.workspaceId } },
            },
          },
        },
        account: {
          workspaceId: principal.workspaceId,
          provider: "GOOGLE_ADS",
          enabled: true,
          connectionId: account.connectionId,
          externalAccountId: account.externalAccountId,
          connection: {
            workspaceId: principal.workspaceId,
            status: { in: ["CONNECTED", "DEGRADED"] },
          },
        },
      },
      data: {
        consumedAt: now,
        commitAttemptedAt: now,
        commitStatus: "CLAIMED",
      },
    });
    if (claimed.count !== 1) throw new PreviewError("preview_already_consumed");
    const changed = stored.mutations.filter(
      (x, i) => x.status !== stored.before[i]!.status,
    );
    for (const row of stored.before)
      await this.googleAuditRow(
        principal,
        preview.id,
        account.externalAccountId,
        row,
        String(payloadRecord(preview.payload).status),
        "attempted",
        null,
      );
    let mutation: GoogleMutationResult[];
    try {
      mutation = await this.providers.commitGoogleKeywordStatuses(
        principal.workspaceId,
        account.connectionId,
        account.id,
        changed,
      );
    } catch (error) {
      const failure = writeFailureFromError(error);
      mutation = changed.map(() => ({ success: false, error: failure }));
    }
    let observed: GoogleKeywordSnapshot[] | null = null;
    try {
      observed = await this.providers.readGoogleKeywordStates(
        principal.workspaceId,
        account.connectionId,
        account.id,
        stored.identities,
      );
    } catch {
      // A missing failed resource must not erase verification of other rows.
      const available: GoogleKeywordSnapshot[] = [];
      let index = 0;
      await Promise.all(
        Array.from(
          { length: Math.min(6, stored.identities.length) },
          async () => {
            while (index < stored.identities.length) {
              const item = stored.identities[index++]!;
              try {
                available.push(
                  ...(await this.providers.readGoogleKeywordStates(
                    principal.workspaceId,
                    account.connectionId,
                    account.id,
                    [item],
                  )),
                );
              } catch {
                /* Unreadable rows remain unverified, never success. */
              }
            }
          },
        ),
      );
      if (available.length) observed = available;
    }
    const results = new Map(
      changed.map((x, i) => [
        x.resource_name,
        mutation[i] ?? {
          success: false,
          error: googleWriteFailure("OUTCOME_UNCERTAIN"),
        },
      ]),
    );
    const items = stored.before.map((x, i) => {
      const desired = stored.mutations[i]!.status,
        noOp = x.status === desired,
        result = results.get(x.resource_name),
        after =
          observed?.find((v) => v.resource_name === x.resource_name) ?? null;
      const verified = Boolean(after && after.status === desired),
        success = verified && (noOp || Boolean(result?.success));
      return {
        ...x,
        old_status: x.status,
        requested_status: desired,
        actual_status: after?.status ?? null,
        success,
        result: success ? (noOp ? "no_op" : "success") : "failure",
        google_error: success
          ? null
          : (result?.error ??
            googleWriteFailure(
              observed ? "VERIFICATION_MISMATCH" : "OUTCOME_UNCERTAIN",
            )),
        reread: after,
      };
    });
    const finalStatus = items.every((x) => x.success)
      ? "VERIFIED"
      : items.some((x) => x.success)
        ? "PARTIAL_FAILURE"
        : observed
          ? "NOT_VERIFIED"
          : "UNCERTAIN_OUTCOME";
    await this.database.client.mcpPreview.update({
      where: { id: preview.id },
      data: {
        commitStatus: finalStatus,
        providerResult: items as Prisma.InputJsonValue,
        verificationRead: observed
          ? (observed as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      },
    });
    for (const row of items)
      await this.googleAuditRow(
        principal,
        preview.id,
        account.externalAccountId,
        row,
        row.requested_status,
        row.result,
        row.google_error?.google_error_code ?? null,
        row.actual_status,
      );
    return {
      status: finalStatus,
      preview_id: preview.id,
      provider: "GOOGLE_ADS",
      account_id: customerId(account.externalAccountId),
      operation_count: changed.length,
      items,
      partial_failure: true,
      provider_mutation_attempted: true,
      summary: `Google Ads: подтверждено ${items.filter((x) => x.success).length} из ${items.length} строк. Повторный commit запрещён.`,
    };
  }
  private googleAuditRow(
    principal: ServiceTokenPrincipal,
    previewId: string,
    account: string,
    row: GoogleKeywordSnapshot,
    requested: string,
    result: string,
    googleError: string | null,
    actual: string | null = null,
  ) {
    return this.audit.record({
      eventType: "mcp_google_keyword_status",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: previewId,
      success:
        result === "success" || result === "no_op" || result === "attempted",
      metadata: {
        serviceTokenId: principal.tokenId,
        serviceIdentityId: principal.serviceIdentityId,
        provider: "GOOGLE_ADS",
        accountId: account,
        campaignId: row.campaign_id,
        adGroupId: row.ad_group_id,
        objectId: row.criterion_id,
        resourceName: row.resource_name,
        keyword: row.keyword,
        before: row.status,
        after: requested,
        actual,
        previewId,
        result,
        googleErrorCode: googleError,
      },
    });
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
      throw new PreviewError("invalid_preview_token");
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
    if (!preview) throw new PreviewError("preview_not_found");
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

/** JSONB does not preserve object key order; array order remains significant. */
function canonicalJson(value: unknown): string {
  function ordered(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(ordered);
    if (input && typeof input === "object")
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, ordered(child)]),
      );
    return input;
  }
  return JSON.stringify(ordered(value));
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

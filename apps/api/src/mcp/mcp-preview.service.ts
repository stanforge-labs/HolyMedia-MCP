import { createHash, randomBytes } from "node:crypto";
import {
  assertStage2Gate,
  assertStage2Plan,
  parseStage2Intent,
  stage2RollbackIntent,
  type Stage2Plan,
} from "../providers/google-ads-stage2.js";
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
  normalizeBrief,
  type Stage0Plan,
  type GoogleWritePlan,
  type JsonRow,
} from "../providers/google-ads-stage0.js";
import {
  campaignIdSchema,
  campaignCloneSchema,
  validateBriefSchema,
} from "./mcp-google-stage0-schema.js";
import {
  canonical,
  parseStage1Intent,
  type Stage1Plan,
  type Stage1MutationResult,
  type ResourceSnapshot,
} from "../providers/google-ads-stage1.js";
import {
  assertGoogleWriteAccount,
  customerId,
  keywordBatch,
  GOOGLE_KEYWORD_PREVIEW_TTL_MS,
  GoogleAdsWriteError,
  googleWriteFailure,
  writeFailureFromError,
  type GoogleKeywordSnapshot,
  type GoogleMutationResult,
  type GoogleKeywordIdentity,
  type GoogleWriteFailure,
} from "../providers/google-ads-write.js";
import {
  evaluateMetaAppReviewPrecondition,
  evaluateMetaAppReviewRenamePolicy,
  invariantChanges,
  SECOND_META_APP_REVIEW,
} from "./meta-app-review-write.policy.js";

const READ_SCOPE = "adforge:mcp:read";
const WRITE_SCOPE = "adforge:mcp:write";
type GoogleKeywordRejection = {
  index: number;
  identity: GoogleKeywordIdentity;
  snapshot: GoogleKeywordSnapshot | null;
  error: {
    source: "HOLYMEDIA" | "GOOGLE_ADS";
    stage: "snapshot_read" | "validate_only";
    code: string;
    message: string;
    google_code: string | null;
  };
  provider_error: GoogleWriteFailure | null;
};
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
      if (
        googlePreview &&
        /^GOOGLE_STAGE[012]_/.test(googlePreview.operation) &&
        googlePreview.snapshotDigest ===
          digest(canonical(googlePreview.requestedState))
      ) {
        const plan = googlePreview.requestedState as unknown as GoogleWritePlan;
        for (const [index] of plan.operations.entries())
          await this.stage1Audit(
            principal,
            googlePreview.id,
            plan,
            index,
            "rejected",
            error instanceof PreviewError
              ? error.code
              : error instanceof GoogleAdsWriteError
                ? (error.failures[0]?.google_error_code ?? error.writeCode)
                : "internal_error",
          );
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
    expectedBefore?: GoogleKeywordSnapshot[],
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
    // Identity/account validation above is whole-request and cannot be bypassed
    // by a mixed batch. Only a known unavailable snapshot is row-local.
    let snapshots: GoogleKeywordSnapshot[];
    const rejections: GoogleKeywordRejection[] = [];
    try {
      snapshots = await this.providers.readGoogleKeywordStates(
        principal.workspaceId,
        account.connectionId,
        account.id,
        identities,
      );
    } catch (error) {
      if (
        !(error instanceof GoogleAdsWriteError) ||
        error.writeCode !== "google_keyword_unavailable"
      )
        throw error;
      const found: Array<GoogleKeywordSnapshot | null> = identities.map(
        () => null,
      );
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(4, identities.length) }, async () => {
          while (next < identities.length) {
            const index = next++,
              identity = identities[index]!;
            try {
              const rows = await this.providers.readGoogleKeywordStates(
                principal.workspaceId,
                account.connectionId,
                account.id,
                [identity],
              );
              if (rows.length !== 1)
                throw new GoogleAdsWriteError(
                  "google_response_invalid",
                  "Google вернул неполный snapshot.",
                );
              found[index] = rows[0]!;
            } catch (rowError) {
              if (
                !(rowError instanceof GoogleAdsWriteError) ||
                rowError.writeCode !== "google_keyword_unavailable"
              )
                throw rowError;
              rejections.push({
                index,
                identity,
                snapshot: null,
                error: {
                  source: "HOLYMEDIA",
                  stage: "snapshot_read",
                  code: "google_keyword_unavailable",
                  message:
                    "Ключевое слово не найдено или не соответствует выбранной кампании/группе. Эта строка исключена из commit.",
                  google_code: null,
                },
                provider_error: null,
              });
            }
          }
        }),
      );
      snapshots = found.filter(
        (row): row is GoogleKeywordSnapshot => row !== null,
      );
    }
    if (
      snapshots.length + rejections.length !== identities.length ||
      new Set(snapshots.map((x) => x.resource_name)).size !==
        snapshots.length ||
      snapshots.some((row) => {
        const identity = identities.find(
          (x) => x.resource_name === row.resource_name,
        );
        return (
          !identity ||
          row.account_id !== customerId(account.externalAccountId) ||
          row.campaign_id !== identity.campaign_id ||
          row.ad_group_id !== identity.ad_group_id ||
          row.criterion_id !== identity.criterion_id ||
          !["ENABLED", "PAUSED"].includes(row.status)
        );
      })
    )
      throw new GoogleAdsWriteError(
        "google_response_invalid",
        "Google вернул некорректные identities snapshot.",
      );
    if (expectedBefore && canonical(snapshots) !== canonical(expectedBefore))
      throw new PreviewError("google_preview_stale");
    const candidates = snapshots.map((x) => ({
      campaign_id: x.campaign_id,
      ad_group_id: x.ad_group_id,
      criterion_id: x.criterion_id,
      resource_name: x.resource_name,
      status: status as "ENABLED" | "PAUSED",
    }));
    const changed = candidates.filter(
      (x, i) => snapshots[i]!.status !== x.status,
    );
    if (!changed.length && !rejections.length)
      throw new PreviewError("preview_no_change");
    const validation = changed.length
      ? await this.providers.validateGoogleKeywordStatuses(
          principal.workspaceId,
          account.connectionId,
          account.id,
          changed,
        )
      : [];
    if (validation.length !== changed.length)
      throw new GoogleAdsWriteError(
        "google_response_invalid",
        "Google Ads вернул неполный результат validation.",
      );
    const byResource = new Map(
      changed.map((x, i) => [x.resource_name, validation[i]!]),
    );
    for (const [index, identity] of identities.entries()) {
      const check = byResource.get(identity.resource_name);
      if (check && !check.success) {
        const failure = check.error ?? googleWriteFailure("OUTCOME_UNCERTAIN");
        rejections.push({
          index,
          identity,
          snapshot: snapshots.find(
            (x) => x.resource_name === identity.resource_name,
          )!,
          error: {
            source: "GOOGLE_ADS",
            stage: "validate_only",
            code: failure.code,
            message: failure.message,
            google_code: failure.google_code,
          },
          provider_error: failure,
        });
      }
    }
    rejections.sort((a, b) => a.index - b.index);
    const excluded = new Set(rejections.map((x) => x.identity.resource_name));
    const before = snapshots.filter((x) => !excluded.has(x.resource_name));
    const mutations = candidates.filter((x) => !excluded.has(x.resource_name));
    const items = identities.map((identity, index) => {
      const rejected = rejections.find((x) => x.index === index);
      const row = snapshots.find(
        (x) => x.resource_name === identity.resource_name,
      );
      return {
        ...(row ?? identity),
        before_status: row?.status ?? null,
        after_status: status,
        eligible_for_commit: !rejected,
        row_error: rejected?.error ?? null,
        google_validation: rejected?.provider_error
          ? { success: false, error: rejected.provider_error }
          : (byResource.get(identity.resource_name) ??
            (row
              ? { success: true, error: null, status: "not_required_no_op" }
              : {
                  success: false,
                  error: null,
                  status: "not_sent_snapshot_rejected",
                })),
        warnings: rejected
          ? [rejected.error.message]
          : row?.status === status
            ? ["no_op: статус уже установлен"]
            : [],
      };
    });
    if (!mutations.some((x, i) => before[i]!.status !== x.status))
      return {
        status: "validation_failed",
        provider: "GOOGLE_ADS",
        account_id: customerId(account.externalAccountId),
        requested_operation_count: identities.length,
        operation_count: 0,
        excluded_operation_count: rejections.length,
        items,
        provider_validation: "failed",
        provider_mutation_sent: false,
      };
    const previewToken = `hmpp_${randomBytes(32).toString("base64url")}`,
      nonce = `hmap_${randomBytes(32).toString("base64url")}`,
      expiresAt = new Date(Date.now() + GOOGLE_KEYWORD_PREVIEW_TTL_MS);
    const payload = {
      entity_type: "keyword",
      status,
      items: identities,
      ...(rejections.length ? { batch_rejections: rejections } : {}),
    };
    const eligibleChanged = mutations.filter(
      (x, i) => before[i]!.status !== x.status,
    );
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
        snapshotDigest: digest(
          canonicalJson(
            rejections.length
              ? [before, mutations, rejections]
              : [before, mutations],
          ),
        ),
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
        operationCount: eligibleChanged.length,
        rejectedRowCount: rejections.length,
      },
    });
    return {
      status: "preview",
      preview_id: preview.id,
      preview_token: previewToken,
      expires_at: expiresAt.toISOString(),
      provider: "GOOGLE_ADS",
      account_id: customerId(account.externalAccountId),
      operation_count: eligibleChanged.length,
      requested_operation_count: identities.length,
      excluded_operation_count: rejections.length,
      items,
      provider_validation: "passed",
      approval_url: `${this.config.publicBaseUrl}/mcp/approve#${nonce}`,
      commit_tool: "commit_preview",
      provider_mutation_sent: false,
      summary: `Google Ads: ${eligibleChanged.length} ключевых слов → ${status}; исключено строк: ${rejections.length}. Подтвердите только допустимые изменения в HolyMedia.`,
    };
  }

  /** Reuses the existing browser route, cookie session and CSRF decision guard. */
  public async createGoogleCampaign(
    principal: ServiceTokenPrincipal,
    input: Record<string, unknown>,
    mode: "build" | "resume" | "pause" | "clone" = "build",
  ) {
    this.ensureRead(principal);
    if (mode !== "build")
      validateBriefSchema(
        input,
        mode === "clone" ? campaignCloneSchema : campaignIdSchema,
      );
    else normalizeBrief(input);
    const account = await this.account(
      principal,
      customerId(String(input.account_id)),
    );
    if (account.provider !== "GOOGLE_ADS")
      throw new PreviewError("confirmation_context_mismatch");
    assertGoogleWriteAccount(this.config, account.externalAccountId);
    await this.assertControlledPrincipal(principal, account.id);
    const plan = (await this.providers.googleStage0(
      principal.workspaceId,
      account.connectionId,
      account.id,
      mode,
      input,
    )) as Stage0Plan;
    return this.storeGoogleStage1(principal, account, plan);
  }
  private googlePlanOperation(plan: GoogleWritePlan) {
    return `GOOGLE_STAGE${plan.version}_${plan.intent.action.toUpperCase()}`;
  }
  private googlePlanCall(
    plan: GoogleWritePlan,
    workspaceId: string,
    connectionId: string,
    accountId: string,
    action: "read" | "validate" | "commit" | "verify",
    input: unknown,
    results?: Stage1MutationResult[],
  ) {
    if (plan.version === 2)
      return this.providers.googleStage2(
        workspaceId,
        connectionId,
        accountId,
        action,
        input,
        results,
      );
    return plan.version === 0
      ? this.providers.googleStage0(
          workspaceId,
          connectionId,
          accountId,
          action,
          input,
          results,
        )
      : this.providers.googleStage1(
          workspaceId,
          connectionId,
          accountId,
          action,
          input,
          results,
        );
  }
  public async createGoogleStage1(
    principal: ServiceTokenPrincipal,
    accountId: string,
    rawIntent: unknown,
  ) {
    this.ensureRead(principal);
    const intent = parseStage1Intent(rawIntent);
    const account = await this.account(principal, customerId(accountId));
    if (account.provider !== "GOOGLE_ADS")
      throw new PreviewError("confirmation_context_mismatch");
    assertGoogleWriteAccount(this.config, account.externalAccountId);
    await this.assertControlledPrincipal(principal, account.id);
    const plan = (await this.providers.googleStage1(
      principal.workspaceId,
      account.connectionId,
      account.id,
      "build",
      intent,
    )) as Stage1Plan;
    return this.storeGoogleStage1(principal, account, plan);
  }
  public async createGoogleStage2(
    principal: ServiceTokenPrincipal,
    accountId: string,
    rawIntent: unknown,
  ) {
    this.ensureRead(principal);
    const intent = parseStage2Intent(rawIntent),
      account = await this.account(principal, customerId(accountId));
    if (
      account.provider !== "GOOGLE_ADS" ||
      customerId(account.externalAccountId) !== customerId(accountId)
    )
      throw new PreviewError("confirmation_context_mismatch");
    assertStage2Gate(this.config, account.externalAccountId);
    await this.assertControlledPrincipal(principal, account.id);
    const plan = (await this.providers.googleStage2(
      principal.workspaceId,
      account.connectionId,
      account.id,
      "build",
      intent,
    )) as Stage2Plan;
    return this.storeGoogleStage1(principal, account, plan);
  }
  private async storeGoogleStage1(
    principal: ServiceTokenPrincipal,
    account: Awaited<ReturnType<McpPreviewService["account"]>>,
    plan: GoogleWritePlan,
    rollbackOf: string | null = null,
  ) {
    const results = (await this.googlePlanCall(
      plan,
      principal.workspaceId,
      account.connectionId,
      account.id,
      "validate",
      plan,
    )) as Stage1MutationResult[];
    const validated =
      results.length === plan.operations.length &&
      results.every((x) => x.success);
    const items = plan.items.map((row) => ({
      ...row,
      google_validation: row.provider_operations.map(
        (i) =>
          results[i] ?? {
            success: false,
            error: googleWriteFailure("OUTCOME_UNCERTAIN"),
          },
      ),
    }));
    if (!validated)
      return {
        status: "validation_failed",
        provider: "GOOGLE_ADS",
        account_id: plan.account_id,
        items,
        provider_validation: "failed",
        operation_count: plan.operations.length,
        provider_mutation_sent: false,
        ...(plan.version === 0
          ? {
              policy_warnings: results.flatMap((result, operation_index) =>
                (result.error?.google_details ?? [])
                  .filter((detail) => /POLICY/i.test(detail.google_code))
                  .map((detail) => ({ operation_index, ...detail })),
              ),
            }
          : {}),
        summary: "Google отклонил проверку; preview для commit не создан.",
      };
    const previewToken = `hmpp_${randomBytes(32).toString("base64url")}`,
      nonce = `hmap_${randomBytes(32).toString("base64url")}`,
      expiresAt = new Date(Date.now() + GOOGLE_KEYWORD_PREVIEW_TTL_MS);
    const preview = await this.database.client.mcpPreview.create({
      data: {
        workspaceId: principal.workspaceId,
        principalType: "SERVICE_TOKEN",
        serviceTokenId: principal.tokenId,
        provider: "GOOGLE_ADS",
        accountId: account.id,
        connectionId: account.connectionId,
        externalObjectId:
          plan.operations[0]!.resource_name ?? `stage1:${plan.intent.action}`,
        operation: this.googlePlanOperation(plan),
        payload: {
          intent: plan.intent,
          rollback_of: rollbackOf,
        } as Prisma.InputJsonValue,
        diff: { provider_validation: "passed" },
        beforeState: plan.checks as unknown as Prisma.InputJsonValue,
        requestedState: plan as unknown as Prisma.InputJsonValue,
        snapshotDigest: digest(canonical(plan)),
        previewTokenDigest: digest(previewToken),
        approvalTokenDigest: digest(nonce),
        expiresAt,
        commitStatus: "PREVIEWED",
      },
    });
    await this.audit.record({
      eventType: "mcp_google_stage1_preview_created",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata: {
        provider: "GOOGLE_ADS",
        accountId: plan.account_id,
        operation: plan.intent.action,
        operationCount: plan.operations.length,
        rollbackOf,
      },
    });
    return {
      status: "preview",
      preview_id: preview.id,
      preview_token: previewToken,
      expires_at: expiresAt.toISOString(),
      provider: "GOOGLE_ADS",
      account_id: plan.account_id,
      operation_count: plan.operations.length,
      items,
      provider_validation: "passed",
      approval_url: `${this.config.publicBaseUrl}/mcp/approve#${nonce}`,
      commit_tool: "commit_preview",
      provider_mutation_sent: false,
      rollback_of: rollbackOf,
      ...(plan.version === 2
        ? {
            partial_failure: true,
            atomic: false,
            provider_request_groups: new Set(plan.operations.map((o) => o.kind))
              .size,
            excluded_row_count: plan.items.filter((i) => i.row_error).length,
            mutation_plan: plan.operations.map((o) => ({
              resource_name: o.resource_name,
              update_mask: o.update_mask,
              fields: o.fields,
              row: o.row,
            })),
          }
        : {}),
      ...(plan.version === 0
        ? {
            campaign_plan: plan.summary,
            partial_failure: false,
            atomic: true,
            policy_warnings: [],
          }
        : {}),
      summary: `Google Ads: ${plan.intent.action}, ${plan.operations.length} операций. Проверьте эффекты и предупреждения в HolyMedia.`,
    };
  }
  private googleStage1Stored(
    preview: {
      operation: string;
      connectionId: string | null;
      requestedState: unknown;
      beforeState: unknown;
      payload: unknown;
      snapshotDigest: string | null;
      diff: unknown;
    },
    account: { connectionId: string; externalAccountId: string },
  ): GoogleWritePlan {
    const plan = preview.requestedState as GoogleWritePlan;
    if (
      !plan ||
      ![0, 1, 2].includes(plan.version) ||
      plan.account_id !== customerId(account.externalAccountId) ||
      preview.connectionId !== account.connectionId ||
      preview.operation !== this.googlePlanOperation(plan) ||
      !Array.isArray(plan.operations) ||
      plan.operations.length < 1 ||
      plan.operations.length > 500 ||
      !Array.isArray(plan.checks) ||
      preview.snapshotDigest !== digest(canonical(plan)) ||
      canonical(preview.beforeState) !== canonical(plan.checks) ||
      canonical(payloadRecord(preview.payload).intent) !==
        canonical(plan.intent) ||
      payloadRecord(preview.diff).provider_validation !== "passed"
    )
      throw new PreviewError("confirmation_context_mismatch");
    if (plan.version === 2) {
      assertStage2Gate(this.config, account.externalAccountId);
      assertStage2Plan(plan, account.externalAccountId);
    }
    return plan;
  }
  private async commitGoogleStage1(
    principal: ServiceTokenPrincipal,
    preview: Awaited<ReturnType<McpPreviewService["find"]>>,
    account: Awaited<ReturnType<McpPreviewService["account"]>>,
  ) {
    const plan = this.googleStage1Stored(preview, account);
    const current = await this.googlePlanCall(
      plan,
      principal.workspaceId,
      account.connectionId,
      account.id,
      "read",
      plan,
    );
    if (canonical(current) !== canonical(plan.checks))
      throw new PreviewError("google_preview_stale");
    await this.claimGooglePreview(principal, preview, account);
    // Durable attempt audit precedes every provider mutation; audit failure closes the claim.
    for (const [index] of plan.operations.entries())
      await this.stage1Audit(
        principal,
        preview.id,
        plan,
        index,
        "attempted",
        null,
      );
    let results: Stage1MutationResult[];
    try {
      results = (await this.googlePlanCall(
        plan,
        principal.workspaceId,
        account.connectionId,
        account.id,
        "commit",
        plan,
      )) as Stage1MutationResult[];
    } catch (error) {
      const failure = writeFailureFromError(error);
      results = plan.operations.map((x) => ({
        success: false,
        resource_name: x.resource_name,
        error: failure,
      }));
    }
    const verified = (await this.googlePlanCall(
      plan,
      principal.workspaceId,
      account.connectionId,
      account.id,
      "verify",
      plan,
      results,
    )) as {
      items: unknown[];
      actual: (ResourceSnapshot | JsonRow | null)[];
      status: string;
    };
    await this.database.client.mcpPreview.update({
      where: { id: preview.id },
      data: {
        commitStatus: verified.status,
        providerResult: verified.items as Prisma.InputJsonValue,
        verificationRead: verified.actual as unknown as Prisma.InputJsonValue,
      },
    });
    for (const [index] of plan.operations.entries()) {
      const row = payloadRecord(
        (
          verified.items[plan.operations[index]!.row] as {
            operations: unknown[];
          }
        ).operations.find((x) => payloadRecord(x).operation === index),
      );
      await this.stage1Audit(
        principal,
        preview.id,
        plan,
        index,
        row.success ? "success" : "failure",
        (payloadRecord(row.error).google_error_code as string | undefined) ??
          null,
        verified.actual[index],
      );
    }
    const commitId = await this.recordGoogleCommit(
      principal,
      preview,
      account,
      verified.status,
    );
    return {
      status: verified.status,
      commit_id: commitId,
      preview_id: preview.id,
      provider: "GOOGLE_ADS",
      account_id: plan.account_id,
      operation_count: plan.operations.length,
      items: verified.items,
      partial_failure: plan.version !== 0,
      ...(plan.version === 0
        ? { atomic: true, campaign_plan: plan.summary }
        : {}),
      provider_mutation_attempted: true,
      summary: `Google Ads: ${verified.status}. Результаты подтверждены по каждой операции; повторный commit запрещён.`,
    };
  }
  private stage1Audit(
    principal: ServiceTokenPrincipal,
    previewId: string,
    plan: GoogleWritePlan,
    index: number,
    result: string,
    error: string | null,
    actual?: ResourceSnapshot | JsonRow | null,
  ) {
    const operation = plan.operations[index]!,
      item = plan.items[operation.row]!;
    return this.audit.record({
      eventType: "mcp_google_stage1_operation",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: previewId,
      success: result !== "failure",
      metadata: {
        provider: "GOOGLE_ADS",
        accountId: plan.account_id,
        campaignId: item.campaign_id,
        adGroupId: item.ad_group_id,
        objectId:
          typeof actual?.resource_name === "string"
            ? actual.resource_name
            : operation.resource_name,
        serviceTokenId: principal.tokenId,
        serviceIdentityId: principal.serviceIdentityId,
        previewId,
        commitId: this.googleCommitId(previewId),
        operation: plan.intent.action,
        providerOperation: index,
        result,
        googleErrorCode: error,
        before: canonical(operation.before),
        after: canonical(operation.expected),
        actual: actual === undefined ? null : canonical(actual),
      },
    });
  }
  private googleCommitId(previewId: string) {
    return `hmc_${createHash("sha256").update(`google-commit:${previewId}`).digest("base64url")}`;
  }
  private async recordGoogleCommit(
    principal: ServiceTokenPrincipal,
    preview: { id: string; operation: string },
    account: { externalAccountId: string },
    status: string,
  ) {
    const commitId = this.googleCommitId(preview.id);
    await this.audit.record({
      eventType: "mcp_google_commit_result",
      actorType: "SERVICE",
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      success: status === "VERIFIED",
      metadata: {
        provider: "GOOGLE_ADS",
        accountId: customerId(account.externalAccountId),
        commitId,
        previewId: preview.id,
        operation: preview.operation,
        result: status,
        serviceTokenId: principal.tokenId,
        serviceIdentityId: principal.serviceIdentityId,
      },
    });
    return commitId;
  }
  public async listChangeJournal(
    principal: ServiceTokenPrincipal,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    this.ensureRead(principal);
    if (
      Object.keys(input).some(
        (k) =>
          ![
            "provider",
            "account_id",
            "from",
            "to",
            "actor_user_id",
            "operation",
            "limit",
            "cursor",
          ].includes(k),
      ) ||
      input.provider !== "GOOGLE_ADS" ||
      typeof input.account_id !== "string"
    )
      throw new GoogleAdsWriteError(
        "journal_input_invalid",
        "Укажите GOOGLE_ADS и разрешённый account_id; лишние поля запрещены.",
      );
    const account = await this.account(principal, customerId(input.account_id));
    if (account.provider !== "GOOGLE_ADS")
      throw new PreviewError("confirmation_context_mismatch");
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100)
      throw new GoogleAdsWriteError("journal_input_invalid", "limit: 1–100.");
    const date = (key: string) => {
      if (input[key] === undefined) return undefined;
      if (
        typeof input[key] !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T/.test(input[key] as string) ||
        !Number.isFinite(Date.parse(input[key] as string))
      )
        throw new GoogleAdsWriteError(
          "journal_input_invalid",
          "from/to: ISO timestamp.",
        );
      return new Date(input[key] as string);
    };
    const from = date("from"),
      to = date("to");
    if (from && to && from > to)
      throw new GoogleAdsWriteError(
        "journal_input_invalid",
        "from должен быть не позже to.",
      );
    let cursor: { createdAt: Date; id: string } | undefined;
    if (input.cursor !== undefined) {
      if (
        typeof input.cursor !== "string" ||
        !/^hmc_[A-Za-z0-9_-]{43}$/.test(input.cursor)
      )
        throw new GoogleAdsWriteError(
          "journal_input_invalid",
          "Некорректный cursor.",
        );
      const entry = await this.database.client.auditEvent.findFirst({
        where: {
          workspaceId: principal.workspaceId,
          eventType: "mcp_google_commit_result",
          AND: [
            { metadata: { path: ["commitId"], equals: input.cursor } },
            {
              metadata: {
                path: ["accountId"],
                equals: customerId(account.externalAccountId),
              },
            },
          ],
        },
      });
      if (!entry)
        throw new GoogleAdsWriteError(
          "journal_input_invalid",
          "Cursor недоступен этому аккаунту.",
        );
      const previous = entry.targetId
        ? await this.database.client.mcpPreview.findFirst({
            where: {
              id: entry.targetId,
              workspaceId: principal.workspaceId,
              accountId: account.id,
              provider: "GOOGLE_ADS",
              consumedAt: { not: null },
            },
          })
        : null;
      if (!previous?.commitAttemptedAt)
        throw new GoogleAdsWriteError(
          "journal_input_invalid",
          "Cursor не соответствует завершённому commit.",
        );
      cursor = { createdAt: previous.commitAttemptedAt, id: previous.id };
    }
    const rows = await this.database.client.mcpPreview.findMany({
      where: {
        workspaceId: principal.workspaceId,
        provider: "GOOGLE_ADS",
        accountId: account.id,
        consumedAt: { not: null },
        providerResult: { not: Prisma.AnyNull },
        ...(input.actor_user_id
          ? { approvedByUserId: String(input.actor_user_id) }
          : {}),
        ...(input.operation ? { operation: String(input.operation) } : {}),
        ...(from || to
          ? {
              commitAttemptedAt: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {}),
              },
            }
          : {}),
        ...(cursor
          ? {
              OR: [
                { commitAttemptedAt: { lt: cursor.createdAt } },
                { commitAttemptedAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ commitAttemptedAt: "desc" }, { id: "desc" }],
      take: Number(limit) + 1,
      include: { serviceToken: { select: { serviceIdentityId: true } } },
    });
    const selected = rows.slice(0, Number(limit));
    return {
      items: selected.map((row) => ({
        commit_id: this.googleCommitId(row.id),
        preview_id: row.id,
        who: {
          user_id: row.approvedByUserId,
          service_identity_id: row.serviceToken?.serviceIdentityId,
          service_token_id: row.serviceTokenId,
        },
        when: row.commitAttemptedAt?.toISOString(),
        provider: row.provider,
        account_id: customerId(account.externalAccountId),
        operation: row.operation,
        before: row.beforeState,
        after: row.providerResult,
        actual: row.verificationRead,
        result: row.commitStatus,
      })),
      next_cursor:
        rows.length > Number(limit)
          ? this.googleCommitId(selected.at(-1)!.id)
          : null,
    };
  }
  public async previewRollbackCommit(
    principal: ServiceTokenPrincipal,
    commitId: string,
  ) {
    this.ensureRead(principal);
    if (!/^hmc_[A-Za-z0-9_-]{43}$/.test(commitId))
      throw new GoogleAdsWriteError(
        "rollback_input_invalid",
        "Укажите commit_id из результата записи/журнала.",
      );
    const event = await this.database.client.auditEvent.findFirst({
      where: {
        workspaceId: principal.workspaceId,
        eventType: "mcp_google_commit_result",
        metadata: { path: ["commitId"], equals: commitId },
      },
    });
    const preview = event?.targetId
      ? await this.database.client.mcpPreview.findFirst({
          where: {
            id: event.targetId,
            workspaceId: principal.workspaceId,
            provider: "GOOGLE_ADS",
            consumedAt: { not: null },
          },
        })
      : null;
    if (!preview || this.googleCommitId(preview.id) !== commitId)
      throw new GoogleAdsWriteError(
        "rollback_not_found",
        "Commit не найден или недоступен.",
      );
    const account = await this.account(principal, preview.accountId);
    assertGoogleWriteAccount(this.config, account.externalAccountId);
    await this.assertControlledPrincipal(principal, account.id);
    if (preview.operation === "GOOGLE_KEYWORD_STATUS") {
      const stored = this.googleStored(preview, account),
        results = preview.providerResult as {
          resource_name: string;
          success: boolean;
          reread: unknown;
        }[];
      const eligible = stored.before.filter(
        (row, i) =>
          results.find((result) => result.resource_name === row.resource_name)
            ?.success && row.status !== stored.mutations[i]!.status,
      );
      if (!eligible.length || new Set(eligible.map((x) => x.status)).size !== 1)
        throw new GoogleAdsWriteError(
          "rollback_unsupported",
          "Автоматический rollback этого commit не поддерживается; создайте отдельный status preview.",
        );
      const identities = eligible.map(
        ({ campaign_id, ad_group_id, criterion_id, resource_name }) => ({
          campaign_id,
          ad_group_id,
          criterion_id,
          resource_name,
        }),
      );
      const current = await this.providers.readGoogleKeywordStates(
        principal.workspaceId,
        account.connectionId,
        account.id,
        identities,
      );
      const post = eligible.map(
        (x) =>
          results.find((result) => result.resource_name === x.resource_name)!
            .reread,
      );
      if (canonical(current) !== canonical(post))
        throw new PreviewError("google_preview_stale");
      return this.createGoogleKeywords(
        principal,
        {
          provider: "GOOGLE_ADS",
          accountId: account.externalAccountId,
          objectId: "rollback",
          operation: "update_status",
          payload: {
            entity_type: "keyword",
            status: eligible[0]!.status,
            items: identities,
          },
        },
        current,
      );
    }
    if (preview.operation === "GOOGLE_STAGE2_BID_BUDGET_UPDATE") {
      if (
        !["VERIFIED", "PARTIAL_FAILURE"].includes(String(preview.commitStatus))
      )
        throw new GoogleAdsWriteError(
          "rollback_unsupported",
          "Нужен подтверждённый Stage 2 commit; rollback — отдельный preview.",
        );
      const original = this.googleStage1Stored(preview, account) as Stage2Plan,
        post = preview.verificationRead as JsonRow[];
      const committed = preview.providerResult as {
        operations: { operation: number; success: boolean }[];
      }[];
      const eligible = original.operations
        .map((_, i) => i)
        .filter((i) =>
          committed.some((row) =>
            row.operations.some((op) => op.operation === i && op.success),
          ),
        );
      if (!eligible.length)
        throw new GoogleAdsWriteError(
          "rollback_unsupported",
          "Нет VERIFIED bid/budget операций.",
        );
      const intent = stage2RollbackIntent(
        original,
        eligible,
        original.intent.items[original.operations[eligible[0]!]!.row]!.change
          .currency,
      );
      const inverse = (await this.providers.googleStage2(
        principal.workspaceId,
        account.connectionId,
        account.id,
        "build",
        intent,
      )) as Stage2Plan;
      if (
        inverse.operations.length !== eligible.length ||
        inverse.operations.some(
          (op, i) => canonical(op.before) !== canonical(post[eligible[i]!]),
        )
      )
        throw new PreviewError("google_preview_stale");
      return this.storeGoogleStage1(principal, account, inverse, commitId);
    }
    if (
      preview.operation !== "GOOGLE_STAGE1_KEYWORD_URL" ||
      !["VERIFIED", "PARTIAL_FAILURE"].includes(String(preview.commitStatus))
    )
      throw new GoogleAdsWriteError(
        "rollback_unsupported",
        "Автоматический rollback доступен только для подтверждённых keyword status/final URL. REMOVED необратим; match type и negatives пока не поддерживаются.",
      );
    const original = this.googleStage1Stored(preview, account) as Stage1Plan,
      post = preview.verificationRead as ResourceSnapshot[];
    const committed = preview.providerResult as {
      operations: { operation: number; success: boolean }[];
    }[];
    const eligibleIndices = original.operations
      .map((_, index) => index)
      .filter((index) =>
        committed.some((row) =>
          row.operations.some((op) => op.operation === index && op.success),
        ),
      );
    if (!eligibleIndices.length)
      throw new GoogleAdsWriteError(
        "rollback_unsupported",
        "Нет подтверждённых успешных URL операций для rollback.",
      );
    const intent = {
      action: "keyword_url",
      items: eligibleIndices
        .map((index) => original.operations[index]!)
        .map((op) => ({
          campaign_id: op.before!.campaign_id,
          ad_group_id: op.before!.ad_group_id,
          criterion_id: op.before!.id,
          final_url: op.before!.final_urls[0] ?? null,
        })),
    };
    const inverse = (await this.providers.googleStage1(
      principal.workspaceId,
      account.connectionId,
      account.id,
      "build",
      intent,
    )) as Stage1Plan;
    if (
      inverse.operations.some(
        (op, i) =>
          canonical(op.before) !== canonical(post[eligibleIndices[i]!]),
      )
    )
      throw new PreviewError("google_preview_stale");
    for (const [i, op] of inverse.operations.entries()) {
      const urls = original.operations[eligibleIndices[i]!]!.before!.final_urls;
      op.fields.finalUrls = urls;
      op.expected.final_urls = urls;
      inverse.items[op.row]!.after = { final_urls: urls };
    }
    return this.storeGoogleStage1(principal, account, inverse, commitId);
  }
  public async googleApprovalView(human: HumanPrincipal, nonce: string) {
    const context = await this.googleBrowserContext(human, nonce);
    if (!context) return null;
    const { preview, account } = context;
    if (/^GOOGLE_STAGE[012]_/.test(preview.operation)) {
      const plan = this.googleStage1Stored(preview, account);
      return {
        provider: "Google Ads",
        account: account.displayName || account.externalAccountId,
        campaign: plan.items
          .map((x) => x.campaign_name || x.campaign_id)
          .filter((x, i, a) => x && a.indexOf(x) === i)
          .join(", "),
        operation: plan.intent.action,
        field: "operations",
        before: `${plan.items.length} items`,
        after: `${plan.operations.length} provider operations`,
        stage1_items: plan.items,
        expires_at: preview.expiresAt.toISOString(),
        approved: Boolean(preview.confirmedAt && preview.approvedByUserId),
      };
    }
    const stored = this.googleStored(preview, account);
    return {
      provider: "Google Ads",
      account: account.displayName || account.externalAccountId,
      campaign: stored.before
        .map((x) => x.campaign_name || x.campaign_id)
        .filter((x, i, a) => a.indexOf(x) === i)
        .join(", "),
      operation: preview.operation,
      field: "status",
      before: `${stored.allIdentities.length} keywords (${stored.rejections.length} excluded)`,
      after: String(payloadRecord(preview.payload).status),
      // Render the same immutable, digest-bound state that commit executes.
      items: stored.allIdentities.map((identity, index) => {
        const rejection = stored.rejections.find((x) => x.index === index);
        const row =
          stored.before.find(
            (x) => x.resource_name === identity.resource_name,
          ) ?? rejection?.snapshot;
        return {
          ...(row ?? identity),
          before_status: row?.status ?? null,
          after_status: String(payloadRecord(preview.payload).status),
          eligible_for_commit: !rejection,
          row_error: rejection?.error ?? null,
          warnings: rejection
            ? [rejection.error.message]
            : row?.status === payloadRecord(preview.payload).status
              ? ["no_op: статус уже установлен"]
              : [],
        };
      }),
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
    if (/^GOOGLE_STAGE[012]_/.test(preview.operation))
      this.googleStage1Stored(preview, account);
    else this.googleStored(preview, account);
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
    const rejectionValue = payload.batch_rejections;
    const rejections = (rejectionValue ?? []) as GoogleKeywordRejection[];
    const invalid = () => new PreviewError("confirmation_context_mismatch");
    if (
      preview.operation !== "GOOGLE_KEYWORD_STATUS" ||
      preview.connectionId !== account.connectionId ||
      payload.entity_type !== "keyword" ||
      !["ENABLED", "PAUSED"].includes(String(payload.status)) ||
      Object.keys(payload).sort().join(",") !==
        (rejectionValue === undefined
          ? "entity_type,items,status"
          : "batch_rejections,entity_type,items,status") ||
      payloadRecord(preview.diff).provider_validation !== "passed" ||
      !Array.isArray(rejections) ||
      (rejectionValue !== undefined && !rejections.length)
    )
      throw invalid();
    const allIdentities = keywordBatch(
      account.externalAccountId,
      payload.items,
    );
    if (new Set(rejections.map((x) => x?.index)).size !== rejections.length)
      throw invalid();
    for (const rejection of rejections) {
      if (
        !rejection ||
        !Number.isInteger(rejection.index) ||
        rejection.index < 0 ||
        rejection.index >= allIdentities.length ||
        canonicalJson(rejection.identity) !==
          canonicalJson(allIdentities[rejection.index]) ||
        !rejection.error ||
        !["HOLYMEDIA", "GOOGLE_ADS"].includes(rejection.error.source) ||
        !["snapshot_read", "validate_only"].includes(rejection.error.stage)
      )
        throw invalid();
      if (rejection.error.source === "HOLYMEDIA") {
        if (
          rejection.snapshot !== null ||
          rejection.provider_error !== null ||
          rejection.error.stage !== "snapshot_read" ||
          rejection.error.code !== "google_keyword_unavailable" ||
          rejection.error.google_code !== null
        )
          throw invalid();
      } else if (
        !rejection.snapshot ||
        !rejection.provider_error ||
        rejection.error.stage !== "validate_only" ||
        rejection.snapshot.resource_name !== rejection.identity.resource_name ||
        rejection.snapshot.account_id !==
          customerId(account.externalAccountId) ||
        rejection.snapshot.campaign_id !== rejection.identity.campaign_id ||
        rejection.snapshot.ad_group_id !== rejection.identity.ad_group_id ||
        rejection.snapshot.criterion_id !== rejection.identity.criterion_id ||
        !["ENABLED", "PAUSED"].includes(rejection.snapshot.status) ||
        rejection.error.google_code !== rejection.provider_error.google_code
      )
        throw invalid();
    }
    const excluded = new Set(rejections.map((x) => x.identity.resource_name));
    const identities = allIdentities.filter(
      (x) => !excluded.has(x.resource_name),
    );
    const mutations = identities.map((x) => ({
      ...x,
      status: payload.status as "ENABLED" | "PAUSED",
    }));
    const before = preview.beforeState as GoogleKeywordSnapshot[];
    if (
      !identities.length ||
      !Array.isArray(before) ||
      before.length !== identities.length ||
      preview.externalObjectId !== allIdentities[0]!.resource_name ||
      canonicalJson(preview.requestedState) !== canonicalJson(mutations) ||
      preview.snapshotDigest !==
        digest(
          canonicalJson(
            rejections.length
              ? [before, mutations, rejections]
              : [before, mutations],
          ),
        ) ||
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
      throw invalid();
    return { before, identities, mutations, allIdentities, rejections };
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
    if (/^GOOGLE_STAGE[012]_/.test(preview.operation))
      return this.commitGoogleStage1(principal, preview, account);
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
    for (const rejection of stored.rejections) {
      let row: GoogleKeywordSnapshot | null = null;
      try {
        row =
          (
            await this.providers.readGoogleKeywordStates(
              principal.workspaceId,
              account.connectionId,
              account.id,
              [rejection.identity],
            )
          )[0] ?? null;
      } catch (error) {
        if (
          !(error instanceof GoogleAdsWriteError) ||
          error.writeCode !== "google_keyword_unavailable"
        )
          throw error;
      }
      if (canonicalJson(row) !== canonicalJson(rejection.snapshot))
        throw new PreviewError("google_preview_stale");
    }
    await this.claimGooglePreview(principal, preview, account);
    return this.executeGoogleKeywords(principal, preview, account, stored);
  }
  private async claimGooglePreview(
    principal: ServiceTokenPrincipal,
    preview: Awaited<ReturnType<McpPreviewService["find"]>>,
    account: Awaited<ReturnType<McpPreviewService["account"]>>,
  ) {
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
        operation: preview.operation,
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
  }
  private async executeGoogleKeywords(
    principal: ServiceTokenPrincipal,
    preview: Awaited<ReturnType<McpPreviewService["find"]>>,
    account: Awaited<ReturnType<McpPreviewService["account"]>>,
    stored: ReturnType<McpPreviewService["googleStored"]>,
  ) {
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
    for (const rejection of stored.rejections)
      await this.audit.record({
        eventType: "mcp_google_keyword_row_rejected",
        actorType: "SERVICE",
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        success: false,
        metadata: {
          provider: "GOOGLE_ADS",
          accountId: account.externalAccountId,
          serviceTokenId: principal.tokenId,
          serviceIdentityId: principal.serviceIdentityId,
          commitId: this.googleCommitId(preview.id),
          previewId: preview.id,
          objectId: rejection.identity.criterion_id,
          resourceName: rejection.identity.resource_name,
          before: rejection.snapshot?.status ?? null,
          after: String(payloadRecord(preview.payload).status),
          result: "rejected",
          errorSource: rejection.error.source,
          errorCode: rejection.error.code,
          googleErrorCode: rejection.error.google_code,
        },
      });
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
    const validItems = stored.before.map((x, i) => {
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
    const items = stored.allIdentities.map((identity, index) => {
      const rejected = stored.rejections.find((x) => x.index === index);
      if (!rejected)
        return validItems.find(
          (x) => x.resource_name === identity.resource_name,
        )!;
      return {
        ...identity,
        keyword: rejected.snapshot?.keyword ?? null,
        match_type: rejected.snapshot?.match_type ?? null,
        old_status: rejected.snapshot?.status ?? null,
        requested_status: String(payloadRecord(preview.payload).status),
        actual_status: rejected.snapshot?.status ?? null,
        success: false,
        result: "rejected",
        row_error: rejected.error,
        google_error: rejected.provider_error,
        reread: rejected.snapshot,
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
    for (const row of validItems)
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
    const commitId = await this.recordGoogleCommit(
      principal,
      preview,
      account,
      finalStatus,
    );
    return {
      status: finalStatus,
      commit_id: commitId,
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
        commitId: this.googleCommitId(previewId),
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

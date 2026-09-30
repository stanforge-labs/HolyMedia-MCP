import { createHash, randomBytes } from "node:crypto";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { Prisma } from "@holymedia/database";
import { AuditService } from "../audit/audit.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { ProviderService } from "../providers/provider.service.js";
import type { MetaControlledCampaignState } from "../providers/provider.types.js";
import { PreviewError } from "./mcp-preview.error.js";
import type { OAuthMcpPrincipal } from "./mcp-principal.js";

export const PUBLIC_PREVIEW_TTL_MS = 10 * 60_000;

const operations = {
  preview_change_campaign_name: "META_CAMPAIGN_RENAME",
  preview_pause_campaign: "META_CAMPAIGN_PAUSE",
  preview_resume_campaign: "META_CAMPAIGN_RESUME",
} as const;
type PublicOperation = (typeof operations)[keyof typeof operations];
const publicOperations = new Set<string>(Object.values(operations));

type PublicSnapshot = {
  id: string;
  accountId: string;
  name: string;
  status: string;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function required(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new ForbiddenException(`${field} is required.`);
  return value.trim();
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function snapshot(state: MetaControlledCampaignState): PublicSnapshot {
  return {
    id: state.id,
    accountId: state.accountId,
    name: state.name,
    status: state.status,
  };
}

function snapshotHash(state: PublicSnapshot): string {
  return digest(
    JSON.stringify([state.id, state.accountId, state.name, state.status]),
  );
}

function matchesRequested(
  operation: PublicOperation,
  state: PublicSnapshot,
  requested: Record<string, unknown>,
): boolean {
  return operation === "META_CAMPAIGN_RENAME"
    ? state.name === requested.name
    : state.status === requested.status;
}

@Injectable()
export class McpPublicWriteService {
  private readonly config: AppConfig = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProviderService) private readonly providers: ProviderService,
  ) {}

  public async call(principal: OAuthMcpPrincipal, name: string, raw: unknown) {
    this.requireWrite(principal);
    const args = record(raw);
    if (Object.prototype.hasOwnProperty.call(operations, name))
      return this.create(principal, name as keyof typeof operations, args);
    if (name === "confirm_preview")
      return this.confirm(principal, this.onlyToken(args));
    if (name === "commit_confirmed_preview")
      return this.commit(principal, this.onlyToken(args));
    throw new PreviewError("public_operation_not_available");
  }

  private async create(
    principal: OAuthMcpPrincipal,
    tool: keyof typeof operations,
    args: Record<string, unknown>,
  ) {
    const rename = tool === "preview_change_campaign_name";
    const allowed = rename
      ? ["account_id", "campaign_id", "new_name"]
      : ["account_id", "campaign_id"];
    if (Object.keys(args).some((key) => !allowed.includes(key)))
      throw new PreviewError("public_operation_not_available");
    const accountId = required(args.account_id, "account_id");
    const campaignId = required(args.campaign_id, "campaign_id");
    const operation = operations[tool];
    const newName = rename ? required(args.new_name, "new_name") : null;
    if (newName && newName.length > 255)
      throw new ForbiddenException("new_name is too long.");
    if (!/^\d{1,40}$/.test(campaignId))
      throw new ForbiddenException("campaign_id is invalid.");

    const account = await this.account(principal, accountId);
    await this.requireMetaWritePermission(principal, account.connectionId);
    const before = await this.readCampaign(principal, account, campaignId);
    const requested = rename
      ? { name: newName }
      : { status: operation === "META_CAMPAIGN_PAUSE" ? "PAUSED" : "ACTIVE" };
    if (matchesRequested(operation, before, requested))
      throw new PreviewError("preview_no_change");

    const rawToken = `hmpp_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + PUBLIC_PREVIEW_TTL_MS);
    const preview = await this.database.client.mcpPreview.create({
      data: {
        workspaceId: principal.workspaceId,
        principalType: "OAUTH_USER",
        oauthUserId: principal.userId,
        oauthClientId: principal.clientId,
        oauthGrantId: principal.grantId,
        provider: "META_ADS",
        accountId: account.id,
        connectionId: account.connectionId,
        externalObjectId: campaignId,
        operation,
        payload: requested as Prisma.InputJsonValue,
        diff: { before, requested } as Prisma.InputJsonValue,
        beforeState: before as Prisma.InputJsonValue,
        requestedState: requested as Prisma.InputJsonValue,
        snapshotDigest: snapshotHash(before),
        previewTokenDigest: digest(rawToken),
        expiresAt,
        commitStatus: "PREVIEWED",
      },
    });
    await this.audit.record({
      eventType: "mcp_public_preview_created",
      actorType: "HUMAN",
      actorUserId: principal.userId,
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata: {
        oauthClientId: principal.clientId,
        oauthGrantId: principal.grantId,
        provider: "META_ADS",
        connectionId: account.connectionId,
        accountId: account.id,
        campaignId,
        operation,
        before: JSON.stringify(before),
        requested: JSON.stringify(requested),
      },
    });
    return {
      status: "preview",
      preview_token: rawToken,
      preview_id: preview.id,
      actor_user_id: principal.userId,
      workspace_id: principal.workspaceId,
      connection_id: account.connectionId,
      account_id: account.externalAccountId,
      campaign_id: campaignId,
      operation,
      before,
      requested,
      snapshot_digest: preview.snapshotDigest,
      created_at: preview.createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      confirmed_at: null,
      commit_status: "PREVIEWED",
      provider_write_enabled: this.config.publicMcpControlledWriteEnabled,
      execution_mode: "simulated_no_write",
    };
  }

  private async confirm(principal: OAuthMcpPrincipal, rawToken: string) {
    const preview = await this.find(principal, rawToken);
    this.assertUsable(preview);
    const account = await this.account(principal, preview.accountId);
    this.assertContext(preview, account);
    await this.requireMetaWritePermission(principal, account.connectionId);
    if (preview.confirmedAt) return this.confirmationView(preview);
    const now = new Date();
    const updated = await this.database.client.mcpPreview.updateMany({
      where: {
        id: preview.id,
        principalType: "OAUTH_USER",
        workspaceId: principal.workspaceId,
        oauthUserId: principal.userId,
        oauthClientId: principal.clientId,
        oauthGrantId: principal.grantId,
        confirmedAt: null,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { confirmedAt: now, commitStatus: "CONFIRMED" },
    });
    if (updated.count !== 1) {
      const current = await this.find(principal, rawToken);
      this.assertUsable(current);
      if (current.confirmedAt) return this.confirmationView(current);
      throw new PreviewError("confirmation_context_mismatch");
    }
    await this.audit.record({
      eventType: "mcp_public_preview_confirmed",
      actorType: "HUMAN",
      actorUserId: principal.userId,
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata: {
        oauthClientId: principal.clientId,
        oauthGrantId: principal.grantId,
        provider: "META_ADS",
        accountId: account.id,
        campaignId: preview.externalObjectId,
        operation: preview.operation,
        confirmedAt: now.toISOString(),
      },
    });
    return this.confirmationView({ ...preview, confirmedAt: now });
  }

  private async commit(principal: OAuthMcpPrincipal, rawToken: string) {
    const preview = await this.find(principal, rawToken);
    this.assertUsable(preview);
    if (!preview.confirmedAt) throw new PreviewError("preview_not_confirmed");
    const account = await this.account(principal, preview.accountId);
    this.assertContext(preview, account);
    if (!this.config.publicMcpControlledWriteEnabled) {
      await this.audit.record({
        eventType: "mcp_public_commit_blocked",
        actorType: "HUMAN",
        actorUserId: principal.userId,
        workspaceId: principal.workspaceId,
        targetType: "mcp_preview",
        targetId: preview.id,
        success: false,
        metadata: {
          reason: "public_write_disabled",
          operation: preview.operation,
        },
      });
      throw new PreviewError("public_write_disabled");
    }
    await this.requireMetaWritePermission(principal, account.connectionId);
    const now = new Date();
    const claimed = await this.database.client.mcpPreview.updateMany({
      where: {
        id: preview.id,
        principalType: "OAUTH_USER",
        workspaceId: principal.workspaceId,
        oauthUserId: principal.userId,
        oauthClientId: principal.clientId,
        oauthGrantId: principal.grantId,
        accountId: account.id,
        connectionId: account.connectionId,
        confirmedAt: { not: null },
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        consumedAt: now,
        commitAttemptedAt: now,
        commitStatus: "CLAIMED",
      },
    });
    if (claimed.count !== 1) throw new PreviewError("preview_already_consumed");
    await this.audit.record({
      eventType: "mcp_public_commit_attempted",
      actorType: "HUMAN",
      actorUserId: principal.userId,
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: preview.id,
      metadata: {
        oauthClientId: principal.clientId,
        oauthGrantId: principal.grantId,
        provider: "META_ADS",
        connectionId: account.connectionId,
        accountId: account.id,
        campaignId: preview.externalObjectId,
        operation: preview.operation,
        attemptedAt: now.toISOString(),
      },
    });

    const operation = preview.operation as PublicOperation;
    const desired = record(preview.requestedState);
    let current: PublicSnapshot;
    try {
      current = await this.readCampaign(
        principal,
        account,
        preview.externalObjectId,
      );
    } catch (error) {
      await this.finalize(
        principal,
        preview.id,
        "PREWRITE_READ_FAILED",
        null,
        null,
      );
      throw error;
    }
    if (snapshotHash(current) !== preview.snapshotDigest) {
      await this.finalize(
        principal,
        preview.id,
        "PREVIEW_STALE",
        null,
        current,
      );
      throw new PreviewError("preview_stale");
    }

    const providerOperation =
      operation === "META_CAMPAIGN_RENAME"
        ? "change_name"
        : operation === "META_CAMPAIGN_PAUSE"
          ? "pause"
          : "resume";
    const providerPayload =
      operation === "META_CAMPAIGN_RENAME" ? { new_name: desired.name } : {};
    let providerResult: unknown;
    try {
      // The existing Meta adapter maps these exact inputs to name or status only.
      providerResult = await this.providers.mutateCampaign(
        principal.workspaceId,
        account.connectionId,
        account.id,
        preview.externalObjectId,
        providerOperation,
        providerPayload,
      );
    } catch (error) {
      // A lost provider response is not safe to retry. Inspect the campaign once.
      try {
        const observed = await this.readCampaign(
          principal,
          account,
          preview.externalObjectId,
        );
        if (matchesRequested(operation, observed, desired)) {
          await this.finalize(
            principal,
            preview.id,
            "VERIFIED",
            {
              response: "lost_or_failed",
              errorType:
                error instanceof Error ? error.constructor.name : "unknown",
            },
            observed,
          );
          return this.result(preview.id, operation, "VERIFIED", observed);
        }
        await this.finalize(
          principal,
          preview.id,
          "NOT_VERIFIED",
          {
            response: "lost_or_failed",
            errorType:
              error instanceof Error ? error.constructor.name : "unknown",
          },
          observed,
        );
        throw new PreviewError("verification_mismatch");
      } catch (readError) {
        if (readError instanceof PreviewError) throw readError;
        await this.finalize(
          principal,
          preview.id,
          "UNCERTAIN_OUTCOME",
          {
            response: "lost_or_failed",
            errorType:
              error instanceof Error ? error.constructor.name : "unknown",
          },
          null,
        );
        throw new PreviewError("provider_outcome_uncertain");
      }
    }

    try {
      const observed = await this.readCampaign(
        principal,
        account,
        preview.externalObjectId,
      );
      if (!matchesRequested(operation, observed, desired)) {
        await this.finalize(
          principal,
          preview.id,
          "NOT_VERIFIED",
          providerResult,
          observed,
        );
        throw new PreviewError("verification_mismatch");
      }
      await this.finalize(
        principal,
        preview.id,
        "VERIFIED",
        providerResult,
        observed,
      );
      return this.result(preview.id, operation, "VERIFIED", observed);
    } catch (error) {
      if (error instanceof PreviewError) throw error;
      await this.finalize(
        principal,
        preview.id,
        "UNCERTAIN_OUTCOME",
        providerResult,
        null,
      );
      throw new PreviewError("provider_outcome_uncertain");
    }
  }

  private result(
    id: string,
    operation: PublicOperation,
    status: string,
    observed: PublicSnapshot,
  ) {
    return {
      preview_id: id,
      operation,
      status,
      verified: true,
      verification_read: observed,
    };
  }

  private async finalize(
    principal: OAuthMcpPrincipal,
    previewId: string,
    status: string,
    providerResult: unknown,
    verificationRead: PublicSnapshot | null,
  ) {
    await this.database.client.mcpPreview.update({
      where: { id: previewId },
      data: {
        commitStatus: status,
        providerResult:
          providerResult === null
            ? Prisma.JsonNull
            : (providerResult as Prisma.InputJsonValue),
        verificationRead:
          verificationRead === null
            ? Prisma.JsonNull
            : (verificationRead as Prisma.InputJsonValue),
      },
    });
    await this.audit.record({
      eventType: "mcp_public_commit_finalized",
      actorType: "HUMAN",
      actorUserId: principal.userId,
      workspaceId: principal.workspaceId,
      targetType: "mcp_preview",
      targetId: previewId,
      success: status === "VERIFIED",
      metadata: {
        oauthClientId: principal.clientId,
        oauthGrantId: principal.grantId,
        finalStatus: status,
        providerResult:
          providerResult === null ? null : JSON.stringify(providerResult),
        verificationRead:
          verificationRead === null ? null : JSON.stringify(verificationRead),
      },
    });
  }

  private async find(principal: OAuthMcpPrincipal, rawToken: string) {
    if (!/^hmpp_[A-Za-z0-9_-]{20,120}$/.test(rawToken))
      throw new PreviewError("invalid_preview_token");
    const preview = await this.database.client.mcpPreview.findFirst({
      where: {
        previewTokenDigest: digest(rawToken),
        principalType: "OAUTH_USER",
        workspaceId: principal.workspaceId,
        oauthUserId: principal.userId,
        oauthClientId: principal.clientId,
        oauthGrantId: principal.grantId,
      },
    });
    if (!preview) throw new PreviewError("preview_not_found");
    return preview;
  }

  private assertUsable(preview: {
    provider: string;
    operation: string;
    expiresAt: Date;
    consumedAt: Date | null;
  }) {
    if (
      preview.provider !== "META_ADS" ||
      !publicOperations.has(preview.operation)
    )
      throw new PreviewError("public_operation_not_available");
    if (preview.consumedAt) throw new PreviewError("preview_already_consumed");
    if (preview.expiresAt <= new Date())
      throw new PreviewError("preview_expired");
  }

  private assertContext(
    preview: {
      connectionId: string | null;
      accountId: string;
      externalObjectId: string;
      beforeState: unknown;
      requestedState: unknown;
      payload: unknown;
      snapshotDigest: string | null;
      operation: string;
    },
    account: { id: string; connectionId: string; externalAccountId: string },
  ) {
    const before = record(preview.beforeState);
    const requested = record(preview.requestedState);
    const storedPayload = record(preview.payload);
    const expectedStatus =
      preview.operation === "META_CAMPAIGN_PAUSE" ? "PAUSED" : "ACTIVE";
    if (
      preview.accountId !== account.id ||
      preview.connectionId !== account.connectionId ||
      before.id !== preview.externalObjectId ||
      before.accountId !== account.externalAccountId ||
      typeof before.name !== "string" ||
      typeof before.status !== "string" ||
      preview.snapshotDigest !== snapshotHash(before as PublicSnapshot) ||
      JSON.stringify(storedPayload) !== JSON.stringify(requested) ||
      (preview.operation === "META_CAMPAIGN_RENAME"
        ? typeof requested.name !== "string" ||
          Object.keys(requested).length !== 1
        : requested.status !== expectedStatus ||
          Object.keys(requested).length !== 1)
    )
      throw new PreviewError("confirmation_context_mismatch");
  }

  private confirmationView(preview: {
    id: string;
    operation: string;
    confirmedAt: Date | null;
    expiresAt: Date;
  }) {
    return {
      status: "confirmed",
      preview_id: preview.id,
      operation: preview.operation,
      confirmed_at: preview.confirmedAt?.toISOString() ?? null,
      expires_at: preview.expiresAt.toISOString(),
      provider_mutation_sent: false,
    };
  }

  private onlyToken(args: Record<string, unknown>): string {
    if (Object.keys(args).length !== 1 || !("preview_token" in args))
      throw new PreviewError("invalid_confirmation_arguments");
    return required(args.preview_token, "preview_token");
  }

  private requireWrite(principal: OAuthMcpPrincipal) {
    if (
      principal.resource !== "https://mcp.holymedia.kz/mcp/public" ||
      !principal.scopes.includes("adforge:mcp:write") ||
      !principal.scopes.includes("adforge:mcp:read")
    )
      throw new PreviewError("write_scope_required");
  }

  private async account(principal: OAuthMcpPrincipal, raw: string) {
    const identifiers: Array<Record<string, string>> = [
      { externalAccountId: raw },
    ];
    if (/^\d{1,40}$/.test(raw))
      identifiers.push({ externalAccountId: `act_${raw}` });
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        raw,
      )
    )
      identifiers.unshift({ id: raw });
    const account = await this.database.client.providerAccount.findFirst({
      where: {
        workspaceId: principal.workspaceId,
        provider: "META_ADS",
        enabled: true,
        connection: {
          workspaceId: principal.workspaceId,
          status: "CONNECTED",
        },
        OR: identifiers,
      },
    });
    if (!account)
      throw new ForbiddenException(
        "Meta account is not available in this workspace.",
      );
    return account;
  }

  private async requireMetaWritePermission(
    principal: OAuthMcpPrincipal,
    connectionId: string,
  ) {
    const permissions = await this.providers.metaPermissions(
      principal.workspaceId,
      connectionId,
    );
    if (!permissions.granted.includes("ads_management"))
      throw new ForbiddenException(
        "Meta ads_management permission is required.",
      );
  }

  private async readCampaign(
    principal: OAuthMcpPrincipal,
    account: { id: string; connectionId: string; externalAccountId: string },
    campaignId: string,
  ): Promise<PublicSnapshot> {
    const state = await this.providers.readMetaControlledCampaign(
      principal.workspaceId,
      account.connectionId,
      account.id,
      campaignId,
    );
    if (
      state.id !== campaignId ||
      state.accountId !== account.externalAccountId
    )
      throw new ForbiddenException("Campaign/account mismatch.");
    return snapshot(state);
  }
}

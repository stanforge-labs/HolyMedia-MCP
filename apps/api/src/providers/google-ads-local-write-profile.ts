import type { AppConfig } from "@holymedia/config";
import { release } from "node:os";
import type { DatabaseService } from "../infrastructure/database.service.js";
import { GoogleAdsWriteError } from "./google-ads-write.js";

const TEST_CUSTOMER = "8590146099";
const GOOGLE_WRITE_SCOPE = "https://www.googleapis.com/auth/adwords";

/** A Linux VPS cannot opt into the WSL2-only profile by copying TEST env. */
export function assertLocalWriteKernel(
  config: AppConfig,
  kernelRelease = release(),
): void {
  if (
    config.qrsTestLocalWriteEnabled &&
    !/microsoft.*wsl2/i.test(kernelRelease)
  )
    throw new Error("Local Google WRITE requires a WSL2 kernel.");
}

export function localWriteRequestAllowed(
  config: AppConfig,
  path: string,
  host: string | undefined,
  origin: string | undefined,
): boolean {
  if (!config.qrsTestLocalWriteEnabled) return true;
  if (!(
    path === "/mcp" ||
    path.startsWith("/mcp/") ||
    path.startsWith("/oauth/") ||
    path === "/auth/google/callback"
  ))
    return true;
  return (
    (host === "127.0.0.1:23300" || host === "127.0.0.1:24404") &&
    (origin === undefined || origin === "http://127.0.0.1:23300")
  );
}

function denied(): never {
  throw new GoogleAdsWriteError(
    "google_local_write_binding_denied",
    "Local TEST Google WRITE binding is missing, stale or revoked.",
  );
}

/** PMax and ConversionAction keep their separate, default-OFF acceptance gates. */
export function assertLocalStage4Action(
  config: AppConfig,
  input: unknown,
): void {
  if (!config.qrsTestLocalWriteEnabled) return;
  const record =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const intent =
    record.intent &&
    typeof record.intent === "object" &&
    !Array.isArray(record.intent)
      ? (record.intent as Record<string, unknown>)
      : record;
  const action = intent.action;
  if (
    typeof action !== "string" ||
    /^(pmax_|asset_group_|conversion_action_)/.test(action)
  )
    denied();
}

/** Database evidence is checked before any Google read/validate/mutate in this opt-in profile. */
export async function assertLocalGoogleWriteContext(
  config: AppConfig,
  database: DatabaseService,
  workspaceId: string,
  connectionId: string,
  accountId: string,
): Promise<void> {
  if (!config.qrsTestLocalWriteEnabled) return;
  const ownerId = config.qrsTestGoogleOwnerBindingUserId;
  const ownerEmail = config.qrsTestGoogleOwnerBindingEmail;
  const grantId = config.qrsTestLocalWriteOAuthGrantId;
  const after = Date.parse(config.qrsTestLocalWriteGrantNotBefore ?? "");
  if (
    !ownerId ||
    !ownerEmail ||
    !grantId ||
    !Number.isFinite(after) ||
    workspaceId !== config.qrsTestLocalWriteWorkspaceId ||
    connectionId !== config.qrsTestLocalWriteConnectionId
  )
    denied();
  const now = new Date();
  const [owner, connection, account, grant, grantOrigin] = await Promise.all([
    database.client.workspaceMembership.findFirst({
      where: {
        workspaceId,
        userId: ownerId,
        role: "OWNER",
        workspace: { accessStatus: "ACTIVE" },
        user: {
          status: "active",
          email: ownerEmail,
        },
      },
      select: { id: true },
    }),
    database.client.providerConnection.findFirst({
      where: {
        id: connectionId,
        workspaceId,
        provider: "GOOGLE_ADS",
        status: "CONNECTED",
        createdBy: ownerId,
      },
      select: {
        connectedAt: true,
        metadata: true,
        credential: { select: { id: true } },
      },
    }),
    database.client.providerAccount.findFirst({
      where: {
        id: accountId,
        connectionId,
        workspaceId,
        provider: "GOOGLE_ADS",
        externalAccountId: TEST_CUSTOMER,
        enabled: true,
      },
      select: { id: true },
    }),
    database.client.oAuthRefreshToken.findFirst({
      where: {
        familyId: grantId,
        userId: ownerId,
        workspaceId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
        resource: "http://127.0.0.1:23300/mcp",
        client: { status: "active", revokedAt: null },
      },
      select: { createdAt: true, scope: true },
    }),
    database.client.oAuthRefreshToken.findFirst({
      where: { familyId: grantId },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const metadata = connection?.metadata;
  const grantedScopes =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as { grantedScopes?: unknown }).grantedScopes
      : null;
  if (
    !owner ||
    !connection?.credential ||
    !connection.connectedAt ||
    connection.connectedAt.getTime() <= after ||
    !account ||
    !grant ||
    grant.createdAt.getTime() <= after ||
    !grantOrigin ||
    grantOrigin.createdAt.getTime() <= after ||
    !grant.scope.split(/\s+/).includes("adforge:mcp:read") ||
    !grant.scope.split(/\s+/).includes("adforge:mcp:write") ||
    !Array.isArray(grantedScopes) ||
    !grantedScopes.includes(GOOGLE_WRITE_SCOPE)
  )
    denied();
}

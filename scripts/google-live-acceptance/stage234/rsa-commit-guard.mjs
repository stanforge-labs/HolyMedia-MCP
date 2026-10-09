// One separately authorized L immutable commit; never previews/revalidates/approves.
import {
  appendFileSync,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { URL } from "node:url";
import process from "node:process";
import { readAcceptanceContext } from "./context-vault.mjs";
import {
  target,
  canonical,
  digest,
  validationPayload,
  assertStoredL,
  validateLRequest,
} from "./rsa-preview-guard.mjs";
import { assertProof } from "./live-guard.mjs";
const { Headers } = globalThis;
export { target, canonical, digest };
export const exactPreview = "49e76856-b8a9-451a-a240-207d8bf7fa40";
export const fail = (code) => {
  throw new Error(code);
};
export const commitPayload = { ...validationPayload, validateOnly: false };
export function assertCommitRuntime(env) {
  const required = {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.customer,
    PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: target.mcc,
    PROVIDER_GOOGLE_API_VERSION: "v24",
    V2_PREVIEW_ONLY: "false",
    V2_CONFIRMED_WRITE_ENABLED: "true",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
    STAGE234_EXPLICIT_COMMIT_AUTHORIZED: "true",
    API_PORT: "4000",
    STAGE234_GUARD_PRELOAD: "0",
    STAGE234_L_GUARD_PRELOAD: "0",
    STAGE234_EXPECTED_L_PREVIEW: exactPreview,
  };
  if (
    Object.entries(required).some(([k, v]) => env[k] !== v) ||
    env.STAGE234_SOURCE_HEAD !== "c11f14c263b8e3a27418d87146b1894c7d9107dc" ||
    env.STAGE234_IMAGE_DIGEST !==
      "sha256:8f6af88c3ab81a162ae63d3c862c614884388410ea0610f40b800cb16fd3bfba" ||
    !/^[a-f0-9]{40}$/.test(env.STAGE234_HARNESS_HEAD ?? "")
  )
    fail("stage234_l_commit_runtime_invalid");
}
export function protectedJson(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
    fail("stage234_commit_protected_file_invalid");
  return JSON.parse(readFileSync(file, "utf8"));
}
export function assertApprovedL(
  { context, stored, account, key, session, approval },
  expectedPreview,
  now = Date.now(),
) {
  const active = (row) =>
    row &&
    !row.revokedAt &&
    (!row.expiresAt || Date.parse(row.expiresAt) > now);
  if (
    !context?.preview?.preview_id ||
    typeof context.preview.preview_token !== "string" ||
    !context.preview.preview_token ||
    stored?.id !== context.preview.preview_id ||
    digest(context.preview.preview_token) !== stored.previewTokenDigest
  )
    fail("stage234_commit_exact_token_invalid");
  if (
    !active(key) ||
    key.serviceIdentity?.revokedAt ||
    !key.serviceIdentity?.createdById ||
    key.serviceIdentity.workspaceId !== account?.workspaceId ||
    stored.workspaceId !== account?.workspaceId ||
    stored.principalType !== "SERVICE_TOKEN" ||
    stored.serviceTokenId !== key.id ||
    account?.provider !== "GOOGLE_ADS" ||
    account.externalAccountId !== target.customer ||
    !account.enabled ||
    stored.accountId !== account.id ||
    stored.connectionId !== account.connectionId ||
    stored.provider !== "GOOGLE_ADS" ||
    key.tokenDigest !== digest(context.service_token ?? "") ||
    key.resourceAccessMode !== "STATIC_ALLOWLIST" ||
    canonical(key.accountIds) !== canonical([account.id]) ||
    !["adforge:mcp:read", "adforge:mcp:write"].every((s) =>
      key.scopes?.includes(s),
    )
  )
    fail("stage234_commit_account_owner_invalid");
  if (
    !stored.confirmedAt ||
    !Number.isFinite(Date.parse(stored.confirmedAt)) ||
    Date.parse(stored.confirmedAt) > now ||
    !stored.approvalSessionId ||
    !stored.approvedByUserId ||
    stored.approvedByUserId !== key.serviceIdentity.createdById ||
    stored.commitStatus !== "CONFIRMED"
  )
    fail("stage234_commit_approval_not_persisted");
  if (
    !active(session) ||
    session.id !== stored.approvalSessionId ||
    session.userId !== stored.approvedByUserId ||
    session.user?.status !== "active" ||
    !approval ||
    approval.eventType !== "mcp_preview_web_approved" ||
    approval.targetId !== stored.id ||
    approval.workspaceId !== stored.workspaceId ||
    approval.actorType !== "HUMAN" ||
    approval.actorUserId !== stored.approvedByUserId ||
    approval.success !== true ||
    !Number.isFinite(Date.parse(approval.createdAt)) ||
    Date.parse(approval.createdAt) < Date.parse(stored.confirmedAt)
  )
    fail("stage234_commit_session_audit_invalid");
  if (
    Date.parse(stored.expiresAt) <= now ||
    !Number.isFinite(Date.parse(stored.expiresAt))
  )
    fail("stage234_commit_preview_expired");
  if (stored.consumedAt || stored.cancelledAt || stored.commitAttemptedAt)
    fail("stage234_commit_preview_consumed_or_attempted");
  if (
    expectedPreview !== exactPreview ||
    context.preview.preview_id !== expectedPreview ||
    stored.operation !== "GOOGLE_STAGE4_RSA_CREATE"
  )
    fail("stage234_l_commit_exact_preview_invalid");
  assertStoredL(
    { ...stored, confirmedAt: null, commitStatus: "PREVIEWED" },
    account,
    key,
  );
  if (stored.diff?.provider_validation !== "passed")
    fail("stage234_l_commit_provider_validation_invalid");
  return {
    preview_id: stored.id,
    snapshot_digest: stored.snapshotDigest,
    expires_at: new Date(stored.expiresAt).toISOString(),
    approval_persisted: true,
    approval_session_valid: true,
    approval_audit_valid: true,
    customer_id: target.customer,
    phase: "commit",
  };
}

function assertAuthority(authority, context, env, proof, now) {
  if (
    authority?.phase !== "commit" ||
    authority.preview_id !== exactPreview ||
    context?.preview?.preview_id !== exactPreview ||
    !authority.approval_persisted ||
    !authority.approval_session_valid ||
    !authority.approval_audit_valid ||
    authority.customer_id !== target.customer ||
    !/^[a-f0-9]{64}$/.test(authority.snapshot_digest ?? "") ||
    !Number.isFinite(Date.parse(authority.expires_at)) ||
    Date.parse(authority.expires_at) <= now
  )
    fail("stage234_l_commit_authority_invalid");
  assertProof(proof, env, now);
}
export function validateCommitRequest(
  input,
  init = {},
  { env, proof, authority, context, now = Date.now() } = {},
) {
  assertCommitRuntime(env);
  if (typeof input !== "string" && !(input instanceof URL))
    fail("stage234_l_commit_request_object_blocked");
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (url.username || url.password || url.search || url.hash)
    fail("stage234_l_commit_url_invalid");
  if (
    url.origin === "http://127.0.0.1:4000" &&
    method === "POST" &&
    url.pathname === "/mcp"
  ) {
    const rpc = JSON.parse(init.body);
    if (
      typeof context?.preview?.preview_token !== "string" ||
      canonical(rpc) !==
        canonical({
          jsonrpc: "2.0",
          id: "stage234-L-commit",
          method: "tools/call",
          params: {
            name: "commit_preview",
            arguments: { preview_token: context.preview.preview_token },
          },
        })
    )
      fail("stage234_l_commit_tool_or_token_blocked");
    assertAuthority(authority, context, env, proof, now);
    return "mcp_commit";
  }
  if (
    url.origin === "https://googleads.googleapis.com" &&
    url.pathname.endsWith(":mutate")
  ) {
    if (
      method !== "POST" ||
      url.pathname !== `/v24/customers/${target.customer}/googleAds:mutate` ||
      new Headers(init.headers).get("login-customer-id") !== target.mcc ||
      canonical(JSON.parse(init.body)) !== canonical(commitPayload)
    )
      fail("stage234_l_commit_extra_mutation_or_validation_blocked");
    assertAuthority(authority, context, env, proof, now);
    return "write";
  }
  const type = validateLRequest(input, init, {
    env: {
      ...env,
      V2_PREVIEW_ONLY: "true",
      V2_CONFIRMED_WRITE_ENABLED: "false",
    },
    proof,
    now,
  });
  if (!["health", "read", "read_mcc", "oauth_refresh"].includes(type))
    fail("stage234_l_commit_unapproved_transport_blocked");
  return type;
}
export function claim(root, kind) {
  if (!["write", "mcp_commit"].includes(kind))
    fail("stage234_l_commit_claim_kind_invalid");
  let fd;
  try {
    fd = openSync(join(root, "l-" + kind + ".claim"), "wx", 0o600);
  } catch {
    fail("stage234_l_commit_already_attempted_no_retry");
  }
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        kind,
        preview_id: exactPreview,
        attempted_at: new Date().toISOString(),
      }),
    );
  } finally {
    closeSync(fd);
  }
}
export function installCommitGuard({
  env = process.env,
  nativeFetch = globalThis.fetch,
} = {}) {
  assertCommitRuntime(env);
  const root = env.STAGE234_RUN_DIR;
  if (
    !/^\/acceptance-state\/stage234-l-commit-[A-Za-z0-9_-]+$/.test(root ?? "")
  )
    fail("stage234_l_commit_directory_invalid");
  const identity = canonical({
    root,
    head: env.STAGE234_SOURCE_HEAD,
    image: env.STAGE234_IMAGE_DIGEST,
    harness: env.STAGE234_HARNESS_HEAD,
  });
  if (globalThis.__holyMediaLCommitGuard) {
    if (globalThis.__holyMediaLCommitGuard !== identity)
      fail("stage234_l_commit_guard_identity_changed");
    return;
  }
  globalThis.__holyMediaLCommitGuard = identity;
  globalThis.fetch = async (input, init = {}) => {
    const context = await readAcceptanceContext(
      join(root, "protected-preview-context.json"),
    );
    let authority, proof;
    try {
      authority = protectedJson(join(root, "l-authority.json"));
    } catch {
      /* No approval means no write. */
    }
    try {
      proof = protectedJson(join(root, "l-proof.json"));
    } catch {
      /* Only fixed READ preflight can run before proof. */
    }
    const type = validateCommitRequest(input, init, {
      env,
      context,
      authority,
      proof,
    });
    if (["write", "mcp_commit"].includes(type)) claim(root, type);
    if (["write", "read", "read_mcc", "oauth_refresh"].includes(type))
      appendFileSync(
        join(root, "l-calls.jsonl"),
        JSON.stringify({
          type,
          customer_id:
            type === "read_mcc"
              ? target.mcc
              : type === "oauth_refresh"
                ? null
                : target.customer,
          at: new Date().toISOString(),
        }) + "\n",
        { mode: 0o600 },
      );
    return nativeFetch(input, { ...init, redirect: "error" });
  };
}
if (process.env.STAGE234_L_COMMIT_GUARD_PRELOAD === "1") installCommitGuard();

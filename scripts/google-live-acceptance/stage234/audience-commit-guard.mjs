// Future approved I preview only. One immutable atomic commit, no preview/retry.
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
  queries,
  assertProof,
  validateLiveRequest,
} from "./live-guard.mjs";
import {
  sourceHead,
  imageDigest,
  assertPreparedI,
  stage3Queries,
} from "./audience-preview-guard.mjs";
import { READINESS_SNAPSHOT_QUERIES } from "./targeting-readiness-runner.mjs";
export { target, canonical, digest, queries, READINESS_SNAPSHOT_QUERIES };
export const fail = (code) => {
  throw new Error(code);
};
const { Headers } = globalThis;
const uuid = (value) =>
  typeof value === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
export const expectedTool = {
  name: "google_ads_targeting_preview",
  arguments: {
    provider: "GOOGLE_ADS",
    account_id: target.customer,
    items: [
      {
        operation: "audience_add",
        level: "AD_GROUP",
        campaign_id: target.campaign,
        ad_group_id: target.group,
        audience: { kind: "AFFINITY", id: "90100" },
        mode: "OBSERVATION",
      },
    ],
  },
};
export function protectedJson(file) {
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    stat.size > 2 * 1024 * 1024
  )
    fail("stage234_i_commit_protected_file_invalid");
  return JSON.parse(readFileSync(file, "utf8"));
}
export function assertCommitRuntime(env) {
  const required = {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "false",
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
    STAGE234_I_GUARD_PRELOAD: "0",
    STAGE234_L_GUARD_PRELOAD: "0",
    STAGE234_L_COMMIT_GUARD_PRELOAD: "0",
  };
  if (
    Object.entries(required).some(([k, v]) => env[k] !== v) ||
    env.STAGE234_SOURCE_HEAD !== sourceHead ||
    env.STAGE234_IMAGE_DIGEST !== imageDigest ||
    !/^[a-f0-9]{40}$/.test(env.STAGE234_HARNESS_HEAD ?? "") ||
    !uuid(env.STAGE234_EXPECTED_I_PREVIEW)
  )
    fail("stage234_i_commit_runtime_invalid");
}
export function assertApprovedI(
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
    context.key_id !== key.id ||
    !Number.isFinite(Date.parse(key.expiresAt)) ||
    Date.parse(key.expiresAt) !== Date.parse(context.expires_at) ||
    Date.parse(key.expiresAt) > now + 24 * 60 * 60 * 1000 ||
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
    !Array.isArray(key.scopes) ||
    canonical([...key.scopes].sort()) !==
      canonical(["adforge:mcp:read", "adforge:mcp:write"])
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
    !Number.isFinite(Date.parse(session?.expiresAt)) ||
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
    !uuid(expectedPreview) ||
    context.preview.preview_id !== expectedPreview ||
    stored.operation !== "GOOGLE_STAGE3_TARGETING" ||
    stored.diff?.provider_validation !== "passed" ||
    stored.snapshotDigest !== digest(stored.requestedState) ||
    canonical(stored.beforeState) !== canonical(stored.requestedState?.checks)
  )
    fail("stage234_i_commit_immutable_context_invalid");
  assertPreparedI(stored.requestedState, expectedTool);
  if (
    stored.requestedState.operations.length !== 2 ||
    stored.requestedState.atomic !== true ||
    stored.requestedState.items.length !== 1
  )
    fail("stage234_i_commit_immutable_profile_invalid");
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
    authority.preview_id !== env.STAGE234_EXPECTED_I_PREVIEW ||
    context?.preview?.preview_id !== env.STAGE234_EXPECTED_I_PREVIEW ||
    authority.customer_id !== target.customer ||
    !authority.approval_persisted ||
    !authority.approval_session_valid ||
    !authority.approval_audit_valid ||
    !/^[a-f0-9]{64}$/.test(authority.snapshot_digest ?? "") ||
    !Number.isFinite(Date.parse(authority.expires_at)) ||
    Date.parse(authority.expires_at) <= now
  )
    fail("stage234_i_commit_authority_invalid");
  assertProof(proof, env, now);
}
export function validateCommitRequest(
  input,
  init = {},
  { env, context, authority, proof, plan, now = Date.now() } = {},
) {
  assertCommitRuntime(env);
  if (typeof input !== "string" && !(input instanceof URL))
    fail("stage234_i_commit_request_object_invalid");
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (url.username || url.password || url.search || url.hash)
    fail("stage234_i_commit_url_invalid");
  if (
    url.origin === "http://127.0.0.1:4000" &&
    method === "POST" &&
    url.pathname === "/mcp"
  ) {
    if (
      typeof context?.preview?.preview_token !== "string" ||
      canonical(JSON.parse(init.body)) !==
        canonical({
          jsonrpc: "2.0",
          id: "stage234-I-commit",
          method: "tools/call",
          params: {
            name: "commit_preview",
            arguments: { preview_token: context.preview.preview_token },
          },
        })
    )
      fail("stage234_i_commit_tool_or_token_invalid");
    assertAuthority(authority, context, env, proof, now);
    return "mcp_commit";
  }
  if (url.origin === "https://googleads.googleapis.com") {
    if (
      method !== "POST" ||
      new Headers(init.headers).get("login-customer-id") !== target.mcc
    )
      fail("stage234_i_commit_foreign_transport_invalid");
    const body = JSON.parse(init.body);
    if (url.pathname.endsWith(":mutate")) {
      if (
        url.pathname !== `/v24/customers/${target.customer}/googleAds:mutate` ||
        !plan
      )
        fail("stage234_i_commit_mutation_invalid");
      const expected = {
        ...assertPreparedI(plan, expectedTool),
        validateOnly: false,
      };
      if (
        plan.operations.length !== 2 ||
        plan.atomic !== true ||
        canonical(body) !== canonical(expected) ||
        digest(plan) !== authority?.snapshot_digest
      )
        fail("stage234_i_commit_mutation_payload_invalid");
      assertAuthority(authority, context, env, proof, now);
      return "write";
    }
    if (
      url.pathname ===
        `/v24/customers/${target.customer}/googleAds:searchStream` &&
      canonical(Object.keys(body)) === canonical(["query"]) &&
      [
        ...stage3Queries(expectedTool),
        ...Object.values(READINESS_SNAPSHOT_QUERIES),
      ].includes(body.query)
    )
      return "read";
  }
  const type = validateLiveRequest(input, init, { env });
  if (!["health", "read", "read_mcc", "oauth_refresh"].includes(type))
    fail("stage234_i_commit_extra_transport_invalid");
  return type;
}
export function claim(root, kind) {
  if (!["write", "mcp_commit"].includes(kind))
    fail("stage234_i_commit_claim_kind_invalid");
  let fd;
  try {
    fd = openSync(join(root, "i-" + kind + ".claim"), "wx", 0o600);
  } catch {
    fail("stage234_i_commit_already_attempted_no_retry");
  }
  try {
    writeFileSync(fd, JSON.stringify({ kind, at: new Date().toISOString() }));
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
    !/^\/acceptance-state\/stage234-i-commit-[A-Za-z0-9_-]+$/.test(root ?? "")
  )
    fail("stage234_i_commit_directory_invalid");
  const identity = canonical({
    root,
    source: env.STAGE234_SOURCE_HEAD,
    image: env.STAGE234_IMAGE_DIGEST,
    harness: env.STAGE234_HARNESS_HEAD,
    preview: env.STAGE234_EXPECTED_I_PREVIEW,
  });
  if (globalThis.__holyMediaICommitGuard) {
    if (globalThis.__holyMediaICommitGuard !== identity)
      fail("stage234_i_commit_guard_identity_changed");
    return;
  }
  globalThis.__holyMediaICommitGuard = identity;
  globalThis.fetch = async (input, init = {}) => {
    const context = await readAcceptanceContext(
      join(root, "protected-preview-context.json"),
    );
    let authority, proof;
    try {
      authority = protectedJson(join(root, "i-authority.json"));
    } catch {
      /* No write without authority. */
    }
    try {
      proof = protectedJson(join(root, "i-proof.json"));
    } catch {
      /* Fixed READs only before proof. */
    }
    const plan = protectedJson(join(root, "prepared-i-plan.json"));
    const type = validateCommitRequest(input, init, {
      env,
      context,
      authority,
      proof,
      plan,
    });
    if (["mcp_commit", "write"].includes(type)) claim(root, type);
    if (["write", "read", "read_mcc", "oauth_refresh"].includes(type))
      appendFileSync(
        join(root, "i-calls.jsonl"),
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
if (process.env.STAGE234_I_COMMIT_GUARD_PRELOAD === "1") installCommitGuard();

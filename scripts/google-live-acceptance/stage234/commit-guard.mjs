// N only: this module is never loaded by production or by the preview-only runner.
import {
  appendFileSync,
  closeSync,
  lstatSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
const { Headers } = globalThis;
import {
  target,
  canonical,
  digest,
  validateLiveRequest,
} from "./live-guard.mjs";
export { target, canonical, digest };
export const fail = (code) => {
  throw new Error(code);
};
export const commitPayload = Object.freeze({
  operations: [
    {
      update: { resourceName: target.groupResource, cpcBidMicros: "110000" },
      updateMask: "cpc_bid_micros",
    },
  ],
  validateOnly: false,
  partialFailure: true,
});
export const rollbackPayload = Object.freeze({
  operations: [
    {
      update: { resourceName: target.groupResource, cpcBidMicros: "100000" },
      updateMask: "cpc_bid_micros",
    },
  ],
  validateOnly: true,
  partialFailure: true,
});
export function assertCommitRuntime(env) {
  const required = {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
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
  };
  if (Object.entries(required).some(([k, v]) => env[k] !== v))
    fail("stage234_commit_runtime_not_authorized");
  if (
    !/^[a-f0-9]{40}$/.test(env.STAGE234_SOURCE_HEAD ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.STAGE234_HARNESS_HEAD ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(env.STAGE234_IMAGE_DIGEST ?? "")
  )
    fail("stage234_commit_source_pins_invalid");
}
export function protectedJson(file) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
    fail("stage234_commit_protected_file_invalid");
  return JSON.parse(readFileSync(file, "utf8"));
}
export function assertStoredN(
  { context, stored, account, key, session, approval },
  now = Date.now(),
) {
  const plan = stored?.requestedState,
    op = plan?.operations?.[0];
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
    stored.operation !== "GOOGLE_STAGE2_BID_BUDGET_UPDATE" ||
    plan?.version !== 2 ||
    plan.account_id !== target.customer ||
    plan.operations?.length !== 1 ||
    plan.items?.length !== 1 ||
    op?.kind !== "adGroups" ||
    op.method !== "update" ||
    op.resource_name !== target.groupResource ||
    op.update_mask !== "cpc_bid_micros" ||
    canonical(op.fields) !== canonical(commitPayload.operations[0].update) ||
    op.before?.resourceName !== target.groupResource ||
    String(op.before.cpcBidMicros) !== "100000" ||
    op.before.status !== "PAUSED" ||
    canonical({ ...op.before, cpcBidMicros: "110000" }) !==
      canonical(op.expected) ||
    stored.snapshotDigest !== digest(plan) ||
    stored.diff?.provider_validation !== "passed"
  )
    fail("stage234_commit_immutable_payload_invalid");
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
export function assertCommitProof(proof, env, amount, now = Date.now()) {
  const age = now - Date.parse(proof?.verified_at);
  if (
    proof?.customer_id !== target.customer ||
    proof.mcc_id !== target.mcc ||
    proof.test_account !== true ||
    proof.hierarchy !== true ||
    proof.currency !== "USD" ||
    proof.group_resource !== target.groupResource ||
    proof.group_cpc_micros !== amount ||
    proof.fixture_paused !== true ||
    proof.source_head !== env.STAGE234_SOURCE_HEAD ||
    !/^[a-f0-9]{64}$/.test(proof.fixture_sha256 ?? "") ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 5 * 60000
  )
    fail("stage234_commit_fresh_proof_invalid");
}
function assertAuthority(authority, phase, now) {
  if (
    authority?.phase !== phase ||
    authority.customer_id !== target.customer ||
    !authority.approval_persisted ||
    !authority.approval_session_valid ||
    !authority.approval_audit_valid ||
    !/^[a-f0-9-]{36}$/.test(authority.preview_id ?? "") ||
    !/^[a-f0-9]{64}$/.test(authority.snapshot_digest ?? "") ||
    Date.parse(authority.expires_at) <= now ||
    !Number.isFinite(Date.parse(authority.expires_at))
  )
    fail("stage234_commit_authority_invalid");
}
export function validateCommitRequest(
  input,
  init = {},
  { env, proof, authority, context, now = Date.now() } = {},
) {
  assertCommitRuntime(env);
  if (typeof input !== "string" && !(input instanceof URL))
    fail("stage234_commit_request_object_blocked");
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (url.username || url.password || url.search || url.hash)
    fail("stage234_commit_url_invalid");
  if (url.origin === "http://127.0.0.1:4000") {
    if (method === "GET" && ["/health", "/ready"].includes(url.pathname))
      return "health";
    if (method !== "POST" || url.pathname !== "/mcp")
      fail("stage234_commit_local_route_blocked");
    const rpc = JSON.parse(init.body);
    const commit = {
      jsonrpc: "2.0",
      id: "stage234-N-commit",
      method: "tools/call",
      params: {
        name: "commit_preview",
        arguments: { preview_token: context?.preview?.preview_token },
      },
    };
    const rollback = {
      jsonrpc: "2.0",
      id: "stage234-N-rollback-preview",
      method: "tools/call",
      params: {
        name: "preview_rollback_commit",
        arguments: { commit_id: authority?.commit_id },
      },
    };
    if (
      canonical(rpc) === canonical(commit) &&
      typeof context?.preview?.preview_token === "string"
    ) {
      assertAuthority(authority, "commit", now);
      assertCommitProof(proof, env, "100000", now);
      return "mcp_commit";
    }
    if (
      canonical(rpc) === canonical(rollback) &&
      /^hmc_[A-Za-z0-9_-]{43}$/.test(authority?.commit_id ?? "")
    ) {
      assertAuthority(authority, "rollback", now);
      assertCommitProof(proof, env, "110000", now);
      return "mcp_rollback_preview";
    }
    fail("stage234_commit_unapproved_tool_blocked");
  }
  if (
    url.origin === "https://googleads.googleapis.com" &&
    url.pathname.endsWith(":mutate")
  ) {
    if (
      method !== "POST" ||
      url.pathname !== `/v24/customers/${target.customer}/adGroups:mutate` ||
      new Headers(init.headers).get("login-customer-id") !== target.mcc
    )
      fail("stage234_commit_foreign_mutation_blocked");
    const body = JSON.parse(init.body),
      phase = body.validateOnly === true ? "rollback" : "commit";
    assertAuthority(authority, phase, now);
    assertCommitProof(
      proof,
      env,
      phase === "commit" ? "100000" : "110000",
      now,
    );
    if (
      canonical(body) !==
      canonical(phase === "commit" ? commitPayload : rollbackPayload)
    )
      fail("stage234_commit_payload_or_raw_mutation_blocked");
    return phase === "commit" ? "write" : "validate_only";
  }
  const type = validateLiveRequest(input, init, { env });
  if (!["read", "read_mcc", "oauth_refresh"].includes(type))
    fail("stage234_commit_unapproved_transport_blocked");
  return type;
}
export function claimCommitOperation(root, kind) {
  if (
    !["write", "validate_only", "mcp_commit", "mcp_rollback_preview"].includes(
      kind,
    )
  )
    fail("stage234_commit_claim_kind_invalid");
  let fd;
  try {
    fd = openSync(join(root, `n-${kind}.claim`), "wx", 0o600);
  } catch {
    fail("stage234_commit_already_attempted_no_retry");
  }
  try {
    writeFileSync(
      fd,
      JSON.stringify({ kind, attempted_at: new Date().toISOString() }),
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
  if (!/^\/acceptance-state\/stage234-[A-Za-z0-9_-]+$/.test(root ?? ""))
    fail("stage234_commit_directory_invalid");
  const identity = canonical({
    root,
    source: env.STAGE234_SOURCE_HEAD,
    harness: env.STAGE234_HARNESS_HEAD,
    image: env.STAGE234_IMAGE_DIGEST,
  });
  if (globalThis.__holyMediaNCommitGuard) {
    if (globalThis.__holyMediaNCommitGuard !== identity)
      fail("stage234_commit_guard_identity_changed");
    return;
  }
  globalThis.__holyMediaNCommitGuard = identity;
  globalThis.fetch = async (input, init = {}) => {
    const context = protectedJson(join(root, "protected-preview-context.json"));
    let authority, proof;
    try {
      authority = protectedJson(join(root, "n-authority.json"));
    } catch {
      /* Fixed read-only preflight remains available. */
    }
    try {
      proof = protectedJson(join(root, "n-proof.json"));
    } catch {
      // No proof means no mutation; bounded reads can construct fresh proof.
    }
    const type = validateCommitRequest(input, init, {
      env,
      proof,
      authority,
      context,
    });
    if (
      ["write", "validate_only", "mcp_commit", "mcp_rollback_preview"].includes(
        type,
      )
    )
      claimCommitOperation(root, type);
    if (
      ["write", "validate_only", "read", "read_mcc", "oauth_refresh"].includes(
        type,
      )
    )
      appendFileSync(
        join(root, "n-calls.jsonl"),
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
if (process.env.STAGE234_COMMIT_GUARD_PRELOAD === "1") installCommitGuard();

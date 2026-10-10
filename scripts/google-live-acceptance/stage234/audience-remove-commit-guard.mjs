import { appendFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { readAcceptanceContext } from "./context-vault.mjs";
import {
  assertApprovedStage3,
  assertCommitRuntime,
  claim,
  target,
  canonical,
  digest,
  fail,
  protectedJson,
  READINESS_SNAPSHOT_QUERIES,
} from "./audience-commit-guard.mjs";
import {
  assertRemovePlan,
  removeQueries,
  restoreTool,
} from "./audience-remove-guard.mjs";
import { assertProof, validateLiveRequest } from "./live-guard.mjs";
import { timestampMillis } from "./timestamp.mjs";
export const removedQuery = (origin) => {
  restoreTool(origin);
  return `SELECT ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.ad_group, ad_group_criterion.status, ad_group_criterion.type, ad_group_criterion.user_interest.user_interest_category FROM ad_group_criterion WHERE ad_group_criterion.resource_name = '${origin.created_audience.resource_name}'`;
};
export function assertRemoveApproval(
  binding,
  expectedPreview,
  origin,
  now = Date.now(),
) {
  return {
    ...assertApprovedStage3(
      binding,
      expectedPreview,
      (plan) => assertRemovePlan(plan, origin),
      now,
    ),
    phase: "remove_commit",
  };
}
export function classifyRemoveCommit(
  input,
  init = {},
  { env, context, authority, proof, origin, plan, now = Date.now() } = {},
) {
  assertCommitRuntime(env);
  restoreTool(origin);
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (url.username || url.password || url.search || url.hash)
    fail("stage234_i_remove_commit_url_invalid");
  const authorize = () => {
    if (
      authority?.phase !== "remove_commit" ||
      authority.preview_id !== env.STAGE234_EXPECTED_I_PREVIEW ||
      context?.preview?.preview_id !== authority.preview_id ||
      authority.customer_id !== target.customer ||
      !authority.approval_persisted ||
      !authority.approval_session_valid ||
      !authority.approval_audit_valid ||
      !Number.isFinite(timestampMillis(authority.expires_at)) ||
      timestampMillis(authority.expires_at) <= now ||
      authority.snapshot_digest !== digest(plan)
    )
      fail("stage234_i_remove_commit_authority_invalid");
    assertRemovePlan(plan, origin);
    assertProof(proof, env, now);
  };
  if (
    url.origin === "http://127.0.0.1:4000" &&
    url.pathname === "/mcp" &&
    method === "POST"
  ) {
    if (
      canonical(JSON.parse(init.body)) !==
      canonical({
        jsonrpc: "2.0",
        id: "stage234-I-remove-commit",
        method: "tools/call",
        params: {
          name: "commit_preview",
          arguments: { preview_token: context?.preview?.preview_token },
        },
      })
    )
      fail("stage234_i_remove_commit_tool_invalid");
    authorize();
    return "mcp_commit";
  }
  if (url.origin === "https://googleads.googleapis.com") {
    if (
      method !== "POST" ||
      new Headers(init.headers).get("login-customer-id") !== target.mcc
    )
      fail("stage234_i_remove_commit_transport_invalid");
    const body = JSON.parse(init.body);
    if (url.pathname.endsWith(":mutate")) {
      if (
        url.pathname !== `/v24/customers/${target.customer}/googleAds:mutate` ||
        canonical(body) !==
          canonical({ ...assertRemovePlan(plan, origin), validateOnly: false })
      )
        fail("stage234_i_remove_commit_payload_invalid");
      authorize();
      return "write";
    }
    if (
      url.pathname ===
        `/v24/customers/${target.customer}/googleAds:searchStream` &&
      canonical(Object.keys(body)) === canonical(["query"]) &&
      [
        ...removeQueries,
        ...Object.values(READINESS_SNAPSHOT_QUERIES),
        removedQuery(origin),
      ].includes(body.query)
    )
      return "read";
  }
  const type = validateLiveRequest(input, init, { env });
  if (!["health", "read", "read_mcc", "oauth_refresh"].includes(type))
    fail("stage234_i_remove_commit_extra_transport_invalid");
  return type;
}
export function installRemoveCommitGuard({
  env = process.env,
  nativeFetch = globalThis.fetch,
} = {}) {
  assertCommitRuntime(env);
  const root = env.STAGE234_RUN_DIR;
  if (
    !/^\/acceptance-state\/stage234-i-remove-commit-[A-Za-z0-9_-]+$/.test(
      root ?? "",
    )
  )
    fail("stage234_i_remove_commit_directory_invalid");
  if (globalThis.__hmIRemoveCommitGuard === root) return;
  if (globalThis.__hmIRemoveCommitGuard)
    fail("stage234_i_remove_commit_guard_changed");
  globalThis.__hmIRemoveCommitGuard = root;
  globalThis.fetch = async (input, init = {}) => {
    const context = await readAcceptanceContext(
        join(root, "protected-preview-context.json"),
      ),
      origin = protectedJson(join(root, "i-origin.json")),
      plan = protectedJson(join(root, "prepared-i-remove-plan.json"));
    let authority, proof;
    try {
      authority = protectedJson(join(root, "remove-authority.json"));
    } catch {
      /* no write without fresh approval */
    }
    try {
      proof = protectedJson(join(root, "remove-proof.json"));
    } catch {
      /* only fixed READ before proof */
    }
    const type = classifyRemoveCommit(input, init, {
      env,
      context,
      origin,
      plan,
      authority,
      proof,
    });
    if (["write", "mcp_commit"].includes(type)) claim(root, type);
    if (["read", "read_mcc", "write", "oauth_refresh"].includes(type))
      appendFileSync(
        join(root, "calls.jsonl"),
        JSON.stringify({ type, at: new Date().toISOString() }) + "\n",
        { mode: 0o600 },
      );
    return nativeFetch(input, { ...init, redirect: "error" });
  };
}
if (process.env.STAGE234_I_REMOVE_COMMIT_GUARD_PRELOAD === "1")
  installRemoveCommitGuard();

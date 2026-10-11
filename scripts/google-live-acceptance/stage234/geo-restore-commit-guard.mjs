import { appendFileSync, readFileSync } from "node:fs";
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
import { J_QUERIES } from "./geo-preview-guard.mjs";
import { assertRestoreJPlan, restoreJTool } from "./geo-restore-guard.mjs";
export const removedGeoQueries = (origin) => {
  restoreJTool(origin);
  return origin.created_criteria.map(
    (c) =>
      `SELECT campaign_criterion.resource_name, campaign_criterion.criterion_id, campaign_criterion.campaign, campaign_criterion.status, campaign_criterion.type FROM campaign_criterion WHERE campaign_criterion.resource_name = '${c.resource_name}'`,
  );
};
import { assertProof, validateLiveRequest } from "./live-guard.mjs";
import { timestampMillis } from "./timestamp.mjs";
export function assertRestoreJApproval(
  binding,
  expectedPreview,
  origin,
  now = Date.now(),
) {
  return {
    ...assertApprovedStage3(
      binding,
      expectedPreview,
      (plan) => assertRestoreJPlan(plan, origin),
      now,
    ),
    phase: "j_restore_commit",
  };
}
export function classifyRestoreJCommit(
  input,
  init = {},
  { env, context, authority, proof, origin, plan, now = Date.now() } = {},
) {
  assertCommitRuntime(env);

  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (url.username || url.password || url.search || url.hash)
    fail("stage234_j_restore_commit_url_invalid");
  const authorize = () => {
    if (
      authority?.phase !== "j_restore_commit" ||
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
      fail("stage234_j_restore_commit_authority_invalid");
    assertRestoreJPlan(plan, origin);
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
        id: "stage234-J-restore-commit",
        method: "tools/call",
        params: {
          name: "commit_preview",
          arguments: { preview_token: context?.preview?.preview_token },
        },
      })
    )
      fail("stage234_j_restore_commit_tool_invalid");
    authorize();
    return "mcp_commit";
  }
  if (url.origin === "https://googleads.googleapis.com") {
    if (
      method !== "POST" ||
      new Headers(init.headers).get("login-customer-id") !== target.mcc
    )
      fail("stage234_j_restore_commit_transport_invalid");
    const body = JSON.parse(init.body);
    if (url.pathname.endsWith(":mutate")) {
      if (
        url.pathname !== `/v24/customers/${target.customer}/googleAds:mutate` ||
        canonical(body) !==
          canonical({
            ...assertRestoreJPlan(plan, origin),
            validateOnly: false,
          })
      )
        fail("stage234_j_restore_commit_payload_invalid");
      authorize();
      return "write";
    }
    if (
      url.pathname ===
        `/v24/customers/${target.customer}/googleAds:searchStream` &&
      canonical(Object.keys(body)) === canonical(["query"]) &&
      [
        ...Object.values(J_QUERIES),
        ...removedGeoQueries(origin),
        ...Object.values(READINESS_SNAPSHOT_QUERIES),
      ].includes(body.query)
    )
      return "read";
  }
  const type = validateLiveRequest(input, init, { env });
  if (!["health", "read", "read_mcc", "oauth_refresh"].includes(type))
    fail("stage234_j_restore_commit_extra_transport_invalid");
  return type;
}
export function installRestoreJCommitGuard({
  env = process.env,
  nativeFetch = globalThis.fetch,
} = {}) {
  assertCommitRuntime(env);
  const root = env.STAGE234_RUN_DIR;
  if (
    !/^\/acceptance-state\/stage234-j-restore-commit-[A-Za-z0-9_-]+$/.test(
      root ?? "",
    ) ||
    !/^[a-f0-9]{64}$/.test(env.STAGE234_J_ORIGIN_SHA256 ?? "")
  )
    fail("stage234_j_restore_commit_directory_invalid");
  if (globalThis.__hmJRestoreCommitGuard === root) return;
  if (globalThis.__hmJRestoreCommitGuard)
    fail("stage234_j_restore_commit_guard_changed");
  globalThis.__hmJRestoreCommitGuard = root;
  globalThis.fetch = async (input, init = {}) => {
    if (
      digest(readFileSync(join(root, "j-origin.json"), "utf8")) !==
      env.STAGE234_J_ORIGIN_SHA256
    )
      fail("stage234_j_restore_commit_origin_changed");
    const context = await readAcceptanceContext(
        join(root, "protected-preview-context.json"),
      ),
      plan = protectedJson(join(root, "prepared-j-restore-plan.json")),
      origin = protectedJson(join(root, "j-origin.json"));
    let authority, proof;
    try {
      authority = protectedJson(join(root, "j-authority.json"));
    } catch {
      /* no write without fresh approval */
    }
    try {
      proof = protectedJson(join(root, "j-proof.json"));
    } catch {
      /* only fixed READ before proof */
    }
    const type = classifyRestoreJCommit(input, init, {
      env,
      context,
      plan,
      origin,
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
if (process.env.STAGE234_J_RESTORE_COMMIT_GUARD_PRELOAD === "1")
  installRestoreJCommitGuard();

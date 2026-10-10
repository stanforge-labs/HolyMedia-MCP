// Narrow removal PREVIEW only: exact VERIFIED I origin. No actual removal.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  target,
  canonical,
  digest,
  fail,
  protectedJson,
  READINESS_SNAPSHOT_QUERIES,
} from "./audience-commit-guard.mjs";
import {
  sourceHead,
  imageDigest,
  stage3Queries,
} from "./audience-preview-guard.mjs";
import { expectedTool } from "./audience-commit-guard.mjs";
import {
  assertProof,
  claimValidation,
  validateLiveRequest,
} from "./live-guard.mjs";
export {
  sourceHead,
  imageDigest,
  target,
  canonical,
  digest,
  fail,
  protectedJson,
  READINESS_SNAPSHOT_QUERIES,
};
export const removeQueries = [
  ...stage3Queries(expectedTool).slice(0, 3),
  "SELECT ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.ad_group, ad_group_criterion.type, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.bid_modifier, ad_group_criterion.user_list.user_list, ad_group_criterion.user_interest.user_interest_category, ad_group_criterion.custom_audience.custom_audience, ad_group_criterion.extended_demographic.extended_demographic_id FROM ad_group_criterion WHERE ad_group_criterion.ad_group = 'customers/8590146099/adGroups/206587491811' AND ad_group_criterion.status != 'REMOVED'",
];
export function restoreTool(origin) {
  const created = origin?.created_audience;
  if (
    origin?.result !== "I_ADD_VERIFIED_REMOVE_PENDING" ||
    origin.source_head !== sourceHead ||
    origin.image_digest !== imageDigest ||
    origin.journal?.result !== "VERIFIED" ||
    origin.real_provider_write_call_count !== 0 ||
    !/^hmc_[A-Za-z0-9_-]{43}$/.test(origin.commit_id ?? "") ||
    !/^[1-9][0-9]{0,19}$/.test(created?.criterion_id ?? "") ||
    created.resource_name !==
      `customers/${target.customer}/adGroupCriteria/${target.group}~${created.criterion_id}` ||
    created.audience_resource !==
      `customers/${target.customer}/userInterests/90100` ||
    created.status !== "ENABLED" ||
    created.mode !== "OBSERVATION"
  )
    fail("stage234_i_remove_origin_invalid");
  return {
    name: "google_ads_targeting_preview",
    arguments: {
      provider: "GOOGLE_ADS",
      account_id: target.customer,
      items: [
        {
          operation: "audience_remove",
          level: "AD_GROUP",
          campaign_id: target.campaign,
          ad_group_id: target.group,
          criterion_id: created.criterion_id,
          acknowledge_irreversible: true,
        },
      ],
    },
  };
}
export function assertRemovePlan(plan, origin) {
  const tool = restoreTool(origin),
    op = plan?.operations?.[0];
  if (
    plan?.version !== 3 ||
    plan.account_id !== target.customer ||
    plan.atomic !== false ||
    plan.irreversible !== true ||
    plan.items?.length !== 1 ||
    plan.operations?.length !== 1 ||
    canonical(plan.intent.items) !== canonical(tool.arguments.items) ||
    !Array.isArray(plan.checks) ||
    removeQueries
      .slice(1)
      .some((query) => !plan.checks.some((c) => c.query === query)) ||
    plan.checks.some((c) => !removeQueries.includes(c.query)) ||
    op.kind !== "adGroupCriteria" ||
    op.method !== "remove" ||
    op.resource_name !== origin.created_audience.resource_name ||
    canonical(op.fields) !== "{}" ||
    op.before?.resourceName !== origin.created_audience.resource_name ||
    op.before.adGroup !== target.groupResource ||
    op.before.status !== "ENABLED" ||
    op.before.type !== "USER_INTEREST" ||
    op.before.userInterest?.userInterestCategory !==
      origin.created_audience.audience_resource ||
    op.before.negative === true
  )
    fail("stage234_i_remove_plan_invalid");
  return {
    mutateOperations: [
      { adGroupCriterionOperation: { remove: op.resource_name } },
    ],
    partialFailure: true,
    validateOnly: true,
  };
}
export function assertRemoveRuntime(env) {
  const required = {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "false",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.customer,
    PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: target.mcc,
    PROVIDER_GOOGLE_API_VERSION: "v24",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  };
  if (
    Object.entries(required).some(([k, v]) => env[k] !== v) ||
    env.STAGE234_SOURCE_HEAD !== sourceHead ||
    env.STAGE234_IMAGE_DIGEST !== imageDigest ||
    !/^[a-f0-9]{64}$/.test(env.STAGE234_I_ORIGIN_SHA256 ?? "")
  )
    fail("stage234_i_remove_runtime_invalid");
}
export function classifyRemoveRequest(
  input,
  init = {},
  { env, origin, plan, proof } = {},
) {
  assertRemoveRuntime(env);
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (url.username || url.password || url.search || url.hash)
    fail("stage234_i_remove_url_invalid");
  if (
    url.origin === "http://127.0.0.1:4000" &&
    url.pathname === "/mcp" &&
    method === "POST"
  ) {
    if (
      !plan ||
      canonical(JSON.parse(init.body)) !==
        canonical({
          jsonrpc: "2.0",
          id: "stage234-I-remove-preview",
          method: "tools/call",
          params: restoreTool(origin),
        })
    )
      fail("stage234_i_remove_tool_blocked");
    assertRemovePlan(plan, origin);
    return "mcp_preview";
  }
  if (
    url.origin === "http://127.0.0.1:4001" &&
    url.pathname === "/acceptance/session" &&
    method === "POST" &&
    new Headers(init.headers).get("origin") === "http://localhost:4403" &&
    !new Headers(init.headers).has("authorization") &&
    init.body === "{}"
  )
    return "local_session_precheck";
  if (url.origin === "https://googleads.googleapis.com") {
    if (
      method !== "POST" ||
      new Headers(init.headers).get("login-customer-id") !== target.mcc
    )
      fail("stage234_i_remove_transport_invalid");
    const body = JSON.parse(init.body);
    if (url.pathname.endsWith(":mutate")) {
      if (
        !plan ||
        url.pathname !== `/v24/customers/${target.customer}/googleAds:mutate` ||
        canonical(body) !== canonical(assertRemovePlan(plan, origin))
      )
        fail("stage234_i_remove_real_write_blocked");
      assertProof(proof, env, Date.now());
      return "validate_only";
    }
    if (
      url.pathname ===
        `/v24/customers/${target.customer}/googleAds:searchStream` &&
      canonical(Object.keys(body)) === canonical(["query"]) &&
      [...removeQueries, ...Object.values(READINESS_SNAPSHOT_QUERIES)].includes(
        body.query,
      )
    )
      return "read";
  }
  const type = validateLiveRequest(input, init, { env });
  if (!["health", "read", "read_mcc", "oauth_refresh"].includes(type))
    fail("stage234_i_remove_extra_transport_blocked");
  return type;
}
export function installRemoveGuard({
  env = process.env,
  nativeFetch = globalThis.fetch,
} = {}) {
  assertRemoveRuntime(env);
  const root = env.STAGE234_RUN_DIR;
  if (
    !/^\/acceptance-state\/stage234-i-remove-[A-Za-z0-9_-]+$/.test(root ?? "")
  )
    fail("stage234_i_remove_directory_invalid");
  if (globalThis.__hmIRemoveGuard === root) return;
  if (globalThis.__hmIRemoveGuard) fail("stage234_i_remove_guard_changed");
  globalThis.__hmIRemoveGuard = root;
  globalThis.fetch = async (input, init = {}) => {
    const raw = readFileSync(join(root, "i-origin.json"), "utf8");
    protectedJson(join(root, "i-origin.json"));
    if (digest(raw) !== env.STAGE234_I_ORIGIN_SHA256)
      fail("stage234_i_remove_origin_hash_invalid");
    const origin = JSON.parse(raw);
    restoreTool(origin);
    let plan, proof;
    try {
      plan = protectedJson(join(root, "prepared-i-remove-plan.json"));
    } catch {
      /* No validation without plan. */
    }
    try {
      proof = protectedJson(join(root, "proof.json"));
    } catch {
      /* Fixed READ only without proof. */
    }
    const type = classifyRemoveRequest(input, init, {
      env,
      origin,
      plan,
      proof,
    });
    if (type === "mcp_preview")
      writeFileSync(join(root, "i-remove-preview.claim"), "once", {
        flag: "wx",
        mode: 0o600,
      });
    if (type === "validate_only") claimValidation(root);
    if (["read", "read_mcc", "validate_only", "oauth_refresh"].includes(type))
      appendFileSync(
        join(root, "calls.jsonl"),
        JSON.stringify({ type, at: new Date().toISOString() }) + "\n",
        { mode: 0o600 },
      );
    const response = await nativeFetch(input, { ...init, redirect: "error" });
    if (type === "validate_only")
      writeFileSync(
        join(root, "validation.json"),
        JSON.stringify({
          http_status: response.status,
          validate_only: true,
          partial_failure: true,
          operation_count: 1,
        }),
        { flag: "wx", mode: 0o600 },
      );
    return response;
  };
}
if (process.env.STAGE234_I_REMOVE_GUARD_PRELOAD === "1") installRemoveGuard();

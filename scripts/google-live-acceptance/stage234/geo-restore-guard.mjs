// Preview only: remove two ACTUAL J-created criteria, never original Almaty.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  J_QUERIES,
  classifyJ,
  assertJRuntime,
  sourceHead,
  imageDigest,
  protectedJson,
  target,
  canonical,
  digest,
  fail,
  READINESS_SNAPSHOT_QUERIES,
} from "./geo-preview-guard.mjs";
import { assertProof, claimValidation } from "./live-guard.mjs";
export {
  sourceHead,
  imageDigest,
  protectedJson,
  target,
  canonical,
  digest,
  fail,
  READINESS_SNAPSHOT_QUERIES,
};
export const restoreQueries = [
  J_QUERIES.customer,
  J_QUERIES.campaign,
  J_QUERIES.locations,
  J_QUERIES.proximity,
];
export function restoreJTool(origin) {
  const created = origin?.created_criteria;
  if (
    origin?.result !== "J add VERIFIED; restoration pending" ||
    origin.journal?.result !== "VERIFIED" ||
    origin.commit?.status !== "VERIFIED" ||
    origin.commit_id !== origin.commit.commit_id ||
    origin.preview_id !== origin.commit.preview_id ||
    origin.test_customer_id !== target.customer ||
    created?.length !== 2
  )
    fail("stage234_j_restore_origin_invalid");
  const tool = {
    name: "google_ads_targeting_preview",
    arguments: {
      provider: "GOOGLE_ADS",
      account_id: target.customer,
      items: created.map((c, i) => {
        if (
          !/^[1-9][0-9]{0,19}$/.test(c.criterion_id ?? "") ||
          c.criterion_id === "9235214" ||
          c.resource_name !==
            `customers/${target.customer}/campaignCriteria/${target.campaign}~${c.criterion_id}` ||
          c.type !== (i === 0 ? "LOCATION" : "PROXIMITY") ||
          c.provider_state.resourceName !== c.resource_name ||
          c.provider_state.campaign !==
            `customers/${target.customer}/campaigns/${target.campaign}` ||
          c.provider_state.status !== "ENABLED" ||
          c.provider_state.negative !== (i === 0) ||
          origin.commit.items[i]?.operations?.[0]?.success !== true ||
          origin.commit.items[i].operations[0].resource_name !==
            c.resource_name ||
          canonical(origin.commit.items[i].operations[0].actual) !==
            canonical(c.provider_state)
        )
          fail("stage234_j_restore_created_identity_invalid");
        if (
          i === 0 &&
          c.provider_state.location?.geoTargetConstant !==
            "geoTargetConstants/9196209"
        )
          fail("stage234_j_restore_location_invalid");
        if (
          i === 1 &&
          canonical(c.provider_state.proximity) !==
            canonical({
              geoPoint: {
                latitudeInMicroDegrees: 43186900,
                longitudeInMicroDegrees: 76887000,
              },
              radius: 2,
              radiusUnits: "KILOMETERS",
            })
        )
          fail("stage234_j_restore_proximity_invalid");
        return {
          operation: "criterion_remove",
          level: "CAMPAIGN",
          campaign_id: target.campaign,
          criterion_id: c.criterion_id,
          criterion_type: c.type,
          acknowledge_irreversible: true,
        };
      }),
    },
  };
  if (new Set(created.map((c) => c.resource_name)).size !== 2)
    fail("stage234_j_restore_duplicate_resource");
  return tool;
}
export function assertRestoreJPlan(plan, origin) {
  const tool = restoreJTool(origin);
  if (
    plan?.version !== 3 ||
    plan.account_id !== target.customer ||
    plan.atomic !== false ||
    plan.irreversible !== true ||
    canonical(plan.intent) !==
      canonical({ action: "targeting", items: tool.arguments.items }) ||
    plan.items?.length !== 2 ||
    plan.operations?.length !== 2 ||
    plan.checks?.length !== 4 ||
    new Set(plan.checks.map((c) => c.query)).size !== 4 ||
    plan.checks.some((c) => !restoreQueries.includes(c.query))
  )
    fail("stage234_j_restore_plan_invalid");
  for (const [i, op] of plan.operations.entries())
    if (
      op.kind !== "campaignCriteria" ||
      op.method !== "remove" ||
      op.row !== i ||
      op.resource_name !== origin.created_criteria[i].resource_name ||
      op.update_mask !== null ||
      canonical(op.fields) !== "{}" ||
      canonical(op.expected) !== "{}" ||
      canonical(op.before) !==
        canonical(origin.created_criteria[i].provider_state) ||
      op.read_query !== (i === 0 ? J_QUERIES.locations : J_QUERIES.proximity) ||
      op.response_key !== "campaignCriterion" ||
      plan.items[i].campaign_id !== target.campaign ||
      plan.items[i].ad_group_id !== "" ||
      canonical(plan.items[i].provider_operations) !== canonical([i]) ||
      !plan.items[i].warnings.some((w) => w.includes("необратимо"))
    )
      fail("stage234_j_restore_exact_removal_invalid");
  const city = plan.checks
      .find((c) => c.query === J_QUERIES.locations)
      ?.rows.filter(
        (r) =>
          r.campaignCriterion?.resourceName ===
          `customers/${target.customer}/campaignCriteria/${target.campaign}~9235214`,
      ),
    campaign = plan.checks.find((c) => c.query === J_QUERIES.campaign)?.rows;
  if (
    city?.length !== 1 ||
    city[0].campaignCriterion.negative !== false ||
    city[0].campaignCriterion.status !== "ENABLED" ||
    city[0].campaignCriterion.location.geoTargetConstant !==
      "geoTargetConstants/9235214" ||
    campaign?.length !== 1 ||
    campaign[0].campaign.status !== "PAUSED"
  )
    fail("stage234_j_restore_original_city_or_parent_changed");
  return {
    mutateOperations: origin.created_criteria.map((c) => ({
      campaignCriterionOperation: { remove: c.resource_name },
    })),
    partialFailure: true,
    validateOnly: true,
  };
}
export function classifyRestoreJ(input, init = {}, state = {}) {
  const { env, origin, plan, proof } = state;
  assertJRuntime(env);
  const u = new URL(input),
    method = init.method ?? "GET";
  if (u.search || u.hash || u.username || u.password)
    fail("stage234_j_restore_url_invalid");
  if (u.href === "http://127.0.0.1:4000/mcp" && method === "POST") {
    if (
      canonical(JSON.parse(init.body)) !==
      canonical({
        jsonrpc: "2.0",
        id: "stage234-J-restore-preview",
        method: "tools/call",
        params: restoreJTool(origin),
      })
    )
      fail("stage234_j_restore_commit_approval_or_changed_preview_blocked");
    assertRestoreJPlan(plan, origin);
    assertProof(proof, env);
    return "mcp_preview";
  }
  if (
    u.href ===
      `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:mutate` &&
    method === "POST"
  ) {
    if (
      new Headers(init.headers).get("login-customer-id") !== target.mcc ||
      canonical(JSON.parse(init.body)) !==
        canonical(assertRestoreJPlan(plan, origin))
    )
      fail("stage234_j_restore_real_write_blocked");
    assertProof(proof, env);
    return "validate_only";
  }
  const type = classifyJ(input, init, { env });
  if (
    ![
      "health",
      "read",
      "read_mcc",
      "oauth_refresh",
      "local_session_precheck",
    ].includes(type)
  )
    fail("stage234_j_restore_extra_call_blocked");
  return type;
}
export function installRestoreJGuard({
  env = process.env,
  nativeFetch = globalThis.fetch,
} = {}) {
  assertJRuntime(env);
  const root = env.STAGE234_RUN_DIR;
  if (
    !/^\/acceptance-state\/stage234-j-restore-[A-Za-z0-9_-]+$/.test(
      root ?? "",
    ) ||
    !/^[a-f0-9]{64}$/.test(env.STAGE234_J_ORIGIN_SHA256 ?? "")
  )
    fail("stage234_j_restore_runtime_invalid");
  if (globalThis.__hmJRestoreGuard === root) return;
  if (globalThis.__hmJRestoreGuard) fail("stage234_j_restore_rebind_blocked");
  globalThis.__hmJRestoreGuard = root;
  globalThis.fetch = async (input, init = {}) => {
    if (
      digest(readFileSync(join(root, "j-origin.json"), "utf8")) !==
      env.STAGE234_J_ORIGIN_SHA256
    )
      fail("stage234_j_restore_origin_changed");
    const origin = protectedJson(join(root, "j-origin.json"));
    restoreJTool(origin);
    let plan, proof;
    try {
      plan = protectedJson(join(root, "prepared-j-restore-plan.json"));
    } catch {}
    try {
      proof = protectedJson(join(root, "proof.json"));
    } catch {}
    const type = classifyRestoreJ(input, init, { env, origin, plan, proof });
    if (type === "mcp_preview")
      writeFileSync(join(root, "preview.claim"), "once", {
        flag: "wx",
        mode: 0o600,
      });
    if (type === "validate_only") claimValidation(root);
    if (["read", "read_mcc", "oauth_refresh", "validate_only"].includes(type))
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
          operation_count: 2,
        }),
        { flag: "wx", mode: 0o600 },
      );
    return response;
  };
}
if (process.env.STAGE234_J_RESTORE_GUARD_PRELOAD === "1")
  installRestoreJGuard();

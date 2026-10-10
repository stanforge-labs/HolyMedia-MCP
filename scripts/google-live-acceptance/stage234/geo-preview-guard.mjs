// Exact user-authorized J preparation/preview. No approve, commit or real mutate.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import {
  sourceHead,
  imageDigest,
  protectedJson,
} from "./audience-preview-guard.mjs";
import {
  target,
  canonical,
  digest,
  assertProof,
  claimValidation,
  queries,
} from "./live-guard.mjs";
import { READINESS_SNAPSHOT_QUERIES } from "./targeting-readiness-runner.mjs";
export {
  sourceHead,
  imageDigest,
  target,
  canonical,
  digest,
  protectedJson,
  READINESS_SNAPSHOT_QUERIES,
};
export const fail = (code) => {
  throw Error(code);
};
export const J_TOOL = Object.freeze({
  name: "google_ads_targeting_preview",
  arguments: {
    provider: "GOOGLE_ADS",
    account_id: target.customer,
    items: [
      {
        operation: "geo_add",
        level: "CAMPAIGN",
        campaign_id: target.campaign,
        name: "Almaty",
        country_code: "KZ",
        geo_target_id: "9235214",
      },
      {
        operation: "geo_exclude",
        level: "CAMPAIGN",
        campaign_id: target.campaign,
        name: "Almaly District",
        country_code: "KZ",
        geo_target_id: "9196209",
      },
      {
        operation: "radius_add",
        level: "CAMPAIGN",
        campaign_id: target.campaign,
        latitude: 43.1869,
        longitude: 76.887,
        radius: 2,
        unit: "KILOMETERS",
      },
    ],
  },
});
const geoFields =
  "geo_target_constant.resource_name, geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.country_code, geo_target_constant.target_type, geo_target_constant.status";
export const geoQuery = (id, parents = false) => {
  if (!["9235214", "9196209", "2398", "9070290"].includes(id))
    fail("stage234_j_geo_id_not_authorized");
  return `SELECT ${geoFields}${parents ? ", geo_target_constant.parent_geo_target" : ""} FROM geo_target_constant WHERE geo_target_constant.id = ${id}`;
};
const campaignResource = `customers/${target.customer}/campaigns/${target.campaign}`;
const criterionQuery = (type, fields) =>
  `SELECT campaign_criterion.resource_name, campaign_criterion.criterion_id, campaign_criterion.campaign, campaign_criterion.type, campaign_criterion.status, campaign_criterion.negative, campaign_criterion.bid_modifier, ${fields} FROM campaign_criterion WHERE campaign_criterion.campaign = '${campaignResource}' AND campaign_criterion.status != 'REMOVED' AND campaign_criterion.type IN ('${type}')`;
export const J_QUERIES = Object.freeze({
  customer:
    "SELECT customer.id, customer.resource_name, customer.currency_code, customer.time_zone FROM customer",
  campaign:
    "SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.bidding_strategy, campaign.bidding_strategy_type, campaign.targeting_setting.target_restrictions, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type FROM campaign WHERE campaign.id = 24324170853 AND campaign.status != 'REMOVED'",
  city: geoQuery("9235214"),
  district: geoQuery("9196209"),
  locations: criterionQuery(
    "LOCATION",
    "campaign_criterion.location.geo_target_constant",
  ),
  proximity: criterionQuery(
    "PROXIMITY",
    "campaign_criterion.proximity.geo_point.latitude_in_micro_degrees, campaign_criterion.proximity.geo_point.longitude_in_micro_degrees, campaign_criterion.proximity.radius, campaign_criterion.proximity.radius_units",
  ),
});
export function assertJGeos(geos) {
  for (const id of ["9235214", "9196209", "2398", "9070290"]) {
    const g = geos?.[id];
    if (
      !g ||
      g.id !== id ||
      g.resourceName !== `geoTargetConstants/${id}` ||
      g.countryCode !== "KZ" ||
      g.status !== "ENABLED"
    )
      fail("stage234_j_geo_proof_invalid");
  }
  if (
    geos["9235214"].name !== "Almaty" ||
    geos["9235214"].targetType !== "City" ||
    geos["9235214"].parentGeoTarget !== "geoTargetConstants/2398" ||
    geos["9196209"].name !== "Almaly District" ||
    geos["9196209"].targetType !== "District" ||
    geos["9196209"].parentGeoTarget !== "geoTargetConstants/9235214" ||
    geos["2398"].targetType !== "Country" ||
    geos["9070290"].targetType !== "Province" ||
    geos["9070290"].parentGeoTarget !== "geoTargetConstants/2398"
  )
    fail("stage234_j_geo_parent_or_type_invalid");
  return geos;
}
export function assertPreparedJ(plan) {
  if (
    plan?.version !== 3 ||
    plan.account_id !== target.customer ||
    plan.atomic !== false ||
    plan.irreversible !== false ||
    canonical(plan.intent) !==
      canonical({ action: "targeting", items: J_TOOL.arguments.items }) ||
    plan.items?.length !== 3 ||
    plan.operations?.length !== 3 ||
    !Array.isArray(plan.checks) ||
    plan.checks.length !== Object.keys(J_QUERIES).length ||
    plan.checks.some((c) => !Object.values(J_QUERIES).includes(c.query)) ||
    new Set(plan.checks.map((c) => c.query)).size !== plan.checks.length
  )
    fail("stage234_j_prepared_plan_invalid");
  const fields = [
    {
      campaign: campaignResource,
      status: "ENABLED",
      negative: false,
      location: { geoTargetConstant: "geoTargetConstants/9235214" },
    },
    {
      campaign: campaignResource,
      status: "ENABLED",
      negative: true,
      location: { geoTargetConstant: "geoTargetConstants/9196209" },
    },
    {
      campaign: campaignResource,
      status: "ENABLED",
      negative: false,
      proximity: {
        geoPoint: {
          latitudeInMicroDegrees: 43186900,
          longitudeInMicroDegrees: 76887000,
        },
        radius: 2,
        radiusUnits: "KILOMETERS",
      },
    },
  ];
  for (const [i, op] of plan.operations.entries()) {
    if (
      op.kind !== "campaignCriteria" ||
      op.method !== "create" ||
      op.resource_name !== null ||
      op.update_mask !== null ||
      op.before !== null ||
      op.row !== i ||
      op.response_key !== "campaignCriterion" ||
      op.read_query !== (i === 2 ? J_QUERIES.proximity : J_QUERIES.locations) ||
      canonical(op.fields) !== canonical(fields[i]) ||
      canonical(op.expected) !== canonical(fields[i]) ||
      canonical(plan.items[i].provider_operations) !== canonical([i]) ||
      plan.items[i].before !== null
    )
      fail("stage234_j_exact_operation_invalid");
  }
  const campaign = plan.checks.find(
    (c) => c.query === J_QUERIES.campaign,
  )?.rows;
  if (
    campaign?.length !== 1 ||
    campaign[0].campaign?.resourceName !== campaignResource ||
    campaign[0].campaign.status !== "PAUSED" ||
    campaign[0].campaign.advertisingChannelType !== "SEARCH"
  )
    fail("stage234_j_paused_parent_invalid");
  return {
    mutateOperations: fields.map((create) => ({
      campaignCriterionOperation: { create },
    })),
    partialFailure: true,
    validateOnly: true,
  };
}
export function assertJRuntime(env) {
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
    !/^\/acceptance-state\/stage234-j-[A-Za-z0-9_-]+$/.test(
      env.STAGE234_RUN_DIR ?? "",
    )
  )
    fail("stage234_j_runtime_invalid");
}
export function classifyJ(
  input,
  init = {},
  { env, plan, proof, now = Date.now() } = {},
) {
  assertJRuntime(env);
  const u = new URL(input),
    method = init.method ?? "GET";
  if (u.search || u.hash || u.username || u.password)
    fail("stage234_j_url_blocked");
  if (
    method === "GET" &&
    ["http://127.0.0.1:4000", "http://127.0.0.1:4001"].includes(u.origin) &&
    ["/ready", "/health"].includes(u.pathname)
  )
    return "health";
  if (
    u.href === "http://127.0.0.1:4001/acceptance/session" &&
    method === "POST" &&
    new Headers(init.headers).get("origin") === "http://localhost:4403" &&
    !new Headers(init.headers).has("authorization") &&
    init.body === "{}"
  )
    return "local_session_precheck";
  if (u.href === "http://127.0.0.1:4000/mcp" && method === "POST") {
    if (
      canonical(JSON.parse(init.body)) !==
      canonical({
        jsonrpc: "2.0",
        id: "stage234-J-preview",
        method: "tools/call",
        params: J_TOOL,
      })
    )
      fail("stage234_j_commit_approval_or_alternate_preview_blocked");
    assertPreparedJ(plan);
    assertProof(proof, env, now);
    return "mcp_preview";
  }
  if (
    u.href === "https://oauth2.googleapis.com/token" &&
    method === "POST" &&
    new URLSearchParams(init.body).get("grant_type") === "refresh_token"
  )
    return "oauth_refresh";
  if (
    u.origin !== "https://googleads.googleapis.com" ||
    method !== "POST" ||
    new Headers(init.headers).get("login-customer-id") !== target.mcc
  )
    fail("stage234_j_foreign_transport_blocked");
  const body = JSON.parse(init.body);
  if (u.pathname === `/v24/customers/${target.customer}/googleAds:mutate`) {
    if (canonical(body) !== canonical(assertPreparedJ(plan)))
      fail("stage234_j_real_write_or_changed_payload_blocked");
    assertProof(proof, env, now);
    return "validate_only";
  }
  if (u.pathname === "/v24/geoTargetConstants:suggest") {
    if (
      !["Almaty", "Almaly District"].some(
        (name) =>
          canonical(body) ===
          canonical({
            locale: "ru",
            countryCode: "KZ",
            locationNames: { names: [name] },
          }),
      )
    )
      fail("stage234_j_geo_suggestion_blocked");
    return "read_geo_service";
  }
  if (canonical(Object.keys(body)) !== canonical(["query"]))
    fail("stage234_j_query_payload_blocked");
  if (
    u.pathname === `/v24/customers/${target.mcc}/googleAds:searchStream` &&
    [queries.customer, queries.hierarchy].includes(body.query)
  )
    return "read_mcc";
  const allowed = [
    ...Object.values(J_QUERIES),
    ...Object.values(READINESS_SNAPSHOT_QUERIES),
    ...["9235214", "9196209", "2398", "9070290"].map((id) =>
      geoQuery(id, true),
    ),
    queries.customer,
    queries.group,
  ];
  if (
    u.pathname === `/v24/customers/${target.customer}/googleAds:searchStream` &&
    allowed.includes(body.query)
  )
    return "read";
  fail("stage234_j_query_or_target_blocked");
}
export function installJGuard({
  env = process.env,
  nativeFetch = globalThis.fetch,
} = {}) {
  assertJRuntime(env);
  const root = env.STAGE234_RUN_DIR;
  if (globalThis.__hmJGuard === root) return;
  if (globalThis.__hmJGuard) fail("stage234_j_guard_rebind_blocked");
  globalThis.__hmJGuard = root;
  globalThis.fetch = async (input, init = {}) => {
    let plan, proof;
    try {
      plan = protectedJson(join(root, "prepared-j-plan.json"));
    } catch {
      /* no plan forbids preview/validation */
    }
    try {
      proof = protectedJson(join(root, "proof.json"));
    } catch {
      /* fixed READ only */
    }
    const type = classifyJ(input, init, { env, plan, proof });
    if (type === "mcp_preview")
      writeFileSync(join(root, "j-preview.claim"), "once", {
        flag: "wx",
        mode: 0o600,
      });
    if (type === "validate_only") claimValidation(root);
    if (
      [
        "read",
        "read_mcc",
        "read_geo_service",
        "oauth_refresh",
        "validate_only",
      ].includes(type)
    )
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
          operation_count: 3,
        }),
        { flag: "wx", mode: 0o600 },
      );
    return response;
  };
}
if (process.env.STAGE234_J_GUARD_PRELOAD === "1") installJGuard();

// I only: actual discovery -> stock Stage3 preview. Never commits or approves.
import {
  appendFileSync,
  readFileSync,
  writeFileSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { VERIFIED_L } from "./verified-l-residual.mjs";
import { READINESS_SNAPSHOT_QUERIES } from "./targeting-readiness-runner.mjs";
import {
  target,
  canonical,
  digest,
  sanitized,
  safeError,
  validateLiveRequest,
  assertProof,
  claimValidation,
} from "./live-guard.mjs";
export { target, canonical, digest, sanitized, safeError };
const { Headers } = globalThis;
export const sourceHead = "55d9df3553ff1ad01586978b6e4ecc07913969c5";
export const imageDigest =
  "sha256:2d7cd20cb25c268f74abd16f324d7b92ce5d804989a8de9b3fa062a0ca138d35";
const fail = (code) => {
  throw new Error(code);
};
export function protectedJson(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.mode & 0o077 ||
    stat.size > 2 * 1024 * 1024
  )
    fail("stage234_i_protected_artifact_invalid");
  return JSON.parse(readFileSync(path, "utf8"));
}
export function assertReadiness(raw, env, now = Date.now()) {
  if (
    typeof raw !== "string" ||
    digest(raw) !== env.STAGE234_I_READINESS_SHA256
  )
    fail("stage234_i_readiness_hash_mismatch");
  const artifact = JSON.parse(raw),
    age = now - Date.parse(artifact.timestamp);
  const attestation = artifact.snapshot_attestation,
    residual = artifact.verified_l_residual;
  if (
    attestation?.canonical_format !==
      "sorted_object_keys_sorted_query_rows_v1" ||
    canonical(attestation.query_names) !==
      canonical(Object.keys(READINESS_SNAPSHOT_QUERIES)) ||
    !residual ||
    residual.source_head !== VERIFIED_L.source ||
    residual.harness_head !== VERIFIED_L.harness ||
    residual.preview_id !== VERIFIED_L.preview ||
    residual.commit_id !== VERIFIED_L.commit ||
    residual.sha256 !== VERIFIED_L.sha256 ||
    residual.ad_id !== VERIFIED_L.ad ||
    residual.resource_name !== VERIFIED_L.resource ||
    residual.status !== "PAUSED" ||
    residual.full_delivery_rsa_count !== 4 ||
    residual.original_group_rsa_count !== 2 ||
    residual.full_snapshot_digest !== attestation.sha256
  )
    fail("stage234_i_l_residual_or_snapshot_unproven");
  artifact.full_snapshot_digest = attestation.sha256;
  if (
    artifact.result !== "PASS_READ_ONLY" ||
    artifact.source_head !== sourceHead ||
    artifact.image_digest !== imageDigest ||
    artifact.harness_head !== env.STAGE234_I_READINESS_HARNESS_HEAD ||
    artifact.fixture_unchanged !== true ||
    !/^[a-f0-9]{64}$/.test(artifact.full_snapshot_digest ?? "") ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 5 * 60000 ||
    artifact.real_provider_write_call_count !== 0
  )
    fail("stage234_i_readiness_unproven_or_expired");
  const entry = artifact.discovery?.I?.[env.STAGE234_I_CANDIDATE_KEY];
  if (
    !["IN_MARKET", "AFFINITY", "GLOBAL_IN_MARKET", "GLOBAL_AFFINITY"].includes(
      env.STAGE234_I_CANDIDATE_KEY,
    ) ||
    entry?.result !== "PREPARED_NOT_LIVE" ||
    !entry.candidate ||
    entry.candidate.audience_mode !== "OBSERVATION" ||
    entry.candidate.manual_approval_required !== true ||
    entry.candidate.live_acceptance !== "NOT_RUN"
  )
    fail("stage234_i_no_proven_candidate");
  const request = entry.candidate.preview_request,
    tool = { name: request?.tool, arguments: request?.arguments },
    args = tool.arguments,
    item = args?.items?.[0],
    audience = item?.audience;
  if (
    tool.name !== "google_ads_targeting_preview" ||
    canonical(Object.keys(args ?? {}).sort()) !==
      canonical(["account_id", "items", "provider"]) ||
    args.provider !== "GOOGLE_ADS" ||
    args.account_id !== target.customer ||
    args.items?.length !== 1 ||
    canonical(Object.keys(item ?? {}).sort()) !==
      canonical([
        "ad_group_id",
        "audience",
        "campaign_id",
        "level",
        "mode",
        "operation",
      ]) ||
    item.operation !== "audience_add" ||
    item.level !== "AD_GROUP" ||
    item.campaign_id !== target.campaign ||
    item.ad_group_id !== target.group ||
    item.mode !== "OBSERVATION" ||
    canonical(Object.keys(audience ?? {}).sort()) !==
      canonical(["id", "kind"]) ||
    !["IN_MARKET", "AFFINITY"].includes(audience.kind) ||
    !/^[1-9][0-9]{0,19}$/.test(audience.id) ||
    audience.kind !== env.STAGE234_I_CANDIDATE_KEY.replace("GLOBAL_", "") ||
    audience.id !== env.STAGE234_I_CANDIDATE_ID
  )
    fail("stage234_i_intent_unsafe_or_invented");
  return { artifact, tool };
}
export function assertIRuntime(env) {
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
    STAGE234_GUARD_PRELOAD: "0",
    STAGE234_L_GUARD_PRELOAD: "0",
  };
  if (
    Object.entries(required).some(([k, v]) => env[k] !== v) ||
    env.STAGE234_SOURCE_HEAD !== sourceHead ||
    env.STAGE234_IMAGE_DIGEST !== imageDigest ||
    !/^[a-f0-9]{40}$/.test(env.STAGE234_I_READINESS_HARNESS_HEAD ?? "") ||
    !/^[a-f0-9]{64}$/.test(env.STAGE234_I_READINESS_SHA256 ?? "")
  )
    fail("stage234_i_runtime_invalid");
}
export function stage3Queries(tool) {
  const id = tool.arguments.items[0].audience.id;
  return [
    "SELECT customer.id, customer.resource_name, customer.currency_code, customer.time_zone FROM customer",
    "SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.bidding_strategy, campaign.bidding_strategy_type, campaign.targeting_setting.target_restrictions, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type FROM campaign WHERE campaign.id = 24324170853 AND campaign.status != 'REMOVED'",
    "SELECT ad_group.resource_name, ad_group.id, ad_group.name, ad_group.status, ad_group.campaign, ad_group.targeting_setting.target_restrictions FROM ad_group WHERE ad_group.id = 206587491811 AND ad_group.status != 'REMOVED'",
    `SELECT user_interest.resource_name, user_interest.user_interest_id, user_interest.name, user_interest.taxonomy_type, user_interest.launched_to_all, user_interest.availabilities FROM user_interest WHERE user_interest.user_interest_id = ${id}`,
    "SELECT ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.ad_group, ad_group_criterion.type, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.bid_modifier, ad_group_criterion.user_interest.user_interest_category FROM ad_group_criterion WHERE ad_group_criterion.ad_group = 'customers/8590146099/adGroups/206587491811' AND ad_group_criterion.status != 'REMOVED' AND ad_group_criterion.type IN ('USER_INTEREST')",
  ];
}
export function assertPreparedI(plan, tool) {
  if (
    plan?.version !== 3 ||
    plan.account_id !== target.customer ||
    canonical(plan.intent.items) !== canonical(tool.arguments.items) ||
    plan.irreversible !== false ||
    typeof plan.atomic !== "boolean" ||
    plan.operations?.length < 1 ||
    plan.operations.length > 2 ||
    plan.items?.length !== 1 ||
    !plan.checks?.every((c) => stage3Queries(tool).includes(c.query))
  )
    fail("stage234_i_prepared_plan_invalid");
  const create = plan.operations.filter(
    (o) => o.kind === "adGroupCriteria" && o.method === "create",
  );
  const modeUpdate = plan.operations.some(
    (o) => o.kind === "adGroups" && o.method === "update",
  );
  if (plan.atomic !== modeUpdate) fail("stage234_i_mode_atomicity_invalid");
  const fields = {
    adGroup: target.groupResource,
    status: "ENABLED",
    negative: false,
    userInterest: {
      userInterestCategory: `customers/${target.customer}/userInterests/${tool.arguments.items[0].audience.id}`,
    },
  };
  if (create.length !== 1 || canonical(create[0].fields) !== canonical(fields))
    fail("stage234_i_criterion_payload_invalid");
  for (const op of plan.operations.filter((o) => o !== create[0])) {
    if (
      op.kind !== "adGroups" ||
      op.method !== "update" ||
      op.resource_name !== target.groupResource ||
      op.update_mask !== "targeting_setting.target_restriction_operations" ||
      op.before?.status !== "PAUSED" ||
      canonical(op.fields) !==
        canonical({
          resourceName: target.groupResource,
          targetingSetting: {
            targetRestrictionOperations: [
              {
                operator: "ADD",
                value: { targetingDimension: "AUDIENCE", bidOnly: true },
              },
            ],
          },
        })
    )
      fail("stage234_i_mode_payload_invalid");
  }
  return {
    mutateOperations: plan.operations.map((o) => ({
      [o.kind === "adGroups"
        ? "adGroupOperation"
        : "adGroupCriterionOperation"]: {
        [o.method]: o.fields,
        ...(o.method === "update" ? { updateMask: o.update_mask } : {}),
      },
    })),
    partialFailure: !plan.atomic,
    validateOnly: true,
  };
}
export function validateIRequest(
  input,
  init = {},
  {
    env = process.env,
    readiness,
    plan,
    proof,
    snapshotQueries = [],
    now = Date.now(),
  } = {},
) {
  assertIRuntime(env);
  const { tool } = assertReadiness(readiness, env, now);
  if (typeof input !== "string" && !(input instanceof URL))
    fail("stage234_i_request_object_invalid");
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (url.username || url.password || url.search || url.hash)
    fail("stage234_i_url_invalid");
  if (
    url.origin === "http://127.0.0.1:4000" &&
    method === "POST" &&
    url.pathname === "/mcp"
  ) {
    if (
      !plan ||
      canonical(JSON.parse(init.body)) !==
        canonical({
          jsonrpc: "2.0",
          id: "stage234-I-preview",
          method: "tools/call",
          params: tool,
        })
    )
      fail("stage234_i_commit_approval_or_tool_blocked");
    assertPreparedI(plan, tool);
    return "mcp_preview";
  }
  if (
    url.origin === "http://127.0.0.1:4001" &&
    method === "POST" &&
    url.pathname === "/acceptance/session" &&
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
      fail("stage234_i_foreign_transport_blocked");
    const body = JSON.parse(init.body);
    if (url.pathname.endsWith(":mutate")) {
      if (
        !plan ||
        url.pathname !== `/v24/customers/${target.customer}/googleAds:mutate` ||
        canonical(body) !== canonical(assertPreparedI(plan, tool))
      )
        fail("stage234_i_real_write_or_payload_blocked");
      assertProof(proof, env, now);
      return "validate_only";
    }
    if (
      url.pathname ===
        `/v24/customers/${target.customer}/googleAds:searchStream` &&
      canonical(Object.keys(body)) === canonical(["query"]) &&
      [...stage3Queries(tool), ...Object.values(snapshotQueries)].includes(
        body.query,
      )
    )
      return "read";
  }
  const type = validateLiveRequest(input, init, { env });
  if (!["health", "read", "read_mcc", "oauth_refresh"].includes(type))
    fail("stage234_i_extra_transport_blocked");
  return type;
}
export async function installIGuard({
  env = process.env,
  nativeFetch = globalThis.fetch,
} = {}) {
  assertIRuntime(env);
  const root = env.STAGE234_RUN_DIR;
  if (!/^\/acceptance-state\/stage234-i-[A-Za-z0-9_-]+$/.test(root ?? ""))
    fail("stage234_i_directory_invalid");
  const { READINESS_SNAPSHOT_QUERIES } =
    await import("./targeting-readiness-runner.mjs");
  const identity = canonical({
    root,
    source: env.STAGE234_SOURCE_HEAD,
    image: env.STAGE234_IMAGE_DIGEST,
  });
  if (globalThis.__holyMediaIGuard) {
    if (globalThis.__holyMediaIGuard !== identity)
      fail("stage234_i_guard_identity_changed");
    return;
  }
  globalThis.__holyMediaIGuard = identity;
  globalThis.fetch = async (input, init = {}) => {
    const readiness = readFileSync(
      join(root, "readiness-evidence.json"),
      "utf8",
    );
    let plan, proof;
    try {
      plan = protectedJson(join(root, "prepared-i-plan.json"));
    } catch {
      /* No plan forbids validation. */
    }
    try {
      proof = protectedJson(join(root, "proof.json"));
    } catch {
      /* Fixed READ only until proof. */
    }
    const type = validateIRequest(input, init, {
      env,
      readiness,
      plan,
      proof,
      snapshotQueries: READINESS_SNAPSHOT_QUERIES,
    });
    if (type === "validate_only") claimValidation(root);
    if (["read", "read_mcc", "validate_only", "oauth_refresh"].includes(type))
      appendFileSync(
        join(root, "calls.jsonl"),
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
    const response = await nativeFetch(input, { ...init, redirect: "error" });
    if (type === "validate_only")
      writeFileSync(
        join(root, "validation.json"),
        JSON.stringify({
          validate_only: true,
          partial_failure: !plan.atomic,
          operation_count: plan.operations.length,
          http_status: response.status,
        }),
        { flag: "wx", mode: 0o600 },
      );
    return response;
  };
}
if (process.env.STAGE234_I_GUARD_PRELOAD === "1") await installIGuard();

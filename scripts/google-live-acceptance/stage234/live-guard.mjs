// Isolated acceptance transport only. Never authorizes a real Google mutation.
import {
  appendFileSync,
  closeSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import process from "node:process";
import { URL, URLSearchParams } from "node:url";
const { Headers } = globalThis;

export const target = Object.freeze({
  customer: "8590146099",
  mcc: "4378327049",
  campaign: "24324170853",
  group: "206587491811",
  rsa: "827349040712",
  budget: "15934365976",
  groupResource: "customers/8590146099/adGroups/206587491811",
});
export const originalKeywords = [
  "11743561",
  "334435613703",
  "448674100268",
  "2508260436692",
  "2508260436852",
  "2508260436892",
  "2508260436932",
  "2508260437092",
  "2508260437132",
  "2508260437172",
  "2508260437332",
  "2508260437372",
  "2508260437412",
  "2508260437572",
  "2508260437612",
  "2508260437652",
  "2508260437812",
  "2508260437852",
  "2508260437892",
  "2508260438052",
];
export const queries = Object.freeze({
  customer:
    "SELECT customer.id, customer.test_account, customer.currency_code, customer.time_zone FROM customer",
  currency: "SELECT customer.id, customer.currency_code FROM customer",
  currencyUnit:
    "SELECT currency_constant.resource_name, currency_constant.code, currency_constant.billable_unit_micros FROM currency_constant WHERE currency_constant.code = 'USD'",
  eligibleAudiences:
    "SELECT user_interest.resource_name, user_interest.user_interest_id, user_interest.name, user_interest.taxonomy_type, user_interest.launched_to_all FROM user_interest WHERE user_interest.taxonomy_type IN ('IN_MARKET', 'AFFINITY') AND user_interest.launched_to_all = TRUE LIMIT 10",
  fixtureCampaigns:
    "SELECT campaign.id, campaign.resource_name, campaign.status FROM campaign WHERE campaign.id IN (24324170853, 24339483523)",
  fixtureGroups:
    "SELECT campaign.id, ad_group.id, ad_group.resource_name, ad_group.status FROM ad_group WHERE campaign.id IN (24324170853, 24339483523) AND ad_group.status != REMOVED",
  fixtureAds:
    "SELECT campaign.id, ad_group.id, ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.id FROM ad_group_ad WHERE campaign.id IN (24324170853, 24339483523) AND ad_group_ad.status != REMOVED",
  hierarchy:
    "SELECT customer_client.id, customer_client.level, customer_client.test_account FROM customer_client WHERE customer_client.id = 8590146099",
  campaign:
    "SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.campaign_budget, campaign.bidding_strategy_type, campaign.bidding_strategy, campaign.maximize_conversions.target_cpa_micros FROM campaign WHERE campaign.id = 24324170853",
  group:
    "SELECT campaign.id, ad_group.resource_name, ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, ad_group.target_cpa_micros FROM ad_group WHERE campaign.id = 24324170853 AND ad_group.id = 206587491811",
  keywords:
    "SELECT campaign.id, ad_group.id, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.type FROM ad_group_criterion WHERE campaign.id = 24324170853 AND ad_group.id = 206587491811 AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != REMOVED",
  rsa: "SELECT campaign.id, ad_group.id, ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE campaign.id = 24324170853 AND ad_group.id = 206587491811 AND ad_group_ad.status != REMOVED",
  budget:
    "SELECT campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.delivery_method FROM campaign_budget WHERE campaign_budget.resource_name = 'customers/8590146099/campaignBudgets/15934365976'",
  criteria:
    "SELECT campaign_criterion.resource_name, campaign_criterion.campaign, campaign_criterion.criterion_id, campaign_criterion.type, campaign_criterion.negative, campaign_criterion.status, campaign_criterion.bid_modifier, campaign_criterion.device.type, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant FROM campaign_criterion WHERE campaign.id = 24324170853 AND campaign_criterion.status != REMOVED",
});
export const toolArguments = Object.freeze({
  provider: "GOOGLE_ADS",
  account_id: target.customer,
  items: [
    {
      field: "ad_group_cpc",
      campaign_id: target.campaign,
      ad_group_id: target.group,
      change: { mode: "absolute", amount: "0.11", currency: "USD" },
    },
  ],
});
export const invalidRsaArguments = Object.freeze({
  provider: "GOOGLE_ADS",
  account_id: target.customer,
  action: "rsa_create",
  items: [
    {
      campaign_id: target.campaign,
      ad_group_id: target.group,
      rsa: {
        final_url: "https://mcp.holymedia.kz/",
        headlines: [
          { text: "A".repeat(31) },
          { text: "Holy Media Test" },
          { text: "MCP Test Advertising" },
        ],
        descriptions: [
          { text: "Safe TEST account acceptance only." },
          { text: "Paused fixture. No client advertising." },
        ],
      },
    },
  ],
});
export const validationPayload = Object.freeze({
  operations: [
    {
      update: { resourceName: target.groupResource, cpcBidMicros: "110000" },
      updateMask: "cpc_bid_micros",
    },
  ],
  validateOnly: true,
  partialFailure: true,
});
export const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex");
const blocked = (code) => {
  throw new Error(code);
};
export function assertRuntime(env) {
  if (
    env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED !== "true" ||
    env.PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED !== "true" ||
    env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST !== target.customer ||
    env.PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID !== target.mcc ||
    env.PROVIDER_GOOGLE_API_VERSION !== "v24" ||
    env.V2_PREVIEW_ONLY !== "true" ||
    env.V2_CONFIRMED_WRITE_ENABLED !== "false" ||
    env.PUBLIC_MCP_WRITE_SCOPE_ENABLED !== "false" ||
    env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED !== "false"
  )
    blocked("stage234_runtime_gates_invalid");
  if (
    !/^[a-f0-9]{40}$/.test(env.STAGE234_SOURCE_HEAD ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(env.STAGE234_IMAGE_DIGEST ?? "")
  )
    blocked("stage234_source_pin_invalid");
}
export function assertProof(proof, env, now = Date.now()) {
  const age = now - Date.parse(proof?.verified_at);
  if (
    proof?.customer_id !== target.customer ||
    proof?.mcc_id !== target.mcc ||
    proof?.test_account !== true ||
    proof?.hierarchy !== true ||
    proof?.currency !== "USD" ||
    proof?.group_resource !== target.groupResource ||
    proof?.group_cpc_micros !== "100000" ||
    proof?.fixture_paused !== true ||
    !/^[a-f0-9]{64}$/.test(proof?.fixture_sha256 ?? "") ||
    proof?.source_head !== env.STAGE234_SOURCE_HEAD ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 5 * 60000
  )
    blocked("stage234_fresh_customer_fixture_proof_invalid");
}
export function validateLiveRequest(
  input,
  init = {},
  { env = process.env, proof, now } = {},
) {
  if (typeof input !== "string" && !(input instanceof URL))
    blocked("stage234_request_object_blocked");
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (url.username || url.password || url.search || url.hash)
    blocked("stage234_url_credentials_query_blocked");
  if (
    url.origin === "http://127.0.0.1:4001" &&
    method === "GET" &&
    ["/health", "/ready"].includes(url.pathname)
  )
    return "health";
  if (
    url.origin === "http://127.0.0.1:4001" &&
    url.pathname === "/acceptance/session" &&
    method === "POST" &&
    new Headers(init.headers).get("origin") === "http://localhost:4402" &&
    !new Headers(init.headers).has("authorization") &&
    init.body === "{}"
  )
    return "local_session_precheck";
  if (url.origin === "http://127.0.0.1:4000") {
    if (method === "GET" && ["/health", "/ready"].includes(url.pathname))
      return "health";
    if (method === "POST" && url.pathname === "/mcp") {
      const rpc = JSON.parse(init.body);
      if (
        canonical(rpc) ===
        canonical({
          jsonrpc: "2.0",
          id: "stage234-N-preview",
          method: "tools/call",
          params: {
            name: "google_ads_bid_budget_preview",
            arguments: toolArguments,
          },
        })
      )
        return "mcp_preview";
      if (
        canonical(rpc) ===
        canonical({
          jsonrpc: "2.0",
          id: "stage234-K-invalid-rsa",
          method: "tools/call",
          params: {
            name: "google_ads_ads_assets_preview",
            arguments: invalidRsaArguments,
          },
        })
      )
        return "mcp_invalid_rsa";
    }
    blocked("stage234_approval_commit_or_unapproved_tool_blocked");
  }
  if (
    url.origin === "https://oauth2.googleapis.com" &&
    url.pathname === "/token" &&
    method === "POST"
  ) {
    const body = new URLSearchParams(init.body);
    if (
      body.get("grant_type") !== "refresh_token" ||
      !body.get("refresh_token") ||
      !body.get("client_id") ||
      !body.get("client_secret") ||
      [...body.keys()].some(
        (k) =>
          ![
            "grant_type",
            "refresh_token",
            "client_id",
            "client_secret",
          ].includes(k),
      )
    )
      blocked("stage234_oauth_start_or_exchange_blocked");
    return "oauth_refresh";
  }
  if (
    url.origin !== "https://googleads.googleapis.com" ||
    method !== "POST" ||
    new Headers(init.headers).get("login-customer-id") !== target.mcc
  )
    blocked("stage234_foreign_origin_account_or_login_blocked");
  const body = JSON.parse(init.body);
  if (url.pathname.endsWith(":mutate")) {
    if (
      url.pathname !== `/v24/customers/${target.customer}/adGroups:mutate` ||
      canonical(body) !== canonical(validationPayload)
    )
      blocked("stage234_real_mutation_or_payload_blocked");
    assertRuntime(env);
    assertProof(proof, env, now);
    return "validate_only";
  }
  if (Object.keys(body).length !== 1 || typeof body.query !== "string")
    blocked("stage234_unapproved_query_blocked");
  if (
    url.pathname === `/v24/customers/${target.mcc}/googleAds:searchStream` &&
    [queries.customer, queries.hierarchy].includes(body.query)
  )
    return "read_mcc";
  if (
    url.pathname ===
      `/v24/customers/${target.customer}/googleAds:searchStream` &&
    Object.entries(queries).some(
      ([key, query]) => key !== "hierarchy" && query === body.query,
    )
  )
    return "read";
  blocked("stage234_foreign_customer_or_query_blocked");
}
/** Drop secret fields recursively; arbitrary error messages/URLs are never logged. */
export function sanitized(value) {
  if (Array.isArray(value)) return value.map(sanitized);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          key !== "state" &&
          key !== "approval_url" &&
          !/(token|secret|password|cookie|authorization|encrypted|nonce|code_verifier|oauth_code)/i.test(
            key,
          ),
      )
      .map(([key, v]) => [key, sanitized(v)]),
  );
}
export function safeError(error) {
  const code = String(error?.message ?? "");
  return /^stage234_[a-z0-9_]+$/.test(code)
    ? code
    : "stage234_unclassified_failure_redacted";
}
export function claimValidation(root) {
  let fd;
  try {
    fd = openSync(join(root, "validation.claim"), "wx", 0o600);
  } catch {
    blocked("stage234_validation_already_attempted_no_retry");
  }
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        validate_only: true,
        attempted_at: new Date().toISOString(),
      }),
    );
  } finally {
    closeSync(fd);
  }
}
export function installLiveGuard({
  env = process.env,
  nativeFetch = globalThis.fetch,
} = {}) {
  assertRuntime(env);
  if (globalThis.__holyMediaStage234Guard) return;
  const root = env.STAGE234_RUN_DIR;
  if (!root || !/^\/acceptance-state\/stage234-[a-zA-Z0-9_-]+$/.test(root))
    blocked("stage234_run_directory_invalid");
  globalThis.__holyMediaStage234Guard = true;
  globalThis.fetch = async (input, init = {}) => {
    let proof;
    try {
      proof = JSON.parse(readFileSync(join(root, "proof.json"), "utf8"));
    } catch {
      /* Before proof, bounded read-only transport remains available. */
    }
    const type = validateLiveRequest(input, init, { env, proof });
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
          partial_failure: true,
          operation_count: 1,
          http_status: response.status,
        }),
        { flag: "wx", mode: 0o600 },
      );
    return response;
  };
}
if (process.env.STAGE234_GUARD_PRELOAD === "1") installLiveGuard();

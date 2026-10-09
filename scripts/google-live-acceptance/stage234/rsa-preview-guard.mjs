// L-only preview transport. No real mutation, approval, commit or cancellation.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { URL } from "node:url";
import { plannedRsaArguments } from "./scenario-preparation.mjs";
import {
  target,
  queries,
  canonical,
  digest,
  sanitized,
  safeError,
  assertProof,
  claimValidation,
  validateLiveRequest,
} from "./live-guard.mjs";
export { target, queries, canonical, digest, sanitized, safeError };
const { Headers } = globalThis;
export const tool = plannedRsaArguments(false);
export const createFields = Object.freeze({
  adGroup: target.groupResource,
  status: "PAUSED",
  ad: {
    finalUrls: [tool.arguments.items[0].rsa.final_url],
    responsiveSearchAd: {
      headlines: tool.arguments.items[0].rsa.headlines.map(({ text }) => ({
        text,
      })),
      descriptions: tool.arguments.items[0].rsa.descriptions.map(
        ({ text }) => ({ text }),
      ),
    },
  },
});
export const validationPayload = Object.freeze({
  mutateOperations: [{ adGroupAdOperation: { create: createFields } }],
  partialFailure: true,
  validateOnly: true,
});
export const rsaQueries = Object.freeze({
  customer:
    "SELECT customer.id, customer.resource_name, customer.currency_code, customer.time_zone FROM customer",
  campaign:
    "SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date_time, campaign.end_date_time, campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network, campaign.final_url_suffix, campaign.tracking_url_template FROM campaign WHERE campaign.resource_name = 'customers/8590146099/campaigns/24324170853' AND campaign.status != REMOVED",
  group:
    "SELECT ad_group.resource_name, ad_group.id, ad_group.name, ad_group.campaign, ad_group.status, ad_group.type, ad_group.final_url_suffix, ad_group.tracking_url_template FROM ad_group WHERE ad_group.resource_name = 'customers/8590146099/adGroups/206587491811' AND ad_group.status != REMOVED",
  inventory:
    "SELECT ad_group_ad.resource_name, ad_group_ad.ad_group, ad_group_ad.status, ad_group_ad.ad.resource_name, ad_group_ad.ad.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2 FROM ad_group_ad WHERE ad_group.resource_name = 'customers/8590146099/adGroups/206587491811' AND ad_group_ad.status != REMOVED",
});
const fail = (code) => {
  throw new Error(code);
};
export function assertLRuntime(env) {
  const required = {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.customer,
    PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: target.mcc,
    PROVIDER_GOOGLE_API_VERSION: "v24",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
    STAGE234_GUARD_PRELOAD: "0",
  };
  if (
    Object.entries(required).some(([k, v]) => env[k] !== v) ||
    !/^[a-f0-9]{40}$/.test(env.STAGE234_SOURCE_HEAD ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(env.STAGE234_IMAGE_DIGEST ?? "")
  )
    fail("stage234_l_runtime_invalid");
}
export function validateLRequest(
  input,
  init = {},
  { env = process.env, proof, now } = {},
) {
  assertLRuntime(env);
  if (typeof input !== "string" && !(input instanceof URL))
    fail("stage234_l_request_object_blocked");
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (url.username || url.password || url.search || url.hash)
    fail("stage234_l_url_invalid");
  if (
    url.origin === "http://127.0.0.1:4000" &&
    method === "POST" &&
    url.pathname === "/mcp"
  ) {
    if (
      canonical(JSON.parse(init.body)) ===
      canonical({
        jsonrpc: "2.0",
        id: "stage234-L-preview",
        method: "tools/call",
        params: tool,
      })
    )
      return "mcp_preview";
    fail("stage234_l_approval_commit_or_tool_blocked");
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
      fail("stage234_l_foreign_transport_blocked");
    const body = JSON.parse(init.body);
    if (url.pathname.endsWith(":mutate")) {
      if (
        url.pathname !== `/v24/customers/${target.customer}/googleAds:mutate` ||
        canonical(body) !== canonical(validationPayload)
      )
        fail("stage234_l_real_mutation_or_payload_blocked");
      assertProof(proof, env, now);
      return "validate_only";
    }
    if (
      url.pathname ===
        `/v24/customers/${target.customer}/googleAds:searchStream` &&
      canonical(Object.keys(body)) === canonical(["query"]) &&
      Object.values(rsaQueries).includes(body.query)
    )
      return "read";
  }
  // Fixed preflight inventories, health and refresh only. N/K calls and mutation
  // are explicitly excluded even though the shared classifier knows them.
  const type = validateLiveRequest(input, init, { env });
  if (!["read", "read_mcc", "health", "oauth_refresh"].includes(type))
    fail("stage234_l_unapproved_transport_blocked");
  return type;
}
export function assertLPreview(preview) {
  const item = preview?.items?.[0];
  if (
    preview?.status !== "preview" ||
    preview.provider !== "GOOGLE_ADS" ||
    preview.account_id !== target.customer ||
    preview.operation_count !== 1 ||
    preview.provider_validation !== "passed" ||
    preview.partial_failure !== true ||
    preview.atomic !== false ||
    preview.items?.length !== 1 ||
    item.campaign_id !== target.campaign ||
    item.ad_group_id !== target.group ||
    item.before !== null ||
    canonical(item.after) !== canonical(createFields) ||
    !/^[a-f0-9-]{36}$/.test(preview.preview_id ?? "") ||
    Date.parse(preview.expires_at) <= Date.now() + 60000 ||
    !/^http:\/\/localhost:4403\/mcp\/approve#[A-Za-z0-9_-]+$/.test(
      preview.approval_url ?? "",
    )
  )
    fail("stage234_l_preview_semantics_invalid");
}
export function assertStoredL(stored, account, key) {
  const plan = stored?.requestedState,
    op = plan?.operations?.[0];
  if (
    !stored ||
    stored.confirmedAt ||
    stored.consumedAt ||
    stored.cancelledAt ||
    stored.accountId !== account.id ||
    stored.serviceTokenId !== key.id ||
    stored.provider !== "GOOGLE_ADS" ||
    stored.commitStatus !== "PREVIEWED" ||
    plan?.version !== 4 ||
    plan.account_id !== target.customer ||
    plan.intent?.action !== "rsa_create" ||
    canonical(plan.intent.items) !== canonical(tool.arguments.items) ||
    plan.atomic !== false ||
    plan.irreversible !== false ||
    plan.operations?.length !== 1 ||
    op.kind !== "adGroupAds" ||
    op.method !== "create" ||
    op.resource_name !== null ||
    op.before !== null ||
    op.update_mask !== null ||
    op.read_query !== rsaQueries.inventory ||
    canonical(op.fields) !== canonical(createFields) ||
    canonical(op.expected) !== canonical(createFields) ||
    stored.snapshotDigest !== digest(plan)
  )
    fail("stage234_l_persisted_immutable_preview_invalid");
}
export function installLGuard({
  env = process.env,
  nativeFetch = globalThis.fetch,
} = {}) {
  assertLRuntime(env);
  const root = env.STAGE234_RUN_DIR;
  if (!/^\/acceptance-state\/stage234-l-[A-Za-z0-9_-]+$/.test(root ?? ""))
    fail("stage234_l_directory_invalid");
  const identity = canonical({
    root,
    head: env.STAGE234_SOURCE_HEAD,
    image: env.STAGE234_IMAGE_DIGEST,
  });
  if (globalThis.__holyMediaLGuard) {
    if (globalThis.__holyMediaLGuard !== identity)
      fail("stage234_l_guard_identity_changed");
    return;
  }
  globalThis.__holyMediaLGuard = identity;
  globalThis.fetch = async (input, init = {}) => {
    let proof;
    try {
      proof = JSON.parse(readFileSync(join(root, "proof.json"), "utf8"));
    } catch {
      // No proof permits only fixed read-only preflight, never validation.
    }
    const type = validateLRequest(input, init, { env, proof });
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
if (process.env.STAGE234_L_GUARD_PRELOAD === "1") installLGuard();

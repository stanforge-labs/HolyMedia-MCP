// Acceptance-only, fail-closed transport: no mutate/validate-only/OAuth start path.
import { appendFileSync } from "node:fs";
const nativeFetch = globalThis.fetch;
const customer = "8590146099",
  prefix = `customers/${customer}`;
export const proofQuery =
  "SELECT customer.id, customer.test_account, customer.currency_code, customer.time_zone FROM customer";
export const fixtureResources = Object.freeze({
  campaign_budget: [`${prefix}/campaignBudgets/15934365976`],
  campaign: [`${prefix}/campaigns/24324170853`],
  campaign_criterion: [
    `${prefix}/campaignCriteria/24324170853~9235214`,
    `${prefix}/campaignCriteria/24324170853~1031`,
  ],
  ad_group: [`${prefix}/adGroups/206587491811`],
  ad_group_criterion: [
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
  ].map((id) => `${prefix}/adGroupCriteria/206587491811~${id}`),
  ad_group_ad: [`${prefix}/adGroupAds/206587491811~827349040712`],
});
export function validateReconcileRequest(input, init = {}) {
  const url = new URL(
    typeof input === "string" ? input : (input.url ?? String(input)),
  );
  const method = (init.method ?? input.method ?? "GET").toUpperCase();
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("reconcile_origin_blocked");
  // Normal vault credential refresh only, not a new OAuth authorization flow.
  if (
    url.hostname === "oauth2.googleapis.com" &&
    url.pathname === "/token" &&
    method === "POST"
  ) {
    const body = new URLSearchParams(init.body);
    if (body.get("grant_type") !== "refresh_token")
      throw new Error("reconcile_oauth_start_blocked");
    return "oauth_refresh";
  }
  if (
    url.hostname !== "googleads.googleapis.com" ||
    url.pathname !== `/v24/customers/${customer}/googleAds:searchStream` ||
    method !== "POST" ||
    new Headers(init.headers).get("login-customer-id") !== "4378327049"
  )
    throw new Error("reconcile_write_or_account_blocked");
  const body = JSON.parse(init.body);
  if (
    Object.keys(body).join(",") !== "query" ||
    typeof body.query !== "string" ||
    /;/.test(body.query)
  )
    throw new Error("reconcile_query_blocked");
  if (body.query === proofQuery) return "read";
  const match = body.query.match(
    /^SELECT [a-z_0-9., ]+ FROM ([a-z_]+) WHERE \1\.resource_name IN \(([^)]+)\)$/,
  );
  const allowed = fixtureResources[match?.[1]];
  if (
    !allowed ||
    !match[2]
      .split(", ")
      .every(
        (name) => /^'[^']+'$/.test(name) && allowed.includes(name.slice(1, -1)),
      )
  )
    throw new Error("reconcile_unapproved_resource_blocked");
  return "read";
}
globalThis.fetch = async (input, init = {}) => {
  const type = validateReconcileRequest(input, init);
  appendFileSync(
    `${process.env.ACCEPTANCE_STATE_DIR ?? "/acceptance-state"}/provider-counts.jsonl`,
    JSON.stringify({
      type,
      customer: type === "read" ? customer : null,
      purpose: "read_only_budget_reconciliation",
    }) + "\n",
    { mode: 0o600 },
  );
  return nativeFetch(input, { ...init, redirect: "error" });
};



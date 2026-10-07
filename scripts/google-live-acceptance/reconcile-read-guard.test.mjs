import { test } from "node:test";
import assert from "node:assert/strict";
const { validateReconcileRequest, fixtureResources, proofQuery } =
  await import("./reconcile-read-guard.mjs");
const endpoint =
  "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:searchStream";
const request = (query) => ({
  method: "POST",
  headers: { "login-customer-id": "4378327049" },
  body: JSON.stringify({ query }),
});
test("only canonical TEST proof and exact already-created resource rereads allowed", () => {
  assert.equal(validateReconcileRequest(endpoint, request(proofQuery)), "read");
  assert.equal(
    validateReconcileRequest(
      endpoint,
      request(
        `SELECT ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2 FROM ad_group_ad WHERE ad_group_ad.resource_name IN ('${fixtureResources.ad_group_ad[0]}')`,
      ),
    ),
    "read",
  );
  for (const [table, names] of Object.entries(fixtureResources)) {
    assert.equal(
      validateReconcileRequest(
        endpoint,
        request(
          `SELECT ${table}.resource_name FROM ${table} WHERE ${table}.resource_name IN (${names.map((name) => `'${name}'`).join(", ")})`,
        ),
      ),
      "read",
    );
  }
});
test("all mutates including validate-only, MCC/foreign account/data queries blocked", () => {
  for (const suffix of [
    "googleAds:mutate",
    "campaigns:mutate",
    "campaignBudgets:mutate",
  ]) {
    assert.throws(() =>
      validateReconcileRequest(
        endpoint.replace("googleAds:searchStream", suffix),
        {
          ...request(proofQuery),
          body: JSON.stringify({ validateOnly: true }),
        },
      ),
    );
  }
  for (const id of ["4378327049", "1234567890"])
    assert.throws(() =>
      validateReconcileRequest(
        endpoint.replace("8590146099", id),
        request(proofQuery),
      ),
    );
  assert.throws(() =>
    validateReconcileRequest(
      endpoint,
      request("SELECT campaign.id FROM campaign"),
    ),
  );
  assert.throws(() =>
    validateReconcileRequest(
      endpoint,
      request(
        "SELECT campaign.resource_name FROM campaign WHERE campaign.resource_name IN ('customers/8590146099/campaigns/999')",
      ),
    ),
  );
  assert.throws(() =>
    validateReconcileRequest(
      endpoint,
      request(
        "SELECT campaign.resource_name FROM campaign WHERE campaign.resource_name IN ('customers/8590146099/campaigns/24324170853') OR campaign.id = 999",
      ),
    ),
  );
  assert.throws(() =>
    validateReconcileRequest(endpoint, {
      ...request(proofQuery),
      headers: { "login-customer-id": "1234567890" },
    }),
  );
});
test("credential refresh allowed, authorization-code exchange and redirect ambiguity blocked", () => {
  assert.equal(
    validateReconcileRequest("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "synthetic_test_only",
      }),
    }),
    "oauth_refresh",
  );
  assert.throws(() =>
    validateReconcileRequest("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "synthetic_test_only",
      }),
    }),
  );
  assert.throws(() =>
    validateReconcileRequest(
      endpoint + "?customer=1234567890",
      request(proofQuery),
    ),
  );
});

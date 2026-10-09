import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { plannedRsaArguments } from "./scenario-preparation.mjs";
import {
  tool,
  createFields,
  validationPayload,
  rsaQueries,
  validateLRequest,
  assertLPreview,
  assertStoredL,
  canonical,
  digest,
} from "./rsa-preview-guard.mjs";
import { claimValidation } from "./live-guard.mjs";
const { structuredClone } = globalThis;
const env = {
  PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
  PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
  PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
  PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true",
  GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
  PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: "4378327049",
  PROVIDER_GOOGLE_API_VERSION: "v24",
  V2_PREVIEW_ONLY: "true",
  V2_CONFIRMED_WRITE_ENABLED: "false",
  PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
  PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  STAGE234_GUARD_PRELOAD: "0",
  STAGE234_SOURCE_HEAD: "a".repeat(40),
  STAGE234_IMAGE_DIGEST: "sha256:" + "b".repeat(64),
};
const now = Date.now();
const proof = {
  customer_id: "8590146099",
  mcc_id: "4378327049",
  test_account: true,
  hierarchy: true,
  currency: "USD",
  group_resource: "customers/8590146099/adGroups/206587491811",
  group_cpc_micros: "100000",
  fixture_paused: true,
  fixture_sha256: "c".repeat(64),
  source_head: env.STAGE234_SOURCE_HEAD,
  verified_at: new Date(now).toISOString(),
};
const request = (
  payload = validationPayload,
  url = "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:mutate",
) =>
  validateLRequest(
    url,
    {
      method: "POST",
      headers: { "login-customer-id": "4378327049" },
      body: JSON.stringify(payload),
    },
    { env, proof, now },
  );
const preview = () => ({
  status: "preview",
  provider: "GOOGLE_ADS",
  account_id: "8590146099",
  operation_count: 1,
  provider_validation: "passed",
  partial_failure: true,
  atomic: false,
  items: [
    {
      campaign_id: "24324170853",
      ad_group_id: "206587491811",
      before: null,
      after: createFields,
    },
  ],
  preview_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  expires_at: new Date(Date.now() + 240000).toISOString(),
  approval_url: "http://localhost:4403/mcp/approve#intendednonce",
});
const stored = () => {
  const plan = {
    version: 4,
    account_id: "8590146099",
    intent: tool.arguments,
    atomic: false,
    irreversible: false,
    operations: [
      {
        kind: "adGroupAds",
        method: "create",
        resource_name: null,
        before: null,
        update_mask: null,
        read_query: rsaQueries.inventory,
        fields: createFields,
        expected: createFields,
      },
    ],
  };
  return {
    confirmedAt: null,
    consumedAt: null,
    cancelledAt: null,
    accountId: "account",
    serviceTokenId: "key",
    provider: "GOOGLE_ADS",
    commitStatus: "PREVIEWED",
    requestedState: plan,
    snapshotDigest: digest(plan),
  };
};
test("L exact planned RSA is PAUSED and the sole exact validation allowed", () => {
  assert.deepEqual(tool, plannedRsaArguments(false));
  assert.equal(createFields.status, "PAUSED");
  assert.equal(request(), "validate_only");
  for (const mutate of [
    { ...validationPayload, validateOnly: false },
    { ...validationPayload, partialFailure: false },
    { ...validationPayload, mutateOperations: [] },
    { ...validationPayload, other: "secret" },
  ])
    assert.throws(() => request(mutate));
  const changed = structuredClone(validationPayload);
  changed.mutateOperations[0].adGroupAdOperation.create.status = "ENABLED";
  assert.throws(() => request(changed));
});
test("L account/ownership proof and bounded fixed READ reject foreign/raw queries", () => {
  assert.throws(() =>
    request(
      validationPayload,
      "https://googleads.googleapis.com/v24/customers/4378327049/googleAds:mutate",
    ),
  );
  assert.throws(() =>
    validateLRequest(
      "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:mutate",
      {
        method: "POST",
        headers: { "login-customer-id": "4378327049" },
        body: JSON.stringify(validationPayload),
      },
      { env, proof: { ...proof, test_account: false }, now },
    ),
  );
  for (const query of Object.values(rsaQueries))
    assert.equal(
      validateLRequest(
        "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:searchStream",
        {
          method: "POST",
          headers: { "login-customer-id": "4378327049" },
          body: JSON.stringify({ query }),
        },
        { env },
      ),
      "read",
    );
  assert.throws(() =>
    validateLRequest(
      "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:searchStream",
      {
        method: "POST",
        headers: { "login-customer-id": "4378327049" },
        body: JSON.stringify({ query: "SELECT campaign.id FROM campaign" }),
      },
      { env },
    ),
  );
});
test("L stock MCP preview only; no approval, commit, cancellation or alternate intent", () => {
  const url = "http://127.0.0.1:4000/mcp",
    rpc = {
      jsonrpc: "2.0",
      id: "stage234-L-preview",
      method: "tools/call",
      params: tool,
    };
  assert.equal(
    validateLRequest(
      url,
      { method: "POST", body: JSON.stringify(rpc) },
      { env },
    ),
    "mcp_preview",
  );
  for (const name of [
    "commit_preview",
    "cancel_preview",
    "google_ads_bid_budget_preview",
  ])
    assert.throws(() =>
      validateLRequest(
        url,
        {
          method: "POST",
          body: JSON.stringify({ ...rpc, params: { ...tool, name } }),
        },
        { env },
      ),
    );
  for (const path of ["/api/v1/mcp/public/approval", "/mcp/approve"])
    assert.throws(() =>
      validateLRequest(
        "http://127.0.0.1:4000" + path,
        { method: "POST", body: "{}" },
        { env },
      ),
    );
});
test("L persisted immutable create and preview require exact semantic payload", () => {
  assertLPreview(preview());
  assertStoredL(stored(), { id: "account" }, { id: "key" });
  for (const change of [
    { confirmedAt: new Date() },
    { consumedAt: new Date() },
    { cancelledAt: new Date() },
    { snapshotDigest: "f".repeat(64) },
  ])
    assert.throws(() =>
      assertStoredL(
        { ...stored(), ...change },
        { id: "account" },
        { id: "key" },
      ),
    );
  for (const change of [
    { approval_url: "https://evil.invalid/#secret" },
    { items: [{ ...preview().items[0], before: {} }] },
    { expires_at: new Date().toISOString() },
  ])
    assert.throws(() => assertLPreview({ ...preview(), ...change }));
  assert.equal(
    canonical(stored().requestedState.operations[0].fields),
    canonical(createFields),
  );
});
test("L validation claim prevents automatic retry before network and unsafe runtime blocked", () => {
  const dir = mkdtempSync(join(tmpdir(), "hm-L-"));
  claimValidation(dir);
  assert.throws(() => claimValidation(dir));
  assert.throws(() =>
    validateLRequest(
      "http://127.0.0.1:4000/ready",
      {},
      { env: { ...env, V2_CONFIRMED_WRITE_ENABLED: "true" } },
    ),
  );
});

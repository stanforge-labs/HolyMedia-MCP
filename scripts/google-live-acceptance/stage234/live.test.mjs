import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  target,
  queries,
  originalKeywords,
  toolArguments,
  validationPayload,
  validateLiveRequest,
  assertProof,
  assertRuntime,
  canonical,
  sanitized,
  safeError,
  claimValidation,
} from "./live-guard.mjs";
import {
  assertFixture,
  assertPreview,
  makeCheckpoint,
} from "./live-runner.mjs";

const env = {
  PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
  PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "true",
  GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.customer,
  PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: target.mcc,
  PROVIDER_GOOGLE_API_VERSION: "v24",
  V2_PREVIEW_ONLY: "true",
  V2_CONFIRMED_WRITE_ENABLED: "false",
  PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
  PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  STAGE234_SOURCE_HEAD: "a".repeat(40),
  STAGE234_IMAGE_DIGEST: "sha256:" + "b".repeat(64),
};
const now = Date.parse("2026-10-09T12:00:00Z"),
  proof = {
    customer_id: target.customer,
    mcc_id: target.mcc,
    test_account: true,
    hierarchy: true,
    currency: "USD",
    group_resource: target.groupResource,
    group_cpc_micros: "100000",
    fixture_paused: true,
    fixture_sha256: "c".repeat(64),
    source_head: env.STAGE234_SOURCE_HEAD,
    verified_at: new Date(now).toISOString(),
  };
const endpoint = `https://googleads.googleapis.com/v24/customers/${target.customer}/adGroups:mutate`;
const req = (body) => ({
  method: "POST",
  headers: { "login-customer-id": target.mcc },
  body: JSON.stringify(body),
});
const check = (url, body, opts = {}) =>
  validateLiveRequest(url, req(body), { env, proof, now, ...opts });

test("exact CPC preview and validateOnly=true allowed; real write never reaches transport", () => {
  assert.equal(check(endpoint, validationPayload), "validate_only");
  for (const value of [false, undefined, "true", 1])
    assert.throws(
      () => check(endpoint, { ...validationPayload, validateOnly: value }),
      /real_mutation/,
    );
  let calls = 0;
  const mocked = async (url, init) => {
    validateLiveRequest(url, init, { env, proof, now });
    calls++;
  };
  return assert
    .rejects(
      mocked(endpoint, req({ ...validationPayload, validateOnly: false })),
    )
    .then(() => assert.equal(calls, 0));
});
test("changed fields, masks, amounts, partialFailure and duplicate operation blocked", () => {
  for (const body of [
    { ...validationPayload, partialFailure: false },
    {
      ...validationPayload,
      operations: [
        ...validationPayload.operations,
        ...validationPayload.operations,
      ],
    },
    {
      ...validationPayload,
      operations: [
        {
          update: {
            resourceName: target.groupResource,
            cpcBidMicros: "110001",
          },
          updateMask: "cpc_bid_micros",
        },
      ],
    },
    {
      ...validationPayload,
      operations: [
        {
          update: {
            resourceName: target.groupResource,
            cpcBidMicros: "110000",
            status: "ENABLED",
          },
          updateMask: "cpc_bid_micros,status",
        },
      ],
    },
    { ...validationPayload, responseContentType: "RESOURCE" },
  ])
    assert.throws(() => check(endpoint, body));
});
test("foreign/MCC targets, wrong login and URLs fail closed", () => {
  for (const url of [
    endpoint.replace(target.customer, target.mcc),
    endpoint.replace(target.customer, "1111111111"),
    endpoint.replace("adGroups", "adGroupCriteria"),
    endpoint + "?token=redacted",
    endpoint.replace("https://", "https://hidden@"),
    endpoint.replace("https:", "http:"),
  ])
    assert.throws(() => check(url, validationPayload));
  assert.throws(() =>
    validateLiveRequest(
      endpoint,
      {
        ...req(validationPayload),
        headers: { "login-customer-id": "1111111111" },
      },
      { env, proof, now },
    ),
  );
});
test("fresh TRUE customer/hierarchy/USD/source/paused proof required", () => {
  assertProof(proof, env, now);
  for (const replacement of [
    { test_account: false },
    { test_account: "true" },
    { hierarchy: false },
    { customer_id: target.mcc },
    { mcc_id: "1111111111" },
    { currency: "KZT" },
    { group_cpc_micros: "100001" },
    { fixture_paused: false },
    { source_head: "d".repeat(40) },
    { verified_at: new Date(now - 300001).toISOString() },
    { verified_at: new Date(now + 1).toISOString() },
  ])
    assert.throws(() =>
      check(endpoint, validationPayload, {
        proof: { ...proof, ...replacement },
      }),
    );
  assert.throws(() => check(endpoint, validationPayload, { proof: undefined }));
});
test("OFF/widened/inverted flags fail without bypass", () => {
  assertRuntime(env);
  for (const [key, value] of Object.entries({
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099,4378327049",
    V2_PREVIEW_ONLY: "false",
    V2_CONFIRMED_WRITE_ENABLED: "true",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "true",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_API_VERSION: "v23",
    STAGE234_SOURCE_HEAD: "latest",
  }))
    assert.throws(() =>
      check(endpoint, validationPayload, { env: { ...env, [key]: value } }),
    );
});
test("only fixed targeted SELECT queries, no extra customer discovery", () => {
  for (const [key, query] of Object.entries(queries)) {
    const customer = key === "hierarchy" ? target.mcc : target.customer;
    assert.equal(
      check(
        `https://googleads.googleapis.com/v24/customers/${customer}/googleAds:searchStream`,
        { query },
      ),
      key === "hierarchy" ? "read_mcc" : "read",
    );
  }
  for (const query of [
    "SELECT campaign.id FROM campaign",
    queries.group + "; SELECT customer.id FROM customer",
    queries.customer + " LIMIT 1",
  ])
    assert.throws(() =>
      check(
        `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:searchStream`,
        { query },
      ),
    );
  assert.throws(() =>
    check(
      "https://googleads.googleapis.com/v24/customers:listAccessibleCustomers",
      {},
    ),
  );
});
test("local preview exact; approval/commit and altered arguments denied", () => {
  const rpc = {
    jsonrpc: "2.0",
    id: "stage234-N-preview",
    method: "tools/call",
    params: { name: "google_ads_bid_budget_preview", arguments: toolArguments },
  };
  assert.equal(check("http://127.0.0.1:4000/mcp", rpc), "mcp_preview");
  for (const name of [
    "commit_preview",
    "confirm_preview",
    "preview_rollback_commit",
    "create_campaign_from_brief",
  ])
    assert.throws(() =>
      check("http://127.0.0.1:4000/mcp", {
        ...rpc,
        params: { ...rpc.params, name },
      }),
    );
  assert.throws(() =>
    check("http://127.0.0.1:4000/api/v1/mcp/previews/confirm", {}),
  );
  assert.throws(() =>
    check("http://127.0.0.1:4000/mcp", {
      ...rpc,
      params: {
        ...rpc.params,
        arguments: { ...toolArguments, status: "ENABLED" },
      },
    }),
  );
});
test("only normal vault refresh, no fresh OAuth code/start", () => {
  const init = {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: "synthetic",
      client_id: "synthetic",
      client_secret: "synthetic",
    }).toString(),
  };
  assert.equal(
    validateLiveRequest("https://oauth2.googleapis.com/token", init),
    "oauth_refresh",
  );
  assert.throws(() =>
    validateLiveRequest("https://oauth2.googleapis.com/token", {
      ...init,
      body: "grant_type=authorization_code&code=synthetic",
    }),
  );
});
test("exclusive validation claim survives interrupted runs; no automatic retry", () => {
  const root = mkdtempSync(join(tmpdir(), "stage234-claim-"));
  claimValidation(root);
  assert.equal(
    JSON.parse(readFileSync(join(root, "validation.claim"))).validate_only,
    true,
  );
  assert.throws(() => claimValidation(root), /already_attempted/);
});
test("secret keys/raw error text omitted while evidence state preserved", () => {
  assert.deepEqual(
    sanitized({
      provider_state_before: {
        status: "PAUSED",
        access_token: "synthetic",
        nested: { client_secret: "synthetic" },
      },
      state: "synthetic",
      cookie: "synthetic",
      encryptedPayload: "synthetic",
    }),
    { provider_state_before: { status: "PAUSED", nested: {} } },
  );
  assert.equal(
    safeError(new Error("HTTP failed Authorization Bearer synthetic")),
    "stage234_unclassified_failure_redacted",
  );
  assert.equal(
    safeError(new Error("stage234_fixture_group_changed")),
    "stage234_fixture_group_changed",
  );
});

const fixture = () => ({
  campaign: [
    {
      campaign: {
        id: target.campaign,
        resourceName: `customers/${target.customer}/campaigns/${target.campaign}`,
        name: "HM_MCP_WRITE_ACCEPTANCE_20261007T134837Z",
        status: "PAUSED",
        campaignBudget: `customers/${target.customer}/campaignBudgets/${target.budget}`,
        biddingStrategyType: "MANUAL_CPC",
      },
    },
  ],
  group: [
    {
      campaign: { id: target.campaign },
      adGroup: {
        id: target.group,
        resourceName: target.groupResource,
        status: "PAUSED",
        cpcBidMicros: "100000",
        targetCpaMicros: "0",
      },
    },
  ],
  budget: [
    {
      campaignBudget: {
        resourceName: `customers/${target.customer}/campaignBudgets/${target.budget}`,
        amountMicros: "2000000",
        explicitlyShared: false,
      },
    },
  ],
  rsa: [
    {
      campaign: { id: target.campaign },
      adGroup: { id: target.group },
      adGroupAd: {
        resourceName: `customers/${target.customer}/adGroupAds/${target.group}~${target.rsa}`,
        status: "PAUSED",
        ad: { type: "RESPONSIVE_SEARCH_AD" },
      },
    },
  ],
  keywords: [...originalKeywords, "11479221"].map((id) => ({
    campaign: { id: target.campaign },
    adGroup: { id: target.group },
    adGroupCriterion: {
      resourceName: `customers/${target.customer}/adGroupCriteria/${target.group}~${id}`,
      criterionId: id,
      type: "KEYWORD",
      status: id === "11479221" ? "PAUSED" : "ENABLED",
    },
  })),
  criteria: [
    {
      campaignCriterion: {
        type: "LOCATION",
        location: { geoTargetConstant: "geoTargetConstants/9235214" },
      },
    },
    {
      campaignCriterion: {
        type: "LANGUAGE",
        language: { languageConstant: "languageConstants/1031" },
      },
    },
  ],
});
const preview = () => ({
  status: "preview",
  provider: "GOOGLE_ADS",
  account_id: target.customer,
  operation_count: 1,
  provider_validation: "passed",
  preview_id: "16224a43-2389-4062-9ffb-766a9abaf1d3",
  expires_at: new Date(Date.now() + 60000).toISOString(),
  items: [
    {
      campaign_id: target.campaign,
      ad_group_id: target.group,
      before: { ...fixture().group[0].adGroup, currency: "USD" },
      after: {
        ...fixture().group[0].adGroup,
        cpcBidMicros: "110000",
        currency: "USD",
      },
    },
  ],
});
test("fixture proof includes original20+pausedresidual and paused delivery entities", () => {
  assertFixture(fixture());
  for (const change of [
    (snapshot) => (snapshot.group[0].adGroup.status = "ENABLED"),
    (snapshot) => (snapshot.group[0].adGroup.cpcBidMicros = "110000"),
    (snapshot) => (snapshot.keywords[0].adGroupCriterion.status = "PAUSED"),
    (snapshot) => (snapshot.rsa[0].adGroupAd.status = "ENABLED"),
    (snapshot) =>
      snapshot.criteria.push({ campaignCriterion: { negative: true } }),
  ]) {
    const snapshot = fixture();
    change(snapshot);
    assert.throws(() => assertFixture(snapshot));
  }
});
test("truthful exact preview BEFORE100000 AFTER110000 and immutable snapshot checkpoint", () => {
  const p = preview();
  assertPreview(p);
  const wrong = structuredClone(p);
  wrong.items[0].after.status = "ENABLED";
  assert.throws(() => assertPreview(wrong));
  const before = fixture(),
    after = structuredClone(before);
  const checkpoint = makeCheckpoint({
    preview: p,
    before,
    after,
    events: [{ type: "read" }, { type: "read_mcc" }, { type: "validate_only" }],
    sourceHead: env.STAGE234_SOURCE_HEAD,
    imageDigest: env.STAGE234_IMAGE_DIGEST,
  });
  assert.equal(checkpoint.before_after_unchanged, true);
  assert.equal(checkpoint.provider_read_call_count, 2);
  assert.equal(checkpoint.validate_only_call_count, 1);
  assert.equal(checkpoint.real_provider_write_call_count, 0);
  assert.equal(checkpoint.committed, false);
  assert.equal(
    canonical(checkpoint.provider_state_before),
    canonical(checkpoint.provider_state_after_preview),
  );
  assert.equal(JSON.stringify(checkpoint).includes("hmpp_"), false);
});
test("runner uses stock HTTP MCP/main image, never raw adapter mutation or approval", () => {
  const source = readFileSync(
    new URL("./live-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /\/workspace\/apps\/api\/dist\/main\.js/);
  assert.match(source, /http:\/\/127\.0\.0\.1:4000\/mcp/);
  assert.doesNotMatch(source, /adapter\.(?:mutate|stage2)\(/);
  assert.doesNotMatch(
    source,
    /name:\s*["'](?:commit_preview|confirm_preview)["']/,
  );
});

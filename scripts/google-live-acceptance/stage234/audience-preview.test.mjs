import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import {
  sourceHead,
  imageDigest,
  assertReadiness,
  assertPreparedI,
  stage3Queries,
  validateIRequest,
  digest,
  target,
} from "./audience-preview-guard.mjs";
import { READINESS_SNAPSHOT_QUERIES } from "./targeting-readiness-runner.mjs";
import { VERIFIED_L } from "./verified-l-residual.mjs";
const { structuredClone } = globalThis;
const now = Date.now();
const tool = {
  name: "google_ads_targeting_preview",
  arguments: {
    provider: "GOOGLE_ADS",
    account_id: target.customer,
    items: [
      {
        operation: "audience_add",
        level: "AD_GROUP",
        campaign_id: target.campaign,
        ad_group_id: target.group,
        audience: { kind: "IN_MARKET", id: "123" },
        mode: "OBSERVATION",
      },
    ],
  },
};
const artifact = () => ({
  result: "PASS_READ_ONLY",
  source_head: sourceHead,
  harness_head: "b".repeat(40),
  image_digest: imageDigest,
  fixture_unchanged: true,
  real_provider_write_call_count: 0,
  timestamp: new Date(now).toISOString(),
  snapshot_attestation: {
    canonical_format: "sorted_object_keys_sorted_query_rows_v1",
    query_names: Object.keys(READINESS_SNAPSHOT_QUERIES),
    sha256: "c".repeat(64),
  },
  verified_l_residual: {
    source_head: VERIFIED_L.source,
    harness_head: VERIFIED_L.harness,
    preview_id: VERIFIED_L.preview,
    commit_id: VERIFIED_L.commit,
    sha256: VERIFIED_L.sha256,
    ad_id: VERIFIED_L.ad,
    resource_name: VERIFIED_L.resource,
    status: "PAUSED",
    full_delivery_rsa_count: 4,
    original_group_rsa_count: 2,
    full_snapshot_digest: "c".repeat(64),
  },
  discovery: {
    I: {
      IN_MARKET: {
        result: "PREPARED_NOT_LIVE",
        candidate: {
          source_head: sourceHead,
          audience_mode: "OBSERVATION",
          manual_approval_required: true,
          live_acceptance: "NOT_RUN",
          preview_request: { tool: tool.name, arguments: tool.arguments },
        },
      },
    },
  },
});
const env = (raw) => ({
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
  STAGE234_SOURCE_HEAD: sourceHead,
  STAGE234_IMAGE_DIGEST: imageDigest,
  STAGE234_I_READINESS_HARNESS_HEAD: "b".repeat(40),
  STAGE234_I_READINESS_SHA256: digest(raw),
  STAGE234_I_CANDIDATE_KEY: "IN_MARKET",
  STAGE234_I_CANDIDATE_ID: "123",
});
const plan = () => ({
  version: 3,
  account_id: target.customer,
  intent: tool.arguments,
  atomic: true,
  irreversible: false,
  items: [{}],
  checks: stage3Queries(tool).map((query) => ({ query, rows: [] })),
  operations: [
    {
      kind: "adGroups",
      method: "update",
      resource_name: target.groupResource,
      update_mask: "targeting_setting.target_restriction_operations",
      before: { resourceName: target.groupResource, status: "PAUSED" },
      fields: {
        resourceName: target.groupResource,
        targetingSetting: {
          targetRestrictionOperations: [
            {
              operator: "ADD",
              value: { targetingDimension: "AUDIENCE", bidOnly: true },
            },
          ],
        },
      },
    },
    {
      kind: "adGroupCriteria",
      method: "create",
      fields: {
        adGroup: target.groupResource,
        status: "ENABLED",
        negative: false,
        userInterest: {
          userInterestCategory: "customers/8590146099/userInterests/123",
        },
      },
    },
  ],
});
test("only actual protected readiness candidate + exact SHA/source/image/harness/L snapshot attestation accepted", () => {
  const raw = JSON.stringify(artifact());
  assert.deepEqual(assertReadiness(raw, env(raw), now).tool, tool);
  for (const mutate of [
    (a) => (a.timestamp = new Date(now - 300001).toISOString()),
    (a) => (a.result = "BLOCKED"),
    (a) => (a.verified_l_residual.ad_id = "999"),
    (a) => a.snapshot_attestation.query_names.pop(),
    (a) => delete a.discovery.I.IN_MARKET.candidate,
  ]) {
    const bad = artifact();
    mutate(bad);
    const text = JSON.stringify(bad);
    assert.throws(() => assertReadiness(text, env(text), now));
  }
  assert.throws(() =>
    assertReadiness(
      raw,
      { ...env(raw), STAGE234_I_READINESS_SHA256: "f".repeat(64) },
      now,
    ),
  );
});
test("TARGETING, unknown/invented/foreign IDs or unexpected fields cannot substitute approved readiness intent", () => {
  for (const mutate of [
    (t) => (t.arguments.items[0].mode = "TARGETING"),
    (t) => (t.arguments.account_id = "9999999999"),
    (t) => (t.arguments.items[0].ad_group_id = "999"),
    (t) => (t.arguments.items[0].audience.id = "0"),
    (t) => (t.arguments.items[0].bid_modifier = 1.1),
  ]) {
    const bad = artifact();
    const t = structuredClone(tool);
    mutate(t);
    bad.discovery.I.IN_MARKET.candidate.preview_request = {
      tool: t.name,
      arguments: t.arguments,
    };
    const raw = JSON.stringify(bad);
    assert.throws(() => assertReadiness(raw, env(raw), now));
  }
});
test("prepared exact owned OBSERVATION parent ADD and audience create; no device/bid/other-account operation", () => {
  assert.equal(assertPreparedI(plan(), tool).validateOnly, true);
  for (const mutate of [
    (p) =>
      (p.operations[0].fields.targetingSetting.targetRestrictionOperations[0].value.bidOnly = false),
    (p) => (p.operations[1].fields.adGroup = "customers/9999999999/adGroups/1"),
    (p) => (p.operations[1].fields.bidModifier = 1.1),
    (p) =>
      (p.operations[1].fields.userInterest.userInterestCategory =
        "customers/8590146099/userInterests/999"),
    (p) => p.operations.push(p.operations[1]),
  ]) {
    const bad = plan();
    mutate(bad);
    assert.throws(() => assertPreparedI(bad, tool));
  }
});
test("exact stock preview and exact validateOnly only; commit/approval/raw mutation rejected", () => {
  const raw = JSON.stringify(artifact()),
    p = plan(),
    opts = {
      env: env(raw),
      readiness: raw,
      plan: p,
      now,
      proof: {
        customer_id: target.customer,
        mcc_id: target.mcc,
        test_account: true,
        hierarchy: true,
        currency: "USD",
        group_resource: target.groupResource,
        group_cpc_micros: "100000",
        fixture_paused: true,
        fixture_sha256: "c".repeat(64),
        source_head: sourceHead,
        verified_at: new Date(now).toISOString(),
      },
    };
  const rpc = {
    jsonrpc: "2.0",
    id: "stage234-I-preview",
    method: "tools/call",
    params: tool,
  };
  assert.equal(
    validateIRequest(
      "http://127.0.0.1:4000/mcp",
      { method: "POST", body: JSON.stringify(rpc) },
      opts,
    ),
    "mcp_preview",
  );
  for (const name of ["commit_preview", "cancel_preview", "approve_preview"])
    assert.throws(() =>
      validateIRequest(
        "http://127.0.0.1:4000/mcp",
        {
          method: "POST",
          body: JSON.stringify({ ...rpc, params: { ...tool, name } }),
        },
        opts,
      ),
    );
  const payload = assertPreparedI(p, tool),
    init = (body) => ({
      method: "POST",
      headers: { "login-customer-id": target.mcc },
      body: JSON.stringify(body),
    }),
    url =
      "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:mutate";
  assert.equal(validateIRequest(url, init(payload), opts), "validate_only");
  assert.throws(() =>
    validateIRequest(url, init({ ...payload, validateOnly: false }), opts),
  );
  assert.throws(() =>
    validateIRequest(
      url.replace(target.customer, target.mcc),
      init(payload),
      opts,
    ),
  );
});
test("preparation and fixture match precede API/JIT; runner never approves/commits", () => {
  const src = readFileSync(
    new URL("./audience-preview-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    src.indexOf("stage234_i_fresh_fixture_stale") <
      src.indexOf("server = spawn"),
  );
  assert.ok(
    src.indexOf('save("prepared-i-plan.json"') < src.indexOf('"I_JIT_preview"'),
  );
  assert.equal((src.match(/"stage234-I-preview"/g) ?? []).length, 1);
  for (const forbidden of [
    '"commit_preview"',
    '"cancel_preview"',
    '"approve_preview"',
  ])
    assert.ok(!src.includes(forbidden));
});

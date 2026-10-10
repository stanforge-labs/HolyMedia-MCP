import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  J_TOOL,
  J_QUERIES,
  assertPreparedJ,
  assertJGeos,
  classifyJ,
  sourceHead,
  imageDigest,
  target,
  digest,
} from "./geo-preview-guard.mjs";
import { assertJFixture, safeJError } from "./geo-preview-runner.mjs";
const { tsImport } = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
)("tsx/esm/api");
const now = Date.parse("2026-10-11T00:00:00Z");
const env = {
  STAGE234_SOURCE_HEAD: sourceHead,
  STAGE234_IMAGE_DIGEST: imageDigest,
  STAGE234_RUN_DIR: "/acceptance-state/stage234-j-mock",
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
const proof = {
  customer_id: target.customer,
  mcc_id: target.mcc,
  test_account: true,
  hierarchy: true,
  currency: "USD",
  group_resource: target.groupResource,
  group_cpc_micros: "100000",
  fixture_paused: true,
  fixture_sha256: "a".repeat(64),
  source_head: sourceHead,
  verified_at: new Date(now).toISOString(),
};
const geoProof = () =>
  Object.fromEntries(
    [
      ["9235214", "City", "Almaty", "2398"],
      ["9196209", "District", "Almaly District", "9235214"],
      ["2398", "Country", "Kazakhstan", null],
      ["9070290", "Province", "Almaty Region", "2398"],
    ].map(([id, targetType, name, parent]) => [
      id,
      {
        id,
        resourceName: `geoTargetConstants/${id}`,
        targetType,
        name,
        canonicalName: name,
        countryCode: "KZ",
        status: "ENABLED",
        ...(parent ? { parentGeoTarget: `geoTargetConstants/${parent}` } : {}),
      },
    ]),
  );
async function planFixture({ duplicateCity = false } = {}) {
  const { buildStage3Plan } = await tsImport(
    "../../../apps/api/src/providers/google-ads-stage3.ts",
    import.meta.url,
  );
  const customer = {
    id: target.customer,
    resourceName: `customers/${target.customer}`,
    currencyCode: "USD",
    timeZone: "Asia/Almaty",
  };
  const campaign = {
    id: target.campaign,
    resourceName: `customers/${target.customer}/campaigns/${target.campaign}`,
    name: "MOCK paused fixture",
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    biddingStrategyType: "MANUAL_CPC",
  };
  const g = geoProof(),
    reads = [],
    suggest = [];
  const read = async (q) => {
    reads.push(q);
    if (q === J_QUERIES.customer) return [{ customer }];
    if (q === J_QUERIES.campaign) return [{ campaign }];
    if (q === J_QUERIES.city) return [{ geoTargetConstant: g["9235214"] }];
    if (q === J_QUERIES.district) return [{ geoTargetConstant: g["9196209"] }];
    if (q === J_QUERIES.locations)
      return [
        {
          campaignCriterion: {
            resourceName: `customers/${target.customer}/campaignCriteria/${target.campaign}~9235214`,
            criterionId: "9235214",
            campaign: campaign.resourceName,
            type: "LOCATION",
            status: "ENABLED",
            negative: false,
            location: { geoTargetConstant: "geoTargetConstants/9235214" },
          },
        },
      ];
    if (q === J_QUERIES.proximity) return [];
    assert.fail("Unmanifested mock read: " + q);
  };
  const p = await buildStage3Plan(
    target.customer,
    {
      action: "targeting",
      items: duplicateCity
        ? [
            {
              operation: "geo_add",
              level: "CAMPAIGN",
              campaign_id: target.campaign,
              name: "Almaty",
              country_code: "KZ",
              geo_target_id: "9235214",
            },
            ...J_TOOL.arguments.items,
          ]
        : J_TOOL.arguments.items,
    },
    read,
    async (name, country) => {
      suggest.push({ name, country });
      return [
        { geoTargetConstant: g[name === "Almaty" ? "9235214" : "9196209"] },
      ];
    },
  );
  return { plan: p, reads, suggest };
}
const request = (url, body) => [
  url,
  {
    method: "POST",
    headers: { "login-customer-id": target.mcc },
    body: JSON.stringify(body),
  },
];
const mutate = `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:mutate`;
test("J actual stock builder preserves existing city and yields only district/radius creates with frozen inventory", async () => {
  const { plan, reads, suggest } = await planFixture();
  const payload = assertPreparedJ(plan);
  assert.equal(payload.validateOnly, true);
  assert.equal(payload.partialFailure, true);
  assert.equal(payload.mutateOperations.length, 2);
  assert.deepEqual(suggest, [{ name: "Almaly District", country: "KZ" }]);
  assert.deepEqual(
    new Set(reads),
    new Set(Object.values(J_QUERIES).filter((q) => q !== J_QUERIES.city)),
  );
  assert.equal(
    classifyJ(...request(mutate, payload), { env, plan, proof, now }),
    "validate_only",
  );
  assert.equal(plan.items[0].before, null);
  assert.equal(plan.items[0].after.negative, true);
  assert.equal(
    plan.items[1].after.proximity.geoPoint.latitudeInMicroDegrees,
    43186900,
  );
  assert.equal(
    plan.items[1].after.proximity.geoPoint.longitudeInMicroDegrees,
    76887000,
  );
  assert.equal(plan.items[1].after.proximity.radius, 2);
});
test("J reproduces real existing-city duplicate rejection; no silent create/remove or guard bypass", async () => {
  await assert.rejects(
    planFixture({ duplicateCity: true }),
    /Targeting criterion уже существует/,
  );
  const { plan } = await planFixture();
  assert.ok(
    plan.operations.every(
      (op) =>
        op.fields.location?.geoTargetConstant !== "geoTargetConstants/9235214",
    ),
  );
  for (const change of [
    (p) => p.checks.find((c) => c.query === J_QUERIES.locations).rows.splice(0),
    (p) => {
      p.checks.find(
        (c) => c.query === J_QUERIES.locations,
      ).rows[0].campaignCriterion.negative = true;
    },
    (p) => {
      p.checks.find(
        (c) => c.query === J_QUERIES.locations,
      ).rows[0].campaignCriterion.status = "PAUSED";
    },
  ]) {
    const p = structuredClone(plan);
    change(p);
    assert.throws(() => assertPreparedJ(p));
  }
});
test("J exact city/district/country chain rejects wrong parent, country, type, status or resource identity", () => {
  assertJGeos(geoProof());
  for (const change of [
    (g) => (g["9196209"].parentGeoTarget = "geoTargetConstants/9070290"),
    (g) => (g["9235214"].parentGeoTarget = "geoTargetConstants/9070290"),
    (g) => (g["9235214"].targetType = "Province"),
    (g) => (g["2398"].countryCode = "US"),
    (g) => (g["9196209"].status = "REMOVAL_PLANNED"),
    (g) => (g["9235214"].resourceName = "geoTargetConstants/9063099"),
  ]) {
    const g = geoProof();
    change(g);
    assert.throws(() => assertJGeos(g));
  }
});
test("J plan cannot alter coordinates, radius, negatives, parent, update mask, status or operation set", async () => {
  const { plan } = await planFixture();
  for (const change of [
    (p) => (p.operations[0].fields.negative = false),
    (p) => (p.operations[1].fields.proximity.radius = 3),
    (p) => p.operations[1].fields.proximity.geoPoint.latitudeInMicroDegrees++,
    (p) =>
      (p.operations[0].fields.campaign = "customers/9999999999/campaigns/1"),
    (p) => (p.operations[0].method = "update"),
    (p) => (p.operations[0].update_mask = "status"),
    (p) => (p.operations[0].fields.status = "PAUSED"),
    (p) => p.operations.push(p.operations[0]),
    (p) => (p.atomic = true),
    (p) => p.checks.pop(),
    (p) => (p.items[1].provider_operations = [0]),
  ]) {
    const p = structuredClone(plan);
    change(p);
    assert.throws(() => assertPreparedJ(p));
  }
});
test("J preview transport forbids commit, approval, real writes, foreign account/MCC, modified input and unproven validation", async () => {
  const { plan } = await planFixture();
  const state = { env, plan, proof, now },
    payload = assertPreparedJ(plan);
  const rpc = {
    jsonrpc: "2.0",
    id: "stage234-J-preview",
    method: "tools/call",
    params: J_TOOL,
  };
  assert.equal(
    classifyJ(...request("http://127.0.0.1:4000/mcp", rpc), state),
    "mcp_preview",
  );
  const altered = structuredClone(rpc);
  altered.params.arguments.items[1].radius = 3;
  for (const args of [
    request(mutate, { ...payload, validateOnly: false }),
    request(mutate.replace(target.customer, target.mcc), payload),
    request("http://127.0.0.1:4000/mcp", {
      ...rpc,
      params: {
        name: "commit_preview",
        arguments: { preview_token: "MOCK_ONLY" },
      },
    }),
    request("http://127.0.0.1:4001/api/v1/mcp/public/approval", {}),
    request("http://127.0.0.1:4000/mcp", altered),
    request("https://googleads.googleapis.com/v24/geoTargetConstants:suggest", {
      locale: "ru",
      countryCode: "KZ",
      locationNames: { names: ["Other city"] },
    }),
  ])
    assert.throws(() => classifyJ(...args, state));
  assert.throws(() =>
    classifyJ(...request(mutate, payload), {
      ...state,
      proof: { ...proof, test_account: false },
    }),
  );
  assert.throws(() =>
    classifyJ(...request(mutate, payload), { ...state, now: now + 300001 }),
  );
  assert.throws(() =>
    classifyJ(...request(mutate, payload), {
      ...state,
      env: { ...env, V2_CONFIRMED_WRITE_ENABLED: "true" },
    }),
  );
  assert.throws(() =>
    classifyJ(...request(mutate, payload), {
      ...state,
      env: { ...env, GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.mcc },
    }),
  );
});
test("J READ and suggest endpoints are closed manifests; no raw alternate body or another account", () => {
  for (const q of Object.values(J_QUERIES))
    assert.equal(
      classifyJ(
        ...request(
          `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:searchStream`,
          { query: q },
        ),
        { env },
      ),
      "read",
    );
  assert.equal(
    classifyJ(
      ...request(
        "https://googleads.googleapis.com/v24/geoTargetConstants:suggest",
        {
          locale: "ru",
          countryCode: "KZ",
          locationNames: { names: ["Almaly District"] },
        },
      ),
      { env },
    ),
    "read_geo_service",
  );
  assert.throws(() =>
    classifyJ(
      ...request(
        `https://googleads.googleapis.com/v24/customers/${target.mcc}/googleAds:searchStream`,
        { query: J_QUERIES.campaign },
      ),
      { env },
    ),
  );
  assert.throws(() =>
    classifyJ(
      ...request(
        `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:searchStream`,
        { query: J_QUERIES.campaign, extra: true },
      ),
      { env },
    ),
  );
});
test("J preparation is before JIT; no fake provider recovery IDs, retries or approval in runner", () => {
  const src = readFileSync(
    new URL("./geo-preview-runner.mjs", import.meta.url),
    "utf8",
  );
  const readyAt = src.search(/stage\s*=\s*"stock_api_ready"/u);
  const previewAt = src.search(/stage\s*=\s*"J_JIT_PREVIEW"/u);
  assert.ok(readyAt >= 0 && previewAt > readyAt);
  assert.ok(src.includes('stage3ToolSchema("google_ads_targeting_preview")'));
  assert.doesNotMatch(src, /criterion_id:\s*"1"/u);
  assert.doesNotMatch(src, /name:\s*"commit_preview"/u);
  assert.ok(!src.includes('/api/v1/mcp/public/approval"'));
  const guard = readFileSync(
    new URL("./geo-preview-guard.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(guard.includes("claimValidation(root)"));
  assert.match(guard, /flag:\s*"wx"/u);
  assert.ok(digest(J_TOOL));
  assert.equal(typeof assertJFixture, "function");
});
test("J diagnostic exposes only exact known local product codes, never error bodies or credentials", () => {
  assert.equal(
    safeJError({ writeCode: "google_stage3_duplicate", message: "secret" }),
    "google_stage3_duplicate",
  );
  assert.equal(
    safeJError({ writeCode: "secret", message: "credential" }),
    "stage234_unclassified_failure_redacted",
  );
  assert.equal(
    safeJError(Error("stage234_j_geo_proof_invalid")),
    "stage234_j_geo_proof_invalid",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import {
  assertApprovedL,
  validateCommitRequest,
  commitPayload,
  exactPreview,
  target,
  digest,
  claim,
} from "./rsa-commit-guard.mjs";
import { assertCreatedRsa } from "./rsa-commit-runner.mjs";
import { originalKeywords } from "./live-guard.mjs";
import { tool, createFields, rsaQueries } from "./rsa-preview-guard.mjs";
const { structuredClone } = globalThis;
const now = Date.now(),
  future = new Date(now + 600000).toISOString();
const env = {
  PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
  PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
  PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
  PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true",
  GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.customer,
  PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: target.mcc,
  PROVIDER_GOOGLE_API_VERSION: "v24",
  V2_PREVIEW_ONLY: "false",
  V2_CONFIRMED_WRITE_ENABLED: "true",
  PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
  PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  STAGE234_EXPLICIT_COMMIT_AUTHORIZED: "true",
  API_PORT: "4000",
  STAGE234_GUARD_PRELOAD: "0",
  STAGE234_L_GUARD_PRELOAD: "0",
  STAGE234_EXPECTED_L_PREVIEW: exactPreview,
  STAGE234_SOURCE_HEAD: "c11f14c263b8e3a27418d87146b1894c7d9107dc",
  STAGE234_HARNESS_HEAD: "b".repeat(40),
  STAGE234_IMAGE_DIGEST:
    "sha256:8f6af88c3ab81a162ae63d3c862c614884388410ea0610f40b800cb16fd3bfba",
};
const fixture = () => {
  const context = {
    preview: {
      preview_id: exactPreview,
      preview_token: "synthetic-mcp-opaque",
    },
    service_token: "synthetic-service-opaque",
  };
  const account = {
    id: "account",
    workspaceId: "workspace",
    connectionId: "connection",
    provider: "GOOGLE_ADS",
    externalAccountId: target.customer,
    enabled: true,
  };
  const key = {
    id: "key",
    tokenDigest: digest(context.service_token),
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    accountIds: [account.id],
    resourceAccessMode: "STATIC_ALLOWLIST",
    serviceIdentity: { workspaceId: account.workspaceId, createdById: "human" },
  };
  const plan = {
    version: 4,
    account_id: target.customer,
    intent: tool.arguments,
    atomic: false,
    irreversible: false,
    checks: [],
    items: [{}],
    operations: [
      {
        kind: "adGroupAds",
        method: "create",
        resource_name: null,
        fields: createFields,
        before: null,
        expected: createFields,
        read_query: rsaQueries.inventory,
        response_key: "adGroupAd",
        update_mask: null,
        row: 0,
      },
    ],
  };
  const stored = {
    id: context.preview.preview_id,
    principalType: "SERVICE_TOKEN",
    serviceTokenId: key.id,
    workspaceId: account.workspaceId,
    provider: "GOOGLE_ADS",
    accountId: account.id,
    connectionId: account.connectionId,
    operation: "GOOGLE_STAGE4_RSA_CREATE",
    requestedState: plan,
    beforeState: plan.checks,
    snapshotDigest: digest(plan),
    previewTokenDigest: digest(context.preview.preview_token),
    confirmedAt: new Date(now - 1000),
    expiresAt: future,
    approvedByUserId: "human",
    approvalSessionId: "session",
    commitStatus: "CONFIRMED",
    diff: { provider_validation: "passed" },
  };
  const session = {
    id: "session",
    userId: "human",
    expiresAt: future,
    user: { status: "active" },
  };
  const approval = {
    targetId: stored.id,
    workspaceId: account.workspaceId,
    actorUserId: "human",
    actorType: "HUMAN",
    eventType: "mcp_preview_web_approved",
    success: true,
    createdAt: new Date(now - 500),
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
    fixture_sha256: "d".repeat(64),
    source_head: env.STAGE234_SOURCE_HEAD,
    verified_at: new Date(now).toISOString(),
  };
  return { context, account, key, stored, session, approval, proof };
};

const providerFixture = () => ({
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
    [
      "1031",
      "LANGUAGE",
      { language: { languageConstant: "languageConstants/1031" } },
    ],
    ["30000", "DEVICE", { device: { type: "DESKTOP" } }],
    ["30001", "DEVICE", { device: { type: "MOBILE" } }],
    ["30002", "DEVICE", { device: { type: "TABLET" } }],
    [
      "9235214",
      "LOCATION",
      { location: { geoTargetConstant: "geoTargetConstants/9235214" } },
    ],
  ].map(([id, type, fields]) => ({
    campaignCriterion: {
      resourceName: `customers/${target.customer}/campaignCriteria/${target.campaign}~${id}`,
      campaign: `customers/${target.customer}/campaigns/${target.campaign}`,
      criterionId: id,
      type,
      status: "ENABLED",
      negative: false,
      ...fields,
    },
  })),
});

test("L persisted approval exact opaque token/owner/session/audit/TTL binds the immutable PAUSED create", () => {
  const f = fixture();
  assert.equal(assertApprovedL(f, exactPreview, now).approval_persisted, true);
  for (const mutate of [
    (f) => (f.stored.confirmedAt = null),
    (f) => (f.session.revokedAt = new Date()),
    (f) => (f.approval.success = false),
    (f) => (f.stored.expiresAt = new Date(now - 1)),
    (f) => (f.stored.consumedAt = new Date()),
    (f) => f.key.accountIds.push("foreign"),
    (f) =>
      (f.stored.requestedState.operations[0].fields = {
        ...createFields,
        status: "ENABLED",
      }),
    (f) => (f.context.preview.preview_token = "other"),
  ]) {
    const copy = fixture();
    mutate(copy);
    assert.throws(() => assertApprovedL(copy, exactPreview, now));
  }
  assert.throws(() =>
    assertApprovedL(f, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", now),
  );
});
test("L only exact GoogleAdsService write allowed; no revalidate/raw cleanup/other customer/altered intent", () => {
  const f = fixture(),
    authority = assertApprovedL(f, exactPreview, now),
    opts = { env, proof: f.proof, authority, context: f.context, now };
  const init = (body) => ({
    method: "POST",
    headers: { "login-customer-id": target.mcc },
    body: JSON.stringify(body),
  });
  const endpoint = `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:mutate`;
  assert.equal(
    validateCommitRequest(endpoint, init(commitPayload), opts),
    "write",
  );
  for (const payload of [
    { ...commitPayload, validateOnly: true },
    { ...commitPayload, partialFailure: false },
    { ...commitPayload, mutateOperations: [] },
    {
      ...commitPayload,
      mutateOperations: [
        ...commitPayload.mutateOperations,
        ...commitPayload.mutateOperations,
      ],
    },
  ])
    assert.throws(() => validateCommitRequest(endpoint, init(payload), opts));
  assert.throws(() =>
    validateCommitRequest(
      endpoint.replace(target.customer, target.mcc),
      init(commitPayload),
      opts,
    ),
  );
  assert.throws(() =>
    validateCommitRequest(endpoint, init(commitPayload), {
      ...opts,
      authority: null,
    }),
  );
  assert.throws(() =>
    validateCommitRequest(endpoint, init(commitPayload), {
      ...opts,
      proof: { ...f.proof, test_account: false },
    }),
  );
});
test("L exact stock commit allowed; previews/self-approval/cancel blocked and claims forbid retry", () => {
  const f = fixture(),
    authority = assertApprovedL(f, exactPreview, now),
    opts = { env, proof: f.proof, authority, context: f.context, now };
  const rpc = {
    jsonrpc: "2.0",
    id: "stage234-L-commit",
    method: "tools/call",
    params: {
      name: "commit_preview",
      arguments: { preview_token: f.context.preview.preview_token },
    },
  };
  const call = (body) =>
    validateCommitRequest(
      "http://127.0.0.1:4000/mcp",
      { method: "POST", body: JSON.stringify(body) },
      opts,
    );
  assert.equal(call(rpc), "mcp_commit");
  for (const name of [
    "google_ads_ads_assets_preview",
    "cancel_preview",
    "approve_preview",
  ])
    assert.throws(() => call({ ...rpc, params: { ...rpc.params, name } }));
  const root = mkdtempSync(join(tmpdir(), "hm-Lcommit-"));
  claim(root, "mcp_commit");
  assert.throws(() => claim(root, "mcp_commit"));
  claim(root, "write");
  assert.throws(() => claim(root, "write"));
});
test("L post-reread exactly ONE new PAUSED RSA and all old fixture state unchanged", () => {
  const before = providerFixture(),
    other = "24339483523";
  before.fixtureCampaigns = [target.campaign, other].map((id) => ({
    campaign: {
      id,
      resourceName: `customers/${target.customer}/campaigns/${id}`,
      status: "PAUSED",
    },
  }));
  before.fixtureGroups = [
    {
      campaign: { id: target.campaign },
      adGroup: {
        id: target.group,
        resourceName: target.groupResource,
        status: "PAUSED",
      },
    },
    ...["10", "11"].map((id) => ({
      campaign: { id: other },
      adGroup: {
        id,
        resourceName: `customers/${target.customer}/adGroups/${id}`,
        status: "PAUSED",
      },
    })),
  ];
  before.fixtureAds = [
    {
      campaign: { id: target.campaign },
      adGroup: { id: target.group },
      adGroupAd: {
        resourceName: `customers/${target.customer}/adGroupAds/${target.group}~${target.rsa}`,
        status: "PAUSED",
        ad: { id: target.rsa },
      },
    },
    ...["10", "11"].map((id) => ({
      campaign: { id: other },
      adGroup: { id },
      adGroupAd: {
        resourceName: `customers/${target.customer}/adGroupAds/${id}~${id}`,
        status: "PAUSED",
        ad: { id },
      },
    })),
  ];
  const after = structuredClone(before),
    id = "12345",
    resource = `customers/${target.customer}/adGroupAds/${target.group}~${id}`;
  after.rsa.push({
    campaign: { id: target.campaign },
    adGroup: { id: target.group },
    adGroupAd: {
      resourceName: resource,
      status: "PAUSED",
      ad: { ...createFields.ad, id, type: "RESPONSIVE_SEARCH_AD" },
    },
  });
  after.fixtureAds.push({
    campaign: { id: target.campaign },
    adGroup: { id: target.group },
    adGroupAd: { resourceName: resource, status: "PAUSED", ad: { id } },
  });
  assert.equal(assertCreatedRsa(before, after).resource_name, resource);
  const metadata = structuredClone(after);
  for (const field of ["headlines", "descriptions"]) {
    metadata.rsa[1].adGroupAd.ad.responsiveSearchAd[field] =
      metadata.rsa[1].adGroupAd.ad.responsiveSearchAd[field].map((value) => ({
        ...value,
        pinnedField: "UNSPECIFIED",
        assetPerformanceLabel: "PENDING",
        policySummaryInfo: {
          policyTopicEntries: [],
          approvalStatus: "UNDER_REVIEW",
        },
      }));
  }
  metadata.rsa[1].adGroupAd.ad.responsiveSearchAd.path1 = "";
  metadata.rsa[1].adGroupAd.ad.responsiveSearchAd.path2 = "";
  assert.equal(assertCreatedRsa(before, metadata).resource_name, resource);
  for (const mutate of [
    (s) =>
      (s.rsa[1].adGroupAd.ad.responsiveSearchAd.headlines[0].pinnedField =
        "HEADLINE_1"),
    (s) => (s.rsa[1].adGroupAd.ad.responsiveSearchAd.path1 = "unexpected"),
    (s) => (s.rsa[1].adGroupAd.ad.responsiveSearchAd.path2 = "unexpected"),
    (s) =>
      (s.rsa[1].adGroupAd.ad.responsiveSearchAd.headlines[0].text = "changed"),
    (s) => (s.rsa[1].adGroupAd.ad.finalUrls = ["https://example.test/changed"]),
    (s) => (s.rsa[0].adGroupAd.ad.assetPerformanceLabel = "PENDING"),
  ]) {
    const wrong = structuredClone(metadata);
    mutate(wrong);
    assert.throws(() => assertCreatedRsa(before, wrong));
  }
  for (const mutate of [
    (s) => (s.rsa[1].adGroupAd.status = "ENABLED"),
    (s) => (s.rsa[0].adGroupAd.status = "ENABLED"),
    (s) => (s.keywords[0].adGroupCriterion.status = "PAUSED"),
    (s) => s.rsa.push(s.rsa[1]),
    (s) => s.fixtureAds.pop(),
  ]) {
    const wrong = structuredClone(after);
    mutate(wrong);
    assert.throws(() => assertCreatedRsa(before, wrong));
  }
});
test("DB-only preflight returns before credential decrypt/refresh/provider/API; stock commit only once", () => {
  const source = readFileSync(
    new URL("./rsa-commit-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.indexOf("env.STAGE234_L_DB_PREFLIGHT_ONLY") <
      source.indexOf("const connection"),
  );
  assert.equal((source.match(/"commit_preview"/g) ?? []).length, 1);
  assert.ok(!source.includes("sealAcceptanceContext"));
  assert.ok(source.includes("startupDiagnostics(server)"));
});

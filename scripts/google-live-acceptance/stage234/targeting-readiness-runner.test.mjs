import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  TARGETING_READ_QUERIES as queries,
  targetingFixture as target,
  TARGETING_BASE_HEAD as source,
} from "./scenario-targeting-readiness.mjs";
import { PREFLIGHT_QUERIES } from "./read-only-guard.mjs";
import { originalKeywords } from "./live-guard.mjs";
import { mockLProof, mockLAd } from "./verified-l-residual.fixtures.mjs";
import {
  assertReadinessRuntime,
  assertReadinessAuthority,
  classifyReadinessRequest,
  installReadinessGuard,
  safeReadinessError,
  runTargetingReadiness,
  readinessSnapshotDigest,
  READINESS_SNAPSHOT_QUERIES,
} from "./targeting-readiness-runner.mjs";
const now = Date.parse("2026-10-09T12:00:00.000Z"),
  prefix = `customers/${target.customer}`,
  campaign = `${prefix}/campaigns/${target.campaign}`,
  group = `${prefix}/adGroups/${target.group}`;
const env = {
  STAGE234_SOURCE_HEAD: source,
  STAGE234_HARNESS_HEAD: source,
  STAGE234_IMAGE_DIGEST: "sha256:" + "b".repeat(64),
  STAGE234_RUN_DIR: "/acceptance-state",
};
function config() {
  return {
    databaseUrl: "postgresql://postgres/google_acceptance",
    redisUrl: "redis://redis:6379",
    providerGoogleApiVersion: "v24",
    providerGoogleLoginCustomerId: target.mcc,
    googleAdsWriteAccountAllowlist: [],
    previewOnly: true,
    providerGoogleAdsWriteEnabled: false,
    providerGoogleAdsStage2WriteEnabled: false,
    providerGoogleAdsStage3WriteEnabled: false,
    providerGoogleAdsStage4WriteEnabled: false,
    confirmedWriteEnabled: false,
    publicMcpWriteScopeEnabled: false,
    publicMcpControlledWriteEnabled: false,
  };
}
function authority() {
  const context = {
      service_token: "mock-hidden-marker",
      key_id: "11111111-1111-4111-8111-111111111111",
      expires_at: new Date(now + 3600000).toISOString(),
      preview: { preview_id: "22222222-2222-4222-8222-222222222222" },
    },
    account = {
      id: "account-test",
      workspaceId: "workspace-test",
      provider: "GOOGLE_ADS",
      externalAccountId: target.customer,
      enabled: true,
      connectionId: "connection-test",
    };
  const baseline = {
    provider: "GOOGLE_ADS",
    workspaceId: account.workspaceId,
    account,
  };
  const key = {
    id: context.key_id,
    tokenDigest: createHash("sha256")
      .update(context.service_token)
      .digest("hex"),
    expiresAt: new Date(context.expires_at),
    revokedAt: null,
    resourceAccessMode: "STATIC_ALLOWLIST",
    accountIds: [account.id],
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    serviceIdentity: { workspaceId: account.workspaceId, revokedAt: null },
  };
  const connection = {
    id: account.connectionId,
    workspaceId: account.workspaceId,
    provider: "GOOGLE_ADS",
    credential: {
      encryptedPayload: "mock-encrypted-marker",
      encryptionVersion: 1,
    },
  };
  return {
    context,
    baseline,
    key,
    connection,
    enabled: [{ externalAccountId: target.customer }],
  };
}
function fixtureRows() {
  const c = {
      id: target.campaign,
      resourceName: campaign,
      status: "PAUSED",
      advertisingChannelType: "SEARCH",
      biddingStrategyType: "MANUAL_CPC",
      targetingSetting: {},
    },
    g = {
      id: target.group,
      resourceName: group,
      campaign,
      status: "PAUSED",
      targetingSetting: {},
    },
    w = "24339483523",
    g2 = "50002",
    g3 = "50003";
  return {
    customer: [
      {
        customer: {
          id: target.customer,
          resourceName: prefix,
          testAccount: true,
          currencyCode: "USD",
          timeZone: "Asia/Almaty",
          conversionTrackingSetting: { googleAdsConversionCustomer: prefix },
        },
      },
    ],
    hierarchy: [
      {
        customerClient: { id: target.customer, level: "1", testAccount: true },
      },
    ],
    campaign: [{ campaign: c }],
    group: [{ campaign: { id: target.campaign }, adGroup: g }],
    keywords: [...originalKeywords, target.phrase].map((id) => ({
      campaign: { id: target.campaign },
      adGroup: { id: target.group },
      adGroupCriterion: {
        resourceName: `${prefix}/adGroupCriteria/${target.group}~${id}`,
        criterionId: id,
        type: "KEYWORD",
        status: id === target.phrase ? "PAUSED" : "ENABLED",
        keyword: {
          text: "mock test",
          matchType: id === target.phrase ? "PHRASE" : "EXACT",
        },
      },
    })),
    ads: [
      {
        campaign: { id: target.campaign },
        adGroup: { id: target.group },
        adGroupAd: {
          resourceName: `${prefix}/adGroupAds/${target.group}~${target.rsa}`,
          status: "PAUSED",
          ad: { id: target.rsa, type: "RESPONSIVE_SEARCH_AD" },
        },
      },
    ],
    groupAudiences: [],
    campaignCriteria: [],
    deliveryCampaigns: [
      { campaign: c },
      {
        campaign: {
          id: w,
          resourceName: `${prefix}/campaigns/${w}`,
          status: "PAUSED",
        },
      },
    ],
    deliveryGroups: [
      {
        campaign: { id: target.campaign },
        adGroup: { ...g, cpcBidMicros: "100000" },
      },
      ...[g2, g3].map((id) => ({
        campaign: { id: w },
        adGroup: {
          id,
          resourceName: `${prefix}/adGroups/${id}`,
          status: "PAUSED",
        },
      })),
    ],
    deliveryAds: [
      {
        campaign: { id: target.campaign },
        adGroup: { id: target.group },
        adGroupAd: {
          resourceName: `${prefix}/adGroupAds/${target.group}~${target.rsa}`,
          status: "PAUSED",
          ad: { id: target.rsa },
        },
      },
      ...[g2, g3].map((id) => ({
        campaign: { id: w },
        adGroup: { id },
        adGroupAd: {
          resourceName: `${prefix}/adGroupAds/${id}~${id}`,
          status: "PAUSED",
          ad: { id },
        },
      })),
    ],
    sharedSet: [
      {
        sharedSet: {
          id: "12261567996",
          resourceName: `${prefix}/sharedSets/12261567996`,
          status: "ENABLED",
        },
      },
    ],
    attachments: [],
    eligibleInterests: [],
    userLists: [],
    detailedDemographics: [],
    city: [],
    districts: [],
    conversions: [],
    assets: [],
    pmaxCampaigns: [],
  };
}
const url = (customer = target.customer) =>
  `https://googleads.googleapis.com/v24/customers/${customer}/googleAds:searchStream`;
const req = (query, customer = target.customer) => [
  url(customer),
  {
    method: "POST",
    headers: { "login-customer-id": target.mcc },
    body: JSON.stringify({ query }),
  },
];
test("runtime requires all write gates OFF, isolated config, and source/digest", () => {
  assert.doesNotThrow(() => assertReadinessRuntime(env, config()));
  for (const field of [
    "providerGoogleAdsWriteEnabled",
    "providerGoogleAdsStage2WriteEnabled",
    "providerGoogleAdsStage3WriteEnabled",
    "providerGoogleAdsStage4WriteEnabled",
    "confirmedWriteEnabled",
    "publicMcpWriteScopeEnabled",
    "publicMcpControlledWriteEnabled",
  ])
    assert.throws(() =>
      assertReadinessRuntime(env, { ...config(), [field]: true }),
    );
  assert.throws(() =>
    assertReadinessRuntime(env, {
      ...config(),
      databaseUrl: "postgresql://production/holymedia",
    }),
  );
  assert.throws(() =>
    assertReadinessRuntime(env, {
      ...config(),
      googleAdsWriteAccountAllowlist: [target.customer, "9999999999"],
    }),
  );
});
test("authority requires encrypted-context selected exact key/TEST account, not an active approval", () => {
  assert.equal(
    assertReadinessAuthority(authority(), now).externalAccountId,
    target.customer,
  );
  for (const change of [
    "revoked",
    "workspace",
    "scope",
    "foreign",
    "expired",
    "all_connected",
    "wrong_digest",
    "wrong_id",
  ]) {
    const p = authority();
    if (change === "revoked") p.key.revokedAt = new Date();
    if (change === "workspace") p.key.serviceIdentity.workspaceId = "other";
    if (change === "scope") p.key.scopes = [];
    if (change === "foreign")
      p.enabled.push({ externalAccountId: "9999999999" });
    if (change === "expired") p.key.expiresAt = new Date(now - 1);
    if (change === "all_connected") p.key.resourceAccessMode = "ALL_CONNECTED";
    if (change === "wrong_digest") p.key.tokenDigest = "a".repeat(64);
    if (change === "wrong_id") p.context.key_id = "wrong";
    assert.throws(() => assertReadinessAuthority(p, now));
  }
});
test("only fixed reads + bounded normal refresh; validate/mutate/approval/arbitrary read blocked", async () => {
  assert.equal(classifyReadinessRequest(...req(queries.customer)), "read");
  assert.equal(
    classifyReadinessRequest(...req(PREFLIGHT_QUERIES.groups)),
    "read",
  );
  assert.equal(
    classifyReadinessRequest(...req(queries.hierarchy, target.mcc)),
    "read",
  );
  for (const data of [
    {
      url: url().replace("searchStream", "mutate"),
      body: { validateOnly: true, operations: [] },
    },
    { url: url(), body: { query: queries.customer, operations: [] } },
    { url: url("9999999999"), body: { query: queries.customer } },
    { url: "http://localhost:4402/mcp/approve", body: {} },
  ])
    assert.throws(() =>
      classifyReadinessRequest(data.url, {
        method: "POST",
        headers: { "login-customer-id": target.mcc },
        body: JSON.stringify(data.body),
      }),
    );
  const refresh = [
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: "mock-client",
        client_secret: "mock-client-marker",
        refresh_token: "mock-refresh-marker",
      }),
    },
  ];
  assert.equal(classifyReadinessRequest(...refresh), "oauth_refresh");
  const counts = { read: 0, oauth_refresh: 0, failed_http: 0 },
    guard = installReadinessGuard(async () => Response.json({}), counts);
  await guard(...refresh);
  await assert.rejects(guard(...refresh), {
    code: "readiness_request_limit_no_retry",
  });
  assert.equal(counts.oauth_refresh, 1);
});
test("safe errors never serialize messages/provider payload/credential values", () => {
  const marker = "do-not-emit-mock-error-message",
    e = new Error(marker);
  e.providerResponse = { secret: marker };
  e.providerStatus = 403;
  e.providerCode = "USER_PERMISSION_DENIED";
  const safe = safeReadinessError(e);
  assert.equal(safe.http_status, 403);
  assert.equal(safe.google_code, "USER_PERMISSION_DENIED");
  assert.ok(!JSON.stringify(safe).includes(marker));
});
async function mockedRun({
  unavailable = [],
  changed = false,
  foreign = false,
  refresh = false,
  badDirectory = false,
  campaignCriteria = [],
  discovery = false,
  verifiedL = false,
  invalidL = false,
  enabledL = false,
} = {}) {
  const a = authority(),
    rows = fixtureRows(),
    saved = [],
    calls = [];
  rows.campaignCriteria = campaignCriteria;
  if (verifiedL) {
    rows.ads = [mockLAd(target.rsa), mockLAd()];
    rows.deliveryAds = [
      ...rows.ads,
      mockLAd("827487091340", "24339483523", "200180930839"),
      mockLAd("827362851813", "24339483523", "200180931039"),
    ];
    rows.deliveryGroups[1].adGroup.id = "200180930839";
    rows.deliveryGroups[1].adGroup.resourceName = `${prefix}/adGroups/200180930839`;
    rows.deliveryGroups[2].adGroup.id = "200180931039";
    rows.deliveryGroups[2].adGroup.resourceName = `${prefix}/adGroups/200180931039`;
    if (enabledL) rows.ads[1].adGroupAd.status = "ENABLED";
  }
  let keywordReads = 0,
    vaultUpdates = 0;
  const oldFetch = globalThis.fetch;
  const queryNames = {
    ...queries,
    deliveryCampaigns: PREFLIGHT_QUERIES.campaigns,
    deliveryGroups: PREFLIGHT_QUERIES.groups,
    deliveryAds: PREFLIGHT_QUERIES.ads,
    sharedSet: PREFLIGHT_QUERIES.shared_set,
    attachments: PREFLIGHT_QUERIES.attachments,
  };
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://oauth2.googleapis.com/token")
      return Response.json({});
    const q = JSON.parse(String(init.body)).query,
      name = Object.keys(queryNames).find((n) => queryNames[n] === q);
    calls.push(name);
    if (unavailable.includes(name))
      return Response.json({ error: { code: 403 } }, { status: 403 });
    const result = structuredClone(rows[name] ?? []);
    if (name === "keywords" && ++keywordReads > 1 && changed)
      result[0].adGroupCriterion.status = "PAUSED";
    if (name === "customer" && foreign) result[0].customer.id = "9999999999";
    return Response.json(result);
  };
  class Vault {
    decrypt() {
      return {
        accessToken: "mock-provider-marker",
        scopes: ["https://www.googleapis.com/auth/adwords"],
        expiresAt: new Date(refresh ? now - 1 : now + 3600000).toISOString(),
      };
    }
    encrypt() {
      return { ciphertext: "mock-ciphertext-only", encryptionVersion: 1 };
    }
  }
  class Adapter {
    async refreshCredentials(c) {
      await globalThis.fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: "mock-client",
          client_secret: "mock-client-marker",
          refresh_token: "mock-refresh-marker",
        }),
      });
      return { ...c, expiresAt: new Date(now + 3600000).toISOString() };
    }
    async searchStream(_credential, customer, login, q) {
      assert.equal(login, target.mcc);
      const response = await globalThis.fetch(url(customer), {
        method: "POST",
        headers: { "login-customer-id": login },
        body: JSON.stringify({ query: q }),
      });
      if (!response.ok) {
        const e = new Error("do-not-emit-provider-payload");
        e.code = "provider_permission";
        e.providerStatus = 403;
        e.providerCode = "USER_PERMISSION_DENIED";
        throw e;
      }
      return response.json();
    }
  }
  const db = {
    client: {
      mcpPreview: { findUnique: async () => a.baseline },
      serviceToken: { findUnique: async () => a.key },
      providerAccount: { findMany: async () => a.enabled },
      providerConnection: { findUnique: async () => a.connection },
      providerCredential: {
        update: async () => {
          vaultUpdates++;
        },
      },
    },
  };
  try {
    const result = await runTargetingReadiness({
      env: {
        ...env,
        ...(discovery ? { STAGE234_DISCOVERY: "true" } : {}),
        ...(verifiedL ? { STAGE234_VERIFIED_L: "true" } : {}),
      },
      readLProof: () => (invalidL ? {} : mockLProof()),
      load: async () => ({
        config: config(),
        Vault,
        Adapter,
        createDatabase: () => db,
        closeDatabase: async () => {},
      }),
      readContext: async (_path, opts) => {
        assert.equal(opts.allowLegacyExpired, false);
        return a.context;
      },
      checkDirectory: () => {
        if (badDirectory) throw Error("directory_mock_invalid");
      },
      save: (file, value) => saved.push({ file, value }),
      now: () => now,
    });
    return { result, saved, calls, vaultUpdates };
  } finally {
    globalThis.fetch = oldFetch;
  }
}
test("verified L opt-in keeps complete four RSA proof with original-only scenario view", async () => {
  const r = await mockedRun({ verifiedL: true });
  assert.equal(r.result.result, "PASS_READ_ONLY");
  assert.equal(r.result.real_writes, 0);
  assert.equal(r.result.validate_only, 0);
  assert.equal(r.saved[0].value.verified_l_residual.full_delivery_rsa_count, 4);
  assert.equal(
    r.saved[0].value.verified_l_residual.original_group_rsa_count,
    2,
  );
  assert.equal(r.saved[0].value.fixture_unchanged, true);
  const bad = await mockedRun({ verifiedL: true, invalidL: true });
  assert.equal(bad.result.result, "BLOCKED");
  assert.equal(bad.calls.length, 0);
  const enabled = await mockedRun({ verifiedL: true, enabledL: true });
  assert.equal(enabled.result.result, "BLOCKED");
  assert.equal(enabled.result.real_writes, 0);
});
test("snapshot digest freezes all eleven raw query projections including L and ignores row ordering", () => {
  const r = fixtureRows(),
    snapshot = Object.fromEntries(
      Object.keys(READINESS_SNAPSHOT_QUERIES).map((n) => [n, r[n]]),
    );
  const d = readinessSnapshotDigest(snapshot);
  snapshot.ads.push(mockLAd());
  assert.notEqual(readinessSnapshotDigest(snapshot), d);
  const full = readinessSnapshotDigest(snapshot);
  snapshot.ads.reverse();
  assert.equal(readinessSnapshotDigest(snapshot), full);
  snapshot.ads[0].adGroupAd.status = "ENABLED";
  assert.notEqual(readinessSnapshotDigest(snapshot), full);
  assert.throws(() => readinessSnapshotDigest({}));
});
test("READ runner emits one sanitized evidence, readiness blockers independent of N, no execution of MCP", async () => {
  const r = await mockedRun({
    unavailable: ["eligibleInterests", "detailedDemographics", "conversions"],
  });
  assert.equal(r.result.result, "PASS_READ_ONLY");
  assert.equal(r.result.validate_only, 0);
  assert.equal(r.result.real_writes, 0);
  assert.equal(r.saved.length, 1);
  assert.equal(r.saved[0].value.fixture_unchanged, true);
  assert.deepEqual(r.saved[0].value.fixture_campaign_criteria, []);
  assert.equal(Object.keys(r.saved[0].value.inventory_read_errors).length, 3);
  assert.equal(r.result.I, "BLOCKED");
  assert.equal(r.result.J, "BLOCKED");
  assert.equal(r.result.PMax, "BLOCKED");
  assert.equal(r.result.provider_reads, r.calls.length);
  assert.ok(!JSON.stringify(r.saved).includes("mock-provider-marker"));
  assert.ok(!JSON.stringify(r.saved).includes("mock-hidden-marker"));
  assert.ok(!JSON.stringify(r.saved).includes("do-not-emit-provider-payload"));
  assert.equal(r.vaultUpdates, 0);
});
test("opt-in discovery adds only guarded READs, independent blockers and same fixture proof", async () => {
  const r = await mockedRun({ discovery: true });
  assert.equal(r.result.result, "PASS_READ_ONLY");
  assert.equal(r.saved[0].value.fixture_unchanged, true);
  assert.equal(r.saved[0].value.discovery.result, "READ_ONLY_DISCOVERY");
  assert.equal(r.saved[0].value.discovery.G.result, "BLOCKED");
  assert.equal(r.saved[0].value.discovery.I.IN_MARKET.result, "BLOCKED");
  assert.equal(r.saved[0].value.discovery.I.AFFINITY.result, "BLOCKED");
  assert.equal(r.result.provider_reads, r.calls.length);
  assert.equal(r.result.validate_only, 0);
  assert.equal(r.result.real_writes, 0);
  assert.equal(r.vaultUpdates, 0);
  assert.ok(!JSON.stringify(r.saved).includes("mock-provider-marker"));
});
test("fresh customer proof prevents any inventory query; fixture drift blocks without writes", async () => {
  const foreign = await mockedRun({ foreign: true });
  assert.equal(foreign.result.result, "BLOCKED");
  assert.deepEqual(foreign.calls, ["customer", "hierarchy"]);
  const changed = await mockedRun({ changed: true });
  assert.equal(changed.result.result, "BLOCKED");
  assert.equal(changed.result.code, "readiness_fixture_changed_during_READs");
  assert.equal(changed.result.real_writes, 0);
});
test("targeting diagnostics select only safe criterion fields, never arbitrary response metadata", async () => {
  const criterion = {
    resourceName: `${prefix}/campaignCriteria/${target.campaign}~90001`,
    campaign,
    criterionId: "90001",
    type: "LOCATION",
    status: "ENABLED",
    location: { geoTargetConstant: "geoTargetConstants/90002" },
    unknownMetadata: "mock-hidden-marker",
  };
  const r = await mockedRun({
    campaignCriteria: [{ campaignCriterion: criterion }],
  });
  assert.equal(r.result.result, "PASS_READ_ONLY");
  const diagnostic = r.saved[0].value.fixture_campaign_criteria;
  assert.equal(diagnostic.length, 1);
  assert.equal(diagnostic[0].resourceName, criterion.resourceName);
  assert.deepEqual(diagnostic[0].location, criterion.location);
  assert.ok(!JSON.stringify(diagnostic).includes("mock-hidden-marker"));
  assert.equal(r.result.real_writes, 0);
});
test("failed directory never writes evidence to an unverified path", async () => {
  const r = await mockedRun({ badDirectory: true });
  assert.equal(r.result.result, "BLOCKED");
  assert.equal(r.saved.length, 0);
  assert.equal(r.result.evidence, null);
  assert.equal(r.calls.length, 0);
});
test("normal refresh is bounded once and stored only encrypted in disposable vault, counted separately", async () => {
  const r = await mockedRun({ refresh: true });
  assert.equal(r.result.result, "PASS_READ_ONLY");
  assert.equal(r.saved[0].value.counts.oauth_refresh, 1);
  assert.equal(r.vaultUpdates, 1);
  assert.equal(r.result.provider_reads, r.calls.length);
  assert.equal(r.result.real_writes, 0);
  assert.ok(!JSON.stringify(r.saved).includes("mock-refresh-marker"));
  assert.ok(!JSON.stringify(r.saved).includes("mock-client-marker"));
});
import { URLSearchParams } from "node:url";
const { Response, structuredClone } = globalThis;

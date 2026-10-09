import test from "node:test";
import assert from "node:assert/strict";
import { originalKeywords } from "./live-guard.mjs";
import {
  TARGETING_BASE_HEAD as source,
  targetingFixture as t,
  TARGETING_READ_QUERIES,
} from "./scenario-targeting-readiness.mjs";
import {
  DISCOVERY_AUTO_CAMPAIGNS,
  discoveryInterestQuery,
  discoveryDistrictQuery,
  discoveryKeywordQuery,
  isDiscoveryQuery,
  existingProximityCenters,
  runTargetingDiscovery,
} from "./targeting-discovery.mjs";
import { classifyReadinessRequest } from "./targeting-readiness-runner.mjs";
const { structuredClone } = globalThis;
const prefix = `customers/${t.customer}`,
  campaign = `${prefix}/campaigns/${t.campaign}`,
  group = `${prefix}/adGroups/${t.group}`,
  now = Date.parse("2026-10-10T00:00:00Z");
const proof = () => ({
  source_head: source,
  verified_at: new Date(now).toISOString(),
  customer: {
    id: t.customer,
    resourceName: prefix,
    testAccount: true,
    currencyCode: "USD",
    timeZone: "Asia/Almaty",
  },
  hierarchy: { id: t.customer, level: 1, testAccount: true },
  campaign: {
    id: t.campaign,
    resourceName: campaign,
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    biddingStrategyType: "MANUAL_CPC",
  },
  group: { id: t.group, resourceName: group, campaign, status: "PAUSED" },
  keywords: [...originalKeywords, t.phrase].map((criterionId) => ({
    resourceName: `${prefix}/adGroupCriteria/${t.group}~${criterionId}`,
    criterionId,
    type: "KEYWORD",
    negative: false,
    status: criterionId === t.phrase ? "PAUSED" : "ENABLED",
    keyword: { text: "MOCK only", matchType: "EXACT" },
  })),
  ads: [
    {
      resourceName: `${prefix}/adGroupAds/${t.group}~${t.rsa}`,
      status: "PAUSED",
      ad: { id: t.rsa, type: "RESPONSIVE_SEARCH_AD" },
    },
  ],
});
const city = {
  geoTargetConstant: {
    id: "10001",
    resourceName: "geoTargetConstants/10001",
    name: "Astana",
    targetType: "City",
    countryCode: "KZ",
    status: "ENABLED",
  },
};
const district = {
  geoTargetConstant: {
    id: "10002",
    resourceName: "geoTargetConstants/10002",
    parentGeoTarget: city.geoTargetConstant.resourceName,
    targetType: "District",
    countryCode: "KZ",
    status: "ENABLED",
  },
};
const criteria = () => [
  {
    campaignCriterion: {
      resourceName: `${prefix}/campaignCriteria/${t.campaign}~44`,
      campaign,
      criterionId: "44",
      type: "PROXIMITY",
      status: "ENABLED",
      negative: false,
      proximity: {
        geoPoint: {
          latitudeInMicroDegrees: 51100000,
          longitudeInMicroDegrees: 71400000,
        },
        radius: 5,
        radiusUnits: "KILOMETERS",
      },
    },
  },
];
const interest = (id, kind = "IN_MARKET") => ({
  userInterest: {
    resourceName: `${prefix}/userInterests/${id}`,
    userInterestId: String(id),
    name: "MOCK only",
    taxonomyType: kind,
    launchedToAll: true,
  },
});
const auto = {
  campaign: {
    id: t.campaign,
    resourceName: campaign,
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    biddingStrategyType: "MAXIMIZE_CONVERSIONS",
  },
};
const keyword = () => ({
  campaign: auto.campaign,
  adGroup: {
    id: t.group,
    resourceName: group,
    campaign,
    status: "PAUSED",
    type: "SEARCH_STANDARD",
  },
  adGroupCriterion: {
    resourceName: `${prefix}/adGroupCriteria/${t.group}~${t.phrase}`,
    criterionId: t.phrase,
    type: "KEYWORD",
    status: "ENABLED",
    negative: false,
    cpcBidMicros: "100000",
    keyword: { text: "MOCK only", matchType: "PHRASE" },
  },
});
const request = (query) => [
  `https://googleads.googleapis.com/v24/customers/${t.customer}/googleAds:searchStream`,
  {
    method: "POST",
    headers: { "login-customer-id": t.mcc },
    body: JSON.stringify({ query }),
  },
];
function input(read) {
  return {
    read,
    fixture: proof(),
    existingAudiences: [],
    campaignCriteria: criteria(),
    source,
    now,
  };
}
const baseReader = async (q) =>
  q === TARGETING_READ_QUERIES.city
    ? [city]
    : q === discoveryDistrictQuery(city.geoTargetConstant.resourceName)
      ? [district]
      : [];
test("only exact bounded templates enrolled by trusted proof stage pass READ guard", () => {
  for (const q of [
    DISCOVERY_AUTO_CAMPAIGNS,
    discoveryInterestQuery("IN_MARKET"),
    discoveryInterestQuery("AFFINITY", "12"),
    discoveryInterestQuery("IN_MARKET", "0", true),
    discoveryInterestQuery("AFFINITY", "12", true),
    discoveryDistrictQuery(city.geoTargetConstant.resourceName),
    discoveryKeywordQuery([t.campaign]),
  ]) {
    assert.equal(isDiscoveryQuery(q), true);
    assert.throws(() => classifyReadinessRequest(...request(q)));
    assert.equal(classifyReadinessRequest(...request(q), new Set([q])), "read");
    for (const bad of [q + " ", q.replace("LIMIT", "OFFSET 1 LIMIT")])
      assert.equal(isDiscoveryQuery(bad), false);
    const [url, init] = request(q);
    assert.throws(() =>
      classifyReadinessRequest(
        url.replace(t.customer, t.mcc),
        init,
        new Set([q]),
      ),
    );
    assert.throws(() =>
      classifyReadinessRequest(
        url.replace("searchStream", "mutate"),
        init,
        new Set([q]),
      ),
    );
    assert.throws(() =>
      classifyReadinessRequest(
        url,
        { ...init, body: JSON.stringify({ query: q, validateOnly: true }) },
        new Set([q]),
      ),
    );
  }
  assert.throws(() => discoveryInterestQuery("CUSTOM"));
  assert.throws(() => discoveryInterestQuery("AFFINITY", "1 OR 1"));
  assert.throws(() => discoveryInterestQuery("AFFINITY", "0", "true"));
  assert.throws(() => discoveryKeywordQuery(["12", "12"]));
  assert.throws(() =>
    discoveryDistrictQuery("customers/1111111111/campaigns/12"),
  );
});
test("owned actual auto strategy and explicit raw CPC yield proposal, no effective bid guessed", async () => {
  const r = await runTargetingDiscovery(
    input(async (q) =>
      q === DISCOVERY_AUTO_CAMPAIGNS
        ? [auto]
        : q === discoveryKeywordQuery([t.campaign])
          ? [keyword()]
          : baseReader(q),
    ),
  );
  assert.equal(r.G.result, "PREPARED_NOT_LIVE");
  assert.equal(
    r.G.candidates[0].preview_request.arguments.items[0].change.percent,
    "10",
  );
  assert.equal(r.real_provider_write_calls, 0);
  assert.equal(r.live_acceptance, "NOT_RUN");
  for (const change of [
    (k) => (k.adGroupCriterion.cpcBidMicros = "0"),
    (k) =>
      (k.adGroupCriterion.resourceName =
        "customers/1111111111/adGroupCriteria/22~33"),
    (k) => (k.adGroupCriterion.negative = true),
  ]) {
    const k = keyword();
    change(k);
    const b = await runTargetingDiscovery(
      input(async (q) =>
        q === DISCOVERY_AUTO_CAMPAIGNS
          ? [auto]
          : q === discoveryKeywordQuery([t.campaign])
            ? [k]
            : baseReader(q),
      ),
    );
    assert.equal(b.G.result, "BLOCKED");
    assert.equal(b.G.candidates.length, 0);
  }
});
test("catalog pages IN_MARKET/AFFINITY separately keyset sentinel without losing last row", async () => {
  const calls = [];
  const r = await runTargetingDiscovery(
    input(async (q) => {
      calls.push(q);
      if (q === discoveryInterestQuery("IN_MARKET"))
        return Array.from({ length: 101 }, (_, i) => interest(String(i + 1)));
      if (q === discoveryInterestQuery("IN_MARKET", "100"))
        return [interest("101")];
      return baseReader(q);
    }),
  );
  assert.equal(r.I.IN_MARKET.observed_count, 101);
  assert.equal(r.I.IN_MARKET.exhausted_within_bound, true);
  assert.equal(r.I.IN_MARKET.result, "PREPARED_NOT_LIVE");
  assert.equal(r.I.AFFINITY.observed_count, 0);
  assert.equal(r.no_global_absence_claim, true);
  assert.ok(calls.includes(discoveryInterestQuery("AFFINITY")));
});
test("catalog bound reached blocks proposals, malformed/nonmonotone/foreign page has no raw error", async () => {
  const r = await runTargetingDiscovery(
    input(async (q) => {
      const cursor = /taxonomy_type = 'IN_MARKET'.* > ([0-9]+)/u.exec(q);
      return cursor
        ? Array.from({ length: 101 }, (_, i) =>
            interest(String(Number(cursor[1]) + i + 1)),
          )
        : baseReader(q);
    }),
  );
  assert.equal(r.I.IN_MARKET.observed_count, 500);
  assert.equal(r.I.IN_MARKET.result, "BLOCKED");
  assert.equal(r.I.IN_MARKET.code, "discovery_catalog_bound_reached");
  assert.equal(r.I.IN_MARKET.candidate, undefined);
  const bad = interest("1");
  bad.userInterest.resourceName = "customers/1111111111/userInterests/1";
  const b = await runTargetingDiscovery(
    input(async (q) =>
      q === discoveryInterestQuery("IN_MARKET") ? [bad] : baseReader(q),
    ),
  );
  assert.equal(b.errors.IN_MARKET.code, "discovery_catalog_proof_invalid");
  assert.ok(!JSON.stringify(b).includes("1111111111"));
});
test("targeted globally launched filter finds candidate after unfiltered ordering bound, without absence claim", async () => {
  const calls = [];
  const result = await runTargetingDiscovery(
    input(async (query) => {
      calls.push(query);
      const cursor =
        /taxonomy_type = 'IN_MARKET' AND user_interest\.user_interest_id > ([0-9]+)/u.exec(
          query,
        );
      if (cursor)
        return Array.from({ length: 101 }, (_, i) => {
          const row = interest(String(Number(cursor[1]) + i + 1));
          row.userInterest.launchedToAll = false;
          return row;
        });
      if (query === discoveryInterestQuery("IN_MARKET", "0", true))
        return [interest("90001")];
      return baseReader(query);
    }),
  );
  assert.equal(result.I.IN_MARKET.result, "BLOCKED");
  assert.equal(result.I.IN_MARKET.limit_reached, true);
  assert.equal(result.I.IN_MARKET.eligibility_diagnostics.launched_false, 500);
  assert.equal(result.I.GLOBAL_IN_MARKET.result, "PREPARED_NOT_LIVE");
  assert.equal(
    result.I.GLOBAL_IN_MARKET.candidate.preview_request.arguments.items[0]
      .audience.id,
    "90001",
  );
  assert.equal(
    result.I.GLOBAL_IN_MARKET.eligibility_diagnostics.launched_true,
    1,
  );
  assert.equal(result.I.GLOBAL_IN_MARKET.launched_filter, true);
  assert.equal(result.I.GLOBAL_AFFINITY.observed_count, 0);
  assert.equal(result.I.GLOBAL_AFFINITY.no_global_absence_claim, true);
  assert.ok(calls.includes(discoveryInterestQuery("AFFINITY", "0", true)));
  assert.equal(result.real_provider_write_calls, 0);
});
test("globally launched predicate is strict and count diagnostics never echo provider availability", async () => {
  const row = interest("10");
  row.userInterest.launchedToAll = false;
  row.userInterest.availabilities = [
    {
      channel: {
        availabilityMode: "CHANNEL_TYPE",
        advertisingChannelType: "SEARCH",
      },
      locale: [
        {
          availabilityMode: "LAUNCHED_TO_ALL",
          ignoredMessage: "private-diagnostic-marker",
        },
      ],
    },
  ];
  const result = await runTargetingDiscovery(
    input(async (query) => {
      if (query === discoveryInterestQuery("IN_MARKET")) return [row];
      if (query === discoveryInterestQuery("IN_MARKET", "0", true))
        return [row];
      return baseReader(query);
    }),
  );
  assert.equal(
    result.errors.GLOBAL_IN_MARKET.code,
    "discovery_catalog_proof_invalid",
  );
  assert.equal(result.I.GLOBAL_IN_MARKET, undefined);
  assert.equal(
    result.I.IN_MARKET.eligibility_diagnostics.availability_records,
    1,
  );
  assert.equal(
    result.I.IN_MARKET.eligibility_diagnostics
      .search_channel_global_locale_rows,
    1,
  );
  assert.ok(!JSON.stringify(result).includes("private-diagnostic-marker"));
});
test("J proven city parent query and existing provider center only; missing inventory never guessed", async () => {
  const before = criteria(),
    r = await runTargetingDiscovery(input(baseReader));
  assert.equal(r.J.result, "PREREQUISITES_OBSERVED_NOT_LIVE");
  assert.equal(r.J.existing_centers[0].source, "EXISTING_PROVIDER_PROXIMITY");
  assert.deepEqual(criteria(), before);
  assert.equal(r.J.radius_plan_created, false);
  const missing = input(baseReader);
  missing.campaignCriteria = [];
  const m = await runTargetingDiscovery(missing);
  assert.equal(m.J.code, "discovery_provider_center_missing");
  assert.deepEqual(m.J.existing_centers, []);
  const wrong = structuredClone(district);
  wrong.geoTargetConstant.parentGeoTarget = "geoTargetConstants/99999";
  const b = await runTargetingDiscovery(
    input(async (q) =>
      q === discoveryDistrictQuery(city.geoTargetConstant.resourceName)
        ? [wrong]
        : baseReader(q),
    ),
  );
  assert.equal(b.errors.J.code, "discovery_district_proof_invalid");
  const foreign = criteria();
  foreign[0].campaignCriterion.campaign = "customers/1111111111/campaigns/2";
  assert.throws(() => existingProximityCenters(foreign));
});
test("fixture proof fails before any read; independent safe read failure does not mutate or echo payload", async () => {
  let calls = 0;
  const p = input(async () => {
    calls++;
    throw new Error("do-not-output-secret");
  });
  p.fixture.customer.testAccount = false;
  await assert.rejects(runTargetingDiscovery(p));
  assert.equal(calls, 0);
  const result = await runTargetingDiscovery(
    input(async () => {
      throw new Error("do-not-output-secret");
    }),
  );
  assert.ok(!JSON.stringify(result).includes("do-not-output-secret"));
  assert.equal(result.real_provider_write_calls, 0);
});

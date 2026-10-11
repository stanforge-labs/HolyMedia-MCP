import test from "node:test";
import assert from "node:assert/strict";
import {
  makeIsolatedGBrief,
  assertIsolatedGPlan,
  gStrategyArgs,
  gWarningArgs,
  assertGAutomaticContext,
} from "./g-isolated-contract.mjs";
const p = "customers/8590146099",
  ids = { campaign_id: "901", ad_group_id: "902", criterion_id: "903" };
function mockPlan() {
  const c = `${p}/campaigns/-2`,
    b = `${p}/campaignBudgets/-1`,
    g = `${p}/adGroups/-3`;
  const op = (kind, resource_name, fields) => ({
    kind,
    method: "create",
    resource_name,
    fields,
    before: null,
    update_mask: null,
  });
  return {
    version: 0,
    account_id: "8590146099",
    intent: { action: "campaign_create" },
    operations: [
      op("campaignBudget", b, {
        amountMicros: "2000000",
        explicitlyShared: false,
        deliveryMethod: "STANDARD",
      }),
      op("campaign", c, {
        name: "HM_MCP_ACCEPTANCE_G_mock",
        status: "PAUSED",
        advertisingChannelType: "SEARCH",
        manualCpc: { enhancedCpcEnabled: false },
        campaignBudget: b,
        networkSettings: {
          targetGoogleSearch: true,
          targetSearchNetwork: false,
          targetContentNetwork: false,
        },
        geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" },
      }),
      op("adGroup", g, {
        campaign: c,
        status: "PAUSED",
        cpcBidMicros: "100000",
      }),
      op("adGroupCriterion", `${p}/adGroupCriteria/-3~-4`, {
        adGroup: g,
        status: "PAUSED",
        negative: false,
        cpcBidMicros: "100000",
        keyword: { text: "test automatic bidding warning", matchType: "EXACT" },
      }),
      op("adGroupAd", null, {
        adGroup: g,
        status: "PAUSED",
        ad: { responsiveSearchAd: {} },
      }),
      op("campaignCriterion", null, {
        campaign: c,
        location: { geoTargetConstant: "geoTargetConstants/9235214" },
      }),
      op("campaignCriterion", null, {
        campaign: c,
        language: { languageConstant: "languageConstants/1031" },
      }),
    ],
  };
}
function proof() {
  return {
    customer: { id: "8590146099", testAccount: true, currencyCode: "USD" },
    currency_constant: {
      code: "USD",
      resourceName: "currencyConstants/USD",
      billableUnitMicros: "10000",
    },
    campaign: {
      resourceName: `${p}/campaigns/901`,
      status: "PAUSED",
      advertisingChannelType: "SEARCH",
      biddingStrategyType: "TARGET_SPEND",
    },
    group: {
      resourceName: `${p}/adGroups/902`,
      campaign: `${p}/campaigns/901`,
      status: "PAUSED",
    },
    keyword: {
      resourceName: `${p}/adGroupCriteria/902~903`,
      adGroup: `${p}/adGroups/902`,
      status: "PAUSED",
      cpcBidMicros: "100000",
      keyword: { text: "test automatic bidding warning", matchType: "EXACT" },
    },
  };
}
test("G closed isolated proposal carries explicit CPC, not inherited basis; MOCK only zero calls", () => {
  const b = makeIsolatedGBrief("20261011T170000Z");
  assert.equal(b.account_id, "8590146099");
  assert.equal(b.ad_groups[0].keywords[0].cpc_bid.amount, "0.10");
  assert.equal(b.ad_groups.length, 1);
  assert.throws(() => makeIsolatedGBrief("bad"));
  assert.equal(assertIsolatedGPlan(mockPlan()), true);
});
for (const [name, mutate] of Object.entries({
  count: (p) => p.operations.pop(),
  foreign: (p) =>
    (p.operations[1].resource_name = "customers/9999999999/campaigns/-2"),
  status: (p) => (p.operations[3].fields.status = "ENABLED"),
  CPC: (p) => delete p.operations[3].fields.cpcBidMicros,
  parent: (p) => (p.operations[4].fields.adGroup = `${p.account_id}/wrong`),
  shared: (p) => (p.operations[0].fields.explicitlyShared = true),
  name: (p) => (p.operations[0].fields.name = "custom daily"),
  geo: (p) =>
    (p.operations[5].fields.location.geoTargetConstant =
      "geoTargetConstants/100"),
  strategy: (p) => (p.operations[1].fields.biddingStrategy = "foreign"),
  method: (p) => (p.operations[2].method = "update"),
}))
  test(`G graph rejects ${name} before mutation`, () => {
    const p = mockPlan();
    mutate(p);
    assert.throws(() => assertIsolatedGPlan(p));
  });
test("G new IDs, MAXIMIZE_CLICKS and +10% args cannot touch original fixtures", () => {
  assert.equal(gStrategyArgs(ids).items[0].strategy.type, "MAXIMIZE_CLICKS");
  assert.equal(gWarningArgs(ids).items[0].change.percent, "10");
  for (const override of [
    { campaign_id: "24324170853" },
    { campaign_id: "24339483523" },
    { ad_group_id: "206587491811" },
    { criterion_id: "11743561" },
    { criterion_id: "11479221" },
    { campaign_id: "-1" },
    { campaign_id: "customers/8590146099/campaigns/901" },
  ])
    assert.throws(() => gWarningArgs({ ...ids, ...override }));
});
test("G automatic raw CPC proof, warning-only no commit, preserves provider snapshot", () => {
  const a = proof(),
    before = JSON.stringify(a);
  assert.equal(
    assertGAutomaticContext(a, ids).expected_raw_after_cpc_micros,
    "110000",
  );
  assert.equal(assertGAutomaticContext(a, ids).commit_authorized, false);
  assert.equal(JSON.stringify(a), before);
});
for (const [name, mutate] of Object.entries({
  inherited: (a) => {
    delete a.keyword.cpcBidMicros;
    a.keyword.effectiveCpcBidMicros = "100000";
  },
  manual: (a) => (a.campaign.biddingStrategyType = "MANUAL_CPC"),
  active: (a) => (a.campaign.status = "ENABLED"),
  portfolio: (a) => (a.campaign.biddingStrategy = `${p}/biddingStrategies/1`),
  parent: (a) => (a.keyword.adGroup = `${p}/adGroups/other`),
  TEST: (a) => (a.customer.testAccount = false),
  currency: (a) => (a.customer.currencyCode = "KZT"),
  unit: (a) => (a.currency_constant.billableUnitMicros = "1"),
}))
  test(`G warning context rejects ${name}`, () => {
    const a = proof();
    mutate(a);
    assert.throws(() => assertGAutomaticContext(a, ids));
  });

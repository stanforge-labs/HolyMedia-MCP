// Closed TEST proposal and plan proof only: no network, app launch, approval or commit.
const customer = "8590146099";
const prefix = `customers/${customer}`;
const fail = (code) => {
  throw new Error(code);
};
const row = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
const copy = (v) => structuredClone(v);
export function makeIsolatedGBrief(stamp) {
  if (!/^[0-9]{8}T[0-9]{6}Z$/.test(stamp)) fail("g_setup_timestamp_invalid");
  return {
    provider: "GOOGLE_ADS",
    account_id: customer,
    campaign_name: `HM_MCP_ACCEPTANCE_G_${stamp}`,
    daily_budget: { amount: "2.00", currency: "USD" },
    bidding_strategy: "MANUAL_CPC",
    locations: [
      { name: "Алматы", country_code: "KZ", geo_target_id: "9235214" },
    ],
    languages: ["Russian"],
    utm: {
      final_url_suffix:
        "utm_source=google&utm_medium=cpc&utm_campaign={campaignid}",
    },
    ad_groups: [
      {
        name: "TEST Auto Warning Group",
        default_bid: { amount: "0.10", currency: "USD" },
        keywords: [
          {
            text: "test automatic bidding warning",
            match_type: "EXACT",
            cpc_bid: { amount: "0.10", currency: "USD" },
          },
        ],
        rsa: [
          {
            final_url: "https://mcp.holymedia.kz/",
            headlines: [
              { text: "HolyMedia TEST" },
              { text: "Paused Search Fixture" },
              { text: "Controlled Approval Test" },
            ],
            descriptions: [
              {
                text: "Paused sample ad for a controlled TEST-account acceptance.",
              },
              {
                text: "No production campaign or advertiser account is changed.",
              },
            ],
          },
        ],
      },
    ],
  };
}
export function assertIsolatedGPlan(plan) {
  if (
    plan?.version !== 0 ||
    plan.account_id !== customer ||
    plan.intent?.action !== "campaign_create" ||
    !Array.isArray(plan.operations) ||
    plan.operations.length !== 7
  )
    fail("g_setup_graph_invalid");
  const kinds = {
    campaignBudget: 1,
    campaign: 1,
    adGroup: 1,
    adGroupCriterion: 1,
    adGroupAd: 1,
    campaignCriterion: 2,
  };
  for (const [kind, count] of Object.entries(kinds))
    if (plan.operations.filter((o) => o.kind === kind).length !== count)
      fail("g_setup_graph_invalid");
  for (const o of plan.operations) {
    if (
      o.method !== "create" ||
      o.update_mask ||
      o.before ||
      /customers\/(?!8590146099(?:\/|$))[0-9]+/.test(JSON.stringify(o))
    )
      fail("g_setup_foreign_or_update");
    if (
      ["campaign", "adGroup", "adGroupCriterion", "adGroupAd"].includes(
        o.kind,
      ) &&
      o.fields?.status !== "PAUSED"
    )
      fail("g_setup_delivery_not_paused");
  }
  const one = (kind) => plan.operations.find((o) => o.kind === kind),
    c = one("campaign"),
    g = one("adGroup"),
    k = one("adGroupCriterion"),
    ad = one("adGroupAd"),
    b = one("campaignBudget"),
    f = row(c.fields);
  if (
    !String(f.name).startsWith("HM_MCP_ACCEPTANCE_G_") ||
    f.advertisingChannelType !== "SEARCH" ||
    !f.manualCpc ||
    Object.keys(row(f.manualCpc)).some((k) => k !== "enhancedCpcEnabled") ||
    ![undefined, false].includes(row(f.manualCpc).enhancedCpcEnabled) ||
    f.biddingStrategy ||
    f.campaignBudget !== b.resource_name ||
    row(f.networkSettings).targetGoogleSearch !== true ||
    row(f.networkSettings).targetSearchNetwork !== false ||
    row(f.networkSettings).targetContentNetwork !== false ||
    row(f.geoTargetTypeSetting).positiveGeoTargetType !== "PRESENCE"
  )
    fail("g_setup_campaign_incompatible");
  if (
    b.fields.amountMicros !== "2000000" ||
    b.fields.explicitlyShared !== false ||
    b.fields.deliveryMethod !== "STANDARD" ||
    b.fields.name !== undefined
  )
    fail("g_setup_budget_invalid");
  if (
    g.fields.campaign !== c.resource_name ||
    g.fields.cpcBidMicros !== "100000" ||
    k.fields.adGroup !== g.resource_name ||
    k.fields.cpcBidMicros !== "100000" ||
    row(k.fields.keyword).matchType !== "EXACT" ||
    row(k.fields.keyword).text !== "test automatic bidding warning" ||
    k.fields.negative !== false ||
    ad.fields.adGroup !== g.resource_name ||
    !row(ad.fields.ad).responsiveSearchAd
  )
    fail("g_setup_parent_or_explicit_cpc_invalid");
  const criteria = plan.operations.filter(
    (o) => o.kind === "campaignCriterion",
  );
  if (
    criteria.some(
      (o) =>
        o.fields.campaign !== c.resource_name || o.fields.negative === true,
    ) ||
    criteria.filter(
      (o) =>
        row(o.fields.location).geoTargetConstant ===
        "geoTargetConstants/9235214",
    ).length !== 1 ||
    criteria.filter(
      (o) =>
        row(o.fields.language).languageConstant === "languageConstants/1031",
    ).length !== 1
  )
    fail("g_setup_geo_language_invalid");
  return true;
}
export function gStrategyArgs(ids) {
  checkedIds(ids);
  return {
    provider: "GOOGLE_ADS",
    account_id: customer,
    items: [
      {
        operation: "campaign_strategy",
        campaign_id: ids.campaign_id,
        strategy: {
          type: "MAXIMIZE_CLICKS",
          cpc_ceiling: { amount: "1.00", currency: "USD" },
        },
      },
    ],
  };
}
export function gWarningArgs(ids) {
  checkedIds(ids);
  return {
    provider: "GOOGLE_ADS",
    account_id: customer,
    items: [
      {
        field: "keyword_cpc",
        campaign_id: ids.campaign_id,
        ad_group_id: ids.ad_group_id,
        criterion_id: ids.criterion_id,
        change: { mode: "percent", percent: "10", currency: "USD" },
      },
    ],
  };
}
function checkedIds(ids) {
  if (
    !ids ||
    Object.keys(ids).sort().join(",") !==
      "ad_group_id,campaign_id,criterion_id" ||
    Object.values(ids).some(
      (v) => typeof v !== "string" || !/^[1-9][0-9]{0,19}$/.test(v),
    ) ||
    ["24324170853", "24339483523"].includes(ids.campaign_id) ||
    ids.ad_group_id === "206587491811" ||
    ["11743561", "11479221"].includes(ids.criterion_id)
  )
    fail("g_setup_verified_new_ids_required");
}
export function assertGAutomaticContext(proof, ids) {
  checkedIds(ids);
  const c = row(proof?.campaign),
    g = row(proof?.group),
    k = row(proof?.keyword),
    a = row(proof?.customer),
    unit = row(proof?.currency_constant);
  if (
    a.id !== customer ||
    a.testAccount !== true ||
    a.currencyCode !== "USD" ||
    unit.code !== "USD" ||
    unit.resourceName !== "currencyConstants/USD" ||
    String(unit.billableUnitMicros) !== "10000"
  )
    fail("g_setup_test_currency_proof_invalid");
  if (
    c.resourceName !== `${prefix}/campaigns/${ids.campaign_id}` ||
    c.status !== "PAUSED" ||
    c.advertisingChannelType !== "SEARCH" ||
    c.biddingStrategyType !== "TARGET_SPEND" ||
    c.biddingStrategy ||
    g.resourceName !== `${prefix}/adGroups/${ids.ad_group_id}` ||
    g.campaign !== c.resourceName ||
    g.status !== "PAUSED" ||
    k.resourceName !==
      `${prefix}/adGroupCriteria/${ids.ad_group_id}~${ids.criterion_id}` ||
    k.adGroup !== g.resourceName ||
    k.status !== "PAUSED" ||
    k.cpcBidMicros !== "100000" ||
    row(k.keyword).matchType !== "EXACT" ||
    row(k.keyword).text !== "test automatic bidding warning" ||
    k.negative === true
  )
    fail("g_setup_automatic_context_unproven");
  return {
    provider_derived_before: copy(k),
    expected_raw_after_cpc_micros: "110000",
    warning_only: true,
    commit_authorized: false,
  };
}

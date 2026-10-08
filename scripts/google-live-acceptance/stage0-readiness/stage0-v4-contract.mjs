export const canonical = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
export const hierarchyQuery =
  "SELECT customer_client.id, customer_client.client_customer, customer_client.level FROM customer_client WHERE customer_client.id = 8590146099 AND customer_client.level <= 1";
export function makeBrief(stamp, currency = "USD") {
  if (!/^\d{8}T\d{6}Z$/.test(stamp) || currency !== "USD")
    throw Error("stage0_fixture_currency_or_name_invalid");
  return {
    provider: "GOOGLE_ADS",
    account_id: "8590146099",
    campaign_name: "HM_MCP_STAGE0_T_" + stamp,
    daily_budget: { amount: "2", currency },
    bidding_strategy: "MANUAL_CPC",
    locations: [
      { name: "Алматы", country_code: "KZ", geo_target_id: "9235214" },
    ],
    languages: ["Russian"],
    utm: {
      final_url_suffix:
        "utm_source=google&utm_medium=cpc&utm_campaign={campaignid}",
    },
    ad_groups: [0, 1].map((i) => ({
      name: "Stage0 Acceptance Group " + (i + 1),
      default_bid: { amount: "0.10", currency },
      keywords: [
        "test marketing tools",
        "test advertising demo",
        "test search sample",
        "holy media testing",
        "mcp sample ads",
      ].map((text, n) => ({
        text: text + " group " + (i + 1),
        match_type: n % 2 ? "PHRASE" : "EXACT",
      })),
      rsa: [
        {
          final_url: "https://mcp.holymedia.kz/",
          headlines: [
            { text: "Test Search Campaign" },
            { text: "HolyMedia MCP Test" },
            { text: "Sample Advertising Tools" },
          ],
          descriptions: [
            {
              text: "A paused campaign for testing advertising tools and approval.",
            },
            {
              text: "Generic sample content for a controlled test environment.",
            },
          ],
        },
      ],
    })),
    assets: {
      sitelinks: [
        "Test Overview",
        "Test Tools",
        "Test Information",
        "Test Support",
      ].map((text, i) => ({
        text,
        final_url: "https://mcp.holymedia.kz/?acceptance_stage0_link=" + i,
      })),
    },
  };
}
export function invalidBrief(brief) {
  const b = JSON.parse(JSON.stringify(brief));
  b.campaign_name = b.campaign_name.replace("_T_", "_U_");
  b.ad_groups[0].rsa[0].headlines[0].text = "A".repeat(31);
  return b;
}
export function assertTPlan(plan) {
  if (
    plan.version !== 0 ||
    plan.account_id !== "8590146099" ||
    plan.intent.action !== "campaign_create" ||
    plan.operations.length > 500 ||
    plan.summary.ad_groups_count !== 2 ||
    plan.summary.keywords_count !== 10 ||
    plan.summary.rsa_count !== 2 ||
    plan.summary.assets_count !== 4
  )
    throw Error("stage0_plan_counts_invalid");
  const count = (kind) => plan.operations.filter((o) => o.kind === kind).length;
  if (
    count("campaignBudget") !== 1 ||
    count("campaign") !== 1 ||
    count("adGroup") !== 2 ||
    count("adGroupCriterion") !== 10 ||
    count("adGroupAd") !== 2 ||
    count("asset") !== 4 ||
    count("campaignAsset") !== 4
  )
    throw Error("stage0_mutation_shape_invalid");
  for (const o of plan.operations) {
    if (
      o.method !== "create" ||
      /customers\/(?!8590146099(?:\/|$))\d+/.test(canonical(o))
    )
      throw Error("stage0_foreign_or_update_operation");
    if (
      ["campaign", "adGroup", "adGroupAd"].includes(o.kind) &&
      o.fields.status !== "PAUSED"
    )
      throw Error("stage0_delivery_not_paused");
  }
  const campaign = plan.operations.find((o) => o.kind === "campaign").fields,
    budget = plan.operations.find((o) => o.kind === "campaignBudget").fields;
  if (
    campaign.advertisingChannelType !== "SEARCH" ||
    campaign.networkSettings.targetGoogleSearch !== true ||
    campaign.networkSettings.targetSearchNetwork !== false ||
    campaign.networkSettings.targetContentNetwork !== false ||
    campaign.geoTargetTypeSetting.positiveGeoTargetType !== "PRESENCE" ||
    budget.amountMicros !== "2000000" ||
    budget.explicitlyShared !== false ||
    "name" in budget
  )
    throw Error("stage0_defaults_invalid");
  return true;
}

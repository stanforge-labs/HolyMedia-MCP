import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  TARGETING_BASE_HEAD as head,
  TARGETING_READ_QUERIES as queries,
  targetingFixture as fixture,
  classifyTargetingRead,
  prepareAudienceIScenario,
  prepareGeoJScenario,
  pmaxPrerequisiteReadiness,
  crossClientReadiness,
} from "./scenario-targeting-readiness.mjs";
import { originalKeywords } from "./live-guard.mjs";
const now = Date.parse("2026-10-09T12:00:00.000Z"),
  prefix = `customers/${fixture.customer}`,
  campaign = `${prefix}/campaigns/${fixture.campaign}`,
  group = `${prefix}/adGroups/${fixture.group}`;
function proof() {
  return {
    source_head: head,
    verified_at: new Date(now).toISOString(),
    customer: {
      id: fixture.customer,
      resourceName: prefix,
      testAccount: true,
      currencyCode: "USD",
      timeZone: "Asia/Almaty",
      conversionTrackingSetting: { googleAdsConversionCustomer: prefix },
    },
    hierarchy: { id: fixture.customer, level: 1, testAccount: true },
    campaign: {
      id: fixture.campaign,
      resourceName: campaign,
      status: "PAUSED",
      advertisingChannelType: "SEARCH",
      biddingStrategyType: "MANUAL_CPC",
    },
    group: {
      id: fixture.group,
      resourceName: group,
      campaign,
      status: "PAUSED",
      targetingSetting: {
        targetRestrictions: [
          { targetingDimension: "PLACEMENT", bidOnly: true },
        ],
      },
    },
    keywords: [...originalKeywords, fixture.phrase].map((criterionId) => ({
      resourceName: `${prefix}/adGroupCriteria/${fixture.group}~${criterionId}`,
      criterionId,
      type: "KEYWORD",
      status: criterionId === fixture.phrase ? "PAUSED" : "ENABLED",
      negative: false,
      keyword: {
        text: "mock test keyword",
        matchType: criterionId === fixture.phrase ? "PHRASE" : "EXACT",
      },
    })),
    ads: [
      {
        resourceName: `${prefix}/adGroupAds/${fixture.group}~${fixture.rsa}`,
        status: "PAUSED",
        ad: { id: fixture.rsa, type: "RESPONSIVE_SEARCH_AD" },
      },
    ],
  };
}
const interest = (id = "30001", taxonomyType = "IN_MARKET") => ({
  kind: "USER_INTEREST",
  entity: {
    resourceName: `${prefix}/userInterests/${id}`,
    userInterestId: id,
    name: "MOCK inventory only",
    taxonomyType,
    launchedToAll: true,
  },
});
const iInput = () => ({
  fixture: proof(),
  catalog: [interest()],
  existing_criteria: [],
});
const jInput = () => ({
  fixture: proof(),
  city_candidates: [
    {
      resourceName: "geoTargetConstants/10001",
      id: "10001",
      name: "Astana",
      canonicalName: "Mock Astana, Kazakhstan",
      countryCode: "KZ",
      targetType: "City",
      status: "ENABLED",
    },
  ],
  district_candidates: [
    {
      resourceName: "geoTargetConstants/10002",
      id: "10002",
      name: "Mock district",
      canonicalName: "Mock district, Mock Astana, Kazakhstan",
      countryCode: "KZ",
      targetType: "District",
      status: "ENABLED",
      parentGeoTarget: "geoTargetConstants/10001",
    },
  ],
  existing_criteria: [],
  proximity: {
    latitude: 51.1,
    longitude: 71.4,
    radius: 5,
    unit: "KILOMETERS",
    source: "EXPLICIT_TEST_COORDINATES",
  },
});
const pmaxInput = () => ({
  fixture: proof(),
  conversion_actions: [],
  assets: [],
  campaigns: [],
});
const { tsImport } = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
)("tsx/esm/api");
function request(query, customer = fixture.customer) {
  return [
    `https://googleads.googleapis.com/v24/customers/${customer}/googleAds:searchStream`,
    {
      method: "POST",
      headers: { "login-customer-id": fixture.mcc },
      body: JSON.stringify({ query }),
    },
  ];
}
test("manifest permits only exact fixed TEST READs; hierarchy only in MCC", () => {
  for (const [name, query] of Object.entries(queries))
    assert.equal(
      classifyTargetingRead(
        ...request(
          query,
          name === "hierarchy" ? fixture.mcc : fixture.customer,
        ),
      ),
      "read",
    );
  assert.throws(
    () => classifyTargetingRead(...request(queries.customer, fixture.mcc)),
    { code: "scenario_non_read_blocked" },
  );
  assert.throws(() => classifyTargetingRead(...request(queries.hierarchy)), {
    code: "scenario_non_read_blocked",
  });
});
for (const change of [
  "foreign",
  "mutation",
  "validate_only",
  "extra_payload",
  "modified_query",
  "public",
  "approval",
  "login_mismatch",
])
  test(`transport blocks ${change} without any execution`, () => {
    const [url, init] = request(queries.customer);
    let target = url;
    if (change === "foreign")
      target = url.replace(fixture.customer, "9999999999");
    if (change === "mutation")
      target = url.replace("googleAds:searchStream", "googleAds:mutate");
    if (change === "validate_only")
      init.body = JSON.stringify({ validateOnly: true, operations: [] });
    if (change === "extra_payload")
      init.body = JSON.stringify({ query: queries.customer, operations: [] });
    if (change === "modified_query")
      init.body = JSON.stringify({ query: queries.customer + " LIMIT 1" });
    if (change === "public") target = "https://example.test/mcp";
    if (change === "approval") target = "http://localhost:4402/mcp/approve";
    if (change === "login_mismatch")
      init.headers = { "login-customer-id": "9999999999" };
    assert.throws(() => classifyTargetingRead(target, init));
  });
test("I prepares closed OBSERVATION intent from actual-shaped eligible row only; no change to other dimensions or inventory", () => {
  const input = iInput(),
    before = structuredClone(input),
    result = prepareAudienceIScenario(input, head, now);
  assert.equal(result.result, "PREPARED_NOT_LIVE");
  assert.equal(result.live_acceptance, "NOT_RUN");
  assert.equal(result.real_provider_calls, 0);
  assert.equal(result.real_provider_writes, 0);
  assert.deepEqual(result.preview_request, {
    tool: "google_ads_targeting_preview",
    arguments: {
      provider: "GOOGLE_ADS",
      account_id: fixture.customer,
      items: [
        {
          operation: "audience_add",
          level: "AD_GROUP",
          campaign_id: fixture.campaign,
          ad_group_id: fixture.group,
          audience: { kind: "IN_MARKET", id: "30001" },
          mode: "OBSERVATION",
        },
      ],
    },
  });
  assert.deepEqual(input, before);
  assert.match(result.preserved_criteria_digest, /^[a-f0-9]{64}$/);
  assert.equal(result.manual_approval_required, true);
  assert.ok(!("restore_request" in result));
  assert.match(result.restore_checkpoint, /exact created criterion ID/);
});
test("100 VERTICAL_GEO sample means unproven eligibility, never zero IN_MARKET inventory", () => {
  const input = iInput();
  input.catalog = Array.from({ length: 100 }, (_, i) =>
    interest(String(i + 50000), "VERTICAL_GEO"),
  );
  const r = prepareAudienceIScenario(input, head, now);
  assert.equal(r.result, "BLOCKED");
  assert.equal(r.catalog_observed_count, 100);
  assert.equal(r.absence_of_eligible_catalog_proven, false);
  assert.equal(r.catalog_coverage, "BOUNDED_SAMPLE_ONLY");
  assert.equal(r.blockers[0].source, "HOLYMEDIA");
  assert.equal(r.blockers[0].code, "audience_eligibility_not_proven");
  assert.ok(!r.preview_request);
});
test("Search availability must be real, not a wrong channel or taxonomy assumption", () => {
  const input = iInput();
  input.catalog[0].entity.launchedToAll = false;
  input.catalog[0].entity.availabilities = [
    {
      channel: {
        availabilityMode: "CHANNEL_TYPE",
        advertisingChannelType: "DISPLAY",
      },
      locale: [{ availabilityMode: "LAUNCHED_TO_ALL" }],
    },
  ];
  assert.equal(prepareAudienceIScenario(input, head, now).result, "BLOCKED");
  input.catalog[0].entity.availabilities[0].channel.advertisingChannelType =
    "SEARCH";
  assert.equal(
    prepareAudienceIScenario(input, head, now).result,
    "PREPARED_NOT_LIVE",
  );
});
test("USER_LIST and detailed demographic require selected owned references and eligibility", () => {
  const input = iInput();
  input.catalog = [
    {
      kind: "USER_LIST",
      entity: {
        resourceName: `${prefix}/userLists/30002`,
        id: "30002",
        name: "MOCK list",
        membershipStatus: "CLOSED",
        accountUserListStatus: "ENABLED",
        eligibleForSearch: true,
      },
    },
  ];
  assert.equal(prepareAudienceIScenario(input, head, now).result, "BLOCKED");
  input.catalog[0].entity.membershipStatus = "OPEN";
  assert.equal(
    prepareAudienceIScenario(input, head, now).preview_request.arguments
      .items[0].audience.kind,
    "USER_LIST",
  );
  input.catalog = [
    {
      kind: "DETAILED_DEMOGRAPHIC",
      entity: {
        resourceName: `${prefix}/detailedDemographics/30003`,
        id: "30003",
        name: "MOCK detailed taxonomy",
        launchedToAll: true,
      },
    },
  ];
  assert.equal(
    prepareAudienceIScenario(input, head, now).preview_request.arguments
      .items[0].audience.kind,
    "DETAILED_DEMOGRAPHIC",
  );
});
for (const change of [
  "test_false",
  "hierarchy",
  "source",
  "expired",
  "future",
  "campaign_enabled",
  "group_enabled",
  "original_paused",
  "phrase_enabled",
  "rsa_enabled",
  "foreign_group",
])
  test(`fixture proof rejects ${change}`, () => {
    const input = iInput(),
      p = input.fixture;
    if (change === "test_false") p.customer.testAccount = false;
    if (change === "hierarchy") p.hierarchy.id = "9999999999";
    if (change === "source") p.source_head = "0".repeat(40);
    if (change === "expired")
      p.verified_at = new Date(now - 120001).toISOString();
    if (change === "future") p.verified_at = new Date(now + 5001).toISOString();
    if (change === "campaign_enabled") p.campaign.status = "ENABLED";
    if (change === "group_enabled") p.group.status = "ENABLED";
    if (change === "original_paused") p.keywords[0].status = "PAUSED";
    if (change === "phrase_enabled") p.keywords.at(-1).status = "ENABLED";
    if (change === "rsa_enabled") p.ads[0].status = "ENABLED";
    if (change === "foreign_group")
      p.group.resourceName = "customers/9999999999/adGroups/206587491811";
    const r = prepareAudienceIScenario(input, head, now);
    assert.equal(r.result, "BLOCKED");
    assert.ok(!r.preview_request);
    assert.equal(r.real_provider_writes, 0);
  });
test("foreign catalog/duplicate IDs and unsupported CUSTOM are never silently skipped", () => {
  const input = iInput();
  input.catalog.push({
    ...interest("30002"),
    entity: {
      ...interest("30002").entity,
      resourceName: "customers/9999999999/userInterests/30002",
    },
  });
  assert.equal(
    prepareAudienceIScenario(input, head, now).blockers[0].code,
    "scenario_foreign_resource",
  );
  input.catalog = [interest(), interest()];
  assert.equal(
    prepareAudienceIScenario(input, head, now).blockers[0].code,
    "scenario_duplicate_resource",
  );
  input.catalog = [{ kind: "CUSTOM", entity: {} }];
  assert.equal(
    prepareAudienceIScenario(input, head, now).blockers[0].code,
    "scenario_catalog_kind_invalid",
  );
});
test("existing audience cannot be added again and inherited TARGETING is not silently switched", () => {
  const input = iInput();
  input.existing_criteria = [
    {
      resourceName: `${prefix}/adGroupCriteria/${fixture.group}~44`,
      adGroup: group,
      criterionId: "44",
      type: "USER_INTEREST",
      status: "ENABLED",
      userInterest: { userInterestCategory: interest().entity.resourceName },
    },
  ];
  assert.equal(prepareAudienceIScenario(input, head, now).result, "BLOCKED");
  input.existing_criteria = [];
  input.fixture.campaign.targetingSetting = {
    targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: false }],
  };
  assert.equal(
    prepareAudienceIScenario(input, head, now).blockers[0].code,
    "scenario_parent_mode_conflict",
  );
});
test("J produces city/exclusion/proximity typed rows with proven district parent and preserved criterion digest", () => {
  const input = jInput(),
    before = structuredClone(input),
    r = prepareGeoJScenario(input, head, now);
  assert.equal(r.result, "PREPARED_NOT_LIVE");
  assert.equal(r.live_acceptance, "NOT_RUN");
  assert.equal(r.preview_request.arguments.items.length, 3);
  assert.deepEqual(
    r.preview_request.arguments.items.map((x) => x.operation),
    ["geo_add", "geo_exclude", "radius_add"],
  );
  assert.deepEqual(r.resolved_geo_ids, { city: "10001", district: "10002" });
  assert.equal(
    r.preview_request.arguments.items[0].geo_target_id,
    input.city_candidates[0].id,
  );
  assert.equal(r.proximity_source, "EXPLICIT_TEST_COORDINATES");
  assert.deepEqual(input, before);
  assert.equal(r.real_provider_writes, 0);
});
for (const change of [
  "no_city",
  "ambiguous_city",
  "id_mismatch",
  "wrong_country",
  "district_parent",
  "no_coordinates",
  "invalid_coordinates",
  "radius_zero",
  "bad_unit",
  "present_city",
])
  test(`J blocks ${change} without fake resolution`, () => {
    const input = jInput();
    if (change === "no_city") input.city_candidates = [];
    if (change === "ambiguous_city")
      input.city_candidates.push({
        ...input.city_candidates[0],
        id: "10003",
        resourceName: "geoTargetConstants/10003",
      });
    if (change === "id_mismatch")
      input.city_candidates[0].resourceName = "geoTargetConstants/9999";
    if (change === "wrong_country") input.city_candidates[0].countryCode = "US";
    if (change === "district_parent")
      input.district_candidates[0].parentGeoTarget = "geoTargetConstants/9999";
    if (change === "no_coordinates") delete input.proximity;
    if (change === "invalid_coordinates") input.proximity.latitude = 100;
    if (change === "radius_zero") input.proximity.radius = 0;
    if (change === "bad_unit") input.proximity.unit = "METERS";
    if (change === "present_city")
      input.existing_criteria = [
        {
          resourceName: `${prefix}/campaignCriteria/${fixture.campaign}~44`,
          campaign,
          criterionId: "44",
          type: "LOCATION",
          status: "ENABLED",
          location: {
            geoTargetConstant: input.city_candidates[0].resourceName,
          },
        },
      ];
    const r = prepareGeoJScenario(input, head, now);
    assert.equal(r.result, "BLOCKED");
    assert.ok(!r.preview_request);
    assert.equal(r.real_provider_writes, 0);
  });
const image = (id, width, height) => ({
  resourceName: `${prefix}/assets/${id}`,
  id,
  type: "IMAGE",
  imageAsset: {
    fullSize: { widthPixels: width, heightPixels: height },
    fileSize: "2048",
    mimeType: "PNG",
  },
});
test("PMax empty actual inventories produce explicit blockers without creating goals/media", () => {
  const r = pmaxPrerequisiteReadiness(pmaxInput(), head, now);
  assert.equal(r.result, "BLOCKED");
  assert.ok(
    r.blockers.some((x) => x.code === "pmax_existing_enabled_goal_missing"),
  );
  assert.equal(
    r.blockers.filter((x) => x.code === "pmax_existing_media_missing").length,
    4,
  );
  assert.equal(r.no_inventory_absence_claim, true);
  assert.ok(!r.preview_request);
  assert.equal(r.real_provider_writes, 0);
});
test("PMax exact usable goal/image dimensions/branding flags are prerequisites, not LIVE or upload authorization", () => {
  const input = pmaxInput();
  input.conversion_actions = [
    {
      resourceName: `${prefix}/conversionActions/30010`,
      id: "30010",
      name: "MOCK goal",
      status: "ENABLED",
      ownerCustomer: prefix,
      category: "LEAD",
      origin: "WEBSITE",
      primaryForGoal: true,
    },
  ];
  input.assets = [
    image("30020", 1200, 628),
    image("30021", 300, 300),
    {
      resourceName: `${prefix}/assets/30022`,
      id: "30022",
      type: "TEXT",
      textAsset: { text: "MOCK business name" },
    },
  ];
  input.campaigns = [
    {
      resourceName: `${prefix}/campaigns/30030`,
      id: "30030",
      status: "PAUSED",
      advertisingChannelType: "PERFORMANCE_MAX",
      brandGuidelinesEnabled: true,
    },
  ];
  const before = structuredClone(input),
    r = pmaxPrerequisiteReadiness(input, head, now);
  assert.equal(r.result, "PREREQUISITES_OBSERVED_NOT_LIVE");
  assert.deepEqual(r.existing_brand_guidelines, [
    { campaign_id: "30030", enabled: true },
  ]);
  assert.deepEqual(r.existing_media_by_role.MARKETING_IMAGE, ["30020"]);
  assert.deepEqual(r.existing_media_by_role.LOGO, ["30021"]);
  assert.equal(r.live_acceptance, "NOT_RUN");
  assert.ok(!r.preview_request);
  assert.deepEqual(input, before);
  input.assets[0].imageAsset.fullSize.widthPixels = 400;
  assert.equal(pmaxPrerequisiteReadiness(input, head, now).result, "BLOCKED");
});
test("PMax rejects foreign conversion owner and current active PMax campaign", () => {
  const input = pmaxInput();
  input.conversion_actions = [
    {
      resourceName: `${prefix}/conversionActions/30010`,
      id: "30010",
      name: "MOCK",
      status: "ENABLED",
      ownerCustomer: "customers/9999999999",
      category: "LEAD",
      origin: "WEBSITE",
    },
  ];
  assert.equal(
    pmaxPrerequisiteReadiness(input, head, now).blockers[0].code,
    "scenario_foreign_resource",
  );
  input.conversion_actions = [];
  input.campaigns = [
    {
      resourceName: `${prefix}/campaigns/30030`,
      id: "30030",
      status: "ENABLED",
      advertisingChannelType: "PERFORMANCE_MAX",
      brandGuidelinesEnabled: true,
    },
  ];
  assert.equal(
    pmaxPrerequisiteReadiness(input, head, now).blockers[0].code,
    "scenario_pmax_campaign_unproven",
  );
});
test("Q/R/S private client preparation never declares LIVE PASS even when connection flags true", () => {
  const input = {
    candidate_source_head: head,
    chatgpt_connected: false,
    second_client_connected: false,
    profile_tool_count: 46,
    manual_consent_required: true,
  };
  const r = crossClientReadiness(input, head);
  assert.equal(r.Q, "BLOCKED_NOT_CONNECTED");
  assert.equal(r.R, "BLOCKED_NOT_CONNECTED");
  assert.equal(r.live_acceptance, "NOT_RUN");
  assert.ok(!r.next_action.includes("https://"));
  input.chatgpt_connected = true;
  input.second_client_connected = true;
  assert.equal(
    crossClientReadiness(input, head).Q,
    "CONNECTED_REQUIRES_LIVE_ACCEPTANCE",
  );
  input.manual_consent_required = false;
  assert.equal(
    crossClientReadiness(input, head).S,
    "BLOCKED_MANUAL_CONSENT_MISSING",
  );
});
test("closed inputs/secret-bearing nested records are rejected without echoing values", () => {
  const input = iInput(),
    marker = "do-not-emit-this-test-marker";
  input.fixture.customer.extra = marker;
  let r = prepareAudienceIScenario(input, head, now);
  assert.equal(r.result, "BLOCKED");
  assert.ok(!JSON.stringify(r).includes(marker));
  delete input.fixture.customer.extra;
  input.catalog[0].entity.availabilities = [
    { channel: { availabilityMode: "ALL_CHANNELS", accessToken: marker } },
  ];
  r = prepareAudienceIScenario(input, head, now);
  assert.equal(r.blockers[0].code, "scenario_sensitive_input_rejected");
  assert.ok(!JSON.stringify(r).includes(marker));
  input.catalog = Array.from({ length: 102 }, (_, i) =>
    interest(String(i + 50000)),
  );
  assert.equal(
    prepareAudienceIScenario(input, head, now).blockers[0].code,
    "scenario_inventory_limit",
  );
  const cli = {
    candidate_source_head: head,
    chatgpt_connected: true,
    second_client_connected: true,
    profile_tool_count: 51,
    manual_consent_required: true,
  };
  assert.equal(crossClientReadiness(cli, head).result, "BLOCKED");
});
test("prepared I/J arguments pass stock Stage3 parser and builder with mock READ only", async () => {
  const { stage3ToolIntent } = await tsImport(
      "../../../apps/api/src/mcp/mcp-google-stage3-schema.ts",
      import.meta.url,
    ),
    { buildStage3Plan } = await tsImport(
      "../../../apps/api/src/providers/google-ads-stage3.ts",
      import.meta.url,
    );
  for (const input of [iInput(), jInput()]) {
    const result =
        "catalog" in input
          ? prepareAudienceIScenario(input, head, now)
          : prepareGeoJScenario(input, head, now),
      p = input.fixture;
    const typed = stage3ToolIntent(
      result.preview_request.tool,
      result.preview_request.arguments,
    );
    const read = async (q) => {
      if (q.includes(" FROM customer"))
        return [{ customer: structuredClone(p.customer) }];
      if (
        q.includes(" FROM campaign_criterion") ||
        q.includes(" FROM ad_group_criterion")
      )
        return [];
      if (q.includes(" FROM user_interest"))
        return [{ userInterest: structuredClone(input.catalog[0].entity) }];
      if (q.includes(" FROM geo_target_constant")) {
        const found = [
          ...input.city_candidates,
          ...input.district_candidates,
        ].filter((x) => q.includes(`id = ${x.id}`));
        return found.map((geoTargetConstant) => ({
          geoTargetConstant: structuredClone(geoTargetConstant),
        }));
      }
      if (q.includes(" FROM ad_group"))
        return [{ adGroup: structuredClone(p.group) }];
      if (q.includes(" FROM campaign"))
        return [{ campaign: structuredClone(p.campaign) }];
      throw Error("unexpected_mock_query");
    };
    const plan = await buildStage3Plan(
      fixture.customer,
      typed,
      read,
      "catalog" in input
        ? undefined
        : async (name) =>
            [...input.city_candidates, ...input.district_candidates]
              .filter((x) => x.name === name)
              .map((geoTargetConstant) => ({
                geoTargetConstant: structuredClone(geoTargetConstant),
              })),
    );
    assert.equal(plan.account_id, fixture.customer);
    if ("catalog" in input) {
      assert.equal(plan.operations.length, 2);
      assert.equal(
        plan.operations[0].update_mask,
        "targeting_setting.target_restriction_operations",
      );
      assert.equal(
        plan.operations[0].expected.targetingSetting.targetRestrictions[0]
          .targetingDimension,
        "PLACEMENT",
      );
      assert.equal(
        plan.operations[1].fields.userInterest.userInterestCategory,
        input.catalog[0].entity.resourceName,
      );
      assert.equal(plan.items[0].after.audience_mode, "OBSERVATION");
    } else {
      assert.equal(plan.operations.length, 3);
      assert.equal(
        plan.operations[0].fields.location.geoTargetConstant,
        input.city_candidates[0].resourceName,
      );
      assert.equal(plan.operations[1].fields.negative, true);
      assert.equal(
        plan.operations[2].fields.proximity.radiusUnits,
        "KILOMETERS",
      );
    }
  }
});

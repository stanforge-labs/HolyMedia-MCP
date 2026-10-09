// Pure preparation only: no fetch, preview, approval, commit, or filesystem writes.
import { createHash } from "node:crypto";
import { URL } from "node:url";
const { Headers } = globalThis;
import { originalKeywords } from "./live-guard.mjs";

export const TARGETING_BASE_HEAD = "94edb8c3c082bbd8951bf166e8797e83f3b8a5dc";
export const targetingFixture = Object.freeze({
  customer: "8590146099",
  mcc: "4378327049",
  campaign: "24324170853",
  group: "206587491811",
  phrase: "11479221",
  rsa: "827349040712",
});
const prefix = `customers/${targetingFixture.customer}`;
const campaignResource = `${prefix}/campaigns/${targetingFixture.campaign}`;
const groupResource = `${prefix}/adGroups/${targetingFixture.group}`;
const geoFields =
  "geo_target_constant.resource_name, geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.country_code, geo_target_constant.target_type, geo_target_constant.status, geo_target_constant.parent_geo_target";
export const TARGETING_READ_QUERIES = Object.freeze({
  customer:
    "SELECT customer.id, customer.resource_name, customer.test_account, customer.currency_code, customer.time_zone, customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer",
  hierarchy:
    "SELECT customer_client.id, customer_client.level, customer_client.test_account FROM customer_client WHERE customer_client.id = 8590146099 AND customer_client.level = 1",
  campaign:
    "SELECT campaign.id, campaign.resource_name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.targeting_setting.target_restrictions FROM campaign WHERE campaign.id = 24324170853",
  group:
    "SELECT campaign.id, ad_group.id, ad_group.resource_name, ad_group.campaign, ad_group.status, ad_group.targeting_setting.target_restrictions FROM ad_group WHERE campaign.id = 24324170853 AND ad_group.id = 206587491811",
  keywords:
    "SELECT campaign.id, ad_group.id, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.type, ad_group_criterion.negative, ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE campaign.id = 24324170853 AND ad_group.id = 206587491811 AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != REMOVED LIMIT 501",
  ads: "SELECT campaign.id, ad_group.id, ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.type FROM ad_group_ad WHERE campaign.id = 24324170853 AND ad_group.id = 206587491811 AND ad_group_ad.status != REMOVED LIMIT 501",
  groupAudiences:
    "SELECT ad_group_criterion.resource_name, ad_group_criterion.ad_group, ad_group_criterion.criterion_id, ad_group_criterion.type, ad_group_criterion.negative, ad_group_criterion.status, ad_group_criterion.user_list.user_list, ad_group_criterion.user_interest.user_interest_category, ad_group_criterion.extended_demographic.extended_demographic_id FROM ad_group_criterion WHERE ad_group_criterion.ad_group = 'customers/8590146099/adGroups/206587491811' AND ad_group_criterion.status != REMOVED LIMIT 501",
  campaignCriteria:
    "SELECT campaign_criterion.resource_name, campaign_criterion.campaign, campaign_criterion.criterion_id, campaign_criterion.type, campaign_criterion.negative, campaign_criterion.status, campaign_criterion.bid_modifier, campaign_criterion.device.type, campaign_criterion.location.geo_target_constant, campaign_criterion.proximity.geo_point.latitude_in_micro_degrees, campaign_criterion.proximity.geo_point.longitude_in_micro_degrees, campaign_criterion.proximity.radius, campaign_criterion.proximity.radius_units, campaign_criterion.language.language_constant FROM campaign_criterion WHERE campaign_criterion.campaign = 'customers/8590146099/campaigns/24324170853' AND campaign_criterion.status != REMOVED LIMIT 501",
  eligibleInterests:
    "SELECT user_interest.resource_name, user_interest.user_interest_id, user_interest.name, user_interest.taxonomy_type, user_interest.launched_to_all, user_interest.availabilities FROM user_interest WHERE user_interest.taxonomy_type IN ('IN_MARKET', 'AFFINITY') LIMIT 101",
  userLists:
    "SELECT user_list.resource_name, user_list.id, user_list.name, user_list.membership_status, user_list.account_user_list_status, user_list.eligible_for_search, user_list.eligible_for_display FROM user_list LIMIT 101",
  detailedDemographics:
    "SELECT detailed_demographic.resource_name, detailed_demographic.id, detailed_demographic.name, detailed_demographic.launched_to_all, detailed_demographic.availabilities FROM detailed_demographic LIMIT 101",
  city: `SELECT ${geoFields} FROM geo_target_constant WHERE geo_target_constant.name = 'Astana' AND geo_target_constant.country_code = 'KZ' AND geo_target_constant.target_type = 'City' AND geo_target_constant.status = 'ENABLED' LIMIT 101`,
  districts: `SELECT ${geoFields} FROM geo_target_constant WHERE geo_target_constant.country_code = 'KZ' AND geo_target_constant.target_type IN ('District', 'Borough', 'Municipality') AND geo_target_constant.status = 'ENABLED' LIMIT 101`,
  conversions:
    "SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.owner_customer, conversion_action.category, conversion_action.origin, conversion_action.primary_for_goal FROM conversion_action LIMIT 101",
  assets:
    "SELECT asset.resource_name, asset.id, asset.type, asset.text_asset.text, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels, asset.image_asset.file_size, asset.image_asset.mime_type FROM asset WHERE asset.type IN ('IMAGE', 'TEXT') LIMIT 101",
  pmaxCampaigns:
    "SELECT campaign.resource_name, campaign.id, campaign.status, campaign.advertising_channel_type, campaign.brand_guidelines_enabled FROM campaign WHERE campaign.advertising_channel_type = PERFORMANCE_MAX AND campaign.status != REMOVED LIMIT 101",
});
const fail = (code, path) => {
  const e = new Error(code);
  e.code = code;
  e.source = "HOLYMEDIA";
  e.field_path = path;
  throw e;
};
const row = (v, path) => {
  if (!v || typeof v !== "object" || Array.isArray(v))
    fail("scenario_object_invalid", path);
  return v;
};
function closed(value, allowed, required, path) {
  const r = row(value, path);
  if (
    Object.keys(r).some((k) => !allowed.includes(k)) ||
    required.some((k) => r[k] === undefined)
  )
    fail("scenario_fields_invalid", path);
  return r;
}
const str = (v, max, path) => {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    [...v].some((c) => c.codePointAt(0) < 32)
  )
    fail("scenario_text_invalid", path);
  return v;
};
const id = (v, path) => {
  if (typeof v !== "string" || !/^\d{1,20}$/u.test(v))
    fail("scenario_id_invalid", path);
  return v;
};
const list = (v, max, path) => {
  if (!Array.isArray(v) || v.length > max)
    fail("scenario_inventory_limit", path);
  return v;
};
function owner(resource, kind, path) {
  if (
    typeof resource !== "string" ||
    !new RegExp(`^${prefix}/${kind}/[0-9]{1,20}(?:~[0-9]{1,20})?$`).test(
      resource,
    )
  )
    fail("scenario_foreign_resource", path);
  return resource;
}
function duplicate(items, key, path) {
  if (new Set(items.map(key)).size !== items.length)
    fail("scenario_duplicate_resource", path);
}
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const blocker = (code, field_path, message) => ({
  source: "HOLYMEDIA",
  code,
  field_path,
  message,
});
function secretFree(value, path = "input", depth = 0) {
  if (depth > 16) fail("scenario_input_depth_invalid", path);
  if (value && typeof value === "object")
    for (const [key, v] of Object.entries(value)) {
      if (
        /^(?:access_?token|refresh_?token|client_?secret|authorization|cookies?|headers?|encryption_?keys?|encrypted_?payload|data_?base64|password|oauth_?code|oauth_?state)$/iu.test(
          key,
        )
      )
        fail("scenario_sensitive_input_rejected", path);
      secretFree(v, `${path}.${key}`, depth + 1);
    }
}
function report(test, raw, fn) {
  const safety = {
    acceptance_test: test,
    real_provider_calls: 0,
    real_provider_writes: 0,
    production_changed: false,
    main_changed: false,
  };
  try {
    secretFree(raw);
    return { ...safety, result: "PREPARED_NOT_LIVE", ...fn() };
  } catch (e) {
    if (e.source !== "HOLYMEDIA") throw e;
    return {
      ...safety,
      result: "BLOCKED",
      blockers: [
        blocker(
          e.code,
          e.field_path,
          "TEST proof/typed inventory отсутствуют или не прошли guard; preview/commit не выполнялись.",
        ),
      ],
    };
  }
}
export function classifyTargetingRead(input, init = {}) {
  let url;
  try {
    url = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url,
    );
  } catch {
    fail("scenario_non_read_blocked", "request.url");
  }
  if (
    url.origin !== "https://googleads.googleapis.com" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (init.method ?? "GET").toUpperCase() !== "POST" ||
    new Headers(init.headers).get("login-customer-id") !== targetingFixture.mcc
  )
    fail("scenario_non_read_blocked", "request");
  let body;
  try {
    body = JSON.parse(String(init.body));
  } catch {
    fail("scenario_non_read_blocked", "request.body");
  }
  closed(body, ["query"], ["query"], "request.body");
  if (
    url.pathname ===
      `/v24/customers/${targetingFixture.mcc}/googleAds:searchStream` &&
    body.query === TARGETING_READ_QUERIES.hierarchy
  )
    return "read";
  if (
    url.pathname ===
      `/v24/customers/${targetingFixture.customer}/googleAds:searchStream` &&
    Object.values(TARGETING_READ_QUERIES).includes(body.query) &&
    body.query !== TARGETING_READ_QUERIES.hierarchy
  )
    return "read";
  fail("scenario_non_read_blocked", "request.query");
}
function restrictions(value, path) {
  if (value === undefined) return [];
  const r = closed(value, ["targetRestrictions"], ["targetRestrictions"], path),
    items = list(r.targetRestrictions, 20, path);
  for (const [i, v] of items.entries()) {
    const x = closed(
      v,
      ["targetingDimension", "bidOnly"],
      ["targetingDimension"],
      `${path}.${i}`,
    );
    str(x.targetingDimension, 80, `${path}.${i}`);
    if (x.bidOnly !== undefined && typeof x.bidOnly !== "boolean")
      fail("scenario_mode_invalid", path);
  }
  duplicate(items, (x) => x.targetingDimension, path);
  return items;
}
function fixtureProof(raw, expectedSource, now) {
  const p = closed(
    raw,
    [
      "source_head",
      "verified_at",
      "customer",
      "hierarchy",
      "campaign",
      "group",
      "keywords",
      "ads",
    ],
    [
      "source_head",
      "verified_at",
      "customer",
      "hierarchy",
      "campaign",
      "group",
      "keywords",
      "ads",
    ],
    "fixture",
  );
  if (
    !/^[a-f0-9]{40}$/u.test(expectedSource ?? "") ||
    p.source_head !== expectedSource
  )
    fail("scenario_source_unproven", "fixture.source_head");
  const age = now - Date.parse(p.verified_at);
  if (!Number.isFinite(age) || age < -5000 || age > 120000)
    fail("scenario_proof_expired", "fixture.verified_at");
  const c = closed(
    p.customer,
    [
      "id",
      "resourceName",
      "testAccount",
      "currencyCode",
      "timeZone",
      "conversionTrackingSetting",
    ],
    ["id", "resourceName", "testAccount", "currencyCode", "timeZone"],
    "fixture.customer",
  );
  if (
    c.id !== targetingFixture.customer ||
    c.resourceName !== prefix ||
    c.testAccount !== true ||
    !/^[A-Z]{3}$/u.test(c.currencyCode ?? "")
  )
    fail("scenario_test_customer_unproven", "fixture.customer");
  str(c.timeZone, 100, "fixture.customer.timeZone");
  try {
    new Intl.DateTimeFormat("en", { timeZone: c.timeZone });
  } catch {
    fail("scenario_timezone_invalid", "fixture.customer.timeZone");
  }
  if (c.conversionTrackingSetting !== undefined)
    closed(
      c.conversionTrackingSetting,
      ["googleAdsConversionCustomer"],
      ["googleAdsConversionCustomer"],
      "fixture.customer.conversionTrackingSetting",
    );
  const h = closed(
    p.hierarchy,
    ["id", "level", "testAccount"],
    ["id", "level", "testAccount"],
    "fixture.hierarchy",
  );
  if (
    h.id !== targetingFixture.customer ||
    h.level !== 1 ||
    h.testAccount !== true
  )
    fail("scenario_hierarchy_unproven", "fixture.hierarchy");
  const campaign = closed(
    p.campaign,
    [
      "id",
      "resourceName",
      "status",
      "advertisingChannelType",
      "biddingStrategyType",
      "targetingSetting",
    ],
    [
      "id",
      "resourceName",
      "status",
      "advertisingChannelType",
      "biddingStrategyType",
    ],
    "fixture.campaign",
  );
  if (
    campaign.id !== targetingFixture.campaign ||
    campaign.resourceName !== campaignResource ||
    campaign.status !== "PAUSED" ||
    campaign.advertisingChannelType !== "SEARCH"
  )
    fail("scenario_fixture_changed", "fixture.campaign");
  const g = closed(
    p.group,
    ["id", "resourceName", "campaign", "status", "targetingSetting"],
    ["id", "resourceName", "campaign", "status"],
    "fixture.group",
  );
  if (
    g.id !== targetingFixture.group ||
    g.resourceName !== groupResource ||
    g.campaign !== campaignResource ||
    g.status !== "PAUSED"
  )
    fail("scenario_fixture_changed", "fixture.group");
  restrictions(campaign.targetingSetting, "fixture.campaign.targetingSetting");
  restrictions(g.targetingSetting, "fixture.group.targetingSetting");
  const keywords = list(p.keywords, 500, "fixture.keywords");
  for (const [i, k] of keywords.entries()) {
    closed(
      k,
      ["resourceName", "criterionId", "type", "status", "negative", "keyword"],
      ["resourceName", "criterionId", "type", "status", "negative", "keyword"],
      `fixture.keywords.${i}`,
    );
    id(k.criterionId, `fixture.keywords.${i}.criterionId`);
    if (
      k.resourceName !==
        `${prefix}/adGroupCriteria/${targetingFixture.group}~${k.criterionId}` ||
      k.type !== "KEYWORD" ||
      k.negative !== false
    )
      fail("scenario_foreign_resource", `fixture.keywords.${i}`);
    const text = closed(
      k.keyword,
      ["text", "matchType"],
      ["text", "matchType"],
      `fixture.keywords.${i}.keyword`,
    );
    str(text.text, 80, `fixture.keywords.${i}.keyword.text`);
    if (!["EXACT", "PHRASE", "BROAD"].includes(text.matchType))
      fail("scenario_match_invalid", `fixture.keywords.${i}.keyword.matchType`);
  }
  duplicate(keywords, (k) => k.resourceName, "fixture.keywords");
  const originals = keywords.filter((k) =>
      originalKeywords.includes(k.criterionId),
    ),
    phrase = keywords.find((k) => k.criterionId === targetingFixture.phrase);
  if (
    originals.length !== 20 ||
    originals.some((k) => k.status !== "ENABLED") ||
    !phrase ||
    phrase.status !== "PAUSED" ||
    keywords.length !== 21
  )
    fail("scenario_fixture_changed", "fixture.keywords");
  const ads = list(p.ads, 500, "fixture.ads");
  for (const [i, a] of ads.entries()) {
    closed(
      a,
      ["resourceName", "status", "ad"],
      ["resourceName", "status", "ad"],
      `fixture.ads.${i}`,
    );
    const ad = closed(
      a.ad,
      ["id", "type"],
      ["id", "type"],
      `fixture.ads.${i}.ad`,
    );
    id(ad.id, `fixture.ads.${i}.ad.id`);
    if (
      a.resourceName !==
        `${prefix}/adGroupAds/${targetingFixture.group}~${ad.id}` ||
      a.status !== "PAUSED"
    )
      fail("scenario_fixture_changed", `fixture.ads.${i}`);
  }
  if (
    ads.length !== 1 ||
    ads[0].ad.id !== targetingFixture.rsa ||
    ads[0].ad.type !== "RESPONSIVE_SEARCH_AD"
  )
    fail("scenario_fixture_changed", "fixture.ads");
  return p;
}
function actualCriteria(raw, level, path) {
  const criteria = list(raw, 500, path),
    kind = level === "CAMPAIGN" ? "campaignCriteria" : "adGroupCriteria",
    parentField = level === "CAMPAIGN" ? "campaign" : "adGroup",
    parent = level === "CAMPAIGN" ? campaignResource : groupResource;
  for (const [i, x] of criteria.entries()) {
    closed(
      x,
      [
        "resourceName",
        parentField,
        "criterionId",
        "type",
        "status",
        "negative",
        "userList",
        "userInterest",
        "extendedDemographic",
        "location",
        "language",
        "proximity",
      ],
      ["resourceName", parentField, "criterionId", "type", "status"],
      `${path}.${i}`,
    );
    owner(x.resourceName, kind, `${path}.${i}.resourceName`);
    id(x.criterionId, `${path}.${i}.criterionId`);
    if (
      x[parentField] !== parent ||
      x.resourceName !==
        `${prefix}/${kind}/${level === "CAMPAIGN" ? targetingFixture.campaign : targetingFixture.group}~${x.criterionId}` ||
      !["PAUSED", "ENABLED"].includes(x.status) ||
      (x.negative !== undefined && typeof x.negative !== "boolean")
    )
      fail("scenario_foreign_resource", `${path}.${i}`);
  }
  duplicate(criteria, (x) => x.resourceName, path);
  return criteria;
}
function availability(a) {
  return (
    a.launchedToAll === true ||
    (Array.isArray(a.availabilities) &&
      a.availabilities.some((v) => {
        const channel = v?.channel;
        return (
          (channel?.availabilityMode === "ALL_CHANNELS" ||
            (channel?.advertisingChannelType === "SEARCH" &&
              (channel.availabilityMode === "CHANNEL_TYPE" ||
                (channel.availabilityMode === "CHANNEL_TYPE_AND_SUBTYPES" &&
                  channel.includeDefaultChannelSubType === true)))) &&
          Array.isArray(v.locale) &&
          v.locale.some((l) => l.availabilityMode === "LAUNCHED_TO_ALL")
        );
      }))
  );
}
export function prepareAudienceIScenario(
  raw,
  expectedSource,
  now = Date.now(),
) {
  return report("I", raw, () => {
    const r = closed(
        raw,
        ["fixture", "catalog", "existing_criteria"],
        ["fixture", "catalog", "existing_criteria"],
        "I",
      ),
      p = fixtureProof(r.fixture, expectedSource, now),
      existing = actualCriteria(
        r.existing_criteria,
        "AD_GROUP",
        "I.existing_criteria",
      ),
      catalog = list(r.catalog, 101, "I.catalog");
    const eligible = [];
    for (const [i, entry] of catalog.entries()) {
      const x = closed(
          entry,
          ["kind", "entity"],
          ["kind", "entity"],
          `I.catalog.${i}`,
        ),
        a = row(x.entity, `I.catalog.${i}.entity`);
      if (x.kind === "USER_LIST") {
        closed(
          a,
          [
            "resourceName",
            "id",
            "name",
            "membershipStatus",
            "accountUserListStatus",
            "eligibleForSearch",
            "eligibleForDisplay",
          ],
          [
            "resourceName",
            "id",
            "name",
            "membershipStatus",
            "accountUserListStatus",
            "eligibleForSearch",
          ],
          `I.catalog.${i}`,
        );
        owner(a.resourceName, "userLists", `I.catalog.${i}.resourceName`);
        id(a.id, `I.catalog.${i}.id`);
        if (a.resourceName !== `${prefix}/userLists/${a.id}`)
          fail("scenario_catalog_id_mismatch", `I.catalog.${i}`);
        if (
          a.membershipStatus === "OPEN" &&
          a.accountUserListStatus === "ENABLED" &&
          a.eligibleForSearch === true
        )
          eligible.push({ kind: x.kind, id: a.id, resource: a.resourceName });
      } else if (x.kind === "USER_INTEREST") {
        closed(
          a,
          [
            "resourceName",
            "userInterestId",
            "name",
            "taxonomyType",
            "launchedToAll",
            "availabilities",
          ],
          ["resourceName", "userInterestId", "name", "taxonomyType"],
          `I.catalog.${i}`,
        );
        owner(a.resourceName, "userInterests", `I.catalog.${i}.resourceName`);
        id(a.userInterestId, `I.catalog.${i}.id`);
        if (a.resourceName !== `${prefix}/userInterests/${a.userInterestId}`)
          fail("scenario_catalog_id_mismatch", `I.catalog.${i}`);
        if (
          ["IN_MARKET", "AFFINITY"].includes(a.taxonomyType) &&
          availability(a)
        )
          eligible.push({
            kind: a.taxonomyType,
            id: a.userInterestId,
            resource: a.resourceName,
          });
      } else if (x.kind === "DETAILED_DEMOGRAPHIC") {
        closed(
          a,
          ["resourceName", "id", "name", "launchedToAll", "availabilities"],
          ["resourceName", "id", "name"],
          `I.catalog.${i}`,
        );
        owner(
          a.resourceName,
          "detailedDemographics",
          `I.catalog.${i}.resourceName`,
        );
        id(a.id, `I.catalog.${i}.id`);
        if (a.resourceName !== `${prefix}/detailedDemographics/${a.id}`)
          fail("scenario_catalog_id_mismatch", `I.catalog.${i}`);
        if (availability(a))
          eligible.push({ kind: x.kind, id: a.id, resource: a.resourceName });
      } else fail("scenario_catalog_kind_invalid", `I.catalog.${i}.kind`);
      str(a.name, 255, `I.catalog.${i}.name`);
    }
    duplicate(catalog, (x) => x.entity.resourceName, "I.catalog");
    const usable = eligible.filter(
      (a) =>
        !existing.some(
          (c) =>
            c.userList?.userList === a.resource ||
            c.userInterest?.userInterestCategory === a.resource ||
            c.extendedDemographic?.extendedDemographicId === a.id,
        ),
    );
    if (!usable.length)
      return {
        result: "BLOCKED",
        blockers: [
          blocker(
            "audience_eligibility_not_proven",
            "I.catalog",
            "В bounded inventory нет доказанного нового eligible Search audience; 100 VERTICAL_GEO не доказывают отсутствие IN_MARKET/AFFINITY. Нужен targeted provider catalog READ, IDs не выдумываются.",
          ),
        ],
        catalog_observed_count: catalog.length,
        catalog_coverage: "BOUNDED_SAMPLE_ONLY",
        absence_of_eligible_catalog_proven: false,
      };
    const parentMode = restrictions(
        p.campaign.targetingSetting,
        "I.campaign.mode",
      ),
      groupMode = restrictions(p.group.targetingSetting, "I.group.mode");
    if (
      (parentMode.length && groupMode.length) ||
      (parentMode.length &&
        !parentMode.some(
          (x) => x.targetingDimension === "AUDIENCE" && x.bidOnly === true,
        ))
    )
      fail("scenario_parent_mode_conflict", "I.mode");
    const selected = usable.sort((a, b) =>
      a.resource.localeCompare(b.resource, "en"),
    )[0];
    return {
      source_head: expectedSource,
      fixture_digest: hash(p),
      preserved_criteria_digest: hash(existing),
      catalog_observed_count: catalog.length,
      absence_of_eligible_catalog_proven: false,
      audience_mode: "OBSERVATION",
      mode_impact:
        "Only selected group audience dimension; stock builder proves parent compatibility and preserves other dimensions.",
      preview_request: {
        tool: "google_ads_targeting_preview",
        arguments: {
          provider: "GOOGLE_ADS",
          account_id: targetingFixture.customer,
          items: [
            {
              operation: "audience_add",
              level: "AD_GROUP",
              campaign_id: targetingFixture.campaign,
              ad_group_id: targetingFixture.group,
              audience: { kind: selected.kind, id: selected.id },
              mode: "OBSERVATION",
            },
          ],
        },
      },
      restore_checkpoint:
        "After VERIFIED add, read exact created criterion ID; separate removal preview + irreversible acknowledgement + NEW human approval. Never remove an existing criterion or invent the future ID.",
      manual_approval_required: true,
      live_acceptance: "NOT_RUN",
    };
  });
}
function geo(v, path) {
  const g = closed(
    v,
    [
      "resourceName",
      "id",
      "name",
      "canonicalName",
      "countryCode",
      "targetType",
      "status",
      "parentGeoTarget",
    ],
    [
      "resourceName",
      "id",
      "name",
      "canonicalName",
      "countryCode",
      "targetType",
      "status",
    ],
    path,
  );
  id(g.id, `${path}.id`);
  str(g.name, 120, `${path}.name`);
  str(g.canonicalName, 255, `${path}.canonicalName`);
  if (
    g.resourceName !== `geoTargetConstants/${g.id}` ||
    g.countryCode !== "KZ" ||
    g.status !== "ENABLED" ||
    (g.parentGeoTarget !== undefined &&
      !/^geoTargetConstants\/[0-9]{1,20}$/u.test(g.parentGeoTarget))
  )
    fail("scenario_geo_proof_invalid", path);
  return g;
}
export function prepareGeoJScenario(raw, expectedSource, now = Date.now()) {
  return report("J", raw, () => {
    const r = closed(
        raw,
        [
          "fixture",
          "city_candidates",
          "district_candidates",
          "existing_criteria",
          "proximity",
        ],
        [
          "fixture",
          "city_candidates",
          "district_candidates",
          "existing_criteria",
        ],
        "J",
      ),
      p = fixtureProof(r.fixture, expectedSource, now),
      existing = actualCriteria(
        r.existing_criteria,
        "CAMPAIGN",
        "J.existing_criteria",
      ),
      cities = list(r.city_candidates, 101, "J.city_candidates").map((x, i) =>
        geo(x, `J.city_candidates.${i}`),
      ),
      districts = list(r.district_candidates, 101, "J.district_candidates").map(
        (x, i) => geo(x, `J.district_candidates.${i}`),
      );
    duplicate(cities, (x) => x.resourceName, "J.city_candidates");
    duplicate(districts, (x) => x.resourceName, "J.district_candidates");
    const cityCandidates = cities.filter(
      (x) => x.name === "Astana" && x.targetType === "City",
    );
    if (cityCandidates.length !== 1)
      fail("scenario_city_not_resolved", "J.city_candidates");
    const city = cityCandidates[0],
      eligibleDistricts = districts.filter(
        (x) =>
          ["District", "Borough", "Municipality"].includes(x.targetType) &&
          x.parentGeoTarget === city.resourceName &&
          !existing.some(
            (c) => c.location?.geoTargetConstant === x.resourceName,
          ),
      );
    if (!eligibleDistricts.length)
      fail("scenario_district_parent_unproven", "J.district_candidates");
    if (
      existing.some((c) => c.location?.geoTargetConstant === city.resourceName)
    )
      fail("scenario_geo_already_present", "J.city_candidates");
    if (!r.proximity)
      return {
        result: "BLOCKED",
        blockers: [
          blocker(
            "scenario_proximity_coordinates_required",
            "J.proximity",
            "GeoTargetConstant не содержит координат центра. Нужны отдельные explicit TEST latitude/longitude; координаты Astana не угадываются.",
          ),
        ],
        resolved_city_id: city.id,
        resolved_district_count: eligibleDistricts.length,
        live_acceptance: "NOT_RUN",
      };
    const prox = closed(
      r.proximity,
      ["latitude", "longitude", "radius", "unit", "source"],
      ["latitude", "longitude", "radius", "unit", "source"],
      "J.proximity",
    );
    if (
      !Number.isFinite(prox.latitude) ||
      prox.latitude < -90 ||
      prox.latitude > 90 ||
      !Number.isFinite(prox.longitude) ||
      prox.longitude < -180 ||
      prox.longitude > 180 ||
      !Number.isFinite(prox.radius) ||
      prox.radius < 1 ||
      prox.radius > 500 ||
      !["KILOMETERS", "MILES"].includes(prox.unit) ||
      prox.source !== "EXPLICIT_TEST_COORDINATES"
    )
      fail("scenario_proximity_invalid", "J.proximity");
    const district = eligibleDistricts.sort((a, b) =>
        a.resourceName.localeCompare(b.resourceName, "en"),
      )[0],
      point = {
        latitudeInMicroDegrees: Math.round(prox.latitude * 1e6),
        longitudeInMicroDegrees: Math.round(prox.longitude * 1e6),
      };
    if (
      existing.some(
        (c) =>
          c.proximity?.geoPoint?.latitudeInMicroDegrees ===
            point.latitudeInMicroDegrees &&
          c.proximity?.geoPoint?.longitudeInMicroDegrees ===
            point.longitudeInMicroDegrees &&
          c.proximity?.radius === prox.radius &&
          c.proximity?.radiusUnits === prox.unit,
      )
    )
      fail("scenario_proximity_already_present", "J.proximity");
    const placement = {
      level: "CAMPAIGN",
      campaign_id: targetingFixture.campaign,
    };
    return {
      source_head: expectedSource,
      fixture_digest: hash(p),
      preserved_criteria_digest: hash(existing),
      resolved_geo_ids: { city: city.id, district: district.id },
      proximity_source: prox.source,
      preview_request: {
        tool: "google_ads_targeting_preview",
        arguments: {
          provider: "GOOGLE_ADS",
          account_id: targetingFixture.customer,
          items: [
            {
              operation: "geo_add",
              ...placement,
              name: city.name,
              country_code: "KZ",
              geo_target_id: city.id,
            },
            {
              operation: "geo_exclude",
              ...placement,
              name: district.name,
              country_code: "KZ",
              geo_target_id: district.id,
            },
            {
              operation: "radius_add",
              ...placement,
              latitude: prox.latitude,
              longitude: prox.longitude,
              radius: prox.radius,
              unit: prox.unit,
            },
          ],
        },
      },
      restore_checkpoint:
        "Record only three newly created exact campaign criterion IDs after VERIFIED reread; separate controlled removal previews/human approvals. Existing geo/language/proximity criteria must match preserved snapshot.",
      manual_approval_required: true,
      live_acceptance: "NOT_RUN",
    };
  });
}
export function pmaxPrerequisiteReadiness(
  raw,
  expectedSource,
  now = Date.now(),
) {
  return report("PMAX_PREREQUISITES", raw, () => {
    const r = closed(
        raw,
        ["fixture", "conversion_actions", "assets", "campaigns"],
        ["fixture", "conversion_actions", "assets", "campaigns"],
        "PMax",
      ),
      p = fixtureProof(r.fixture, expectedSource, now),
      actions = list(r.conversion_actions, 101, "PMax.conversion_actions"),
      assets = list(r.assets, 101, "PMax.assets"),
      campaigns = list(r.campaigns, 101, "PMax.campaigns"),
      blockers = [];
    const tracking = p.customer.conversionTrackingSetting;
    if (tracking?.googleAdsConversionCustomer !== prefix)
      blockers.push(
        blocker(
          "pmax_same_account_goal_owner_unproven",
          "PMax.conversion_tracking",
          "Same-account conversion customer обязателен; cross-account goals не копируются и не настраиваются этим пакетом.",
        ),
      );
    const usableGoals = [];
    for (const [i, a] of actions.entries()) {
      closed(
        a,
        [
          "resourceName",
          "id",
          "name",
          "status",
          "ownerCustomer",
          "category",
          "origin",
          "primaryForGoal",
        ],
        [
          "resourceName",
          "id",
          "name",
          "status",
          "ownerCustomer",
          "category",
          "origin",
        ],
        `PMax.conversion_actions.${i}`,
      );
      owner(
        a.resourceName,
        "conversionActions",
        `PMax.conversion_actions.${i}`,
      );
      id(a.id, `PMax.conversion_actions.${i}.id`);
      if (
        a.resourceName !== `${prefix}/conversionActions/${a.id}` ||
        a.ownerCustomer !== prefix
      )
        fail("scenario_foreign_resource", `PMax.conversion_actions.${i}`);
      str(a.name, 255, `PMax.conversion_actions.${i}.name`);
      if (a.status === "ENABLED")
        usableGoals.push({
          id: a.id,
          primary_for_goal: a.primaryForGoal === true,
        });
    }
    duplicate(actions, (x) => x.resourceName, "PMax.conversion_actions");
    if (!usableGoals.length)
      blockers.push(
        blocker(
          "pmax_existing_enabled_goal_missing",
          "PMax.conversion_actions",
          "Нет доказанного existing same-account ENABLED conversion action. Новую цель/конверсию этот readiness-пакет не создаёт.",
        ),
      );
    const media = {
      MARKETING_IMAGE: [],
      SQUARE_MARKETING_IMAGE: [],
      LOGO: [],
      BUSINESS_NAME: [],
    };
    for (const [i, a] of assets.entries()) {
      closed(
        a,
        ["resourceName", "id", "type", "imageAsset", "textAsset"],
        ["resourceName", "id", "type"],
        `PMax.assets.${i}`,
      );
      owner(a.resourceName, "assets", `PMax.assets.${i}`);
      id(a.id, `PMax.assets.${i}.id`);
      if (a.resourceName !== `${prefix}/assets/${a.id}`)
        fail("scenario_catalog_id_mismatch", `PMax.assets.${i}`);
      if (a.type === "IMAGE") {
        const image = closed(
            a.imageAsset,
            ["fullSize", "fileSize", "mimeType"],
            ["fullSize", "fileSize", "mimeType"],
            `PMax.assets.${i}.imageAsset`,
          ),
          size = closed(
            image.fullSize,
            ["widthPixels", "heightPixels"],
            ["widthPixels", "heightPixels"],
            `PMax.assets.${i}.imageAsset.fullSize`,
          ),
          w = Number(size.widthPixels),
          h = Number(size.heightPixels),
          bytes = Number(image.fileSize);
        if (
          !Number.isInteger(w) ||
          !Number.isInteger(h) ||
          w < 1 ||
          h < 1 ||
          w > 4096 ||
          h > 4096 ||
          w * h > 16e6 ||
          !Number.isInteger(bytes) ||
          bytes < 1 ||
          bytes > 5 * 1024 * 1024 ||
          !["PNG", "JPEG", "image/png", "image/jpeg"].includes(image.mimeType)
        )
          continue;
        if (w >= 600 && h >= 314 && Math.abs(w / h - 1.91) <= 0.02)
          media.MARKETING_IMAGE.push(a.id);
        if (w === h && w >= 300) media.SQUARE_MARKETING_IMAGE.push(a.id);
        if (w === h && w >= 128) media.LOGO.push(a.id);
      } else if (a.type === "TEXT") {
        const text = closed(
          a.textAsset,
          ["text"],
          ["text"],
          `PMax.assets.${i}.textAsset`,
        );
        if (
          typeof text.text === "string" &&
          text.text.trim() &&
          text.text.length <= 25 &&
          ![...text.text].some((c) => c.codePointAt(0) < 32)
        )
          media.BUSINESS_NAME.push(a.id);
      } else fail("scenario_asset_type_invalid", `PMax.assets.${i}.type`);
    }
    duplicate(assets, (x) => x.resourceName, "PMax.assets");
    for (const role of Object.keys(media))
      if (!media[role].length)
        blockers.push(
          blocker(
            "pmax_existing_media_missing",
            `PMax.assets.${role}`,
            `Не доказан usable existing ${role}; media/brand assets не генерируются и не загружаются автоматически.`,
          ),
        );
    const brandGuidelines = [];
    for (const [i, c] of campaigns.entries()) {
      closed(
        c,
        [
          "resourceName",
          "id",
          "status",
          "advertisingChannelType",
          "brandGuidelinesEnabled",
        ],
        [
          "resourceName",
          "id",
          "status",
          "advertisingChannelType",
          "brandGuidelinesEnabled",
        ],
        `PMax.campaigns.${i}`,
      );
      owner(c.resourceName, "campaigns", `PMax.campaigns.${i}`);
      id(c.id, `PMax.campaigns.${i}.id`);
      if (
        c.resourceName !== `${prefix}/campaigns/${c.id}` ||
        c.status !== "PAUSED" ||
        c.advertisingChannelType !== "PERFORMANCE_MAX" ||
        typeof c.brandGuidelinesEnabled !== "boolean"
      )
        fail("scenario_pmax_campaign_unproven", `PMax.campaigns.${i}`);
      brandGuidelines.push({
        campaign_id: c.id,
        enabled: c.brandGuidelinesEnabled,
      });
    }
    duplicate(campaigns, (x) => x.resourceName, "PMax.campaigns");
    return {
      result: blockers.length ? "BLOCKED" : "PREREQUISITES_OBSERVED_NOT_LIVE",
      source_head: expectedSource,
      blockers,
      same_account_goals: usableGoals,
      existing_media_by_role: media,
      existing_brand_guidelines: brandGuidelines,
      inventory_coverage: "BOUNDED_SAMPLE_ONLY",
      no_inventory_absence_claim: true,
      live_acceptance: "NOT_RUN",
      remaining:
        "Read exact selected resources again, prove asset associations/branding minima, launch checklist and Google validate_only via stock PMax preview. No new goals/uploads or live create are authorized by this artifact.",
    };
  });
}
export function crossClientReadiness(raw, expectedSource) {
  return report("Q_R_S", raw, () => {
    const r = closed(
      raw,
      [
        "candidate_source_head",
        "chatgpt_connected",
        "second_client_connected",
        "profile_tool_count",
        "manual_consent_required",
      ],
      [
        "candidate_source_head",
        "chatgpt_connected",
        "second_client_connected",
        "profile_tool_count",
        "manual_consent_required",
      ],
      "clients",
    );
    if (
      !/^[a-f0-9]{40}$/u.test(expectedSource ?? "") ||
      r.candidate_source_head !== expectedSource ||
      ![
        r.chatgpt_connected,
        r.second_client_connected,
        r.manual_consent_required,
      ].every((v) => typeof v === "boolean") ||
      !Number.isInteger(r.profile_tool_count) ||
      r.profile_tool_count < 1 ||
      r.profile_tool_count > 50
    )
      fail("scenario_client_proof_invalid", "clients");
    return {
      Q: r.chatgpt_connected
        ? "CONNECTED_REQUIRES_LIVE_ACCEPTANCE"
        : "BLOCKED_NOT_CONNECTED",
      R: r.second_client_connected
        ? "CONNECTED_REQUIRES_LIVE_ACCEPTANCE"
        : "BLOCKED_NOT_CONNECTED",
      S: r.manual_consent_required
        ? "CONSENT_CONTRACT_NOT_LIVE"
        : "BLOCKED_MANUAL_CONSENT_MISSING",
      live_acceptance: "NOT_RUN",
      next_action:
        "Connect the private source-pinned candidate through stock user OAuth in ChatGPT and one second MCP client; select google_ads_write profile. Do not paste credentials into chat. Verify tools/list and a READ first; every write needs a new stock browser approval. Q/R A/B/C/M evidence and S actual persisted consent are separate LIVE gates.",
    };
  });
}

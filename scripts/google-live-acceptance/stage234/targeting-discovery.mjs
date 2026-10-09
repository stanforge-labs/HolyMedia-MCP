// Bounded fixed-template READ preparation. No transport, mutations or approvals.
import { createHash } from "node:crypto";
import {
  targetingFixture as t,
  TARGETING_READ_QUERIES,
  prepareAudienceIScenario,
} from "./scenario-targeting-readiness.mjs";
const prefix = `customers/${t.customer}`;
const fail = (code) => {
  const e = new Error(code);
  e.code = code;
  e.source = "HOLYMEDIA";
  throw e;
};
const positiveId = (id) =>
  typeof id === "string" && /^[1-9][0-9]{0,19}$/u.test(id);
const owned = (resource, kind) =>
  typeof resource === "string" &&
  new RegExp(
    `^${prefix}/${kind}/[1-9][0-9]{0,19}(?:~[1-9][0-9]{0,19})?$`,
    "u",
  ).test(resource);
const autoTypes = [
  "TARGET_SPEND",
  "MAXIMIZE_CONVERSIONS",
  "MAXIMIZE_CONVERSION_VALUE",
  "TARGET_CPA",
  "TARGET_ROAS",
  "TARGET_IMPRESSION_SHARE",
];
export const DISCOVERY_AUTO_CAMPAIGNS =
  "SELECT campaign.id, campaign.resource_name, campaign.status, campaign.advertising_channel_type, campaign.bidding_strategy_type, campaign.bidding_strategy FROM campaign WHERE campaign.status = PAUSED AND campaign.advertising_channel_type = SEARCH AND campaign.bidding_strategy_type IN ('TARGET_SPEND', 'MAXIMIZE_CONVERSIONS', 'MAXIMIZE_CONVERSION_VALUE', 'TARGET_CPA', 'TARGET_ROAS', 'TARGET_IMPRESSION_SHARE') ORDER BY campaign.id LIMIT 21";
export function discoveryInterestQuery(
  kind,
  after = "0",
  launchedOnly = false,
) {
  if (
    !["IN_MARKET", "AFFINITY"].includes(kind) ||
    (after !== "0" && !positiveId(after)) ||
    typeof launchedOnly !== "boolean"
  )
    fail("discovery_catalog_query_invalid");
  return `SELECT user_interest.resource_name, user_interest.user_interest_id, user_interest.name, user_interest.taxonomy_type, user_interest.launched_to_all, user_interest.availabilities FROM user_interest WHERE user_interest.taxonomy_type = '${kind}'${launchedOnly ? " AND user_interest.launched_to_all = TRUE" : ""} AND user_interest.user_interest_id > ${after} ORDER BY user_interest.user_interest_id LIMIT 101`;
}
export function discoveryKeywordQuery(ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 20 ||
    ids.some((id) => !positiveId(id)) ||
    new Set(ids).size !== ids.length
  )
    fail("discovery_campaign_ids_invalid");
  return `SELECT campaign.id, campaign.resource_name, campaign.status, campaign.bidding_strategy_type, campaign.bidding_strategy, ad_group.id, ad_group.resource_name, ad_group.campaign, ad_group.status, ad_group.type, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.type, ad_group_criterion.negative, ad_group_criterion.status, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.cpc_bid_micros FROM ad_group_criterion WHERE campaign.id IN (${ids.join(", ")}) AND campaign.status = PAUSED AND ad_group.status = PAUSED AND ad_group.type = SEARCH_STANDARD AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status = ENABLED AND ad_group_criterion.cpc_bid_micros > 0 LIMIT 101`;
}
export function discoveryDistrictQuery(cityResource) {
  if (!/^geoTargetConstants\/[1-9][0-9]{0,19}$/u.test(cityResource ?? ""))
    fail("discovery_city_resource_invalid");
  return `SELECT geo_target_constant.resource_name, geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.country_code, geo_target_constant.target_type, geo_target_constant.status, geo_target_constant.parent_geo_target FROM geo_target_constant WHERE geo_target_constant.parent_geo_target = '${cityResource}' AND geo_target_constant.country_code = 'KZ' AND geo_target_constant.target_type IN ('District', 'Borough', 'Municipality') AND geo_target_constant.status = 'ENABLED' ORDER BY geo_target_constant.id LIMIT 101`;
}
export function isDiscoveryQuery(query) {
  if (
    query === DISCOVERY_AUTO_CAMPAIGNS ||
    query === TARGETING_READ_QUERIES.city
  )
    return true;
  if (typeof query !== "string") return false;
  try {
    const interest =
      /taxonomy_type = '(IN_MARKET|AFFINITY)'( AND user_interest\.launched_to_all = TRUE)? AND user_interest\.user_interest_id > ([0-9]{1,20}) ORDER BY/u.exec(
        query,
      );
    if (
      interest &&
      query === discoveryInterestQuery(interest[1], interest[3], !!interest[2])
    )
      return true;
    const keywords = /campaign\.id IN \(([0-9, ]+)\)/u.exec(query);
    if (keywords && query === discoveryKeywordQuery(keywords[1].split(", ")))
      return true;
    const parent =
      /parent_geo_target = '(geoTargetConstants\/[0-9]{1,20})'/u.exec(query);
    return !!parent && query === discoveryDistrictQuery(parent[1]);
  } catch {
    return false;
  }
}
function rows(value, maximum) {
  if (!Array.isArray(value) || value.length > maximum)
    fail("discovery_provider_bound_invalid");
  return value;
}
function cityProof(value) {
  const candidates = rows(value, 101).map((r) => r.geoTargetConstant);
  if (candidates.length !== 1) fail("discovery_city_ambiguous");
  const c = candidates[0];
  if (
    !c ||
    !positiveId(c.id) ||
    c.resourceName !== `geoTargetConstants/${c.id}` ||
    c.name !== "Astana" ||
    c.countryCode !== "KZ" ||
    c.targetType !== "City" ||
    c.status !== "ENABLED"
  )
    fail("discovery_city_proof_invalid");
  return c;
}
export function existingProximityCenters(criteria) {
  const result = [];
  for (const row of rows(criteria, 500)) {
    const c = row.campaignCriterion;
    if (
      !c ||
      !owned(c.resourceName, "campaignCriteria") ||
      c.campaign !== `${prefix}/campaigns/${t.campaign}` ||
      !positiveId(c.criterionId) ||
      c.resourceName !==
        `${prefix}/campaignCriteria/${t.campaign}~${c.criterionId}`
    )
      fail("discovery_criterion_owner_invalid");
    if (c.type !== "PROXIMITY") continue;
    const p = c.proximity,
      point = p?.geoPoint;
    if (
      !point ||
      !Number.isInteger(point.latitudeInMicroDegrees) ||
      Math.abs(point.latitudeInMicroDegrees) > 90000000 ||
      !Number.isInteger(point.longitudeInMicroDegrees) ||
      Math.abs(point.longitudeInMicroDegrees) > 180000000 ||
      typeof p.radius !== "number" ||
      !Number.isFinite(p.radius) ||
      p.radius < 1 ||
      p.radius > 500 ||
      !["KILOMETERS", "MILES"].includes(p.radiusUnits) ||
      !["PAUSED", "ENABLED"].includes(c.status) ||
      c.negative === true
    )
      fail("discovery_proximity_proof_invalid");
    result.push({
      source: "EXISTING_PROVIDER_PROXIMITY",
      resource_name: c.resourceName,
      latitude: point.latitudeInMicroDegrees / 1e6,
      longitude: point.longitudeInMicroDegrees / 1e6,
      radius: p.radius,
      unit: p.radiusUnits,
    });
  }
  return result;
}
export async function runTargetingDiscovery({
  read,
  fixture,
  existingAudiences,
  campaignCriteria,
  source,
  now = Date.now(),
}) {
  if (typeof read !== "function") fail("discovery_reader_missing");
  const fixtureCheck = prepareAudienceIScenario(
    { fixture, existing_criteria: existingAudiences, catalog: [] },
    source,
    now,
  );
  if (
    fixtureCheck.blockers?.some(
      (e) => e.code !== "audience_eligibility_not_proven",
    )
  )
    fail("discovery_fixture_proof_invalid");
  const output = {
    source_head: source,
    result: "READ_ONLY_DISCOVERY",
    live_acceptance: "NOT_RUN",
    no_global_absence_claim: true,
    real_provider_write_calls: 0,
    G: { result: "BLOCKED", candidates: [] },
    I: {},
    J: { result: "BLOCKED" },
  };
  const errors = {};
  const safe = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      if (name === "G") output.G = { result: "BLOCKED", candidates: [] };
      errors[name] = {
        source: e.source === "HOLYMEDIA" ? "HOLYMEDIA" : "GOOGLE_API",
        code:
          e.source === "HOLYMEDIA" && /^[a-z_]{1,80}$/u.test(e.code ?? "")
            ? e.code
            : "discovery_read_failed",
        provider_status:
          Number.isInteger(e.providerStatus) &&
          e.providerStatus >= 100 &&
          e.providerStatus <= 599
            ? e.providerStatus
            : null,
        provider_code:
          typeof e.providerCode === "string" &&
          /^[A-Z][A-Z0-9_]{1,79}$/u.test(e.providerCode)
            ? e.providerCode
            : null,
      };
    }
  };
  await safe("G", async () => {
    const campaigns = rows(await read(DISCOVERY_AUTO_CAMPAIGNS), 21).map(
      (r) => r.campaign,
    );
    const ids = [];
    for (const c of campaigns) {
      if (
        !c ||
        !positiveId(c.id) ||
        c.resourceName !== `${prefix}/campaigns/${c.id}` ||
        c.status !== "PAUSED" ||
        c.advertisingChannelType !== "SEARCH" ||
        !autoTypes.includes(c.biddingStrategyType) ||
        (c.biddingStrategy !== undefined &&
          !owned(c.biddingStrategy, "biddingStrategies")) ||
        ids.includes(c.id)
      )
        fail("discovery_campaign_proof_invalid");
      ids.push(c.id);
    }
    output.G.observed_campaign_count = ids.length;
    if (ids.length === 21) {
      output.G.code = "discovery_campaign_bound_reached";
      return;
    }
    if (!ids.length) {
      output.G.code = "discovery_auto_campaign_unproven";
      return;
    }
    const keywordRows = rows(await read(discoveryKeywordQuery(ids)), 101);
    if (keywordRows.length === 101) {
      output.G.code = "discovery_keyword_bound_reached";
      return;
    }
    const seen = new Set();
    for (const row of keywordRows) {
      const c = row.campaign,
        g = row.adGroup,
        k = row.adGroupCriterion;
      if (
        !c ||
        !g ||
        !k ||
        !ids.includes(c.id) ||
        c.resourceName !== `${prefix}/campaigns/${c.id}` ||
        c.status !== "PAUSED" ||
        !autoTypes.includes(c.biddingStrategyType) ||
        c.biddingStrategyType !==
          campaigns.find((x) => x.id === c.id)?.biddingStrategyType ||
        c.biddingStrategy !==
          campaigns.find((x) => x.id === c.id)?.biddingStrategy ||
        g.campaign !== c.resourceName ||
        !positiveId(g.id) ||
        g.resourceName !== `${prefix}/adGroups/${g.id}` ||
        g.status !== "PAUSED" ||
        g.type !== "SEARCH_STANDARD" ||
        !positiveId(k.criterionId) ||
        k.resourceName !==
          `${prefix}/adGroupCriteria/${g.id}~${k.criterionId}` ||
        k.type !== "KEYWORD" ||
        k.negative !== false ||
        k.status !== "ENABLED" ||
        typeof k.cpcBidMicros !== "string" ||
        !/^[1-9][0-9]{0,15}$/u.test(k.cpcBidMicros) ||
        !k.keyword ||
        typeof k.keyword.text !== "string" ||
        !k.keyword.text.trim() ||
        k.keyword.text.length > 80 ||
        !["EXACT", "PHRASE", "BROAD"].includes(k.keyword.matchType) ||
        seen.has(k.resourceName)
      )
        fail("discovery_keyword_proof_invalid");
      seen.add(k.resourceName);
      output.G.candidates.push({
        campaign_id: c.id,
        ad_group_id: g.id,
        criterion_id: k.criterionId,
        resource_name: k.resourceName,
        cpc_bid_micros: k.cpcBidMicros,
        bidding_strategy_type: c.biddingStrategyType,
        required_warning:
          "Manual override may not affect automated effective bids; strategy unchanged",
        preview_request: {
          tool: "google_ads_bid_budget_preview",
          arguments: {
            provider: "GOOGLE_ADS",
            account_id: t.customer,
            items: [
              {
                field: "keyword_cpc",
                campaign_id: c.id,
                ad_group_id: g.id,
                criterion_id: k.criterionId,
                change: { mode: "percent", percent: "10", currency: "USD" },
              },
            ],
          },
        },
      });
    }
    output.G.result = output.G.candidates.length
      ? "PREPARED_NOT_LIVE"
      : "BLOCKED";
    output.G.code = output.G.candidates.length
      ? "eligible_explicit_auto_cpc"
      : "discovery_explicit_cpc_unproven";
  });
  const catalog = async (kind, launchedOnly) => {
    const key = launchedOnly ? `GLOBAL_${kind}` : kind;
    await safe(key, async () => {
      let after = "0",
        exhausted = false,
        candidate;
      const seen = new Set(),
        diagnostics = {
          launched_true: 0,
          launched_false: 0,
          launched_omitted: 0,
          availability_records: 0,
          search_channel_global_locale_rows: 0,
        },
        planBlockers = new Set();
      for (let page = 0; page < 5; page++) {
        const response = rows(
          await read(discoveryInterestQuery(kind, after, launchedOnly)),
          101,
        );
        let previous = BigInt(after);
        for (const r of response) {
          const a = r.userInterest;
          if (
            !a ||
            !positiveId(a.userInterestId) ||
            a.resourceName !== `${prefix}/userInterests/${a.userInterestId}` ||
            a.taxonomyType !== kind ||
            BigInt(a.userInterestId) <= previous ||
            seen.has(a.resourceName) ||
            (launchedOnly && a.launchedToAll !== true)
          )
            fail("discovery_catalog_proof_invalid");
          previous = BigInt(a.userInterestId);
        }
        const accepted =
          response.length === 101 ? response.slice(0, 100) : response;
        for (const r of accepted) {
          const a = r.userInterest;
          seen.add(a.resourceName);
          diagnostics[
            a.launchedToAll === true
              ? "launched_true"
              : a.launchedToAll === false
                ? "launched_false"
                : "launched_omitted"
          ]++;
          const availability = Array.isArray(a.availabilities)
            ? a.availabilities
            : [];
          diagnostics.availability_records += availability.length;
          if (
            availability.some((v) => {
              const channel = v?.channel;
              return (
                (channel?.availabilityMode === "ALL_CHANNELS" ||
                  (channel?.advertisingChannelType === "SEARCH" &&
                    (channel.availabilityMode === "CHANNEL_TYPE" ||
                      (channel.availabilityMode ===
                        "CHANNEL_TYPE_AND_SUBTYPES" &&
                        channel.includeDefaultChannelSubType === true)))) &&
                Array.isArray(v.locale) &&
                v.locale.some((l) => l.availabilityMode === "LAUNCHED_TO_ALL")
              );
            })
          )
            diagnostics.search_channel_global_locale_rows++;
        }
        const plan = prepareAudienceIScenario(
          {
            fixture,
            existing_criteria: existingAudiences,
            catalog: accepted.map((r) => ({
              kind: "USER_INTEREST",
              entity: r.userInterest,
            })),
          },
          source,
          now,
        );
        if (!candidate && plan.result === "PREPARED_NOT_LIVE") candidate = plan;
        for (const error of plan.blockers ?? [])
          if (
            error.source === "HOLYMEDIA" &&
            /^[a-z_]{1,80}$/u.test(error.code)
          )
            planBlockers.add(error.code);
        if (response.length < 101) {
          exhausted = true;
          break;
        }
        after = accepted.at(-1).userInterest.userInterestId;
      }
      output.I[key] = {
        result: candidate && exhausted ? "PREPARED_NOT_LIVE" : "BLOCKED",
        observed_count: seen.size,
        exhausted_within_bound: exhausted,
        limit_reached: !exhausted,
        no_global_absence_claim: true,
        launched_filter: launchedOnly,
        eligibility_diagnostics: diagnostics,
        plan_blocker_codes: [...planBlockers].sort(),
        code: !exhausted
          ? "discovery_catalog_bound_reached"
          : candidate
            ? "eligible_audience_observed"
            : "discovery_audience_unproven",
        ...(candidate && exhausted ? { candidate } : {}),
      };
    });
  };
  for (const kind of ["IN_MARKET", "AFFINITY"]) await catalog(kind, false);
  for (const kind of ["IN_MARKET", "AFFINITY"]) await catalog(kind, true);
  await safe("J", async () => {
    const city = cityProof(await read(TARGETING_READ_QUERIES.city));
    const districtRows = rows(
      await read(discoveryDistrictQuery(city.resourceName)),
      101,
    );
    const districts = [];
    for (const row of districtRows) {
      const d = row.geoTargetConstant;
      if (
        !d ||
        !positiveId(d.id) ||
        d.resourceName !== `geoTargetConstants/${d.id}` ||
        d.parentGeoTarget !== city.resourceName ||
        d.countryCode !== "KZ" ||
        !["District", "Borough", "Municipality"].includes(d.targetType) ||
        d.status !== "ENABLED"
      )
        fail("discovery_district_proof_invalid");
      districts.push({
        id: d.id,
        resource_name: d.resourceName,
        parent_resource_name: d.parentGeoTarget,
      });
    }
    const centers = existingProximityCenters(campaignCriteria);
    output.J = {
      result:
        districtRows.length < 101 && districts.length && centers.length
          ? "PREREQUISITES_OBSERVED_NOT_LIVE"
          : "BLOCKED",
      city_id: city.id,
      districts,
      existing_centers: centers,
      district_bound_reached: districtRows.length === 101,
      no_global_absence_claim: true,
      criteria_digest: createHash("sha256")
        .update(JSON.stringify(campaignCriteria))
        .digest("hex"),
      radius_plan_created: false,
      code:
        districtRows.length === 101
          ? "discovery_district_bound_reached"
          : !districts.length
            ? "discovery_city_district_unproven"
            : !centers.length
              ? "discovery_provider_center_missing"
              : "existing_center_observed",
    };
  });
  output.errors = errors;
  return output;
}

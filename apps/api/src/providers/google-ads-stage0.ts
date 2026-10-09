import { safeGet } from "@holymedia/site-audit";
import type { Stage2Plan } from "./google-ads-stage2.js";
import type { ExtendedPlan } from "./google-ads-extended-plan.js";
import {
  campaignBriefSchema,
  campaignIdSchema,
  campaignCloneSchema,
  validateBriefSchema,
} from "../mcp/mcp-google-stage0-schema.js";
import {
  canonical,
  currencyMicros,
  finalUrl,
  keywordCreateFields,
  conflictReason,
  parseStage1Intent,
  type Stage1Item,
  type Stage1Plan,
  type Stage1Reader,
  type Stage1MutationResult,
} from "./google-ads-stage1.js";
import {
  customerId,
  assertGoogleBatch,
  GoogleAdsWriteError,
  googleWriteFailure,
} from "./google-ads-write.js";

export type JsonRow = Record<string, unknown>;
export type Stage0Operation = {
  kind: keyof typeof resources;
  method: "create" | "update";
  resource_name: string | null;
  fields: JsonRow;
  update_mask: string | null;
  expected: JsonRow;
  before: JsonRow | null;
  row: number;
};
export type Stage0Plan = {
  version: 0;
  account_id: string;
  intent: {
    action: "campaign_create" | "campaign_resume" | "campaign_pause";
    brief: JsonRow;
  };
  checks: { query: string; rows: JsonRow[] }[];
  operations: Stage0Operation[];
  items: Stage1Plan["items"];
  summary: JsonRow;
};
export type GoogleWritePlan =
  Stage0Plan | Stage1Plan | Stage2Plan | ExtendedPlan;
export const row = (v: unknown): JsonRow =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRow) : {};
const list = (v: unknown): JsonRow[] => (Array.isArray(v) ? v.map(row) : []);
const error = (code: string, message: string): never => {
  throw new GoogleAdsWriteError(code, message);
};
const quote = (v: string) =>
  `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const keyText = (v: unknown) =>
  String(v)
    .normalize("NFC")
    .trim()
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("und");
const resources = {
  campaignBudget: [
    "campaign_budget",
    "campaignBudget",
    "campaignBudgets",
    "campaign_budget.resource_name, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.delivery_method",
  ],
  campaign: [
    "campaign",
    "campaign",
    "campaigns",
    "campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.campaign_budget, campaign.bidding_strategy_type, campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type, campaign.start_date_time, campaign.end_date_time, campaign.final_url_suffix, campaign.tracking_url_template",
  ],
  campaignCriterion: [
    "campaign_criterion",
    "campaignCriterion",
    "campaignCriteria",
    "campaign_criterion.resource_name, campaign_criterion.type, campaign_criterion.campaign, campaign_criterion.negative, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.location.geo_target_constant, campaign_criterion.proximity.geo_point.latitude_in_micro_degrees, campaign_criterion.proximity.geo_point.longitude_in_micro_degrees, campaign_criterion.proximity.radius, campaign_criterion.proximity.radius_units, campaign_criterion.language.language_constant, campaign_criterion.ad_schedule.day_of_week, campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.start_minute, campaign_criterion.ad_schedule.end_hour, campaign_criterion.ad_schedule.end_minute",
  ],
  adGroup: [
    "ad_group",
    "adGroup",
    "adGroups",
    "ad_group.resource_name, ad_group.id, ad_group.name, ad_group.campaign, ad_group.status, ad_group.type, ad_group.cpc_bid_micros",
  ],
  adGroupCriterion: [
    "ad_group_criterion",
    "adGroupCriterion",
    "adGroupCriteria",
    "ad_group_criterion.resource_name, ad_group_criterion.ad_group, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.final_urls, ad_group_criterion.cpc_bid_micros",
  ],
  adGroupAd: [
    "ad_group_ad",
    "adGroupAd",
    "adGroupAds",
    "ad_group_ad.resource_name, ad_group_ad.ad_group, ad_group_ad.status, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2, ad_group_ad.policy_summary.approval_status, ad_group_ad.policy_summary.review_status, ad_group_ad.policy_summary.policy_topic_entries",
  ],
  asset: [
    "asset",
    "asset",
    "assets",
    "asset.resource_name, asset.type, asset.final_urls, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, asset.callout_asset.callout_text, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values, asset.call_asset.country_code, asset.call_asset.phone_number, asset.text_asset.text",
  ],
  campaignAsset: [
    "campaign_asset",
    "campaignAsset",
    "campaignAssets",
    "campaign_asset.resource_name, campaign_asset.campaign, campaign_asset.asset, campaign_asset.field_type, campaign_asset.status",
  ],
  campaignConversionGoal: [
    "campaign_conversion_goal",
    "campaignConversionGoal",
    "campaignConversionGoals",
    "campaign_conversion_goal.resource_name, campaign_conversion_goal.campaign, campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable",
  ],
  customConversionGoal: [
    "custom_conversion_goal",
    "customConversionGoal",
    "customConversionGoals",
    "custom_conversion_goal.resource_name, custom_conversion_goal.id, custom_conversion_goal.name, custom_conversion_goal.status, custom_conversion_goal.conversion_actions",
  ],
  conversionGoalCampaignConfig: [
    "conversion_goal_campaign_config",
    "conversionGoalCampaignConfig",
    "conversionGoalCampaignConfigs",
    "conversion_goal_campaign_config.resource_name, conversion_goal_campaign_config.campaign, conversion_goal_campaign_config.goal_config_level, conversion_goal_campaign_config.custom_conversion_goal",
  ],
} as const;
const customerQuery =
  "SELECT customer.resource_name, customer.id, customer.currency_code, customer.time_zone, customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer";
const actionsQuery =
  "SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.primary_for_goal, conversion_action.category, conversion_action.origin, conversion_action.owner_customer FROM conversion_action";
const goalsQuery =
  "SELECT customer_conversion_goal.resource_name, customer_conversion_goal.category, customer_conversion_goal.origin, customer_conversion_goal.biddable FROM customer_conversion_goal";
export function stage0CampaignGoalResource(
  account: string,
  campaign: string,
  goal: JsonRow,
): string {
  const prefix = `customers/${customerId(account)}`;
  const match =
    typeof goal.resourceName === "string"
      ? /^customers\/([0-9]{1,20})\/customerConversionGoals\/([1-9][0-9]{0,9})~([1-9][0-9]{0,9})$/.exec(
          goal.resourceName,
        )
      : null;
  if (!match)
    return error(
      "google_conversion_goal_invalid",
      "Canonical customer conversion goal resource отсутствует/невалиден; enum IDs не угадываются.",
    );
  if (
    `customers/${match[1]}` !== prefix ||
    BigInt(match[2]!) > 2147483647n ||
    BigInt(match[3]!) > 2147483647n ||
    !new RegExp(`^${prefix}/campaigns/-?[1-9][0-9]{0,19}$`).test(campaign) ||
    [goal.category, goal.origin].some(
      (v) =>
        typeof v !== "string" ||
        !/^[A-Z][A-Z0-9_]{1,63}$/.test(v) ||
        ["UNKNOWN", "UNSPECIFIED"].includes(v),
    )
  )
    error(
      "google_conversion_goal_invalid",
      "Canonical customer conversion goal resource/owner/category/origin не подтверждён; enum IDs не угадываются.",
    );
  // v24 uses the provider's numeric category~origin suffix, not JSON enum names.
  return `${prefix}/campaignConversionGoals/${campaign.split("/").at(-1)}~${match[2]}~${match[3]}`;
}
export function stage0Query(kind: Stage0Operation["kind"], where: string) {
  const [table, , , fields] = resources[kind];
  return `SELECT ${fields} FROM ${table} WHERE ${where}`;
}
async function checkedRead(read: Stage1Reader, query: string) {
  const rows = await read(query);
  if (rows.length > 5000)
    error(
      "google_inventory_limit",
      "Слишком большой inventory; сузьте кампанию. Данные не обрезаны.",
    );
  return rows
    .map(row)
    .sort((a, b) => canonical(a).localeCompare(canonical(b), "en"));
}
export async function rereadStage0Checks(plan: Stage0Plan, read: Stage1Reader) {
  const checks = [];
  for (const c of plan.checks)
    checks.push({ query: c.query, rows: await checkedRead(read, c.query) });
  return checks;
}
export function validateText(v: string, max: number, field: string) {
  // Google counts full-width/CJK characters as two characters.
  const length = [...v].reduce(
    (n, c) =>
      n +
      (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\uff01-\uff60\uffe0-\uffe6]/u.test(
        c,
      )
        ? 2
        : 1),
    0,
  );
  if (!v.trim() || length > max)
    error(
      "google_ad_text_invalid",
      `${field}: максимум ${max} символов; ничего не создано.`,
    );
}
export function validateDate(value: unknown) {
  if (value === undefined) return;
  const date = new Date(String(value) + "T00:00:00Z");
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
  )
    error("google_date_invalid", "Неверная дата кампании.");
}
export function validateTracking(input: JsonRow): JsonRow {
  const suffix = String(
    input.final_url_suffix ??
      "utm_source=google&utm_medium=cpc&utm_campaign={campaignid}",
  );
  const template = input.tracking_url_template;
  const allowed = new Set([
    "campaignid",
    "adgroupid",
    "keyword",
    "matchtype",
    "device",
    "network",
    "creative",
    "loc_physical_ms",
    "lpurl",
  ]);
  for (const text of [suffix, ...(template ? [String(template)] : [])]) {
    if (
      /[\r\n#]/.test(text) ||
      /[{}]/.test(text.replace(/\{[A-Za-z_]+\}/g, "")) ||
      (/\{([^}]+)\}/g.test(text) &&
        [...text.matchAll(/\{([^}]+)\}/g)].some((m) => !allowed.has(m[1]!)))
    )
      error("google_tracking_invalid", "Неверный UTM/ValueTrack placeholder.");
  }
  if (
    suffix.startsWith("?") ||
    !suffix.split("&").every((p) => /^[A-Za-z0-9_.-]+=[^&]*$/.test(p))
  )
    error(
      "google_tracking_invalid",
      "final_url_suffix: параметры key=value без начального ?.",
    );
  if (template) {
    if (
      !String(template).includes("{lpurl}") ||
      !String(template).startsWith("https://")
    )
      error(
        "google_tracking_invalid",
        "HTTPS tracking template должен содержать {lpurl}.",
      );
    finalUrl(String(template).replace(/\{[^}]+\}/g, "placeholder"));
  }
  return {
    finalUrlSuffix: suffix,
    ...(template ? { trackingUrlTemplate: template } : {}),
  };
}
export function normalizeBrief(raw: unknown) {
  validateBriefSchema(raw, campaignBriefSchema);
  const brief = structuredClone(raw) as JsonRow;
  brief.account_id = customerId(String(brief.account_id));
  brief.campaign_name = String(brief.campaign_name).normalize("NFC").trim();
  if (!brief.campaign_name)
    error("google_brief_invalid", "Укажите непустое имя кампании.");
  validateDate(brief.start_date);
  validateDate(brief.end_date);
  if (
    brief.start_date &&
    brief.end_date &&
    String(brief.end_date) < String(brief.start_date)
  )
    error("google_date_invalid", "end_date раньше start_date.");
  const groups = list(brief.ad_groups),
    names = new Set<string>();
  const proximityKeys = new Set<string>();
  for (const proximity of list(brief.proximities)) {
    const fields = stage0ProximityFields(proximity),
      key = canonical(fields);
    if (proximityKeys.has(key))
      error(
        "google_geo_duplicate",
        "Повторяющийся coordinate-radius target; ничего не создано.",
      );
    proximityKeys.add(key);
  }
  let count =
    2 +
    list(brief.locations).length +
    list(brief.proximities).length +
    (brief.languages as string[]).length;
  for (const group of groups) {
    const name = keyText(group.name);
    if (!name || names.has(name))
      error("google_group_duplicate", "Имена групп должны быть уникальны.");
    names.add(name);
    group.name = String(group.name).normalize("NFC").trim();
    const keywordInput = list(group.keywords).map((k) => ({
      ...k,
      campaign_id: "1",
      ad_group_id: "1",
    }));
    group.keywords = parseStage1Intent({
      action: "keyword_add",
      items: keywordInput,
    }).items.map(({ campaign_id: _, ad_group_id: __, ...k }) => k);
    const seen = new Set<string>();
    for (const k of list(group.keywords)) {
      const key = `${keyText(k.text)}|${k.match_type}`;
      if (seen.has(key))
        error("google_keyword_duplicate", "В группе есть эквивалентные ключи.");
      seen.add(key);
    }
    for (const ad of list(group.rsa)) {
      ad.final_url = finalUrl(ad.final_url);
      for (const h of list(ad.headlines))
        validateText(String(h.text), 30, "RSA headline");
      for (const d of list(ad.descriptions))
        validateText(String(d.text), 90, "RSA description");
      if (ad.path2 && !ad.path1)
        error("google_ad_path_invalid", "path2 требует path1.");
      for (const field of ["path1", "path2"])
        if (ad[field]) validateText(String(ad[field]), 15, field);
    }
    count +=
      1 +
      list(group.keywords).length +
      list(group.negative_keywords).length +
      list(group.rsa).length;
  }
  for (const [parent, level] of [
    [brief, "campaign"],
    ...groups.map((g) => [g, "ad_group"]),
  ] as [JsonRow, string][]) {
    if (list(parent.negative_keywords).length) {
      const seen = new Set<string>();
      parent.negative_keywords = parseStage1Intent({
        action: "negative_add",
        level,
        items: list(parent.negative_keywords).map((k) => ({
          ...k,
          campaign_id: "1",
          ...(level === "ad_group" ? { ad_group_id: "1" } : {}),
        })),
      }).items.map(({ campaign_id: _, ad_group_id: __, ...k }) => {
        const key = `${keyText(k.text)}|${k.match_type}`;
        if (seen.has(key))
          error("google_keyword_duplicate", "Повторяющийся минус-ключ.");
        seen.add(key);
        return k;
      });
    }
  }
  for (const a of list(row(brief.assets).sitelinks)) {
    a.final_url = finalUrl(a.final_url);
    validateText(String(a.text), 25, "Sitelink");
    if (Boolean(a.description1) !== Boolean(a.description2))
      error(
        "google_asset_invalid",
        "Для sitelink укажите обе descriptions или ни одной.",
      );
  }
  const assets = row(brief.assets);
  count += list(brief.negative_keywords).length;
  count +=
    2 *
    (list(assets.sitelinks).length +
      (Array.isArray(assets.callouts) ? assets.callouts.length : 0) +
      list(assets.structured_snippets).length +
      (assets.call ? 1 : 0) +
      (assets.business_name ? 1 : 0));
  count +=
    (Array.isArray(assets.image_asset_ids)
      ? assets.image_asset_ids.length
      : 0) +
    (Array.isArray(assets.logo_asset_ids) ? assets.logo_asset_ids.length : 0);
  count += list(brief.ad_schedule).reduce(
    (n, s) => n + (s.days as string[]).length,
    0,
  );
  if (count > 500)
    error(
      "google_batch_limit_exceeded",
      "Кампания требует более 500 операций Google. Разделите brief; ничего не обрезано.",
    );
  const intervals = new Map<string, [number, number][]>();
  const minute = (s: unknown) =>
    String(s)
      .split(":")
      .reduce((n, v, i) => n + Number(v) * (i === 0 ? 60 : 1), 0);
  for (const schedule of list(brief.ad_schedule))
    for (const day of schedule.days as string[]) {
      const from = minute(schedule.start),
        to = minute(schedule.end),
        existing = intervals.get(day) ?? [];
      if (from >= to || existing.some(([a, b]) => from < b && to > a))
        error(
          "google_schedule_invalid",
          "Расписание пересекается или переходит через полночь; разделите интервалы.",
        );
      existing.push([from, to]);
      intervals.set(day, existing);
    }
  brief.ad_groups = groups;
  brief.effective_tracking = validateTracking(row(brief.utm));
  return brief;
}
export function stage0ProximityFields(input: JsonRow): JsonRow {
  const schema = campaignBriefSchema.properties!.proximities!.items!;
  validateBriefSchema(input, schema, "brief.proximities[]");
  const microdegrees = (value: number, field: string) => {
    if (Number(value.toFixed(6)) !== value)
      error(
        "google_proximity_precision_invalid",
        `${field}: максимум шесть знаков после запятой, координаты не округляются молча.`,
      );
    const [whole, fraction] = Math.abs(value).toFixed(6).split(".");
    const exact = BigInt(whole!) * 1_000_000n + BigInt(fraction!);
    return Number(value < 0 ? -exact : exact);
  };
  return {
    geoPoint: {
      latitudeInMicroDegrees: microdegrees(Number(input.latitude), "latitude"),
      longitudeInMicroDegrees: microdegrees(
        Number(input.longitude),
        "longitude",
      ),
    },
    radius: input.radius,
    radiusUnits: input.unit,
  };
}
export type GeoSuggest = (name: string, country?: string) => Promise<JsonRow[]>;
export async function buildStage0Plan(
  account: string,
  raw: unknown,
  read: Stage1Reader,
  suggest: GeoSuggest,
): Promise<Stage0Plan> {
  const brief = normalizeBrief(raw),
    account_id = customerId(account),
    prefix = `customers/${account_id}`;
  if (brief.account_id !== account_id)
    error(
      "google_account_mismatch",
      "Аккаунт brief не совпадает с выбранным аккаунтом.",
    );
  const checks: Stage0Plan["checks"] = [];
  const query = async (q: string) => {
    const rows = await checkedRead(read, q);
    checks.push({ query: q, rows });
    return rows;
  };
  const customers = await query(customerQuery),
    customer = row(customers[0]?.customer);
  if (
    customers.length !== 1 ||
    String(customer.id) !== account_id ||
    !customer.currencyCode ||
    !customer.timeZone
  )
    error(
      "google_account_invalid",
      "Не удалось подтвердить customer, валюту и timezone.",
    );
  const currency = String(customer.currencyCode),
    timezone = String(customer.timeZone);
  const budget = row(brief.daily_budget),
    budgetMicros = currencyMicros(
      String(budget.amount),
      String(budget.currency),
      currency,
    );
  const strategy = String(brief.bidding_strategy ?? "MANUAL_CPC"),
    groups = list(brief.ad_groups);
  for (const group of groups) {
    if (strategy === "MANUAL_CPC" && !group.default_bid)
      error(
        "google_group_bid_required",
        "MANUAL_CPC требует явный default_bid каждой группы.",
      );
    if (
      strategy !== "MANUAL_CPC" &&
      (group.default_bid || list(group.keywords).some((k) => k.cpc_bid))
    )
      error(
        "google_bid_strategy_mismatch",
        "CPC override поддерживается только для MANUAL_CPC.",
      );
  }
  const duplicateQuery = `SELECT campaign.resource_name, campaign.name, campaign.status FROM campaign WHERE campaign.name = ${quote(String(brief.campaign_name))} AND campaign.status != REMOVED`;
  if ((await query(duplicateQuery)).length)
    error(
      "google_campaign_duplicate",
      "Кампания с таким именем уже существует.",
    );
  const warnings: string[] = [],
    geo: JsonRow[] = [],
    languages: JsonRow[] = [],
    conversion: JsonRow[] = [];
  for (const location of list(brief.locations)) {
    const matches = (
      await suggest(
        String(location.name),
        location.country_code as string | undefined,
      )
    ).filter((s) => {
      const constant = row(s.geoTargetConstant ?? s);
      return (
        constant.status === "ENABLED" &&
        (!location.country_code ||
          constant.countryCode === location.country_code) &&
        (!location.geo_target_id ||
          String(constant.id) === location.geo_target_id)
      );
    });
    if (matches.length !== 1)
      throw new GoogleAdsWriteError(
        "google_geo_ambiguous",
        `Гео «${location.name}» не определено однозначно. Укажите country_code/geo_target_id. Кандидаты: ${
          matches
            .slice(0, 10)
            .map((s) => {
              const c = row(s.geoTargetConstant ?? s);
              return `${c.id}: ${c.canonicalName ?? c.name}`;
            })
            .join("; ") || "нет"
        }`,
      );
    const constant = row(matches[0]!.geoTargetConstant ?? matches[0]);
    if (!/^geoTargetConstants\/\d+$/.test(String(constant.resourceName)))
      error("google_geo_invalid", "Неверный Google geo target constant.");
    geo.push({
      input: location.name,
      ...constant,
      exclude: location.exclude === true,
      presence: "PRESENCE",
    });
    const verifiedGeo = await query(
      `SELECT geo_target_constant.resource_name, geo_target_constant.status FROM geo_target_constant WHERE geo_target_constant.id = ${constant.id}`,
    );
    if (
      verifiedGeo.length !== 1 ||
      row(verifiedGeo[0]!.geoTargetConstant).resourceName !==
        constant.resourceName ||
      row(verifiedGeo[0]!.geoTargetConstant).status !== "ENABLED"
    )
      error(
        "google_geo_invalid",
        "Geo target reference не подтверждён Google.",
      );
  }
  if (!geo.some((g) => !g.exclude))
    error("google_geo_invalid", "Нужна хотя бы одна включённая локация.");
  if (new Set(geo.map((g) => g.resourceName)).size !== geo.length)
    error("google_geo_duplicate", "Повторное/противоречивое geo targeting.");
  const aliases: Record<string, string> = {
    russian: "ru",
    русский: "ru",
    kazakh: "kk",
    казахский: "kk",
    english: "en",
    английский: "en",
  };
  for (const name of brief.languages as string[]) {
    const code = aliases[keyText(name)] ?? keyText(name);
    if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/.test(code))
      error(
        "google_language_invalid",
        "Укажите действительный язык или его код.",
      );
    const found = await query(
      `SELECT language_constant.resource_name, language_constant.id, language_constant.name, language_constant.code, language_constant.targetable FROM language_constant WHERE language_constant.code = ${quote(code)}`,
    );
    const value = row(found[0]?.languageConstant);
    if (
      found.length !== 1 ||
      value.targetable !== true ||
      !/^languageConstants\/\d+$/.test(String(value.resourceName))
    )
      error(
        "google_language_invalid",
        `Язык ${name} не найден или недоступен.`,
      );
    if (languages.some((l) => l.resourceName === value.resourceName))
      error("google_language_duplicate", "Повторяющийся язык.");
    languages.push({ input: name, ...value });
  }
  const available = (await query(actionsQuery)).map((r) =>
    row(r.conversionAction),
  );
  const goalRows = (await query(goalsQuery)).map((r) =>
    row(r.customerConversionGoal),
  );
  const requested = Array.isArray(brief.conversion_actions)
    ? (brief.conversion_actions as string[])
    : [];
  if (new Set(requested).size !== requested.length)
    error("google_conversion_invalid", "Повторяющиеся conversion action IDs.");
  const selected = requested.map((id) => {
    const action = available.find((a) => String(a.id) === id);
    if (
      !action ||
      action.status !== "ENABLED" ||
      action.resourceName !== `${prefix}/conversionActions/${id}`
    )
      return error(
        "google_conversion_invalid",
        `Conversion action ${id} отсутствует, отключён или принадлежит другому conversion customer.`,
      );
    return action;
  });
  if (
    selected.length &&
    row(customer.conversionTrackingSetting).googleAdsConversionCustomer !==
      prefix
  )
    error(
      "google_conversion_cross_account_unsupported",
      "Cross-account conversion goals нельзя создавать в одном атомарном customer mutation; требуется отдельное расширение.",
    );
  let customRequired = false;
  if (selected.length) {
    const resourceNames = new Set<string>(),
      semanticKeys = new Set<string>();
    for (const goal of goalRows) {
      stage0CampaignGoalResource(account_id, `${prefix}/campaigns/-2`, goal);
      const resourceName = String(goal.resourceName),
        semanticKey = `${goal.category}~${goal.origin}`;
      if (resourceNames.has(resourceName) || semanticKeys.has(semanticKey))
        error(
          "google_conversion_goal_invalid",
          "Duplicate/ambiguous canonical conversion goals; ничего не создаётся.",
        );
      resourceNames.add(resourceName);
      semanticKeys.add(semanticKey);
      const confirmed = await query(
          `${goalsQuery} WHERE customer_conversion_goal.resource_name = ${quote(resourceName)}`,
        ),
        value = row(confirmed[0]?.customerConversionGoal);
      if (
        confirmed.length !== 1 ||
        value.resourceName !== resourceName ||
        value.category !== goal.category ||
        value.origin !== goal.origin
      )
        error(
          "google_conversion_goal_invalid",
          "Canonical conversion goal reference не совпадает с provider category/origin; ничего не создаётся.",
        );
    }
  }
  for (const action of selected) {
    if (
      !goalRows.some(
        (g) => g.category === action.category && g.origin === action.origin,
      )
    )
      error(
        "google_conversion_invalid",
        "Для conversion action не найден Google goal.",
      );
    const peers = available.filter(
      (a) =>
        a.category === action.category &&
        a.origin === action.origin &&
        a.status === "ENABLED" &&
        a.primaryForGoal === true,
    );
    if (
      peers.some(
        (a) => !selected.some((s) => s.resourceName === a.resourceName),
      )
    )
      customRequired = true;
    if (action.primaryForGoal !== true) {
      customRequired = true;
      warnings.push(
        `Conversion ${action.name}: secondary action будет явно включён в bidding custom goal.`,
      );
    }
    let recent: unknown = null;
    try {
      const stats = await read(
        `SELECT segments.conversion_action, metrics.all_conversions FROM customer WHERE segments.date DURING LAST_30_DAYS AND segments.conversion_action = ${quote(String(action.resourceName))}`,
      );
      recent = stats.reduce(
        (n, r) => n + Number(row(r.metrics).allConversions ?? 0),
        0,
      );
    } catch {
      warnings.push(`Conversion ${action.name}: данные за 30 дней недоступны.`);
    }
    if (recent === 0)
      warnings.push(
        `Conversion ${action.name}: нет conversions за последние 30 дней.`,
      );
    conversion.push({ ...action, recent_all_conversions: recent });
  }
  if (!selected.length) {
    warnings.push(
      "Conversion goals явно не выбраны: проверьте inherited customer goals перед запуском.",
    );
    if (strategy === "MAXIMIZE_CONVERSIONS")
      error(
        "google_conversion_missing",
        "MAXIMIZE_CONVERSIONS требует явно проверенные conversion_actions.",
      );
  }
  let sequence = 0;
  const temp = (kind: string) => `${prefix}/${kind}/${--sequence}`;
  const operations: Stage0Operation[] = [],
    items: Stage1Plan["items"] = [];
  const add = (
    kind: Stage0Operation["kind"],
    fields: JsonRow,
    method: "create" | "update" = "create",
    mask: string | null = null,
    before: JsonRow | null = null,
    expected: JsonRow = fields,
  ) => {
    const index = operations.length;
    operations.push({
      kind,
      fields,
      method,
      resource_name:
        typeof fields.resourceName === "string" ? fields.resourceName : null,
      update_mask: mask,
      expected,
      before,
      row: index,
    });
    items.push({
      item: index,
      keyword: String(
        kind === "campaignBudget" && fields.explicitlyShared === false
          ? `Budget for ${brief.campaign_name}`
          : (fields.name ?? row(fields.keyword).text ?? kind),
      ),
      campaign_id: "new",
      campaign_name: String(brief.campaign_name),
      ad_group_id: String(fields.adGroup ?? ""),
      ad_group_name: "",
      before,
      after: expected,
      warnings: [],
      conflicts: [],
      duplicate_status: "none",
      provider_operations: [index],
    });
  };
  const budgetName = temp("campaignBudgets"),
    campaignName = temp("campaigns");
  const budgetFields = {
    resourceName: budgetName,
    amountMicros: budgetMicros,
    explicitlyShared: false,
    deliveryMethod: "STANDARD",
  };
  // Non-shared budget names are managed by Google, not independently writable.
  add("campaignBudget", budgetFields, "create", null, null, {
    ...budgetFields,
    name: brief.campaign_name,
  });
  add("campaign", {
    resourceName: campaignName,
    name: brief.campaign_name,
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    campaignBudget: budgetName,
    ...(strategy === "MANUAL_CPC"
      ? { manualCpc: {} }
      : { maximizeConversions: {} }),
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: row(brief.networks).search_partners === true,
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false,
    },
    geoTargetTypeSetting: {
      positiveGeoTargetType: "PRESENCE",
      negativeGeoTargetType: "PRESENCE",
    },
    containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    ...row(brief.effective_tracking),
    ...(brief.start_date
      ? { startDateTime: `${brief.start_date} 00:00:00` }
      : {}),
    ...(brief.end_date ? { endDateTime: `${brief.end_date} 23:59:59` } : {}),
  });
  for (const g of geo)
    add("campaignCriterion", {
      campaign: campaignName,
      negative: g.exclude,
      location: { geoTargetConstant: g.resourceName },
    });
  for (const proximity of list(brief.proximities)) {
    const fields = {
      campaign: campaignName,
      negative: false,
      proximity: stage0ProximityFields(proximity),
    };
    add("campaignCriterion", fields, "create", null, null, {
      ...fields,
      type: "PROXIMITY",
    });
    items.at(-1)!.keyword =
      `Radius ${proximity.radius} ${proximity.unit}: ${proximity.latitude}, ${proximity.longitude}`;
    items
      .at(-1)!
      .warnings.push(
        "Include only; PRESENCE. Google validate_only checks proximity/privacy eligibility; no address geocoding.",
      );
  }
  for (const l of languages)
    add("campaignCriterion", {
      campaign: campaignName,
      language: { languageConstant: l.resourceName },
    });
  const minuteEnum = ["ZERO", "FIFTEEN", "THIRTY", "FORTY_FIVE"];
  for (const s of list(brief.ad_schedule))
    for (const day of s.days as string[]) {
      const [sh, sm] = String(s.start).split(":").map(Number),
        [eh, em] = String(s.end).split(":").map(Number);
      add("campaignCriterion", {
        campaign: campaignName,
        adSchedule: {
          dayOfWeek: day,
          startHour: sh,
          startMinute: minuteEnum[sm! / 15],
          endHour: eh,
          endMinute: minuteEnum[em! / 15],
        },
      });
    }
  if (selected.length)
    for (const goal of goalRows) {
      const fields = {
        resourceName: stage0CampaignGoalResource(
          account_id,
          campaignName,
          goal,
        ),
        biddable:
          !customRequired &&
          selected.some(
            (a) => a.category === goal.category && a.origin === goal.origin,
          ),
      };
      add("campaignConversionGoal", fields, "update", "biddable", null, {
        ...fields,
        campaign: campaignName,
        category: goal.category,
        origin: goal.origin,
      });
    }
  if (customRequired) {
    const custom = temp("customConversionGoals");
    add("customConversionGoal", {
      resourceName: custom,
      name: `${brief.campaign_name} — selected actions`,
      conversionActions: selected.map((a) => a.resourceName),
    });
    add(
      "conversionGoalCampaignConfig",
      {
        resourceName: `${prefix}/conversionGoalCampaignConfigs/${campaignName.split("/").at(-1)}`,
        customConversionGoal: custom,
      },
      "update",
      "custom_conversion_goal",
    );
    warnings.push(
      "Explicit custom conversion goal: используются только выбранные actions; standard campaign goals отключены для bidding.",
    );
  }
  const campaignNegatives = list(brief.negative_keywords);
  for (const n of campaignNegatives)
    add(
      "campaignCriterion",
      keywordCreateFields(
        n as Stage1Item,
        { campaign: campaignName },
        true,
        currency,
      ),
    );
  for (const group of groups) {
    const groupName = temp("adGroups");
    add("adGroup", {
      resourceName: groupName,
      name: group.name,
      campaign: campaignName,
      status: "PAUSED",
      type: "SEARCH_STANDARD",
      ...(group.default_bid
        ? {
            cpcBidMicros: currencyMicros(
              String(row(group.default_bid).amount),
              String(row(group.default_bid).currency),
              currency,
            ),
          }
        : {}),
    });
    const negatives = [...campaignNegatives, ...list(group.negative_keywords)];
    for (const k of list(group.keywords)) {
      add(
        "adGroupCriterion",
        keywordCreateFields(
          k as Stage1Item,
          { adGroup: groupName },
          false,
          currency,
        ),
      );
      const conflicts = negatives.flatMap((n) => {
        const reason = conflictReason(
          String(n.text),
          n.match_type as "BROAD" | "PHRASE" | "EXACT",
          String(k.text),
        );
        return reason
          ? [
              {
                negative: n.text,
                affected_keyword: k.text,
                group: group.name,
                reason_code: reason,
              },
            ]
          : [];
      });
      items.at(-1)!.conflicts = conflicts;
      if (conflicts.length) {
        items
          .at(-1)!
          .warnings.push(
            "Минус-ключ блокирует планируемый активный ключ; проверьте перед подтверждением.",
          );
        warnings.push(`Группа ${group.name}: negative conflict для ${k.text}.`);
      }
    }
    for (const n of list(group.negative_keywords))
      add(
        "adGroupCriterion",
        keywordCreateFields(
          n as Stage1Item,
          { adGroup: groupName },
          true,
          currency,
        ),
      );
    for (const ad of list(group.rsa))
      add("adGroupAd", {
        adGroup: groupName,
        status: "PAUSED",
        ad: {
          finalUrls: [ad.final_url],
          responsiveSearchAd: {
            headlines: list(ad.headlines).map((h) => ({
              text: h.text,
              ...(h.pinned_field ? { pinnedField: h.pinned_field } : {}),
            })),
            descriptions: list(ad.descriptions).map((d) => ({
              text: d.text,
              ...(d.pinned_field ? { pinnedField: d.pinned_field } : {}),
            })),
            ...(ad.path1 ? { path1: ad.path1 } : {}),
            ...(ad.path2 ? { path2: ad.path2 } : {}),
          },
        },
      });
  }
  const assets = row(brief.assets);
  const createAsset = (fieldType: string, fields: JsonRow) => {
    const assetName = temp("assets");
    add("asset", { resourceName: assetName, ...fields });
    add("campaignAsset", {
      campaign: campaignName,
      asset: assetName,
      fieldType,
    });
  };
  for (const a of list(assets.sitelinks))
    createAsset("SITELINK", {
      finalUrls: [a.final_url],
      sitelinkAsset: {
        linkText: a.text,
        ...(a.description1
          ? { description1: a.description1, description2: a.description2 }
          : {}),
      },
    });
  for (const text of (assets.callouts ?? []) as string[]) {
    validateText(text, 25, "Callout");
    createAsset("CALLOUT", { calloutAsset: { calloutText: text } });
  }
  for (const a of list(assets.structured_snippets))
    createAsset("STRUCTURED_SNIPPET", {
      structuredSnippetAsset: { header: a.header, values: a.values },
    });
  if (assets.call)
    createAsset("CALL", {
      callAsset: {
        countryCode: row(assets.call).country_code,
        phoneNumber: row(assets.call).phone_number,
      },
    });
  if (assets.business_name)
    createAsset("BUSINESS_NAME", { textAsset: { text: assets.business_name } });
  for (const [property, fieldType] of [
    ["image_asset_ids", "AD_IMAGE"],
    ["logo_asset_ids", "BUSINESS_LOGO"],
  ])
    for (const id of (assets[property!] ?? []) as string[]) {
      const assetName = `${prefix}/assets/${id}`,
        found = await query(
          `SELECT asset.resource_name, asset.type FROM asset WHERE asset.resource_name = ${quote(assetName)}`,
        );
      if (
        found.length !== 1 ||
        row(found[0]!.asset).type !== "IMAGE" ||
        row(found[0]!.asset).resourceName !== assetName
      )
        error(
          "google_asset_invalid",
          "IMAGE asset не найден в выбранном аккаунте.",
        );
      add("campaignAsset", {
        campaign: campaignName,
        asset: assetName,
        fieldType,
      });
    }
  assertGoogleBatch(operations);
  items[1]!.warnings.push(
    ...warnings,
    `Стратегия: ${strategy}; campaign, ad groups и RSA создаются PAUSED. Активация отдельным preview.`,
  );
  return {
    version: 0,
    account_id,
    intent: { action: "campaign_create", brief },
    checks,
    operations,
    items,
    summary: {
      campaign_name: brief.campaign_name,
      currency,
      timezone,
      budget: { ...budget, micros: budgetMicros, shared: false },
      strategy,
      networks: operations[1]!.fields.networkSettings,
      dates: { start: brief.start_date ?? null, end: brief.end_date ?? null },
      locations: geo,
      ...(brief.proximities
        ? {
            proximities: list(brief.proximities).map((p) => ({
              ...p,
              provider: stage0ProximityFields(p),
              type: "PROXIMITY",
              include: true,
              presence: "PRESENCE",
            })),
          }
        : {}),
      languages,
      conversion_goals: conversion,
      ad_groups_count: groups.length,
      keywords_count: groups.reduce((n, g) => n + list(g.keywords).length, 0),
      negatives_count:
        campaignNegatives.length +
        groups.reduce((n, g) => n + list(g.negative_keywords).length, 0),
      rsa_count: groups.reduce((n, g) => n + list(g.rsa).length, 0),
      assets_count: operations.filter((o) => o.kind === "campaignAsset").length,
      utm: brief.effective_tracking,
      operation_count: operations.length,
      warnings,
      initial_status: "PAUSED",
    },
  };
}
export function stage0ProviderOperations(plan: Stage0Plan) {
  return plan.operations.map((o) => ({
    [`${o.kind}Operation`]: {
      [o.method]: o.fields,
      ...(o.update_mask ? { updateMask: o.update_mask } : {}),
    },
  }));
}
export function decodeStage0Mutation(
  input: unknown,
  plan: Stage0Plan,
  validate: boolean,
): Stage1MutationResult[] {
  if (!input || typeof input !== "object" || Array.isArray(input))
    error(
      "google_atomic_response_invalid",
      "Google вернул неверный ответ; preview/успех не подтверждены.",
    );
  const payload = row(input);
  if (payload.partialFailureError)
    error(
      "google_atomic_response_invalid",
      "Google вернул partial failure для атомарного запроса; исход требует сверки, повтор запрещён.",
    );
  if (validate)
    return plan.operations.map(() => ({
      success: true,
      resource_name: null,
      error: null,
    }));
  const responses = list(payload.mutateOperationResponses);
  if (responses.length !== plan.operations.length)
    return plan.operations.map(() => ({
      success: false,
      resource_name: null,
      error: googleWriteFailure("OUTCOME_UNCERTAIN"),
    }));
  return plan.operations.map((op, i) => {
    const name = row(responses[i]![`${op.kind}Result`]).resourceName;
    const expectedKind = resources[op.kind][2];
    const valid =
      typeof name === "string" &&
      name.startsWith(`customers/${plan.account_id}/${expectedKind}/`) &&
      /^\d{1,20}(?:~[A-Z0-9_]{1,80}){0,2}$/.test(
        name.slice(name.lastIndexOf("/") + 1),
      );
    return {
      success: valid,
      resource_name: valid ? name : null,
      error: valid ? null : googleWriteFailure("OUTCOME_UNCERTAIN"),
    };
  });
}
function replaceTemps(
  value: unknown,
  references: Map<string, string>,
): unknown {
  if (typeof value === "string") return references.get(value) ?? value;
  if (Array.isArray(value))
    return value.map((v) => replaceTemps(v, references));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceTemps(v, references)]),
    );
  return value;
}
function contains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((v, i) => contains(actual[i], v))
    );
  if (expected && typeof expected === "object")
    return Object.entries(expected).every(([k, v]) =>
      contains(row(actual)[k], v),
    );
  if (expected === false) return actual === undefined || actual === false;
  if (expected === 0) return actual === undefined || actual === 0;
  return (
    expected === actual ||
    (typeof expected === "number" && String(expected) === String(actual))
  );
}
export async function verifyStage0Mutation(
  plan: Stage0Plan,
  results: Stage1MutationResult[],
  read: Stage1Reader,
) {
  const references = new Map<string, string>();
  for (const [i, o] of plan.operations.entries())
    if (o.resource_name && results[i]?.resource_name)
      references.set(o.resource_name, results[i]!.resource_name!);
  const actual: (JsonRow | null)[] = [],
    items: JsonRow[] = [];
  const foundByResource = new Map<string, JsonRow>(),
    failedKinds = new Set<string>();
  for (const kind of new Set(plan.operations.map((o) => o.kind))) {
    const names = results
      .filter(
        (r, i) =>
          r.success && r.resource_name && plan.operations[i]?.kind === kind,
      )
      .map((r) => r.resource_name!);
    if (!names.length) continue;
    const [table, key] = resources[kind];
    try {
      const rows = await read(
        stage0Query(
          kind,
          `${table}.resource_name IN (${names.map(quote).join(", ")})`,
        ),
      );
      for (const r of rows) {
        const entity = row(r[key]);
        if (
          typeof entity.resourceName === "string" &&
          names.includes(entity.resourceName)
        )
          foundByResource.set(entity.resourceName, {
            ...entity,
            resource_name: entity.resourceName,
          });
      }
    } catch {
      failedKinds.add(kind);
    }
  }
  for (const [i, op] of plan.operations.entries()) {
    const readError = failedKinds.has(op.kind);
    const result = results[i];
    const entity =
      result?.success && result.resource_name
        ? (foundByResource.get(result.resource_name) ?? null)
        : null;
    const expected = row(replaceTemps(op.expected, references));
    // Resource IDs may be generated; update-only goal objects encode temporary campaign IDs.
    delete expected.resourceName;
    let budgetAssociationVerified = true;
    if (op.kind === "campaignBudget" && expected.explicitlyShared === false) {
      // Also handles immutable legacy plans with a now-invalid "— daily" name.
      // Derive from the previewed campaign, then prove the actual association.
      const attached = plan.operations.filter(
        (candidate) =>
          candidate.kind === "campaign" &&
          replaceTemps(candidate.expected.campaignBudget, references) ===
            result?.resource_name,
      );
      const campaignExpected = row(
        replaceTemps(attached[0]?.expected, references),
      );
      const campaignActual = foundByResource.get(
        String(campaignExpected.resourceName),
      );
      expected.name = campaignExpected.name;
      budgetAssociationVerified = Boolean(
        attached.length === 1 &&
        typeof expected.name === "string" &&
        expected.name.length > 0 &&
        campaignActual?.name === expected.name &&
        campaignActual.campaignBudget === result?.resource_name,
      );
    }
    if (op.kind === "campaign") {
      delete expected.manualCpc;
      delete expected.maximizeConversions;
      delete expected.containsEuPoliticalAdvertising;
      expected.biddingStrategyType = plan.summary.strategy;
    }
    const verified = Boolean(
      result?.success &&
      entity &&
      budgetAssociationVerified &&
      contains(entity, expected),
    );
    actual.push(entity);
    items.push({
      ...plan.items[i],
      operations: [
        {
          operation: i,
          success: verified,
          resource_name: result?.resource_name ?? null,
          error:
            result?.error ??
            (verified
              ? null
              : googleWriteFailure(
                  readError ? "REREAD_UNAVAILABLE" : "OUTCOME_UNCERTAIN",
                )),
          actual: entity,
        },
      ],
      success: verified,
    });
  }
  return {
    items,
    actual,
    status: items.every((i) => i.success)
      ? "VERIFIED"
      : results.every(
            (r) => !r.success && r.error?.google_code !== "OUTCOME_UNCERTAIN",
          )
        ? "FAILED"
        : "UNVERIFIED",
  };
}
export type LandingProbe = (
  url: string,
) => Promise<{ status: number; finalUrl: string }>;
export const probeLanding: LandingProbe = async (url) => {
  const options = {
    timeoutMs: 4000,
    maxBytes: 64 * 1024,
    maxRedirects: 3,
  };
  let result = await safeGet(url, { ...options, headOnly: true });
  if ([405, 501].includes(result.statusCode))
    result = await safeGet(url, options);
  return { status: result.statusCode, finalUrl: result.url };
};
export async function launchChecklist(
  account: string,
  campaignId: string,
  read: Stage1Reader,
  probe: LandingProbe = probeLanding,
) {
  validateBriefSchema(
    { provider: "GOOGLE_ADS", account_id: account, campaign_id: campaignId },
    campaignIdSchema,
  );
  const prefix = `customers/${customerId(account)}`,
    filter = `campaign.id = ${campaignId}`;
  const fetchKind = async (kind: Stage0Operation["kind"], where: string) =>
    list(await read(stage0Query(kind, where))).map((r) =>
      row(r[resources[kind][1]]),
    );
  const campaigns = await fetchKind(
    "campaign",
    `campaign.id = ${campaignId} AND campaign.status != REMOVED`,
  );
  if (campaigns.length !== 1)
    error(
      "google_campaign_unavailable",
      "Кампания не найдена в выбранном аккаунте.",
    );
  const campaign = campaigns[0]!;
  if (campaign.resourceName !== `${prefix}/campaigns/${campaignId}`)
    error("google_account_mismatch", "Кампания другого аккаунта.");
  const budget = await fetchKind(
    "campaignBudget",
    `campaign_budget.resource_name = ${quote(String(campaign.campaignBudget))}`,
  );
  const criteria = await fetchKind("campaignCriterion", filter),
    groups = await fetchKind(
      "adGroup",
      `${filter} AND ad_group.status != REMOVED`,
    ),
    keywords = await fetchKind(
      "adGroupCriterion",
      `${filter} AND ad_group_criterion.status != REMOVED AND ad_group_criterion.negative = FALSE`,
    ),
    ads = await fetchKind(
      "adGroupAd",
      `${filter} AND ad_group_ad.status != REMOVED`,
    ),
    assets = await fetchKind(
      "campaignAsset",
      `campaign_asset.campaign = ${quote(`${prefix}/campaigns/${campaignId}`)}`,
    ),
    goals = await fetchKind("campaignConversionGoal", filter);
  const actions = list(await read(actionsQuery)).map((r) =>
    row(r.conversionAction),
  );
  const configs = await fetchKind("conversionGoalCampaignConfig", filter);
  const customRef = String(configs[0]?.customConversionGoal ?? "");
  const custom = customRef
    ? await fetchKind(
        "customConversionGoal",
        `custom_conversion_goal.resource_name = ${quote(customRef)}`,
      )
    : [];
  const activeGoals = goals.filter((g) => g.biddable === true),
    usable = actions.filter(
      (a) =>
        a.status === "ENABLED" &&
        (customRef
          ? custom.length === 1 &&
            custom[0]!.status === "ENABLED" &&
            Array.isArray(custom[0]!.conversionActions) &&
            (custom[0]!.conversionActions as unknown[]).includes(a.resourceName)
          : a.primaryForGoal === true &&
            activeGoals.some(
              (g) => g.category === a.category && g.origin === a.origin,
            )),
    );
  const checklist: {
    code: string;
    status: "PASS" | "WARNING" | "FAIL";
    message: string;
    details?: unknown;
  }[] = [];
  const check = (
    code: string,
    good: boolean,
    message: string,
    failure: "WARNING" | "FAIL" = "FAIL",
    details?: unknown,
  ) =>
    checklist.push({
      code,
      status: good ? "PASS" : failure,
      message,
      ...(details === undefined ? {} : { details }),
    });
  check(
    "campaign_status",
    ["ENABLED", "PAUSED"].includes(String(campaign.status)),
    `Campaign ${campaign.status}; активация не включает группы и ads.`,
    "FAIL",
  );
  check(
    "budget",
    budget.length === 1 && BigInt(String(budget[0]?.amountMicros ?? "0")) > 0n,
    "Проверка ежедневного бюджета.",
    "FAIL",
    budget,
  );
  check(
    "strategy",
    ["MANUAL_CPC", "MAXIMIZE_CONVERSIONS"].includes(
      String(campaign.biddingStrategyType),
    ),
    "Поддерживаемая Search bidding strategy.",
  );
  check(
    "geo",
    criteria.some((c) => row(c.location).geoTargetConstant && !c.negative),
    "Включённые geo targets.",
  );
  check(
    "presence",
    row(campaign.geoTargetTypeSetting).positiveGeoTargetType === "PRESENCE",
    "Geo mode PRESENCE.",
  );
  check(
    "languages",
    criteria.some((c) => row(c.language).languageConstant),
    "Языковой таргетинг.",
  );
  check("ad_groups", groups.length > 0, "Группы объявлений.");
  check(
    "keywords",
    keywords.some((k) => row(k.keyword).text),
    "Положительные ключевые слова.",
  );
  check(
    "rsa",
    ads.length > 0 &&
      ads.every((a) => row(row(a.ad).responsiveSearchAd).headlines),
    "RSA присутствуют.",
  );
  check(
    "delivery_entities",
    groups.some((g) => g.status === "ENABLED") &&
      ads.some((a) => a.status === "ENABLED"),
    "PAUSED группы/ads не показываются после включения только кампании.",
    "WARNING",
  );
  check(
    "policy",
    ads.length > 0 &&
      ads.every((a) => row(a.policySummary).approvalStatus === "APPROVED"),
    "Google policy/moderation status; pending/unknown не считается approved.",
    "WARNING",
    ads.map((a) => a.policySummary ?? null),
  );
  check(
    "conversion_goal",
    usable.length > 0,
    "Conversion goal отсутствует или нет usable primary action.",
    campaign.biddingStrategyType === "MAXIMIZE_CONVERSIONS"
      ? "FAIL"
      : "WARNING",
    usable,
  );
  const health: JsonRow[] = [];
  for (const a of usable)
    try {
      const stats = await read(
        `SELECT segments.conversion_action, metrics.all_conversions FROM customer WHERE segments.date DURING LAST_30_DAYS AND segments.conversion_action = ${quote(String(a.resourceName))}`,
      );
      health.push({
        action: a.resourceName,
        conversions: stats.reduce(
          (n, r) => n + Number(row(r.metrics).allConversions ?? 0),
          0,
        ),
      });
    } catch {
      health.push({ action: a.resourceName, conversions: null });
    }
  check(
    "conversion_data",
    health.length > 0 && health.every((h) => Number(h.conversions) > 0),
    "Нет/неизвестны conversions за последние 30 дней.",
    "WARNING",
    health,
  );
  const urls = [
    ...new Set(
      ads
        .flatMap((a) =>
          Array.isArray(row(a.ad).finalUrls)
            ? (row(a.ad).finalUrls as string[])
            : [],
        )
        .concat(
          keywords.flatMap((k) =>
            Array.isArray(k.finalUrls) ? (k.finalUrls as string[]) : [],
          ),
        ),
    ),
  ];
  if (urls.length > 20)
    error(
      "google_url_check_limit",
      "Более 20 landing URLs: разбейте URL-check; ready не подтверждён.",
    );
  const outcomes = [];
  for (const url of urls)
    try {
      finalUrl(url);
      const r = await probe(url);
      outcomes.push({
        url,
        ok: r.status >= 200 && r.status < 400,
        http_status: r.status,
        final_url: r.finalUrl,
      });
    } catch {
      outcomes.push({ url, ok: false, error: "URL_UNREACHABLE_OR_UNSAFE" });
    }
  check(
    "final_urls",
    outcomes.length > 0 && outcomes.every((o) => o.ok),
    "Ограниченные безопасные HTTP-проверки landing URLs.",
    "FAIL",
    outcomes,
  );
  check(
    "tracking",
    Boolean(campaign.finalUrlSuffix || campaign.trackingUrlTemplate),
    "Campaign UTM/tracking.",
    "WARNING",
    {
      suffix: campaign.finalUrlSuffix ?? null,
      template: campaign.trackingUrlTemplate ?? null,
    },
  );
  check("assets", assets.length > 0, "Campaign assets.", "WARNING", assets);
  return {
    provider: "GOOGLE_ADS",
    account_id: account,
    campaign_id: campaignId,
    checklist,
    ready: checklist.every((c) => c.status === "PASS"),
    can_resume: !checklist.some((c) => c.status === "FAIL"),
    structure: {
      campaign,
      budget,
      criteria,
      groups,
      keywords,
      ads,
      assets,
      goals,
      configs,
      custom,
    },
  };
}
/** Delivery stop must not depend on launch readiness, URLs or conversion health. */
export async function buildPausePlan(
  account: string,
  input: unknown,
  read: Stage1Reader,
): Promise<Stage0Plan> {
  validateBriefSchema(input, campaignIdSchema);
  const brief = row(input),
    campaignId = String(brief.campaign_id),
    account_id = customerId(account),
    resourceName = `customers/${account_id}/campaigns/${campaignId}`,
    query = stage0Query("campaign", `campaign.id = ${campaignId}`),
    rows = await checkedRead(read, query),
    campaign = row(rows[0]?.campaign);
  if (
    rows.length !== 1 ||
    campaign.resourceName !== resourceName ||
    String(campaign.id) !== campaignId
  )
    error(
      "google_campaign_unavailable",
      "Google не вернул однозначную кампанию выбранного аккаунта.",
    );
  if (campaign.advertisingChannelType !== "SEARCH")
    error(
      "google_campaign_type_unsupported",
      "Campaign PAUSE preview поддерживает только Search campaign.",
    );
  if (campaign.status !== "ENABLED")
    error(
      "google_campaign_status_invalid",
      "Pause требует ENABLED campaign; no-op и REMOVED не записываются.",
    );
  const operation: Stage0Operation = {
    kind: "campaign",
    method: "update",
    resource_name: resourceName,
    fields: { resourceName, status: "PAUSED" },
    update_mask: "status",
    expected: { status: "PAUSED" },
    before: campaign,
    row: 0,
  };
  return {
    version: 0,
    account_id,
    intent: { action: "campaign_pause", brief },
    checks: [{ query, rows }],
    operations: [operation],
    items: [
      {
        item: 0,
        keyword: String(campaign.name),
        campaign_id: campaignId,
        campaign_name: String(campaign.name),
        ad_group_id: "",
        ad_group_name: "",
        before: campaign,
        after: operation.fields,
        warnings: [
          "Приостанавливается только campaign. Группы/ads не изменяются; повторный запуск требует отдельного resume preview.",
        ],
        conflicts: [],
        duplicate_status: "none",
        provider_operations: [0],
      },
    ],
    summary: {
      strategy: campaign.biddingStrategyType,
      campaign_name: campaign.name,
    },
  };
}
export async function buildResumePlan(
  account: string,
  input: unknown,
  read: Stage1Reader,
  probe?: LandingProbe,
): Promise<Stage0Plan> {
  validateBriefSchema(input, campaignIdSchema);
  const brief = row(input),
    campaignId = String(brief.campaign_id),
    account_id = customerId(account);
  const checklist = await launchChecklist(account_id, campaignId, read, probe);
  if (!checklist.can_resume)
    error(
      "google_launch_checklist_failed",
      "Launch checklist содержит FAIL. Исправьте ошибки и создайте новый resume preview.",
    );
  const campaign = checklist.structure.campaign;
  if (campaign.status !== "PAUSED")
    error(
      "google_campaign_status_invalid",
      "Resume требует PAUSED campaign; no-op не записывается.",
    );
  const checks: Stage0Plan["checks"] = [];
  for (const [kind, table] of [
    ["campaign", "campaign"],
    ["campaignCriterion", "campaign_criterion"],
    ["adGroup", "ad_group"],
    ["adGroupCriterion", "ad_group_criterion"],
    ["adGroupAd", "ad_group_ad"],
    ["campaignConversionGoal", "campaign_conversion_goal"],
  ] as [Stage0Operation["kind"], string][]) {
    const q = stage0Query(kind, `campaign.id = ${campaignId}`);
    checks.push({ query: q, rows: await checkedRead(read, q) });
    void table;
  }
  for (const q of [
    customerQuery,
    actionsQuery,
    stage0Query("conversionGoalCampaignConfig", `campaign.id = ${campaignId}`),
    ...(checklist.structure.custom.length
      ? [
          stage0Query(
            "customConversionGoal",
            `custom_conversion_goal.resource_name = ${quote(String(checklist.structure.custom[0]!.resourceName))}`,
          ),
        ]
      : []),
  ])
    checks.push({ query: q, rows: await checkedRead(read, q) });
  const operation: Stage0Operation = {
    kind: "campaign",
    method: "update",
    resource_name: String(campaign.resourceName),
    fields: { resourceName: campaign.resourceName, status: "ENABLED" },
    update_mask: "status",
    expected: { status: "ENABLED" },
    before: campaign,
    row: 0,
  };
  return {
    version: 0,
    account_id,
    intent: { action: "campaign_resume", brief },
    checks,
    operations: [operation],
    items: [
      {
        item: 0,
        keyword: String(campaign.name),
        campaign_id: campaignId,
        campaign_name: String(campaign.name),
        ad_group_id: "",
        ad_group_name: "",
        before: campaign,
        after: operation.fields,
        warnings: [
          "Включается только campaign. Группы/ads не изменяются.",
          ...checklist.checklist
            .filter((c) => c.status !== "PASS")
            .map((c) => c.message),
        ],
        conflicts: [],
        duplicate_status: "none",
        provider_operations: [0],
      },
    ],
    summary: {
      launch_checklist: checklist.checklist,
      strategy: campaign.biddingStrategyType,
      campaign_name: campaign.name,
    },
  };
}
/** Clone is deliberately fail-closed outside the explicitly supported Search surface. */
export async function buildClonePlan(
  account: string,
  input: unknown,
  read: Stage1Reader,
  build: (brief: JsonRow) => Promise<Stage0Plan>,
): Promise<Stage0Plan> {
  validateBriefSchema(input, campaignCloneSchema);
  const raw = row(input),
    account_id = customerId(account),
    id = String(raw.source_campaign_id);
  const checks: Stage0Plan["checks"] = [],
    q = async (query: string) => {
      const rows = await checkedRead(read, query);
      checks.push({ query, rows });
      return rows;
    };
  const fetchKind = async (kind: Stage0Operation["kind"], where: string) =>
    list(await q(stage0Query(kind, where))).map((r) =>
      row(r[resources[kind][1]]),
    );
  const campaigns = await fetchKind(
      "campaign",
      `campaign.id = ${id} AND campaign.status != REMOVED`,
    ),
    campaign = campaigns[0];
  if (
    campaigns.length !== 1 ||
    !campaign ||
    campaign.resourceName !== `customers/${account_id}/campaigns/${id}`
  )
    return error(
      "google_campaign_unavailable",
      "Source campaign не найдена в выбранном аккаунте.",
    );
  if (
    campaign.advertisingChannelType !== "SEARCH" ||
    !["MANUAL_CPC", "MAXIMIZE_CONVERSIONS"].includes(
      String(campaign.biddingStrategyType),
    )
  )
    error(
      "google_clone_unsupported_components",
      "Clone поддерживает только Search MANUAL_CPC/MAXIMIZE_CONVERSIONS.",
    );
  const budgets = await fetchKind(
    "campaignBudget",
    `campaign_budget.resource_name = ${quote(String(campaign.campaignBudget))}`,
  );
  if (budgets.length !== 1)
    error("google_clone_unsupported_components", "Source budget недоступен.");
  const customer = row((await q(customerQuery))[0]?.customer),
    currency = String(customer.currencyCode);
  const money = (micros: unknown) => {
    const n = BigInt(String(micros ?? 0));
    return {
      amount: `${n / 1_000_000n}.${String(n % 1_000_000n).padStart(6, "0")}`,
      currency,
    };
  };
  const criteria = await fetchKind("campaignCriterion", `campaign.id = ${id}`);
  const links = await q(
    `SELECT campaign_shared_set.resource_name, campaign_shared_set.status FROM campaign_shared_set WHERE campaign.id = ${id} AND campaign_shared_set.status != REMOVED`,
  );
  if (links.length)
    error(
      "google_clone_unsupported_components",
      "Clone shared negative list links пока не поддерживается; source не скопирован.",
    );
  const locations: JsonRow[] = [],
    languages: string[] = [],
    schedule: JsonRow[] = [],
    negatives: JsonRow[] = [];
  for (const c of criteria) {
    if (row(c.location).geoTargetConstant) {
      const resource = String(row(c.location).geoTargetConstant),
        constant = row(
          (
            await q(
              `SELECT geo_target_constant.id, geo_target_constant.name, geo_target_constant.country_code FROM geo_target_constant WHERE geo_target_constant.resource_name = ${quote(resource)}`,
            )
          )[0]?.geoTargetConstant,
        );
      if (!constant.id)
        error(
          "google_clone_unsupported_components",
          "Source geo constant недоступен.",
        );
      locations.push({
        name: constant.name,
        geo_target_id: String(constant.id),
        country_code: constant.countryCode,
        exclude: c.negative === true,
      });
    } else if (row(c.language).languageConstant) {
      const resource = String(row(c.language).languageConstant),
        constant = row(
          (
            await q(
              `SELECT language_constant.code FROM language_constant WHERE language_constant.resource_name = ${quote(resource)}`,
            )
          )[0]?.languageConstant,
        );
      if (!constant.code)
        error(
          "google_clone_unsupported_components",
          "Source language недоступен.",
        );
      languages.push(String(constant.code));
    } else if (c.adSchedule) {
      const s = row(c.adSchedule),
        minute: Record<string, string> = {
          ZERO: "00",
          FIFTEEN: "15",
          THIRTY: "30",
          FORTY_FIVE: "45",
        };
      schedule.push({
        days: [s.dayOfWeek],
        start: `${String(s.startHour ?? 0).padStart(2, "0")}:${minute[String(s.startMinute ?? "ZERO")]}`,
        end: `${String(s.endHour ?? 0).padStart(2, "0")}:${minute[String(s.endMinute ?? "ZERO")]}`,
      });
    } else if (c.negative && row(c.keyword).text)
      negatives.push({
        text: row(c.keyword).text,
        match_type: row(c.keyword).matchType,
      });
    else
      error(
        "google_clone_unsupported_components",
        "Source содержит неподдерживаемый criterion (proximity/audience/device и т.п.). Ничего не опущено молча.",
      );
  }
  const groups = await fetchKind(
      "adGroup",
      `campaign.id = ${id} AND ad_group.status != REMOVED`,
    ),
    adGroups: JsonRow[] = [];
  for (const g of groups) {
    if (g.type !== "SEARCH_STANDARD")
      error(
        "google_clone_unsupported_components",
        "Неподдерживаемый тип source ad group.",
      );
    const keys = await fetchKind(
        "adGroupCriterion",
        `ad_group.id = ${g.id} AND ad_group_criterion.status != REMOVED`,
      ),
      ads = await fetchKind(
        "adGroupAd",
        `ad_group.id = ${g.id} AND ad_group_ad.status != REMOVED`,
      );
    if (
      keys.some((k) => !row(k.keyword).text) ||
      ads.some((a) => !row(row(a.ad).responsiveSearchAd).headlines)
    )
      error(
        "google_clone_unsupported_components",
        "Source содержит не-keyword criterion или не-RSA ad.",
      );
    adGroups.push({
      name: g.name,
      ...(campaign.biddingStrategyType === "MANUAL_CPC"
        ? { default_bid: money(g.cpcBidMicros) }
        : {}),
      keywords: keys
        .filter((k) => !k.negative)
        .map((k) => ({
          text: row(k.keyword).text,
          match_type: row(k.keyword).matchType,
          ...(Array.isArray(k.finalUrls) && k.finalUrls.length === 1
            ? { final_url: k.finalUrls[0] }
            : {}),
          ...(campaign.biddingStrategyType === "MANUAL_CPC" &&
          BigInt(String(k.cpcBidMicros ?? 0)) > 0n
            ? { cpc_bid: money(k.cpcBidMicros) }
            : {}),
        })),
      negative_keywords: keys
        .filter((k) => k.negative)
        .map((k) => ({
          text: row(k.keyword).text,
          match_type: row(k.keyword).matchType,
        })),
      rsa: ads.map((a) => {
        const ad = row(a.ad),
          rsa = row(ad.responsiveSearchAd);
        if (
          !Array.isArray(ad.finalUrls) ||
          ad.finalUrls.length !== 1 ||
          keys.some((k) => Array.isArray(k.finalUrls) && k.finalUrls.length > 1)
        )
          error(
            "google_clone_unsupported_components",
            "Clone нескольких final URLs не поддерживается.",
          );
        return {
          final_url: (ad.finalUrls as string[])[0],
          headlines: list(rsa.headlines).map((h) => ({
            text: h.text,
            ...(h.pinnedField && h.pinnedField !== "UNSPECIFIED"
              ? { pinned_field: h.pinnedField }
              : {}),
          })),
          descriptions: list(rsa.descriptions).map((d) => ({
            text: d.text,
            ...(d.pinnedField && d.pinnedField !== "UNSPECIFIED"
              ? { pinned_field: d.pinnedField }
              : {}),
          })),
          ...(rsa.path1 ? { path1: rsa.path1 } : {}),
          ...(rsa.path2 ? { path2: rsa.path2 } : {}),
        };
      }),
    });
  }
  const assetLinks = await fetchKind(
      "campaignAsset",
      `campaign.id = ${id} AND campaign_asset.status != REMOVED`,
    ),
    assets: JsonRow = {
      sitelinks: [],
      callouts: [],
      structured_snippets: [],
      image_asset_ids: [],
      logo_asset_ids: [],
    };
  for (const link of assetLinks) {
    const found = await fetchKind(
        "asset",
        `asset.resource_name = ${quote(String(link.asset))}`,
      ),
      a = found[0];
    if (!a)
      error("google_clone_unsupported_components", "Source asset недоступен.");
    if (link.fieldType === "SITELINK") {
      const s = row(a!.sitelinkAsset);
      if (!Array.isArray(a!.finalUrls) || a!.finalUrls.length !== 1)
        error(
          "google_clone_unsupported_components",
          "Sitelink clone требует один final URL.",
        );
      (assets.sitelinks as JsonRow[]).push({
        text: s.linkText,
        final_url: (a!.finalUrls as string[])[0],
        ...(s.description1
          ? { description1: s.description1, description2: s.description2 }
          : {}),
      });
    } else if (link.fieldType === "CALLOUT")
      (assets.callouts as unknown[]).push(row(a!.calloutAsset).calloutText);
    else if (link.fieldType === "STRUCTURED_SNIPPET") {
      const s = row(a!.structuredSnippetAsset);
      (assets.structured_snippets as unknown[]).push({
        header: s.header,
        values: s.values,
      });
    } else if (["AD_IMAGE", "BUSINESS_LOGO"].includes(String(link.fieldType)))
      (
        assets[
          link.fieldType === "AD_IMAGE" ? "image_asset_ids" : "logo_asset_ids"
        ] as unknown[]
      ).push(String(link.asset).split("/").at(-1));
    else
      error(
        "google_clone_unsupported_components",
        `Source asset ${link.fieldType}: clone пока не поддерживается (call/business name/unknown details нельзя опускать).`,
      );
  }
  const goals = await fetchKind(
      "campaignConversionGoal",
      `campaign.id = ${id}`,
    ),
    actions = list(await q(actionsQuery)).map((r) => row(r.conversionAction));
  const requested = actions
    .filter(
      (a) =>
        a.status === "ENABLED" &&
        a.primaryForGoal === true &&
        goals.some(
          (g) =>
            g.biddable === true &&
            g.category === a.category &&
            g.origin === a.origin,
        ),
    )
    .map((a) => String(a.id));
  const custom = await q(
    `SELECT conversion_goal_campaign_config.custom_conversion_goal FROM conversion_goal_campaign_config WHERE campaign.id = ${id}`,
  );
  if (
    custom.some((c) => row(c.conversionGoalCampaignConfig).customConversionGoal)
  )
    error(
      "google_clone_unsupported_components",
      "Custom conversion goal clone не поддерживается.",
    );
  const networks = row(campaign.networkSettings);
  if (
    networks.targetContentNetwork === true ||
    networks.targetPartnerSearchNetwork === true ||
    row(campaign.geoTargetTypeSetting).positiveGeoTargetType !== "PRESENCE"
  )
    error(
      "google_clone_unsupported_components",
      "Source networks/geo mode выходят за безопасные builder defaults.",
    );
  const dates = raw.new_dates
    ? row(raw.new_dates)
    : {
        ...(campaign.startDateTime
          ? { start_date: String(campaign.startDateTime).slice(0, 10) }
          : {}),
        ...(campaign.endDateTime &&
        String(campaign.endDateTime).slice(0, 10) !== "2037-12-30"
          ? { end_date: String(campaign.endDateTime).slice(0, 10) }
          : {}),
      };
  const brief: JsonRow = {
    provider: "GOOGLE_ADS",
    account_id,
    campaign_name: raw.new_name,
    daily_budget: raw.new_budget ?? money(budgets[0]!.amountMicros),
    locations: raw.new_locations ?? locations,
    languages,
    ad_groups: adGroups,
    negative_keywords: negatives,
    assets,
    bidding_strategy: campaign.biddingStrategyType,
    ...dates,
    ...(schedule.length ? { ad_schedule: schedule } : {}),
    ...(requested.length ? { conversion_actions: requested } : {}),
    networks: { search_partners: networks.targetSearchNetwork === true },
    utm: {
      ...(campaign.finalUrlSuffix
        ? { final_url_suffix: campaign.finalUrlSuffix }
        : {}),
      ...(campaign.trackingUrlTemplate
        ? { tracking_url_template: campaign.trackingUrlTemplate }
        : {}),
    },
  };
  const plan = await build(brief);
  plan.checks.push(...checks);
  plan.summary.clone_source_campaign_id = id;
  plan.items[1]!.warnings.push(
    `Clone source ${id}; все target campaign/groups/RSA PAUSED. Автоматическое удаление/rollback не поддерживается.`,
  );
  return plan;
}

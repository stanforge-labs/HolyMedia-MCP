import { canonical, type Stage1Reader } from "./google-ads-stage1.js";
import {
  assertExtendedPlan,
  extClosed,
  extContext,
  extFail,
  extId,
  extItem,
  extOwner,
  extQuote,
  extRow,
  type ExtendedKind,
  type ExtendedPlan,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";

export type Stage3Intent = ExtendedRow & {
  action: "targeting";
  items: ExtendedRow[];
};
export type Stage3GeoSuggest = (
  name: string,
  country?: string,
) => Promise<ExtendedRow[]>;
export const STAGE3_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];
export const STAGE3_DEMOGRAPHICS: Record<string, string[]> = {
  AGE_RANGE: [
    "AGE_RANGE_18_24",
    "AGE_RANGE_25_34",
    "AGE_RANGE_35_44",
    "AGE_RANGE_45_54",
    "AGE_RANGE_55_64",
    "AGE_RANGE_65_UP",
    "AGE_RANGE_UNDETERMINED",
  ],
  GENDER: ["MALE", "FEMALE", "UNDETERMINED"],
  PARENTAL_STATUS: ["PARENT", "NOT_A_PARENT", "UNDETERMINED"],
  INCOME_RANGE: [
    "INCOME_RANGE_0_50",
    "INCOME_RANGE_50_60",
    "INCOME_RANGE_60_70",
    "INCOME_RANGE_70_80",
    "INCOME_RANGE_80_90",
    "INCOME_RANGE_90_UP",
    "INCOME_RANGE_UNDETERMINED",
  ],
};
export const STAGE3_ACTION_FIELDS: Record<
  string,
  { allowed: string[]; required: string[] }
> = {
  audience_add: {
    allowed: ["audience", "mode", "bid_modifier"],
    required: ["audience", "mode"],
  },
  audience_exclude: {
    allowed: ["audience", "mode"],
    required: ["audience", "mode"],
  },
  audience_remove: {
    allowed: ["criterion_id", "acknowledge_irreversible"],
    required: ["criterion_id", "acknowledge_irreversible"],
  },
  audience_mode: { allowed: ["mode"], required: ["mode"] },
  audience_bid_modifier: {
    allowed: ["criterion_id", "bid_modifier"],
    required: ["criterion_id", "bid_modifier"],
  },
  demographic_add: {
    allowed: ["dimension", "value", "bid_modifier"],
    required: ["dimension", "value"],
  },
  demographic_exclude: {
    allowed: ["dimension", "value"],
    required: ["dimension", "value"],
  },
  demographic_bid_modifier: {
    allowed: ["dimension", "criterion_id", "bid_modifier"],
    required: ["dimension", "criterion_id", "bid_modifier"],
  },
  geo_add: {
    allowed: ["name", "country_code", "geo_target_id"],
    required: ["name"],
  },
  geo_exclude: {
    allowed: ["name", "country_code", "geo_target_id"],
    required: ["name"],
  },
  radius_add: {
    allowed: ["latitude", "longitude", "radius", "unit"],
    required: ["latitude", "longitude", "radius", "unit"],
  },
  presence: { allowed: ["positive", "negative"], required: ["positive"] },
  language_add: { allowed: ["name"], required: ["name"] },
  schedule_add: {
    allowed: ["days", "start", "end", "bid_modifier"],
    required: ["days", "start", "end"],
  },
  schedule_bid_modifier: {
    allowed: ["criterion_id", "bid_modifier"],
    required: ["criterion_id", "bid_modifier"],
  },
  device_modifier: {
    allowed: ["device", "bid_modifier"],
    required: ["device", "bid_modifier"],
  },
  criterion_remove: {
    allowed: ["criterion_id", "criterion_type", "acknowledge_irreversible"],
    required: ["criterion_id", "criterion_type", "acknowledge_irreversible"],
  },
  custom_audience_create: {
    allowed: ["name", "description", "members", "privacy_ack"],
    required: ["name", "members", "privacy_ack"],
  },
  custom_audience_update: {
    allowed: [
      "custom_audience_id",
      "name",
      "description",
      "members",
      "privacy_ack",
      "acknowledge_replace_members",
    ],
    required: ["custom_audience_id", "privacy_ack"],
  },
};
export const STAGE3_AUDIENCE_TYPES = [
  "USER_LIST",
  "IN_MARKET",
  "AFFINITY",
  "CUSTOM",
  "DETAILED_DEMOGRAPHIC",
];
const audienceTypes = STAGE3_AUDIENCE_TYPES;
// EXTENDED_DEMOGRAPHIC is a local oneof selector, NOT CriterionTypeEnum v24.
// The provider exposes extendedDemographicId but no enum value with this name.
const audienceCriterionTypes = [
  "USER_LIST",
  "USER_INTEREST",
  "CUSTOM_AUDIENCE",
  "EXTENDED_DEMOGRAPHIC",
];
const removableTypes = [
  "USER_LIST",
  "USER_INTEREST",
  "CUSTOM_AUDIENCE",
  "EXTENDED_DEMOGRAPHIC",
  "AGE_RANGE",
  "GENDER",
  "PARENTAL_STATUS",
  "INCOME_RANGE",
  "LOCATION",
  "PROXIMITY",
  "LANGUAGE",
  "AD_SCHEDULE",
];
function text(v: unknown, label: string, max = 255): string {
  if (
    typeof v !== "string" ||
    !v.trim() ||
    v.length > max ||
    [...v].some((c) => c.codePointAt(0)! < 32)
  )
    extFail(
      "google_stage3_input_invalid",
      `${label}: требуется непустая строка до ${max} символов.`,
    );
  return v.trim();
}
function choice(v: unknown, choices: string[], label: string): string {
  if (typeof v !== "string" || !choices.includes(v))
    extFail(
      "google_stage3_input_invalid",
      `${label}: допустимы ${choices.join(", ")}.`,
    );
  return v;
}
function modifier(v: unknown, device = false): number {
  if (
    typeof v !== "number" ||
    !Number.isFinite(v) ||
    ((v < 0.1 || v > 10) && !(device && v === 0))
  )
    extFail(
      "google_stage3_modifier_invalid",
      "Bid modifier должен быть 0.1–10; только device допускает 0 для исключения.",
    );
  return v;
}
function time(v: unknown, end = false): number {
  if (
    typeof v !== "string" ||
    (!/^(?:[01][0-9]|2[0-3]):(?:00|15|30|45)$/.test(v) &&
      !(end && v === "24:00"))
  )
    extFail(
      "google_stage3_schedule_invalid",
      "Время HH:MM должно иметь шаг 15 минут; 24:00 допустимо только для конца дня.",
    );
  return Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
}
function members(v: unknown): ExtendedRow[] {
  if (!Array.isArray(v) || !v.length || v.length > 100)
    extFail(
      "google_stage3_custom_invalid",
      "Custom audience: требуется 1–100 typed members; PII и Customer Match uploads не поддерживаются.",
    );
  const seen = new Set<string>();
  return v.map((raw) => {
    const m = extClosed(raw, ["type", "value"], ["type", "value"]),
      type = choice(m.type, ["KEYWORD", "URL", "APP"], "member type"),
      value = text(m.value, "member value", type === "URL" ? 2048 : 80);
    if (
      type === "KEYWORD" &&
      (value.split(/\s+/u).length > 10 || /@|\b[0-9]{7,}\b/u.test(value))
    )
      extFail(
        "google_stage3_custom_invalid",
        "Keyword member: максимум 10 слов, без email/телефонов/идентификаторов пользователей.",
      );
    if (type === "APP" && !/^[a-zA-Z][\w]*(?:\.[a-zA-Z][\w]*)+$/u.test(value))
      extFail(
        "google_stage3_custom_invalid",
        "APP member требует Android package name.",
      );
    if (type === "URL") {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        return extFail(
          "google_stage3_custom_invalid",
          "Некорректный URL member.",
        );
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        !url.hostname.includes(".") ||
        /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|\[)/u.test(
          url.hostname,
        ) ||
        url.search ||
        url.hash
      )
        extFail(
          "google_stage3_custom_invalid",
          "URL member: публичный HTTP(S) URL без credentials, query/fragment или localhost.",
        );
    }
    const key = `${type}:${value.toLocaleLowerCase("en")}`;
    if (seen.has(key))
      extFail(
        "google_stage3_duplicate",
        "Повторяющийся custom audience member.",
      );
    seen.add(key);
    return { memberType: type, [type.toLowerCase()]: value };
  });
}
export function parseStage3Intent(raw: unknown): Stage3Intent {
  const r = extClosed(raw, ["action", "items"], ["action", "items"]);
  if (
    r.action !== "targeting" ||
    !Array.isArray(r.items) ||
    !r.items.length ||
    r.items.length > 500
  )
    extFail(
      "google_stage3_input_invalid",
      "Укажите action targeting и 1–500 typed строк.",
    );
  const seen = new Set<string>();
  const items = r.items.map((rawItem) => {
    const loose = extRow(rawItem),
      action = String(loose.operation),
      spec = STAGE3_ACTION_FIELDS[action];
    if (!spec)
      extFail(
        "google_stage3_unsupported",
        "Неподдерживаемая Stage 3 операция; raw Google payload запрещён.",
      );
    const custom = action.startsWith("custom_audience_");
    const common = custom
      ? ["operation"]
      : ["operation", "level", "campaign_id", "ad_group_id"];
    const x = extClosed(
      rawItem,
      [...common, ...spec.allowed],
      [
        ...(custom ? ["operation"] : ["operation", "level", "campaign_id"]),
        ...spec.required,
      ],
    );
    if (!custom) {
      extId(x.campaign_id, "campaign_id");
      choice(x.level, ["CAMPAIGN", "AD_GROUP"], "level");
      if (x.level === "AD_GROUP") extId(x.ad_group_id, "ad_group_id");
      else if (x.ad_group_id !== undefined)
        extFail(
          "google_stage3_input_invalid",
          "Campaign-level операция не принимает ad_group_id.",
        );
      if (
        [
          "geo_add",
          "geo_exclude",
          "radius_add",
          "presence",
          "language_add",
          "schedule_add",
          "schedule_bid_modifier",
          "device_modifier",
        ].includes(action) &&
        x.level !== "CAMPAIGN"
      )
        extFail(
          "google_stage3_unsupported",
          "Гео, язык, расписание и device profile поддерживаются только на campaign level.",
        );
    }
    if (x.criterion_id !== undefined) extId(x.criterion_id, "criterion_id");
    if (action.endsWith("remove") && x.acknowledge_irreversible !== true)
      extFail(
        "google_stage3_removal_requires_ack",
        "Удаление criterion требует acknowledge_irreversible=true и отдельного human approval.",
      );
    if (x.mode !== undefined)
      choice(x.mode, ["OBSERVATION", "TARGETING"], "audience mode");
    if (x.bid_modifier !== undefined)
      modifier(x.bid_modifier, action === "device_modifier");
    if (
      action === "audience_add" &&
      x.bid_modifier !== undefined &&
      x.mode !== "OBSERVATION"
    )
      extFail(
        "google_stage3_observation_required",
        "PPC P203: audience bid_modifier допустим только в OBSERVATION; TARGETING не переключается автоматически.",
      );
    if (x.audience !== undefined) {
      const a = extClosed(x.audience, ["kind", "id", "name"], ["kind"]);
      choice(a.kind, audienceTypes, "audience kind");
      if (a.id === undefined && a.name === undefined)
        extFail(
          "google_stage3_input_invalid",
          "Audience требует id либо точное name.",
        );
      if (a.id !== undefined) extId(a.id, "audience id");
      if (a.name !== undefined) text(a.name, "audience name");
      if (action === "audience_exclude" && a.kind === "CUSTOM")
        extFail(
          "google_stage3_unsupported",
          "Google Ads API v24 не поддерживает negative CUSTOM_AUDIENCE criterion. Definitions не исключаются этим инструментом.",
        );
    }
    if (
      action === "demographic_add" &&
      x.dimension === "PARENTAL_STATUS" &&
      x.level === "CAMPAIGN"
    )
      extFail(
        "google_stage3_unsupported",
        "Campaign-level PARENTAL_STATUS поддерживает только negative/exclude. Positive targeting допустим на ad group level.",
      );
    if (action === "demographic_bid_modifier")
      choice(x.dimension, Object.keys(STAGE3_DEMOGRAPHICS), "dimension");
    else if (action.startsWith("demographic_"))
      choice(
        x.value,
        STAGE3_DEMOGRAPHICS[
          choice(x.dimension, Object.keys(STAGE3_DEMOGRAPHICS), "dimension")
        ]!,
        "demographic value",
      );
    if (action === "criterion_remove")
      choice(x.criterion_type, removableTypes, "criterion_type");
    if (x.name !== undefined) text(x.name, "name");
    if (x.description !== undefined) text(x.description, "description", 1000);
    if (
      x.country_code !== undefined &&
      (typeof x.country_code !== "string" || !/^[A-Z]{2}$/.test(x.country_code))
    )
      extFail("google_stage3_geo_invalid", "country_code: ISO-2 uppercase.");
    if (x.geo_target_id !== undefined) extId(x.geo_target_id, "geo_target_id");
    if (action === "radius_add") {
      if (
        typeof x.latitude !== "number" ||
        !Number.isFinite(x.latitude) ||
        Math.abs(x.latitude) > 90 ||
        typeof x.longitude !== "number" ||
        !Number.isFinite(x.longitude) ||
        Math.abs(x.longitude) > 180 ||
        typeof x.radius !== "number" ||
        !Number.isFinite(x.radius) ||
        x.radius < 1 ||
        x.radius > 500
      )
        extFail(
          "google_stage3_geo_invalid",
          "Radius: координаты ±90/±180 и 1–500 километров/миль; адреса не геокодируются молча.",
        );
      choice(x.unit, ["KILOMETERS", "MILES"], "radius unit");
    }
    if (action === "presence") {
      choice(
        x.positive,
        ["PRESENCE", "PRESENCE_OR_INTEREST"],
        "positive geo mode",
      );
      if (x.negative !== undefined)
        choice(
          x.negative,
          ["PRESENCE", "PRESENCE_OR_INTEREST"],
          "negative geo mode",
        );
    }
    if (action === "schedule_add") {
      if (
        !Array.isArray(x.days) ||
        !x.days.length ||
        x.days.length > 7 ||
        new Set(x.days).size !== x.days.length
      )
        extFail(
          "google_stage3_schedule_invalid",
          "days: 1–7 уникальных дней недели.",
        );
      x.days.forEach((d) => choice(d, STAGE3_DAYS, "day"));
      if (time(x.start) >= time(x.end, true))
        extFail(
          "google_stage3_schedule_invalid",
          "Расписание не может пересекать полночь: разделите на два дня.",
        );
    }
    if (action === "device_modifier")
      choice(x.device, ["MOBILE", "DESKTOP", "TABLET"], "device");
    if (custom) {
      if (x.privacy_ack !== true)
        extFail(
          "google_stage3_privacy_ack",
          "Custom audience definitions требуют privacy_ack=true; загрузка персональных данных не поддерживается.",
        );
      if (x.custom_audience_id !== undefined)
        extId(x.custom_audience_id, "custom_audience_id");
      if (x.members !== undefined) members(x.members);
      if (
        action === "custom_audience_update" &&
        x.members !== undefined &&
        x.acknowledge_replace_members !== true
      )
        extFail(
          "google_stage3_custom_replace_requires_ack",
          "Google заменяет весь members array; подтвердите acknowledge_replace_members=true.",
        );
      if (
        action === "custom_audience_update" &&
        !["name", "description", "members"].some((k) => x[k] !== undefined)
      )
        extFail(
          "google_stage3_input_invalid",
          "Custom audience update не содержит изменений.",
        );
    }
    const key = canonical(x);
    if (seen.has(key))
      extFail(
        "google_stage3_duplicate",
        "Дубликат typed targeting row; вся пачка отклонена.",
      );
    seen.add(key);
    return x;
  });
  if (
    items.some((x) => String(x.operation).startsWith("custom_audience_")) &&
    items.some((x) => !String(x.operation).startsWith("custom_audience_"))
  )
    extFail(
      "google_stage3_custom_service_mixed",
      "CustomAudienceService не входит в GoogleAdsService.Mutate v24; definitions и campaign criteria требуют отдельных controlled previews.",
    );
  return { action: "targeting", items };
}

const parentFields =
  "campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.advertising_channel_sub_type, campaign.bidding_strategy, campaign.bidding_strategy_type, campaign.targeting_setting.target_restrictions, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type";
const groupFields =
  "ad_group.resource_name, ad_group.id, ad_group.name, ad_group.status, ad_group.campaign, ad_group.targeting_setting.target_restrictions";
const typeFields: Record<string, string[]> = {
  USER_LIST: ["user_list.user_list"],
  USER_INTEREST: ["user_interest.user_interest_category"],
  CUSTOM_AUDIENCE: ["custom_audience.custom_audience"],
  EXTENDED_DEMOGRAPHIC: ["extended_demographic.extended_demographic_id"],
  AGE_RANGE: ["age_range.type"],
  GENDER: ["gender.type"],
  PARENTAL_STATUS: ["parental_status.type"],
  INCOME_RANGE: ["income_range.type"],
  LOCATION: ["location.geo_target_constant"],
  LANGUAGE: ["language.language_constant"],
  DEVICE: ["device.type"],
  PROXIMITY: [
    "proximity.geo_point.latitude_in_micro_degrees",
    "proximity.geo_point.longitude_in_micro_degrees",
    "proximity.radius",
    "proximity.radius_units",
  ],
  AD_SCHEDULE: [
    "ad_schedule.day_of_week",
    "ad_schedule.start_hour",
    "ad_schedule.start_minute",
    "ad_schedule.end_hour",
    "ad_schedule.end_minute",
  ],
};
function criterionQuery(
  level: string,
  parent: string,
  types: string[],
): string {
  const table =
      level === "CAMPAIGN" ? "campaign_criterion" : "ad_group_criterion",
    parentField = level === "CAMPAIGN" ? "campaign" : "ad_group";
  const fields = [
    "resource_name",
    "criterion_id",
    parentField,
    "type",
    "status",
    "negative",
    "bid_modifier",
    ...types.flatMap((t) => typeFields[t] ?? []),
  ];
  const enumTypes = types.filter((type) => type !== "EXTENDED_DEMOGRAPHIC"),
    extended = types.includes("EXTENDED_DEMOGRAPHIC"),
    // GAQL has AND only, not OR. Mixed inventory must freeze all criteria
    // belonging to this exact parent and classify oneofs locally, not guess a
    // provider enum or drop extended demographic siblings.
    filter = extended
      ? enumTypes.length
        ? ""
        : ` AND ${table}.extended_demographic.extended_demographic_id > 0`
      : ` AND ${table}.type IN (${enumTypes.map(extQuote).join(", ")})`;
  return `SELECT ${[...new Set(fields)].map((f) => `${table}.${f}`).join(", ")} FROM ${table} WHERE ${table}.${parentField} = ${extQuote(parent)} AND ${table}.status != 'REMOVED'${filter}`;
}
function matchesCriterionSelector(value: ExtendedRow, types: string[]) {
  if (
    types.includes("EXTENDED_DEMOGRAPHIC") &&
    /^[1-9][0-9]{0,19}$/u.test(
      String(extRow(value.extendedDemographic).extendedDemographicId),
    )
  ) {
    // A provider oneof cannot simultaneously represent a keyword or another
    // targeting family; reject contradictory/mock/unsafe responses explicitly.
    if (
      [
        "keyword",
        ...Object.keys(typeFields)
          .filter((t) => t !== "EXTENDED_DEMOGRAPHIC")
          .map((t) =>
            t
              .toLowerCase()
              .replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
          ),
      ].some((field) => Object.keys(extRow(value[field])).length)
    )
      extFail(
        "google_stage3_criterion_invalid",
        "Provider criterion содержит противоречивые oneof targeting fields; mutation запрещена.",
      );
    return true;
  }
  return types
    .filter((t) => t !== "EXTENDED_DEMOGRAPHIC")
    .includes(String(value.type));
}
function audienceQuery(
  kind: string,
  a: ExtendedRow,
): {
  query: string;
  key: string;
  field: string;
  reference: string;
  resourceKind: string;
} {
  const type =
    kind === "USER_LIST"
      ? "user_list"
      : kind === "CUSTOM"
        ? "custom_audience"
        : kind === "DETAILED_DEMOGRAPHIC"
          ? "detailed_demographic"
          : "user_interest";
  const key =
    type === "user_list"
      ? "userList"
      : type === "custom_audience"
        ? "customAudience"
        : type === "detailed_demographic"
          ? "detailedDemographic"
          : "userInterest";
  const resourceKind =
    type === "user_list"
      ? "userLists"
      : type === "custom_audience"
        ? "customAudiences"
        : type === "detailed_demographic"
          ? "detailedDemographics"
          : "userInterests";
  const field =
    type === "user_list"
      ? "userList"
      : type === "custom_audience"
        ? "customAudience"
        : type === "detailed_demographic"
          ? "extendedDemographic"
          : "userInterest";
  const reference =
    field === "userInterest"
      ? "userInterestCategory"
      : field === "extendedDemographic"
        ? "extendedDemographicId"
        : field;
  const fields =
    type === "user_list"
      ? [
          "resource_name",
          "id",
          "name",
          "membership_status",
          "account_user_list_status",
          "eligible_for_search",
          "eligible_for_display",
        ]
      : type === "custom_audience"
        ? [
            "resource_name",
            "id",
            "name",
            "status",
            "type",
            "description",
            "members",
          ]
        : type === "detailed_demographic"
          ? ["resource_name", "id", "name", "launched_to_all", "availabilities"]
          : [
              "resource_name",
              "user_interest_id",
              "name",
              "taxonomy_type",
              "launched_to_all",
              "availabilities",
            ];
  const idField = type === "user_interest" ? "user_interest_id" : "id";
  const where =
    a.id !== undefined
      ? `${type}.${idField} = ${a.id}`
      : `${type}.name = ${extQuote(String(a.name))}`;
  return {
    query: `SELECT ${fields.map((f) => `${type}.${f}`).join(", ")} FROM ${type} WHERE ${where}`,
    key,
    field,
    reference,
    resourceKind,
  };
}
function minuteEnum(n: number): string {
  return ["ZERO", "FIFTEEN", "THIRTY", "FORTY_FIVE"][(n % 60) / 15]!;
}
function scheduleMinutes(
  schedule: ExtendedRow,
  prefix: "start" | "end",
): number {
  return (
    Number(schedule[`${prefix}Hour`]) * 60 +
    ["ZERO", "FIFTEEN", "THIRTY", "FORTY_FIVE"].indexOf(
      String(schedule[`${prefix}Minute`]),
    ) *
      15
  );
}
function requireManualModifier(
  campaign: ExtendedRow,
  amount: number,
  device = false,
) {
  if (device && amount === 0) return;
  if (
    !["MANUAL_CPC", "TARGET_SPEND"].includes(
      String(campaign.biddingStrategyType),
    ) ||
    campaign.biddingStrategy
  )
    extFail(
      "google_stage3_strategy_incompatible",
      "Этот modifier profile требует standard Manual CPC / Maximize Clicks. Автоматические/portfolio стратегии могут игнорировать modifier; операция отклонена, не имитируется.",
    );
}
function availabilityProven(
  audience: ExtendedRow,
  campaign: ExtendedRow,
): boolean {
  if (audience.launchedToAll === true) return true;
  return (
    Array.isArray(audience.availabilities) &&
    audience.availabilities.map(extRow).some((a) => {
      const channel = extRow(a.channel),
        mode = channel.availabilityMode;
      const matches =
        mode === "ALL_CHANNELS" ||
        (channel.advertisingChannelType === campaign.advertisingChannelType &&
          (mode === "CHANNEL_TYPE_AND_ALL_SUBTYPES" ||
            (mode === "CHANNEL_TYPE_AND_SUBSET_SUBTYPES" &&
              (campaign.advertisingChannelSubType &&
              campaign.advertisingChannelSubType !== "UNSPECIFIED"
                ? Array.isArray(channel.advertisingChannelSubType) &&
                  channel.advertisingChannelSubType.includes(
                    campaign.advertisingChannelSubType,
                  )
                : channel.includeDefaultChannelSubType === true))));
      return (
        matches &&
        Array.isArray(a.locale) &&
        a.locale.map(extRow).some((l) => l.availabilityMode === "ALL_LOCALES")
      );
    })
  );
}

export async function buildStage3Plan(
  account: string,
  rawIntent: unknown,
  read: Stage1Reader,
  suggestGeo?: Stage3GeoSuggest,
): Promise<ExtendedPlan> {
  const intent = parseStage3Intent(rawIntent),
    ctx = await extContext(account, read),
    prefix = `customers/${ctx.account_id}`;
  const plan: ExtendedPlan = {
    version: 3,
    account_id: ctx.account_id,
    intent,
    checks: ctx.checks,
    operations: [],
    items: [],
    atomic: false,
    irreversible: false,
  };
  const scheduled = new Map<string, ExtendedRow[]>(),
    planned = new Set<string>(),
    criterionIdentities = new Set<string>(),
    customNames = new Set<string>(),
    modes = new Map<string, string>();
  const inverse: ExtendedRow[] = [];
  let completelyReversible = true;
  for (const [index, x] of intent.items.entries()) {
    const action = String(x.operation),
      item = extItem(
        index,
        action,
        String(x.campaign_id ?? ""),
        String(x.ad_group_id ?? ""),
      );
    plan.items.push(item);
    const add = (
      kind: ExtendedKind,
      method: "create" | "update" | "remove",
      resource: string | null,
      fields: ExtendedRow,
      expected: ExtendedRow,
      before: ExtendedRow | null,
      query: string,
      responseKey: string,
      mask: string | null = null,
    ) => {
      if (plan.operations.length >= 500)
        extFail(
          "google_operation_limit",
          "Stage 3 требует более 500 Google mutations; данные не обрезаны.",
        );
      const signature =
        method === "create"
          ? `${kind}:${canonical(fields)}`
          : `${kind}:${resource}`;
      if (planned.has(signature))
        extFail(
          "google_stage3_duplicate",
          "Повторная/противоречивая операция для одного resource; вся пачка отклонена.",
        );
      planned.add(signature);
      item.provider_operations.push(plan.operations.length);
      plan.operations.push({
        kind,
        method,
        resource_name: resource,
        fields,
        expected,
        before,
        update_mask: mask,
        row: index,
        read_query: query,
        response_key: responseKey,
      });
      const summary = {
        operation: method,
        resource_name: resource,
        ...expected,
      };
      item.before = (before ?? null) as typeof item.before;
      item.after = summary as typeof item.after;
      if (method === "remove") {
        plan.irreversible = true;
        item.warnings.push(
          "Удаление criterion необратимо: восстановление создаст новый resource ID. Требуется отдельный human approval.",
        );
      }
    };
    if (action.startsWith("custom_audience_")) {
      const isCreate = action.endsWith("create"),
        spec = audienceQuery(
          "CUSTOM",
          isCreate ? { name: x.name } : { id: x.custom_audience_id },
        );
      const rows = (await ctx.query(spec.query)).map((r) =>
        extRow(r.customAudience),
      );
      for (const r of rows)
        extOwner(r.resourceName, ctx.account_id, "customAudiences");
      if (isCreate && rows.length)
        extFail(
          "google_stage3_custom_name_used",
          "Custom audience name уже используется; новая definition не создана.",
        );
      if (!isCreate && rows.length !== 1)
        extFail(
          "google_stage3_custom_unavailable",
          "Custom audience не существует/недоступна выбранному account.",
        );
      const before = rows[0] ?? null,
        fields: ExtendedRow = {};
      if (x.name !== undefined) {
        const nameKey = String(x.name).trim().toLocaleLowerCase("en");
        if (customNames.has(nameKey))
          extFail(
            "google_stage3_duplicate",
            "Одинаковые custom audience names в одной пачке запрещены, независимо от definitions.",
          );
        customNames.add(nameKey);
      }
      if (x.name !== undefined) fields.name = x.name;
      if (x.description !== undefined) fields.description = x.description;
      if (x.members !== undefined) fields.members = members(x.members);
      item.warnings.push(
        "Custom audience содержит только контекстные keyword/URL/app definitions, не персональные данные. Privacy/policy eligibility окончательно проверяется Google validate_only.",
      );
      if (isCreate) {
        fields.type = "AUTO";
        add(
          "customAudiences",
          "create",
          null,
          fields,
          fields,
          null,
          spec.query,
          "customAudience",
        );
        completelyReversible = false;
      } else {
        const resource = String(before!.resourceName);
        if (x.name !== undefined && x.name !== before!.name) {
          const named = audienceQuery("CUSTOM", { name: x.name });
          const collisions = (await ctx.query(named.query)).map((r) =>
            extRow(r.customAudience),
          );
          collisions.forEach((r) =>
            extOwner(r.resourceName, ctx.account_id, "customAudiences"),
          );
          if (collisions.some((r) => r.resourceName !== resource))
            extFail(
              "google_stage3_custom_name_used",
              "Новое custom audience name уже принадлежит другой definition.",
            );
        }
        if (x.members !== undefined)
          item.warnings.push(
            "Полный members array будет заменён по явному acknowledge_replace_members. Остальные поля сохраняются.",
          );
        add(
          "customAudiences",
          "update",
          resource,
          { resourceName: resource, ...fields },
          { ...before, ...fields },
          before,
          spec.query,
          "customAudience",
          Object.keys(fields).join(","),
        );
        if (
          Object.keys(fields).some((k) =>
            k === "members"
              ? !Array.isArray(before![k]) || !(before![k] as unknown[]).length
              : typeof before![k] !== "string" ||
                !(before![k] as string).trim(),
          )
        )
          completelyReversible = false;
        else
          inverse.push({
            operation: "custom_audience_update",
            custom_audience_id: x.custom_audience_id,
            privacy_ack: true,
            ...Object.fromEntries(
              Object.keys(fields).map((k) => [
                k,
                k === "members"
                  ? (before!.members as unknown[]).map((m) => {
                      const member = extRow(m);
                      return {
                        type: member.memberType,
                        value: member[String(member.memberType).toLowerCase()],
                      };
                    })
                  : before![k],
              ]),
            ),
            ...(x.members !== undefined
              ? { acknowledge_replace_members: true }
              : {}),
          });
      }
      continue;
    }
    const campaignResource = `${prefix}/campaigns/${x.campaign_id}`,
      campaignQuery = `SELECT ${parentFields} FROM campaign WHERE campaign.id = ${x.campaign_id} AND campaign.status != 'REMOVED'`;
    const campaigns = await ctx.query(campaignQuery),
      campaign = extRow(campaigns[0]?.campaign);
    if (campaigns.length !== 1)
      extFail(
        "google_stage3_campaign_unavailable",
        "Campaign отсутствует/недоступна.",
      );
    if (
      extOwner(campaign.resourceName, ctx.account_id, "campaigns") !==
      campaignResource
    )
      extFail(
        "google_extended_ownership_invalid",
        "Campaign proof не совпадает с requested ID.",
      );
    const channel = String(campaign.advertisingChannelType);
    if (!["SEARCH", "DISPLAY", "VIDEO"].includes(channel))
      extFail(
        "google_stage3_channel_unsupported",
        "Этот targeting profile поддерживает SEARCH/DISPLAY/VIDEO; PMax использует отдельные signals, не campaign/ad group audiences.",
      );
    let parent = campaign,
      parentResource = campaignResource,
      parentQuery = campaignQuery,
      parentKind: ExtendedKind = "campaigns",
      parentResponse = "campaign";
    if (x.level === "AD_GROUP") {
      parentResource = `${prefix}/adGroups/${x.ad_group_id}`;
      parentQuery = `SELECT ${groupFields} FROM ad_group WHERE ad_group.id = ${x.ad_group_id} AND ad_group.status != 'REMOVED'`;
      const groups = await ctx.query(parentQuery);
      parent = extRow(groups[0]?.adGroup);
      if (groups.length !== 1)
        extFail(
          "google_stage3_group_unavailable",
          "Ad group отсутствует/недоступна.",
        );
      if (
        extOwner(parent.resourceName, ctx.account_id, "adGroups") !==
          parentResource ||
        parent.campaign !== campaignResource
      )
        extFail(
          "google_extended_ownership_invalid",
          "Ad group не принадлежит requested campaign/account.",
        );
      parentKind = "adGroups";
      parentResponse = "adGroup";
    }
    const kind: ExtendedKind =
        x.level === "CAMPAIGN" ? "campaignCriteria" : "adGroupCriteria",
      responseKey =
        x.level === "CAMPAIGN" ? "campaignCriterion" : "adGroupCriterion",
      parentField = x.level === "CAMPAIGN" ? "campaign" : "adGroup";
    const inventory = async (types: string[]) => {
      const query = criterionQuery(String(x.level), parentResource, types),
        rows = (await ctx.query(query)).map((r) => extRow(r[responseKey]));
      for (const r of rows) {
        extOwner(r.resourceName, ctx.account_id, kind);
        if (r[parentField] !== parentResource)
          extFail(
            "google_extended_ownership_invalid",
            "Criterion parent не совпадает с selected parent.",
          );
      }
      return {
        query,
        rows: rows.filter((r) => matchesCriterionSelector(r, types)),
      };
    };
    const create = async (
      type: string,
      specific: ExtendedRow,
      negative = false,
      extra: ExtendedRow = {},
    ) => {
      const identity = `${kind}:${parentResource}:${type}:${canonical(specific)}`;
      if (criterionIdentities.has(identity))
        extFail(
          "google_stage3_duplicate",
          "Один targeting reference нельзя добавлять/исключать несколько раз в одной пачке, даже через разные name/ID aliases.",
        );
      criterionIdentities.add(identity);
      const inv = await inventory([type]),
        fields = {
          [parentField]: parentResource,
          status: "ENABLED",
          negative,
          ...specific,
          ...extra,
        };
      if (
        inv.rows.some((r) =>
          Object.entries(specific).every(
            ([k, v]) => canonical(r[k]) === canonical(v),
          ),
        )
      )
        extFail(
          "google_stage3_duplicate",
          "Targeting criterion уже существует (include/exclude не меняется молча). Используйте отдельный remove/add flow.",
        );
      add(kind, "create", null, fields, fields, null, inv.query, responseKey);
      completelyReversible = false;
    };
    const observationRequired = () => {
      const plannedMode = modes.get(parentResource);
      const own = extRow(parent.targetingSetting).targetRestrictions;
      const inherited =
        x.level === "AD_GROUP" && (!Array.isArray(own) || !own.length)
          ? extRow(campaign.targetingSetting).targetRestrictions
          : own;
      const restriction = Array.isArray(inherited)
        ? inherited.map(extRow).find((r) => r.targetingDimension === "AUDIENCE")
        : undefined;
      if (
        plannedMode
          ? plannedMode !== "OBSERVATION"
          : restriction?.bidOnly !== true
      )
        extFail(
          "google_stage3_observation_required",
          "PPC P203: фактический audience mode должен быть OBSERVATION. TARGETING/default не меняется скрыто ради modifier.",
        );
      item.warnings.push(
        "Audience bid modifier: provider-derived OBSERVATION; охват не сужается. PPC P203.",
      );
    };
    const audienceMode = async (mode: string) => {
      if (action === "audience_mode") await inventory(audienceCriterionTypes);
      const restrictions = extRow(parent.targetingSetting).targetRestrictions;
      const current = Array.isArray(restrictions)
        ? restrictions.map(extRow)
        : [];
      if (
        current.some(
          (r) =>
            typeof r.targetingDimension !== "string" ||
            (r.bidOnly !== undefined && typeof r.bidOnly !== "boolean"),
        ) ||
        new Set(current.map((r) => r.targetingDimension)).size !==
          current.length
      )
        extFail(
          "google_stage3_mode_invalid",
          "Provider targeting restrictions не имеют однозначной typed формы.",
        );
      if (
        x.level === "AD_GROUP" &&
        Array.isArray(extRow(campaign.targetingSetting).targetRestrictions) &&
        (extRow(campaign.targetingSetting).targetRestrictions as unknown[])
          .length
      ) {
        const restrictions = extRow(campaign.targetingSetting)
          .targetRestrictions as unknown[];
        const parentAudience = restrictions
          .map(extRow)
          .find((r) => r.targetingDimension === "AUDIENCE");
        const inheritedMode =
          parentAudience?.bidOnly === true ? "OBSERVATION" : "TARGETING";
        if (!current.length && inheritedMode === mode) {
          const planned = modes.get(parentResource);
          if (planned && planned !== mode)
            extFail(
              "google_stage3_mode_conflict",
              "Inherited и planned audience modes противоречат друг другу.",
            );
          modes.set(parentResource, mode);
          item.warnings.push(
            `Audience mode ${mode} унаследован от ${campaignResource}; campaign setting не изменяется.`,
          );
          return;
        }
        extFail(
          "google_stage3_mode_parent_conflict",
          "Campaign уже владеет targeting_setting; нельзя менять ad group режим. Коллекции не очищаются автоматически.",
        );
      }
      if (x.level === "CAMPAIGN") {
        const childQuery = `SELECT ${groupFields} FROM ad_group WHERE ad_group.campaign = ${extQuote(campaignResource)} AND ad_group.status != 'REMOVED'`;
        const children = (await ctx.query(childQuery)).map((r) =>
          extRow(r.adGroup),
        );
        children.forEach((g) => {
          extOwner(g.resourceName, ctx.account_id, "adGroups");
          if (g.campaign !== campaignResource)
            extFail(
              "google_extended_ownership_invalid",
              "Audience child impact owner не совпадает.",
            );
        });
        if (
          children.some(
            (g) =>
              Array.isArray(extRow(g.targetingSetting).targetRestrictions) &&
              (extRow(g.targetingSetting).targetRestrictions as unknown[])
                .length,
          )
        )
          extFail(
            "google_stage3_mode_child_conflict",
            "Ad groups уже владеют targeting_setting; campaign режим не переопределяется молча.",
          );
        if (action === "audience_mode") {
          for (const child of children) {
            const childQuery = criterionQuery(
              "AD_GROUP",
              String(child.resourceName),
              audienceCriterionTypes,
            );
            const criteria = (await ctx.query(childQuery)).map((r) =>
              extRow(r.adGroupCriterion),
            );
            criteria.forEach((r) => {
              extOwner(r.resourceName, ctx.account_id, "adGroupCriteria");
              if (r.adGroup !== child.resourceName)
                extFail(
                  "google_extended_ownership_invalid",
                  "Audience mode impact criterion имеет постороннего parent.",
                );
            });
          }
        }
        item.warnings.push(
          `Campaign audience mode затрагивает ${children.length} ad groups; режим ${mode} явно показан в preview.`,
        );
      }
      const previous = current.find((r) => r.targetingDimension === "AUDIENCE"),
        bidOnly = mode === "OBSERVATION";
      item.warnings.push(
        `Audience mode: ${mode}; ${bidOnly ? "не ограничивает охват" : "ограничивает охват заданными аудиториями"}. Режим применяется ко ВСЕМ audience criteria выбранного parent.`,
      );
      item.after = { mode, bid_only: bidOnly } as typeof item.after;
      const already = modes.get(parentResource);
      if (already && already !== mode)
        extFail(
          "google_stage3_mode_conflict",
          "Нельзя задать разные audience modes одному parent в одном batch.",
        );
      modes.set(parentResource, mode);
      if (already || (previous && (previous.bidOnly ?? false) === bidOnly))
        return;
      const targetingSetting = {
        ...extRow(parent.targetingSetting),
        targetRestrictions: [
          ...current.filter((r) => r.targetingDimension !== "AUDIENCE"),
          { targetingDimension: "AUDIENCE", bidOnly },
        ],
      };
      add(
        parentKind,
        "update",
        parentResource,
        {
          resourceName: parentResource,
          targetingSetting: {
            targetRestrictionOperations: [
              {
                operator: "ADD",
                value: { targetingDimension: "AUDIENCE", bidOnly },
              },
            ],
          },
        },
        { ...parent, targetingSetting },
        parent,
        parentQuery,
        parentResponse,
        "targeting_setting.target_restriction_operations",
      );
      if (previous && typeof previous.bidOnly === "boolean")
        inverse.push({
          operation: "audience_mode",
          level: x.level,
          campaign_id: x.campaign_id,
          ...(x.ad_group_id ? { ad_group_id: x.ad_group_id } : {}),
          mode: previous.bidOnly ? "OBSERVATION" : "TARGETING",
        });
      else {
        completelyReversible = false;
        item.warnings.push(
          "Исходный AUDIENCE restriction либо explicit bid_only отсутствовал: автоматический inverse не обещает точное восстановление отсутствующего provider field.",
        );
      }
    };
    if (action === "audience_mode") {
      await audienceMode(String(x.mode));
      continue;
    }
    if (["audience_add", "audience_exclude"].includes(action)) {
      await audienceMode(String(x.mode));
      const a = extRow(x.audience),
        audienceKind = String(a.kind),
        spec = audienceQuery(audienceKind, a),
        matches = (await ctx.query(spec.query)).map((r) => extRow(r[spec.key]));
      matches.forEach((r) =>
        extOwner(r.resourceName, ctx.account_id, spec.resourceKind),
      );
      if (matches.length !== 1)
        extFail(
          "google_stage3_audience_ambiguous",
          `Audience не определена однозначно (${matches.length} matches); укажите exact ID.`,
        );
      const audience = matches[0]!;
      if (
        (a.id !== undefined &&
          !String(audience.resourceName).endsWith(`/${a.id}`)) ||
        (a.name !== undefined && audience.name !== a.name)
      )
        extFail(
          "google_stage3_audience_invalid",
          "Audience reference не совпадает с requested name/ID.",
        );
      if (
        audienceKind === "USER_LIST" &&
        (audience.membershipStatus !== "OPEN" ||
          audience.accountUserListStatus !== "ENABLED" ||
          (channel === "SEARCH" && audience.eligibleForSearch !== true) ||
          (channel !== "SEARCH" && audience.eligibleForDisplay !== true))
      )
        extFail(
          "google_stage3_audience_ineligible",
          "User list закрыт/недоступен либо не eligible для выбранного канала.",
        );
      if (
        ["IN_MARKET", "AFFINITY"].includes(audienceKind) &&
        (audience.taxonomyType !== audienceKind ||
          !availabilityProven(audience, campaign))
      )
        extFail(
          "google_stage3_audience_ineligible",
          "Taxonomy/availability audience не подтверждены; не угадываем capability.",
        );
      if (
        audienceKind === "DETAILED_DEMOGRAPHIC" &&
        (!/^[0-9]{1,20}$/u.test(String(audience.id)) ||
          !availabilityProven(audience, campaign))
      )
        extFail(
          "google_stage3_audience_ineligible",
          "Detailed demographic taxonomy ID/availability не подтверждены выбранным provider customer.",
        );
      if (
        audienceKind === "DETAILED_DEMOGRAPHIC" &&
        audience.resourceName !==
          `${prefix}/detailedDemographics/${audience.id}`
      )
        extFail(
          "google_stage3_audience_invalid",
          "Detailed demographic catalog numeric ID не совпадает с proof resource name; taxonomy ID не угадывается.",
        );
      if (
        audienceKind === "CUSTOM" &&
        (channel === "SEARCH" || audience.status !== "ENABLED")
      )
        extFail(
          "google_stage3_audience_ineligible",
          "Custom audiences поддерживаются здесь только для DISPLAY/VIDEO и ENABLED definitions, не Search.",
        );
      if (x.bid_modifier !== undefined) {
        observationRequired();
        requireManualModifier(campaign, Number(x.bid_modifier));
      }
      item.keyword = String(audience.name);
      item.warnings.push(
        `Resolved audience ${audience.resourceName}; requested mode ${x.mode}.`,
      );
      await create(
        audienceKind === "USER_LIST"
          ? "USER_LIST"
          : audienceKind === "CUSTOM"
            ? "CUSTOM_AUDIENCE"
            : audienceKind === "DETAILED_DEMOGRAPHIC"
              ? "EXTENDED_DEMOGRAPHIC"
              : "USER_INTEREST",
        {
          [spec.field]: {
            [spec.reference]:
              audienceKind === "DETAILED_DEMOGRAPHIC"
                ? String(audience.id)
                : audience.resourceName,
          },
        },
        action === "audience_exclude",
        x.bid_modifier !== undefined ? { bidModifier: x.bid_modifier } : {},
      );
      item.after = {
        ...extRow(item.after),
        audience_mode: x.mode,
      } as typeof item.after;
      continue;
    }
    if (
      action === "audience_bid_modifier" ||
      action === "audience_remove" ||
      action === "criterion_remove"
    ) {
      const types =
          action === "criterion_remove"
            ? [String(x.criterion_type)]
            : audienceCriterionTypes,
        inv = await inventory(types),
        resource = `${prefix}/${kind}/${x.level === "CAMPAIGN" ? x.campaign_id : x.ad_group_id}~${x.criterion_id}`;
      const found = inv.rows.filter((r) => r.resourceName === resource);
      if (found.length !== 1)
        extFail(
          "google_stage3_criterion_unavailable",
          "Requested typed criterion не существует/не принадлежит selected parent; keyword IDs не принимаются вместо audience/targeting criteria.",
        );
      const before = found[0]!;
      if (action === "audience_bid_modifier") {
        if (before.negative === true)
          extFail(
            "google_stage3_modifier_invalid",
            "Negative audience не имеет bid modifier.",
          );
        observationRequired();
        requireManualModifier(campaign, Number(x.bid_modifier));
        if (Number(before.bidModifier ?? 1) === Number(x.bid_modifier))
          extFail(
            "google_stage3_no_changes",
            "Audience bid modifier уже имеет requested value; mutation не требуется.",
          );
        add(
          kind,
          "update",
          resource,
          { resourceName: resource, bidModifier: x.bid_modifier },
          { ...before, bidModifier: x.bid_modifier },
          before,
          inv.query,
          responseKey,
          "bid_modifier",
        );
        if (typeof before.bidModifier === "number")
          inverse.push({ ...x, bid_modifier: before.bidModifier });
        else completelyReversible = false;
        item.before = {
          ...before,
          audience_mode: "OBSERVATION",
        } as typeof item.before;
        item.after = {
          ...extRow(item.after),
          audience_mode: "OBSERVATION",
        } as typeof item.after;
      } else {
        add(kind, "remove", resource, {}, {}, before, inv.query, responseKey);
        if (action === "audience_remove") {
          const ownRestrictions = extRow(
            parent.targetingSetting,
          ).targetRestrictions;
          const restrictions =
            Array.isArray(ownRestrictions) && ownRestrictions.length
              ? ownRestrictions
              : extRow(campaign.targetingSetting).targetRestrictions;
          const restriction = Array.isArray(restrictions)
            ? restrictions
                .map(extRow)
                .find((r) => r.targetingDimension === "AUDIENCE")
            : undefined;
          item.warnings.push(
            `Audience mode остаётся ${restriction?.bidOnly ? "OBSERVATION" : "TARGETING"}; parent targeting_setting не изменяется.`,
          );
        }
        completelyReversible = false;
      }
      continue;
    }
    if (
      action === "demographic_bid_modifier" ||
      action === "schedule_bid_modifier"
    ) {
      requireManualModifier(campaign, Number(x.bid_modifier));
      const type =
          action === "schedule_bid_modifier"
            ? "AD_SCHEDULE"
            : String(x.dimension),
        inv = await inventory([type]);
      const resource = `${prefix}/${kind}/${x.level === "CAMPAIGN" ? x.campaign_id : x.ad_group_id}~${x.criterion_id}`,
        found = inv.rows.filter((r) => r.resourceName === resource);
      if (found.length !== 1)
        extFail(
          "google_stage3_criterion_unavailable",
          "Bid modifier требует existing positive criterion точного dimension/parent, не создание нового targeting.",
        );
      const before = found[0]!;
      if (before.negative === true)
        extFail(
          "google_stage3_modifier_invalid",
          "Negative demographic/schedule criterion не допускает bid_modifier.",
        );
      if (Number(before.bidModifier ?? 1) === Number(x.bid_modifier))
        extFail(
          "google_stage3_no_changes",
          "Bid modifier уже имеет requested value; provider mutation не требуется.",
        );
      if (action === "schedule_bid_modifier") {
        if (!ctx.timezone || ctx.timezone === "undefined")
          extFail(
            "google_stage3_timezone_unavailable",
            "Timezone аккаунта отсутствует; schedule modifier не проверен.",
          );
        item.warnings.push(
          `Schedule bid modifier timezone: ${ctx.timezone}; интервалы/соседние criteria не меняются. PPC P219–221.`,
        );
      } else
        item.warnings.push(
          `Demographic ${type} bid modifier; dimension/negative/status не меняются. PPC P210–212.`,
        );
      add(
        kind,
        "update",
        resource,
        { resourceName: resource, bidModifier: x.bid_modifier },
        { ...before, bidModifier: x.bid_modifier },
        before,
        inv.query,
        responseKey,
        "bid_modifier",
      );
      if (
        typeof before.bidModifier === "number" &&
        Number.isFinite(before.bidModifier) &&
        before.bidModifier >= 0.1 &&
        before.bidModifier <= 10
      )
        inverse.push({ ...x, bid_modifier: before.bidModifier });
      else completelyReversible = false;
      continue;
    }
    if (action.startsWith("demographic_")) {
      const field = (
        {
          AGE_RANGE: "ageRange",
          GENDER: "gender",
          PARENTAL_STATUS: "parentalStatus",
          INCOME_RANGE: "incomeRange",
        } as Record<string, string>
      )[String(x.dimension)]!;
      item.warnings.push(
        "Demographic availability зависит от страны и рекламной policy; Google validate_only обязателен. Коллекция demographics не заменяется.",
      );
      if (x.bid_modifier !== undefined)
        requireManualModifier(campaign, Number(x.bid_modifier));
      await create(
        String(x.dimension),
        { [field]: { type: x.value } },
        action === "demographic_exclude",
        x.bid_modifier !== undefined ? { bidModifier: x.bid_modifier } : {},
      );
      continue;
    }
    if (action === "geo_add" || action === "geo_exclude") {
      const aliases: Record<string, string> = {
          Алматы: "Almaty",
          Астана: "Astana",
          Казахстан: "Kazakhstan",
        },
        name = aliases[String(x.name)] ?? String(x.name);
      const fields =
        "geo_target_constant.resource_name, geo_target_constant.id, geo_target_constant.name, geo_target_constant.canonical_name, geo_target_constant.country_code, geo_target_constant.target_type, geo_target_constant.status";
      let matches: ExtendedRow[];
      if (suggestGeo) {
        const suggestions = await suggestGeo(
          String(x.name),
          x.country_code as string | undefined,
        );
        if (!Array.isArray(suggestions) || suggestions.length > 100)
          extFail(
            "google_stage3_geo_limit",
            "GeoTargetConstantService response invalid/более 100 suggestions; данные не обрезаны.",
          );
        matches = suggestions
          .map((s) => extRow(s.geoTargetConstant ?? s))
          .filter(
            (g) =>
              g.status === "ENABLED" &&
              (!x.country_code || g.countryCode === x.country_code) &&
              (!x.geo_target_id || String(g.id) === x.geo_target_id),
          );
      } else {
        const query = `SELECT ${fields} FROM geo_target_constant WHERE ${x.geo_target_id ? `geo_target_constant.id = ${x.geo_target_id}` : `geo_target_constant.name = ${extQuote(name)}`} AND geo_target_constant.status = 'ENABLED'${x.country_code ? ` AND geo_target_constant.country_code = ${extQuote(String(x.country_code))}` : ""}`;
        matches = (await ctx.query(query)).map((r) =>
          extRow(r.geoTargetConstant),
        );
      }
      if (matches.length !== 1)
        extFail(
          "google_stage3_geo_ambiguous",
          `Локация «${x.name}» неоднозначна/не найдена; country_code/geo_target_id обязательны для уточнения. Кандидаты: ${
            matches
              .slice(0, 10)
              .map((m) => `${m.id}: ${m.canonicalName}`)
              .join("; ") || "нет"
          }.`,
        );
      let geo = matches[0]!;
      extId(String(geo.id), "resolved Google geo ID");
      if (
        !/^geoTargetConstants\/[0-9]+$/u.test(String(geo.resourceName)) ||
        geo.status !== "ENABLED" ||
        (x.geo_target_id && String(geo.id) !== x.geo_target_id) ||
        (x.country_code && geo.countryCode !== x.country_code)
      )
        extFail(
          "google_stage3_geo_invalid",
          "Неверный Google geo target reference.",
        );
      if (String(geo.resourceName) !== `geoTargetConstants/${geo.id}`)
        extFail(
          "google_stage3_geo_invalid",
          "Geo candidate resource ID не совпадает с reference.",
        );
      if (suggestGeo) {
        const verified = await ctx.query(
            `SELECT ${fields} FROM geo_target_constant WHERE geo_target_constant.id = ${geo.id}`,
          ),
          actual = extRow(verified[0]?.geoTargetConstant);
        if (
          verified.length !== 1 ||
          actual.resourceName !== geo.resourceName ||
          String(actual.id) !== String(geo.id) ||
          actual.status !== "ENABLED" ||
          (x.country_code && actual.countryCode !== x.country_code)
        )
          extFail(
            "google_stage3_geo_invalid",
            "Geo service candidate не подтверждён fresh GAQL constant; targeting preview отклонён.",
          );
        geo = actual;
        item.warnings.push(
          "Name resolution: GeoTargetConstantService.suggest → exact frozen GAQL reference proof. PPC P215.",
        );
      }
      item.warnings.push(
        `Гео ${x.name} → ${geo.resourceName}, ${geo.canonicalName}, type ${geo.targetType}; mode ${extRow(campaign.geoTargetTypeSetting).positiveGeoTargetType ?? "PROVIDER_DEFAULT"}.`,
      );
      await create(
        "LOCATION",
        { location: { geoTargetConstant: geo.resourceName } },
        action === "geo_exclude",
      );
      continue;
    }
    if (action === "radius_add") {
      const proximity = {
        geoPoint: {
          latitudeInMicroDegrees: Math.round(Number(x.latitude) * 1_000_000),
          longitudeInMicroDegrees: Math.round(Number(x.longitude) * 1_000_000),
        },
        radius: x.radius,
        radiusUnits: x.unit,
      };
      item.warnings.push(
        `Radius ${x.radius} ${x.unit}; coordinates ${x.latitude}, ${x.longitude}. Provider privacy/minimum-radius policy проверяет validate_only.`,
      );
      await create("PROXIMITY", { proximity });
      continue;
    }
    if (action === "presence") {
      const beforeSetting = extRow(campaign.geoTargetTypeSetting),
        fields = {
          positiveGeoTargetType: x.positive,
          ...(x.negative !== undefined
            ? { negativeGeoTargetType: x.negative }
            : {}),
        },
        setting = { ...beforeSetting, ...fields };
      if (x.positive === "PRESENCE_OR_INTEREST")
        item.warnings.push(
          "PRESENCE_OR_INTEREST расширяет охват за пределы физического присутствия; изменение явно включено в approval.",
        );
      const mask = [
        "geo_target_type_setting.positive_geo_target_type",
        ...(x.negative !== undefined
          ? ["geo_target_type_setting.negative_geo_target_type"]
          : []),
      ].join(",");
      add(
        "campaigns",
        "update",
        campaignResource,
        { resourceName: campaignResource, geoTargetTypeSetting: fields },
        { ...campaign, geoTargetTypeSetting: setting },
        campaign,
        campaignQuery,
        "campaign",
        mask,
      );
      if (
        beforeSetting.positiveGeoTargetType &&
        (x.negative === undefined || beforeSetting.negativeGeoTargetType)
      )
        inverse.push({
          ...x,
          positive: beforeSetting.positiveGeoTargetType,
          ...(x.negative !== undefined
            ? { negative: beforeSetting.negativeGeoTargetType }
            : {}),
        });
      else completelyReversible = false;
      continue;
    }
    if (action === "language_add") {
      const aliases: Record<string, string> = {
          russian: "ru",
          русский: "ru",
          kazakh: "kk",
          казахский: "kk",
          english: "en",
          английский: "en",
        },
        input = String(x.name).toLowerCase(),
        code = aliases[input] ?? input;
      if (!/^[a-z]{2,3}(?:-[a-z]{2})?$/u.test(code))
        extFail(
          "google_stage3_language_invalid",
          "Язык должен быть поддерживаемым названием/кодом ISO.",
        );
      const query = `SELECT language_constant.resource_name, language_constant.id, language_constant.name, language_constant.code, language_constant.targetable FROM language_constant WHERE language_constant.code = ${extQuote(code)}`;
      const found = await ctx.query(query),
        language = extRow(found[0]?.languageConstant);
      if (
        found.length !== 1 ||
        language.targetable !== true ||
        !/^languageConstants\/[0-9]+$/u.test(String(language.resourceName))
      )
        extFail(
          "google_stage3_language_invalid",
          "Язык не найден или не targetable.",
        );
      item.warnings.push(
        `Язык ${x.name} → ${language.name}, ${language.resourceName}.`,
      );
      await create("LANGUAGE", {
        language: { languageConstant: language.resourceName },
      });
      continue;
    }
    if (action === "schedule_add") {
      if (!ctx.timezone || ctx.timezone === "undefined")
        extFail(
          "google_stage3_timezone_unavailable",
          "Timezone аккаунта отсутствует; нельзя проверить расписание.",
        );
      if (x.bid_modifier !== undefined)
        requireManualModifier(campaign, Number(x.bid_modifier));
      const inv = await inventory(["AD_SCHEDULE"]),
        stored =
          scheduled.get(parentResource) ??
          inv.rows.map((r) => extRow(r.adSchedule));
      scheduled.set(parentResource, stored);
      item.warnings.push(
        `Расписание в timezone аккаунта ${ctx.timezone}; интервалы [start,end), без bid modifiers.`,
      );
      for (const day of x.days as string[]) {
        const from = time(x.start),
          to = time(x.end, true),
          existing = stored.filter((s) => s.dayOfWeek === day);
        if (
          existing.length >= 6 ||
          existing.some(
            (s) =>
              from < scheduleMinutes(s, "end") &&
              to > scheduleMinutes(s, "start"),
          )
        )
          extFail(
            "google_stage3_schedule_overlap",
            "Пересечение расписания либо более 6 интервалов в день; existing/planned интервалы не заменяются.",
          );
        const adSchedule = {
          dayOfWeek: day,
          startHour: Math.floor(from / 60),
          startMinute: minuteEnum(from),
          endHour: Math.floor(to / 60),
          endMinute: minuteEnum(to),
        };
        stored.push(adSchedule);
        const fields = {
          campaign: parentResource,
          status: "ENABLED",
          negative: false,
          adSchedule,
          ...(x.bid_modifier !== undefined
            ? { bidModifier: x.bid_modifier }
            : {}),
        };
        add(kind, "create", null, fields, fields, null, inv.query, responseKey);
        completelyReversible = false;
      }
      continue;
    }
    if (action === "device_modifier") {
      requireManualModifier(campaign, Number(x.bid_modifier), true);
      const inv = await inventory(["DEVICE"]),
        found = inv.rows.filter((r) => extRow(r.device).type === x.device);
      if (found.length !== 1 || found[0]!.negative === true)
        extFail(
          "google_stage3_device_unavailable",
          "Device должен существовать как provider campaign criterion; implicit device не создаётся вручную.",
        );
      const before = found[0]!,
        resource = String(before.resourceName);
      add(
        kind,
        "update",
        resource,
        { resourceName: resource, bidModifier: x.bid_modifier },
        { ...before, bidModifier: x.bid_modifier },
        before,
        inv.query,
        responseKey,
        "bid_modifier",
      );
      item.warnings.push(
        `Device ${x.device}: ${x.bid_modifier === 0 ? "исключён (-100%)" : `bid multiplier ${x.bid_modifier}`}; остальной targeting сохраняется.`,
      );
      if (typeof before.bidModifier === "number")
        inverse.push({ ...x, bid_modifier: before.bidModifier });
      else completelyReversible = false;
      continue;
    }
    extFail(
      "google_stage3_unsupported",
      "Операция не имеет подтверждённого provider contract.",
    );
  }
  if (!plan.operations.length)
    extFail(
      "google_stage3_no_changes",
      "Preview не содержит изменений; provider validate/mutation не вызывается.",
    );
  if (completelyReversible && inverse.length)
    plan.inverse_intent = { action: "targeting", items: inverse.reverse() };
  // Mode changes and dependent audience criteria must succeed together. Independent
  // criteria retain the shared per-operation partial-failure contract.
  plan.atomic = plan.operations.some(
    (operation) =>
      operation.update_mask
        ?.split(",")
        .includes("targeting_setting.target_restriction_operations") ||
      operation.kind === "customAudiences",
  );
  assertExtendedPlan(plan, ctx.account_id);
  return plan;
}

export async function searchStage3Audiences(
  account: string,
  raw: unknown,
  read: Stage1Reader,
) {
  const input = extClosed(raw, ["name", "kind"], ["name", "kind"]),
    name = text(input.name, "audience search", 255),
    kind = choice(input.kind, audienceTypes, "kind"),
    ctx = await extContext(account, read);
  const spec = audienceQuery(kind, { name }),
    table =
      kind === "USER_LIST"
        ? "user_list"
        : kind === "CUSTOM"
          ? "custom_audience"
          : kind === "DETAILED_DEMOGRAPHIC"
            ? "detailed_demographic"
            : "user_interest";
  const query = spec.query.replace(
    `${table}.name = ${extQuote(name)}`,
    `${table}.name LIKE ${extQuote(`%${name.replace(/[%_]/g, "")}%`)}`,
  );
  const rows = (await ctx.query(query)).map((r) => extRow(r[spec.key]));
  rows.forEach((r) =>
    extOwner(r.resourceName, ctx.account_id, spec.resourceKind),
  );
  const matches = ["IN_MARKET", "AFFINITY"].includes(kind)
    ? rows.filter((r) => r.taxonomyType === kind)
    : rows;
  return {
    provider: "GOOGLE_ADS",
    account_id: ctx.account_id,
    kind,
    query: name,
    matches,
    truncated: false,
    warnings: [
      "Search results — reference inventory, не доказательство eligibility. Preview проверит eligibility и Google validate_only.",
    ],
  };
}

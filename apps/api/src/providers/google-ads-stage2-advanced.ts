import {
  canonical,
  currencyMicros,
  type Stage1Reader,
} from "./google-ads-stage1.js";
import { GoogleAdsWriteError } from "./google-ads-write.js";
import {
  buildStage2Plan,
  parseStage2Intent,
  stage2RollbackIntent,
  type Stage2Change,
  type Stage2Item,
} from "./google-ads-stage2.js";
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
  type ExtendedPlan,
  type ExtendedOperation,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";

export const STAGE2_STRATEGIES = [
  "MANUAL_CPC",
  "MAXIMIZE_CLICKS",
  "MAXIMIZE_CONVERSIONS",
  "TARGET_CPA",
  "TARGET_ROAS",
  "TARGET_IMPRESSION_SHARE",
] as const;
type StrategyName = (typeof STAGE2_STRATEGIES)[number];
type Strategy = ExtendedRow & { type: StrategyName };
export type Stage2AdvancedIntent = ExtendedRow & {
  action: "stage2_advanced" | "stage2_bulk" | "stage2_bulk_inverse";
};
const strategyFields: Record<StrategyName, string> = {
  MANUAL_CPC: "manualCpc",
  MAXIMIZE_CLICKS: "targetSpend",
  MAXIMIZE_CONVERSIONS: "maximizeConversions",
  TARGET_CPA: "targetCpa",
  TARGET_ROAS: "targetRoas",
  TARGET_IMPRESSION_SHARE: "targetImpressionShare",
};
const snake = (v: string) => v.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
const schemeSelect = [
  "manual_cpc.enhanced_cpc_enabled",
  "target_spend.cpc_bid_ceiling_micros",
  "maximize_conversions.target_cpa_micros",
  "target_cpa.target_cpa_micros",
  "target_roas.target_roas",
  "target_impression_share.location",
  "target_impression_share.location_fraction_micros",
  "target_impression_share.cpc_bid_ceiling_micros",
];
const campaignSelect =
  "SELECT campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.campaign_budget, campaign.bidding_strategy_type, campaign.bidding_strategy, " +
  schemeSelect.map((f) => "campaign." + f).join(", ") +
  " FROM campaign";
const portfolioSelect =
  "SELECT bidding_strategy.resource_name, bidding_strategy.id, bidding_strategy.name, bidding_strategy.status, bidding_strategy.type, bidding_strategy.effective_currency_code, bidding_strategy.aligned_campaign_budget_id, " +
  schemeSelect
    .filter((f) => !f.startsWith("manual_cpc."))
    .map((f) => "bidding_strategy." + f)
    .join(", ") +
  ", bidding_strategy.target_cpa.cpc_bid_floor_micros, bidding_strategy.target_cpa.cpc_bid_ceiling_micros, bidding_strategy.target_roas.cpc_bid_floor_micros, bidding_strategy.target_roas.cpc_bid_ceiling_micros, bidding_strategy.maximize_conversions.cpc_bid_floor_micros, bidding_strategy.maximize_conversions.cpc_bid_ceiling_micros FROM bidding_strategy";
const criterionSelect =
  "SELECT campaign.id, campaign_criterion.resource_name, campaign_criterion.criterion_id, campaign_criterion.campaign, campaign_criterion.type, campaign_criterion.status, campaign_criterion.negative, campaign_criterion.bid_modifier, campaign_criterion.device.type, campaign_criterion.location.geo_target_constant, campaign_criterion.ad_schedule.day_of_week, campaign_criterion.ad_schedule.start_hour, campaign_criterion.ad_schedule.start_minute, campaign_criterion.ad_schedule.end_hour, campaign_criterion.ad_schedule.end_minute FROM campaign_criterion";
const audienceSelect =
  "SELECT campaign.id, ad_group.id, ad_group_criterion.resource_name, ad_group_criterion.ad_group, ad_group_criterion.type, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.bid_modifier, ad_group_criterion.user_list.user_list, ad_group_criterion.user_interest.user_interest_category FROM ad_group_criterion";
const groupSelect =
  "SELECT campaign.id, ad_group.resource_name, ad_group.id, ad_group.name, ad_group.status, ad_group.targeting_setting.target_restrictions FROM ad_group";
const groupDeviceSelect =
  "SELECT campaign.id, ad_group.id, ad_group_bid_modifier.resource_name, ad_group_bid_modifier.criterion_id, ad_group_bid_modifier.ad_group, ad_group_bid_modifier.bid_modifier, ad_group_bid_modifier.bid_modifier_source, ad_group_bid_modifier.device.type FROM ad_group_bid_modifier";
const clearable: Record<StrategyName, string[]> = {
  MANUAL_CPC: [],
  MAXIMIZE_CLICKS: ["cpc_ceiling"],
  MAXIMIZE_CONVERSIONS: ["target_cpa", "cpc_floor", "cpc_ceiling"],
  TARGET_CPA: ["cpc_floor", "cpc_ceiling"],
  TARGET_ROAS: ["cpc_floor", "cpc_ceiling"],
  TARGET_IMPRESSION_SHARE: [],
};
const parameterFields: Record<string, string> = {
  target_cpa: "targetCpaMicros",
  cpc_floor: "cpcBidFloorMicros",
  cpc_ceiling: "cpcBidCeilingMicros",
};
const decimal = (
  v: unknown,
  min: number,
  max: number,
  label: string,
): number => {
  if (
    typeof v !== "string" ||
    !/^(?:0|[1-9][0-9]{0,9})(?:\.[0-9]{1,6})?$/.test(v) ||
    Number(v) < min ||
    Number(v) > max
  )
    extFail(
      "google_stage2_parameter_invalid",
      `${label}: требуется decimal string в диапазоне ${min}–${max}.`,
    );
  return Number(v);
};
const moneyInput = (v: unknown) => {
  const r = extClosed(v, ["amount", "currency"], ["amount", "currency"]);
  decimal(r.amount, 0.000001, 9999999999, "amount");
  if (typeof r.currency !== "string" || !/^[A-Z]{3}$/.test(r.currency))
    extFail("google_currency_mismatch", "currency должна быть ISO 4217.");
  return r;
};
function parseStrategy(raw: unknown): Strategy {
  const r = extRow(raw),
    type = r.type as StrategyName;
  if (!STAGE2_STRATEGIES.includes(type))
    extFail(
      "google_stage2_strategy_unsupported",
      "Неподдерживаемая bidding strategy; Enhanced CPC и arbitrary schemes запрещены.",
    );
  const options: Record<StrategyName, string[]> = {
    MANUAL_CPC: [],
    MAXIMIZE_CLICKS: ["cpc_ceiling"],
    MAXIMIZE_CONVERSIONS: ["target_cpa", "cpc_floor", "cpc_ceiling"],
    TARGET_CPA: ["target_cpa", "cpc_floor", "cpc_ceiling"],
    TARGET_ROAS: ["target_roas", "cpc_floor", "cpc_ceiling"],
    TARGET_IMPRESSION_SHARE: ["location", "share_percent", "cpc_ceiling"],
  };
  extClosed(
    raw,
    ["type", ...options[type], "clear_fields"],
    [
      "type",
      ...(type === "TARGET_CPA"
        ? ["target_cpa"]
        : type === "TARGET_ROAS"
          ? ["target_roas"]
          : type === "TARGET_IMPRESSION_SHARE"
            ? ["location", "share_percent", "cpc_ceiling"]
            : []),
    ],
  );
  for (const k of ["target_cpa", "cpc_floor", "cpc_ceiling"])
    if (r[k] !== undefined) moneyInput(r[k]);
  if (r.clear_fields !== undefined) {
    if (
      !Array.isArray(r.clear_fields) ||
      !r.clear_fields.length ||
      r.clear_fields.length > 3 ||
      new Set(r.clear_fields).size !== r.clear_fields.length ||
      r.clear_fields.some(
        (k) =>
          typeof k !== "string" ||
          !clearable[type].includes(k) ||
          r[k] !== undefined,
      )
    )
      extFail(
        "google_stage2_clear_invalid",
        "clear_fields: unique optional parameters этой стратегии; нельзя одновременно set и clear либо очистить обязательную цель.",
      );
  }
  if (r.target_roas !== undefined)
    decimal(r.target_roas, 0.01, 1000, "target_roas");
  if (r.share_percent !== undefined) {
    decimal(r.share_percent, 0.0001, 100, "share_percent");
    if (
      typeof r.share_percent !== "string" ||
      !/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,4})?$/.test(r.share_percent)
    )
      extFail(
        "google_stage2_parameter_invalid",
        "share_percent поддерживает максимум 4 знака после точки; micros не округляются молча.",
      );
  }
  if (
    r.location !== undefined &&
    !["ANYWHERE_ON_PAGE", "TOP_OF_PAGE", "ABSOLUTE_TOP_OF_PAGE"].includes(
      String(r.location),
    )
  )
    extFail(
      "google_stage2_parameter_invalid",
      "Неверная target impression share location.",
    );
  return r as Strategy;
}
function strategyPayload(
  strategy: Strategy,
  currency: string,
  portfolio: boolean,
) {
  const type = strategy.type,
    field = strategyFields[type],
    value: ExtendedRow = {};
  if (portfolio && type === "MANUAL_CPC")
    extFail(
      "google_stage2_portfolio_unsupported",
      "Google v24 portfolio oneof не поддерживает Manual CPC.",
    );
  if (
    !portfolio &&
    (strategy.cpc_floor !== undefined ||
      (strategy.cpc_ceiling !== undefined &&
        ["TARGET_CPA", "TARGET_ROAS", "MAXIMIZE_CONVERSIONS"].includes(type)))
  )
    extFail(
      "google_stage2_parameter_unsupported",
      "CPC floor/ceiling этой стратегии доступны только portfolio; параметры не отброшены.",
    );
  if (
    !portfolio &&
    (strategy.clear_fields as string[] | undefined)?.some(
      (k) =>
        k === "cpc_floor" ||
        (k === "cpc_ceiling" &&
          ["TARGET_CPA", "TARGET_ROAS", "MAXIMIZE_CONVERSIONS"].includes(type)),
    )
  )
    extFail(
      "google_stage2_parameter_unsupported",
      "Clearing CPC floor/ceiling этой стратегии доступен только portfolio; неподдерживаемые поля не отбрасываются.",
    );
  for (const [input, output] of [
    ["target_cpa", "targetCpaMicros"],
    ["cpc_floor", "cpcBidFloorMicros"],
    ["cpc_ceiling", "cpcBidCeilingMicros"],
  ])
    if (strategy[input!] !== undefined) {
      const m = moneyInput(strategy[input!]);
      value[output!] = currencyMicros(
        String(m.amount),
        String(m.currency),
        currency,
      );
    }
  for (const key of (strategy.clear_fields as string[]) ?? [])
    value[parameterFields[key]!] = "0";
  if (
    value.cpcBidFloorMicros &&
    value.cpcBidCeilingMicros &&
    BigInt(String(value.cpcBidCeilingMicros)) > 0n &&
    BigInt(String(value.cpcBidFloorMicros)) >
      BigInt(String(value.cpcBidCeilingMicros))
  )
    extFail("google_stage2_parameter_invalid", "CPC floor превышает ceiling.");
  if (type === "MANUAL_CPC") value.enhancedCpcEnabled = false;
  if (type === "TARGET_ROAS")
    value.targetRoas = decimal(strategy.target_roas, 0.01, 1000, "target_roas");
  if (type === "TARGET_IMPRESSION_SHARE") {
    value.location = strategy.location;
    const [whole, fraction = ""] = String(strategy.share_percent).split(".");
    value.locationFractionMicros = String(
      BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, "0")),
    );
  }
  return {
    field,
    value,
    providerType: type === "MAXIMIZE_CLICKS" ? "TARGET_SPEND" : type,
  };
}
function parseAdvancedRow(raw: unknown) {
  const r = extRow(raw),
    op = String(r.operation);
  const fields: Record<string, string[]> = {
    campaign_strategy: ["campaign_id", "strategy"],
    portfolio_create: ["name", "strategy"],
    portfolio_update: ["strategy_id", "strategy"],
    portfolio_attach: ["campaign_id", "strategy_id"],
    portfolio_detach: ["campaign_id", "strategy"],
    ad_group_device_modifier: [
      "campaign_id",
      "ad_group_id",
      "device",
      "multiplier",
    ],
    modifier: [
      "campaign_id",
      "criterion_id",
      "criterion_type",
      "multiplier",
      "ad_group_id",
    ],
  };
  const keys = fields[op];
  if (!keys)
    extFail(
      "google_stage2_operation_unsupported",
      "Неизвестная typed Stage 2 операция.",
    );
  extClosed(
    raw,
    ["operation", ...keys],
    [
      "operation",
      ...keys.filter((k) => (op === "modifier" ? k !== "ad_group_id" : true)),
    ],
  );
  for (const k of ["campaign_id", "strategy_id", "criterion_id", "ad_group_id"])
    if (r[k] !== undefined) extId(r[k], k);
  if (r.strategy !== undefined) parseStrategy(r.strategy);
  if (
    op === "portfolio_create" &&
    (typeof r.name !== "string" ||
      !r.name.trim() ||
      Buffer.byteLength(r.name.trim(), "utf8") > 255 ||
      r.name !== r.name.trim())
  )
    extFail(
      "google_stage2_name_invalid",
      "Имя portfolio: 1–255 UTF-8 bytes, без внешних пробелов.",
    );
  if (op === "modifier") {
    if (
      ![
        "DEVICE",
        "LOCATION",
        "AD_SCHEDULE",
        "USER_LIST",
        "USER_INTEREST",
      ].includes(String(r.criterion_type))
    )
      extFail(
        "google_stage2_modifier_unsupported",
        "Поддерживаются campaign DEVICE/LOCATION/AD_SCHEDULE и ad group USER_LIST/USER_INTEREST.",
      );
    decimal(
      r.multiplier,
      r.criterion_type === "DEVICE" ? 0 : 0.1,
      10,
      "multiplier",
    );
    if (
      r.criterion_type === "DEVICE" &&
      Number(r.multiplier) > 0 &&
      Number(r.multiplier) < 0.1
    )
      extFail(
        "google_stage2_parameter_invalid",
        "DEVICE: только 0 либо 0.1–10.",
      );
    if (
      ["USER_LIST", "USER_INTEREST"].includes(String(r.criterion_type)) !==
      Boolean(r.ad_group_id)
    )
      extFail(
        "google_stage2_modifier_unsupported",
        "Audience modifier требует ad_group_id; campaign modifiers не принимают ad_group_id.",
      );
  }
  if (op === "ad_group_device_modifier") {
    if (!["MOBILE", "DESKTOP", "TABLET"].includes(String(r.device)))
      extFail(
        "google_stage2_device_unsupported",
        "Device: MOBILE, DESKTOP либо TABLET; hotel/TV/OTHER не поддерживаются Search profile.",
      );
    decimal(r.multiplier, 0, 10, "multiplier");
    if (Number(r.multiplier) > 0 && Number(r.multiplier) < 0.1)
      extFail(
        "google_stage2_parameter_invalid",
        "Google device modifier: только 0 (-100%) либо 0.1–10 (-90%–+900%).",
      );
  }
  return r;
}
export function parseStage2AdvancedIntent(raw: unknown): Stage2AdvancedIntent {
  const r = extRow(raw);
  if (r.action === "stage2_bulk_inverse") {
    extClosed(raw, ["action", "items"], ["action", "items"]);
    const p = parseStage2Intent({
      action: "bid_budget_update",
      items: r.items,
    });
    return { action: "stage2_bulk_inverse", items: p.items };
  }
  if (r.action === "stage2_bulk") {
    extClosed(
      raw,
      [
        "action",
        "field",
        "campaign_ids",
        "date_range",
        "filters",
        "change",
        "max_items",
      ],
      [
        "action",
        "field",
        "campaign_ids",
        "date_range",
        "filters",
        "change",
        "max_items",
      ],
    );
    if (
      ![
        "keyword_cpc",
        "ad_group_cpc",
        "ad_group_target_cpa",
        "campaign_daily_budget",
      ].includes(String(r.field))
    )
      extFail("google_stage2_bulk_invalid", "Неверное bulk bid/budget field.");
    if (
      !Array.isArray(r.campaign_ids) ||
      !r.campaign_ids.length ||
      r.campaign_ids.length > 100
    )
      extFail("google_stage2_bulk_invalid", "Укажите 1–100 campaign IDs.");
    const ids = r.campaign_ids.map((x) => extId(x));
    if (new Set(ids).size !== ids.length)
      extFail("google_stage2_duplicate", "Duplicate campaign ID.");
    const dates = extClosed(r.date_range, ["start", "end"], ["start", "end"]);
    for (const d of [dates.start, dates.end])
      if (
        typeof d !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(d) ||
        !Number.isFinite(Date.parse(d)) ||
        new Date(d).toISOString().slice(0, 10) !== d
      )
        extFail(
          "google_stage2_bulk_invalid",
          "Date range требует действительные YYYY-MM-DD.",
        );
    const days =
      (Date.parse(String(dates.end)) - Date.parse(String(dates.start))) /
      86400000;
    if (days < 0 || days > 366)
      extFail(
        "google_stage2_bulk_invalid",
        "Date range: не более 367 календарных дней.",
      );
    if (
      !Number.isInteger(r.max_items) ||
      Number(r.max_items) < 1 ||
      Number(r.max_items) > 500 ||
      !Array.isArray(r.filters) ||
      !r.filters.length ||
      r.filters.length > 8
    )
      extFail(
        "google_stage2_bulk_invalid",
        "Bulk: 1–8 filters и max_items 1–500; truncation запрещён.",
      );
    for (const f of r.filters) {
      const isCpa = extRow(f).metric === "cpa";
      const x = extClosed(
        f,
        ["metric", "operator", "value", ...(isCpa ? ["currency"] : [])],
        ["metric", "operator", "value", ...(isCpa ? ["currency"] : [])],
      );
      if (
        ![
          "clicks",
          "impressions",
          "conversions",
          "cost_micros",
          "cpa",
        ].includes(String(x.metric)) ||
        !["LT", "LTE", "GT", "GTE", "EQ"].includes(String(x.operator))
      )
        extFail(
          "google_stage2_bulk_invalid",
          "Unsupported typed performance filter.",
        );
      decimal(x.value, 0, 9999999999, "filter value");
      if (isCpa) moneyInput({ amount: x.value, currency: x.currency });
    }
    parseStage2Intent({
      action: "bid_budget_update",
      items: [
        {
          field: r.field,
          campaign_id: "1",
          ...(r.field !== "campaign_daily_budget" ? { ad_group_id: "1" } : {}),
          ...(r.field === "keyword_cpc" ? { criterion_id: "1" } : {}),
          change: r.change,
        },
      ],
    });
    return r as Stage2AdvancedIntent;
  }
  extClosed(raw, ["action", "items"], ["action", "items"]);
  if (
    r.action !== "stage2_advanced" ||
    !Array.isArray(r.items) ||
    !r.items.length ||
    r.items.length > 500
  )
    extFail(
      "google_stage2_advanced_invalid",
      "Требуется 1–500 typed Stage 2 rows.",
    );
  const items = r.items.map(parseAdvancedRow),
    keys = items.map((x) =>
      x.operation === "portfolio_create"
        ? "name:" + x.name
        : x.operation === "portfolio_update"
          ? "portfolio:" + x.strategy_id
          : x.operation === "ad_group_device_modifier"
            ? `group-device:${x.campaign_id}:${x.ad_group_id}:${x.device}`
            : x.operation === "modifier"
              ? `criterion:${x.campaign_id}:${x.ad_group_id ?? ""}:${x.criterion_id}`
              : "campaign:" + x.campaign_id,
    );
  if (new Set(keys).size !== keys.length)
    extFail(
      "google_stage2_duplicate",
      "Нельзя изменять один объект дважды в batch.",
    );
  return { action: "stage2_advanced", items };
}
const microsMoney = (v: unknown, currency: string) => {
  const n = String(v ?? "0");
  if (!/^[1-9][0-9]*$/.test(n)) return undefined;
  const b = BigInt(n);
  return {
    amount: `${b / 1000000n}.${String(b % 1000000n).padStart(6, "0")}`,
    currency,
  };
};
function oldStrategy(
  entity: ExtendedRow,
  currency: string,
): Strategy | undefined {
  const provider = String(entity.biddingStrategyType ?? entity.type),
    type = provider === "TARGET_SPEND" ? "MAXIMIZE_CLICKS" : provider;
  if (!STAGE2_STRATEGIES.includes(type as StrategyName)) return undefined;
  const s: Strategy = { type: type as StrategyName },
    b = extRow(entity[strategyFields[s.type]]);
  if (s.type === "MANUAL_CPC" && b.enhancedCpcEnabled === true)
    return undefined;
  for (const [field, input] of [
    ["targetCpaMicros", "target_cpa"],
    ["cpcBidFloorMicros", "cpc_floor"],
    ["cpcBidCeilingMicros", "cpc_ceiling"],
  ]) {
    const m = microsMoney(b[field!], currency);
    if (m) s[input!] = m;
  }
  if (s.type === "TARGET_ROAS") s.target_roas = String(b.targetRoas ?? "");
  if (s.type === "TARGET_IMPRESSION_SHARE") {
    s.location = b.location;
    s.share_percent = String(Number(b.locationFractionMicros ?? "0") / 10000);
  }
  try {
    return parseStrategy(s);
  } catch {
    return undefined;
  }
}
function expectedStrategy(
  before: ExtendedRow,
  payload: ReturnType<typeof strategyPayload>,
  portfolio: boolean,
): ExtendedRow {
  const out = { ...before };
  for (const k of Object.values(strategyFields)) delete out[k];
  delete out.biddingStrategy;
  out[payload.field] = payload.value;
  out[portfolio ? "type" : "biddingStrategyType"] = payload.providerType;
  // Unset oneof references and old scheme are absent in protobuf JSON, not empty strings.
  return out;
}
function strategyMask(payload: ReturnType<typeof strategyPayload>) {
  const fields = Object.keys(payload.value);
  return fields.length
    ? fields.map((k) => `${snake(payload.field)}.${snake(k)}`).join(",")
    : payload.field === "maximizeConversions"
      ? "maximize_conversions.target_cpa_micros"
      : "target_spend.cpc_bid_ceiling_micros";
}
function conversionStrategy(s: Strategy) {
  return ["MAXIMIZE_CONVERSIONS", "TARGET_CPA", "TARGET_ROAS"].includes(s.type);
}
function inverseParameters(
  before: ExtendedRow,
  payload: ReturnType<typeof strategyPayload>,
  currency: string,
): Strategy | undefined {
  const old = oldStrategy(before, currency);
  if (!old) return undefined;
  if ((before.biddingStrategyType ?? before.type) === payload.providerType) {
    const cleared = Object.entries(parameterFields)
      .filter(
        ([, field]) =>
          payload.value[field] !== undefined &&
          !microsMoney(extRow(before[payload.field])[field], currency),
      )
      .map(([input]) => input);
    if (cleared.some((k) => !clearable[old.type].includes(k))) return undefined;
    if (cleared.length) old.clear_fields = cleared;
  }
  return parseStrategy(old);
}
function mergedScheme(
  before: ExtendedRow,
  payload: ReturnType<typeof strategyPayload>,
) {
  const value = { ...extRow(before[payload.field]), ...payload.value };
  const floor = String(value.cpcBidFloorMicros ?? "0"),
    ceiling = String(value.cpcBidCeilingMicros ?? "0");
  if (
    /^[0-9]+$/.test(floor) &&
    /^[0-9]+$/.test(ceiling) &&
    BigInt(ceiling) > 0n &&
    BigInt(floor) > BigInt(ceiling)
  )
    extFail(
      "google_stage2_parameter_invalid",
      "New CPC floor превышает preserved ceiling; neighboring parameters не сбрасываются.",
    );
  return value;
}
function modifierCompatibility(
  campaign: ExtendedRow,
  criterionType: string,
  multiplier: number,
  warnings: string[],
) {
  const type = String(campaign.biddingStrategyType);
  if (["MANUAL_CPC", "TARGET_SPEND"].includes(type)) return;
  if (criterionType === "DEVICE" && type === "TARGET_CPA") {
    warnings.push(
      "TARGET_CPA device adjustment меняет CPA target, не keyword CPC; conversion goal и strategy не заменяются.",
    );
    return;
  }
  if (
    criterionType === "DEVICE" &&
    [
      "MAXIMIZE_CONVERSIONS",
      "TARGET_ROAS",
      "MAXIMIZE_CONVERSION_VALUE",
      "TARGET_IMPRESSION_SHARE",
    ].includes(type) &&
    [0, 1].includes(multiplier)
  ) {
    warnings.push(
      "Smart Bidding: только device exclusion (0) либо neutral eligibility restore (1); положительная/отрицательная ручная корректировка ставки этой стратегии не применяется.",
    );
    return;
  }
  extFail(
    "google_stage2_modifier_strategy_incompatible",
    "Google strategy игнорирует такую bid adjustment; операция явно отклонена, targeting/status не меняются.",
  );
}
export async function buildStage2AdvancedPlan(
  account: string,
  raw: unknown,
  read: Stage1Reader,
): Promise<ExtendedPlan> {
  const intent = parseStage2AdvancedIntent(raw);
  if (intent.action !== "stage2_advanced")
    return buildBulk(account, intent, read);
  const ctx = await extContext(account, read),
    operations: ExtendedOperation[] = [],
    items: ExtendedPlan["items"] = [],
    inverse: ExtendedRow[] = [],
    touched = new Set<string>();
  let canInverse = true;
  const campaign = async (id: string) => {
    const q = campaignSelect + ` WHERE campaign.id = ${id}`,
      rows = await ctx.query(q);
    if (rows.length !== 1)
      extFail(
        "google_stage2_object_unavailable",
        "Campaign отсутствует в selected account.",
      );
    const c = extRow(rows[0]!.campaign);
    extOwner(c.resourceName, ctx.account_id, "campaigns");
    if (
      c.resourceName !== `customers/${ctx.account_id}/campaigns/${id}` ||
      String(c.id) !== id
    )
      extFail("google_extended_ownership_invalid", "Campaign proof mismatch.");
    if (c.status === "REMOVED" || c.advertisingChannelType !== "SEARCH")
      extFail(
        "google_stage2_channel_unsupported",
        "Advanced strategy/modifier profile: existing non-removed SEARCH campaigns only.",
      );
    return { q, c };
  };
  const goals = async (c: ExtendedRow, s: Strategy) => {
    if (!conversionStrategy(s)) return;
    const rows = await ctx.query(
      `SELECT campaign_conversion_goal.campaign, campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable FROM campaign_conversion_goal WHERE campaign_conversion_goal.campaign = ${extQuote(String(c.resourceName))}`,
    );
    for (const r of rows)
      if (extRow(r.campaignConversionGoal).campaign !== c.resourceName)
        extFail(
          "google_extended_ownership_invalid",
          "Conversion goal принадлежит другой campaign.",
        );
    if (!rows.some((r) => extRow(r.campaignConversionGoal).biddable === true))
      extFail(
        "google_stage2_conversion_goal_missing",
        "Conversion strategy требует существующий biddable goal. Goal автоматически не создаётся; recent data health не фабрикуется.",
      );
  };
  const portfolio = async (id: string) => {
    const q = portfolioSelect + ` WHERE bidding_strategy.id = ${id}`,
      rows = await ctx.query(q);
    if (rows.length !== 1)
      extFail(
        "google_stage2_object_unavailable",
        "Portfolio strategy не найдена.",
      );
    const b = extRow(rows[0]!.biddingStrategy);
    extOwner(b.resourceName, ctx.account_id, "biddingStrategies");
    if (
      b.resourceName !==
        `customers/${ctx.account_id}/biddingStrategies/${id}` ||
      String(b.id) !== id
    )
      extFail(
        "google_extended_ownership_invalid",
        "Portfolio identity mismatch.",
      );
    if (b.status !== "ENABLED" || b.effectiveCurrencyCode !== ctx.currency)
      extFail(
        "google_stage2_portfolio_incompatible",
        "Portfolio должна быть ENABLED, в том же account/currency; cross-account strategies пока не поддерживаются.",
      );
    return { q, b };
  };
  const group = async (campaign_id: string, group_id: string) => {
    const q =
        groupSelect +
        ` WHERE campaign.id = ${campaign_id} AND ad_group.id = ${group_id}`,
      rows = await ctx.query(q);
    if (rows.length !== 1)
      extFail(
        "google_stage2_object_unavailable",
        "Ad group не найдена однозначно в selected campaign.",
      );
    const g = extRow(rows[0]!.adGroup);
    extOwner(g.resourceName, ctx.account_id, "adGroups");
    if (
      g.resourceName !== `customers/${ctx.account_id}/adGroups/${group_id}` ||
      String(g.id) !== group_id ||
      String(extRow(rows[0]!.campaign).id) !== campaign_id
    )
      extFail(
        "google_extended_ownership_invalid",
        "Ad group resource/parent proof mismatch.",
      );
    if (g.status === "REMOVED")
      extFail(
        "google_stage2_object_unavailable",
        "Removed ad group не изменяется.",
      );
    return g;
  };
  for (const [index, r] of (intent.items as ExtendedRow[]).entries()) {
    const item = extItem(
      index,
      String(r.operation),
      String(r.campaign_id ?? ""),
      String(r.ad_group_id ?? ""),
    );
    items.push(item);
    try {
      let o: ExtendedOperation, revert: ExtendedRow | undefined;
      if (r.operation === "portfolio_create") {
        const s = parseStrategy(r.strategy),
          p = strategyPayload(s, ctx.currency, true),
          q =
            portfolioSelect +
            ` WHERE bidding_strategy.name = ${extQuote(String(r.name))}`;
        if (s.clear_fields !== undefined)
          extFail(
            "google_stage2_clear_invalid",
            "Create portfolio не принимает clear_fields; до создания нечего очищать.",
          );
        if ((await ctx.query(q)).length)
          extFail(
            "google_stage2_name_conflict",
            "Portfolio name уже существует; новый preview с другим именем обязателен.",
          );
        o = {
          kind: "biddingStrategies",
          method: "create",
          resource_name: null,
          fields: { name: r.name, [p.field]: p.value },
          update_mask: null,
          before: null,
          expected: { name: r.name, type: p.providerType, [p.field]: p.value },
          row: index,
          read_query: q,
          response_key: "biddingStrategy",
        };
        item.warnings.push(
          "Portfolio создана без attached campaigns; auto-delete rollback не поддерживается.",
        );
      } else if (r.operation === "portfolio_update") {
        const { q, b } = await portfolio(String(r.strategy_id)),
          s = parseStrategy(r.strategy),
          p = strategyPayload(s, ctx.currency, true),
          old = inverseParameters(b, p, ctx.currency);
        if (String(b.type) !== p.providerType)
          extFail(
            "google_stage2_portfolio_type_immutable",
            "Смена portfolio scheme type не поддерживается; создайте отдельную portfolio и explicit attach.",
          );
        if (
          Object.entries(p.value).length > 0 &&
          Object.entries(p.value).every(
            ([key, value]) =>
              canonical(
                extRow(b[p.field])[key] ?? (value === "0" ? "0" : undefined),
              ) === canonical(value),
          )
        )
          extFail(
            "google_stage2_noop",
            "Requested portfolio parameters уже установлены; clearing default не создает mutation.",
          );
        const affected = await ctx.query(
          campaignSelect +
            ` WHERE campaign.bidding_strategy = ${extQuote(String(b.resourceName))} AND campaign.status != REMOVED`,
        );
        for (const row of affected) {
          const c = extRow(row.campaign);
          extOwner(c.resourceName, ctx.account_id, "campaigns");
          if (
            c.resourceName !==
            `customers/${ctx.account_id}/campaigns/${extId(String(c.id))}`
          )
            extFail(
              "google_extended_ownership_invalid",
              "Portfolio consumer ID/resource mismatch.",
            );
          if (
            c.biddingStrategy !== b.resourceName ||
            c.advertisingChannelType !== "SEARCH"
          )
            extFail(
              "google_stage2_portfolio_incompatible",
              "Portfolio consumers должны быть SEARCH и reference matching; другие channels не изменяются.",
            );
          await goals(c, s);
        }
        item.warnings.push(
          "Shared portfolio impact campaigns: " +
            affected
              .map(
                (x) =>
                  String(extRow(x.campaign).id) +
                  " " +
                  String(extRow(x.campaign).name),
              )
              .join(", "),
        );
        o = {
          kind: "biddingStrategies",
          method: "update",
          resource_name: String(b.resourceName),
          fields: { resourceName: b.resourceName, [p.field]: p.value },
          update_mask: strategyMask(p),
          before: b,
          expected: { ...b, [p.field]: mergedScheme(b, p) },
          row: index,
          read_query: q,
          response_key: "biddingStrategy",
        };
        if (old)
          revert = {
            operation: "portfolio_update",
            strategy_id: r.strategy_id,
            strategy: old,
          };
      } else if (r.operation === "ad_group_device_modifier") {
        const { c } = await campaign(String(r.campaign_id)),
          g = await group(String(r.campaign_id), String(r.ad_group_id));
        const multiplier = decimal(r.multiplier, 0, 10, "multiplier");
        modifierCompatibility(c, "DEVICE", multiplier, item.warnings);
        if (c.biddingStrategy) {
          extOwner(c.biddingStrategy, ctx.account_id, "biddingStrategies");
          const strategy = await portfolio(
            String(c.biddingStrategy).split("/").at(-1)!,
          );
          if (strategy.b.type !== c.biddingStrategyType)
            extFail(
              "google_extended_ownership_invalid",
              "Portfolio/campaign effective type proof mismatch.",
            );
        }
        const q =
            groupDeviceSelect +
            ` WHERE campaign.id = ${r.campaign_id} AND ad_group.id = ${r.ad_group_id} AND ad_group_bid_modifier.device.type = ${r.device}`,
          rows = await ctx.query(q);
        if (rows.length > 1)
          extFail(
            "google_stage2_object_unavailable",
            "Device bid modifier неоднозначен; не выбирается произвольно.",
          );
        const b = rows.length ? extRow(rows[0]!.adGroupBidModifier) : null;
        if (b) {
          extOwner(b.resourceName, ctx.account_id, "adGroupBidModifiers");
          const id = extId(String(b.criterionId));
          if (
            b.resourceName !==
              `customers/${ctx.account_id}/adGroupBidModifiers/${r.ad_group_id}~${id}` ||
            b.adGroup !== g.resourceName ||
            extRow(b.device).type !== r.device ||
            String(extRow(rows[0]!.campaign).id) !== r.campaign_id ||
            String(extRow(rows[0]!.adGroup).id) !== r.ad_group_id
          )
            extFail(
              "google_extended_ownership_invalid",
              "AdGroupBidModifier device/resource/parent mismatch.",
            );
          if (
            b.bidModifierSource !== "AD_GROUP" &&
            b.bidModifierSource !== "CAMPAIGN"
          )
            extFail(
              "google_stage2_modifier_source_unsupported",
              "Источник device modifier неизвестен; local override не создаётся без доказанного источника.",
            );
          if (
            b.bidModifierSource === "AD_GROUP" &&
            Number(b.bidModifier) === multiplier
          )
            extFail(
              "google_stage2_noop",
              "Group device multiplier уже установлен.",
            );
        }
        const local = b?.bidModifierSource === "AD_GROUP";
        o = {
          kind: "adGroupBidModifiers",
          method: local ? "update" : "create",
          resource_name: local ? String(b!.resourceName) : null,
          fields: local
            ? { resourceName: b.resourceName, bidModifier: multiplier }
            : {
                adGroup: g.resourceName,
                device: { type: r.device },
                bidModifier: multiplier,
              },
          update_mask: local ? "bid_modifier" : null,
          before: b,
          expected: local
            ? { ...b, bidModifier: multiplier }
            : {
                adGroup: g.resourceName,
                device: { type: r.device },
                bidModifier: multiplier,
                bidModifierSource: "AD_GROUP",
              },
          row: index,
          read_query: q,
          response_key: "adGroupBidModifier",
        };
        if (local && typeof b!.bidModifier === "number")
          revert = { ...r, multiplier: String(b.bidModifier) };
        item.warnings.push(
          `Device ${r.device}: ${((multiplier - 1) * 100)
            .toFixed(4)
            .replace(/\.?(0+)$/, " ")
            .trim()}% (${multiplier}×); campaign/group status unchanged.`,
        );
        if (!local)
          item.warnings.push(
            "Create group device override: automatic deletion/inherited-state rollback unsupported; use a new approved supported operation.",
          );
        if (b?.bidModifierSource === "CAMPAIGN")
          item.warnings.push(
            `BEFORE inherits CAMPAIGN device multiplier ${String(b.bidModifier)}; CREATE independent AD_GROUP override, not UPDATE of inherited criterion.`,
          );
        const campaignDevices = await ctx.query(
          criterionSelect +
            ` WHERE campaign.id = ${r.campaign_id} AND campaign_criterion.type = DEVICE AND campaign_criterion.device.type = ${r.device} AND campaign_criterion.status != REMOVED`,
        );
        for (const row of campaignDevices) {
          const d = extRow(row.campaignCriterion);
          extOwner(d.resourceName, ctx.account_id, "campaignCriteria");
          if (
            d.campaign !== c.resourceName ||
            extRow(d.device).type !== r.device
          )
            extFail(
              "google_extended_ownership_invalid",
              "Campaign device exclusion proof mismatch.",
            );
          if (d.bidModifier === 0)
            item.warnings.push(
              "Campaign device exclusion -100% имеет приоритет; ad group modifier не включает excluded устройство.",
            );
        }
      } else if (r.operation === "modifier") {
        const { c } = await campaign(String(r.campaign_id));
        modifierCompatibility(
          c,
          String(r.criterion_type),
          Number(r.multiplier),
          item.warnings,
        );
        if (c.biddingStrategy) {
          extOwner(c.biddingStrategy, ctx.account_id, "biddingStrategies");
          const b = await portfolio(
            String(c.biddingStrategy).split("/").at(-1)!,
          );
          if (b.b.type !== c.biddingStrategyType)
            extFail(
              "google_extended_ownership_invalid",
              "Effective portfolio type mismatch.",
            );
        }
        if (r.ad_group_id) {
          const g = await group(String(r.campaign_id), String(r.ad_group_id));
          const restrictions = extRow(g.targetingSetting).targetRestrictions;
          if (
            !Array.isArray(restrictions) ||
            !restrictions.some(
              (v) =>
                extRow(v).targetingDimension === "AUDIENCE" &&
                extRow(v).bidOnly === true,
            )
          )
            extFail(
              "google_stage2_audience_observation_required",
              "Audience bid modifier требует явно доказанный OBSERVATION; TARGETING/unknown mode не изменяется.",
            );
          item.warnings.push(
            "Audience targeting mode: OBSERVATION (bid_only=true); mode не меняется.",
          );
        }
        const audience = Boolean(r.ad_group_id),
          key = audience ? "adGroupCriterion" : "campaignCriterion",
          kind = audience ? "adGroupCriteria" : "campaignCriteria",
          identity = `customers/${ctx.account_id}/${kind}/${audience ? r.ad_group_id : r.campaign_id}~${r.criterion_id}`;
        const q =
          (audience ? audienceSelect : criterionSelect) +
          ` WHERE campaign.id = ${r.campaign_id}${audience ? ` AND ad_group.id = ${r.ad_group_id}` : ""} AND ${audience ? "ad_group_criterion" : "campaign_criterion"}.criterion_id = ${r.criterion_id}`;
        const rows = await ctx.query(q);
        if (rows.length !== 1)
          extFail(
            "google_stage2_object_unavailable",
            "Existing criterion для modifier не найден.",
          );
        const b = extRow(rows[0]![key]);
        extOwner(b.resourceName, ctx.account_id, kind);
        if (
          b.resourceName !== identity ||
          String(extRow(rows[0]!.campaign).id) !== r.campaign_id ||
          (audience &&
            (String(extRow(rows[0]!.adGroup).id) !== r.ad_group_id ||
              b.adGroup !==
                `customers/${ctx.account_id}/adGroups/${r.ad_group_id}`)) ||
          (!audience && b.campaign !== c.resourceName)
        )
          extFail(
            "google_extended_ownership_invalid",
            "Criterion parent identity mismatch.",
          );
        if (
          b.type !== r.criterion_type ||
          b.status === "REMOVED" ||
          b.negative === true
        )
          extFail(
            "google_stage2_modifier_unsupported",
            "Modifier требует positive criterion указанного типа, не REMOVED.",
          );
        const multiplier = decimal(
          r.multiplier,
          r.criterion_type === "DEVICE" ? 0 : 0.1,
          10,
          "multiplier",
        );
        if (Number(b.bidModifier ?? 1) === multiplier)
          extFail("google_stage2_noop", "Bid modifier уже установлен.");
        o = {
          kind,
          method: "update",
          resource_name: identity,
          fields: { resourceName: identity, bidModifier: multiplier },
          update_mask: "bid_modifier",
          before: b,
          expected: { ...b, bidModifier: multiplier },
          row: index,
          read_query: q,
          response_key: key,
        };
        if (b.bidModifier !== undefined)
          revert = { ...r, multiplier: String(b.bidModifier) };
        if (r.criterion_type === "AD_SCHEDULE")
          item.warnings.push(
            "Ad schedule timezone: " +
              ctx.timezone +
              "; schedule intervals не переписываются.",
          );
        if (multiplier === 0)
          item.warnings.push(
            "DEVICE multiplier=0 исключает показы на этом устройстве.",
          );
      } else {
        const { q, c } = await campaign(String(r.campaign_id));
        let fields: ExtendedRow, expected: ExtendedRow, mask: string;
        if (r.operation === "portfolio_attach") {
          const { b } = await portfolio(String(r.strategy_id)),
            s = oldStrategy(b, ctx.currency);
          if (c.biddingStrategy === b.resourceName)
            extFail(
              "google_stage2_noop",
              "Campaign уже использует эту portfolio.",
            );
          if (!s)
            extFail(
              "google_stage2_portfolio_unsupported",
              "Portfolio scheme не поддерживается этим profile.",
            );
          await goals(c, s);
          const aligned = String(b.alignedCampaignBudgetId ?? "0");
          if (
            aligned !== "0" &&
            c.campaignBudget !==
              `customers/${ctx.account_id}/campaignBudgets/${aligned}`
          )
            extFail(
              "google_stage2_portfolio_budget_alignment",
              "Aligned portfolio требует тот же campaign budget; budget не меняется автоматически.",
            );
          // Freeze every attached consumer before accepting this shared reference.
          const consumers = await ctx.query(
            campaignSelect +
              ` WHERE campaign.bidding_strategy = ${extQuote(String(b.resourceName))} AND campaign.status != REMOVED`,
          );
          for (const x of consumers) {
            const consumer = extRow(x.campaign);
            extOwner(consumer.resourceName, ctx.account_id, "campaigns");
            if (
              consumer.biddingStrategy !== b.resourceName ||
              consumer.resourceName !==
                `customers/${ctx.account_id}/campaigns/${extId(String(consumer.id))}`
            )
              extFail(
                "google_extended_ownership_invalid",
                "Portfolio consumer reference mismatch.",
              );
            if (consumer.advertisingChannelType !== "SEARCH")
              extFail(
                "google_stage2_portfolio_incompatible",
                "Non-Search portfolio consumer требует отдельной channel capability проверки; attach не выполняется.",
              );
          }
          item.warnings.push(
            "Portfolio shared consumers: " +
              consumers.map((x) => String(extRow(x.campaign).id)).join(", "),
          );
          fields = {
            resourceName: c.resourceName,
            biddingStrategy: b.resourceName,
          };
          expected = {
            ...c,
            biddingStrategy: b.resourceName,
            biddingStrategyType: b.type,
          };
          for (const f of Object.values(strategyFields)) delete expected[f];
          mask = "bidding_strategy";
        } else {
          if (r.operation === "portfolio_detach" && !c.biddingStrategy)
            extFail(
              "google_stage2_noop",
              "Campaign не использует portfolio; detach не создаётся.",
            );
          const s = parseStrategy(r.strategy),
            p = strategyPayload(s, ctx.currency, false);
          await goals(c, s);
          if (
            c.biddingStrategyType === p.providerType &&
            !c.biddingStrategy &&
            Object.keys(p.value).length === 0 &&
            Object.values(extRow(c[p.field])).some(
              (v) => v !== "0" && v !== 0 && v !== false,
            )
          )
            extFail(
              "google_stage2_parameter_clear_unsupported",
              "Очищение existing strategy parameters требует отдельного explicit clear contract; omitted fields не очищаются молча.",
            );
          if (
            c.biddingStrategyType === p.providerType &&
            !c.biddingStrategy &&
            Object.entries(p.value).every(
              ([key, value]) =>
                canonical(
                  extRow(c[p.field])[key] ?? (value === "0" ? "0" : undefined),
                ) === canonical(value),
            )
          )
            extFail(
              "google_stage2_noop",
              "Requested strategy parameters уже установлены; mutation не создаётся.",
            );
          fields = { resourceName: c.resourceName, [p.field]: p.value };
          expected = expectedStrategy(c, p, false);
          if (c.biddingStrategyType === p.providerType && !c.biddingStrategy)
            expected[p.field] = mergedScheme(c, p);
          mask = strategyMask(p);
          if (conversionStrategy(s))
            item.warnings.push(
              "Conversion goal configured; actual recent conversion data не проверяется этим strategy preview, launch checklist обязателен.",
            );
        }
        if (c.biddingStrategy) {
          extOwner(c.biddingStrategy, ctx.account_id, "biddingStrategies");
          revert = {
            operation: "portfolio_attach",
            campaign_id: r.campaign_id,
            strategy_id: String(c.biddingStrategy).split("/").at(-1),
          };
        } else {
          const providerField = Object.keys(fields).find(
            (key) => key !== "resourceName",
          )!;
          const old = inverseParameters(
            c,
            {
              field: providerField,
              value: extRow(fields[providerField]),
              providerType: String(expected.biddingStrategyType),
            },
            ctx.currency,
          );
          if (old)
            revert = {
              operation: "campaign_strategy",
              campaign_id: r.campaign_id,
              strategy: old,
            };
        }
        o = {
          kind: "campaigns",
          method: "update",
          resource_name: String(c.resourceName),
          fields,
          update_mask: mask,
          before: c,
          expected,
          row: index,
          read_query: q,
          response_key: "campaign",
        };
        item.warnings.push(
          "Смена стратегии может начать обучение; keyword CPC при auto strategy может быть неэффективен. Campaign status не меняется.",
        );
      }
      if (o.resource_name && touched.has(o.resource_name))
        extFail(
          "google_stage2_duplicate",
          "Resolved resource затронут дважды.",
        );
      if (o.resource_name) touched.add(o.resource_name);
      if (o.before && canonical(o.before) === canonical(o.expected))
        extFail("google_stage2_noop", "Полученное состояние уже установлено.");
      item.before = o.before;
      item.after = o.expected;
      item.provider_operations = [operations.length];
      operations.push(o);
      if (revert) inverse.push(revert);
      else canInverse = false;
    } catch (e) {
      if (
        !(e instanceof GoogleAdsWriteError) ||
        [
          "google_extended_ownership_invalid",
          "google_stage2_duplicate",
          "google_inventory_limit",
        ].includes(e.writeCode)
      )
        throw e;
      item.row_error = {
        source: "HOLYMEDIA",
        code: e.writeCode,
        message: e.message,
      };
      item.warnings.push(e.message);
    }
  }
  if (!operations.length)
    extFail(
      "google_stage2_no_eligible_rows",
      "Все строки отклонены; validate_only/mutate не вызывается.",
    );
  const plan: ExtendedPlan = {
    version: 5,
    account_id: ctx.account_id,
    intent,
    checks: ctx.checks,
    operations,
    items,
    atomic: false,
    irreversible: false,
  };
  if (canInverse && inverse.length === operations.length)
    plan.inverse_intent = { action: "stage2_advanced", items: inverse };
  assertExtendedPlan(plan, account);
  return plan;
}
async function buildBulk(
  account: string,
  intent: Stage2AdvancedIntent,
  read: Stage1Reader,
): Promise<ExtendedPlan> {
  const ctx = await extContext(account, read);
  let selected: Stage2Item[];
  if (intent.action === "stage2_bulk_inverse")
    selected = parseStage2Intent({
      action: "bid_budget_update",
      items: intent.items,
    }).items;
  else {
    const keyword = intent.field === "keyword_cpc",
      group = intent.field !== "campaign_daily_budget" && !keyword;
    const select = keyword
      ? "SELECT campaign.id, ad_group.id, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, metrics.clicks, metrics.impressions, metrics.conversions, metrics.cost_micros FROM keyword_view"
      : group
        ? "SELECT campaign.id, ad_group.resource_name, ad_group.id, metrics.clicks, metrics.impressions, metrics.conversions, metrics.cost_micros FROM ad_group"
        : "SELECT campaign.resource_name, campaign.id, metrics.clicks, metrics.impressions, metrics.conversions, metrics.cost_micros FROM campaign";
    const operators: Record<string, string> = {
        LT: "<",
        LTE: "<=",
        GT: ">",
        GTE: ">=",
        EQ: "=",
      },
      dates = extRow(intent.date_range);
    const cpaFilters = (intent.filters as ExtendedRow[]).filter(
      (f) => f.metric === "cpa",
    );
    const thresholds = cpaFilters.map((f) => ({
      filter: f,
      micros: currencyMicros(String(f.value), String(f.currency), ctx.currency),
    }));
    const rawFilters = (intent.filters as ExtendedRow[]).filter(
      (f) => f.metric !== "cpa",
    );
    const q =
      select +
      ` WHERE campaign.id IN (${(intent.campaign_ids as string[]).join(",")}) AND campaign.status != REMOVED AND segments.date BETWEEN ${extQuote(String(dates.start))} AND ${extQuote(String(dates.end))}` +
      (keyword
        ? " AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != REMOVED"
        : group
          ? " AND ad_group.status != REMOVED"
          : "") +
      (thresholds.length ? " AND metrics.conversions > 0" : "") +
      (rawFilters.length ? " AND " : "") +
      rawFilters
        .map(
          (f) =>
            `metrics.${f.metric} ${operators[String(f.operator)]} ${f.value}`,
        )
        .join(" AND ");
    const rawRows = await ctx.query(q);
    const rawSeen = new Set<string>();
    for (const row of rawRows) {
      const c = extRow(row.campaign),
        g = extRow(row.adGroup),
        k = extRow(row.adGroupCriterion),
        id = extId(String(c.id)),
        resource = keyword
          ? k.resourceName
          : group
            ? g.resourceName
            : c.resourceName;
      extOwner(
        resource,
        ctx.account_id,
        keyword ? "adGroupCriteria" : group ? "adGroups" : "campaigns",
      );
      const expected = keyword
        ? `${prefixFor(ctx.account_id)}/adGroupCriteria/${extId(String(g.id))}~${extId(String(k.criterionId))}`
        : group
          ? `${prefixFor(ctx.account_id)}/adGroups/${extId(String(g.id))}`
          : `${prefixFor(ctx.account_id)}/campaigns/${id}`;
      if (
        resource !== expected ||
        !(intent.campaign_ids as string[]).includes(id)
      )
        extFail(
          "google_extended_ownership_invalid",
          "Bulk raw inventory parent/ID mismatch, including CPA-excluded rows.",
        );
      if (rawSeen.has(String(resource)))
        extFail(
          "google_stage2_duplicate",
          "Bulk raw inventory contains duplicate resource; CPA filtering не скрывает duplicates.",
        );
      rawSeen.add(String(resource));
    }
    const rows = rawRows.filter((row) =>
      thresholds.every(({ filter, micros }) =>
        cpaMatches(extRow(row.metrics), String(filter.operator), micros),
      ),
    );
    if (!rows.length)
      extFail(
        "google_stage2_bulk_empty",
        "Filters не выбрали ни одного объекта.",
      );
    if (rows.length > Number(intent.max_items))
      extFail(
        "google_stage2_bulk_limit",
        "Выбранных объектов больше max_items; ничего не обрезано. Уточните filters.",
      );
    const seen = new Set<string>();
    selected = rows.map((row) => {
      const c = extRow(row.campaign),
        g = extRow(row.adGroup),
        k = extRow(row.adGroupCriterion),
        resource = keyword
          ? k.resourceName
          : group
            ? g.resourceName
            : c.resourceName;
      extOwner(
        resource,
        ctx.account_id,
        keyword ? "adGroupCriteria" : group ? "adGroups" : "campaigns",
      );
      const campaign_id = extId(String(c.id));
      if (!(intent.campaign_ids as string[]).includes(campaign_id))
        extFail(
          "google_extended_ownership_invalid",
          "Bulk response outside requested campaigns.",
        );
      const identity = String(resource);
      const expectedIdentity = keyword
        ? `${prefixFor(ctx.account_id)}/adGroupCriteria/${extId(String(g.id))}~${extId(String(k.criterionId))}`
        : group
          ? `${prefixFor(ctx.account_id)}/adGroups/${extId(String(g.id))}`
          : `${prefixFor(ctx.account_id)}/campaigns/${campaign_id}`;
      if (identity !== expectedIdentity)
        extFail(
          "google_extended_ownership_invalid",
          "Bulk selection resource/ID binding mismatch; filters не могут выбрать соседний объект.",
        );
      if (seen.has(identity))
        extFail(
          "google_stage2_duplicate",
          "Bulk inventory содержит duplicate resource; не агрегируется молча.",
        );
      seen.add(identity);
      return {
        field: intent.field as Stage2Item["field"],
        campaign_id,
        ...(keyword || group ? { ad_group_id: extId(String(g.id)) } : {}),
        ...(keyword ? { criterion_id: extId(String(k.criterionId)) } : {}),
        change: intent.change as Stage2Change,
      };
    });
  }
  const base = await buildStage2Plan(
    account,
    { action: "bid_budget_update", items: selected },
    read,
  );
  const plan: ExtendedPlan = {
    version: 5,
    account_id: base.account_id,
    intent: { ...intent, resolved_items: selected },
    checks: [...ctx.checks, ...base.checks],
    operations: base.operations as ExtendedOperation[],
    items: base.items,
    atomic: false,
    irreversible: false,
  };
  for (const item of plan.items)
    item.warnings.push(
      "Performance selection frozen at preview; commit uses exact selected IDs, not a re-run filter. Changed snapshot требует нового preview.",
    );
  if (
    intent.action === "stage2_bulk" &&
    (intent.filters as ExtendedRow[]).some((f) => f.metric === "cpa")
  )
    for (const item of plan.items)
      item.warnings.push(
        `CPA filters: cost_micros / conversions, account currency ${ctx.currency}; zero/non-positive conversions excluded. Fractional attribution compared by exact decimal cross-product, not rounded CPA.`,
      );
  try {
    plan.inverse_intent = {
      action: "stage2_bulk_inverse",
      items: stage2RollbackIntent(
        base,
        base.operations.map((_, i) => i),
        ctx.currency,
      ).items,
    };
  } catch {
    /* No inverse for inherited/zero prior overrides. */
  }
  assertExtendedPlan(plan, account);
  return plan;
}
const prefixFor = (account: string) => `customers/${account}`;
function cpaMatches(
  metrics: ExtendedRow,
  operator: string,
  threshold: string,
): boolean {
  const conversionText = String(metrics.conversions ?? "0"),
    cost = String(metrics.costMicros ?? "0");
  const parsed =
    /^(-?)(0|[1-9][0-9]{0,15})(?:\.([0-9]{1,16}))?(?:e([+-]?[0-9]{1,2}))?$/i.exec(
      conversionText,
    );
  if (
    !parsed ||
    Math.abs(Number(parsed[4] ?? 0)) > 24 ||
    !/^(?:0|[1-9][0-9]{0,18})$/.test(cost)
  )
    extFail(
      "google_stage2_metrics_invalid",
      "CPA требует достоверные cost_micros/conversions; malformed или чрезмерная precision не округляется.",
    );
  if (parsed[1] === "-") return false;
  const fraction = parsed[3] ?? "",
    scale = fraction.length - Number(parsed[4] ?? 0),
    denominator = 10n ** BigInt(Math.max(0, scale)),
    conversions =
      BigInt(parsed[2]! + fraction) * 10n ** BigInt(Math.max(0, -scale));
  if (conversions <= 0n) return false;
  const left = BigInt(cost) * denominator,
    right = BigInt(threshold) * conversions;
  return operator === "LT"
    ? left < right
    : operator === "LTE"
      ? left <= right
      : operator === "GT"
        ? left > right
        : operator === "GTE"
          ? left >= right
          : left === right;
}

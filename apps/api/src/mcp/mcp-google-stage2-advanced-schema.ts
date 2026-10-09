import { extClosed, extFail } from "../providers/google-ads-extended-plan.js";
import {
  parseStage2AdvancedIntent,
  STAGE2_STRATEGIES,
} from "../providers/google-ads-stage2-advanced.js";

export const GOOGLE_STAGE2_ADVANCED_TOOLS = [
  "google_ads_strategy_modifier_preview",
  "google_ads_bulk_bid_budget_preview",
];
const id = { type: "string", pattern: "^[0-9]{1,20}$" };
const decimal = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,6})?$",
};
const currency = { type: "string", pattern: "^[A-Z]{3}$" };
const money = {
  type: "object",
  additionalProperties: false,
  required: ["amount", "currency"],
  properties: { amount: decimal, currency },
};
const change = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "amount", "currency"],
      properties: { mode: { const: "absolute" }, amount: decimal, currency },
    },
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "percent", "currency"],
      properties: {
        mode: { const: "percent" },
        percent: {
          type: "string",
          pattern: "^-?(?:0|[1-9][0-9]{0,3})(?:\\.[0-9]{1,4})?$",
        },
        currency,
      },
    },
  ],
};
const strategy = {
  oneOf: STAGE2_STRATEGIES.map((type) => {
    const fields: Record<string, unknown> = { type: { const: type } };
    if (["TARGET_CPA", "MAXIMIZE_CONVERSIONS"].includes(type))
      fields.target_cpa = money;
    if (type !== "MANUAL_CPC") fields.cpc_ceiling = money;
    if (["TARGET_CPA", "TARGET_ROAS", "MAXIMIZE_CONVERSIONS"].includes(type))
      fields.cpc_floor = money;
    if (type === "TARGET_ROAS") fields.target_roas = decimal;
    if (type === "TARGET_IMPRESSION_SHARE") {
      fields.share_percent = decimal;
      fields.location = {
        enum: ["ANYWHERE_ON_PAGE", "TOP_OF_PAGE", "ABSOLUTE_TOP_OF_PAGE"],
      };
    }
    const optionalClears: Record<string, string[]> = {
      MANUAL_CPC: [],
      MAXIMIZE_CLICKS: ["cpc_ceiling"],
      MAXIMIZE_CONVERSIONS: ["target_cpa", "cpc_floor", "cpc_ceiling"],
      TARGET_CPA: ["cpc_floor", "cpc_ceiling"],
      TARGET_ROAS: ["cpc_floor", "cpc_ceiling"],
      TARGET_IMPRESSION_SHARE: [],
    };
    if (optionalClears[type]!.length)
      fields.clear_fields = {
        type: "array",
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
        items: { enum: optionalClears[type] },
      };
    return {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        ...(type === "TARGET_CPA"
          ? ["target_cpa"]
          : type === "TARGET_ROAS"
            ? ["target_roas"]
            : type === "TARGET_IMPRESSION_SHARE"
              ? ["share_percent", "location", "cpc_ceiling"]
              : []),
      ],
      properties: fields,
    };
  }),
};
const row = (
  operation: string,
  properties: Record<string, unknown>,
  required: string[] = Object.keys(properties),
) => ({
  type: "object",
  additionalProperties: false,
  required: ["operation", ...required],
  properties: { operation: { const: operation }, ...properties },
});
const items = {
  type: "array",
  minItems: 1,
  maxItems: 500,
  items: {
    oneOf: [
      row("campaign_strategy", { campaign_id: id, strategy }),
      row("portfolio_create", {
        name: { type: "string", minLength: 1, maxLength: 255 },
        strategy,
      }),
      row("portfolio_update", { strategy_id: id, strategy }),
      row("portfolio_attach", { campaign_id: id, strategy_id: id }),
      row("portfolio_detach", { campaign_id: id, strategy }),
      row("modifier", {
        campaign_id: id,
        criterion_id: id,
        criterion_type: { enum: ["DEVICE", "LOCATION", "AD_SCHEDULE"] },
        multiplier: decimal,
      }),
      row("ad_group_device_modifier", {
        campaign_id: id,
        ad_group_id: id,
        device: { enum: ["MOBILE", "DESKTOP", "TABLET"] },
        multiplier: decimal,
      }),
      row("modifier", {
        campaign_id: id,
        ad_group_id: id,
        criterion_id: id,
        criterion_type: { enum: ["USER_LIST", "USER_INTEREST"] },
        multiplier: decimal,
      }),
    ],
  },
};
export function stage2AdvancedToolSchema(
  name: string,
): Record<string, unknown> | undefined {
  if (!GOOGLE_STAGE2_ADVANCED_TOOLS.includes(name)) return undefined;
  const properties: Record<string, unknown> = {
    provider: { const: "GOOGLE_ADS" },
    account_id: { type: "string", pattern: "^[0-9]{10}$" },
  };
  if (name === "google_ads_strategy_modifier_preview") properties.items = items;
  else
    Object.assign(properties, {
      field: {
        enum: [
          "keyword_cpc",
          "ad_group_cpc",
          "ad_group_target_cpa",
          "campaign_daily_budget",
        ],
      },
      campaign_ids: {
        type: "array",
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
        items: id,
      },
      date_range: {
        type: "object",
        additionalProperties: false,
        required: ["start", "end"],
        properties: {
          start: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          end: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
        },
      },
      filters: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["metric", "operator", "value"],
              properties: {
                metric: {
                  enum: ["clicks", "impressions", "conversions", "cost_micros"],
                },
                operator: { enum: ["LT", "LTE", "GT", "GTE", "EQ"] },
                value: decimal,
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["metric", "operator", "value", "currency"],
              properties: {
                metric: { const: "cpa" },
                operator: { enum: ["LT", "LTE", "GT", "GTE", "EQ"] },
                value: decimal,
                currency,
              },
            },
          ],
        },
      },
      change,
      max_items: { type: "integer", minimum: 1, maximum: 500 },
    });
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}
export function stage2AdvancedToolIntent(
  name: string,
  args: Record<string, unknown>,
) {
  if (!GOOGLE_STAGE2_ADVANCED_TOOLS.includes(name)) return null;
  const allowed =
    name === "google_ads_strategy_modifier_preview"
      ? ["provider", "account_id", "items"]
      : [
          "provider",
          "account_id",
          "field",
          "campaign_ids",
          "date_range",
          "filters",
          "change",
          "max_items",
        ];
  extClosed(args, allowed, allowed);
  if (
    args.provider !== "GOOGLE_ADS" ||
    typeof args.account_id !== "string" ||
    !/^[0-9]{10}$/.test(args.account_id)
  )
    extFail(
      "google_stage2_input_invalid",
      "Provider GOOGLE_ADS и account_id обязательны.",
    );
  const input = Object.fromEntries(
    Object.entries(args).filter(
      ([key]) => key !== "provider" && key !== "account_id",
    ),
  );
  return parseStage2AdvancedIntent({
    action:
      name === "google_ads_strategy_modifier_preview"
        ? "stage2_advanced"
        : "stage2_bulk",
    ...input,
  });
}

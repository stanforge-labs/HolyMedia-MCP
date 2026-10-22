import { GoogleAdsWriteError } from "../providers/google-ads-write.js";
import { parseStage2Intent } from "../providers/google-ads-stage2.js";

export const GOOGLE_STAGE2_TOOLS = ["google_ads_bid_budget_preview"];
const id = { type: "string", pattern: "^[0-9]{1,20}$" };
const currency = { type: "string", pattern: "^[A-Z]{3}$" };
const change = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["mode", "amount", "currency"],
      properties: {
        mode: { const: "absolute" },
        amount: {
          type: "string",
          pattern: "^(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,6})?$",
        },
        currency,
      },
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
export function stage2ToolSchema(
  name: string,
): Record<string, unknown> | undefined {
  if (
    ![...GOOGLE_STAGE2_TOOLS, "preview_change_campaign_budget"].includes(name)
  )
    return undefined;
  const fields =
    name === "preview_change_campaign_budget"
      ? ["campaign_daily_budget"]
      : [
          "keyword_cpc",
          "ad_group_cpc",
          "ad_group_target_cpa",
          "campaign_daily_budget",
        ];
  return {
    type: "object",
    additionalProperties: false,
    required: ["provider", "account_id", "items"],
    properties: {
      provider: { const: "GOOGLE_ADS" },
      account_id: { type: "string", pattern: "^[0-9]{10}$" },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: {
          oneOf: fields.map((field) => ({
            type: "object",
            additionalProperties: false,
            required: [
              "field",
              "campaign_id",
              "change",
              ...(field !== "campaign_daily_budget" ? ["ad_group_id"] : []),
              ...(field === "keyword_cpc" ? ["criterion_id"] : []),
            ],
            properties: {
              field: { const: field },
              campaign_id: id,
              change,
              ...(field !== "campaign_daily_budget" ? { ad_group_id: id } : {}),
              ...(field === "keyword_cpc" ? { criterion_id: id } : {}),
            },
          })),
        },
      },
    },
  };
}
export function stage2ToolIntent(name: string, args: Record<string, unknown>) {
  if (
    ![...GOOGLE_STAGE2_TOOLS, "preview_change_campaign_budget"].includes(name)
  )
    return null;
  if (
    args.provider !== "GOOGLE_ADS" ||
    typeof args.account_id !== "string" ||
    !/^[0-9]{10}$/.test(args.account_id) ||
    Object.keys(args).some(
      (k) => !["provider", "account_id", "items"].includes(k),
    )
  )
    throw new GoogleAdsWriteError(
      "google_stage2_input_invalid",
      "Provider GOOGLE_ADS, account_id и typed items обязательны; replacement payload запрещён.",
    );
  const intent = parseStage2Intent({
    action: "bid_budget_update",
    items: args.items,
  });
  if (
    name === "preview_change_campaign_budget" &&
    intent.items.some((i) => i.field !== "campaign_daily_budget")
  )
    throw new GoogleAdsWriteError(
      "google_stage2_input_invalid",
      "Generic budget preview принимает только daily campaign budget.",
    );
  return intent;
}

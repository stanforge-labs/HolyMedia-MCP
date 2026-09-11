import { META_METRICS } from "../providers/meta-insights.parameters.js";
import { META_ASSET_TOOLS } from "./meta-asset-authorization.service.js";
const id = { type: "string", pattern: "^[0-9]{1,40}$" };
export function metaReadSchema(
  name: string,
): Record<string, unknown> | undefined {
  if (META_ASSET_TOOLS.has(name)) {
    const required: string[] = [];
    if (
      ![
        "list_meta_pages",
        "list_meta_businesses",
        "get_connected_assets",
      ].includes(name)
    )
      required.push(name.includes("business") ? "business_id" : "page_id");
    if (name === "get_page_post" || name === "get_page_post_engagement")
      required.push("post_id");
    return {
      type: "object",
      additionalProperties: false,
      required,
      properties: {
        provider: { type: "string", enum: ["META_ADS", "meta_ads"] },
        account_id: {
          type: "string",
          pattern: "^(act_)?[0-9]{1,40}$",
          description:
            "Optional external ad account selecting an authorized Meta connection; never an internal UUID.",
        },
        page_id: id,
        business_id: id,
        post_id: { type: "string", pattern: "^[0-9_]{1,90}$" },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 25 },
        cursor: { type: "string", maxLength: 2048 },
      },
    };
  }
  if (name === "get_meta_ads_detailed_report")
    return {
      type: "object",
      additionalProperties: false,
      required: ["account_id"],
      properties: {
        provider: { type: "string", enum: ["META_ADS", "meta_ads"] },
        account_id: { type: "string" },
        since: { type: "string", format: "date" },
        until: { type: "string", format: "date" },
        date_preset: {
          type: "string",
          enum: ["last_7d", "last_14d", "last_30d"],
        },
        metrics: {
          type: "array",
          items: { type: "string", enum: META_METRICS },
        },
        level: { type: "string", enum: ["campaign"] },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string", maxLength: 2048 },
      },
    };
  if (name === "get_flexible_insights")
    return {
      type: "object",
      additionalProperties: true,
      required: ["provider", "account_id"],
      properties: {
        provider: { type: "string" },
        account_id: {
          type: "string",
          description: "External advertising account ID.",
        },
        metrics: {
          type: "array",
          items: { type: "string" },
          description: `For Meta, supported fields: ${META_METRICS.join(", ")}. Unknown Meta fields are rejected.`,
        },
        level: { type: "string", enum: ["account", "campaign", "adset", "ad"] },
        since: { type: "string", format: "date" },
        until: { type: "string", format: "date" },
        date_preset: {
          type: "string",
          enum: ["last_7d", "last_14d", "last_30d"],
        },
        breakdowns: { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: 100 },
        cursor: { type: "string", maxLength: 2048 },
      },
    };
  return undefined;
}

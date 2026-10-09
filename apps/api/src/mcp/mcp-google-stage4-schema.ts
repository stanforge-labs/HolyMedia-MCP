import {
  campaignBriefSchema,
  validateBriefSchema,
  type BriefSchema,
} from "./mcp-google-stage0-schema.js";

export const GOOGLE_STAGE4_TOOLS = [
  "google_ads_ads_assets_preview",
  "google_ads_pmax_preview",
] as const;
export const stage4Actions = [
  "rsa_create",
  "rsa_update",
  "ad_status",
  "ad_remove",
  "asset_create",
  "asset_attach",
  "asset_detach",
  "campaign_update",
  "ad_group_create",
  "ad_group_update",
  "tracking_update",
  "asset_group_update",
  "pmax_search_theme_add",
  "pmax_audience_signal_add",
  "pmax_asset_attach",
  "pmax_asset_detach",
  "pmax_create",
] as const;
const string = (maxLength = 255): BriefSchema => ({
  type: "string",
  description: "Explicit supplied value.",
  minLength: 1,
  maxLength,
});
const id: BriefSchema = { ...string(20), pattern: "^[0-9]{1,20}$" };
const en = (values: string[]): BriefSchema => ({ ...string(), enum: values });
const object = (
  properties: Record<string, BriefSchema>,
  required: string[] = [],
): BriefSchema => ({
  type: "object",
  description: "Typed fields; arbitrary Google requests rejected.",
  properties,
  required,
  additionalProperties: false,
});
const bool: BriefSchema = {
  type: "boolean",
  description: "Explicit boolean value.",
};
const rsa =
  campaignBriefSchema.properties!.ad_groups!.items!.properties!.rsa!.items!;
export const stage4RowSchema = object({
  campaign_id: id,
  ad_group_id: id,
  ad_id: id,
  asset_id: id,
  asset_group_id: id,
  signal_id: id,
  audience_id: id,
  name: string(),
  status: en(["PAUSED", "ENABLED"]),
  acknowledge_irreversible: {
    type: "boolean",
    description:
      "Explicit irreversible removal acknowledgement; browser approval remains mandatory.",
    enum: [true],
  },
  rsa,
  assets: campaignBriefSchema.properties!.assets!,
  level: en(["account", "campaign", "ad_group"]),
  field_type: en([
    "SITELINK",
    "CALLOUT",
    "STRUCTURED_SNIPPET",
    "CALL",
    "AD_IMAGE",
    "BUSINESS_LOGO",
    "BUSINESS_NAME",
    "HEADLINE",
    "LONG_HEADLINE",
    "DESCRIPTION",
    "MARKETING_IMAGE",
    "SQUARE_MARKETING_IMAGE",
  ]),
  start_date: campaignBriefSchema.properties!.start_date!,
  end_date: campaignBriefSchema.properties!.end_date!,
  networks: object({ search_partners: bool, display_expansion: bool }),
  final_url_suffix: string(2048),
  tracking_url_template: string(2048),
  final_url: string(2048),
  path1: string(15),
  path2: string(15),
  search_theme: string(80),
});
export function stage4ToolSchema(name: string) {
  if (
    !GOOGLE_STAGE4_TOOLS.includes(name as (typeof GOOGLE_STAGE4_TOOLS)[number])
  )
    return undefined;
  return object(
    {
      provider: en(["GOOGLE_ADS"]),
      account_id: { ...string(14), pattern: "^[0-9-]{10,14}$" },
      action: en(
        stage4Actions.filter((a) =>
          name === "google_ads_pmax_preview"
            ? a.startsWith("pmax_") || a === "asset_group_update"
            : !a.startsWith("pmax_") && a !== "asset_group_update",
        ),
      ),
      items: {
        type: "array",
        description:
          "1–100 explicit rows, at most 500 underlying provider operations.",
        minItems: 1,
        maxItems: 100,
        items: stage4RowSchema,
      },
    },
    ["provider", "account_id", "action", "items"],
  );
}
export function stage4ToolIntent(name: string, args: Record<string, unknown>) {
  if (!stage4ToolSchema(name)) throw new Error("Unknown Stage 4 tool");
  validateBriefSchema(args, stage4ToolSchema(name)!);
  return { ...args };
}

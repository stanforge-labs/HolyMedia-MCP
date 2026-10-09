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
  "pmax_asset_replace",
  "pmax_campaign_asset_replace",
  "pmax_campaign_asset_detach",
  "pmax_signal_remove",
  "pmax_negative_add",
  "pmax_negative_remove",
  "pmax_brand_exclude",
  "pmax_brand_remove",
  "image_asset_create",
  "pmax_create",
  "pmax_asset_group_create",
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
const list = (
  items: BriefSchema,
  minItems: number,
  maxItems: number,
): BriefSchema => ({
  type: "array",
  description: "Bounded explicit entries.",
  items,
  minItems,
  maxItems,
});
export const inlineGoogleMediaSchema = object({
  asset_id: id,
  mime_type: en(["image/png", "image/jpeg"]),
  data_base64: {
    ...string(Math.ceil((1024 * 1024) / 3) * 4),
    description:
      "Local <=1 MiB inline actual PNG/JPEG bytes; aggregate <=2 MiB, never URL, data URI or filesystem path.",
  },
});
export const pmaxAssetGroupSchema = object(
  {
    name: string(128),
    final_url: string(2048),
    headlines: list(string(30), 3, 15),
    long_headlines: list(string(90), 1, 5),
    descriptions: list(string(90), 2, 5),
    images: list(
      object(
        {
          field_type: en(["MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE"]),
          media: inlineGoogleMediaSchema,
        },
        ["field_type", "media"],
      ),
      2,
      40,
    ),
    audience_ids: list(id, 0, 20),
    search_themes: list(string(80), 0, 50),
    path1: string(15),
    path2: string(15),
  },
  [
    "name",
    "final_url",
    "headlines",
    "long_headlines",
    "descriptions",
    "images",
  ],
);
export const pmaxBriefSchema = object(
  {
    campaign_name: string(),
    daily_budget: campaignBriefSchema.properties!.daily_budget!,
    conversion_actions: list(id, 1, 50),
    business_name: string(25),
    logos: list(inlineGoogleMediaSchema, 1, 5),
    asset_groups: list(pmaxAssetGroupSchema, 1, 10),
    brand_guidelines_enabled: bool,
    bidding_strategy: en(["MAXIMIZE_CONVERSIONS", "MAXIMIZE_CONVERSION_VALUE"]),
    target_cpa: campaignBriefSchema.properties!.daily_budget!,
    target_roas: {
      type: "number",
      description: "Positive ROAS ratio, e.g. 3.5 for 350%.",
      minimum: 0.01,
      maximum: 1000,
    },
    locations: list(
      object({ geo_target_id: id, name: string(120), exclude: bool }, [
        "geo_target_id",
      ]),
      1,
      50,
    ),
    languages: list(id, 1, 20),
    utm: campaignBriefSchema.properties!.utm!,
    start_date: campaignBriefSchema.properties!.start_date!,
    end_date: campaignBriefSchema.properties!.end_date!,
    contains_eu_political_advertising: en([
      "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
      "CONTAINS_EU_POLITICAL_ADVERTISING",
    ]),
  },
  [
    "campaign_name",
    "daily_budget",
    "conversion_actions",
    "business_name",
    "logos",
    "asset_groups",
    "locations",
    "languages",
    "contains_eu_political_advertising",
  ],
);
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
    "LOGO",
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
  brief: pmaxBriefSchema,
  asset_group: pmaxAssetGroupSchema,
  business_name: string(25),
  logos: list(inlineGoogleMediaSchema, 1, 5),
  media: inlineGoogleMediaSchema,
  text: string(90),
  shared_set_id: id,
  criterion_id: id,
  match_type: en(["BROAD", "PHRASE", "EXACT"]),
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

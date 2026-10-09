import { GoogleAdsWriteError } from "../providers/google-ads-write.js";

export type BriefSchema = {
  type: "object" | "array" | "string" | "number" | "boolean";
  description: string;
  properties?: Record<string, BriefSchema>;
  required?: string[];
  additionalProperties?: false;
  items?: BriefSchema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  enum?: (string | boolean)[];
};
const str = (
  description: string,
  maxLength = 255,
  pattern?: string,
): BriefSchema => ({
  type: "string",
  description,
  minLength: 1,
  maxLength,
  ...(pattern ? { pattern } : {}),
});
const en = (description: string, values: string[]): BriefSchema => ({
  ...str(description),
  enum: values,
});
const obj = (
  description: string,
  properties: Record<string, BriefSchema>,
  required = Object.keys(properties),
): BriefSchema => ({
  type: "object",
  description,
  additionalProperties: false,
  properties,
  required,
});
const arr = (
  description: string,
  items: BriefSchema,
  maxItems = 500,
  minItems = 0,
): BriefSchema => ({ type: "array", description, items, maxItems, minItems });
const id = (description: string) => str(description, 20, "^[0-9]{1,20}$");
export const briefMoneySchema = obj(
  "Positive normal account-currency amount, never raw micros.",
  {
    amount: str(
      "Decimal amount, e.g. 15000 KZT or 20 USD.",
      20,
      "^(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,6})?$",
    ),
    currency: str(
      "Must equal the selected Google account currency.",
      3,
      "^[A-Z]{3}$",
    ),
  },
);
const negative = obj(
  "Negative keyword; conflicts with planned positive keywords are shown in preview.",
  {
    text: str("Human-readable negative keyword text, NFC normalized.", 80),
    match_type: en("Negative match type.", ["BROAD", "PHRASE", "EXACT"]),
  },
);
const keyword = obj(
  "Keyword inside a PAUSED group/campaign; uses Stage 1 normalization and validation.",
  {
    ...negative.properties!,
    cpc_bid: briefMoneySchema,
    final_url: str("Optional keyword final URL; does not modify ad URL.", 2048),
  },
  ["text", "match_type"],
);
const adText = (headline: boolean) =>
  obj(
    "RSA text with optional explicit pin position.",
    {
      text: str(
        headline
          ? "Headline: 1–30 characters (wide characters count double)."
          : "Description: 1–90 characters (wide characters count double).",
        headline ? 30 : 90,
      ),
      pinned_field: en(
        "Optional pin; available positions depend on text kind.",
        headline
          ? ["HEADLINE_1", "HEADLINE_2", "HEADLINE_3"]
          : ["DESCRIPTION_1", "DESCRIPTION_2"],
      ),
    },
    ["text"],
  );
const rsa = obj(
  "New responsive search ad is always PAUSED; no implicit activation.",
  {
    final_url: str(
      "Absolute public landing URL, HTTP(S), without credentials.",
      2048,
    ),
    headlines: arr("3–15 headlines.", adText(true), 15, 3),
    descriptions: arr("2–4 descriptions.", adText(false), 4, 2),
    path1: str("Optional display path, at most 15 characters.", 15),
    path2: str("Optional second display path; requires path1.", 15),
  },
  ["final_url", "headlines", "descriptions"],
);
const assets = obj(
  "Typed text/call asset creation and existing account-scoped image/logo references; no binary ingestion.",
  {
    sitelinks: arr(
      "Sitelinks created and linked to this campaign.",
      obj(
        "Sitelink asset.",
        {
          text: str("Sitelink text, at most 25 characters.", 25),
          final_url: str("Sitelink landing URL.", 2048),
          description1: str(
            "Optional first description, at most 35 characters.",
            35,
          ),
          description2: str(
            "Optional second description, at most 35 characters; supply both descriptions.",
            35,
          ),
        },
        ["text", "final_url"],
      ),
      50,
    ),
    callouts: arr(
      "Callout texts, at most 25 characters each.",
      str("Callout text.", 25),
      50,
    ),
    structured_snippets: arr(
      "Structured snippets; Google validates localized header and content policy.",
      obj("Snippet asset.", {
        header: str("Provider-supported localized header, e.g. Services.", 25),
        values: arr(
          "3–10 values.",
          str("Snippet value, at most 25 characters.", 25),
          10,
          3,
        ),
      }),
      20,
    ),
    call: obj("Optional phone asset; no conversion tracking changes.", {
      country_code: str("ISO country code, e.g. KZ.", 2, "^[A-Z]{2}$"),
      phone_number: str(
        "Actual supplied phone number, not generated.",
        30,
        "^[+0-9 ()-]+$",
      ),
    }),
    image_asset_ids: arr(
      "Existing IMAGE assets belonging to selected account; no uploads/downloads.",
      id("Existing image asset ID."),
      20,
    ),
    logo_asset_ids: arr(
      "Existing IMAGE assets linked as BUSINESS_LOGO; Google validates eligibility and dimensions.",
      id("Existing logo image asset ID."),
      5,
    ),
    business_name: str(
      "Actual advertiser business name, not generated; Google validates policy.",
      25,
    ),
  },
  [],
);
export const campaignBriefSchema = obj(
  "Prepare one atomic Google Search campaign preview. Approval and commit are separate; all delivery entities start PAUSED.",
  {
    provider: en("Explicit advertising provider.", ["GOOGLE_ADS"]),
    account_id: str("Selected Google customer ID.", 14, "^[0-9-]{10,14}$"),
    campaign_name: str("Unique campaign name within this account.", 255),
    daily_budget: briefMoneySchema,
    locations: arr(
      "Include/exclude Google locations resolved from human names; ambiguity is rejected.",
      obj(
        "Geo location.",
        {
          name: str("Human name, e.g. Алматы, Астана or Казахстан.", 120),
          country_code: str(
            "Optional ISO country filter to disambiguate.",
            2,
            "^[A-Z]{2}$",
          ),
          exclude: {
            type: "boolean",
            description:
              "Exclude location; default false. Include mode is PRESENCE.",
          },
          geo_target_id: id(
            "Optional explicit constant ID selected from returned ambiguity candidates; name must still match suggestion.",
          ),
        },
        ["name"],
      ),
      50,
      1,
    ),
    proximities: arr(
      "Optional additional coordinate-radius includes; PRESENCE mode, no negative radius or address geocoding. Each adds one atomic campaign criterion.",
      obj("One radius include.", {
        latitude: {
          type: "number",
          description:
            "Latitude -90..90, at most six decimal places; exact microdegree conversion.",
          minimum: -90,
          maximum: 90,
        },
        longitude: {
          type: "number",
          description:
            "Longitude -180..180, at most six decimal places; exact microdegree conversion.",
          minimum: -180,
          maximum: 180,
        },
        radius: {
          type: "number",
          description:
            "Radius 1..500 in selected units (bounded supported product profile); Google validates local privacy eligibility.",
          minimum: 1,
          maximum: 500,
        },
        unit: en("Radius measurement unit.", ["KILOMETERS", "MILES"]),
      }),
      50,
    ),
    languages: arr(
      "Language names/codes: Russian/русский/ru, Kazakh/казахский/kk, English/английский/en.",
      str("Google language name or supported alias.", 80),
      20,
      1,
    ),
    ad_groups: arr(
      "Multiple uniquely named groups, each created PAUSED.",
      obj(
        "Search ad group.",
        {
          name: str("Unique name within brief.", 255),
          default_bid: briefMoneySchema,
          keywords: arr("Positive keywords.", keyword, 500, 1),
          negative_keywords: arr("Group negatives.", negative),
          rsa: arr("Responsive search ads, created PAUSED.", rsa, 20, 1),
        },
        ["name", "keywords", "rsa"],
      ),
      100,
      1,
    ),
    negative_keywords: arr("Campaign-level negatives.", negative),
    assets,
    start_date: str(
      "Optional account-timezone start date YYYY-MM-DD.",
      10,
      "^\\d{4}-\\d{2}-\\d{2}$",
    ),
    end_date: str(
      "Optional account-timezone end date YYYY-MM-DD.",
      10,
      "^\\d{4}-\\d{2}-\\d{2}$",
    ),
    ad_schedule: arr(
      "Optional non-overlapping account-timezone quarter-hour schedule; no bid modifiers.",
      obj("One interval.", {
        days: arr(
          "Days for this interval.",
          en("Day of week.", [
            "MONDAY",
            "TUESDAY",
            "WEDNESDAY",
            "THURSDAY",
            "FRIDAY",
            "SATURDAY",
            "SUNDAY",
          ]),
          7,
          1,
        ),
        start: str(
          "Inclusive HH:MM; 00/15/30/45 minutes.",
          5,
          "^(?:[01][0-9]|2[0-3]):(?:00|15|30|45)$",
        ),
        end: str(
          "Exclusive HH:MM, including 24:00; split overnight periods explicitly.",
          5,
          "^(?:(?:[01][0-9]|2[0-3]):(?:00|15|30|45)|24:00)$",
        ),
      }),
      42,
    ),
    conversion_actions: arr(
      "Existing ENABLED conversion action IDs. Exact same-account subset uses explicit custom conversion goal; cross-account creation unsupported in atomic single-customer set.",
      id("Conversion action ID in selected conversion account."),
      50,
    ),
    bidding_strategy: en(
      "Safe creation strategies only. Default MANUAL_CPC; requires explicit ad-group default_bid. MAXIMIZE_CONVERSIONS requires valid conversion actions.",
      ["MANUAL_CPC", "MAXIMIZE_CONVERSIONS"],
    ),
    networks: obj(
      "Google Search always ON; partner network optional and OFF by default. Display expansion never enabled.",
      {
        search_partners: {
          type: "boolean",
          description: "Explicit opt-in to Search Partners; default false.",
        },
      },
      [],
    ),
    utm: obj(
      "Campaign tracking only; final landing URLs are never rewritten.",
      {
        final_url_suffix: str(
          "Query suffix without leading ?; default utm_source=google&utm_medium=cpc&utm_campaign={campaignid}.",
          2048,
        ),
        tracking_url_template: str(
          "Optional HTTPS tracker template containing {lpurl}; bounded Google ValueTrack placeholders.",
          2048,
        ),
      },
      [],
    ),
  },
  [
    "provider",
    "account_id",
    "campaign_name",
    "daily_budget",
    "locations",
    "languages",
    "ad_groups",
  ],
);
export const campaignIdSchema = obj(
  "Read the real launch checklist, or prepare a separate campaign-only activation/pause preview. No hidden status changes to groups/ads.",
  {
    provider: en("Explicit provider.", ["GOOGLE_ADS"]),
    account_id: campaignBriefSchema.properties!.account_id!,
    campaign_id: id("Existing campaign ID scoped to selected account."),
  },
);
export const campaignCloneSchema = obj(
  "Preview bounded Search clone, target PAUSED, including supported proximity, owned CALL/BUSINESS_NAME assets and same-account shared negative lists. Unsupported source components cause an explicit error, never silent omission.",
  {
    provider: campaignIdSchema.properties!.provider!,
    account_id: campaignIdSchema.properties!.account_id!,
    source_campaign_id: id("Source campaign ID in selected account."),
    new_name: str("Unique target campaign name.", 255),
    new_budget: briefMoneySchema,
    new_locations: campaignBriefSchema.properties!.locations!,
    new_dates: obj(
      "Optional replacement dates; omitted preserves source dates.",
      {
        start_date: campaignBriefSchema.properties!.start_date!,
        end_date: campaignBriefSchema.properties!.end_date!,
      },
      [],
    ),
  },
  ["provider", "account_id", "source_campaign_id", "new_name"],
);
export function validateBriefSchema(
  value: unknown,
  schema: BriefSchema,
  path = "brief",
): void {
  const fail = () => {
    throw new GoogleAdsWriteError(
      "google_brief_invalid",
      `Неверное поле ${path}: ${schema.description}`,
      [],
      path,
    );
  };
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return fail();
    const row = value as Record<string, unknown>;
    if (
      Object.keys(row).some((k) => !schema.properties?.[k]) ||
      schema.required?.some((k) => row[k] === undefined)
    )
      return fail();
    for (const [key, v] of Object.entries(row))
      validateBriefSchema(v, schema.properties![key]!, `${path}.${key}`);
  } else if (schema.type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems ?? 0) ||
      value.length > (schema.maxItems ?? 500)
    )
      return fail();
    value.forEach((v, i) =>
      validateBriefSchema(v, schema.items!, `${path}[${i}]`),
    );
  } else {
    if (typeof value !== schema.type) return fail();
    if (
      typeof value === "number" &&
      (!Number.isFinite(value) ||
        value < (schema.minimum ?? -Infinity) ||
        value > (schema.maximum ?? Infinity))
    )
      return fail();
    if (
      typeof value === "string" &&
      (value.length < (schema.minLength ?? 0) ||
        value.length > (schema.maxLength ?? 2048) ||
        /\p{Cc}/u.test(value) ||
        (schema.pattern && !new RegExp(schema.pattern).test(value)))
    )
      return fail();
    if (schema.enum && !schema.enum.includes(value as string | boolean))
      return fail();
  }
}
export function stage0ToolSchema(
  name: string,
): Record<string, unknown> | undefined {
  if (name === "create_campaign_from_brief")
    return {
      oneOf: [
        campaignBriefSchema,
        {
          type: "object",
          description:
            "Existing Meta generic preview compatibility; Google uses the strict typed brief above.",
          properties: {
            provider: {
              type: "string",
              enum: ["META_ADS", "meta_ads"],
              description: "Legacy Meta provider.",
            },
          },
          additionalProperties: true,
        },
      ],
    };
  if (name === "clone_campaign_preview")
    return {
      oneOf: [
        campaignCloneSchema,
        {
          type: "object",
          description: "Existing Meta clone preview compatibility.",
          properties: {
            provider: {
              type: "string",
              enum: ["META_ADS", "meta_ads"],
              description: "Legacy Meta provider.",
            },
          },
          additionalProperties: true,
        },
      ],
    };
  if (
    [
      "get_launch_checklist",
      "preview_resume_campaign",
      "preview_pause_campaign",
    ].includes(name)
  )
    return {
      oneOf: [
        campaignIdSchema,
        {
          type: "object",
          properties: {
            provider: { type: "string", enum: ["META_ADS", "meta_ads"] },
          },
          additionalProperties: true,
        },
      ],
    };
  return undefined;
}

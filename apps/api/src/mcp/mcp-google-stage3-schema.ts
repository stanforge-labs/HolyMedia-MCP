import { extClosed, extFail } from "../providers/google-ads-extended-plan.js";
import {
  parseStage3Intent,
  STAGE3_ACTION_FIELDS,
  STAGE3_DAYS,
  STAGE3_DEMOGRAPHICS,
  STAGE3_AUDIENCE_TYPES,
} from "../providers/google-ads-stage3.js";

export const GOOGLE_STAGE3_TOOLS = [
  "google_ads_targeting_preview",
  "google_ads_audience_search",
];
const id = { type: "string", pattern: "^[0-9]{1,20}$" };
const name = { type: "string", minLength: 1, maxLength: 255 };
const audience = {
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  anyOf: [{ required: ["id"] }, { required: ["name"] }],
  properties: {
    kind: { enum: STAGE3_AUDIENCE_TYPES },
    id,
    name,
  },
};
const member = {
  oneOf: ["KEYWORD", "URL", "APP"].map((type) => ({
    type: "object",
    additionalProperties: false,
    required: ["type", "value"],
    properties: {
      type: { const: type },
      value: {
        type: "string",
        minLength: 1,
        maxLength: type === "URL" ? 2048 : 80,
      },
    },
  })),
};
const properties: Record<string, unknown> = {
  audience,
  mode: { enum: ["OBSERVATION", "TARGETING"] },
  bid_modifier: { type: "number", minimum: 0.1, maximum: 10 },
  criterion_id: id,
  acknowledge_irreversible: { const: true },
  dimension: { enum: Object.keys(STAGE3_DEMOGRAPHICS) },
  value: { enum: [...new Set(Object.values(STAGE3_DEMOGRAPHICS).flat())] },
  name,
  country_code: { type: "string", pattern: "^[A-Z]{2}$" },
  geo_target_id: id,
  latitude: { type: "number", minimum: -90, maximum: 90 },
  longitude: { type: "number", minimum: -180, maximum: 180 },
  radius: { type: "number", minimum: 1, maximum: 500 },
  unit: { enum: ["KILOMETERS", "MILES"] },
  positive: { enum: ["PRESENCE", "PRESENCE_OR_INTEREST"] },
  negative: { enum: ["PRESENCE", "PRESENCE_OR_INTEREST"] },
  days: {
    type: "array",
    minItems: 1,
    maxItems: 7,
    uniqueItems: true,
    items: { enum: STAGE3_DAYS },
  },
  start: { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):(?:00|15|30|45)$" },
  end: {
    type: "string",
    pattern: "^(?:(?:[01][0-9]|2[0-3]):(?:00|15|30|45)|24:00)$",
  },
  device: { enum: ["MOBILE", "DESKTOP", "TABLET"] },
  criterion_type: {
    enum: [
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
    ],
  },
  description: { type: "string", minLength: 1, maxLength: 1000 },
  members: { type: "array", minItems: 1, maxItems: 100, items: member },
  privacy_ack: { const: true },
  custom_audience_id: id,
  acknowledge_replace_members: { const: true },
};
export function stage3ToolSchema(
  tool: string,
): Record<string, unknown> | undefined {
  if (!GOOGLE_STAGE3_TOOLS.includes(tool)) return undefined;
  const common = {
    provider: { const: "GOOGLE_ADS" },
    account_id: { type: "string", pattern: "^[0-9]{10}$" },
  };
  if (tool === "google_ads_audience_search")
    return {
      type: "object",
      additionalProperties: false,
      required: ["provider", "account_id", "name", "kind"],
      properties: {
        ...common,
        name,
        kind: { enum: STAGE3_AUDIENCE_TYPES },
      },
    };
  return {
    type: "object",
    additionalProperties: false,
    required: ["provider", "account_id", "items"],
    properties: {
      ...common,
      items: {
        type: "array",
        minItems: 1,
        maxItems: 500,
        items: {
          oneOf: Object.entries(STAGE3_ACTION_FIELDS).map(
            ([operation, spec]) => {
              const custom = operation.startsWith("custom_audience_"),
                campaignOnly = [
                  "geo_add",
                  "geo_exclude",
                  "radius_add",
                  "presence",
                  "language_add",
                  "schedule_add",
                  "schedule_bid_modifier",
                  "device_modifier",
                ].includes(operation);
              return {
                type: "object",
                additionalProperties: false,
                required: [
                  "operation",
                  ...(custom ? [] : ["level", "campaign_id"]),
                  ...spec.required,
                ],
                properties: {
                  operation: { const: operation },
                  ...(custom
                    ? {}
                    : {
                        level: {
                          enum: campaignOnly
                            ? ["CAMPAIGN"]
                            : ["CAMPAIGN", "AD_GROUP"],
                        },
                        campaign_id: id,
                        ...(campaignOnly ? {} : { ad_group_id: id }),
                      }),
                  ...Object.fromEntries(
                    spec.allowed.map((k) => [
                      k,
                      operation === "device_modifier" && k === "bid_modifier"
                        ? { anyOf: [properties[k], { const: 0 }] }
                        : operation === "audience_exclude" && k === "audience"
                          ? {
                              ...audience,
                              properties: {
                                ...audience.properties,
                                kind: {
                                  enum: [
                                    "USER_LIST",
                                    "IN_MARKET",
                                    "AFFINITY",
                                    "DETAILED_DEMOGRAPHIC",
                                  ],
                                },
                              },
                            }
                          : properties[k],
                    ]),
                  ),
                },
                ...(!custom && !campaignOnly
                  ? {
                      allOf: [
                        {
                          if: { properties: { level: { const: "AD_GROUP" } } },
                          then: { required: ["ad_group_id"] },
                          else: { not: { required: ["ad_group_id"] } },
                        },
                        ...(operation.startsWith("demographic_") &&
                        operation !== "demographic_bid_modifier"
                          ? [
                              {
                                oneOf: Object.entries(STAGE3_DEMOGRAPHICS).map(
                                  ([dimension, values]) => ({
                                    properties: {
                                      dimension: { const: dimension },
                                      value: { enum: values },
                                    },
                                  }),
                                ),
                              },
                            ]
                          : []),
                        ...(operation === "demographic_add"
                          ? [
                              {
                                not: {
                                  properties: {
                                    level: { const: "CAMPAIGN" },
                                    dimension: { const: "PARENTAL_STATUS" },
                                  },
                                  required: ["level", "dimension"],
                                },
                              },
                            ]
                          : []),
                      ],
                    }
                  : {}),
                ...(operation === "custom_audience_update"
                  ? {
                      anyOf: ["name", "description", "members"].map((k) => ({
                        required: [k],
                      })),
                      allOf: [
                        {
                          if: { required: ["members"] },
                          then: { required: ["acknowledge_replace_members"] },
                        },
                      ],
                    }
                  : {}),
              };
            },
          ),
        },
      },
    },
  };
}
export function stage3ToolIntent(tool: string, args: Record<string, unknown>) {
  if (!GOOGLE_STAGE3_TOOLS.includes(tool)) return null;
  const search = tool === "google_ads_audience_search",
    r = extClosed(
      args,
      search
        ? ["provider", "account_id", "name", "kind"]
        : ["provider", "account_id", "items"],
      search
        ? ["provider", "account_id", "name", "kind"]
        : ["provider", "account_id", "items"],
    );
  if (
    r.provider !== "GOOGLE_ADS" ||
    typeof r.account_id !== "string" ||
    !/^[0-9]{10}$/.test(r.account_id)
  )
    extFail(
      "google_stage3_input_invalid",
      "Требуется provider GOOGLE_ADS и account_id ровно 10 цифр.",
    );
  if (search) {
    if (
      typeof r.name !== "string" ||
      !r.name.trim() ||
      r.name.length > 255 ||
      typeof r.kind !== "string" ||
      !STAGE3_AUDIENCE_TYPES.includes(r.kind)
    )
      extFail(
        "google_stage3_input_invalid",
        "Audience search требует typed name/kind.",
      );
    return { action: "audience_search", name: r.name, kind: r.kind };
  }
  return parseStage3Intent({ action: "targeting", items: r.items });
}

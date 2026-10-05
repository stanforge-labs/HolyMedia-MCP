import { GOOGLE_MUTATION_BATCH_LIMIT } from "../providers/google-ads-write.js";

export function keywordStatusToolSchema(
  name: string,
): Record<string, unknown> | undefined {
  if (
    !["pause_entities_preview", "update_entity_status_preview"].includes(name)
  )
    return undefined;
  const pause = name === "pause_entities_preview";
  const id = (description: string) => ({
    type: "string",
    pattern: "^[0-9]{1,20}$",
    description,
  });
  return {
    type: "object",
    oneOf: [
      {
        type: "object",
        additionalProperties: false,
        required: [
          "provider",
          "account_id",
          "entity_type",
          "items",
          ...(pause ? [] : ["status"]),
        ],
        properties: {
          provider: {
            type: "string",
            enum: ["GOOGLE_ADS"],
            description:
              "Explicit Google Ads provider. No campaign or budget changes are supported.",
          },
          account_id: {
            type: "string",
            pattern: "^(?:[0-9]{10}|[0-9]{3}-[0-9]{3}-[0-9]{4})$",
            description:
              "Authorized, write-allowlisted Google customer ID, not an MCC manager ID.",
          },
          entity_type: {
            type: "string",
            enum: ["keyword"],
            description:
              "Positive AdGroupCriterion keyword only; negative keywords and deletion are not supported.",
          },
          status: {
            type: "string",
            enum: pause ? ["PAUSED"] : ["ENABLED", "PAUSED"],
            description: pause
              ? "Optional PAUSED; this tool pauses keywords."
              : "Requested keyword status: PAUSED to pause, ENABLED to resume.",
          },
          items: {
            type: "array",
            minItems: 1,
            maxItems: GOOGLE_MUTATION_BATCH_LIMIT,
            description:
              "One keyword or a batch of at most 500 distinct keyword resources in the same customer. Oversized batches are rejected, never truncated.",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["campaign_id", "ad_group_id", "criterion_id"],
              properties: {
                campaign_id: id("Real campaign ID containing this keyword."),
                ad_group_id: id("Real ad group ID containing this keyword."),
                criterion_id: id(
                  "Real keyword AdGroupCriterion ID, not keyword text.",
                ),
                resource_name: {
                  type: "string",
                  pattern:
                    "^customers/[0-9]{10}/adGroupCriteria/[0-9]{1,20}~[0-9]{1,20}$",
                  description:
                    "Optional exact Google resource name. Must match customer, ad group and criterion IDs.",
                },
              },
            },
          },
        },
      },
      {
        type: "object",
        additionalProperties: true,
        required: ["account_id"],
        properties: {
          provider: {
            type: "string",
            enum: ["META_ADS", "meta_ads", "meta"],
            description:
              "Existing Meta compatibility provider; omission retains the existing Meta default.",
          },
          account_id: {
            type: "string",
            description: "Authorized Meta ad account ID.",
          },
          object_id: {
            type: "string",
            description: "Existing Meta object identifier.",
          },
          entity_type: {
            type: "string",
            description: "Existing Meta entity kind.",
          },
          status: {
            type: "string",
            description:
              "Existing Meta status preview value; Meta dispatch is unchanged.",
          },
        },
      },
    ],
  };
}

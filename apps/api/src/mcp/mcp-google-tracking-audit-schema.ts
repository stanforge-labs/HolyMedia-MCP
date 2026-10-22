import {
  validateBriefSchema,
  type BriefSchema,
} from "./mcp-google-stage0-schema.js";
import { parseTrackingAuditOptions } from "../providers/google-ads-tracking-audit.js";

export const GOOGLE_TRACKING_AUDIT_TOOLS = [
  "get_tracking_specs",
  "audit_links_and_utms",
] as const;
const id: BriefSchema = {
  type: "string",
  description: "Exact numeric provider resource ID.",
  pattern: "^[0-9]{1,20}$",
  minLength: 1,
  maxLength: 20,
};
const ids: BriefSchema = {
  type: "array",
  description: "1–20 unique account-owned IDs; no arbitrary query/filter.",
  minItems: 1,
  maxItems: 20,
  items: id,
};
export function trackingAuditToolSchema(name: string): BriefSchema | undefined {
  if (
    !GOOGLE_TRACKING_AUDIT_TOOLS.includes(
      name as (typeof GOOGLE_TRACKING_AUDIT_TOOLS)[number],
    )
  )
    return undefined;
  return {
    type: "object",
    description:
      "READ-only provider-derived URL/tracking inheritance. Syntactic audit only, no landing-page fetch or reachability claim.",
    additionalProperties: false,
    required: ["provider", "account_id"],
    properties: {
      provider: {
        type: "string",
        description: "Explicit provider.",
        enum: ["GOOGLE_ADS"],
      },
      account_id: {
        type: "string",
        description:
          "Authorized Google customer; connection/workspace ownership remains server-side.",
        pattern: "^[0-9-]{10,14}$",
        minLength: 10,
        maxLength: 14,
      },
      campaign_ids: ids,
      ad_group_ids: ids,
      ad_id: {
        ...id,
        description:
          "Optional explicit ad context for keyword inheritance in the same ad group; never guesses served ad.",
      },
      limit: {
        type: "number",
        description:
          "Integer limit per level, default100; truncation is explicit and never reported as full account audit.",
        minimum: 1,
        maximum: 200,
      },
    },
  };
}
export function trackingAuditToolArguments(
  name: string,
  args: Record<string, unknown>,
) {
  const schema = trackingAuditToolSchema(name);
  if (!schema) throw new Error("Unknown Google tracking audit tool");
  validateBriefSchema(args, schema);
  const raw = Object.fromEntries(
    Object.entries(args).filter(
      ([key]) => key !== "provider" && key !== "account_id",
    ),
  );
  return {
    action:
      name === "get_tracking_specs" ? ("specs" as const) : ("audit" as const),
    options: parseTrackingAuditOptions(raw),
  };
}

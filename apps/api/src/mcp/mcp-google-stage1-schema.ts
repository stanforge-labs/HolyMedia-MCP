import { GoogleAdsWriteError } from "../providers/google-ads-write.js";
import {
  parseStage1Intent,
  type Stage1Action,
} from "../providers/google-ads-stage1.js";
export const GOOGLE_STAGE1_TOOLS = [
  "google_ads_change_keyword_match_type_preview",
  "google_ads_negatives_preview",
  "google_ads_create_shared_negative_list_preview",
  "google_ads_shared_negative_members_preview",
  "google_ads_shared_negative_campaigns_preview",
  "google_ads_search_term_to_negative_preview",
  "google_ads_search_term_to_keyword_preview",
  "list_change_journal",
  "preview_rollback_commit",
];
const generic = [
  "create_keyword_from_brief",
  "preview_update_object",
  "preview_delete_or_archive_object",
];
const id = (description: string) => ({
  type: "string",
  pattern: "^[0-9]{1,20}$",
  description,
});
const text = (description: string) => ({
  type: "string",
  minLength: 1,
  maxLength: 80,
  description,
});
const match = {
  type: "string",
  enum: ["BROAD", "PHRASE", "EXACT"],
  description:
    "Google keyword match type; text and match type are immutable on an existing criterion.",
};
const props = {
  campaign_id: id("Campaign ID in the selected account."),
  ad_group_id: id("Ad group ID; must belong to campaign_id."),
  criterion_id: id("Existing criterion ID, not keyword text."),
  shared_set_id: id("Shared negative keyword list ID in the selected account."),
  text: text("Keyword text, normalized NFC/whitespace; no raw Google payload."),
  search_term: text(
    "Search term from the read result; converted using the same keyword/negative builder.",
  ),
  match_type: match,
  final_url: {
    type: ["string", "null"],
    maxLength: 2048,
    description:
      "Absolute HTTP(S) final URL without credentials; null clears keyword override.",
  },
  cpc_bid: {
    type: "object",
    additionalProperties: false,
    required: ["amount", "currency"],
    description:
      "Normal account-currency amount, not micros. Currency must match provider account.",
    properties: {
      amount: {
        type: "string",
        pattern: "^(?:0|[1-9][0-9]{0,9})(?:\\.[0-9]{1,6})?$",
        description:
          "Positive decimal currency amount, e.g. 150 KZT or 0.5 USD; internally converted to micros.",
      },
      currency: {
        type: "string",
        pattern: "^[A-Z]{3}$",
        description: "Actual provider account ISO currency code.",
      },
    },
  },
  shared_list_name: {
    type: "string",
    minLength: 1,
    maxLength: 255,
    description: "Unique account-scoped shared negative keyword list name.",
  },
};
export function stage1Description(name: string): string | undefined {
  const descriptions: Record<string, string> = {
    create_keyword_from_brief:
      "Google Ads keyword creation preview: checks group ownership, duplicates and negative conflicts; Google validate_only; returns secure preview/approval link. Meta contract unchanged.",
    preview_update_object:
      "Google keyword final URL set/replace/reset preview; displays old/new URLs, supports later rollback; never commits. Meta contract unchanged.",
    preview_delete_or_archive_object:
      "Google keyword PERMANENT removal preview. Removed keywords cannot be restored; prefer PAUSE. Browser approval and separate commit required. Meta contract unchanged.",
    google_ads_change_keyword_match_type_preview:
      "Preview two operations per keyword: create new match-type criterion and pause old; never deletes old. Max 250 items/500 operations; partial commit may be DEGRADED.",
    google_ads_negatives_preview:
      "Campaign/ad-group negative add/remove preview, ownership/duplicate/conflict checks and Google validate_only. Warnings require explicit browser approval; no provider mutation.",
    google_ads_create_shared_negative_list_preview:
      "Create empty SharedSet negative list preview; validate_only, browser approval, commit and reread. Members and campaign attachment are separate explicit previews.",
    google_ads_shared_negative_members_preview:
      "SharedCriterion negative add/remove preview; list-scoped IDs, duplicate/conflict checks, validate_only; no write until approved commit.",
    google_ads_shared_negative_campaigns_preview:
      "CampaignSharedSet attach/detach preview; shows list/campaign effects and active keyword conflicts. Separate approved commit required.",
    google_ads_search_term_to_negative_preview:
      "Search term to campaign/ad-group/shared-list negative preview; uses common negative builder and explicit conflict warnings. Returns secure approval link, not a provider write.",
    google_ads_search_term_to_keyword_preview:
      "Search term to new keyword preview in selected campaign/ad group; reuses keyword creation, duplicate/conflict/money validation. No mutation until approved commit.",
    list_change_journal:
      "Read authorized workspace/account Google change journal: actor, time, campaign/group/object, before/requested/actual, preview/commit ID, result and original Google errors. Cursor pagination; no provider call.",
    preview_rollback_commit:
      "Create NEW approved-write preview from server-recorded commit before values; keyword status/final URL only. Requires unchanged post-commit snapshot. Does not write. REMOVED, match-type and negative rollback unsupported.",
  };
  return descriptions[name];
}
export function stage1ToolSchema(
  name: string,
): Record<string, unknown> | undefined {
  if (!GOOGLE_STAGE1_TOOLS.includes(name) && !generic.includes(name))
    return undefined;
  if (name === "preview_rollback_commit")
    return {
      type: "object",
      additionalProperties: false,
      required: ["commit_id"],
      properties: {
        commit_id: {
          type: "string",
          pattern: "^hmc_[A-Za-z0-9_-]{43}$",
          description:
            "Opaque commit identifier from a write result/journal. No replacement rollback fields accepted.",
        },
      },
    };
  const properties: Record<string, unknown> = {
    provider: {
      type: "string",
      enum: ["GOOGLE_ADS"],
      description:
        "Explicit Google Ads provider; server write gate and account allowlist are independently enforced.",
    },
    account_id: {
      type: "string",
      pattern: "^(?:[0-9]{10}|[0-9]{3}-[0-9]{3}-[0-9]{4})$",
      description: "Authorized Google customer ID, not MCC ID.",
    },
  };
  const required = ["provider", "account_id"];
  if (name === "list_change_journal") {
    Object.assign(properties, {
      from: {
        type: "string",
        format: "date-time",
        description: "Inclusive UTC lower commit time.",
      },
      to: {
        type: "string",
        format: "date-time",
        description: "Inclusive UTC upper commit time.",
      },
      actor_user_id: {
        type: "string",
        format: "uuid",
        description: "Optional approving user ID within this workspace.",
      },
      operation: {
        type: "string",
        maxLength: 80,
        description: "Exact journal operation identifier.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        default: 50,
        description: "Maximum journal commits returned; no provider call.",
      },
      cursor: {
        type: "string",
        pattern: "^hmc_[A-Za-z0-9_-]{43}$",
        description: "Opaque next_cursor from the same account/filter query.",
      },
    });
    return {
      type: "object",
      additionalProperties: false,
      required,
      properties,
    };
  }
  let names: string[];
  if (name === "google_ads_create_shared_negative_list_preview")
    names = ["shared_list_name"];
  else if (name === "google_ads_shared_negative_campaigns_preview")
    names = ["campaign_id", "shared_set_id"];
  else if (name === "google_ads_shared_negative_members_preview")
    names = ["shared_set_id", "criterion_id", "text", "match_type"];
  else if (
    name === "google_ads_negatives_preview" ||
    name === "google_ads_search_term_to_negative_preview"
  )
    names = [
      "campaign_id",
      "ad_group_id",
      "shared_set_id",
      "criterion_id",
      name.includes("search_term") ? "search_term" : "text",
      "match_type",
    ];
  else if (name === "preview_update_object")
    names = ["campaign_id", "ad_group_id", "criterion_id", "final_url"];
  else if (name === "preview_delete_or_archive_object")
    names = ["campaign_id", "ad_group_id", "criterion_id"];
  else if (name === "google_ads_change_keyword_match_type_preview")
    names = ["campaign_id", "ad_group_id", "criterion_id", "match_type"];
  else
    names = [
      "campaign_id",
      "ad_group_id",
      name.includes("search_term") ? "search_term" : "text",
      "match_type",
      "cpc_bid",
      "final_url",
    ];
  const itemProperties = Object.fromEntries(
    names.map((k) => [k, props[k as keyof typeof props]]),
  );
  let itemRequired = names.filter((k) => !["cpc_bid", "final_url"].includes(k));
  if (name === "preview_update_object") itemRequired = names;
  if (
    name.includes("negative") &&
    name !== "google_ads_create_shared_negative_list_preview"
  ) {
    if (name.includes("campaigns")) {
      properties.operation = {
        type: "string",
        enum: ["attach", "detach"],
        description:
          "Attach/detach list; does not delete the list or campaign.",
      };
      required.push("operation");
    } else if (!name.includes("search_term")) {
      properties.operation = {
        type: "string",
        enum: ["add", "remove"],
        description:
          "Add negative text/match type or permanently remove criterion_id.",
      };
      required.push("operation");
    }
    if (
      name === "google_ads_negatives_preview" ||
      name === "google_ads_search_term_to_negative_preview"
    ) {
      const key = name.includes("search_term") ? "target_level" : "level";
      properties[key] = {
        type: "string",
        enum: name.includes("search_term")
          ? ["campaign", "ad_group", "shared_list"]
          : ["campaign", "ad_group"],
        description:
          "Negative placement; ad_group requires campaign_id/ad_group_id; shared_list requires shared_set_id.",
      };
      required.push(key);
    }
    itemRequired = name.includes("search_term")
      ? ["search_term", "match_type"]
      : name.includes("campaigns")
        ? names
        : name.includes("members")
          ? ["shared_set_id"]
          : ["campaign_id"];
  }
  if (generic.includes(name)) {
    properties.entity_type = {
      type: "string",
      enum: ["keyword"],
      description:
        "Positive Google AdGroupCriterion keyword; no budgets/campaign creation.",
    };
    required.push("entity_type");
  }
  if (name === "preview_update_object") {
    properties.field = {
      type: "string",
      enum: ["final_url"],
      description: "Only keyword final URL set/reset in Stage 1.",
    };
    required.push("field");
  }
  properties.items = {
    type: "array",
    minItems: 1,
    maxItems: name.includes("match_type") ? 250 : 500,
    description:
      "Typed same-account items. At most 500 PROVIDER operations; match-type changes count twice. Missing conditional IDs/text are rejected server-side.",
    items: {
      type: "object",
      additionalProperties: false,
      required: itemRequired,
      properties: itemProperties,
    },
  };
  required.push("items");
  const google = {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
  if (
    [
      "google_ads_negatives_preview",
      "google_ads_shared_negative_members_preview",
      "google_ads_search_term_to_negative_preview",
    ].includes(name)
  ) {
    const search = name.includes("search_term"),
      members = name.includes("members"),
      levelKey = search ? "target_level" : "level";
    const levels = members
      ? ["shared_list"]
      : search
        ? ["campaign", "ad_group", "shared_list"]
        : ["campaign", "ad_group"];
    const variants = levels.flatMap((level) =>
      (search ? ["add"] : ["add", "remove"]).map((operation) => {
        const keys = [
          ...(level === "shared_list"
            ? ["shared_set_id"]
            : [
                "campaign_id",
                ...(level === "ad_group" ? ["ad_group_id"] : []),
              ]),
          ...(operation === "remove"
            ? ["criterion_id"]
            : [search ? "search_term" : "text", "match_type"]),
        ];
        return {
          properties: {
            ...(!members ? { [levelKey]: { enum: [level] } } : {}),
            ...(!search ? { operation: { enum: [operation] } } : {}),
            items: {
              type: "array",
              minItems: 1,
              maxItems: 500,
              items: {
                type: "object",
                additionalProperties: false,
                required: keys,
                properties: Object.fromEntries(
                  keys.map((k) => [k, props[k as keyof typeof props]]),
                ),
              },
            },
          },
        };
      }),
    );
    return { ...google, oneOf: variants };
  }
  return generic.includes(name)
    ? {
        type: "object",
        oneOf: [
          google,
          {
            type: "object",
            additionalProperties: true,
            required: ["account_id"],
            properties: {
              provider: {
                type: "string",
                enum: ["META_ADS", "meta_ads", "meta"],
                description:
                  "Existing Meta provider; omitted provider retains Meta default.",
              },
              account_id: {
                type: "string",
                description: "Authorized Meta account ID.",
              },
              object_id: {
                type: "string",
                description: "Existing Meta object ID.",
              },
            },
          },
        ],
      }
    : google;
}
export function stage1ToolIntent(name: string, args: Record<string, unknown>) {
  if (!GOOGLE_STAGE1_TOOLS.includes(name) && !generic.includes(name))
    return null;
  if (["list_change_journal", "preview_rollback_commit"].includes(name))
    return null;
  const schema = stage1ToolSchema(name)!;
  const google = generic.includes(name)
    ? (schema.oneOf as Record<string, unknown>[])[0]!
    : schema;
  if (
    args.provider !== "GOOGLE_ADS" ||
    typeof args.account_id !== "string" ||
    !Array.isArray(args.items) ||
    Object.keys(args).some((k) => !(k in (google.properties as object))) ||
    (generic.includes(name) && args.entity_type !== "keyword") ||
    (name === "preview_update_object" && args.field !== "final_url")
  )
    throw new GoogleAdsWriteError(
      "google_stage1_input_invalid",
      "Требуется явный GOOGLE_ADS, account_id и типизированные items без лишних полей.",
    );
  if (
    name === "google_ads_negatives_preview" &&
    !["campaign", "ad_group"].includes(String(args.level))
  )
    throw new GoogleAdsWriteError(
      "google_stage1_input_invalid",
      "Используйте campaign/ad_group; shared list принимает отдельный members tool.",
    );
  const action: Stage1Action = name.includes("match_type")
    ? "keyword_match"
    : name === "preview_update_object"
      ? "keyword_url"
      : name === "preview_delete_or_archive_object"
        ? "keyword_remove"
        : name.includes("create_shared")
          ? "shared_create"
          : name.includes("negative_campaigns")
            ? args.operation === "attach"
              ? "shared_attach"
              : "shared_detach"
            : name.includes("negative")
              ? args.operation === "remove"
                ? "negative_remove"
                : "negative_add"
              : "keyword_add";
  if (
    (name.includes("negative_campaigns") &&
      !["attach", "detach"].includes(String(args.operation))) ||
    ([
      "google_ads_negatives_preview",
      "google_ads_shared_negative_members_preview",
    ].includes(name) &&
      !["add", "remove"].includes(String(args.operation)))
  )
    throw new GoogleAdsWriteError(
      "google_stage1_input_invalid",
      "Некорректная operation.",
    );
  const level = name.includes("members")
    ? "shared_list"
    : (args.target_level ?? args.level);
  const items = args.items.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
    const row = { ...raw } as Record<string, unknown>;
    if (name.includes("search_term")) {
      if (row.text !== undefined)
        throw new GoogleAdsWriteError(
          "google_stage1_input_invalid",
          "Search conversion принимает search_term, не text.",
        );
      row.text = row.search_term;
      delete row.search_term;
    }
    return row;
  });
  return parseStage1Intent({
    action,
    ...(action.startsWith("negative_") ? { level } : {}),
    items,
  });
}

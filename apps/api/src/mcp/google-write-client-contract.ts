import { extFail } from "../providers/google-ads-extended-plan.js";
import type { Stage4Intent } from "../providers/google-ads-stage4.js";
import {
  stage0ToolSchema,
  validateBriefSchema,
  type BriefSchema,
} from "./mcp-google-stage0-schema.js";
import {
  GOOGLE_STAGE1_TOOLS,
  stage1ToolSchema,
  stage1ToolIntent,
} from "./mcp-google-stage1-schema.js";
import {
  GOOGLE_STAGE2_TOOLS,
  stage2ToolSchema,
  stage2ToolIntent,
} from "./mcp-google-stage2-schema.js";
import {
  GOOGLE_STAGE2_ADVANCED_TOOLS,
  stage2AdvancedToolSchema,
  stage2AdvancedToolIntent,
} from "./mcp-google-stage2-advanced-schema.js";
import {
  GOOGLE_STAGE3_TOOLS,
  stage3ToolSchema,
  stage3ToolIntent,
} from "./mcp-google-stage3-schema.js";
import {
  GOOGLE_STAGE4_TOOLS,
  stage4ToolSchema,
} from "./mcp-google-stage4-schema.js";
import { keywordStatusToolSchema } from "./mcp-google-keyword-schema.js";
import {
  GOOGLE_TRACKING_AUDIT_TOOLS,
  trackingAuditToolSchema,
  trackingAuditToolArguments,
} from "./mcp-google-tracking-audit-schema.js";
import { GoogleAdsWriteError } from "../providers/google-ads-write.js";
import { parseStage4Intent } from "../providers/google-ads-stage4.js";
import { normalizeBrief } from "../providers/google-ads-stage0.js";

export const GOOGLE_WRITE_PROFILE = "google_ads_write";
export const GOOGLE_WRITE_GENERIC_TOOLS = [
  "preview_change_campaign_name",
  "preview_pause_adset_or_group",
  "preview_resume_adset_or_group",
] as const;

const readTools = [
  ...GOOGLE_TRACKING_AUDIT_TOOLS,
  "list_accounts",
  "list_campaigns",
  "get_campaign",
  "get_campaign_structure",
  "get_account_status",
  "get_account_object",
  "list_account_objects",
  "get_provider_capabilities",
  "get_launch_checklist",
  "get_google_ads_detailed_report",
  "google_ads_list_keywords",
  "google_ads_search_terms",
  "google_ads_list_negatives",
  "google_ads_check_negative_conflicts",
  "google_ads_audience_search",
  "list_change_journal",
] as const;
export const GOOGLE_WRITE_PROFILE_TOOLS = [
  ...new Set([
    ...GOOGLE_STAGE1_TOOLS,
    ...GOOGLE_STAGE2_TOOLS,
    ...GOOGLE_STAGE2_ADVANCED_TOOLS,
    ...GOOGLE_STAGE3_TOOLS,
    ...GOOGLE_STAGE4_TOOLS,
    ...GOOGLE_WRITE_GENERIC_TOOLS,
    "create_campaign_from_brief",
    "clone_campaign_preview",
    "preview_pause_campaign",
    "preview_resume_campaign",
    "create_keyword_from_brief",
    "pause_entities_preview",
    "update_entity_status_preview",
    "preview_update_object",
    "preview_delete_or_archive_object",
    "preview_change_campaign_budget",
    "commit_preview",
    ...readTools,
  ]),
] as readonly string[];

const id: BriefSchema = {
  type: "string",
  pattern: "^[0-9]{1,20}$",
  description: "Actual Google resource ID in the selected owned account.",
};
/** Google branch only. The caller must preserve a disjoint legacy Meta branch. */
export function googleWriteGenericSchema(
  name: string,
): BriefSchema | undefined {
  if (
    !GOOGLE_WRITE_GENERIC_TOOLS.includes(
      name as (typeof GOOGLE_WRITE_GENERIC_TOOLS)[number],
    )
  )
    return undefined;
  const rename = name === "preview_change_campaign_name";
  return {
    type: "object",
    additionalProperties: false,
    description:
      "Only prepares a Google Ads preview. Provider ownership, validate_only, human browser approval, immutable commit and reread remain mandatory.",
    required: [
      "provider",
      "account_id",
      "campaign_id",
      rename ? "new_name" : "ad_group_id",
    ],
    properties: {
      provider: {
        type: "string",
        enum: ["GOOGLE_ADS"],
        description: "Explicit Google provider; never inferred from ID shape.",
      },
      account_id: {
        type: "string",
        pattern: "^[0-9]{10}$",
        description:
          "Selected Google customer ID, exactly ten digits. Workspace authorization and write allowlist are independently enforced.",
      },
      campaign_id: {
        ...id,
        description: "Existing campaign ID in account_id.",
      },
      ...(rename
        ? {
            new_name: {
              type: "string",
              minLength: 1,
              maxLength: 255,
              description:
                "Explicit new campaign name; no status or other settings are changed.",
            } satisfies BriefSchema,
          }
        : {
            ad_group_id: {
              ...id,
              description:
                "Existing Google ad group ID belonging to campaign_id; Meta adset IDs are not accepted in this branch.",
            },
          }),
    },
  };
}

export function googleWriteGenericIntent(
  name: string,
  args: unknown,
): { account_id: string; intent: Stage4Intent } | null {
  const schema = googleWriteGenericSchema(name);
  if (!schema) return null;
  validateBriefSchema(args, schema, "arguments");
  const row = args as Record<string, string>;
  if (row.new_name !== undefined && !row.new_name.trim())
    extFail("google_generic_input_invalid", "Название не может быть пустым.");
  const rename = name === "preview_change_campaign_name";
  return {
    account_id: row.account_id!,
    intent: {
      provider: "GOOGLE_ADS",
      account_id: row.account_id!,
      action: rename ? "campaign_update" : "ad_group_update",
      items: [
        {
          campaign_id: row.campaign_id!,
          ...(rename
            ? { name: row.new_name! }
            : {
                ad_group_id: row.ad_group_id!,
                status:
                  name === "preview_pause_adset_or_group"
                    ? "PAUSED"
                    : "ENABLED",
              }),
        },
      ],
    },
  };
}

/** Validate the route query before dispatch; unknown profiles never fall back. */
export function googleWriteProfileName(
  value: unknown,
): typeof GOOGLE_WRITE_PROFILE | undefined {
  if (value === undefined) return undefined;
  if (value !== GOOGLE_WRITE_PROFILE)
    extFail(
      "mcp_profile_invalid",
      "Неизвестный MCP profile; разрешён только google_ads_write.",
    );
  return GOOGLE_WRITE_PROFILE;
}

export type GoogleWriteClientTool = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
};

type ClientSchema = Record<string, unknown>;
const clientString = (description: string, maxLength = 255): ClientSchema => ({
  type: "string",
  minLength: 1,
  maxLength,
  description,
});
const clientEnum = (values: string[], description: string): ClientSchema => ({
  type: "string",
  enum: values,
  description,
});
const clientProvider = clientEnum(
  ["GOOGLE_ADS"],
  "Explicit Google provider. Never inferred from tool name or account shape.",
);
const clientAccount: ClientSchema = {
  ...clientString(
    "Owned external Google customer ID, exactly ten digits; authorization remains server-side.",
    10,
  ),
  pattern: "^[0-9]{10}$",
};
const clientId: ClientSchema = {
  ...clientString(
    "Numeric Google resource ID in the selected owned account.",
    20,
  ),
  pattern: "^[0-9]{1,20}$",
};
const clientDate: ClientSchema = {
  ...clientString(
    "ISO calendar date YYYY-MM-DD; real calendar date and ordered range required.",
    10,
  ),
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$",
  format: "date",
};
const clientCursor = clientString(
  "Opaque cursor returned by this same tool/account/filter query. Never a Google request object.",
  8192,
);
const clientLimit: ClientSchema = {
  type: "integer",
  minimum: 1,
  maximum: 500,
  description:
    "Maximum rows, 1–500; profile rejects overflow rather than relying on provider clamping.",
};
const clientArray = (
  items: ClientSchema,
  maxItems: number,
  description: string,
): ClientSchema => ({
  type: "array",
  minItems: 1,
  maxItems,
  uniqueItems: true,
  items,
  description,
});
const clientObject = (
  properties: Record<string, ClientSchema>,
  required: string[],
  description: string,
): ClientSchema => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
  description,
});
const accountFields = { provider: clientProvider, account_id: clientAccount };
const dateFields = { start_date: clientDate, end_date: clientDate };
const pageFields = { limit: clientLimit, cursor: clientCursor };

/** Exact implemented READ arguments only. No taxonomy/structure/GAQL capability is fabricated. */
function googleClientReadSchema(name: string): ClientSchema | undefined {
  if (name === "list_accounts" || name === "get_provider_capabilities")
    return clientObject(
      { provider: clientProvider },
      ["provider"],
      name === "list_accounts"
        ? "List only authorized stored GOOGLE_ADS account connections; no account discovery outside principal scope."
        : "Read registered GOOGLE_ADS capabilities, not permission or account proof.",
    );
  if (name === "get_account_status")
    return clientObject(
      accountFields,
      ["provider", "account_id"],
      "Read stored account status; does not imply provider health or test_account proof.",
    );
  if (name === "get_account_object")
    return clientObject(
      { ...accountFields, ...dateFields },
      ["provider", "account_id"],
      "Existing account-summary contract only. No object_type, raw resource, arbitrary GAQL or entity catalog.",
    );
  if (["get_campaign", "get_campaign_structure"].includes(name))
    return clientObject(
      { ...accountFields, ...dateFields, campaign_id: clientId },
      [
        "provider",
        "account_id",
        ...(name === "get_campaign" ? ["campaign_id"] : []),
      ],
      name === "get_campaign"
        ? "Read selected normalized Google campaign and metrics."
        : "Existing normalized campaign-list/selected-row compatibility result; not a full ad-group/criterion/asset inventory.",
    );
  if (
    [
      "list_campaigns",
      "list_account_objects",
      "get_google_ads_detailed_report",
    ].includes(name)
  )
    return clientObject(
      {
        ...accountFields,
        ...dateFields,
        ...pageFields,
        ...(name === "list_campaigns"
          ? {
              statuses: clientArray(
                clientEnum(
                  ["ENABLED", "PAUSED", "REMOVED"],
                  "Google campaign status.",
                ),
                3,
                "Optional Google campaign statuses; canonical array spelling only.",
              ),
            }
          : {}),
        ...(name === "get_google_ads_detailed_report"
          ? {
              report_type: clientEnum(
                ["campaign", "campaigns", "campaign_performance"],
                "Only implemented campaign performance report; no unsupported report fields.",
              ),
            }
          : {}),
      },
      ["provider", "account_id"],
      name === "list_account_objects"
        ? "Existing campaign listing only; no ad/asset/general-object catalog is claimed."
        : "Read normalized campaign rows with bounded pagination and optional dates.",
    );
  if (name === "google_ads_list_keywords")
    return clientObject(
      {
        ...accountFields,
        ...pageFields,
        campaign_ids: clientArray(
          clientId,
          200,
          "Campaign filter IDs in selected account.",
        ),
        ad_group_ids: clientArray(
          clientId,
          200,
          "Ad group filter IDs in selected account.",
        ),
        statuses: clientArray(
          clientEnum(
            ["ENABLED", "PAUSED", "REMOVED"],
            "Actual keyword status.",
          ),
          3,
          "Distinct statuses.",
        ),
        since: clientDate,
        until: clientDate,
        date_preset: clientEnum(
          ["last_7d", "last_14d", "last_30d"],
          "Optional existing preset; cannot combine with since/until.",
        ),
        min_cost: {
          type: "number",
          minimum: 0,
          maximum: 9999999999,
          description:
            "Non-negative performance-filter cost in account currency; not a monetary write.",
        },
      },
      ["provider", "account_id"],
      "Read Google positive keyword inventory and bounded metrics; no mutation.",
    );
  if (name === "google_ads_search_terms")
    return clientObject(
      {
        ...accountFields,
        ...pageFields,
        since: clientDate,
        until: clientDate,
        campaign_ids: clientArray(clientId, 200, "Campaign filter IDs."),
        min_cost: {
          type: "number",
          minimum: 0,
          maximum: 9999999999,
          description: "Non-negative account-currency cost filter.",
        },
        contains: clientString("Nonblank search-text substring.", 200),
        only_not_added: {
          type: "boolean",
          description: "Exclude search terms already present as keywords.",
        },
        format: clientEnum(
          ["json"],
          "JSON pagination is implemented; CSV artifact delivery is not implemented.",
        ),
      },
      ["provider", "account_id", "since", "until"],
      "Read search terms for an explicit date range. No export format or provider request fallback.",
    );
  if (name === "google_ads_list_negatives")
    return clientObject(
      {
        ...accountFields,
        ...pageFields,
        campaign_ids: clientArray(clientId, 200, "Campaign filter IDs."),
        levels: clientArray(
          clientEnum(
            ["campaign", "ad_group", "shared_list"],
            "Implemented negative placement.",
          ),
          3,
          "Distinct inventory levels.",
        ),
      },
      ["provider", "account_id"],
      "Read negative keywords, shared lists/members and attachments using existing scoped reader.",
    );
  if (name === "google_ads_check_negative_conflicts")
    return clientObject(
      {
        ...accountFields,
        ...pageFields,
        campaign_ids: clientArray(
          clientId,
          200,
          "Campaign IDs required to scope conflicts.",
        ),
        negatives: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: clientObject(
            {
              text: clientString(
                "Negative text; Google brackets/quotes accepted by existing normalizer.",
                202,
              ),
              match_type: clientEnum(
                ["BROAD", "PHRASE", "EXACT"],
                "Optional match type, compatible with Google text syntax.",
              ),
            },
            ["text"],
            "Typed negative query only; does not create a criterion.",
          ),
        },
      },
      ["provider", "account_id", "campaign_ids", "negatives"],
      "Read conflict candidates; no mutations/validation-only writes.",
    );
  return undefined;
}

/** Narrow ONLY a proven top-level Google provider branch, never an arbitrary first oneOf row. */
function googleOnlySchema(schema: ClientSchema): ClientSchema {
  const properties = schema.properties as
    Record<string, ClientSchema> | undefined;
  const provider = properties?.provider;
  const proven =
    provider?.const === "GOOGLE_ADS" ||
    (Array.isArray(provider?.enum) &&
      provider.enum.length === 1 &&
      provider.enum[0] === "GOOGLE_ADS");
  if (schema.additionalProperties === false && proven)
    return structuredClone(schema);
  const candidates = (Array.isArray(schema.oneOf) ? schema.oneOf : []).filter(
    (value) => {
      const branch = value as ClientSchema,
        p = (branch.properties as Record<string, ClientSchema> | undefined)
          ?.provider;
      return (
        branch.additionalProperties === false &&
        (p?.const === "GOOGLE_ADS" ||
          (Array.isArray(p?.enum) &&
            p.enum.length === 1 &&
            p.enum[0] === "GOOGLE_ADS"))
      );
    },
  );
  if (candidates.length !== 1)
    extFail(
      "mcp_profile_schema_invalid",
      "Нет единственной доказанной закрытой Google schema branch.",
    );
  return structuredClone(candidates[0] as ClientSchema);
}

/** Google-only client schema. The default registry and all legacy/Public contracts are untouched. */
export function googleWriteProfileInputSchema(
  tool: string | GoogleWriteClientTool,
): ClientSchema | undefined {
  const name = typeof tool === "string" ? tool : tool.name;
  if (!GOOGLE_WRITE_PROFILE_TOOLS.includes(name)) return undefined;
  let schema: ClientSchema | undefined = googleClientReadSchema(name);
  schema ??= trackingAuditToolSchema(name) as ClientSchema | undefined;
  if (name === "commit_preview")
    schema = clientObject(
      {
        preview_token: {
          ...clientString(
            "Exact opaque stored preview token from this principal/account; server must prove GOOGLE_ADS ownership and persisted manual approval.",
            125,
          ),
          pattern: "^hmpp_[A-Za-z0-9_-]{20,120}$",
        },
      },
      ["preview_token"],
      "Immutable commit accepts ONLY the stored preview token; no replacement fields, confirmation boolean or account override.",
    );
  schema ??= googleWriteGenericSchema(name) as ClientSchema | undefined;
  schema ??= stage2AdvancedToolSchema(name);
  schema ??= stage3ToolSchema(name);
  schema ??= stage4ToolSchema(name) as ClientSchema | undefined;
  schema ??= stage2ToolSchema(name);
  schema ??= stage0ToolSchema(name);
  schema ??= stage1ToolSchema(name);
  schema ??= keywordStatusToolSchema(name);
  if (!schema)
    extFail(
      "mcp_profile_schema_invalid",
      "В Google profile нет доказанного typed schema для инструмента.",
    );
  // Stored commit/rollback IDs contain no caller-selected provider/account.
  const result = ["commit_preview", "preview_rollback_commit"].includes(name)
    ? structuredClone(schema)
    : googleOnlySchema(schema);
  const properties = result.properties as Record<string, ClientSchema>;
  if ((GOOGLE_TRACKING_AUDIT_TOOLS as readonly string[]).includes(name)) {
    properties.limit = { ...properties.limit, type: "integer" };
    for (const field of ["campaign_ids", "ad_group_ids"])
      properties[field] = { ...properties[field], uniqueItems: true };
  }
  if (properties?.account_id)
    properties.account_id = structuredClone(clientAccount);
  if (properties?.provider)
    properties.provider = structuredClone(clientProvider);
  if (name === "list_change_journal") {
    for (const key of ["from", "to"])
      properties[key] = { ...properties[key], maxLength: 40 };
    properties.actor_user_id = {
      ...properties.actor_user_id,
      minLength: 36,
      maxLength: 36,
    };
    properties.operation = { ...properties.operation, minLength: 1 };
    properties.cursor = { ...properties.cursor, minLength: 47, maxLength: 47 };
  }
  return result;
}

type SchemaIssue = { path: string; reason: string };
const unknownFieldPath = (path: string, key: string) =>
  /^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(key)
    ? `${path}.${key}`
    : `${path}["<invalid-key>"]`;
function jsonObject(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
const equalJson = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b))
    return a.length === b.length && a.every((v, i) => equalJson(v, b[i]));
  if (jsonObject(a) && jsonObject(b))
    return (
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every((k) => Object.hasOwn(b, k) && equalJson(a[k], b[k]))
    );
  return false;
};
/** Bounded interpreter for assertion keywords used by the imported, trusted schemas; no remote $ref evaluation. */
function schemaIssue(
  value: unknown,
  schema: ClientSchema,
  path: string,
  depth = 0,
): SchemaIssue | undefined {
  const fail = (reason: string) => ({ path, reason });
  if (depth > 40) return fail("Превышена допустимая вложенность.");
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (
    schema.type !== undefined &&
    !types.some((t) =>
      t === "null"
        ? value === null
        : t === "array"
          ? Array.isArray(value)
          : t === "object"
            ? jsonObject(value)
            : t === "integer"
              ? typeof value === "number" && Number.isSafeInteger(value)
              : typeof value === t,
    )
  )
    return fail("Неверный тип.");
  if (Object.hasOwn(schema, "const") && !equalJson(value, schema.const))
    return fail("Неверное фиксированное значение.");
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((v) => equalJson(v, value))
  )
    return fail("Значение вне допустимого enum.");
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (typeof schema.minimum === "number" && value < schema.minimum) ||
      (typeof schema.maximum === "number" && value > schema.maximum))
  )
    return fail("Число вне допустимого диапазона.");
  if (typeof value === "string") {
    const length = [...value].length;
    if (
      /\p{Cc}/u.test(value) ||
      (typeof schema.minLength === "number" && length < schema.minLength) ||
      (typeof schema.maxLength === "number" && length > schema.maxLength) ||
      (typeof schema.pattern === "string" &&
        !new RegExp(schema.pattern).test(value))
    )
      return fail("Неверная длина/формат строки.");
    if (
      schema.format === "date" &&
      (!Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
        new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value)
    )
      return fail("Недействительная календарная дата.");
    if (
      schema.format === "date-time" &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      ) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(`${value.slice(0, 10)}T00:00:00Z`)
          .toISOString()
          .slice(0, 10) !== value.slice(0, 10))
    )
      return fail("Требуется ISO timestamp.");
    if (
      schema.format === "uuid" &&
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
        value,
      )
    )
      return fail("Требуется UUID.");
  }
  if (jsonObject(value)) {
    const properties = (schema.properties ?? {}) as Record<
      string,
      ClientSchema
    >;
    if (schema.additionalProperties === false)
      for (const key of Object.keys(value))
        if (!Object.hasOwn(properties, key))
          return {
            path: unknownFieldPath(path, key),
            reason: "Неизвестное поле запрещено.",
          };
    for (const key of (schema.required ?? []) as string[])
      if (!Object.hasOwn(value, key) || value[key] === undefined)
        return {
          path: `${path}.${key}`,
          reason: "Обязательное поле отсутствует.",
        };
    for (const [key, child] of Object.entries(properties))
      if (Object.hasOwn(value, key)) {
        const issue = schemaIssue(
          value[key],
          child,
          `${path}.${key}`,
          depth + 1,
        );
        if (issue) return issue;
      }
  }
  if (Array.isArray(value)) {
    if (
      (typeof schema.minItems === "number" && value.length < schema.minItems) ||
      (typeof schema.maxItems === "number" && value.length > schema.maxItems)
    )
      return fail("Массив вне допустимого размера.");
    if (
      schema.uniqueItems === true &&
      value.some((v, i) => value.slice(0, i).some((x) => equalJson(x, v)))
    )
      return fail("Повторяющиеся элементы запрещены.");
    if (schema.items)
      for (const [i, v] of value.entries()) {
        const issue = schemaIssue(
          v,
          schema.items as ClientSchema,
          `${path}[${i}]`,
          depth + 1,
        );
        if (issue) return issue;
      }
  }
  for (const branch of (schema.allOf ?? []) as ClientSchema[]) {
    const issue = schemaIssue(value, branch, path, depth + 1);
    if (issue) return issue;
  }
  for (const keyword of ["oneOf", "anyOf"] as const)
    if (Array.isArray(schema[keyword])) {
      const issues = (schema[keyword] as ClientSchema[]).map((s) =>
          schemaIssue(value, s, path, depth + 1),
        ),
        count = issues.filter((i) => !i).length;
      if (
        (keyword === "oneOf" && count !== 1) ||
        (keyword === "anyOf" && count === 0)
      )
        return (
          issues
            .filter((i): i is SchemaIssue => !!i)
            .sort((a, b) => b.path.length - a.path.length)[0] ??
          fail("Нет однозначного допустимого варианта.")
        );
    }
  if (
    schema.not &&
    !schemaIssue(value, schema.not as ClientSchema, path, depth + 1)
  )
    return fail("Запрещённое сочетание полей.");
  if (schema.if) {
    const branch = !schemaIssue(
      value,
      schema.if as ClientSchema,
      path,
      depth + 1,
    )
      ? schema.then
      : schema.else;
    if (branch)
      return schemaIssue(value, branch as ClientSchema, path, depth + 1);
  }
  return undefined;
}

/** Pure pre-dispatch validation; never ownership proof, human approval or provider execution. */
export function validateGoogleWriteProfileArguments(
  name: string,
  args: unknown,
): void {
  const schema = googleWriteProfileInputSchema(name);
  const reject = (path: string, reason: string): never => {
    throw new GoogleAdsWriteError(
      "google_client_arguments_invalid",
      `Неверное поле ${path}: ${reason}`,
      [],
      path,
    );
  };
  if (!schema)
    return reject(
      "arguments.tool",
      "Инструмент недоступен в Google Ads profile.",
    );
  const issue = schemaIssue(args, schema, "arguments");
  if (issue) reject(issue.path, issue.reason);
  const row = args as Record<string, unknown>;
  if ((GOOGLE_TRACKING_AUDIT_TOOLS as readonly string[]).includes(name))
    trackingAuditToolArguments(name, row);
  const ownedResources = (value: unknown, path: string, depth = 0): void => {
    if (depth > 40) reject(path, "Превышена допустимая вложенность.");
    if (
      typeof value === "string" &&
      typeof row.account_id === "string" &&
      /\.(?:resource_name|resourceName|[a-z_]+_resource(?:_name)?)(?:\[\d+\])?$/.test(
        path,
      )
    ) {
      const customer = /^customers\/([0-9]{10})(?:\/|$)/.exec(value)?.[1];
      if (customer && customer !== row.account_id)
        reject(
          path,
          "Google resource относится к другому выбранному аккаунту.",
        );
    } else if (Array.isArray(value))
      value.forEach((v, i) => ownedResources(v, `${path}[${i}]`, depth + 1));
    else if (jsonObject(value))
      for (const [key, v] of Object.entries(value))
        ownedResources(v, `${path}.${key}`, depth + 1);
  };
  ownedResources(args, "arguments");
  const rangePairs = [
    ...([
      "list_campaigns",
      "get_campaign",
      "get_campaign_structure",
      "get_account_object",
      "list_account_objects",
      "get_google_ads_detailed_report",
    ].includes(name)
      ? [["start_date", "end_date"]]
      : []),
    ["since", "until"],
    ["from", "to"],
  ];
  for (const [start, end] of rangePairs) {
    const a = row[start!],
      b = row[end!];
    if (start !== "from" && (a !== undefined) !== (b !== undefined))
      reject(
        `arguments.${a === undefined ? start : end}`,
        "Границы даты должны передаваться вместе.",
      );
    if (
      typeof a === "string" &&
      typeof b === "string" &&
      (start === "from" ? Date.parse(a) > Date.parse(b) : a > b)
    )
      reject(`arguments.${end}`, "Конец диапазона раньше начала.");
  }
  if (
    row.date_preset !== undefined &&
    (row.since !== undefined || row.until !== undefined)
  )
    reject("arguments.date_preset", "Нельзя сочетать preset и явные даты.");
  if (
    name === "google_ads_search_terms" &&
    typeof row.contains === "string" &&
    !row.contains.trim()
  )
    reject("arguments.contains", "Строка не может состоять из пробелов.");
  // Existing pure intent parsers add action-specific constraints, never a parallel provider flow.
  googleWriteGenericIntent(name, args);
  stage1ToolIntent(name, row);
  stage2ToolIntent(name, row);
  if (GOOGLE_STAGE2_ADVANCED_TOOLS.includes(name))
    stage2AdvancedToolIntent(name, row);
  if (GOOGLE_STAGE3_TOOLS.includes(name)) stage3ToolIntent(name, row);
  if (
    GOOGLE_STAGE4_TOOLS.includes(name as (typeof GOOGLE_STAGE4_TOOLS)[number])
  )
    parseStage4Intent(row);
  if (name === "create_campaign_from_brief") normalizeBrief(args);
}

/** Registry selection only: this is not authentication or an account allowlist. */
export function googleWriteToolProfile<T extends GoogleWriteClientTool>(
  tools: readonly T[],
): T[] {
  if (!Array.isArray(tools) || tools.length > 1000)
    extFail(
      "mcp_profile_registry_invalid",
      "Некорректный размер tool registry.",
    );
  const seen = new Set<string>();
  return tools
    .filter((tool) => GOOGLE_WRITE_PROFILE_TOOLS.includes(tool.name))
    .map((tool) => {
      if (seen.has(tool.name))
        extFail(
          "mcp_profile_registry_invalid",
          "Tool registry содержит дублирующее имя.",
        );
      seen.add(tool.name);
      if (seen.size > 50)
        extFail(
          "mcp_profile_registry_invalid",
          "Google client profile ограничен 50 инструментами.",
        );
      const read = (readTools as readonly string[]).includes(tool.name);
      return {
        ...tool,
        inputSchema: googleWriteProfileInputSchema(tool)!,
        annotations: {
          ...tool.annotations,
          readOnlyHint: read,
          destructiveHint: [
            "commit_preview",
            "preview_rollback_commit",
            "preview_delete_or_archive_object",
          ].includes(tool.name),
          openWorldHint: true,
        },
      };
    });
}

function serverBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    extFail("mcp_openapi_base_invalid", "OpenAPI base должен быть URL.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "") ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    extFail(
      "mcp_openapi_base_invalid",
      "OpenAPI base: HTTPS origin либо локальный HTTP; credentials/query/path запрещены.",
    );
  return url.origin;
}

/** Describe private routes only. No endpoint execution or credential generation. */
export function googleWriteOpenApi(
  tools: readonly GoogleWriteClientTool[],
  base: string,
): Record<string, unknown> {
  const profile = googleWriteToolProfile(tools);
  const resultSchema = {
    type: "object",
    additionalProperties: false,
    required: ["content"],
    properties: {
      structuredContent: {
        type: "object",
        description:
          "Existing authorized tool result: sanitized plan, resource IDs, warnings and structured errors. No provider credentials or raw HTTP headers.",
      },
      content: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["type", "text"],
          properties: { type: { const: "text" }, text: { type: "string" } },
        },
      },
      isError: { type: "boolean" },
    },
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "HolyMedia private Google Ads controlled-write facade",
      version: "1.0.0",
      description:
        "Same authorized MCP tools and exact input schemas, not a new write API. Previews do not mutate Google; commits require persisted manual browser approval. Feature gates/ownership/allowlist/stale checks remain unchanged.",
    },
    servers: [{ url: serverBase(base) }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
    },
    paths: Object.fromEntries(
      profile.map((tool) => [
        `/api/v1/mcp/rest/${tool.name}`,
        {
          post: {
            operationId: tool.name,
            description: tool.description ?? "Authorized existing MCP tool.",
            "x-mcp-tool-name": tool.name,
            "x-mcp-annotations": tool.annotations,
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: structuredClone(tool.inputSchema),
                },
              },
            },
            responses: {
              "200": {
                description:
                  "Sanitized MCP tool result. isError/structured errors may indicate rejection; HTTP success alone is not provider verification.",
                content: { "application/json": { schema: resultSchema } },
              },
              "401": { description: "Missing/invalid/revoked authentication." },
              "403": {
                description:
                  "Insufficient scope, ownership, write gate, allowlist or profile permission.",
              },
              "429": { description: "Existing quota or rate limit exceeded." },
            },
          },
        },
      ]),
    ),
  };
}

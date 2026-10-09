import { extFail } from "../providers/google-ads-extended-plan.js";
import type { Stage4Intent } from "../providers/google-ads-stage4.js";
import {
  validateBriefSchema,
  type BriefSchema,
} from "./mcp-google-stage0-schema.js";
import { GOOGLE_STAGE1_TOOLS } from "./mcp-google-stage1-schema.js";
import { GOOGLE_STAGE2_TOOLS } from "./mcp-google-stage2-schema.js";
import { GOOGLE_STAGE2_ADVANCED_TOOLS } from "./mcp-google-stage2-advanced-schema.js";
import { GOOGLE_STAGE3_TOOLS } from "./mcp-google-stage3-schema.js";
import { GOOGLE_STAGE4_TOOLS } from "./mcp-google-stage4-schema.js";

export const GOOGLE_WRITE_PROFILE = "google_ads_write";
export const GOOGLE_WRITE_GENERIC_TOOLS = [
  "preview_change_campaign_name",
  "preview_pause_adset_or_group",
  "preview_resume_adset_or_group",
] as const;

const readTools = [
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
      const read = (readTools as readonly string[]).includes(tool.name);
      return {
        ...tool,
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

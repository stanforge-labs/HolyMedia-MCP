/** Explicit public surface. Never derive this from the legacy MCP registry. */
export const PUBLIC_READ_TOOLS = [
  "list_connected_resources",
  "list_ad_accounts",
  "get_account_status",
  "get_account_summary",
  "run_connection_diagnostics",
  "list_campaigns",
  "get_campaign",
  "get_campaign_statuses",
  "get_basic_metrics",
  "get_performance_report",
  "get_spend_overview",
  "get_status_summary",
  "get_top_performers",
  "get_campaign_structure",
  "get_google_ads_detailed_report",
  "get_meta_ads_detailed_report",
  "get_meta_oauth_permissions",
  "get_flexible_insights",
  "google_analytics_list_properties",
  "google_analytics_get_property",
  "google_analytics_run_report",
  "google_analytics_check_compatibility",
  "google_analytics_traffic_overview",
  "google_analytics_acquisition",
  "google_analytics_landing_pages",
  "google_analytics_pages",
  "google_analytics_events",
  "google_analytics_key_events",
  "google_analytics_devices",
  "google_analytics_geography",
  "google_analytics_realtime",
  "google_analytics_compare_periods",
  "google_analytics_list_google_ads_links",
  "google_analytics_get_custom_dimensions_metrics",
  "get_search_console_report",
  "list_search_console_properties",
  "compare_periods",
  "generate_monthly_ads_report",
] as const;

export const PUBLIC_WRITE_TOOLS = [
  "preview_change_campaign_name",
  "preview_pause_campaign",
  "preview_resume_campaign",
  "commit_confirmed_preview",
] as const;

export const PUBLIC_TOOL_NAMES = [
  ...PUBLIC_READ_TOOLS,
  ...PUBLIC_WRITE_TOOLS,
] as const;

const publicReadSet = new Set<string>(PUBLIC_READ_TOOLS);
const publicWriteSet = new Set<string>(PUBLIC_WRITE_TOOLS);
const workspaceOnlyReads = new Set<string>([
  "list_connected_resources",
  "list_ad_accounts",
  "get_account_status",
]);
// Preview performs a provider READ before persisting a local preview. Commit
// performs a provider WRITE. Browser approval is not an MCP tool.
const providerFacingWrites = new Set<string>([
  "preview_change_campaign_name",
  "preview_pause_campaign",
  "preview_resume_campaign",
  "commit_confirmed_preview",
]);
const publicWriteDescriptions: Record<string, string> = {
  preview_change_campaign_name:
    "Create a Meta Ads campaign rename preview without changing the campaign. Return the before/requested name, expiry and a HolyMedia URL for the user to approve in their browser.",
  preview_pause_campaign:
    "Create a Meta Ads campaign pause preview without changing the campaign. Return the before/requested status, expiry and a HolyMedia URL for browser approval.",
  preview_resume_campaign:
    "Create a Meta Ads campaign resume preview without changing the campaign. Return the before/requested status, expiry and a HolyMedia URL for browser approval.",
  commit_confirmed_preview:
    "Execute a previously previewed Meta Ads campaign change only after separate HolyMedia browser approval. Accept only the exact preview_token; mutation fields cannot be supplied or changed here.",
};

export function isPublicReadTool(name: string): boolean {
  return publicReadSet.has(name);
}

export function isPublicWriteTool(name: string): boolean {
  return publicWriteSet.has(name);
}

export function isPublicTool(name: string): boolean {
  return isPublicReadTool(name) || isPublicWriteTool(name);
}

type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

function title(name: string): string {
  return name
    .split("_")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

function publicWriteSchema(name: string): Record<string, unknown> {
  if (name === "commit_confirmed_preview") {
    return {
      type: "object",
      additionalProperties: false,
      required: ["preview_token"],
      properties: { preview_token: { type: "string" } },
    };
  }
  const rename = name === "preview_change_campaign_name";
  return {
    type: "object",
    additionalProperties: false,
    required: rename
      ? ["account_id", "campaign_id", "new_name"]
      : ["account_id", "campaign_id"],
    properties: {
      account_id: { type: "string" },
      campaign_id: { type: "string" },
      ...(rename ? { new_name: { type: "string", maxLength: 255 } } : {}),
    },
  };
}

export function publicTools(legacyTools: ToolDescriptor[]) {
  const existing = new Map(legacyTools.map((tool) => [tool.name, tool]));
  return PUBLIC_TOOL_NAMES.map((name) => {
    const legacy = existing.get(name);
    if (!legacy && !isPublicWriteTool(name))
      throw new Error(`Public MCP tool ${name} is not implemented.`);
    const read = isPublicReadTool(name);
    const diagnostics = name === "run_connection_diagnostics";
    const commit = name === "commit_confirmed_preview";
    return {
      name,
      title: title(name),
      description: read ? legacy!.description : publicWriteDescriptions[name]!,
      inputSchema: read ? legacy!.inputSchema : publicWriteSchema(name),
      annotations: {
        title: title(name),
        readOnlyHint: read && !diagnostics,
        destructiveHint: commit,
        openWorldHint: read
          ? !workspaceOnlyReads.has(name)
          : providerFacingWrites.has(name),
        idempotentHint: read && !diagnostics,
      },
    };
  });
}

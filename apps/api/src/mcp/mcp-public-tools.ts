/** Explicit public surface. Never derive this from the legacy MCP registry. */
import { publicReadInputSchema } from "./mcp-public-read-contract.js";
export const PUBLIC_READ_TOOLS = [
  "list_connected_resources",
  "list_ad_accounts",
  "get_account_status",
  "get_account_summary",
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
  "google_ads_list_keywords",
  "google_ads_search_terms",
  "google_ads_list_negatives",
  "google_ads_check_negative_conflicts",
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

/** Directory-facing descriptions are explicit about scope and side effects.
 * Keep these narrower than the legacy/private MCP compatibility descriptions. */
const publicReadDescriptions: Record<
  (typeof PUBLIC_READ_TOOLS)[number],
  string
> = {
  list_connected_resources:
    "Lists enabled advertising accounts, GA4 properties and Search Console properties in the authenticated workspace. This is stored connection inventory, not a live provider check.",
  list_ad_accounts:
    "Lists enabled Google Ads, Meta Ads, TikTok Ads and Yandex Direct accounts in the authenticated workspace. This is stored account metadata, not proof of live provider access.",
  get_account_status:
    "Returns the selected account's stored connection status from the HolyPilot database (v2_database_provider_account). It does not call the provider or prove that OAuth is currently valid.",
  get_account_summary:
    "Reads a summary for one selected advertising account, with an optional date range. Provider data requires an authorized, available connection.",
  list_campaigns:
    "Lists paginated campaigns and available metrics for one selected advertising account and optional date range. Google Ads manager accounts cannot return client campaign metrics directly.",
  get_campaign:
    "Reads details and available period metrics for one selected campaign in an authorized advertising account.",
  get_campaign_statuses:
    "Reads campaign status information for one selected advertising account and optional date range.",
  get_basic_metrics:
    "Reads impressions, clicks, spend, conversions and other available aggregate metrics for one selected advertising account and required date range.",
  get_performance_report:
    "Returns an account performance summary with available campaign metrics for a required date range. A provider connection and reporting entitlement may be required.",
  get_spend_overview:
    "Reads spend totals and available breakdowns for one selected advertising account and optional date range; it does not change budgets.",
  get_status_summary:
    "Summarizes the statuses of campaigns in one selected advertising account, with optional period data.",
  get_top_performers:
    "Ranks available campaigns by a selected returned metric in one authorized advertising account. The ranking is observational, not a recommendation to mutate campaigns.",
  get_campaign_structure:
    "Reads the settings and structure of one selected campaign, including available budget and status information; it does not modify the campaign.",
  get_google_ads_detailed_report:
    "Reads a paginated Google Ads campaign performance report for one selected client account and optional date range. Manager-account campaign metrics are unavailable directly.",
  google_ads_list_keywords:
    "Lists paginated Google Ads keywords and available period metrics, including keywords with zero traffic, in one authorized client account.",
  google_ads_search_terms:
    "Lists paginated Google Ads search-term rows and available metrics for a selected client account and date range. Google may withhold some queries; CSV file delivery is unavailable.",
  google_ads_list_negatives:
    "Lists paginated Google Ads campaign, ad-group and shared-list negative keywords and their attachments in one authorized client account.",
  google_ads_check_negative_conflicts:
    "Checks proposed Google Ads negative keywords against enabled positive keywords in selected campaigns. Text matching excludes Google close variants and does not add negatives.",
  get_meta_ads_detailed_report:
    "Reads a detailed Meta Ads insights report for one selected authorized ad account, using the report type and period in the tool arguments.",
  get_meta_oauth_permissions:
    "Returns requested, granted, declined and missing Meta OAuth permissions for the authenticated workspace's connection. It does not modify Meta assets or permissions.",
  get_flexible_insights:
    "Reads Meta Ads insights at account or campaign level for one selected authorized ad account, with optional period and filters.",
  google_analytics_list_properties:
    "Lists enabled Google Analytics 4 properties accessible in the authenticated workspace; listing alone does not prove live Data API access.",
  google_analytics_get_property:
    "Reads metadata for one selected enabled Google Analytics 4 property in the authenticated workspace.",
  google_analytics_run_report:
    "Runs a bounded Google Analytics 4 Data API report for one enabled property using requested dimensions and metrics. Data API reference: https://developers.google.com/analytics/devguides/reporting/data/v1.",
  google_analytics_check_compatibility:
    "Checks whether selected Google Analytics 4 dimensions and metrics are compatible for one enabled property. Data API reference: https://developers.google.com/analytics/devguides/reporting/data/v1.",
  google_analytics_traffic_overview:
    "Reads the traffic overview for one enabled Google Analytics 4 property and selected period.",
  google_analytics_acquisition:
    "Reads acquisition channels and available traffic metrics for one enabled Google Analytics 4 property and selected period.",
  google_analytics_landing_pages:
    "Reads landing-page performance for one enabled Google Analytics 4 property and selected period.",
  google_analytics_pages:
    "Reads page performance for one enabled Google Analytics 4 property and selected period.",
  google_analytics_events:
    "Reads events and available counts for one enabled Google Analytics 4 property and selected period.",
  google_analytics_key_events:
    "Reads key events and available counts for one enabled Google Analytics 4 property and selected period.",
  google_analytics_devices:
    "Reads device-category traffic metrics for one enabled Google Analytics 4 property and selected period.",
  google_analytics_geography:
    "Reads geographic traffic metrics for one enabled Google Analytics 4 property and selected period.",
  google_analytics_realtime:
    "Reads available realtime metrics for one enabled Google Analytics 4 property; realtime coverage differs from historical reports.",
  google_analytics_compare_periods:
    "Compares two requested periods for one enabled Google Analytics 4 property using available Data API metrics.",
  google_analytics_list_google_ads_links:
    "Lists Google Ads links configured for one enabled Google Analytics 4 property; link metadata does not grant access to an Ads account.",
  google_analytics_get_custom_dimensions_metrics:
    "Lists available custom dimensions and metrics for one enabled Google Analytics 4 property.",
  get_search_console_report:
    "Reads Search Console clicks, impressions, CTR and position for one authorized property and requested number of days. Results depend on the property's available data.",
  list_search_console_properties:
    "Lists Search Console properties authorized for the authenticated workspace without exposing properties from other workspaces.",
  compare_periods:
    "Compares available advertising metrics for two explicitly dated periods in one selected authorized account; differences do not establish causation.",
  generate_monthly_ads_report:
    "Generates an in-response advertising performance report from one authorized account and selected period. Provider access and reporting entitlement are required; no downloadable file is implied.",
};

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

/** Listing and invocation must apply the same public exposure policy. */
export function isPublicToolAvailable(
  name: string,
  writeScopeEnabled = false,
): boolean {
  return (
    isPublicReadTool(name) || (writeScopeEnabled && isPublicWriteTool(name))
  );
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

export function publicTools(
  legacyTools: ToolDescriptor[],
  writeScopeEnabled = false,
) {
  const existing = new Map(legacyTools.map((tool) => [tool.name, tool]));
  const availableNames = PUBLIC_TOOL_NAMES.filter((name) =>
    isPublicToolAvailable(name, writeScopeEnabled),
  );
  return availableNames.map((name) => {
    const legacy = existing.get(name);
    if (!legacy && !isPublicWriteTool(name))
      throw new Error(`Public MCP tool ${name} is not implemented.`);
    const read = isPublicReadTool(name);
    const commit = name === "commit_confirmed_preview";
    return {
      name,
      title: title(name),
      description: read
        ? publicReadDescriptions[name as (typeof PUBLIC_READ_TOOLS)[number]]
        : publicWriteDescriptions[name]!,
      inputSchema: read
        ? (publicReadInputSchema(name) ?? legacy!.inputSchema)
        : publicWriteSchema(name),
      annotations: {
        title: title(name),
        readOnlyHint: read,
        destructiveHint: commit,
        openWorldHint: read
          ? !workspaceOnlyReads.has(name)
          : providerFacingWrites.has(name),
        idempotentHint: read,
      },
    };
  });
}

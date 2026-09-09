import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { ProviderId } from "@holymedia/contracts";
import type {
  ProviderCampaign,
  ProviderMetricSummary,
} from "@holymedia/contracts";
import { ProviderService } from "../providers/provider.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { ReportService } from "../reports/report.service.js";
import { McpPreviewService } from "./mcp-preview.service.js";
import { PreviewError } from "./mcp-preview.error.js";
import { SiteAnalysisService } from "../site-analysis/site-analysis.service.js";
import { BillingService } from "../billing/billing.service.js";

const providerAliases: Record<string, ProviderId> = {
  google_ads: "GOOGLE_ADS",
  google_analytics: "GOOGLE_ANALYTICS",
  meta_ads: "META_ADS",
  google_search_console: "GOOGLE_SEARCH_CONSOLE",
  yandex_direct: "YANDEX_DIRECT",
  tiktok_ads: "TIKTOK_ADS",
};

export const V1_COMPATIBLE_MCP_TOOLS = [
  "analyze_audiences",
  "analyze_site_improvements",
  "archive_entities_preview",
  "audit_account",
  "audit_links_and_utms",
  "clone_ad_preview",
  "clone_adset_preview",
  "clone_campaign_preview",
  "collect_report_skill",
  "commit_meta_app_review_preview",
  "commit_meta_confirmed_write",
  "commit_preview",
  "compare_creatives",
  "compare_periods",
  "configure_schedule_from_brief",
  "create_ab_test_ads_preview",
  "create_ad_from_brief",
  "create_ad_group_from_brief",
  "create_ad_in_existing_adset_preview",
  "create_adset_in_campaign_preview",
  "create_audience_from_brief",
  "create_audience_variant_preview",
  "create_campaign_from_brief",
  "create_creative_preview",
  "create_engagement_campaign_preview",
  "create_keyword_from_brief",
  "create_lead_campaign_preview",
  "create_whatsapp_traffic_campaign_preview",
  "describe_auth",
  "describe_auth_strategy",
  "detect_anomalies",
  "disable_candidates_skill",
  "duplicate_campaign_with_audience_preview",
  "duplicate_campaign_with_geo_preview",
  "enable_entities_preview",
  "estimate_budget_days_remaining",
  "find_burnout_ads",
  "find_wasting_spend",
  "generate_monthly_ads_report",
  "get_account_object",
  "get_account_status",
  "get_account_summary",
  "get_asset_health",
  "get_basic_metrics",
  "get_beta_diagnostics",
  "get_billing_summary",
  "get_breakdown_preset",
  "get_campaign",
  "get_campaign_statuses",
  "get_campaign_structure",
  "get_connected_assets",
  "get_conversion_health",
  "get_delivery_issues",
  "get_executive_summary",
  "get_flexible_insights",
  "get_google_ads_detailed_report",
  "get_launch_checklist",
  "get_meta_ads_detailed_report",
  "get_meta_business",
  "get_meta_oauth_permissions",
  "get_meta_page",
  "get_minimum_budgets_read",
  "get_no_result_entities",
  "get_object",
  "get_page_instagram_account",
  "get_page_post",
  "get_page_post_engagement",
  "get_performance_report",
  "get_policy_issues",
  "get_provider_capabilities",
  "get_reach_estimate_read",
  "get_recommendations_read",
  "get_rule_history",
  "get_spend_overview",
  "get_status_summary",
  "get_top_performers",
  "get_tracking_specs",
  "list_account_objects",
  "list_accounts",
  "list_ad_accounts",
  "list_automated_rules",
  "list_business_ad_accounts",
  "list_business_pages",
  "list_campaigns",
  "list_connected_platforms",
  "list_creative_assets",
  "list_detailed_ad_report_types",
  "list_lead_forms",
  "list_meta_businesses",
  "list_meta_pages",
  "list_objects",
  "list_operator_skills",
  "list_page_posts",
  "list_providers",
  "list_supported_audience_types",
  "list_supported_campaign_types",
  "list_supported_dimensions",
  "list_supported_metrics",
  "list_supported_objects",
  "pause_entities_preview",
  "pause_underperformers_preview",
  "preview_change_adset_or_group_budget",
  "preview_change_campaign_budget",
  "preview_change_campaign_name",
  "preview_create_object",
  "preview_delete_or_archive_object",
  "preview_meta_create_ad",
  "preview_meta_create_adset",
  "preview_meta_create_campaign",
  "preview_meta_create_creative",
  "preview_meta_update_ad",
  "preview_meta_update_adset",
  "preview_meta_update_campaign",
  "preview_pause_ad",
  "preview_pause_adset_or_group",
  "preview_pause_campaign",
  "preview_resume_ad",
  "preview_resume_adset_or_group",
  "preview_resume_campaign",
  "preview_update_object",
  "rank_top_entities",
  "rebalance_budget_to_end_of_month_preview",
  "replace_ad_creative_preview",
  "run_connection_diagnostics",
  "run_diagnostics",
  "scale_best_campaigns_preview",
  "scale_candidates_skill",
  "scale_winners_by_rule_preview",
  "search_targeting",
  "summarize_budget_skill",
  "update_adset_budget_preview",
  "update_campaign_budget_preview",
  "update_entity_status_preview",
  "update_placements_preview",
  "update_targeting_preview",
  // V2 extensions retained alongside the exact V1 surface.
  "analyze_site",
  "confirm_preview",
  "get_detailed_ad_report_types",
  "get_search_console_report",
  "list_search_console_properties",
  // Native GA4 tools. These are deliberately narrow, read-only Data/Admin API
  // operations instead of exposing an unbounded generic Google request proxy.
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
] as const;

const COMPAT_PREVIEW_OPERATIONS: Record<string, string> = {
  archive_entities_preview: "archive_entities",
  clone_ad_preview: "clone_ad",
  clone_adset_preview: "clone_adset",
  clone_campaign_preview: "clone_campaign",
  configure_schedule_from_brief: "configure_schedule",
  create_ab_test_ads_preview: "create_ab_test_ads",
  create_ad_from_brief: "create_ad",
  create_ad_group_from_brief: "create_ad_group",
  create_ad_in_existing_adset_preview: "create_ad",
  create_adset_in_campaign_preview: "create_adset",
  create_audience_from_brief: "create_audience",
  create_audience_variant_preview: "create_audience_variant",
  create_campaign_from_brief: "create_campaign",
  create_creative_preview: "create_creative",
  create_engagement_campaign_preview: "create_campaign",
  create_keyword_from_brief: "create_keyword",
  create_lead_campaign_preview: "create_campaign",
  create_whatsapp_traffic_campaign_preview: "create_campaign",
  duplicate_campaign_with_audience_preview: "clone_campaign",
  duplicate_campaign_with_geo_preview: "clone_campaign",
  enable_entities_preview: "resume",
  pause_entities_preview: "pause",
  pause_underperformers_preview: "pause",
  preview_change_adset_or_group_budget: "change_budget",
  preview_create_object: "create_object",
  preview_delete_or_archive_object: "archive_object",
  preview_meta_create_ad: "create_ad",
  preview_meta_create_adset: "create_adset",
  preview_meta_create_campaign: "create_campaign",
  preview_meta_create_creative: "create_creative",
  preview_meta_update_ad: "update_ad",
  preview_meta_update_adset: "update_adset",
  preview_meta_update_campaign: "update_campaign",
  preview_pause_ad: "pause",
  preview_pause_adset_or_group: "pause",
  preview_resume_ad: "resume",
  preview_resume_adset_or_group: "resume",
  preview_update_object: "update_object",
  rebalance_budget_to_end_of_month_preview: "change_budget",
  replace_ad_creative_preview: "replace_creative",
  scale_best_campaigns_preview: "change_budget",
  scale_winners_by_rule_preview: "change_budget",
  update_adset_budget_preview: "change_budget",
  update_campaign_budget_preview: "change_budget",
  update_entity_status_preview: "update_status",
  update_placements_preview: "update_placements",
  update_targeting_preview: "update_targeting",
};

const COMPAT_UNAVAILABLE_READ_TOOLS = new Set([
  "analyze_audiences",
  "audit_links_and_utms",
  "compare_creatives",
  "find_burnout_ads",
  "get_reach_estimate_read",
  "get_rule_history",
  "get_tracking_specs",
  "list_automated_rules",
  "list_creative_assets",
  "list_lead_forms",
  "search_targeting",
]);

const META_DEFAULT_PREVIEW_TOOLS = new Set([
  "archive_entities_preview",
  "clone_ad_preview",
  "clone_adset_preview",
  "clone_campaign_preview",
  "create_ab_test_ads_preview",
  "create_ad_in_existing_adset_preview",
  "create_adset_in_campaign_preview",
  "create_audience_variant_preview",
  "create_creative_preview",
  "create_engagement_campaign_preview",
  "create_lead_campaign_preview",
  "create_whatsapp_traffic_campaign_preview",
  "duplicate_campaign_with_audience_preview",
  "duplicate_campaign_with_geo_preview",
  "enable_entities_preview",
  "pause_entities_preview",
  "pause_underperformers_preview",
  "rebalance_budget_to_end_of_month_preview",
  "replace_ad_creative_preview",
  "scale_best_campaigns_preview",
  "scale_winners_by_rule_preview",
  "update_adset_budget_preview",
  "update_campaign_budget_preview",
  "update_entity_status_preview",
  "update_placements_preview",
  "update_targeting_preview",
]);

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function providerId(value: unknown): ProviderId {
  const normalized = text(value).toLowerCase();
  const result = providerAliases[normalized];
  if (!result) throw new ForbiddenException("Unsupported provider.");
  return result;
}

function campaignProvider(value: unknown): "GOOGLE_ADS" | "META_ADS" {
  const provider = providerId(value);
  if (provider !== "GOOGLE_ADS" && provider !== "META_ADS")
    throw new ForbiddenException(
      "Campaign preview is not available for this provider.",
    );
  return provider;
}

function range(args: JsonObject) {
  const startDate = text(args.start_date || args.startDate);
  const endDate = text(args.end_date || args.endDate);
  return startDate && endDate ? { startDate, endDate } : undefined;
}

@Injectable()
export class McpService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(ProviderService) private readonly providers: ProviderService,
    @Inject(ReportService) private readonly reports: ReportService,
    @Inject(McpPreviewService) private readonly previews: McpPreviewService,
    @Inject(SiteAnalysisService)
    private readonly siteAnalysis: SiteAnalysisService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  public tools() {
    return V1_COMPATIBLE_MCP_TOOLS.map((name) => ({
      name,
      description: toolDescription(name),
      inputSchema: previewToolSchema(name) ??
        ga4ToolSchema(name) ?? {
          type: "object",
          additionalProperties: true,
        },
    }));
  }

  public async call(
    principal: ServiceTokenPrincipal,
    name: string,
    rawArguments: unknown,
  ): Promise<unknown> {
    if (
      !principal.scopes.includes("adforge:mcp:read") &&
      !principal.scopes.includes("adforge:mcp")
    ) {
      throw new ForbiddenException("Service token does not have read access.");
    }
    const args = objectValue(rawArguments);
    const previewOperation = COMPAT_PREVIEW_OPERATIONS[name];
    if (previewOperation) {
      return this.compatPreview(principal, name, previewOperation, args);
    }
    const compatibility = await this.compatRead(principal, name, args);
    if (compatibility.handled) return compatibility.value;
    switch (name) {
      case "google_analytics_list_properties":
        return this.listAccounts(principal, "google_analytics");
      case "google_analytics_get_property": {
        const account = await this.ga4Account(principal, args);
        return this.providers.googleAnalyticsGetProperty(
          principal.workspaceId,
          account.connectionId,
          account.id,
        );
      }
      case "google_analytics_run_report":
        return this.ga4Report(principal, args);
      case "google_analytics_check_compatibility": {
        const account = await this.ga4Account(principal, args);
        const dimensions = stringList(args.dimensions, 9, "dimensions");
        const metrics = stringList(args.metrics, 10, "metrics", true);
        return this.providers.googleAnalyticsCheckCompatibility(
          principal.workspaceId,
          account.connectionId,
          account.id,
          dimensions,
          metrics,
        );
      }
      case "google_analytics_traffic_overview":
        return this.ga4Preset(
          principal,
          args,
          [],
          [
            "activeUsers",
            "totalUsers",
            "newUsers",
            "sessions",
            "engagedSessions",
            "engagementRate",
            "screenPageViews",
            "keyEvents",
            "totalRevenue",
          ],
        );
      case "google_analytics_acquisition":
        return this.ga4Preset(
          principal,
          args,
          [text(args.dimension, "sessionSourceMedium")],
          [
            "sessions",
            "activeUsers",
            "engagedSessions",
            "keyEvents",
            "totalRevenue",
          ],
        );
      case "google_analytics_landing_pages":
        return this.ga4Preset(
          principal,
          args,
          ["landingPagePlusQueryString"],
          [
            "sessions",
            "activeUsers",
            "engagementRate",
            "keyEvents",
            "totalRevenue",
          ],
        );
      case "google_analytics_pages":
        return this.ga4Preset(
          principal,
          args,
          [text(args.dimension, "unifiedScreenClass")],
          [
            "screenPageViews",
            "activeUsers",
            "userEngagementDuration",
            "eventCount",
          ],
        );
      case "google_analytics_events":
      case "google_analytics_key_events":
        return this.ga4Preset(
          principal,
          args,
          ["eventName"],
          ["eventCount", "activeUsers", "keyEvents", "totalRevenue"],
        );
      case "google_analytics_devices":
        return this.ga4Preset(
          principal,
          args,
          [text(args.dimension, "deviceCategory")],
          ["activeUsers", "sessions", "engagementRate", "keyEvents"],
        );
      case "google_analytics_geography":
        return this.ga4Preset(
          principal,
          args,
          [text(args.dimension, "country")],
          ["activeUsers", "sessions", "keyEvents"],
        );
      case "google_analytics_realtime": {
        const account = await this.ga4Account(principal, args);
        return this.providers.googleAnalyticsRunRealtime(
          principal.workspaceId,
          account.connectionId,
          account.id,
          stringList(args.dimensions, 4, "dimensions"),
          stringList(args.metrics ?? ["activeUsers"], 4, "metrics", true),
          safeLimit(args.limit),
        );
      }
      case "google_analytics_compare_periods":
        return this.ga4ComparePeriods(principal, args);
      case "google_analytics_list_google_ads_links": {
        const account = await this.ga4Account(principal, args);
        return this.providers.googleAnalyticsGoogleAdsLinks(
          principal.workspaceId,
          account.connectionId,
          account.id,
        );
      }
      case "google_analytics_get_custom_dimensions_metrics": {
        const account = await this.ga4Account(principal, args);
        return this.providers.googleAnalyticsCustomDefinitions(
          principal.workspaceId,
          account.connectionId,
          account.id,
        );
      }
      case "list_providers":
        return this.providers.listProviders();
      case "get_provider_capabilities":
        return (
          this.providers
            .listProviders()
            .find((item) => item.id === providerId(args.provider)) ?? null
        );
      case "list_supported_objects":
        return this.supported(providerId(args.provider), "objects");
      case "list_supported_metrics":
        return this.supported(providerId(args.provider), "metrics");
      case "list_connected_platforms":
        return this.listAccounts(principal, undefined);
      case "list_accounts":
        return this.listAccounts(principal, args.provider);
      case "list_ad_accounts":
        return this.listAccounts(principal, args.provider);
      case "get_account_status": {
        const account = await this.account(principal, args);
        return {
          provider: account.provider,
          account_id: account.externalAccountId,
          name: account.displayName,
          status: account.status,
          enabled: account.enabled,
        };
      }
      case "get_account_summary": {
        const account = await this.account(principal, args);
        return this.providers.readAccountSummary(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
        );
      }
      case "list_campaigns": {
        const account = await this.account(principal, args);
        return this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          typeof args.limit === "number" ? args.limit : undefined,
          text(args.cursor) || undefined,
        );
      }
      case "get_campaign": {
        const account = await this.account(principal, args);
        const campaignId = text(args.campaign_id || args.campaignId);
        if (!campaignId)
          throw new ForbiddenException("campaign_id is required.");
        const result = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          500,
        );
        return result.items.find((item) => item.id === campaignId) ?? null;
      }
      case "get_campaign_statuses": {
        const account = await this.account(principal, args);
        const result = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          500,
        );
        return result.items.map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
        }));
      }
      case "get_basic_metrics": {
        const account = await this.account(principal, args);
        const dates = range(args);
        if (!dates)
          throw new ForbiddenException("start_date and end_date are required.");
        return this.providers.readMetrics(
          principal.workspaceId,
          account.connectionId,
          account.id,
          dates,
          text(args.campaign_id || args.campaignId) || undefined,
        );
      }
      case "get_performance_report": {
        const account = await this.account(principal, args);
        const dates = range(args);
        if (!dates)
          throw new ForbiddenException("start_date and end_date are required.");
        return {
          provider: account.provider,
          account_id: account.externalAccountId,
          period: dates,
          metrics: await this.providers.readMetrics(
            principal.workspaceId,
            account.connectionId,
            account.id,
            dates,
          ),
          campaigns: await this.providers.readCampaigns(
            principal.workspaceId,
            account.connectionId,
            account.id,
            dates,
            100,
          ),
        };
      }
      case "generate_monthly_ads_report":
      case "collect_report_skill": {
        await this.billing.requireFeature(principal.workspaceId, "reports");
        const account = await this.account(principal, args);
        const dates = range(args) ?? defaultReportRange();
        const previousDates = reportPreviousRange(args, dates);
        return this.reports.performance(principal.workspaceId, {
          accountId: account.id,
          startDate: dates.startDate,
          endDate: dates.endDate,
          previousStartDate: previousDates.startDate,
          previousEndDate: previousDates.endDate,
        });
      }
      case "run_diagnostics":
        return {
          status: "ok",
          workspace_id: principal.workspaceId,
          read_only: true,
        };
      case "run_connection_diagnostics": {
        const account = await this.account(principal, args);
        return this.providers.readHealth(
          principal.workspaceId,
          account.connectionId,
          account.id,
        );
      }
      case "get_meta_oauth_permissions": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        const permissions = await this.providers.metaPermissions(
          principal.workspaceId,
          account.connectionId,
        );
        const connection = await this.providers.getConnection(
          principal.workspaceId,
          account.connectionId,
        );
        return { ...permissions, status: connection.status };
      }
      case "list_meta_businesses": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        return this.providers.metaBusinesses(
          principal.workspaceId,
          account.connectionId,
        );
      }
      case "get_meta_business": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        const businesses = await this.providers.metaBusinesses(
          principal.workspaceId,
          account.connectionId,
        );
        const businessId = text(args.business_id || args.businessId);
        return (
          businesses.find((business) => business.id === businessId) ?? null
        );
      }
      case "list_business_ad_accounts": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        return this.providers.metaBusinessAdAccounts(
          principal.workspaceId,
          account.connectionId,
          text(args.business_id || args.businessId),
        );
      }
      case "list_business_pages": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        return this.providers.metaBusinessPages(
          principal.workspaceId,
          account.connectionId,
          text(args.business_id || args.businessId),
        );
      }
      case "list_meta_pages": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        return this.providers.metaPages(
          principal.workspaceId,
          account.connectionId,
        );
      }
      case "get_meta_page": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        const pages = await this.providers.metaPages(
          principal.workspaceId,
          account.connectionId,
        );
        const pageId = text(args.page_id || args.pageId);
        return pages.find((page) => page.id === pageId) ?? null;
      }
      case "list_page_posts": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        return this.providers.metaPagePosts(
          principal.workspaceId,
          account.connectionId,
          text(args.page_id || args.pageId),
          typeof args.limit === "number" ? args.limit : undefined,
        );
      }
      case "get_page_post": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        const posts = await this.providers.metaPagePosts(
          principal.workspaceId,
          account.connectionId,
          text(args.page_id || args.pageId),
          100,
        );
        const postId = text(args.post_id || args.postId);
        return (
          posts.items.find((post) => String(post.id ?? "") === postId) ?? null
        );
      }
      case "get_page_post_engagement": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        const posts = await this.providers.metaPagePosts(
          principal.workspaceId,
          account.connectionId,
          text(args.page_id || args.pageId),
          100,
        );
        const postId = text(args.post_id || args.postId);
        const post = posts.items.find(
          (item) => String(item.id ?? "") === postId,
        );
        if (!post) return null;
        return {
          id: postId,
          shares: post.shares ?? null,
          reactions: post.reactions ?? null,
          comments: post.comments ?? null,
          provenance: posts.provenance,
        };
      }
      case "get_page_instagram_account": {
        const account = await this.account(principal, {
          ...args,
          provider: "meta_ads",
        });
        this.ensureConnectionWideReadAllowed(principal);
        return this.providers.metaInstagram(
          principal.workspaceId,
          account.connectionId,
          text(args.page_id || args.pageId),
        );
      }
      case "get_search_console_report": {
        const siteUrl = await this.searchConsoleSite(
          principal,
          args.site_url || args.siteUrl,
        );
        const report = await this.providers.searchConsoleReport(
          principal.workspaceId,
          siteUrl,
          Number(args.days) || 28,
        );
        return report;
      }
      case "list_search_console_properties": {
        this.ensureConnectionWideReadAllowed(principal);
        const report = await this.providers.searchConsoleReport(
          principal.workspaceId,
          "__all",
          7,
        );
        return {
          properties: report.properties,
          selected_property: report.selected_property,
          provenance: {
            source_api: report.source_api,
            real_data: report.real_data,
            data_status: report.data_status,
            fetched_at: report.fetched_at,
          },
        };
      }
      case "analyze_site": {
        const url = text(args.url);
        if (!url) throw new ForbiddenException("url is required.");
        return this.siteAnalysis.analyze(url);
      }
      case "compare_periods": {
        const account = await this.account(principal, args);
        const current = requiredRange(args, "current");
        const previous = requiredRange(args, "previous");
        const [currentMetrics, previousMetrics] = await Promise.all([
          this.providers.readMetrics(
            principal.workspaceId,
            account.connectionId,
            account.id,
            current,
          ),
          this.providers.readMetrics(
            principal.workspaceId,
            account.connectionId,
            account.id,
            previous,
          ),
        ]);
        return {
          provider: account.provider,
          account_id: account.externalAccountId,
          current_period: current,
          previous_period: previous,
          current: currentMetrics,
          previous: previousMetrics,
          changes: compareMetrics(currentMetrics, previousMetrics),
          source: "provider_read_adapter",
        };
      }
      case "get_spend_overview": {
        const account = await this.account(principal, args);
        const dates = range(args) ?? defaultReportRange();
        const metrics = await this.providers.readMetrics(
          principal.workspaceId,
          account.connectionId,
          account.id,
          dates,
        );
        return {
          provider: account.provider,
          account_id: account.externalAccountId,
          period: dates,
          spend: metrics.spend,
          clicks: metrics.clicks,
          impressions: metrics.impressions,
          conversions: metrics.conversions,
          provenance: this.provenance(metrics),
        };
      }
      case "get_executive_summary": {
        const account = await this.account(principal, args);
        const dates = range(args) ?? defaultReportRange();
        const metrics = await this.providers.readMetrics(
          principal.workspaceId,
          account.connectionId,
          account.id,
          dates,
        );
        const campaigns = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          dates,
          100,
        );
        return this.executiveSummary(account, dates, metrics, campaigns.items);
      }
      case "get_status_summary": {
        const account = await this.account(principal, args);
        const campaigns = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          500,
        );
        const counts = campaigns.items.reduce<Record<string, number>>(
          (result, campaign) => {
            const status = campaign.status ?? "UNKNOWN";
            result[status] = (result[status] ?? 0) + 1;
            return result;
          },
          {},
        );
        return { account_id: account.externalAccountId, campaigns: counts };
      }
      case "get_top_performers":
      case "rank_top_entities": {
        const account = await this.account(principal, args);
        const dates = range(args) ?? defaultReportRange();
        const campaigns = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          dates,
          500,
        );
        const metric = text(args.metric) || "conversions";
        return {
          account_id: account.externalAccountId,
          period: dates,
          metric,
          items: [...campaigns.items]
            .sort(
              (left, right) =>
                metricValue(right, metric) - metricValue(left, metric),
            )
            .slice(0, Math.min(Math.max(Number(args.limit) || 10, 1), 100)),
          provenance: campaigns.items[0]?.provenance ?? null,
        };
      }
      case "find_wasting_spend": {
        const account = await this.account(principal, args);
        const dates = range(args) ?? defaultReportRange();
        const campaigns = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          dates,
          500,
        );
        const items = campaigns.items.filter(
          (campaign) =>
            moneyValue(campaign.metrics?.spend) > 0 &&
            !metricValue(campaign, "conversions"),
        );
        return { account_id: account.externalAccountId, period: dates, items };
      }
      case "get_campaign_structure": {
        const account = await this.account(principal, args);
        const campaigns = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          500,
        );
        const campaignId = text(args.campaign_id || args.campaignId);
        return campaignId
          ? (campaigns.items.find((campaign) => campaign.id === campaignId) ??
              null)
          : campaigns.items;
      }
      case "get_account_object": {
        const account = await this.account(principal, args);
        return this.providers.readAccountSummary(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
        );
      }
      case "list_account_objects":
      case "list_objects": {
        const account = await this.account(principal, args);
        return this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          typeof args.limit === "number" ? args.limit : 100,
          text(args.cursor) || undefined,
        );
      }
      case "list_detailed_ad_report_types":
      case "get_detailed_ad_report_types":
        return {
          supported: false,
          data_status: "unsupported",
          reason:
            "Detailed ad, ad group and keyword entities are not normalized in V2 yet.",
        };
      case "list_operator_skills":
        return {
          items: [
            {
              id: "collect_report",
              title: "Собери отчёт",
              mcp_tool: "collect_report_skill",
              status: "implemented",
              read_only: true,
            },
            {
              id: "summarize_budget",
              title: "Сводка расходов",
              mcp_tool: "summarize_budget_skill",
              status: "implemented",
              read_only: true,
            },
            {
              id: "compare_periods",
              title: "Сравнение периодов",
              mcp_tool: "compare_periods",
              status: "implemented",
              read_only: true,
            },
            {
              id: "campaign_candidates",
              title: "Кампании для проверки",
              mcp_tool: "disable_candidates_skill",
              status: "implemented",
              read_only: true,
            },
            {
              id: "scale_candidates",
              title: "Кампании для масштабирования",
              mcp_tool: "scale_candidates_skill",
              status: "implemented",
              read_only: true,
            },
            {
              id: "site_analysis",
              title: "Анализ сайта",
              mcp_tool: "analyze_site",
              status: "implemented",
              read_only: true,
            },
            {
              id: "ga4_traffic_diagnosis",
              title: "GA4 traffic diagnosis",
              mcp_tool: "google_analytics_traffic_overview",
              status: "implemented",
              read_only: true,
            },
            {
              id: "ga4_acquisition",
              title: "GA4 acquisition",
              mcp_tool: "google_analytics_acquisition",
              status: "implemented",
              read_only: true,
            },
            {
              id: "ga4_content",
              title: "GA4 landing pages and content",
              mcp_tool: "google_analytics_landing_pages",
              status: "implemented",
              read_only: true,
            },
            {
              id: "ga4_key_events",
              title: "GA4 key events",
              mcp_tool: "google_analytics_key_events",
              status: "implemented",
              read_only: true,
            },
            {
              id: "ga4_period_compare",
              title: "GA4 period comparison",
              mcp_tool: "google_analytics_compare_periods",
              status: "implemented",
              read_only: true,
            },
          ],
          read_only: true,
        };
      case "list_supported_campaign_types":
        return { provider: providerId(args.provider), items: ["campaign"] };
      case "list_supported_audience_types":
        return { provider: providerId(args.provider), items: [] };
      case "list_supported_dimensions":
        return {
          provider: campaignProvider(args.provider),
          items: ["account", "campaign", "date"],
        };
      case "get_breakdown_preset":
        return {
          provider: campaignProvider(args.provider),
          supported: ["account", "campaign", "date"],
        };
      case "get_beta_diagnostics":
        return {
          status: "ok",
          read_only: true,
          workspace_id: principal.workspaceId,
        };
      case "describe_auth":
      case "describe_auth_strategy":
        return {
          authentication: "scoped HolyMedia service token",
          authorization: "server-side workspace and account allowlist",
          writes: "disabled in V2 MCP compatibility surface",
        };
      case "preview_change_campaign_name":
        if (
          Object.keys(args).some(
            (key) =>
              ![
                "provider",
                "account_id",
                "accountId",
                "campaign_id",
                "campaignId",
                "new_name",
                "newName",
              ].includes(key),
          )
        )
          throw new ForbiddenException(
            "Name-only preview does not accept additional fields.",
          );
        return this.previews.create(principal, {
          provider: campaignProvider(args.provider),
          accountId: text(args.account_id || args.accountId),
          objectId: text(args.campaign_id || args.campaignId),
          operation: "change_name",
          payload: { new_name: args.new_name ?? args.newName },
        });
      case "preview_pause_campaign":
      case "preview_resume_campaign":
        return this.previews.create(principal, {
          provider: campaignProvider(args.provider),
          accountId: text(args.account_id || args.accountId),
          objectId: text(args.campaign_id || args.campaignId),
          operation: name === "preview_pause_campaign" ? "pause" : "resume",
          payload: {},
        });
      case "preview_change_campaign_budget":
        return this.previews.create(principal, {
          provider: campaignProvider(args.provider),
          accountId: text(args.account_id || args.accountId),
          objectId: text(args.campaign_id || args.campaignId),
          operation: "change_budget",
          payload: { daily_budget: args.daily_budget ?? args.dailyBudget },
        });
      case "confirm_preview":
        if (
          Object.keys(args).length > 1 ||
          Object.keys(args).some(
            (key) => !["preview_token", "previewToken"].includes(key),
          )
        )
          throw new PreviewError("invalid_confirmation_arguments");
        return this.previews.confirm(
          principal,
          text(args.preview_token || args.previewToken),
        );
      case "commit_preview":
      case "commit_meta_app_review_preview":
      case "commit_meta_confirmed_write":
        if (
          Object.keys(args).length > 1 ||
          Object.keys(args).some(
            (key) => !["preview_token", "previewToken"].includes(key),
          )
        )
          throw new ForbiddenException(
            "Commit accepts only the confirmed preview token, not replacement fields.",
          );
        return this.previews.commit(
          principal,
          text(args.preview_token || args.previewToken),
        );
      default:
        throw new ForbiddenException(
          "Tool is not available in this V2 compatibility build.",
        );
    }
  }

  private async compatRead(
    principal: ServiceTokenPrincipal,
    name: string,
    args: JsonObject,
  ): Promise<{ handled: boolean; value?: unknown }> {
    if (COMPAT_UNAVAILABLE_READ_TOOLS.has(name)) {
      return {
        handled: true,
        value: capabilityUnavailable(name),
      };
    }
    if (name === "analyze_site_improvements") {
      const url = text(args.url);
      if (!url) throw new ForbiddenException("url is required.");
      return { handled: true, value: await this.siteAnalysis.analyze(url) };
    }
    if (name === "get_billing_summary") {
      const [subscription, usage, entitlements] = await Promise.all([
        this.billing.currentSubscription(principal.workspaceId),
        this.billing.usage(principal.workspaceId),
        this.billing.entitlements(principal.workspaceId),
      ]);
      return {
        handled: true,
        value: {
          workspace_id: principal.workspaceId,
          subscription,
          usage,
          entitlements,
          payment_provider: "not_configured",
        },
      };
    }
    if (
      name === "list_detailed_ad_report_types" ||
      name === "get_detailed_ad_report_types"
    ) {
      return {
        handled: true,
        value: {
          reports: ["campaign_performance"],
          provider_specific_reports: false,
          data_status: "partial",
        },
      };
    }
    if (
      name === "get_google_ads_detailed_report" ||
      name === "get_meta_ads_detailed_report"
    ) {
      const provider =
        name === "get_google_ads_detailed_report" ? "google_ads" : "meta_ads";
      const reportType = text(args.report_type || args.reportType);
      if (
        reportType &&
        !["campaign", "campaigns", "campaign_performance"].includes(reportType)
      ) {
        return {
          handled: true,
          value: capabilityUnavailable(name, {
            requested_report_type: reportType,
            supported_report_types: ["campaign_performance"],
          }),
        };
      }
      const account = await this.account(principal, { ...args, provider });
      const result = await this.providers.readCampaigns(
        principal.workspaceId,
        account.connectionId,
        account.id,
        range(args) ?? defaultReportRange(),
        typeof args.limit === "number" ? args.limit : 500,
        text(args.cursor) || undefined,
      );
      return {
        handled: true,
        value: {
          provider: account.provider,
          account_id: account.externalAccountId,
          report_type: "campaign_performance",
          ...result,
        },
      };
    }
    if (name === "get_flexible_insights") {
      const account = await this.account(principal, args);
      const dates = range(args) ?? defaultReportRange();
      return {
        handled: true,
        value: await this.providers.readMetrics(
          principal.workspaceId,
          account.connectionId,
          account.id,
          dates,
          text(args.campaign_id || args.campaignId) || undefined,
        ),
      };
    }
    if (name === "get_object") {
      const account = await this.account(principal, args);
      const objectType = text(args.object_type || args.objectType, "account");
      if (objectType === "account") {
        return {
          handled: true,
          value: await this.providers.readAccountSummary(
            principal.workspaceId,
            account.connectionId,
            account.id,
            range(args),
          ),
        };
      }
      if (objectType === "campaign") {
        const result = await this.providers.readCampaigns(
          principal.workspaceId,
          account.connectionId,
          account.id,
          range(args),
          500,
        );
        const objectId = text(args.object_id || args.objectId);
        return {
          handled: true,
          value: result.items.find((item) => item.id === objectId) ?? null,
        };
      }
      return {
        handled: true,
        value: capabilityUnavailable(name, { object_type: objectType }),
      };
    }
    if (
      [
        "audit_account",
        "get_asset_health",
        "get_connected_assets",
        "get_conversion_health",
        "get_delivery_issues",
        "get_launch_checklist",
        "get_minimum_budgets_read",
        "get_no_result_entities",
        "get_policy_issues",
        "get_recommendations_read",
        "summarize_budget_skill",
        "disable_candidates_skill",
        "scale_candidates_skill",
        "detect_anomalies",
        "estimate_budget_days_remaining",
      ].includes(name)
    ) {
      return {
        handled: true,
        value: await this.compatAccountAnalysis(principal, name, args),
      };
    }
    return { handled: false };
  }

  private async compatAccountAnalysis(
    principal: ServiceTokenPrincipal,
    name: string,
    args: JsonObject,
  ): Promise<unknown> {
    const account = await this.account(principal, args);
    const dates = range(args) ?? defaultReportRange();
    if (name === "detect_anomalies") {
      const periods = comparisonRanges(args);
      const [current, previous] = await Promise.all([
        this.providers.readMetrics(
          principal.workspaceId,
          account.connectionId,
          account.id,
          periods.current,
        ),
        this.providers.readMetrics(
          principal.workspaceId,
          account.connectionId,
          account.id,
          periods.previous,
        ),
      ]);
      return {
        account_id: account.externalAccountId,
        periods,
        changes: compareMetrics(current, previous),
        threshold_percent: 15,
      };
    }
    const [metrics, campaigns, health] = await Promise.all([
      this.providers.readMetrics(
        principal.workspaceId,
        account.connectionId,
        account.id,
        dates,
      ),
      this.providers.readCampaigns(
        principal.workspaceId,
        account.connectionId,
        account.id,
        dates,
        500,
      ),
      this.providers.readHealth(
        principal.workspaceId,
        account.connectionId,
        account.id,
      ),
    ]);
    if (name === "get_connected_assets" || name === "get_asset_health") {
      if (account.provider !== "META_ADS") {
        return {
          account_id: account.externalAccountId,
          provider: account.provider,
          health,
          assets: [],
          data_status: "partial",
        };
      }
      const [businesses, pages] = await Promise.allSettled([
        this.providers.metaBusinesses(
          principal.workspaceId,
          account.connectionId,
        ),
        this.providers.metaPages(principal.workspaceId, account.connectionId),
      ]);
      return {
        account_id: account.externalAccountId,
        health,
        businesses: businesses.status === "fulfilled" ? businesses.value : [],
        pages: pages.status === "fulfilled" ? pages.value : [],
        data_status:
          businesses.status === "fulfilled" && pages.status === "fulfilled"
            ? "live"
            : "additional_permission_required",
      };
    }
    if (name === "get_conversion_health") {
      return {
        account_id: account.externalAccountId,
        period: dates,
        conversions: metrics.conversions,
        cost_per_conversion: metrics.costPerConversion,
        data_sufficiency:
          metrics.conversions === null ? "unavailable" : "available",
      };
    }
    if (name === "get_minimum_budgets_read") {
      return {
        account_id: account.externalAccountId,
        period: dates,
        campaigns: campaigns.items.map((campaign) => ({
          id: campaign.id,
          name: campaign.name,
          status: campaign.status,
          budget: campaign.budget,
        })),
        note: "Provider minimum-budget rules are not exposed by the normalized read adapter.",
      };
    }
    const noResult = campaigns.items.filter(
      (campaign) =>
        moneyValue(campaign.metrics?.spend) > 0 &&
        metricValue(campaign, "conversions") === 0,
    );
    if (
      name === "get_no_result_entities" ||
      name === "disable_candidates_skill"
    ) {
      return {
        account_id: account.externalAccountId,
        period: dates,
        items: noResult,
        preview: false,
        read_only: true,
      };
    }
    if (name === "scale_candidates_skill") {
      return {
        account_id: account.externalAccountId,
        period: dates,
        items: [...campaigns.items]
          .filter((campaign) => metricValue(campaign, "conversions") > 0)
          .sort(
            (left, right) =>
              metricValue(right, "conversions") -
              metricValue(left, "conversions"),
          )
          .slice(0, 10),
        preview: false,
        read_only: true,
      };
    }
    if (name === "estimate_budget_days_remaining") {
      const spend = moneyValue(metrics.spend);
      return {
        account_id: account.externalAccountId,
        period: dates,
        spend: metrics.spend,
        average_daily_spend: spend / inclusiveDays(dates),
        remaining_balance: null,
        estimated_days_remaining: null,
        data_status: "partial",
        note: "The provider does not expose a reliable remaining balance through this adapter.",
      };
    }
    if (name === "get_delivery_issues") {
      return {
        account_id: account.externalAccountId,
        health,
        items: campaigns.items.filter(
          (campaign) =>
            campaign.status &&
            !["ENABLED", "ACTIVE"].includes(campaign.status.toUpperCase()),
        ),
      };
    }
    if (name === "get_policy_issues") {
      return {
        account_id: account.externalAccountId,
        issues: health.missingScopes.map((scope) => ({
          type: "missing_permission",
          scope,
        })),
        health,
      };
    }
    if (name === "get_recommendations_read") {
      return {
        account_id: account.externalAccountId,
        period: dates,
        recommendations: deterministicRecommendations(metrics, noResult.length),
        source: "rule_based_v2",
      };
    }
    if (name === "get_launch_checklist") {
      return {
        account_id: account.externalAccountId,
        checklist: {
          credentials: health.credentialsValid,
          provider: health.providerReachable,
          scopes: health.scopesSufficient,
          account: health.accountReachable,
          campaigns_found: campaigns.items.length > 0,
        },
        ready:
          health.credentialsValid &&
          health.providerReachable &&
          health.scopesSufficient &&
          health.accountReachable,
      };
    }
    return {
      account_id: account.externalAccountId,
      period: dates,
      metrics,
      campaigns: campaigns.items,
      health,
      read_only: true,
    };
  }

  private compatPreview(
    principal: ServiceTokenPrincipal,
    name: string,
    operation: string,
    args: JsonObject,
  ) {
    const provider = campaignProvider(
      args.provider ||
        (name.includes("meta_") || META_DEFAULT_PREVIEW_TOOLS.has(name)
          ? "meta_ads"
          : ""),
    );
    const accountId = text(args.account_id || args.accountId);
    const objectId = text(
      args.object_id ||
        args.objectId ||
        args.campaign_id ||
        args.campaignId ||
        args.adset_id ||
        args.adsetId ||
        args.ad_group_id ||
        args.adGroupId ||
        args.ad_id ||
        args.adId,
      "new",
    );
    return this.previews.create(principal, {
      provider,
      accountId,
      objectId,
      operation,
      payload: safePreviewPayload(args),
    });
  }

  private async ga4Account(principal: ServiceTokenPrincipal, args: JsonObject) {
    return this.account(principal, {
      ...args,
      provider: "google_analytics",
      account_id:
        args.property_id ??
        args.propertyId ??
        args.account_id ??
        args.accountId,
    });
  }

  private async ga4Report(principal: ServiceTokenPrincipal, args: JsonObject) {
    const account = await this.ga4Account(principal, args);
    const dateRanges = ga4DateRanges(args);
    const dimensions = stringList(args.dimensions, 9, "dimensions");
    const metrics = stringList(args.metrics, 10, "metrics", true);
    const orderBys = objectList(
      args.order_bys ?? args.orderBys,
      9,
      "order_bys",
    );
    const report = await this.providers.googleAnalyticsRunReport(
      principal.workspaceId,
      account.connectionId,
      account.id,
      {
        dateRanges,
        dimensions,
        metrics,
        limit: safeLimit(args.limit),
        ...(objectValue(args.dimension_filter ?? args.dimensionFilter) &&
        Object.keys(objectValue(args.dimension_filter ?? args.dimensionFilter))
          .length
          ? {
              dimensionFilter: objectValue(
                args.dimension_filter ?? args.dimensionFilter,
              ),
            }
          : {}),
        ...(objectValue(args.metric_filter ?? args.metricFilter) &&
        Object.keys(objectValue(args.metric_filter ?? args.metricFilter)).length
          ? {
              metricFilter: objectValue(
                args.metric_filter ?? args.metricFilter,
              ),
            }
          : {}),
        ...(orderBys.length ? { orderBys } : {}),
      },
    );
    return ga4Response(account, dateRanges, dimensions, metrics, report);
  }

  private async ga4Preset(
    principal: ServiceTokenPrincipal,
    args: JsonObject,
    dimensions: string[],
    metrics: string[],
  ) {
    const account = await this.ga4Account(principal, args);
    const dateRanges = ga4DateRanges(args);
    const report = await this.providers.googleAnalyticsRunReport(
      principal.workspaceId,
      account.connectionId,
      account.id,
      { dateRanges, dimensions, metrics, limit: safeLimit(args.limit) },
    );
    return ga4Response(account, dateRanges, dimensions, metrics, report);
  }

  private async ga4ComparePeriods(
    principal: ServiceTokenPrincipal,
    args: JsonObject,
  ) {
    const account = await this.ga4Account(principal, args);
    const current = range(args) ?? defaultReportRange();
    const previous = reportPreviousRange(args, current);
    const metrics = stringList(
      args.metrics ?? [
        "activeUsers",
        "sessions",
        "engagedSessions",
        "keyEvents",
        "totalRevenue",
      ],
      10,
      "metrics",
      true,
    );
    const dimensions = stringList(args.dimensions, 9, "dimensions");
    const [currentReport, previousReport] = await Promise.all([
      this.providers.googleAnalyticsRunReport(
        principal.workspaceId,
        account.connectionId,
        account.id,
        {
          dateRanges: [current],
          dimensions,
          metrics,
          limit: safeLimit(args.limit),
        },
      ),
      this.providers.googleAnalyticsRunReport(
        principal.workspaceId,
        account.connectionId,
        account.id,
        {
          dateRanges: [previous],
          dimensions,
          metrics,
          limit: safeLimit(args.limit),
        },
      ),
    ]);
    return {
      property: ga4Property(account),
      current: ga4Response(
        account,
        [current],
        dimensions,
        metrics,
        currentReport,
      ),
      previous: ga4Response(
        account,
        [previous],
        dimensions,
        metrics,
        previousReport,
      ),
      note: "Changes show measured GA4 data; they do not by themselves establish causation.",
    };
  }

  private async listAccounts(
    principal: ServiceTokenPrincipal,
    rawProvider: unknown,
  ) {
    const provider = rawProvider ? providerId(rawProvider) : undefined;
    const accounts = await this.database.client.providerAccount.findMany({
      where: {
        workspaceId: principal.workspaceId,
        enabled: true,
        ...(provider ? { provider } : {}),
        ...(principal.accountIds.length
          ? { id: { in: principal.accountIds } }
          : {}),
        connection: { status: { in: ["CONNECTED", "DEGRADED"] } },
      },
      orderBy: { displayName: "asc" },
    });
    return accounts.map((account) => ({
      provider: account.provider,
      account_id: account.externalAccountId,
      name: account.displayName,
      currency: account.currency,
      timezone: account.timezone,
      status: account.status,
      source: "v2_database_provider_account",
    }));
  }

  private supported(provider: ProviderId, kind: "objects" | "metrics") {
    const definition = this.providers
      .listProviders()
      .find((item) => item.id === provider);
    if (!definition) return { provider, items: [] };
    const items =
      kind === "objects"
        ? ["account", "campaign", ...(definition.read ? ["metrics"] : [])]
        : definition.read
          ? [
              "spend",
              "impressions",
              "clicks",
              "ctr",
              "cpc",
              "cpm",
              "conversions",
              "cost_per_conversion",
            ]
          : [];
    return { provider, items };
  }

  private provenance(metrics: ProviderMetricSummary) {
    return metrics ? "provider_read_adapter" : "unknown";
  }

  private executiveSummary(
    account: { provider: ProviderId; externalAccountId: string },
    dates: { startDate: string; endDate: string },
    metrics: ProviderMetricSummary,
    campaigns: ProviderCampaign[],
  ) {
    const top = [...campaigns].sort(
      (left, right) => metricValue(right, "spend") - metricValue(left, "spend"),
    )[0];
    const conclusions: string[] = [];
    if ((metrics.conversions ?? 0) > 0 && (metrics.clicks ?? 0) > 0)
      conclusions.push(
        "В периоде есть клики и конверсии; оценка эффективности опирается на реальные provider metrics.",
      );
    if (metrics.spend === null)
      conclusions.push(
        "Расход недоступен в ответе провайдера, поэтому финансовый вывод ограничен.",
      );
    if (!campaigns.length)
      conclusions.push("Кампании за выбранный период не найдены.");
    return {
      provider: account.provider,
      account_id: account.externalAccountId,
      period: dates,
      metrics,
      top_spend_campaign: top ?? null,
      conclusions,
      data_sufficiency:
        metrics.spend !== null && campaigns.length > 0
          ? "sufficient"
          : "limited",
    };
  }

  private async account(principal: ServiceTokenPrincipal, args: JsonObject) {
    const provider = providerId(args.provider);
    const requested = text(args.account_id || args.accountId);
    if (!requested) throw new ForbiddenException("account_id is required.");
    const identifiers: Array<Record<string, string>> = [
      { externalAccountId: requested },
    ];
    if (isUuid(requested)) identifiers.unshift({ id: requested });
    const account = await this.database.client.providerAccount.findFirst({
      where: {
        workspaceId: principal.workspaceId,
        provider,
        enabled: true,
        connection: { status: { in: ["CONNECTED", "DEGRADED"] } },
        OR: identifiers,
      },
    });
    if (
      !account ||
      (principal.accountIds.length &&
        !principal.accountIds.includes(account.id))
    ) {
      throw new ForbiddenException(
        "Account is not available to this service token.",
      );
    }
    return account;
  }

  private ensureConnectionWideReadAllowed(
    principal: ServiceTokenPrincipal,
  ): void {
    if (principal.accountIds.length) {
      throw new ForbiddenException(
        "Connection-wide assets are not available to an account-restricted service token.",
      );
    }
  }

  private async searchConsoleSite(
    principal: ServiceTokenPrincipal,
    rawSiteUrl: unknown,
  ): Promise<string> {
    const requested = text(rawSiteUrl) || "__all";
    if (!principal.accountIds.length) return requested;
    if (requested === "__all") {
      throw new ForbiddenException(
        "A specific Search Console property is required for an account-restricted service token.",
      );
    }
    const account = await this.account(principal, {
      provider: "google_search_console",
      account_id: requested,
    });
    return account.externalAccountId;
  }
}

function toolDescription(name: string): string {
  if (name.startsWith("google_analytics_"))
    return "Read-only Google Analytics 4 tool. It can access only an enabled GA4 property in the caller's current workspace and never changes Analytics configuration.";
  if (name === "preview_change_campaign_name")
    return "Create a read-only rename preview. Use only after the user explicitly asks to rename a campaign and supplies the target name. Then confirm and commit the returned preview token in the same user-authorized flow.";
  if (name === "confirm_preview")
    return "Confirm the exact opaque preview_token returned by preview_change_campaign_name, using the SAME MCP key. Send only {preview_token}; do not send provider, account_id, campaign_id, name, preview_id or a service key. This is a local confirmation, not a Meta request or mutation. Requires explicit user authorization of that preview.";
  if (name === "preview_meta_update_campaign")
    return "Generic campaign preview only; it cannot authorize the controlled App Review rename. For a name-only change use preview_change_campaign_name instead.";
  if (
    ["commit_meta_app_review_preview", "commit_meta_confirmed_write"].includes(
      name,
    )
  )
    return "Commit the exact explicitly confirmed preview_token using the same MCP key. Send only {preview_token}. The controlled policy allows only the prepared Meta account/campaign, PAUSED and name-only; the safe new name is bound to the preview. Reads Meta before and after the mutation. Generic writes remain blocked.";
  return `HolyMedia MCP compatibility tool: ${name}`;
}

function previewToolSchema(name: string): Record<string, unknown> | undefined {
  if (
    [
      "confirm_preview",
      "commit_preview",
      "commit_meta_app_review_preview",
      "commit_meta_confirmed_write",
    ].includes(name)
  )
    return {
      type: "object",
      additionalProperties: false,
      required: ["preview_token"],
      properties: {
        preview_token: {
          type: "string",
          pattern: "^hmpp_[A-Za-z0-9_-]{20,120}$",
          description:
            "Exact opaque preview_token returned by the preview tool. Not preview_id, service key or confirmation ID. Use the same MCP key throughout.",
        },
      },
    };
  if (name === "preview_change_campaign_name")
    return {
      type: "object",
      additionalProperties: false,
      required: ["provider", "account_id", "campaign_id", "new_name"],
      properties: {
        provider: { type: "string", enum: ["META_ADS", "GOOGLE_ADS"] },
        account_id: {
          type: "string",
          minLength: 1,
          description: "Authorized account ID in the current workspace.",
        },
        campaign_id: { type: "string", minLength: 1 },
        new_name: { type: "string", minLength: 1, maxLength: 255 },
      },
    };
  return undefined;
}

function ga4ToolSchema(name: string): Record<string, unknown> | undefined {
  const property = {
    property_id: {
      type: "string",
      minLength: 1,
      maxLength: 20,
      description: "Enabled GA4 property ID.",
    },
  };
  const period = {
    start_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    end_date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
  };
  if (name === "google_analytics_list_properties")
    return { type: "object", additionalProperties: false, properties: {} };
  if (
    [
      "google_analytics_get_property",
      "google_analytics_list_google_ads_links",
      "google_analytics_get_custom_dimensions_metrics",
    ].includes(name)
  )
    return {
      type: "object",
      additionalProperties: false,
      required: ["property_id"],
      properties: property,
    };
  if (name === "google_analytics_run_report")
    return {
      type: "object",
      additionalProperties: false,
      required: ["property_id", "metrics"],
      properties: {
        ...property,
        ...period,
        dimensions: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 80 },
          maxItems: 9,
        },
        metrics: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 80 },
          minItems: 1,
          maxItems: 10,
        },
        dimension_filter: {
          type: "object",
          additionalProperties: true,
          description: "GA4 Data API dimensionFilter expression.",
        },
        metric_filter: {
          type: "object",
          additionalProperties: true,
          description: "GA4 Data API metricFilter expression.",
        },
        order_bys: {
          type: "array",
          items: { type: "object", additionalProperties: true },
          maxItems: 9,
          description: "GA4 Data API orderBys expressions.",
        },
        limit: { type: "integer", minimum: 1, maximum: 1000 },
      },
    };
  if (name === "google_analytics_check_compatibility")
    return {
      type: "object",
      additionalProperties: false,
      required: ["property_id", "metrics"],
      properties: {
        ...property,
        dimensions: { type: "array", items: { type: "string" }, maxItems: 9 },
        metrics: {
          type: "array",
          items: { type: "string" },
          minItems: 1,
          maxItems: 10,
        },
      },
    };
  if (name === "google_analytics_realtime")
    return {
      type: "object",
      additionalProperties: false,
      required: ["property_id"],
      properties: {
        ...property,
        dimensions: { type: "array", items: { type: "string" }, maxItems: 4 },
        metrics: { type: "array", items: { type: "string" }, maxItems: 4 },
        limit: { type: "integer", minimum: 1, maximum: 1000 },
      },
    };
  if (name.startsWith("google_analytics_"))
    return {
      type: "object",
      additionalProperties: false,
      required: ["property_id"],
      properties: {
        ...property,
        ...period,
        dimension: { type: "string", minLength: 1, maxLength: 80 },
        dimensions: { type: "array", items: { type: "string" }, maxItems: 9 },
        metrics: { type: "array", items: { type: "string" }, maxItems: 10 },
        limit: { type: "integer", minimum: 1, maximum: 1000 },
      },
    };
  return undefined;
}

function stringList(
  value: unknown,
  maximum: number,
  label: string,
  required = false,
): string[] {
  if (value === undefined || value === null) {
    if (required) throw new ForbiddenException(`${label} is required.`);
    return [];
  }
  if (!Array.isArray(value) || value.length > maximum)
    throw new ForbiddenException(
      `${label} must contain up to ${maximum} items.`,
    );
  const result = value.map((item) => text(item)).filter(Boolean);
  if (result.length !== value.length || (required && !result.length))
    throw new ForbiddenException(`${label} contains an invalid value.`);
  return result;
}

function objectList(
  value: unknown,
  maximum: number,
  label: string,
): JsonObject[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximum)
    throw new ForbiddenException(
      `${label} must contain up to ${maximum} items.`,
    );
  if (
    value.some(
      (item) => !item || typeof item !== "object" || Array.isArray(item),
    )
  )
    throw new ForbiddenException(`${label} contains an invalid value.`);
  return value as JsonObject[];
}

function safeLimit(value: unknown): number {
  if (value === undefined || value === null || value === "") return 100;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 1_000)
    throw new ForbiddenException("limit must be between 1 and 1000.");
  return number;
}

function ga4DateRanges(args: JsonObject) {
  const current = range(args) ?? defaultReportRange();
  return [current];
}

function ga4Property(account: {
  externalAccountId: string;
  displayName: string;
  timezone: string | null;
  currency: string | null;
}) {
  return {
    property_id: account.externalAccountId,
    name: account.displayName,
    timezone: account.timezone,
    currency: account.currency,
  };
}

function ga4Response(
  account: {
    externalAccountId: string;
    displayName: string;
    timezone: string | null;
    currency: string | null;
  },
  dateRanges: Array<{ startDate: string; endDate: string }>,
  dimensions: string[],
  metrics: string[],
  raw: Record<string, unknown>,
) {
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  return {
    property: ga4Property(account),
    period: dateRanges,
    dimensions,
    metrics,
    rows,
    totals: Array.isArray(raw.totals) ? raw.totals : [],
    row_count: raw.rowCount ?? rows.length,
    metadata: raw.metadata ?? {},
    quota: raw.propertyQuota ?? null,
    provenance: {
      provider: "GOOGLE_ANALYTICS",
      source_api: "Google Analytics Data API",
      real_data: true,
    },
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function requiredRange(args: JsonObject, prefix: "current" | "previous") {
  const startDate = text(
    args[`${prefix}_start_date`] || args[`${prefix}StartDate`],
  );
  const endDate = text(args[`${prefix}_end_date`] || args[`${prefix}EndDate`]);
  if (!startDate || !endDate)
    throw new ForbiddenException(
      `${prefix}_start_date and ${prefix}_end_date are required.`,
    );
  return { startDate, endDate };
}

function moneyValue(value: { amount: string } | null | undefined): number {
  const parsed = Number(value?.amount ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function metricValue(campaign: ProviderCampaign, key: string): number {
  const metrics = campaign.metrics;
  if (key === "spend") return moneyValue(metrics?.spend);
  const value = metrics?.[key as keyof ProviderMetricSummary];
  return typeof value === "number" ? value : Number(value ?? 0) || 0;
}

function compareMetrics(
  current: ProviderMetricSummary,
  previous: ProviderMetricSummary,
) {
  const keys = [
    "spend",
    "impressions",
    "clicks",
    "ctr",
    "cpc",
    "cpm",
    "conversions",
    "costPerConversion",
  ] as const;
  const result: Record<
    string,
    {
      current: unknown;
      previous: unknown;
      absolute: number | null;
      percent: number | null;
    }
  > = {};
  for (const key of keys) {
    const currentValue = current[key];
    const previousValue = previous[key];
    const currentNumber = metricNumber(currentValue);
    const previousNumber = metricNumber(previousValue);
    const absolute =
      currentNumber !== null && previousNumber !== null
        ? currentNumber - previousNumber
        : null;
    result[key] = {
      current: currentValue,
      previous: previousValue,
      absolute,
      percent:
        absolute !== null && previousNumber !== null && previousNumber !== 0
          ? (absolute / Math.abs(previousNumber)) * 100
          : null,
    };
  }
  return result;
}

function metricNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && "amount" in value) {
    const amount = Number((value as { amount?: unknown }).amount);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

function defaultReportRange() {
  const endDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return { startDate, endDate };
}

function reportPreviousRange(
  args: JsonObject,
  current: { startDate: string; endDate: string },
) {
  if (args.previous_start_date || args.previousStartDate) {
    return requiredRange(args, "previous");
  }
  const start = Date.parse(`${current.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${current.endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return { startDate: current.startDate, endDate: current.endDate };
  }
  const days = Math.floor((end - start) / 86_400_000) + 1;
  const previousEnd = new Date(start - 86_400_000);
  const previousStart = new Date(
    previousEnd.getTime() - (days - 1) * 86_400_000,
  );
  return {
    startDate: previousStart.toISOString().slice(0, 10),
    endDate: previousEnd.toISOString().slice(0, 10),
  };
}

function capabilityUnavailable(tool: string, context: JsonObject = {}) {
  return {
    status: "unavailable",
    data_status: "unsupported",
    real_data: false,
    tool,
    reason:
      "The active provider adapter does not expose this capability in V2 yet.",
    ...context,
  };
}

function comparisonRanges(args: JsonObject) {
  const hasExplicitRange = Boolean(
    args.current_start_date ||
    args.currentStartDate ||
    args.previous_start_date ||
    args.previousStartDate,
  );
  if (hasExplicitRange) {
    return {
      current: requiredRange(args, "current"),
      previous: requiredRange(args, "previous"),
    };
  }
  const currentEnd = new Date(Date.now() - 86_400_000);
  const currentStart = new Date(currentEnd.getTime() - 6 * 86_400_000);
  const previousEnd = new Date(currentStart.getTime() - 86_400_000);
  const previousStart = new Date(previousEnd.getTime() - 6 * 86_400_000);
  return {
    current: {
      startDate: currentStart.toISOString().slice(0, 10),
      endDate: currentEnd.toISOString().slice(0, 10),
    },
    previous: {
      startDate: previousStart.toISOString().slice(0, 10),
      endDate: previousEnd.toISOString().slice(0, 10),
    },
  };
}

function inclusiveDays(value: { startDate: string; endDate: string }): number {
  const start = Date.parse(`${value.startDate}T00:00:00.000Z`);
  const end = Date.parse(`${value.endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start)
    throw new ForbiddenException("Invalid date range.");
  return Math.floor((end - start) / 86_400_000) + 1;
}

function deterministicRecommendations(
  metrics: ProviderMetricSummary,
  noResultCampaigns: number,
) {
  const recommendations: Array<{
    severity: "info" | "warning";
    finding: string;
  }> = [];
  if (moneyValue(metrics.spend) > 0 && metrics.conversions === 0) {
    recommendations.push({
      severity: "warning",
      finding:
        "There is confirmed spend in the period, but the provider returned zero conversions.",
    });
  }
  if (noResultCampaigns > 0) {
    recommendations.push({
      severity: "warning",
      finding: `${noResultCampaigns} campaign(s) spent money without provider-reported conversions.`,
    });
  }
  if (metrics.ctr !== null && metrics.ctr < 0.01) {
    recommendations.push({
      severity: "info",
      finding:
        "CTR is below 1% for the selected period; the available data does not establish the cause.",
    });
  }
  if (!recommendations.length) {
    recommendations.push({
      severity: "info",
      finding:
        "No material issue was confirmed by the normalized metrics available for this period.",
    });
  }
  return recommendations;
}

function safePreviewPayload(args: JsonObject): JsonObject {
  const visit = (value: unknown, depth: number): unknown => {
    if (depth > 8) throw new ForbiddenException("Preview payload is too deep.");
    if (
      value === null ||
      ["string", "number", "boolean"].includes(typeof value)
    )
      return value;
    if (Array.isArray(value))
      return value.map((item) => visit(item, depth + 1));
    if (value && typeof value === "object") {
      const result: JsonObject = {};
      for (const [key, item] of Object.entries(value)) {
        if (/token|secret|password|authorization|cookie/i.test(key))
          throw new ForbiddenException(
            "Preview payload must not contain credentials.",
          );
        result[key] = visit(item, depth + 1);
      }
      return result;
    }
    throw new ForbiddenException("Preview payload contains an invalid value.");
  };
  const result = visit(args, 0) as JsonObject;
  if (JSON.stringify(result).length > 32_768)
    throw new ForbiddenException("Preview payload is too large.");
  return result;
}

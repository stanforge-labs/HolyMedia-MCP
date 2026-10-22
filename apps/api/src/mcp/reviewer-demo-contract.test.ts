import { describe, expect, it, vi } from "vitest";
import { PUBLIC_READ_TOOLS } from "./mcp-public-tools.js";
import { reviewerDemoCall } from "./reviewer-demo.js";

const google = { provider: "GOOGLE_ADS", account_id: "9990000001" };
const meta = { provider: "META_ADS", account_id: "act_9990000002" };
const ga4 = { property_id: "999000003" };
const dates = { start_date: "2026-10-15", end_date: "2026-10-21" };
const since = { since: "2026-10-15", until: "2026-10-21" };
const args: Record<string, Record<string, unknown>> = {
  list_connected_resources: {},
  list_ad_accounts: { provider: "GOOGLE_ADS" },
  get_account_status: google,
  get_account_summary: { ...google, ...dates },
  list_campaigns: { ...google, ...dates, limit: 5 },
  get_campaign: { ...google, campaign_id: "9991000001", ...dates },
  get_campaign_statuses: { ...google, ...dates },
  get_basic_metrics: { ...google, ...dates },
  get_performance_report: { ...google, ...dates },
  get_spend_overview: { ...google, ...dates },
  get_status_summary: { ...google, ...dates },
  get_top_performers: { ...google, ...dates, limit: 5 },
  get_campaign_structure: { ...google, campaign_id: "9991000001", ...dates },
  get_google_ads_detailed_report: { ...google, ...dates, limit: 5 },
  google_ads_list_keywords: {
    ...google,
    ...since,
    campaign_ids: ["9991000001"],
    limit: 5,
  },
  google_ads_search_terms: {
    ...google,
    ...since,
    campaign_ids: ["9991000001"],
    limit: 5,
  },
  google_ads_list_negatives: { ...google, campaign_ids: ["9991000001"] },
  google_ads_check_negative_conflicts: {
    ...google,
    campaign_ids: ["9991000001"],
    negatives: [{ text: "demo" }],
  },
  get_meta_ads_detailed_report: { ...meta, ...since, limit: 5 },
  get_meta_oauth_permissions: { account_id: meta.account_id },
  get_flexible_insights: { ...meta, ...dates, limit: 5 },
  google_analytics_list_properties: {},
  google_analytics_get_property: ga4,
  google_analytics_run_report: {
    ...ga4,
    ...dates,
    dimensions: ["date"],
    metrics: ["sessions"],
    limit: 5,
  },
  google_analytics_check_compatibility: {
    ...ga4,
    dimensions: ["date"],
    metrics: ["sessions"],
  },
  google_analytics_traffic_overview: { ...ga4, ...dates, limit: 5 },
  google_analytics_acquisition: { ...ga4, ...dates, limit: 5 },
  google_analytics_landing_pages: { ...ga4, ...dates, limit: 5 },
  google_analytics_pages: { ...ga4, ...dates, limit: 5 },
  google_analytics_events: { ...ga4, ...dates, limit: 5 },
  google_analytics_key_events: { ...ga4, ...dates, limit: 5 },
  google_analytics_devices: { ...ga4, ...dates, limit: 5 },
  google_analytics_geography: { ...ga4, ...dates, limit: 5 },
  google_analytics_realtime: { ...ga4, limit: 5 },
  google_analytics_compare_periods: {
    ...ga4,
    start_date: "2026-10-08",
    end_date: "2026-10-21",
    limit: 5,
  },
  google_analytics_list_google_ads_links: ga4,
  google_analytics_get_custom_dimensions_metrics: ga4,
  get_search_console_report: { site_url: "sc-domain:demo.invalid", days: 7 },
  list_search_console_properties: {},
  compare_periods: {
    ...google,
    current_start_date: "2026-10-08",
    current_end_date: "2026-10-21",
    previous_start_date: "2026-09-24",
    previous_end_date: "2026-10-07",
  },
  generate_monthly_ads_report: { ...google, ...dates },
};

describe("reviewer demo public READ contract", () => {
  it("has one valid, synthetic result for each of 41 safe READ tools", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    try {
      const safe = PUBLIC_READ_TOOLS.filter(
        (name) => name !== "run_connection_diagnostics",
      );
      expect(safe).toHaveLength(41);
      for (const name of safe) {
        expect(args[name], `fixture for ${name}`).toBeDefined();
        const result = reviewerDemoCall(name, args[name]!) as
          Record<string, unknown> | Array<Record<string, unknown>>;
        const rows = Array.isArray(result) ? result : [result];
        expect(rows.length, name).toBeGreaterThan(0);
        expect(
          rows.every(
            (row) => row.realData === false && row.dataStatus === "demo",
          ),
          name,
        ).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("honors campaign filters and rejects unsupported arguments", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    try {
      const campaigns = reviewerDemoCall("list_campaigns", {
        ...google,
        ...dates,
        statuses: ["PAUSED"],
      }) as { items: Array<{ status: string }> };
      expect(campaigns.items).toHaveLength(1);
      expect(campaigns.items[0]?.status).toBe("PAUSED");
      const structure = reviewerDemoCall("get_campaign_structure", {
        ...google,
        ...dates,
        campaign_id: "9991000001",
      }) as { items: Array<{ id: string }> };
      expect(structure.items.map((item) => item.id)).toEqual(["9991000001"]);
      const keywords = reviewerDemoCall("google_ads_list_keywords", {
        ...google,
        ...since,
        campaign_ids: ["9991000001"],
      }) as { items: Array<{ campaign_id: string; cost: number }> };
      expect(keywords.items.map((item) => item.campaign_id)).toEqual([
        "9991000001",
      ]);
      const terms = reviewerDemoCall("google_ads_search_terms", {
        ...google,
        ...since,
        campaign_ids: ["9991000001"],
      }) as { items: Array<{ campaign_id: string }> };
      expect(terms.items.map((item) => item.campaign_id)).toEqual([
        "9991000001",
      ]);
      const earlier = reviewerDemoCall("google_ads_list_keywords", {
        ...google,
        since: "2026-09-24",
        until: "2026-09-30",
        campaign_ids: ["9991000001"],
      }) as { items: Array<{ cost: number }> };
      expect(keywords.items[0]?.cost).not.toBe(earlier.items[0]?.cost);
      expect(() =>
        reviewerDemoCall("list_campaigns", { ...google, mystery_filter: "x" }),
      ).toThrow("Unsupported demo argument");
      expect(() =>
        reviewerDemoCall("google_ads_list_keywords", {
          ...google,
          cursor: "unrecognized",
        }),
      ).toThrow("Demo cursor is unavailable");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses exact requested periods and equal implicit comparison windows", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-22T12:00:00Z"));
    try {
      const metaReport = reviewerDemoCall("get_meta_ads_detailed_report", {
        ...meta,
        ...since,
      }) as { period: { startDate: string; endDate: string } };
      expect(metaReport.period).toEqual({
        startDate: dates.start_date,
        endDate: dates.end_date,
      });
      const traffic = reviewerDemoCall("google_analytics_traffic_overview", {
        ...ga4,
        ...dates,
      }) as { period: Array<{ startDate: string; endDate: string }> };
      expect(traffic.period).toEqual([
        { startDate: dates.start_date, endDate: dates.end_date },
      ]);
      const seo = reviewerDemoCall("get_search_console_report", {
        site_url: "sc-domain:demo.invalid",
        days: 7,
      }) as { period: { startDate: string; endDate: string }; days: number };
      expect(seo).toMatchObject({
        days: 7,
        period: { startDate: dates.start_date, endDate: dates.end_date },
      });
      const report = reviewerDemoCall("generate_monthly_ads_report", {
        ...google,
        ...dates,
      }) as {
        comparison: {
          period: { startDate: string; endDate: string };
          current_days: number;
          previous_days: number;
          durations_match: boolean;
        };
      };
      expect(report.comparison).toMatchObject({
        current_days: 7,
        previous_days: 7,
        durations_match: true,
        period: { startDate: "2026-10-08", endDate: "2026-10-14" },
      });
      const unequal = reviewerDemoCall("compare_periods", {
        ...google,
        current_start_date: "2026-10-15",
        current_end_date: "2026-10-21",
        previous_start_date: "2026-10-01",
        previous_end_date: "2026-10-14",
      }) as { comparison: { durations_match: boolean; warning?: string } };
      expect(unequal.comparison).toMatchObject({
        durations_match: false,
        warning: expect.any(String),
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed on foreign resource IDs and unsupported advanced GA4 filters", () => {
    expect(() =>
      reviewerDemoCall("google_analytics_run_report", {
        property_id: "123456",
        metrics: ["sessions"],
      }),
    ).toThrow("Demo account is unavailable");
    expect(() =>
      reviewerDemoCall("google_ads_check_negative_conflicts", {
        ...google,
        campaign_ids: ["123456"],
        negatives: [{ text: "demo" }],
      }),
    ).toThrow("Demo campaign is unavailable");
    expect(() =>
      reviewerDemoCall("google_analytics_run_report", {
        ...ga4,
        metrics: ["sessions"],
        dimension_filter: { filter: {} },
      }),
    ).toThrow("unavailable in the demo fixture");
    expect(() =>
      reviewerDemoCall("google_analytics_run_report", {
        ...ga4,
        metrics: ["unknownMetric"],
      }),
    ).toThrow("Unsupported demo metrics");
  });
});

import { ForbiddenException } from "@nestjs/common";
import type { ProviderId, ProviderMetricSummary } from "@holymedia/contracts";
import type { DatabaseService } from "../infrastructure/database.service.js";

/** Static fiction, reachable only after the server-side Workspace.reviewerDemo check. */
const accounts = [
  {
    provider: "GOOGLE_ADS",
    account_id: "9990000001",
    name: "DEMO · Northwind Shop",
    currency: "USD",
    timezone: "Etc/UTC",
    status: "active",
  },
  {
    provider: "META_ADS",
    account_id: "act_9990000002",
    name: "DEMO · Northwind Social",
    currency: "USD",
    timezone: "Etc/UTC",
    status: "active",
  },
  {
    provider: "GOOGLE_ANALYTICS",
    account_id: "999000003",
    name: "DEMO · Northwind GA4",
    currency: "USD",
    timezone: "Etc/UTC",
    status: "active",
  },
  {
    provider: "GOOGLE_SEARCH_CONSOLE",
    account_id: "sc-domain:demo.invalid",
    name: "DEMO · demo.invalid",
    currency: null,
    timezone: "Etc/UTC",
    status: "active",
  },
] as const;

const campaigns = [
  {
    id: "9991000001",
    name: "DEMO · Brand search",
    status: "ENABLED",
    objective: "TRAFFIC",
    dailyBudget: 75,
    impressions: 1400,
    clicks: 118,
    spend: 54,
    conversions: 12,
  },
  {
    id: "9991000002",
    name: "DEMO · Nonbrand search",
    status: "ENABLED",
    objective: "LEADS",
    dailyBudget: 115,
    impressions: 2400,
    clicks: 105,
    spend: 94,
    conversions: 8,
  },
  {
    id: "9991000003",
    name: "DEMO · Remarketing",
    status: "ENABLED",
    objective: "SALES",
    dailyBudget: 45,
    impressions: 950,
    clicks: 42,
    spend: 32,
    conversions: 5,
  },
  {
    id: "9991000004",
    name: "DEMO · Seasonal offer",
    status: "PAUSED",
    objective: "SALES",
    dailyBudget: 60,
    impressions: 750,
    clicks: 24,
    spend: 30,
    conversions: 1,
  },
  {
    id: "9991000005",
    name: "DEMO · Discovery",
    status: "ENABLED",
    objective: "AWARENESS",
    dailyBudget: 65,
    impressions: 3100,
    clicks: 55,
    spend: 51,
    conversions: 2,
  },
] as const;

const metaCampaigns = [
  {
    id: "demo-meta-1",
    name: "DEMO · Prospecting",
    status: "ACTIVE",
    objective: "LEADS",
    dailyBudget: 80,
    impressions: 2100,
    clicks: 74,
    spend: 64,
    conversions: 5,
  },
  {
    id: "demo-meta-2",
    name: "DEMO · Retargeting",
    status: "ACTIVE",
    objective: "SALES",
    dailyBudget: 45,
    impressions: 890,
    clicks: 39,
    spend: 30,
    conversions: 6,
  },
] as const;

type Campaign = {
  id: string;
  name: string;
  status: string;
  objective: string;
  dailyBudget: number;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number;
};

type Args = Record<string, unknown>;
type Range = { startDate: string; endDate: string };

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function date(value: unknown): string {
  const result = str(value);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    !Number.isFinite(Date.parse(result + "T00:00:00Z")) ||
    new Date(result + "T00:00:00Z").toISOString().slice(0, 10) !== result
  )
    throw new ForbiddenException("A valid YYYY-MM-DD date is required.");
  return result;
}

function requestedRange(args: Args, prefix = ""): Range {
  const startDate = date(args[`${prefix}start_date`]);
  const endDate = date(args[`${prefix}end_date`]);
  if (startDate > endDate)
    throw new ForbiddenException("Date range is invalid.");
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  if (days > 90)
    throw new ForbiddenException("Demo date range exceeds 90 days.");
  return { startDate, endDate };
}

function lastCompleteDays(days: number): Range {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() - 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function availableDayRange(): Range {
  return lastCompleteDays(28);
}

function daysInFixture(range: Range): Array<{ day: string; factor: number }> {
  const available = availableDayRange();
  const first = Math.max(
    Date.parse(range.startDate),
    Date.parse(available.startDate),
  );
  const last = Math.min(
    Date.parse(range.endDate),
    Date.parse(available.endDate),
  );
  const midpoint = Date.parse(available.endDate) - 13 * 86_400_000;
  const result: Array<{ day: string; factor: number }> = [];
  for (let time = first; time <= last; time += 86_400_000) {
    result.push({
      day: new Date(time).toISOString().slice(0, 10),
      factor: time >= midpoint ? 1.18 : 0.82,
    });
  }
  return result;
}

function provenance(provider: ProviderId) {
  return {
    provider,
    sourceApi: "HolyPilot isolated synthetic reviewer fixture",
    realData: false as const,
    dataStatus: "demo" as const,
    fetchedAt: new Date().toISOString(),
  };
}

function marks(provider: ProviderId) {
  return {
    realData: false,
    dataStatus: "demo",
    real_data: false,
    data_status: "demo",
    provenance: provenance(provider),
  };
}

function money(value: number) {
  return { amount: value.toFixed(2), currency: "USD" };
}

function metrics(
  range: Range,
  selected: ReadonlyArray<Campaign> = campaigns,
): ProviderMetricSummary {
  const days = daysInFixture(range);
  const factor = days.reduce((sum, item) => sum + item.factor, 0);
  const impressions = Math.round(
    selected.reduce((sum, item) => sum + item.impressions, 0) * factor,
  );
  const clicks = Math.round(
    selected.reduce((sum, item) => sum + item.clicks, 0) * factor,
  );
  const spend = selected.reduce((sum, item) => sum + item.spend, 0) * factor;
  const conversions = Math.round(
    selected.reduce((sum, item) => sum + item.conversions, 0) * factor,
  );
  return {
    spend: money(spend),
    impressions,
    clicks,
    ctr: impressions ? clicks / impressions : 0,
    cpc: clicks ? money(spend / clicks) : null,
    cpm: impressions ? money((spend / impressions) * 1000) : null,
    conversions,
    conversionValue: (conversions * 75).toFixed(2),
    costPerConversion: conversions ? money(spend / conversions) : null,
  };
}

function selectAccount(args: Args, allowed?: ProviderId[]) {
  const provider = str(args.provider).toUpperCase();
  const id = str(args.account_id ?? args.property_id ?? args.site_url);
  const account = accounts.find(
    (item) =>
      item.provider === provider &&
      item.account_id === id &&
      (!allowed || allowed.includes(item.provider)),
  );
  if (!account) throw new ForbiddenException("Demo account is unavailable.");
  return account;
}

function resource(account: (typeof accounts)[number]) {
  return {
    ...account,
    source: "synthetic_demo_fixture",
    ...marks(account.provider),
  };
}

function campaignRows(
  range: Range,
  provider: "GOOGLE_ADS" | "META_ADS" = "GOOGLE_ADS",
) {
  const selected = provider === "META_ADS" ? metaCampaigns : campaigns;
  return selected.map((item) => ({
    id: item.id,
    name: item.name,
    status: item.status,
    objective: item.objective,
    budget: money(item.dailyBudget),
    metrics: metrics(range, [item]),
    ...marks(provider),
  }));
}

function changes(
  current: ProviderMetricSummary,
  previous: ProviderMetricSummary,
) {
  const keys = ["spend", "impressions", "clicks", "conversions"] as const;
  return Object.fromEntries(
    keys.map((key) => {
      const number = (value: unknown) =>
        typeof value === "number"
          ? value
          : Number((value as { amount?: string } | null)?.amount ?? 0);
      const now = number(current[key]);
      const before = number(previous[key]);
      return [
        key,
        {
          current: current[key],
          previous: previous[key],
          absolute: now - before,
          percent: before ? ((now - before) / Math.abs(before)) * 100 : null,
        },
      ];
    }),
  );
}

/**
 * Fail closed for every tool not explicitly listed below, including diagnostics,
 * previews, commits and any future public tools. No provider adapter is called.
 */
export function reviewerDemoCall(name: string, args: Args): unknown {
  if (
    name === "list_ad_accounts" ||
    name === "list_accounts" ||
    name === "list_connected_platforms"
  ) {
    const requested = str(args.provider).toUpperCase();
    return accounts
      .filter(
        (item) =>
          (name !== "list_ad_accounts" ||
            ["GOOGLE_ADS", "META_ADS"].includes(item.provider)) &&
          (!requested || requested === item.provider),
      )
      .map(resource);
  }
  if (name === "list_connected_resources")
    return {
      advertising_accounts: accounts
        .filter((item) => ["GOOGLE_ADS", "META_ADS"].includes(item.provider))
        .map(resource),
      analytics_properties: accounts
        .filter((item) => item.provider === "GOOGLE_ANALYTICS")
        .map(resource),
      seo_properties: accounts
        .filter((item) => item.provider === "GOOGLE_SEARCH_CONSOLE")
        .map(resource),
      source: "synthetic_demo_fixture",
      realData: false,
      dataStatus: "demo",
    };
  if (
    name === "list_search_console_properties" ||
    name === "google_analytics_list_properties"
  ) {
    const provider =
      name === "list_search_console_properties"
        ? "GOOGLE_SEARCH_CONSOLE"
        : "GOOGLE_ANALYTICS";
    return {
      properties: accounts
        .filter((item) => item.provider === provider)
        .map(resource),
      ...marks(provider),
    };
  }
  if (name === "get_account_status") {
    const account = selectAccount(args);
    return {
      ...resource(account),
      enabled: true,
      source: "synthetic_demo_fixture",
      live_connection_checked: false,
    };
  }
  if (name === "list_campaigns") {
    const account = selectAccount(args, ["GOOGLE_ADS", "META_ADS"]);
    const campaignProvider = account.provider as "GOOGLE_ADS" | "META_ADS";
    const range =
      args.start_date === undefined && args.end_date === undefined
        ? lastCompleteDays(14)
        : requestedRange(args);
    const limit = args.limit === undefined ? 100 : Number(args.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || args.cursor)
      throw new ForbiddenException("Invalid demo limit or cursor.");
    return {
      provider: account.provider,
      account_id: account.account_id,
      items: campaignRows(range, campaignProvider).slice(0, limit),
      ...marks(account.provider),
    };
  }
  if (
    [
      "get_campaign",
      "get_campaign_statuses",
      "get_status_summary",
      "get_top_performers",
      "get_campaign_structure",
    ].includes(name)
  ) {
    const account = selectAccount(args, ["GOOGLE_ADS", "META_ADS"]);
    const campaignProvider = account.provider as "GOOGLE_ADS" | "META_ADS";
    const range =
      args.start_date === undefined && args.end_date === undefined
        ? lastCompleteDays(14)
        : requestedRange(args);
    const rows = campaignRows(range, campaignProvider);
    if (name === "get_campaign") {
      const row = rows.find((item) => item.id === str(args.campaign_id));
      if (!row) throw new ForbiddenException("Demo campaign is unavailable.");
      return { ...row, ...marks(account.provider) };
    }
    if (name === "get_status_summary" || name === "get_campaign_statuses") {
      const counts = Object.fromEntries(
        [...new Set(rows.map((item) => item.status))].map((status) => [
          status,
          rows.filter((item) => item.status === status).length,
        ]),
      );
      return {
        account_id: account.account_id,
        campaigns: counts,
        complete: true,
        ...marks(account.provider),
      };
    }
    if (name === "get_top_performers") {
      const metric = str(args.metric) || "conversions";
      if (!["impressions", "clicks", "conversions", "spend"].includes(metric))
        throw new ForbiddenException("Unsupported demo ranking metric.");
      const limit = args.limit === undefined ? 10 : Number(args.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new ForbiddenException("Invalid demo limit.");
      const value = (item: (typeof rows)[number]) =>
        metric === "spend"
          ? Number(item.metrics.spend?.amount ?? 0)
          : Number(
              item.metrics[metric as "impressions" | "clicks" | "conversions"],
            );
      return {
        account_id: account.account_id,
        period: range,
        metric,
        items: [...rows].sort((a, b) => value(b) - value(a)).slice(0, limit),
        ...marks(account.provider),
      };
    }
    return {
      account_id: account.account_id,
      period: range,
      items: rows,
      ...marks(account.provider),
    };
  }
  if (
    [
      "get_basic_metrics",
      "get_performance_report",
      "get_spend_overview",
      "get_account_summary",
      "get_meta_ads_detailed_report",
      "get_google_ads_detailed_report",
    ].includes(name)
  ) {
    const account = selectAccount(args, ["GOOGLE_ADS", "META_ADS"]);
    const campaignProvider = account.provider as "GOOGLE_ADS" | "META_ADS";
    const range =
      args.start_date === undefined && args.end_date === undefined
        ? lastCompleteDays(14)
        : requestedRange(args);
    const rows = campaignRows(range, campaignProvider);
    const chosen = account.provider === "META_ADS" ? metaCampaigns : campaigns;
    const requestedCampaign = str(args.campaign_id);
    const selected = requestedCampaign
      ? chosen.filter((item) => item.id === requestedCampaign)
      : chosen;
    if (requestedCampaign && !selected.length)
      throw new ForbiddenException("Demo campaign is unavailable.");
    const summary = metrics(range, selected);
    if (name === "get_basic_metrics")
      return { ...summary, ...marks(account.provider) };
    if (name === "get_spend_overview")
      return {
        provider: account.provider,
        account_id: account.account_id,
        period: range,
        spend: summary.spend,
        ...marks(account.provider),
      };
    return {
      provider: account.provider,
      account_id: account.account_id,
      period: range,
      metrics: summary,
      campaigns: { items: rows },
      ...marks(account.provider),
    };
  }
  if (name === "compare_periods" || name === "generate_monthly_ads_report") {
    const account = selectAccount(args, ["GOOGLE_ADS"]);
    const currentPeriod =
      name === "compare_periods"
        ? requestedRange(args, "current_")
        : args.start_date && args.end_date
          ? requestedRange(args)
          : lastCompleteDays(14);
    const previousPeriod =
      name === "compare_periods"
        ? requestedRange(args, "previous_")
        : args.previous_start_date && args.previous_end_date
          ? requestedRange(args, "previous_")
          : {
              startDate: new Date(
                Date.parse(currentPeriod.startDate) - 14 * 86_400_000,
              )
                .toISOString()
                .slice(0, 10),
              endDate: new Date(
                Date.parse(currentPeriod.startDate) - 86_400_000,
              )
                .toISOString()
                .slice(0, 10),
            };
    const current = metrics(currentPeriod);
    const previous = metrics(previousPeriod);
    const common = {
      provider: account.provider,
      account_id: account.account_id,
      current_period: currentPeriod,
      previous_period: previousPeriod,
      current,
      previous,
      changes: changes(current, previous),
      ...marks("GOOGLE_ADS"),
    };
    if (name === "compare_periods") return common;
    return {
      reportType: "performance",
      generatedAt: new Date().toISOString(),
      period: currentPeriod,
      account: resource(account),
      metrics: current,
      campaigns: campaignRows(currentPeriod),
      comparison: {
        period: previousPeriod,
        metrics: previous,
        changes: common.changes,
      },
      insights: [
        "Synthetic example: compare conversion volume and cost per conversion across periods.",
        "Synthetic example: inspect the seasonal campaign before changing any budget.",
      ],
      ...marks("GOOGLE_ADS"),
    };
  }
  if (
    name === "google_ads_list_keywords" ||
    name === "google_ads_search_terms" ||
    name === "google_ads_list_negatives"
  ) {
    selectAccount({ ...args, provider: "GOOGLE_ADS" }, ["GOOGLE_ADS"]);
    const items =
      name === "google_ads_list_keywords"
        ? [
            {
              id: "9992000001",
              keyword: "demo running shoes",
              campaign_id: campaigns[1].id,
              status: "ENABLED",
              clicks: 34,
              conversions: 3,
            },
            {
              id: "9992000002",
              keyword: "demo brand",
              campaign_id: campaigns[0].id,
              status: "ENABLED",
              clicks: 62,
              conversions: 7,
            },
          ]
        : name === "google_ads_search_terms"
          ? [
              {
                search_term: "northwind demo trainers",
                clicks: 30,
                conversions: 4,
                spend: money(18),
              },
              {
                search_term: "free trainers demo",
                clicks: 18,
                conversions: 0,
                spend: money(14),
              },
            ]
          : [{ id: "9993000001", text: "free", level: "ACCOUNT" }];
    return { items, nextCursor: null, ...marks("GOOGLE_ADS") };
  }
  if (name === "google_analytics_traffic_overview") {
    selectAccount({ ...args, provider: "GOOGLE_ANALYTICS" }, [
      "GOOGLE_ANALYTICS",
    ]);
    return {
      property_id: "999000003",
      users: 840,
      sessions: 1120,
      engaged_sessions: 730,
      period: lastCompleteDays(14),
      ...marks("GOOGLE_ANALYTICS"),
    };
  }
  if (name === "get_search_console_report") {
    const site = str(args.site_url);
    if (site !== "sc-domain:demo.invalid")
      throw new ForbiddenException("Demo property is unavailable.");
    return {
      status: "ok",
      selected_property: site,
      properties: [resource(accounts[3])],
      clicks: 210,
      impressions: 5250,
      ctr: 0.04,
      position: 12.3,
      period: lastCompleteDays(28),
      ...marks("GOOGLE_SEARCH_CONSOLE"),
    };
  }
  throw new ForbiddenException(
    "This tool is unavailable in the isolated demo workspace.",
  );
}

export const REVIEWER_DEMO_ACCOUNT_IDS = accounts.map(
  (account) => account.account_id,
);

export async function isReviewerDemoWorkspace(
  database: DatabaseService,
  workspaceId: string,
): Promise<boolean> {
  const workspace = await database.client.workspace.findUnique({
    where: { id: workspaceId },
    select: { reviewerDemo: true, accessStatus: true },
  });
  if (workspace?.reviewerDemo && workspace.accessStatus !== "ACTIVE")
    throw new ForbiddenException("Demo workspace is not active.");
  return workspace?.reviewerDemo === true;
}

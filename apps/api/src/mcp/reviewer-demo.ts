import { ForbiddenException } from "@nestjs/common";
import type { ProviderId, ProviderMetricSummary } from "@holymedia/contracts";
import type { DatabaseService } from "../infrastructure/database.service.js";

/** Static fiction, reachable only after the trusted server-side entitlement check. */
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

function periodDays(range: Range): number {
  return (
    (Date.parse(range.endDate) - Date.parse(range.startDate)) / 86_400_000 + 1
  );
}

function demoLimit(args: Args, maximum = 500, fallback = 100): number {
  const value = args.limit === undefined ? fallback : args.limit;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maximum
  )
    throw new ForbiddenException("Invalid demo limit.");
  return value;
}

function noCursor(args: Args): void {
  if (args.cursor !== undefined)
    throw new ForbiddenException("Demo cursor is unavailable.");
}

function onlyArguments(args: Args, allowed: readonly string[]): void {
  const unknown = Object.keys(args).find((key) => !allowed.includes(key));
  if (unknown) throw new ForbiddenException("Unsupported demo argument.");
}

function stringIds(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    !value.length ||
    value.some((id) => typeof id !== "string" || !id)
  )
    throw new ForbiddenException(`Invalid demo ${field}.`);
  return value;
}

function selectedRange(
  args: Args,
  mode: "standard" | "since" = "standard",
): Range {
  if (
    mode === "since" &&
    (args.start_date !== undefined || args.end_date !== undefined)
  )
    throw new ForbiddenException("Use since/until for this demo tool.");
  const start = mode === "since" ? args.since : args.start_date;
  const end = mode === "since" ? args.until : args.end_date;
  if (args.date_preset !== undefined) {
    if (start !== undefined || end !== undefined)
      throw new ForbiddenException("Use dates or date_preset, not both.");
    const days = (
      { last_7d: 7, last_14d: 14, last_30d: 30 } as Record<string, number>
    )[str(args.date_preset)];
    if (!days) throw new ForbiddenException("Invalid demo date_preset.");
    return lastCompleteDays(days);
  }
  if (start === undefined && end === undefined) return lastCompleteDays(14);
  return requestedRange(
    mode === "since" ? { start_date: start, end_date: end } : args,
  );
}

function previousEqualPeriod(current: Range): Range {
  const start =
    Date.parse(current.startDate) - periodDays(current) * 86_400_000;
  return {
    startDate: new Date(start).toISOString().slice(0, 10),
    endDate: new Date(Date.parse(current.startDate) - 86_400_000)
      .toISOString()
      .slice(0, 10),
  };
}

function comparisonNote(current: Range, previous: Range) {
  const currentDays = periodDays(current);
  const previousDays = periodDays(previous);
  return {
    current_days: currentDays,
    previous_days: previousDays,
    durations_match: currentDays === previousDays,
    ...(currentDays === previousDays
      ? {}
      : {
          warning:
            "Periods have different lengths; absolute and percent changes are not normalized per day.",
        }),
  };
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
  if (
    range.startDate < available.startDate ||
    range.endDate > available.endDate
  )
    throw new ForbiddenException(
      "Requested demo period is outside the available synthetic fixture.",
    );
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

const ga4Metrics = new Set([
  "activeUsers",
  "totalUsers",
  "newUsers",
  "sessions",
  "engagedSessions",
  "engagementRate",
  "screenPageViews",
  "keyEvents",
  "totalRevenue",
  "userEngagementDuration",
  "eventCount",
]);
const ga4Dimensions = new Set([
  "date",
  "sessionSourceMedium",
  "landingPagePlusQueryString",
  "unifiedScreenClass",
  "eventName",
  "deviceCategory",
  "country",
]);

function ga4Strings(
  value: unknown,
  allowed: Set<string>,
  fallback: string[],
  field: string,
): string[] {
  if (value === undefined) return fallback;
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !allowed.has(item))
  )
    throw new ForbiddenException(`Unsupported demo ${field}.`);
  return value;
}

function ga4Report(
  args: Args,
  dimensions: string[],
  metricNames: string[],
  realtime = false,
) {
  const account = selectAccount({ ...args, provider: "GOOGLE_ANALYTICS" }, [
    "GOOGLE_ANALYTICS",
  ]);
  const dates = realtime ? undefined : selectedRange(args);
  const days = dates ? daysInFixture(dates) : [];
  const limit = demoLimit(args, 1000);
  const base = days.reduce((sum, day) => sum + day.factor, 0);
  const values: Record<string, string> = {
    activeUsers: String(Math.round(60 * base)),
    totalUsers: String(Math.round(65 * base)),
    newUsers: String(Math.round(18 * base)),
    sessions: String(Math.round(80 * base)),
    engagedSessions: String(Math.round(52 * base)),
    engagementRate: "0.65",
    screenPageViews: String(Math.round(130 * base)),
    keyEvents: String(Math.round(7 * base)),
    totalRevenue: (120 * base).toFixed(2),
    userEngagementDuration: String(Math.round(3400 * base)),
    eventCount: String(Math.round(170 * base)),
  };
  if (realtime) values.activeUsers = "4";
  const dimensionValues: Record<string, string> = {
    date: dates?.endDate.replaceAll("-", "") ?? "",
    sessionSourceMedium: "google / cpc",
    landingPagePlusQueryString: "/demo",
    unifiedScreenClass: "/demo",
    eventName: "page_view",
    deviceCategory: "desktop",
    country: "Kazakhstan",
  };
  const row = (day?: string) => ({
    dimensionValues: dimensions.map((name) => ({
      value:
        name === "date" && day
          ? day.replaceAll("-", "")
          : dimensionValues[name],
    })),
    metricValues: metricNames.map((name) => ({
      value:
        day && name !== "engagementRate"
          ? String(Number(values[name]) / Math.max(days.length, 1))
          : values[name],
    })),
  });
  const rows =
    dimensions.includes("date") && dates
      ? days.map((day) => row(day.day))
      : [row()];
  return {
    property: {
      property_id: account.account_id,
      name: account.name,
      timezone: account.timezone,
      currency: account.currency,
    },
    ...(dates ? { period: [dates] } : {}),
    dimensions,
    metrics: metricNames,
    rows: rows.slice(0, limit),
    totals: [{ metricValues: row().metricValues }],
    row_count: rows.length,
    metadata: { synthetic: true },
    quota: null,
    ...marks("GOOGLE_ANALYTICS"),
  };
}

/** Fail closed for tools not explicitly listed below. No provider adapter is called. */
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
  if (name === "run_connection_diagnostics") {
    const account = selectAccount(args, ["GOOGLE_ADS", "META_ADS"]);
    return {
      account_id: account.account_id,
      provider: account.provider,
      connection_status: "synthetic_demo_only",
      live_connection_checked: false,
      credential_refreshed: false,
      external_requests: 0,
      ...marks(account.provider),
    };
  }
  if (name === "get_meta_oauth_permissions") {
    onlyArguments(args, ["account_id"]);
    const id = str(args.account_id);
    if (id)
      selectAccount({ provider: "META_ADS", account_id: id }, ["META_ADS"]);
    return {
      account_id: id || "act_9990000002",
      requested: [],
      granted: [],
      declined: [],
      missing: [],
      status: "SYNTHETIC_DEMO",
      live_connection_checked: false,
      note: "Synthetic reviewer fixture; no Meta OAuth grant or credential exists.",
      ...marks("META_ADS"),
    };
  }
  if (name === "list_campaigns") {
    const account = selectAccount(args, ["GOOGLE_ADS", "META_ADS"]);
    const campaignProvider = account.provider as "GOOGLE_ADS" | "META_ADS";
    onlyArguments(args, [
      "provider",
      "account_id",
      "start_date",
      "end_date",
      "limit",
      "cursor",
      "statuses",
    ]);
    const range = selectedRange(args);
    const limit = demoLimit(args);
    noCursor(args);
    const statuses = stringIds(args.statuses, "statuses");
    if (
      statuses &&
      (account.provider !== "GOOGLE_ADS" ||
        statuses.some(
          (status) => !["ENABLED", "PAUSED", "REMOVED"].includes(status),
        ))
    )
      throw new ForbiddenException("Invalid demo statuses.");
    return {
      provider: account.provider,
      account_id: account.account_id,
      items: campaignRows(range, campaignProvider)
        .filter((row) => !statuses || statuses.includes(row.status))
        .slice(0, limit),
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
    const range = selectedRange(args);
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
      if (
        ![
          "impressions",
          "clicks",
          "conversions",
          "spend",
          "conversionValue",
        ].includes(metric)
      )
        throw new ForbiddenException("Unsupported demo ranking metric.");
      const limit = demoLimit(args, 100, 10);
      const value = (item: (typeof rows)[number]) =>
        metric === "spend"
          ? Number(item.metrics.spend?.amount ?? 0)
          : metric === "conversionValue"
            ? Number(item.metrics.conversionValue ?? 0)
            : Number(
                item.metrics[
                  metric as "impressions" | "clicks" | "conversions"
                ],
              );
      return {
        account_id: account.account_id,
        period: range,
        metric,
        items: [...rows].sort((a, b) => value(b) - value(a)).slice(0, limit),
        ...marks(account.provider),
      };
    }
    const requestedCampaign = str(args.campaign_id);
    if (requestedCampaign && !rows.some((row) => row.id === requestedCampaign))
      throw new ForbiddenException("Demo campaign is unavailable.");
    return {
      account_id: account.account_id,
      period: range,
      items: requestedCampaign
        ? rows.filter((row) => row.id === requestedCampaign)
        : rows,
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
    if (
      (name === "get_meta_ads_detailed_report" &&
        account.provider !== "META_ADS") ||
      (name === "get_google_ads_detailed_report" &&
        account.provider !== "GOOGLE_ADS")
    )
      throw new ForbiddenException("Demo account is unavailable.");
    if (name === "get_meta_ads_detailed_report") {
      onlyArguments(args, [
        "provider",
        "account_id",
        "since",
        "until",
        "date_preset",
        "metrics",
        "level",
        "limit",
        "cursor",
      ]);
      noCursor(args);
      if (args.metrics !== undefined)
        throw new ForbiddenException(
          "Custom Meta metrics are unavailable in the demo fixture.",
        );
      if (args.level !== undefined && args.level !== "campaign")
        throw new ForbiddenException("Unsupported demo Meta level.");
    }
    if (name === "get_google_ads_detailed_report") {
      noCursor(args);
      if (
        args.report_type !== undefined &&
        !["campaign", "campaigns", "campaign_performance"].includes(
          str(args.report_type),
        )
      )
        throw new ForbiddenException("Unsupported demo report_type.");
    }
    const campaignProvider = account.provider as "GOOGLE_ADS" | "META_ADS";
    const range = selectedRange(
      args,
      name === "get_meta_ads_detailed_report" ? "since" : "standard",
    );
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
    const limit = demoLimit(
      args,
      name === "get_meta_ads_detailed_report" ? 100 : 500,
    );
    return {
      provider: account.provider,
      account_id: account.account_id,
      period: range,
      metrics: summary,
      campaigns: { items: rows.slice(0, limit) },
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
          : previousEqualPeriod(currentPeriod);
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
      comparison: comparisonNote(currentPeriod, previousPeriod),
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
        ...comparisonNote(currentPeriod, previousPeriod),
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
    noCursor(args);
    const campaignIds = stringIds(args.campaign_ids, "campaign_ids");
    if (
      campaignIds?.some(
        (id) => !campaigns.some((campaign) => campaign.id === id),
      )
    )
      throw new ForbiddenException("Demo campaign is unavailable.");
    const limit = demoLimit(args);
    if (
      name === "google_ads_search_terms" &&
      (args.since === undefined || args.until === undefined)
    )
      throw new ForbiddenException(
        "Demo search terms require since and until.",
      );
    const range =
      name === "google_ads_list_negatives"
        ? undefined
        : selectedRange(args, "since");
    const periodFactor = range
      ? daysInFixture(range).reduce((sum, day) => sum + day.factor, 0) / 7
      : 1;
    const items =
      name === "google_ads_list_keywords"
        ? [
            {
              id: "9992000001",
              keyword: "demo running shoes",
              text: "demo running shoes",
              resource_name:
                "customers/9990000001/adGroupCriteria/9994000002~9992000001",
              criterion_id: "9992000001",
              campaign_id: campaigns[1].id,
              campaign_name: campaigns[1].name,
              campaign_status: campaigns[1].status,
              ad_group_id: "9994000002",
              ad_group_name: "DEMO · Nonbrand",
              ad_group_status: "ENABLED",
              status: "ENABLED",
              match_type: "BROAD",
              serving_status: "ELIGIBLE",
              approval_status: "APPROVED",
              quality_score: 6,
              cpc: 0.71,
              effective_cpc: 0.71,
              final_urls: ["https://demo.invalid/shoes"],
              impressions: 410,
              clicks: 34,
              conversions: 3,
              all_conversions: 3,
              cost: 24,
              currency: "USD",
              cost_per_conversion: 8,
              duplicate_in_campaigns: [],
              spend: money(24),
            },
            {
              id: "9992000002",
              keyword: "demo brand",
              text: "demo brand",
              resource_name:
                "customers/9990000001/adGroupCriteria/9994000001~9992000002",
              criterion_id: "9992000002",
              campaign_id: campaigns[0].id,
              campaign_name: campaigns[0].name,
              campaign_status: campaigns[0].status,
              ad_group_id: "9994000001",
              ad_group_name: "DEMO · Brand",
              ad_group_status: "ENABLED",
              status: "ENABLED",
              match_type: "EXACT",
              serving_status: "ELIGIBLE",
              approval_status: "APPROVED",
              quality_score: 9,
              cpc: 0.68,
              effective_cpc: 0.68,
              final_urls: ["https://demo.invalid"],
              impressions: 760,
              clicks: 62,
              conversions: 7,
              all_conversions: 7,
              cost: 42,
              currency: "USD",
              cost_per_conversion: 6,
              duplicate_in_campaigns: [],
              spend: money(42),
            },
          ]
        : name === "google_ads_search_terms"
          ? [
              {
                search_term: "northwind demo trainers",
                search_term_status: "ADDED",
                triggered_keyword: "demo brand",
                triggered_keyword_match_type: "EXACT",
                search_term_match_type: "EXACT",
                campaign_id: campaigns[0].id,
                campaign_name: campaigns[0].name,
                ad_group_id: "9994000001",
                ad_group_name: "DEMO · Brand",
                added: true,
                impressions: 320,
                clicks: 30,
                conversions: 4,
                cost: 18,
                currency: "USD",
                cost_per_conversion: 4.5,
                spend: money(18),
              },
              {
                search_term: "free trainers demo",
                search_term_status: "NONE",
                triggered_keyword: "demo running shoes",
                triggered_keyword_match_type: "BROAD",
                search_term_match_type: "BROAD",
                campaign_id: campaigns[1].id,
                campaign_name: campaigns[1].name,
                ad_group_id: "9994000002",
                ad_group_name: "DEMO · Nonbrand",
                added: false,
                impressions: 270,
                clicks: 18,
                conversions: 0,
                cost: 14,
                currency: "USD",
                cost_per_conversion: null,
                spend: money(14),
              },
            ]
          : [{ id: "9993000001", text: "free", level: "ACCOUNT" }];
    if (name === "google_ads_list_keywords") {
      onlyArguments(args, [
        "provider",
        "account_id",
        "campaign_ids",
        "ad_group_ids",
        "statuses",
        "since",
        "until",
        "min_cost",
        "limit",
        "cursor",
      ]);
      const adGroupIds = stringIds(args.ad_group_ids, "ad_group_ids");
      const statuses = stringIds(args.statuses, "statuses");
      if (
        statuses?.some(
          (status) => !["ENABLED", "PAUSED", "REMOVED"].includes(status),
        )
      )
        throw new ForbiddenException("Invalid demo statuses.");
      const minCost = args.min_cost === undefined ? 0 : Number(args.min_cost);
      if (!Number.isFinite(minCost) || minCost < 0)
        throw new ForbiddenException("Invalid demo min_cost.");
      const keywords = items as Array<{
        campaign_id: string;
        ad_group_id: string;
        status: string;
        cost: number;
        clicks: number;
        conversions: number;
        impressions: number;
      }>;
      return {
        items: keywords
          .filter(
            (item) =>
              (!campaignIds || campaignIds.includes(item.campaign_id)) &&
              (!adGroupIds || adGroupIds.includes(item.ad_group_id)) &&
              (!statuses || statuses.includes(item.status)) &&
              item.cost * periodFactor >= minCost,
          )
          .slice(0, limit)
          .map((item) => {
            const conversions = Math.round(item.conversions * periodFactor);
            const cost = Number((item.cost * periodFactor).toFixed(2));
            return {
              ...item,
              cost,
              conversions,
              clicks: Math.round(item.clicks * periodFactor),
              impressions: Math.round(item.impressions * periodFactor),
              cost_per_conversion: conversions ? cost / conversions : null,
              spend: money(cost),
            };
          }),
        nextCursor: null,
        period: range,
        ...marks("GOOGLE_ADS"),
      };
    }
    if (name === "google_ads_search_terms") {
      onlyArguments(args, [
        "provider",
        "account_id",
        "since",
        "until",
        "campaign_ids",
        "min_cost",
        "contains",
        "only_not_added",
        "limit",
        "cursor",
        "format",
      ]);
      if (args.format !== undefined && args.format !== "json")
        throw new ForbiddenException("Demo CSV is unavailable.");
      if (
        args.only_not_added !== undefined &&
        typeof args.only_not_added !== "boolean"
      )
        throw new ForbiddenException("Invalid demo only_not_added.");
      const minCost = args.min_cost === undefined ? 0 : Number(args.min_cost);
      if (!Number.isFinite(minCost) || minCost < 0)
        throw new ForbiddenException("Invalid demo min_cost.");
      const contains = str(args.contains).toLowerCase();
      const terms = items as Array<{
        campaign_id: string;
        search_term: string;
        added: boolean;
        cost: number;
        clicks: number;
        conversions: number;
        impressions: number;
      }>;
      return {
        items: terms
          .filter(
            (item) =>
              (!campaignIds || campaignIds.includes(item.campaign_id)) &&
              (!contains ||
                item.search_term.toLowerCase().includes(contains)) &&
              (args.only_not_added !== true || !item.added) &&
              item.cost * periodFactor >= minCost,
          )
          .slice(0, limit)
          .map((item) => {
            const conversions = Math.round(item.conversions * periodFactor);
            const cost = Number((item.cost * periodFactor).toFixed(2));
            return {
              ...item,
              cost,
              conversions,
              clicks: Math.round(item.clicks * periodFactor),
              impressions: Math.round(item.impressions * periodFactor),
              cost_per_conversion: conversions ? cost / conversions : null,
              spend: money(cost),
            };
          }),
        next_cursor: null,
        metadata: {
          source: "search_term_view",
          privacyNotice: "Synthetic fixture; no provider query was made.",
          pmaxSupported: false,
        },
        period: range,
        ...marks("GOOGLE_ADS"),
      };
    }
    onlyArguments(args, [
      "provider",
      "account_id",
      "campaign_ids",
      "levels",
      "limit",
      "cursor",
    ]);
    const levels = stringIds(args.levels, "levels");
    if (
      levels?.some(
        (level) => !["campaign", "ad_group", "shared_list"].includes(level),
      )
    )
      throw new ForbiddenException("Invalid demo levels.");
    // The only synthetic negative is a campaign negative attached to the first fixture campaign.
    const negativeCampaign = campaigns[0];
    const included =
      (!campaignIds || campaignIds.includes(negativeCampaign.id)) &&
      (!levels || levels.includes("campaign"));
    return {
      account_id: "9990000001",
      page_section: "campaign",
      campaign: {
        campaigns:
          included && limit > 0
            ? [
                {
                  campaign_id: negativeCampaign.id,
                  campaign_name: negativeCampaign.name,
                  negatives: [
                    {
                      resource_name:
                        "customers/9990000001/campaignCriteria/9991000001~9993000001",
                      criterion_id: "9993000001",
                      text: "free",
                      match_type: "BROAD",
                      status: "ENABLED",
                    },
                  ],
                },
              ]
            : [],
      },
      ad_group: { campaigns: [] },
      shared_list: { lists: [] },
      next_cursor: null,
      ...marks("GOOGLE_ADS"),
    };
  }
  if (name === "google_ads_check_negative_conflicts") {
    onlyArguments(args, [
      "provider",
      "account_id",
      "campaign_ids",
      "negatives",
      "limit",
      "cursor",
    ]);
    selectAccount({ ...args, provider: "GOOGLE_ADS" }, ["GOOGLE_ADS"]);
    noCursor(args);
    const ids = stringIds(args.campaign_ids, "campaign_ids");
    if (
      !ids ||
      ids.some((id) => !campaigns.some((campaign) => campaign.id === id))
    )
      throw new ForbiddenException("Demo campaign is unavailable.");
    if (
      !Array.isArray(args.negatives) ||
      !args.negatives.length ||
      args.negatives.some(
        (item) =>
          !item ||
          typeof item !== "object" ||
          typeof (item as { text?: unknown }).text !== "string",
      )
    )
      throw new ForbiddenException("Invalid demo negatives.");
    const positives = [
      {
        campaign: campaigns[0],
        text: "demo brand",
        keyword_id: "9992000002",
        ad_group_id: "9994000001",
      },
      {
        campaign: campaigns[1],
        text: "demo running shoes",
        keyword_id: "9992000001",
        ad_group_id: "9994000002",
      },
    ];
    const normalized = args.negatives.map((negative) => ({
      text: str((negative as { text: string }).text).toLowerCase(),
      match_type:
        str((negative as { match_type?: string }).match_type) || "BROAD",
    }));
    if (
      normalized.some(
        (item) =>
          !item.text || !["BROAD", "PHRASE", "EXACT"].includes(item.match_type),
      )
    )
      throw new ForbiddenException("Invalid demo negatives.");
    const conflicts = normalized.flatMap((negative) => {
      const text = negative.text;
      return positives
        .filter(
          (positive) =>
            ids.includes(positive.campaign.id) &&
            (positive.text === text || positive.text.includes(text)),
        )
        .map((positive) => ({
          negative,
          keyword: {
            resource_name: `customers/9990000001/adGroupCriteria/${positive.ad_group_id}~${positive.keyword_id}`,
            criterion_id: positive.keyword_id,
            text: positive.text,
            match_type: "BROAD",
            status: "ENABLED",
          },
          campaign: { id: positive.campaign.id, name: positive.campaign.name },
          ad_group: { id: positive.ad_group_id, name: "DEMO · Search" },
          reason: {
            code: "TEXT_MATCH",
            message:
              "Synthetic text overlap only; close variants are not checked.",
          },
        }));
    });
    return {
      account_id: "9990000001",
      conflicts: conflicts.slice(0, demoLimit(args)),
      normalized_negatives: normalized,
      next_cursor: null,
      note: "Synthetic text matching only; no Google close variants.",
      ...marks("GOOGLE_ADS"),
    };
  }
  if (name === "get_flexible_insights") {
    onlyArguments(args, [
      "provider",
      "account_id",
      "level",
      "campaign_id",
      "limit",
      "cursor",
      "start_date",
      "end_date",
      "since",
      "until",
      "date_preset",
    ]);
    const account = selectAccount(args, ["GOOGLE_ADS", "META_ADS"]);
    noCursor(args);
    if (
      (args.start_date !== undefined || args.end_date !== undefined) &&
      (args.since !== undefined ||
        args.until !== undefined ||
        args.date_preset !== undefined)
    )
      throw new ForbiddenException("Conflicting demo date fields.");
    const range =
      args.since !== undefined ||
      args.until !== undefined ||
      args.date_preset !== undefined
        ? selectedRange(args, "since")
        : selectedRange(args);
    const level = str(args.level) || "account";
    if (!["account", "campaign"].includes(level))
      throw new ForbiddenException("Unsupported demo insight level.");
    const campaignProvider = account.provider as "GOOGLE_ADS" | "META_ADS";
    const rows = campaignRows(range, campaignProvider);
    const campaignId = str(args.campaign_id);
    if (campaignId && !rows.some((row) => row.id === campaignId))
      throw new ForbiddenException("Demo campaign is unavailable.");
    return {
      account_id: account.account_id,
      provider: account.provider,
      level,
      period: range,
      ...(level === "campaign"
        ? {
            items: rows
              .filter((row) => !campaignId || row.id === campaignId)
              .slice(0, demoLimit(args)),
          }
        : {
            metrics: metrics(
              range,
              campaignProvider === "META_ADS" ? metaCampaigns : campaigns,
            ),
          }),
      ...marks(account.provider),
    };
  }
  if (name.startsWith("google_analytics_")) {
    const account = selectAccount({ ...args, provider: "GOOGLE_ANALYTICS" }, [
      "GOOGLE_ANALYTICS",
    ]);
    if (name === "google_analytics_get_property") {
      onlyArguments(args, ["property_id"]);
      return {
        property_id: account.account_id,
        name: account.name,
        timezone: account.timezone,
        currency: account.currency,
        live_connection_checked: false,
        ...marks("GOOGLE_ANALYTICS"),
      };
    }
    if (
      name === "google_analytics_list_google_ads_links" ||
      name === "google_analytics_get_custom_dimensions_metrics"
    ) {
      onlyArguments(args, ["property_id"]);
      return name === "google_analytics_list_google_ads_links"
        ? {
            links: [],
            note: "No Google Ads link exists in the synthetic fixture.",
            ...marks("GOOGLE_ANALYTICS"),
          }
        : {
            customDimensions: [],
            customMetrics: [],
            note: "No custom definitions exist in the synthetic fixture.",
            ...marks("GOOGLE_ANALYTICS"),
          };
    }
    if (name === "google_analytics_check_compatibility") {
      onlyArguments(args, ["property_id", "dimensions", "metrics"]);
      const dimensions = ga4Strings(
        args.dimensions,
        ga4Dimensions,
        [],
        "dimensions",
      );
      const metricNames = ga4Strings(args.metrics, ga4Metrics, [], "metrics");
      if (!metricNames.length)
        throw new ForbiddenException("At least one demo metric is required.");
      return {
        dimensionCompatibilities: dimensions.map((dimension) => ({
          dimensionMetadata: { apiName: dimension },
          compatibility: "COMPATIBLE",
        })),
        metricCompatibilities: metricNames.map((metric) => ({
          metricMetadata: { apiName: metric },
          compatibility: "COMPATIBLE",
        })),
        ...marks("GOOGLE_ANALYTICS"),
      };
    }
    if (name === "google_analytics_realtime") {
      onlyArguments(args, ["property_id", "dimensions", "metrics", "limit"]);
      const dimensions = ga4Strings(
        args.dimensions,
        ga4Dimensions,
        [],
        "dimensions",
      );
      const metricNames = ga4Strings(
        args.metrics,
        ga4Metrics,
        ["activeUsers"],
        "metrics",
      );
      return {
        ...ga4Report(args, dimensions, metricNames, true),
        note: "Synthetic static snapshot; not a live real-time measurement.",
      };
    }
    if (name === "google_analytics_compare_periods") {
      onlyArguments(args, [
        "property_id",
        "start_date",
        "end_date",
        "dimension",
        "dimensions",
        "metrics",
        "limit",
      ]);
      const current = selectedRange(args);
      const previous = previousEqualPeriod(current);
      const dimensions = ga4Strings(
        args.dimensions,
        ga4Dimensions,
        [],
        "dimensions",
      );
      const metricNames = ga4Strings(
        args.metrics,
        ga4Metrics,
        [
          "activeUsers",
          "sessions",
          "engagedSessions",
          "keyEvents",
          "totalRevenue",
        ],
        "metrics",
      );
      return {
        property: resource(account),
        current: ga4Report(
          { ...args, start_date: current.startDate, end_date: current.endDate },
          dimensions,
          metricNames,
        ),
        previous: ga4Report(
          {
            ...args,
            start_date: previous.startDate,
            end_date: previous.endDate,
          },
          dimensions,
          metricNames,
        ),
        comparison: comparisonNote(current, previous),
        note: "Synthetic differences do not establish causation.",
        ...marks("GOOGLE_ANALYTICS"),
      };
    }
    onlyArguments(args, [
      "property_id",
      "start_date",
      "end_date",
      "dimension",
      "dimensions",
      "metrics",
      "limit",
      "dimension_filter",
      "metric_filter",
      "order_bys",
    ]);
    if (
      args.dimension_filter !== undefined ||
      args.metric_filter !== undefined ||
      args.order_bys !== undefined
    )
      throw new ForbiddenException(
        "Advanced GA4 filters and ordering are unavailable in the demo fixture.",
      );
    const presets: Record<string, { dimensions: string[]; metrics: string[] }> =
      {
        google_analytics_traffic_overview: {
          dimensions: [],
          metrics: [
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
        },
        google_analytics_acquisition: {
          dimensions: ["sessionSourceMedium"],
          metrics: [
            "sessions",
            "activeUsers",
            "engagedSessions",
            "keyEvents",
            "totalRevenue",
          ],
        },
        google_analytics_landing_pages: {
          dimensions: ["landingPagePlusQueryString"],
          metrics: [
            "sessions",
            "activeUsers",
            "engagementRate",
            "keyEvents",
            "totalRevenue",
          ],
        },
        google_analytics_pages: {
          dimensions: ["unifiedScreenClass"],
          metrics: [
            "screenPageViews",
            "activeUsers",
            "userEngagementDuration",
            "eventCount",
          ],
        },
        google_analytics_events: {
          dimensions: ["eventName"],
          metrics: ["eventCount", "activeUsers", "keyEvents", "totalRevenue"],
        },
        google_analytics_key_events: {
          dimensions: ["eventName"],
          metrics: ["eventCount", "activeUsers", "keyEvents", "totalRevenue"],
        },
        google_analytics_devices: {
          dimensions: ["deviceCategory"],
          metrics: ["activeUsers", "sessions", "engagementRate", "keyEvents"],
        },
        google_analytics_geography: {
          dimensions: ["country"],
          metrics: ["activeUsers", "sessions", "keyEvents"],
        },
      };
    const preset = presets[name];
    if (name !== "google_analytics_run_report" && !preset)
      throw new ForbiddenException("This demo tool is unavailable.");
    if (args.dimension !== undefined && !ga4Dimensions.has(str(args.dimension)))
      throw new ForbiddenException("Unsupported demo dimension.");
    const dimensions =
      name === "google_analytics_run_report"
        ? ga4Strings(args.dimensions, ga4Dimensions, [], "dimensions")
        : args.dimension !== undefined
          ? [str(args.dimension)]
          : preset!.dimensions;
    const metricNames =
      name === "google_analytics_run_report"
        ? ga4Strings(args.metrics, ga4Metrics, [], "metrics")
        : preset!.metrics;
    if (!metricNames.length)
      throw new ForbiddenException("At least one demo metric is required.");
    return ga4Report(args, dimensions, metricNames);
  }
  if (name === "get_search_console_report") {
    const site = str(args.site_url);
    if (site !== "sc-domain:demo.invalid")
      throw new ForbiddenException("Demo property is unavailable.");
    onlyArguments(args, ["site_url", "days"]);
    const days = args.days === undefined ? 28 : args.days;
    if (
      typeof days !== "number" ||
      !Number.isInteger(days) ||
      days < 1 ||
      days > 28
    )
      throw new ForbiddenException(
        "Demo Search Console supports 1 to 28 completed UTC days.",
      );
    const period = lastCompleteDays(days);
    const factor = daysInFixture(period).reduce(
      (sum, day) => sum + day.factor,
      0,
    );
    const clicks = Math.round(7.5 * factor);
    const impressions = Math.round(187.5 * factor);
    return {
      status: "ok",
      selected_property: site,
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: 12.3,
      period,
      days,
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
    select: {
      slug: true,
      accessStatus: true,
      entitlements: {
        where: { featureKey: "reviewer_demo" },
        select: { value: true, source: true, expiresAt: true },
      },
    },
  });
  const marker = workspace?.entitlements[0];
  if (!marker) {
    if (workspace?.slug === "holypilot-anthropic-reviewer-demo")
      throw new ForbiddenException("Demo workspace marker is unavailable.");
    return false;
  }
  if (
    workspace.slug !== "holypilot-anthropic-reviewer-demo" ||
    workspace.accessStatus !== "ACTIVE" ||
    marker.value !== true ||
    marker.source !== "reviewer_demo_bootstrap" ||
    (marker.expiresAt !== null && marker.expiresAt <= new Date())
  )
    throw new ForbiddenException("Demo workspace is not available.");
  return true;
}

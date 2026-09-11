import type { ProviderDateRange } from "@holymedia/contracts";
import { MetaReadError } from "./meta-read.error.js";

export const META_METRICS = [
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "action_values",
  "conversions",
  "results",
  "cost_per_action_type",
  "purchase_roas",
] as const;
export type MetaInsightsRequest = {
  range: ProviderDateRange;
  metrics: string[];
  level: "account" | "campaign" | "adset" | "ad";
  breakdowns: string[];
  limit: number;
  cursor?: string;
  campaignId?: string;
};
export function metaInsightsParameters(
  args: Record<string, unknown>,
  detailed = false,
  now = new Date(),
): MetaInsightsRequest {
  const fail = () => new MetaReadError("meta_invalid_parameters", "insights");
  const list = (v: unknown): string[] =>
    v === undefined
      ? []
      : Array.isArray(v) && v.every((x) => typeof x === "string")
        ? v
        : typeof v === "string"
          ? v.split(",").map((x) => x.trim())
          : (() => {
              throw fail();
            })();
  const metrics = list(args.metrics ?? args.fields);
  if (
    metrics.some((m) => !(META_METRICS as readonly string[]).includes(m)) ||
    metrics.length > 20
  )
    throw fail();
  const breakdowns = list(args.breakdowns);
  const combinations = [
    "",
    "age",
    "gender",
    "age,gender",
    "country",
    "region",
    "publisher_platform",
    "platform_position",
    "device_platform",
    "impression_device",
    "platform_position,publisher_platform",
  ];
  if (!combinations.includes([...breakdowns].sort().join(",")))
    throw new MetaReadError(
      "meta_insights_incompatible_parameters",
      "insights",
    );
  if (args.dimensions !== undefined && list(args.dimensions).length)
    throw new MetaReadError(
      "meta_insights_incompatible_parameters",
      "insights",
    );
  const level = String(args.level ?? (detailed ? "campaign" : "account"));
  if (
    !["account", "campaign", "adset", "ad"].includes(level) ||
    (detailed && level !== "campaign")
  )
    throw fail();
  const limit = args.limit ?? 100;
  if (!Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 500)
    throw fail();
  const cursor = args.cursor;
  if (
    cursor !== undefined &&
    (typeof cursor !== "string" ||
      cursor.length > 2048 ||
      !/^[A-Za-z0-9_=-]+$/.test(cursor))
  )
    throw fail();
  const nested = args.date_range ?? args.time_range;
  if (
    nested !== undefined &&
    (!nested || typeof nested !== "object" || Array.isArray(nested))
  )
    throw fail();
  const dates =
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>)
      : {};
  let since =
    args.since ??
    args.start_date ??
    args.startDate ??
    dates.since ??
    dates.startDate ??
    dates.start_date;
  let until =
    args.until ??
    args.end_date ??
    args.endDate ??
    dates.until ??
    dates.endDate ??
    dates.end_date;
  if (nested !== undefined && (since === undefined || until === undefined))
    throw fail();
  const preset = args.date_preset ?? args.preset ?? args.period;
  if (preset !== undefined) {
    if (since !== undefined || until !== undefined) throw fail();
    const days = (
      { last_7d: 7, last_14d: 14, last_30d: 30 } as Record<string, number>
    )[String(preset)];
    if (!days) throw fail();
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        86400000,
    );
    until = end.toISOString().slice(0, 10);
    since = new Date(end.getTime() - (days - 1) * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  if (since === undefined && until === undefined) {
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) -
        86400000,
    );
    until = end.toISOString().slice(0, 10);
    since = new Date(end.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  }
  if (
    typeof since !== "string" ||
    typeof until !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(since) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(until)
  )
    throw fail();
  const start = Date.parse(since),
    end = Date.parse(until);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    new Date(start).toISOString().slice(0, 10) !== since ||
    new Date(end).toISOString().slice(0, 10) !== until ||
    end < start ||
    end - start > 365 * 86400000
  )
    throw fail();
  const campaign = args.campaign_id ?? args.campaignId;
  if (
    campaign !== undefined &&
    (typeof campaign !== "string" || !/^\d{1,40}$/.test(campaign))
  )
    throw fail();
  return {
    range: { startDate: since, endDate: until },
    metrics: metrics.length ? [...new Set(metrics)] : [...META_METRICS],
    level: level as MetaInsightsRequest["level"],
    breakdowns,
    limit: Number(limit),
    ...(typeof cursor === "string" ? { cursor } : {}),
    ...(typeof campaign === "string" ? { campaignId: campaign } : {}),
  };
}

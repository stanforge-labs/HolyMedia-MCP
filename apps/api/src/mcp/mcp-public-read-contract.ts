/** Canonical, bounded arguments for the account-scoped public READ surface.
 * Legacy/private MCP keeps its existing aliases and contract. */
const providers = [
  "GOOGLE_ADS",
  "META_ADS",
  "TIKTOK_ADS",
  "YANDEX_DIRECT",
  "GOOGLE_ANALYTICS",
  "GOOGLE_SEARCH_CONSOLE",
] as const;
const advertisingProviders = providers.slice(0, 4);

const accountReads = new Set([
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
  "compare_periods",
  "generate_monthly_ads_report",
  "get_flexible_insights",
  "get_google_ads_detailed_report",
]);
const datedReads = new Set([
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
  "generate_monthly_ads_report",
  "get_flexible_insights",
  "get_google_ads_detailed_report",
]);
const requiredDates = new Set(["get_basic_metrics", "get_performance_report"]);

export class PublicReadArgumentsError extends Error {
  public readonly code = "invalid_arguments";
  public constructor(public readonly field: string) {
    super(`Проверьте аргумент ${field} в запросе к HolyPilot.`);
  }
}

export function publicReadInputSchema(
  name: string,
): Record<string, unknown> | undefined {
  if (name === "list_search_console_properties")
    return { type: "object", additionalProperties: false, properties: {} };
  if (name === "get_search_console_report")
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        site_url: { type: "string", minLength: 1, maxLength: 2048 },
        days: { type: "integer", minimum: 1, maximum: 365 },
      },
    };
  if (name === "list_ad_accounts")
    return {
      type: "object",
      additionalProperties: false,
      properties: {
        provider: { type: "string", enum: [...advertisingProviders] },
      },
    };
  if (!accountReads.has(name)) return undefined;
  const properties: Record<string, unknown> = {
    provider: {
      type: "string",
      enum:
        name === "get_account_status"
          ? [...providers]
          : name === "get_google_ads_detailed_report"
            ? ["GOOGLE_ADS"]
            : [...advertisingProviders],
      description: "Provider of the selected account; never inferred.",
    },
    account_id: {
      type: "string",
      minLength: 1,
      maxLength: 255,
      description:
        "Exact account_id returned for this workspace by list_ad_accounts or list_connected_resources; preserve it as a string.",
    },
  };
  if (datedReads.has(name)) {
    properties.start_date = {
      type: "string",
      format: "date",
      description:
        "YYYY-MM-DD; supply together with end_date, at most 366 inclusive days.",
    };
    properties.end_date = {
      type: "string",
      format: "date",
      description:
        "YYYY-MM-DD; supply together with start_date, at most 366 inclusive days.",
    };
  }
  if (name === "list_campaigns") {
    properties.limit = { type: "integer", minimum: 1, maximum: 500 };
    properties.cursor = { type: "string", minLength: 1, maxLength: 2048 };
    properties.statuses = {
      type: "array",
      minItems: 1,
      maxItems: 3,
      uniqueItems: true,
      items: { type: "string", enum: ["ENABLED", "PAUSED", "REMOVED"] },
      description: "Optional Google Ads campaign statuses.",
    };
  }
  if (name === "get_campaign" || name === "get_campaign_structure")
    properties.campaign_id = { type: "string", minLength: 1, maxLength: 255 };
  if (name === "get_basic_metrics")
    properties.campaign_id = { type: "string", minLength: 1, maxLength: 255 };
  if (name === "get_top_performers") {
    properties.metric = {
      type: "string",
      enum: [
        "spend",
        "impressions",
        "clicks",
        "conversions",
        "conversionValue",
      ],
    };
    properties.limit = { type: "integer", minimum: 1, maximum: 100 };
  }
  if (name === "compare_periods")
    for (const field of [
      "current_start_date",
      "current_end_date",
      "previous_start_date",
      "previous_end_date",
    ])
      properties[field] = { type: "string", format: "date" };
  if (name === "generate_monthly_ads_report") {
    properties.previous_start_date = { type: "string", format: "date" };
    properties.previous_end_date = { type: "string", format: "date" };
  }
  if (name === "get_google_ads_detailed_report") {
    properties.report_type = {
      type: "string",
      enum: ["campaign", "campaigns", "campaign_performance"],
    };
    properties.limit = { type: "integer", minimum: 1, maximum: 500 };
    properties.cursor = { type: "string", minLength: 1, maxLength: 2048 };
  }
  if (name === "get_flexible_insights") {
    properties.level = { type: "string", enum: ["account", "campaign"] };
    properties.campaign_id = { type: "string", minLength: 1, maxLength: 255 };
    properties.limit = { type: "integer", minimum: 1, maximum: 500 };
    properties.cursor = { type: "string", minLength: 1, maxLength: 2048 };
    properties.since = { type: "string", format: "date" };
    properties.until = { type: "string", format: "date" };
    properties.date_preset = {
      type: "string",
      enum: ["last_7d", "last_14d", "last_30d"],
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: [
      ...(name === "get_google_ads_detailed_report" ? [] : ["provider"]),
      "account_id",
      ...(name === "get_campaign" ? ["campaign_id"] : []),
      ...(requiredDates.has(name) ? ["start_date", "end_date"] : []),
      ...(name === "compare_periods"
        ? [
            "current_start_date",
            "current_end_date",
            "previous_start_date",
            "previous_end_date",
          ]
        : []),
    ],
    properties,
  };
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
  );
}

/** Apply the same contract to calls; advertised JSON Schema alone is not a security boundary. */
export function validatePublicReadArguments(name: string, raw: unknown): void {
  const schema = publicReadInputSchema(name);
  if (!schema) return;
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new PublicReadArgumentsError("arguments");
  const args = raw as Record<string, unknown>;
  const properties = schema.properties as Record<string, unknown>;
  for (const field of Object.keys(args))
    if (!(field in properties))
      throw new PublicReadArgumentsError(
        field === "startDate"
          ? "start_date"
          : field === "endDate"
            ? "end_date"
            : "unsupported_field",
      );
  for (const field of (schema.required as string[] | undefined) ?? [])
    if (args[field] === undefined) throw new PublicReadArgumentsError(field);
  const allowedProviders =
    name === "get_account_status"
      ? providers
      : name === "get_google_ads_detailed_report"
        ? ["GOOGLE_ADS"]
        : advertisingProviders;
  if (
    args.provider !== undefined &&
    !allowedProviders.includes(args.provider as (typeof providers)[number])
  )
    throw new PublicReadArgumentsError("provider");
  for (const field of ["account_id", "campaign_id", "cursor", "site_url"])
    if (
      args[field] !== undefined &&
      (typeof args[field] !== "string" ||
        !args[field].trim() ||
        args[field].length >
          (["cursor", "site_url"].includes(field) ? 2048 : 255))
    )
      throw new PublicReadArgumentsError(field);
  if (args.start_date !== undefined || args.end_date !== undefined) {
    if (!validDate(args.start_date))
      throw new PublicReadArgumentsError("start_date");
    if (!validDate(args.end_date))
      throw new PublicReadArgumentsError("end_date");
    const days =
      (Date.parse(`${args.end_date}T00:00:00.000Z`) -
        Date.parse(`${args.start_date}T00:00:00.000Z`)) /
        86_400_000 +
      1;
    if (days < 1 || days > 366)
      throw new PublicReadArgumentsError("start_date/end_date");
  }
  for (const prefix of ["current", "previous"]) {
    const start = args[`${prefix}_start_date`];
    const end = args[`${prefix}_end_date`];
    if (start === undefined && end === undefined) continue;
    if (!validDate(start) || !validDate(end))
      throw new PublicReadArgumentsError(
        `${prefix}_start_date/${prefix}_end_date`,
      );
    const days =
      (Date.parse(`${end}T00:00:00.000Z`) -
        Date.parse(`${start}T00:00:00.000Z`)) /
        86_400_000 +
      1;
    if (days < 1 || days > 366)
      throw new PublicReadArgumentsError(
        `${prefix}_start_date/${prefix}_end_date`,
      );
  }
  if (args.since !== undefined || args.until !== undefined) {
    if (
      !validDate(args.since) ||
      !validDate(args.until) ||
      args.date_preset !== undefined
    )
      throw new PublicReadArgumentsError("since/until");
    const days =
      (Date.parse(`${args.until}T00:00:00.000Z`) -
        Date.parse(`${args.since}T00:00:00.000Z`)) /
        86_400_000 +
      1;
    if (days < 1 || days > 366)
      throw new PublicReadArgumentsError("since/until");
  }
  if (
    args.date_preset !== undefined &&
    (!["last_7d", "last_14d", "last_30d"].includes(
      args.date_preset as string,
    ) ||
      args.start_date !== undefined)
  )
    throw new PublicReadArgumentsError("date_preset");
  if (
    args.limit !== undefined &&
    (!Number.isInteger(args.limit) ||
      (args.limit as number) < 1 ||
      (args.limit as number) > (name === "get_top_performers" ? 100 : 500))
  )
    throw new PublicReadArgumentsError("limit");
  if (
    args.statuses !== undefined &&
    (!Array.isArray(args.statuses) ||
      args.statuses.length < 1 ||
      args.statuses.length > 3 ||
      new Set(args.statuses).size !== args.statuses.length ||
      args.statuses.some(
        (status) => !["ENABLED", "PAUSED", "REMOVED"].includes(status),
      ))
  )
    throw new PublicReadArgumentsError("statuses");
  if (
    args.metric !== undefined &&
    ![
      "spend",
      "impressions",
      "clicks",
      "conversions",
      "conversionValue",
    ].includes(args.metric as string)
  )
    throw new PublicReadArgumentsError("metric");
  if (
    args.days !== undefined &&
    (!Number.isInteger(args.days) ||
      (args.days as number) < 1 ||
      (args.days as number) > 365)
  )
    throw new PublicReadArgumentsError("days");
  if (
    args.report_type !== undefined &&
    !["campaign", "campaigns", "campaign_performance"].includes(
      args.report_type as string,
    )
  )
    throw new PublicReadArgumentsError("report_type");
  if (
    args.level !== undefined &&
    !["account", "campaign"].includes(args.level as string)
  )
    throw new PublicReadArgumentsError("level");
}

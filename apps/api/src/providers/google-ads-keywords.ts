import { createHash } from "node:crypto";
import type { ProviderDateRange } from "@holymedia/contracts";
import { ProviderError } from "./provider.errors.js";
import { decodeGoogleCursor, encodeGoogleCursor } from "./google-ads-cursor.js";
import { validateDateRange } from "./provider-normalization.js";
import type {
  GoogleKeyword,
  GoogleKeywordOptions,
  GoogleKeywordPage,
} from "./provider.types.js";

type Row = Record<string, unknown>;
type SearchPage = { results: Row[]; nextPageToken?: string | undefined };
type Search = (query: string, pageToken?: string) => Promise<SearchPage>;
type SearchStream = (query: string) => Promise<Row[]>;
type Position = { token?: string; index: number };

const INVENTORY_FIELDS = [
  "campaign.id",
  "campaign.name",
  "campaign.status",
  "ad_group.id",
  "ad_group.name",
  "ad_group.status",
  "ad_group_criterion.resource_name",
  "ad_group_criterion.criterion_id",
  "ad_group_criterion.keyword.text",
  "ad_group_criterion.keyword.match_type",
  "ad_group_criterion.status",
  "ad_group_criterion.negative",
  "ad_group_criterion.approval_status",
  "ad_group_criterion.system_serving_status",
  "ad_group_criterion.quality_info.quality_score",
  "ad_group_criterion.cpc_bid_micros",
  "ad_group_criterion.effective_cpc_bid_micros",
  "ad_group_criterion.final_urls",
].join(", ");
const METRIC_FIELDS = [
  "ad_group_criterion.resource_name",
  "metrics.impressions",
  "metrics.clicks",
  "metrics.cost_micros",
  "metrics.conversions",
  "metrics.all_conversions",
].join(", ");
const STATUS_VALUES = new Set(["ENABLED", "PAUSED", "REMOVED"]);
const MAX_PROVIDER_PAGES = 20;

export function keywordOptions(
  options: GoogleKeywordOptions,
): GoogleKeywordOptions {
  let range: ProviderDateRange;
  try {
    range = validateDateRange(options.range);
  } catch (error) {
    throw invalid(
      error instanceof Error ? error.message : "Invalid Google Ads date range.",
    );
  }
  for (const value of [range.startDate, range.endDate]) {
    const parsed = Date.parse(`${value}T00:00:00.000Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== value
    )
      throw invalid("Invalid Google Ads date range.");
  }
  const normalizeIds = (values: string[] | undefined, name: string) => {
    if (values === undefined) return undefined;
    if (
      !Array.isArray(values) ||
      values.length < 1 ||
      values.length > 200 ||
      values.some(
        (value) => typeof value !== "string" || !/^\d{1,20}$/.test(value),
      )
    )
      throw invalid(`Invalid ${name}.`);
    return [...new Set(values)];
  };
  if (options.statuses !== undefined && !Array.isArray(options.statuses))
    throw invalid("Invalid Google keyword status.");
  const statuses = options.statuses?.map((value) =>
    typeof value === "string" ? value.toUpperCase() : "",
  );
  if (
    statuses &&
    (!statuses.length || statuses.some((value) => !STATUS_VALUES.has(value)))
  )
    throw invalid("Invalid Google keyword status.");
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 500
  )
    throw invalid("limit must be between 1 and 500.");
  if (
    options.minCost !== undefined &&
    (!Number.isFinite(options.minCost) || options.minCost < 0)
  )
    throw invalid("min_cost must be a non-negative number.");
  return {
    ...options,
    range,
    ...(options.campaignIds
      ? { campaignIds: normalizeIds(options.campaignIds, "campaign_ids") }
      : {}),
    ...(options.adGroupIds
      ? { adGroupIds: normalizeIds(options.adGroupIds, "ad_group_ids") }
      : {}),
    ...(statuses ? { statuses: [...new Set(statuses)] } : {}),
  };
}

function invalid(message: string): ProviderError {
  return new ProviderError("invalid_request", message);
}

function filters(
  options: GoogleKeywordOptions,
  activeHierarchy = false,
): string[] {
  const values = [
    "ad_group_criterion.type = 'KEYWORD'",
    "ad_group_criterion.negative = FALSE",
    activeHierarchy
      ? "campaign.status = 'ENABLED'"
      : "campaign.status != 'REMOVED'",
    activeHierarchy
      ? "ad_group.status = 'ENABLED'"
      : "ad_group.status != 'REMOVED'",
  ];
  if (!options.statuses) values.push("ad_group_criterion.status != 'REMOVED'");
  else
    values.push(
      `ad_group_criterion.status IN (${options.statuses.map((s) => `'${s}'`).join(", ")})`,
    );
  if (options.campaignIds?.length)
    values.push(`campaign.id IN (${options.campaignIds.join(", ")})`);
  if (options.adGroupIds?.length)
    values.push(`ad_group.id IN (${options.adGroupIds.join(", ")})`);
  return values;
}

export function keywordInventoryQuery(
  options: GoogleKeywordOptions,
  activeHierarchy = false,
): string {
  return `SELECT ${INVENTORY_FIELDS} FROM ad_group_criterion WHERE ${filters(options, activeHierarchy).join(" AND ")} ORDER BY ad_group.id, ad_group_criterion.criterion_id`;
}

export function keywordMetricsQuery(
  names: string[],
  range: ProviderDateRange,
): string {
  if (
    !names.length ||
    names.length > 200 ||
    names.some(
      (name) => !/^customers\/\d{10}\/adGroupCriteria\/\d+~\d+$/.test(name),
    )
  )
    throw invalid("Invalid keyword resource_name in metrics query.");
  return `SELECT ${METRIC_FIELDS} FROM keyword_view WHERE segments.date BETWEEN '${range.startDate}' AND '${range.endDate}' AND ad_group_criterion.resource_name IN (${names.map((name) => `'${name}'`).join(", ")})`;
}

export function keywordDuplicateQuery(): string {
  return "SELECT campaign.id, campaign.name, ad_group.id, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text FROM ad_group_criterion WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED' AND ad_group.status != 'REMOVED' AND campaign.status = 'ENABLED' ORDER BY ad_group.id, ad_group_criterion.criterion_id";
}

export function normalizeKeywordText(value: string): string {
  return value
    .replace(/[[\]"+]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}
function str(value: unknown): string {
  return value == null ? "" : String(value);
}
function nullable(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}
function numeric(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}
function optionalNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function amount(value: unknown): number {
  return numeric(value) / 1_000_000;
}

export function keywordPlacement(row: Row) {
  const campaign = record(row.campaign);
  const adGroup = record(row.adGroup);
  const criterion = record(row.adGroupCriterion);
  const keyword = record(criterion.keyword);
  return {
    resource_name: str(criterion.resourceName),
    criterion_id: str(criterion.criterionId),
    campaign_id: str(campaign.id),
    campaign_name: str(campaign.name),
    campaign_status: str(campaign.status),
    ad_group_id: str(adGroup.id),
    ad_group_name: str(adGroup.name),
    ad_group_status: str(adGroup.status),
    text: str(keyword.text),
    match_type: str(keyword.matchType),
    status: str(criterion.status),
  };
}

function cursorFingerprint(
  accountId: string,
  options: GoogleKeywordOptions,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        accountId,
        range: options.range,
        campaignIds: [...(options.campaignIds ?? [])].sort(),
        adGroupIds: [...(options.adGroupIds ?? [])].sort(),
        statuses: [...(options.statuses ?? [])].sort(),
        minCost: options.minCost ?? 0,
        limit: options.limit,
      }),
    )
    .digest("hex")
    .slice(0, 24);
}
function decodeCursor(
  cursor: string | undefined,
  fingerprint: string,
  secret: string,
): Position {
  if (!cursor) return { index: 0 };
  try {
    const value = decodeGoogleCursor(cursor, fingerprint, secret, "keywords");
    if (
      !Number.isInteger(value.i) ||
      numeric(value.i) < 0 ||
      numeric(value.i) >= 10000 ||
      (value.t !== undefined &&
        (typeof value.t !== "string" || !value.t || value.t.length > 2048))
    )
      throw Error();
    return {
      index: Number(value.i),
      ...(value.t ? { token: String(value.t) } : {}),
    };
  } catch {
    throw invalid("Invalid Google keyword cursor.");
  }
}
function encodeCursor(
  position: Position,
  fingerprint: string,
  secret: string,
): string {
  return encodeGoogleCursor(
    { i: position.index, ...(position.token ? { t: position.token } : {}) },
    fingerprint,
    secret,
    "keywords",
  );
}

function toKeyword(
  row: Row,
  metric: Row | undefined,
  currency: string | null,
): GoogleKeyword {
  const criterion = record(row.adGroupCriterion);
  const quality = record(criterion.qualityInfo);
  const metrics = record(metric?.metrics);
  const conversions = numeric(metrics.conversions);
  const cost = amount(metrics.costMicros);
  return {
    ...keywordPlacement(row),
    serving_status: nullable(criterion.systemServingStatus),
    approval_status: nullable(criterion.approvalStatus),
    quality_score: optionalNumber(quality.qualityScore),
    cpc: criterion.cpcBidMicros == null ? null : amount(criterion.cpcBidMicros),
    effective_cpc:
      criterion.effectiveCpcBidMicros == null
        ? null
        : amount(criterion.effectiveCpcBidMicros),
    final_urls: Array.isArray(criterion.finalUrls)
      ? criterion.finalUrls.map(str)
      : [],
    impressions: numeric(metrics.impressions),
    clicks: numeric(metrics.clicks),
    cost,
    currency,
    conversions,
    all_conversions: numeric(metrics.allConversions),
    cost_per_conversion: conversions > 0 ? cost / conversions : null,
    duplicate_in_campaigns: [],
  };
}

export async function listGoogleKeywords(
  accountId: string,
  rawOptions: GoogleKeywordOptions,
  currency: string | null,
  search: Search,
  stream: SearchStream,
  cursorSecret: string,
): Promise<GoogleKeywordPage> {
  const options = keywordOptions(rawOptions);
  const fingerprint = cursorFingerprint(accountId, options);
  let position = decodeCursor(options.cursor, fingerprint, cursorSecret);
  const query = keywordInventoryQuery(options);
  const selected: GoogleKeyword[] = [];
  let nextCursor: string | undefined;
  let providerPages = 0;
  while (true) {
    if (++providerPages > MAX_PROVIDER_PAGES)
      throw invalid(
        "Keyword scan exceeded 20 provider pages; narrow the filters.",
      );
    const page = await search(query, position.token);
    if (position.index > page.results.length)
      throw invalid("Invalid Google keyword cursor.");
    for (
      let index = position.index;
      index < page.results.length;
      index += 200
    ) {
      const chunk = page.results.slice(index, index + 200);
      const names = chunk.map((row) =>
        str(record(row.adGroupCriterion).resourceName),
      );
      const metricRows = await stream(
        keywordMetricsQuery(names, options.range),
      );
      const metrics = new Map(
        metricRows.map((row) => [
          str(record(row.adGroupCriterion).resourceName),
          row,
        ]),
      );
      for (let local = 0; local < chunk.length; local++) {
        const item = toKeyword(
          chunk[local]!,
          metrics.get(names[local]!),
          currency,
        );
        if (item.cost < (options.minCost ?? 0)) continue;
        if (selected.length === options.limit) {
          nextCursor = encodeCursor(
            {
              ...(position.token ? { token: position.token } : {}),
              index: index + local,
            },
            fingerprint,
            cursorSecret,
          );
          break;
        }
        selected.push(item);
      }
      if (nextCursor) break;
    }
    if (nextCursor || !page.nextPageToken) break;
    position = { token: page.nextPageToken, index: 0 };
  }
  if (selected.length) {
    const wanted = new Set(
      selected.map((item) => normalizeKeywordText(item.text)),
    );
    const campaigns = new Map<
      string,
      Map<string, { campaign_id: string; campaign_name: string }>
    >();
    let token: string | undefined;
    let duplicatePages = 0;
    do {
      if (++duplicatePages > MAX_PROVIDER_PAGES)
        throw invalid(
          "Duplicate scan exceeded 20 provider pages; narrow the account.",
        );
      const page = await search(keywordDuplicateQuery(), token);
      for (const row of page.results) {
        const normalized = normalizeKeywordText(
          str(record(record(row.adGroupCriterion).keyword).text),
        );
        if (!wanted.has(normalized)) continue;
        const campaign = record(row.campaign);
        const id = str(campaign.id);
        const values = campaigns.get(normalized) ?? new Map();
        values.set(id, { campaign_id: id, campaign_name: str(campaign.name) });
        campaigns.set(normalized, values);
      }
      token = page.nextPageToken;
    } while (token);
    for (const item of selected)
      item.duplicate_in_campaigns = [
        ...(campaigns.get(normalizeKeywordText(item.text))?.values() ?? []),
      ]
        .filter((campaign) => campaign.campaign_id !== item.campaign_id)
        .sort((a, b) => a.campaign_id.localeCompare(b.campaign_id));
  }
  return { items: selected, ...(nextCursor ? { nextCursor } : {}) };
}

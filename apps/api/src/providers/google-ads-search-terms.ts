import { createHash } from "node:crypto";
import { decodeGoogleCursor, encodeGoogleCursor } from "./google-ads-cursor.js";
import { ProviderError } from "./provider.errors.js";
import type {
  GoogleSearchTerm,
  GoogleSearchTermOptions,
  GoogleSearchTermPage,
} from "./provider.types.js";

type Row = Record<string, unknown>;
type SearchPage = { results: Row[]; nextPageToken?: string };
type Search = (query: string, pageToken?: string) => Promise<SearchPage>;
type Position = { token?: string; index: number };
const MAX_PROVIDER_PAGES = 20;
const PRIVACY_NOTICE =
  "Search term data can be incomplete because Google Ads may withhold some queries; visible search-term cost is not expected to equal total campaign spend.";

function invalid(message: string): ProviderError {
  return new ProviderError("invalid_request", message);
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString().slice(0, 10) === value
  );
}

export function searchTermOptions(
  options: GoogleSearchTermOptions,
): GoogleSearchTermOptions {
  const { startDate, endDate } = options.range ?? {};
  if (!startDate || !endDate || !validDate(startDate) || !validDate(endDate))
    throw invalid("since and until are required ISO dates (YYYY-MM-DD).");
  if (startDate > endDate) throw invalid("since must be on or before until.");
  if (
    !Number.isInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > 500
  )
    throw invalid("limit must be between 1 and 500.");
  if (
    options.campaignIds !== undefined &&
    (!Array.isArray(options.campaignIds) ||
      options.campaignIds.length < 1 ||
      options.campaignIds.length > 200 ||
      options.campaignIds.some(
        (id) => typeof id !== "string" || !/^\d{1,20}$/.test(id),
      ))
  )
    throw invalid("campaign_ids must contain 1–200 numeric IDs.");
  if (
    options.minCost !== undefined &&
    (typeof options.minCost !== "number" ||
      !Number.isFinite(options.minCost) ||
      options.minCost < 0)
  )
    throw invalid("min_cost must be a non-negative number.");
  if (
    options.contains !== undefined &&
    (typeof options.contains !== "string" ||
      !options.contains.trim() ||
      options.contains.length > 200)
  )
    throw invalid(
      "contains must be a non-empty string of at most 200 characters.",
    );
  if (
    options.onlyNotAdded !== undefined &&
    typeof options.onlyNotAdded !== "boolean"
  )
    throw invalid("only_not_added must be a boolean.");
  return {
    ...options,
    ...(options.campaignIds
      ? { campaignIds: [...new Set(options.campaignIds)] }
      : {}),
    ...(options.contains ? { contains: options.contains.trim() } : {}),
  };
}

export function searchTermQuery(options: GoogleSearchTermOptions): string {
  const where = [
    `segments.date BETWEEN '${options.range.startDate}' AND '${options.range.endDate}'`,
  ];
  if (options.campaignIds?.length)
    where.push(`campaign.id IN (${options.campaignIds.join(", ")})`);
  if (options.onlyNotAdded) where.push("search_term_view.status = 'NONE'");
  return `SELECT search_term_view.search_term, search_term_view.status, segments.keyword.info.text, segments.keyword.info.match_type, segments.search_term_match_type, campaign.id, campaign.name, ad_group.id, ad_group.name, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM search_term_view WHERE ${where.join(" AND ")} ORDER BY campaign.id, ad_group.id, search_term_view.search_term`;
}

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}
function value(value: unknown): string {
  return value == null ? "" : String(value);
}
function nullable(value: unknown): string | null {
  return value == null || value === "" ? null : String(value);
}
function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function itemFromRow(row: Row, currency: string | null): GoogleSearchTerm {
  const view = record(row.searchTermView);
  const keyword = record(record(record(row.segments).keyword).info);
  const segments = record(row.segments);
  const campaign = record(row.campaign);
  const group = record(row.adGroup);
  const metrics = record(row.metrics);
  const cost = numeric(metrics.costMicros) / 1_000_000;
  const conversions = numeric(metrics.conversions);
  return {
    search_term: value(view.searchTerm),
    search_term_status: value(view.status),
    triggered_keyword: nullable(keyword.text),
    triggered_keyword_match_type: nullable(keyword.matchType),
    search_term_match_type: nullable(segments.searchTermMatchType),
    campaign_id: value(campaign.id),
    campaign_name: value(campaign.name),
    ad_group_id: value(group.id),
    ad_group_name: value(group.name),
    impressions: numeric(metrics.impressions),
    clicks: numeric(metrics.clicks),
    cost,
    currency,
    conversions,
    cost_per_conversion: conversions > 0 ? cost / conversions : null,
  };
}

function fingerprint(
  accountId: string,
  options: GoogleSearchTermOptions,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        accountId,
        range: options.range,
        campaignIds: [...(options.campaignIds ?? [])].sort(),
        minCost: options.minCost ?? null,
        contains: options.contains?.toLocaleLowerCase() ?? null,
        onlyNotAdded: options.onlyNotAdded ?? false,
        limit: options.limit,
      }),
    )
    .digest("hex");
}
function encodeCursor(
  position: Position,
  context: string,
  secret: string,
): string {
  return encodeGoogleCursor(
    { i: position.index, ...(position.token ? { t: position.token } : {}) },
    context,
    secret,
    "search-terms",
  );
}
function decodeCursor(
  cursor: string | undefined,
  context: string,
  secret: string,
): Position {
  if (cursor === undefined) return { index: 0 };
  try {
    const decoded = decodeGoogleCursor(cursor, context, secret, "search-terms");
    if (
      !Number.isInteger(decoded.i) ||
      numeric(decoded.i) < 0 ||
      numeric(decoded.i) >= 10000 ||
      (decoded.t !== undefined &&
        (typeof decoded.t !== "string" ||
          !decoded.t ||
          decoded.t.length > 2048))
    )
      throw Error();
    return {
      index: Number(decoded.i),
      ...(decoded.t ? { token: String(decoded.t) } : {}),
    };
  } catch {
    throw invalid("Invalid Google search term cursor.");
  }
}

export async function listGoogleSearchTerms(
  accountId: string,
  rawOptions: GoogleSearchTermOptions,
  currency: string | null,
  search: Search,
  cursorSecret: string,
): Promise<GoogleSearchTermPage> {
  const options = searchTermOptions(rawOptions);
  const context = fingerprint(accountId, options);
  let position = decodeCursor(options.cursor, context, cursorSecret);
  const query = searchTermQuery(options);
  const items: GoogleSearchTerm[] = [];
  let nextCursor: string | undefined;
  for (let pageCount = 0; pageCount < MAX_PROVIDER_PAGES; pageCount++) {
    const page = await search(query, position.token);
    if (position.index > page.results.length)
      throw invalid("Invalid Google search term cursor.");
    for (let index = position.index; index < page.results.length; index++) {
      const item = itemFromRow(page.results[index]!, currency);
      if (
        options.contains &&
        !item.search_term
          .toLocaleLowerCase()
          .includes(options.contains.toLocaleLowerCase())
      )
        continue;
      if (options.minCost !== undefined && item.cost < options.minCost)
        continue;
      if (items.length === options.limit) {
        nextCursor = encodeCursor(
          position.token ? { token: position.token, index } : { index },
          context,
          cursorSecret,
        );
        break;
      }
      items.push(item);
    }
    if (nextCursor || !page.nextPageToken) break;
    if (pageCount === MAX_PROVIDER_PAGES - 1)
      throw invalid(
        "Search term scan exceeded 20 provider pages; narrow the filters.",
      );
    position = { token: page.nextPageToken, index: 0 };
  }
  return {
    items,
    next_cursor: nextCursor ?? null,
    metadata: {
      source: "search_term_view",
      privacyNotice: PRIVACY_NOTICE,
      pmaxSupported: false,
    },
  };
}

import { describe, expect, it, vi } from "vitest";
import {
  listGoogleSearchTerms,
  searchTermOptions,
  searchTermQuery,
} from "./google-ads-search-terms.js";
import { ProviderError } from "./provider.errors.js";
import type { GoogleSearchTermOptions } from "./provider.types.js";

const account = "9458996580";
const secret = "test-only-cursor-secret";
const base: GoogleSearchTermOptions = {
  range: { startDate: "2026-03-01", endDate: "2026-09-28" },
  limit: 2,
};
function row(
  term: string,
  keyword: string | null,
  costMicros = "1500000",
  overrides: Record<string, unknown> = {},
) {
  return {
    searchTermView: { searchTerm: term, status: "NONE" },
    segments: {
      ...(keyword === null
        ? {}
        : { keyword: { info: { text: keyword, matchType: "BROAD" } } }),
      searchTermMatchType: "NEAR_EXACT",
    },
    campaign: { id: "123", name: "Search" },
    adGroup: { id: "456", name: "Group" },
    metrics: { impressions: "30", clicks: "3", costMicros, conversions: "0" },
    ...overrides,
  };
}
const run = (
  rows: ReturnType<typeof row>[],
  options: GoogleSearchTermOptions = base,
) =>
  listGoogleSearchTerms(
    account,
    options,
    "USD",
    vi.fn(async () => ({ results: rows })),
    secret,
  );

describe("Google Ads search terms", () => {
  it("uses v24 search_term_view fields, date and server-side campaign/status filters", () => {
    const query = searchTermQuery({
      ...base,
      campaignIds: ["123", "456"],
      onlyNotAdded: true,
    });
    expect(query).toContain("FROM search_term_view");
    expect(query).toContain(
      "segments.keyword.info.text, segments.keyword.info.match_type",
    );
    expect(query).toContain("segments.search_term_match_type");
    expect(query).toContain(
      "segments.date BETWEEN '2026-03-01' AND '2026-09-28'",
    );
    expect(query).toContain("campaign.id IN (123, 456)");
    expect(query).toContain("search_term_view.status = 'NONE'");
    expect(query).not.toContain("PERFORMANCE_MAX");
    expect(searchTermQuery(base)).not.toContain(
      "search_term_view.status = 'NONE'",
    );
  });

  it("maps term, triggered keyword, match types, money and zero-conversion cost", async () => {
    const result = await run([
      row("приват клиника алматы", "проктолог алматы"),
    ]);
    expect(result.items).toEqual([
      {
        search_term: "приват клиника алматы",
        search_term_status: "NONE",
        triggered_keyword: "проктолог алматы",
        triggered_keyword_match_type: "BROAD",
        search_term_match_type: "NEAR_EXACT",
        campaign_id: "123",
        campaign_name: "Search",
        ad_group_id: "456",
        ad_group_name: "Group",
        impressions: 30,
        clicks: 3,
        cost: 1.5,
        currency: "USD",
        conversions: 0,
        cost_per_conversion: null,
      },
    ]);
    expect(result.metadata.privacyNotice).toMatch(/withhold/);
    expect(result.metadata.pmaxSupported).toBe(false);
  });

  it("preserves duplicate term rows across triggered keywords and missing attribution as null", async () => {
    const result = await run([
      row("same term", "first", "3000000", {
        metrics: { costMicros: "3000000", conversions: "2" },
      }),
      row("same term", "second"),
    ]);
    expect(result.items).toHaveLength(2);
    expect(result.items.map((item) => item.triggered_keyword)).toEqual([
      "first",
      "second",
    ]);
    expect(result.items[0]?.cost_per_conversion).toBe(1.5);
    const missing = await run([row("unknown", null)]);
    expect(missing.items[0]?.triggered_keyword).toBeNull();
    expect(missing.items[0]?.triggered_keyword_match_type).toBeNull();
  });

  it("validates required dates, range, IDs, limit and filters", () => {
    for (const range of [
      { startDate: "", endDate: "2026-09-28" },
      { startDate: "2026-02-30", endDate: "2026-09-28" },
      { startDate: "2026-10-01", endDate: "2026-09-28" },
    ])
      expect(() => searchTermOptions({ ...base, range })).toThrowError(
        ProviderError,
      );
    expect(() =>
      searchTermOptions({ ...base, campaignIds: ["1) OR TRUE"] }),
    ).toThrowError(ProviderError);
    expect(() => searchTermOptions({ ...base, limit: 501 })).toThrowError(
      ProviderError,
    );
    expect(() => searchTermOptions({ ...base, minCost: -1 })).toThrowError(
      ProviderError,
    );
    expect(() => searchTermOptions({ ...base, contains: " " })).toThrowError(
      ProviderError,
    );
    expect(() =>
      searchTermOptions({ ...base, onlyNotAdded: "yes" as never }),
    ).toThrowError(ProviderError);
  });

  it("post-filters contains as case-insensitive substring and min_cost per row", async () => {
    const result = await run(
      [
        row("ПРИВАТ клиника", "one", "999999"),
        row("приват клиника", "two", "1000000"),
        row("другая клиника", "three", "2000000"),
      ],
      { ...base, contains: "ПрИвАт", minCost: 1 },
    );
    expect(result.items.map((item) => item.triggered_keyword)).toEqual(["two"]);
    expect(
      (await run([row("unrelated", "one")], { ...base, contains: "приват" }))
        .items,
    ).toEqual([]);
  });

  it("paginates across provider pages and post-filter gaps without duplicates or skips", async () => {
    const pages = [
      [row("match 1", "one"), row("miss", "none")],
      [row("match 2", "two"), row("match 3", "three")],
    ];
    const search = vi.fn(async (_query: string, token?: string) => ({
      results: pages[token === "second" ? 1 : 0]!,
      ...(token ? {} : { nextPageToken: "second" }),
    }));
    const options = { ...base, contains: "match", limit: 2 };
    const first = await listGoogleSearchTerms(
      account,
      options,
      "USD",
      search,
      secret,
    );
    expect(first.items.map((item) => item.search_term)).toEqual([
      "match 1",
      "match 2",
    ]);
    expect(first.next_cursor).toBeTruthy();
    const second = await listGoogleSearchTerms(
      account,
      { ...options, cursor: first.next_cursor! },
      "USD",
      search,
      secret,
    );
    expect(second.items.map((item) => item.search_term)).toEqual(["match 3"]);
    expect(second.next_cursor).toBeNull();
    expect(search).toHaveBeenCalledTimes(3);
  });

  it("rejects a tampered cursor and filter changes", async () => {
    const first = await run([
      row("one", "a"),
      row("two", "b"),
      row("three", "c"),
    ]);
    const cursor = first.next_cursor!;
    expect(cursor).toBeTruthy();
    await expect(
      run([], { ...base, cursor: `${cursor.slice(0, -1)}x` }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      run([], { ...base, cursor, contains: "one" }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("propagates structured Google provider errors without rewriting credentials", async () => {
    const error = new ProviderError(
      "invalid_request",
      "Google query rejected",
      false,
      "400",
      "QUERY_ERROR",
    );
    await expect(
      listGoogleSearchTerms(
        account,
        base,
        "USD",
        async () => {
          throw error;
        },
        secret,
      ),
    ).rejects.toBe(error);
  });
});

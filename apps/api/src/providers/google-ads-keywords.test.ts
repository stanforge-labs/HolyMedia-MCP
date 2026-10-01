import { describe, expect, it, vi } from "vitest";
import {
  keywordDuplicateQuery,
  keywordInventoryQuery,
  keywordMetricsQuery,
  keywordOptions,
  listGoogleKeywords,
  normalizeKeywordText,
} from "./google-ads-keywords.js";
import { ProviderError } from "./provider.errors.js";
import type { GoogleKeywordOptions } from "./provider.types.js";

const accountId = "9458996580";
const range = { startDate: "2026-03-01", endDate: "2026-09-28" };
const options: GoogleKeywordOptions = { range, limit: 100 };
const name = (id: number) => `customers/${accountId}/adGroupCriteria/10~${id}`;
function keyword(
  id: number,
  text: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    campaign: { id: "1", name: "Current", status: "ENABLED" },
    adGroup: { id: "10", name: "Group", status: "ENABLED" },
    adGroupCriterion: {
      resourceName: name(id),
      criterionId: String(id),
      keyword: { text, matchType: "EXACT" },
      status: "ENABLED",
      negative: false,
      systemServingStatus: "ELIGIBLE",
      approvalStatus: "APPROVED",
      qualityInfo: { qualityScore: 7 },
      cpcBidMicros: "2500000",
      effectiveCpcBidMicros: "3000000",
      finalUrls: ["https://example.test/one"],
    },
    ...overrides,
  };
}
function metric(id: number, costMicros: string, conversions = "2") {
  return {
    adGroupCriterion: { resourceName: name(id) },
    metrics: {
      impressions: "100",
      clicks: "10",
      costMicros,
      conversions,
      allConversions: "3",
    },
  };
}
function fixture(
  rows: ReturnType<typeof keyword>[],
  metrics: ReturnType<typeof metric>[] = [],
  duplicates: ReturnType<typeof keyword>[] = [],
) {
  const search = vi.fn(async (query: string, token?: string) => {
    if (query === keywordDuplicateQuery())
      return {
        results: duplicates.filter(
          (row) =>
            (row.campaign as { status: string }).status === "ENABLED" &&
            (row.adGroup as { status: string }).status !== "REMOVED" &&
            (row.adGroupCriterion as { status: string }).status !== "REMOVED",
        ),
        nextPageToken: undefined,
      };
    const filtered = rows.filter((row) => {
      const campaign = row.campaign as { id: string; status: string };
      const group = row.adGroup as { id: string; status: string };
      const criterion = row.adGroupCriterion as { status: string };
      if (
        query.includes("campaign.status != 'REMOVED'") &&
        campaign.status === "REMOVED"
      )
        return false;
      if (
        query.includes("ad_group.status != 'REMOVED'") &&
        group.status === "REMOVED"
      )
        return false;
      if (
        query.includes("ad_group_criterion.status != 'REMOVED'") &&
        criterion.status === "REMOVED"
      )
        return false;
      const campaignFilter = query.match(/campaign.id IN \(([^)]+)\)/);
      if (
        campaignFilter &&
        !campaignFilter[1]!.split(", ").includes(campaign.id)
      )
        return false;
      const groupFilter = query.match(/ad_group.id IN \(([^)]+)\)/);
      if (groupFilter && !groupFilter[1]!.split(", ").includes(group.id))
        return false;
      const statusFilter = query.match(
        /ad_group_criterion.status IN \(([^)]+)\)/,
      );
      if (statusFilter && !statusFilter[1]!.includes(`'${criterion.status}'`))
        return false;
      return true;
    });
    const start = token ? Number(token) : 0;
    return {
      results: filtered.slice(start, start + 2),
      nextPageToken:
        start + 2 < filtered.length ? String(start + 2) : undefined,
    };
  });
  const stream = vi.fn(async (query: string) =>
    metrics.filter((row) =>
      query.includes(`'${row.adGroupCriterion.resourceName}'`),
    ),
  );
  return { search, stream };
}

describe("Google keyword read", () => {
  it("merges metrics, converts micros once, retains currency, URLs and quality", async () => {
    const { search, stream } = fixture(
      [keyword(1, "[приват клиника]")],
      [metric(1, "2998000000")],
    );
    const result = await listGoogleKeywords(
      accountId,
      options,
      "USD",
      search,
      stream,
    );
    expect(result.items[0]).toMatchObject({
      resource_name: name(1),
      criterion_id: "1",
      campaign_id: "1",
      ad_group_id: "10",
      text: "[приват клиника]",
      match_type: "EXACT",
      status: "ENABLED",
      serving_status: "ELIGIBLE",
      approval_status: "APPROVED",
      quality_score: 7,
      cpc: 2.5,
      effective_cpc: 3,
      final_urls: ["https://example.test/one"],
      impressions: 100,
      clicks: 10,
      cost: 2998,
      currency: "USD",
      conversions: 2,
      all_conversions: 3,
      cost_per_conversion: 1499,
    });
    expect(stream.mock.calls[0]![0]).toContain(
      "FROM keyword_view WHERE segments.date BETWEEN '2026-03-01' AND '2026-09-28'",
    );
    expect(search.mock.calls[0]![0]).toContain("FROM ad_group_criterion");
    expect(search.mock.calls[0]![0]).not.toContain("segments.date");
  });

  it("keeps a zero-traffic keyword and uses null for cost per zero conversions", async () => {
    const result = await listGoogleKeywords(
      accountId,
      options,
      "USD",
      fixture([keyword(1, "idle")]).search,
      fixture([], []).stream,
    );
    expect(result.items[0]).toMatchObject({
      impressions: 0,
      clicks: 0,
      cost: 0,
      conversions: 0,
      all_conversions: 0,
      cost_per_conversion: null,
    });
    expect(result.items[0]?.quality_score).toBe(7);
    const noQuality = keyword(2, "new");
    (noQuality.adGroupCriterion as Record<string, unknown>).qualityInfo = {};
    const second = fixture([noQuality]);
    expect(
      (
        await listGoogleKeywords(
          accountId,
          options,
          "USD",
          second.search,
          second.stream,
        )
      ).items[0]?.quality_score,
    ).toBeNull();
  });

  it("filters removed campaign/ad group/keyword and applies campaign, group and explicit status filters", async () => {
    const removedKeyword = keyword(2, "removed");
    (removedKeyword.adGroupCriterion as Record<string, unknown>).status =
      "REMOVED";
    const removedCampaign = keyword(3, "bad campaign", {
      campaign: { id: "2", name: "Removed", status: "REMOVED" },
    });
    const removedGroup = keyword(4, "bad group", {
      adGroup: { id: "11", name: "Removed", status: "REMOVED" },
    });
    const paused = keyword(5, "paused");
    (paused.adGroupCriterion as Record<string, unknown>).status = "PAUSED";
    const mock = fixture([
      keyword(1, "enabled"),
      removedKeyword,
      removedCampaign,
      removedGroup,
      paused,
    ]);
    const result = await listGoogleKeywords(
      accountId,
      { ...options, campaignIds: ["1"], adGroupIds: ["10"] },
      "USD",
      mock.search,
      mock.stream,
    );
    expect(result.items.map((item) => item.text)).toEqual([
      "enabled",
      "paused",
    ]);
    expect(mock.search.mock.calls[0]![0]).toContain("campaign.id IN (1)");
    expect(mock.search.mock.calls[0]![0]).toContain("ad_group.id IN (10)");
    const explicit = fixture([removedKeyword, paused]);
    const selected = await listGoogleKeywords(
      accountId,
      { ...options, statuses: ["REMOVED"] },
      "USD",
      explicit.search,
      explicit.stream,
    );
    expect(selected.items.map((item) => item.text)).toEqual(["removed"]);
    expect(explicit.search.mock.calls[0]![0]).toContain(
      "ad_group_criterion.status IN ('REMOVED')",
    );
  });

  it("applies min_cost after metrics and paginates without losing matches", async () => {
    const rows = [
      keyword(1, "low"),
      keyword(2, "first"),
      keyword(3, "low again"),
      keyword(4, "second"),
    ];
    const mock = fixture(rows, [
      metric(1, "100000"),
      metric(2, "5000000"),
      metric(3, "100000"),
      metric(4, "6000000"),
    ]);
    const first = await listGoogleKeywords(
      accountId,
      { ...options, limit: 1, minCost: 1 },
      "USD",
      mock.search,
      mock.stream,
    );
    expect(first.items.map((item) => item.text)).toEqual(["first"]);
    expect(first.nextCursor).toBeTruthy();
    const second = await listGoogleKeywords(
      accountId,
      { ...options, limit: 1, minCost: 1, cursor: first.nextCursor },
      "USD",
      mock.search,
      mock.stream,
    );
    expect(second.items.map((item) => item.text)).toEqual(["second"]);
    expect(second.nextCursor).toBeUndefined();
    await expect(
      listGoogleKeywords(
        accountId,
        { ...options, minCost: 2, cursor: first.nextCursor },
        "USD",
        mock.search,
        mock.stream,
      ),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("normalizes only Google syntax and reports other ENABLED campaigns", async () => {
    expect(normalizeKeywordText("[Приват Клиника]")).toBe("приват клиника");
    expect(normalizeKeywordText('"ПРИВАТ КЛИНИКА"')).toBe("приват клиника");
    expect(normalizeKeywordText("+приват +клиника")).toBe("приват клиника");
    expect(normalizeKeywordText("клиника приват")).not.toBe("приват клиника");
    const same = keyword(1, "[Приват Клиника]");
    const other = keyword(2, '"ПРИВАТ КЛИНИКА"', {
      campaign: { id: "2", name: "Other", status: "ENABLED" },
    });
    const paused = keyword(3, "+приват +клиника", {
      campaign: { id: "3", name: "Paused", status: "PAUSED" },
    });
    const unrelated = keyword(4, "клиника приват", {
      campaign: { id: "4", name: "Other words", status: "ENABLED" },
    });
    const mock = fixture([same], [], [same, same, other, paused, unrelated]);
    const result = await listGoogleKeywords(
      accountId,
      options,
      "USD",
      mock.search,
      mock.stream,
    );
    expect(result.items[0]?.duplicate_in_campaigns).toEqual([
      { campaign_id: "2", campaign_name: "Other" },
    ]);
    expect(
      mock.search.mock.calls.filter(
        ([query]) => query === keywordDuplicateQuery(),
      ),
    ).toHaveLength(1);
    expect(keywordDuplicateQuery()).toContain("campaign.status = 'ENABLED'");
  });

  it("validates inputs and builds v24 field sets", () => {
    expect(() => keywordOptions({ ...options, statuses: ["UNKNOWN"] })).toThrow(
      ProviderError,
    );
    expect(() =>
      keywordOptions({ ...options, campaignIds: ["1' OR 1=1"] }),
    ).toThrow(ProviderError);
    expect(() => keywordOptions({ ...options, adGroupIds: ["x"] })).toThrow(
      ProviderError,
    );
    expect(() =>
      keywordOptions({
        ...options,
        range: { startDate: "2026-02-30", endDate: "2026-03-01" },
      }),
    ).toThrow(ProviderError);
    expect(keywordInventoryQuery(options)).toContain(
      "ad_group_criterion.effective_cpc_bid_micros",
    );
    expect(keywordMetricsQuery([name(1)], range)).toContain(
      "metrics.all_conversions",
    );
  });
});

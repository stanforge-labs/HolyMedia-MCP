import { describe, expect, it, vi } from "vitest";
import {
  checkGoogleNegativeConflicts,
  listGoogleNegatives,
  negativeMatch,
  negativeOptions,
  negativeQuery,
  normalizeNegativeInputs,
} from "./google-ads-negatives.js";
import { ProviderError } from "./provider.errors.js";
import { GoogleAdsApiError } from "./google-ads.error.js";
import type { GoogleNegativeOptions } from "./provider.types.js";

const account = "9458996580";
const campaign = { id: "123", name: "Search" };
const campaign2 = { id: "124", name: "Search 2" };
const set = { id: "77", name: "Blocked terms", resourceName: `customers/${account}/sharedSets/77`, status: "ENABLED", memberCount: "2" };
const negative = (id: string, text: string) => ({
  resourceName: `customers/${account}/campaignCriteria/123~${id}`,
  criterionId: id, keyword: { text, matchType: "BROAD" }, status: "ENABLED",
});
const campaignRow = (id: string, text: string) => ({ campaign, campaignCriterion: negative(id, text) });
const adGroupRow = (id: string, text: string) => ({
  campaign, adGroup: { id: "456", name: "Group" },
  adGroupCriterion: { ...negative(id, text), resourceName: `customers/${account}/adGroupCriteria/456~${id}` },
});
const listRow = { sharedSet: set };
const memberRow = (id: string, text: string) => ({
  sharedSet: set,
  sharedCriterion: { criterionId: id,
    resourceName: `customers/${account}/sharedCriteria/77~${id}`,
    keyword: { text, matchType: "PHRASE" } },
});
const attachmentRow = (linkedCampaign = campaign) => ({
  sharedSet: set, campaign: linkedCampaign,
  campaignSharedSet: { resourceName: `customers/${account}/campaignSharedSets/${linkedCampaign.id}~77`, status: "ENABLED" },
});

function searchFixture() {
  return vi.fn(async (query: string, token?: string) => {
    if (query.includes("FROM campaign_criterion"))
      return { results: [campaignRow("1", "campaign negative")] };
    if (query.includes("FROM ad_group_criterion"))
      return { results: [adGroupRow("2", "group negative")] };
    if (query.includes("FROM shared_criterion"))
      return { results: [memberRow("3", "shared phrase"), memberRow("4", "shared second")] };
    if (query.includes("FROM campaign_shared_set"))
      return { results: [attachmentRow(), attachmentRow(campaign2)] };
    if (query.includes("FROM shared_set")) return { results: [listRow] };
    throw Error(`Unexpected query: ${query} ${token ?? ""}`);
  });
}

async function allPages(options: GoogleNegativeOptions, search = searchFixture()) {
  const pages = [];
  let cursor: string | undefined;
  for (let count = 0; count < 20; count++) {
    const page = await listGoogleNegatives(account, { ...options, ...(cursor ? { cursor } : {}) }, search);
    pages.push(page);
    cursor = page.next_cursor ?? undefined;
    if (!cursor) return { pages, search };
  }
  throw Error("pagination did not finish");
}

describe("Google Ads negative reads", () => {
  it("builds v24 campaign, ad group, shared set, member and attachment queries", () => {
    const queries = ["campaign", "ad_group", "lists", "members", "attachments"] as const;
    for (const phase of queries) expect(negativeQuery(phase)).toContain(`FROM ${phase === "lists" ? "shared_set" : phase === "members" ? "shared_criterion" : phase === "attachments" ? "campaign_shared_set" : phase === "campaign" ? "campaign_criterion" : "ad_group_criterion"}`);
    expect(negativeQuery("campaign", ["123"])).toContain("campaign_criterion.negative = TRUE");
    expect(negativeQuery("campaign", ["123"])).toContain("campaign.id IN (123)");
    expect(negativeQuery("ad_group", ["123"])).toContain("ad_group_criterion.negative = TRUE");
    expect(negativeQuery("ad_group", ["123"])).toContain("campaign.id IN (123)");
    expect(negativeQuery("lists")).toContain("shared_set.member_count");
    expect(negativeQuery("members")).toContain("shared_criterion.keyword.match_type");
    expect(negativeQuery("attachments", ["123"])).toContain("campaign_shared_set.status = 'ENABLED'");
    expect(negativeQuery("members", undefined, [set.resourceName])).toContain(`shared_set.resource_name IN ('${set.resourceName}')`);
  });

  it("returns all levels by default, including members and multi-campaign attachments", async () => {
    const { pages } = await allPages({ limit: 100 });
    expect(pages.map((page) => page.page_section)).toEqual([
      "campaign", "ad_group", "shared_list", "shared_list", "shared_list",
    ]);
    expect(pages[0]?.campaign.campaigns[0]).toMatchObject({
      campaign_id: "123", negatives: [{ criterion_id: "1", text: "campaign negative", match_type: "BROAD", status: "ENABLED" }],
    });
    expect(pages[1]?.ad_group.campaigns[0]?.ad_groups[0]).toMatchObject({
      ad_group_id: "456", negatives: [{ criterion_id: "2", text: "group negative" }],
    });
    expect(pages[2]?.shared_list.lists[0]).toMatchObject({
      shared_set_id: "77", name: "Blocked terms", status: "ENABLED", member_count: 2,
      fragment_kind: "metadata", negatives: [], attached_campaigns: [],
    });
    expect(pages[3]?.shared_list.lists[0]).toMatchObject({
      fragment_kind: "members", negatives: [{ criterion_id: "3", match_type: "PHRASE" }, { criterion_id: "4" }],
    });
    expect(pages[4]?.shared_list.lists[0]?.attached_campaigns.map((item) => item.campaign_id)).toEqual(["123", "124"]);
    expect(pages.at(-1)?.next_cursor).toBeNull();
  });

  it("restricts levels and campaign/shared-list associations", async () => {
    for (const level of ["campaign", "ad_group", "shared_list"] as const) {
      const search = searchFixture();
      const { pages } = await allPages({ limit: 100, levels: [level], campaignIds: ["123"] }, search);
      expect(pages.every((page) => page.page_section === level)).toBe(true);
      expect(search.mock.calls.every(([query]) =>
        level === "shared_list" || query.includes("campaign.id IN (123)"))).toBe(true);
      if (level === "shared_list") {
        expect(search.mock.calls.some(([query]) => query.includes(`shared_set.resource_name IN ('${set.resourceName}')`))).toBe(true);
        expect(search.mock.calls.filter(([query]) => query.includes("FROM campaign_shared_set"))).toHaveLength(3);
      }
    }
  });

  it("paginates within a provider page, binds the cursor to filters, and returns empty results", async () => {
    const search = vi.fn(async (_query: string) => ({ results: [campaignRow("1", "one"), campaignRow("2", "two"), campaignRow("3", "three")] }));
    const first = await listGoogleNegatives(account, { levels: ["campaign"], limit: 2 }, search);
    expect(first.campaign.campaigns[0]?.negatives.map((item) => item.text)).toEqual(["one", "two"]);
    const second = await listGoogleNegatives(account, { levels: ["campaign"], limit: 2, cursor: first.next_cursor! }, search);
    expect(second.campaign.campaigns[0]?.negatives.map((item) => item.text)).toEqual(["three"]);
    expect(second.next_cursor).toBeNull();
    await expect(listGoogleNegatives(account, { levels: ["ad_group"], limit: 2, cursor: first.next_cursor! }, search)).rejects.toMatchObject({ code: "invalid_request" });
    const empty = await listGoogleNegatives(account, { levels: ["campaign"], limit: 2 }, vi.fn(async () => ({ results: [] })));
    expect(empty.campaign.campaigns).toEqual([]);
    expect(empty.next_cursor).toBeNull();
  });

  it("uses provider page tokens without skipping rows", async () => {
    const search = vi.fn(async (_query: string, token?: string) => token
      ? { results: [campaignRow("2", "second")] }
      : { results: [campaignRow("1", "first")], nextPageToken: "next" });
    const first = await listGoogleNegatives(account, { levels: ["campaign"], limit: 1 }, search);
    expect(first.campaign.campaigns[0]?.negatives[0]?.text).toBe("first");
    const second = await listGoogleNegatives(account, { levels: ["campaign"], limit: 1, cursor: first.next_cursor! }, search);
    expect(second.campaign.campaigns[0]?.negatives[0]?.text).toBe("second");
    expect(second.next_cursor).toBeNull();
    expect(search.mock.calls.map((call) => call[1])).toEqual([undefined, "next"]);
  });

  it("validates account filters, levels, limit and cursor", async () => {
    expect(() => negativeOptions({ limit: 1, levels: ["unknown" as never] })).toThrowError(ProviderError);
    expect(() => negativeOptions({ limit: 1, campaignIds: ["1) OR TRUE"] })).toThrowError(ProviderError);
    expect(() => negativeOptions({ limit: 501 })).toThrowError(ProviderError);
    expect(() => negativeOptions({ limit: 1, cursor: "" })).toThrowError(ProviderError);
    await expect(listGoogleNegatives(account, { limit: 1, cursor: "garbage" }, searchFixture())).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("keeps missing member_count nullable and passes structured Google errors through", async () => {
    const page = await listGoogleNegatives(account, { levels: ["shared_list"], limit: 100 },
      vi.fn(async () => ({ results: [{ sharedSet: { ...set, memberCount: undefined } }] })));
    expect(page.shared_list.lists[0]?.member_count).toBeNull();
    const googleError = new GoogleAdsApiError(
      [{ error_code: "QUERY_ERROR", message: "Google rejected query", field_path: "query" }],
      "request-123", 400,
    );
    await expect(listGoogleNegatives(account, { levels: ["campaign"], limit: 1 },
      vi.fn(async () => { throw googleError; }))).rejects.toBe(googleError);
  });
});

function positive(text: string, status = "ENABLED", campaignId = "123", criterionId = "1", negative = false) {
  return {
    campaign: { id: campaignId, name: `Campaign ${campaignId}`, status: "ENABLED" },
    adGroup: { id: "456", name: "Group", status: "ENABLED" },
    adGroupCriterion: {
      resourceName: `customers/${account}/adGroupCriteria/456~${criterionId}`,
      criterionId, keyword: { text, matchType: "EXACT" }, status, negative,
    },
  };
}

describe("Google Ads negative conflict checker", () => {
  it("implements all required broad, phrase and exact text cases", () => {
    const cases: Array<[string, "BROAD" | "PHRASE" | "EXACT", string, boolean]> = [
      ["приват", "BROAD", "приват клиника", true],
      ["приват клиника", "BROAD", "клиника приват алматы", true],
      ["приват клиника", "BROAD", "приват медицинская клиника", true],
      ["приват клиника", "BROAD", "приват", false],
      ["приват клиника", "PHRASE", "лучшая приват клиника алматы", true],
      ["приват клиника", "PHRASE", "приват медицинская клиника", false],
      ["приват клиника", "PHRASE", "клиника приват", false],
      ["приват клиника", "EXACT", "приват клиника", true],
      ["приват клиника", "EXACT", "приват клиника алматы", false],
    ];
    for (const [text, match_type, keyword, expected] of cases)
      expect(negativeMatch({ text, match_type }, keyword)).toBe(expected);
    expect(negativeMatch({ text: "приват клиника", match_type: "EXACT" }, "  ПРИВАТ   КЛИНИКА  ")).toBe(true);
    expect(negativeMatch({ text: "приват клиника", match_type: "BROAD" }, "приват клиники")).toBe(false);
  });

  it("normalizes Google syntax and deduplicates by normalized text plus match type", () => {
    expect(normalizeNegativeInputs([
      { text: "  ПРИВАТ   КЛИНИКА  ", match_type: "BROAD" },
      { text: "приват клиника" },
      { text: '"Приват клиника"' },
      { text: "[приват клиника]" },
    ])).toEqual([
      { text: "приват клиника", match_type: "BROAD" },
      { text: "приват клиника", match_type: "PHRASE" },
      { text: "приват клиника", match_type: "EXACT" },
    ]);
    expect(() => normalizeNegativeInputs([{ text: " " }])).toThrowError(ProviderError);
    expect(() => normalizeNegativeInputs([{ text: "x", match_type: "INVALID" as never }])).toThrowError(ProviderError);
    expect(() => normalizeNegativeInputs([{ text: '"x"', match_type: "EXACT" }])).toThrowError(ProviderError);
  });

  it("checks only enabled positive keywords in selected campaigns, retaining real placements", async () => {
    const search = vi.fn(async (query: string) => {
      expect(query).toContain("ad_group_criterion.negative = FALSE");
      expect(query).toContain("ad_group_criterion.status IN ('ENABLED')");
      expect(query).toContain("campaign.id IN (123, 124)");
      return { results: [
        positive("[приват клиника]", "ENABLED", "123", "1"),
        positive("[приват клиника]", "ENABLED", "124", "2"),
        positive("[приват клиника]", "PAUSED", "123", "3"),
        positive("[приват клиника]", "REMOVED", "123", "4"),
        positive("[приват клиника]", "ENABLED", "999", "5"),
        positive("[приват клиника]", "ENABLED", "123", "6", true),
      ] };
    });
    const result = await checkGoogleNegativeConflicts(account, {
      campaignIds: ["123", "124"], negatives: [{ text: "приват", match_type: "BROAD" }, { text: "ПРИВАТ", match_type: "BROAD" }], limit: 100,
    }, search);
    expect(result.conflicts).toHaveLength(2);
    expect(result.conflicts.map((item) => item.campaign.id)).toEqual(["123", "124"]);
    expect(result.conflicts[0]).toMatchObject({
      negative: { text: "приват", match_type: "BROAD" },
      keyword: { text: "[приват клиника]", status: "ENABLED", match_type: "EXACT" },
      reason: { code: "BROAD_ALL_TERMS_PRESENT" },
    });
    expect(result.next_cursor).toBeNull();
    expect(search).toHaveBeenCalledTimes(1);
  });

  it("paginates conflicts across negatives and rejects changed-input cursors", async () => {
    const search = vi.fn(async () => ({ results: [positive("приват клиника")] }));
    const options = { campaignIds: ["123"], negatives: [
      { text: "приват", match_type: "BROAD" as const },
      { text: "клиника", match_type: "BROAD" as const },
    ], limit: 1 };
    const first = await checkGoogleNegativeConflicts(account, options, search);
    expect(first.conflicts).toHaveLength(1);
    expect(first.next_cursor).toBeTruthy();
    const second = await checkGoogleNegativeConflicts(account, { ...options, cursor: first.next_cursor! }, search);
    expect(second.conflicts).toHaveLength(1);
    expect(second.conflicts[0]?.negative.text).toBe("клиника");
    expect(second.next_cursor).toBeNull();
    await expect(checkGoogleNegativeConflicts(account, { ...options, negatives: [{ text: "other" }], cursor: first.next_cursor! }, search)).rejects.toMatchObject({ code: "invalid_request" });
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { MetaAdsAdapter } from "./adapters/meta.ads.js";
import { metaInsightsParameters } from "./meta-insights.parameters.js";
import { metaReadError } from "./meta-read.error.js";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
const credentials = {
  accessToken: "fixture-user-only",
  scopes: ["pages_read_engagement", "ads_read"],
};
const context = { credentials, accountId: "act_11", currency: "USD" };
const permission = {
  error: {
    code: 10,
    message:
      "This endpoint requires the 'pages_read_user_content' permission or the 'Page Public Content Access' feature.",
  },
};
afterEach(() => vi.unstubAllGlobals());
describe("Page post fields and canonical Page token", () => {
  it("list and fresh single-post read work while engagement explains the actual missing permission", async () => {
    const fetch = vi.fn(async (raw: string, init: RequestInit) => {
      const url = new URL(raw);
      const fields = url.searchParams.get("fields") ?? "";
      if (url.pathname.endsWith("/me/accounts"))
        return json({
          data: [{ id: "101", access_token: "fixture-page-only" }],
        });
      expect(init.headers).toEqual({
        authorization: "Bearer fixture-page-only",
      });
      expect(init.method).toBe("GET");
      if (fields.includes("reactions")) return json(permission, 400);
      return json(
        url.pathname.endsWith("/published_posts")
          ? { data: [{ id: "101_1", shares: { count: 2 } }] }
          : {
              id: "101_1",
              message: "Fresh direct response",
              shares: { count: 2 },
            },
      );
    });
    vi.stubGlobal("fetch", fetch);
    const adapter = new MetaAdsAdapter();
    const listed = await adapter.listPagePosts(credentials, "101", 2);
    expect(listed.items[0]?.id).toBe("101_1");
    const post = await adapter.getPagePost(credentials, "101", "101_1");
    expect(post).toMatchObject({
      message: "Fresh direct response",
      shares: { count: 2 },
    });
    try {
      await adapter.getPagePost(credentials, "101", "101_1", true);
      throw new Error("expected upstream denial");
    } catch (error) {
      expect(
        metaReadError(error, "get_page_post_engagement").publicResult(),
      ).toMatchObject({
        code: "meta_permission_required",
        required_permission: "pages_read_user_content",
        alternative_feature: "Page Public Content Access",
        upstream_code: "10",
      });
    }
    expect(JSON.stringify({ listed, post })).not.toContain("fixture-page-only");
    expect(JSON.stringify(post)).not.toContain("access_token");
  });
  it("returns actual engagement when upstream permits it", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ data: [{ id: "101", access_token: "fixture-page-only" }] }),
        )
        .mockResolvedValueOnce(
          json({
            id: "101_1",
            reactions: { summary: { total_count: 3 } },
            comments: { summary: { total_count: 1 } },
          }),
        ),
    );
    expect(
      await new MetaAdsAdapter().getPagePost(credentials, "101", "101_1", true),
    ).toMatchObject({ reactions: { summary: { total_count: 3 } } });
  });
  it("does not infer a named permission from generic code 10", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ data: [{ id: "101", access_token: "fixture-page-only" }] }),
        )
        .mockResolvedValueOnce(
          json({ error: { code: 10, message: "Permission denied" } }, 400),
        ),
    );
    try {
      await new MetaAdsAdapter().getPagePost(credentials, "101", "101_1", true);
    } catch (error) {
      expect(
        metaReadError(error, "get_page_post_engagement").publicResult(),
      ).not.toHaveProperty("required_permission");
    }
  });
});
describe("purchase_roas capability and useful mixed reports", () => {
  it("parses ROAS as action stats without substituting another metric", async () => {
    const fetch = vi.fn().mockResolvedValue(
      json({
        data: [
          {
            spend: "10",
            purchase_roas: [{ action_type: "omni_purchase", value: "2.5" }],
            action_values: [],
            cost_per_action_type: [{ action_type: "lead", value: "1" }],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await new MetaAdsAdapter().flexibleInsights(
      context,
      metaInsightsParameters({
        metrics: [
          "spend",
          "purchase_roas",
          "action_values",
          "cost_per_action_type",
        ],
      }),
    );
    expect(result.items[0]).toMatchObject({
      purchase_roas: [{ action_type: "omni_purchase", value: 2.5 }],
      action_values: [],
    });
    expect(result.returned_metrics).toContain("purchase_roas");
    expect(result.unsupported_metrics).toEqual([]);
    expect(
      new URL(fetch.mock.calls[0]![0]).searchParams.get("fields"),
    ).toContain("purchase_roas");
  });
  it("distinguishes omitted ROAS from unsupported capability and zero", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(json({ data: [{ spend: "10" }] })),
    );
    const result = await new MetaAdsAdapter().flexibleInsights(
      context,
      metaInsightsParameters({ metrics: ["spend", "purchase_roas"] }),
    );
    expect(result.items[0]?.purchase_roas).toEqual([]);
    expect(result.returned_metrics).toEqual(["spend"]);
    expect(result.unsupported_metrics).toEqual([]);
    expect(result.unavailable_metrics[0]?.metric).toBe("purchase_roas");
  });
  it("retains valid metrics after a deterministic combination rejection with explicit explanation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json(
          { error: { code: 100, message: "Invalid field combination" } },
          400,
        ),
      )
      .mockResolvedValueOnce(json({ data: [{ spend: "10", reach: "20" }] }));
    vi.stubGlobal("fetch", fetch);
    const result = await new MetaAdsAdapter().flexibleInsights(
      context,
      metaInsightsParameters({ metrics: ["spend", "reach", "purchase_roas"] }),
    );
    expect(result.items[0]).toMatchObject({ spend: 10, reach: 20 });
    expect(result.items[0]).not.toHaveProperty("purchase_roas");
    expect(result.unsupported_metrics[0]).toMatchObject({
      metric: "purchase_roas",
      upstream_code: "100",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      new URL(fetch.mock.calls[1]![0]).searchParams.get("fields"),
    ).not.toContain("purchase_roas");
  });
  it("never retries auth or throttling as metric capability fallback", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(json({ error: { code: 190 } }, 400));
    vi.stubGlobal("fetch", fetch);
    await expect(
      new MetaAdsAdapter().flexibleInsights(
        context,
        metaInsightsParameters({ metrics: ["spend", "purchase_roas"] }),
      ),
    ).rejects.toMatchObject({ providerCode: "190" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects arbitrary unknown metric before upstream", () => {
    expect(() =>
      metaInsightsParameters({ metrics: ["spend", "arbitrary_unsafe"] }),
    ).toThrow();
  });
});

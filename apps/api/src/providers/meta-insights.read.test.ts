import { afterEach, describe, it, expect, vi } from "vitest";
import { MetaAdsAdapter } from "./adapters/meta.ads.js";
import { metaInsightsParameters } from "./meta-insights.parameters.js";
const response = (x: unknown) =>
  new Response(JSON.stringify(x), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
const ctx = {
  accountId: "act_111",
  currency: "USD",
  credentials: { accessToken: "fixture-only", scopes: ["ads_read"] },
};
afterEach(() => vi.unstubAllGlobals());
describe("Meta extended Insights and pagination", () => {
  it("rejects a foreign Page post before calling Meta", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      new MetaAdsAdapter().getPagePost(ctx.credentials, "101", "202_1"),
    ).rejects.toMatchObject({ code: "invalid_account" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reads a known ad directly and rejects an ad belonging to a different account", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        response({ id: "99", account_id: "111", name: "Ad", status: "PAUSED" }),
      );
    vi.stubGlobal("fetch", fetch);
    const adapter = new MetaAdsAdapter();
    expect(await adapter.readEntity(ctx, "ad", "99")).toMatchObject({
      id: "99",
      account_id: "111",
    });
    fetch.mockResolvedValue(response({ id: "99", account_id: "222" }));
    await expect(adapter.readEntity(ctx, "ad", "99")).rejects.toMatchObject({
      code: "invalid_account",
    });
  });
  it.each(["campaign", "adset", "ad"] as const)(
    "uses account-scoped %s lists and opaque pagination",
    async (kind) => {
      const fetch = vi.fn().mockResolvedValue(
        response({
          data: [],
          paging: {
            next: "https://graph.facebook.com/next",
            cursors: { after: "next" },
          },
        }),
      );
      vi.stubGlobal("fetch", fetch);
      const result = await new MetaAdsAdapter().readEntity(
        ctx,
        kind,
        undefined,
        25,
        "previous",
      );
      const url = new URL(fetch.mock.calls[0]![0]);
      expect(url.pathname).toContain("/act_111/");
      expect(url.searchParams.get("after")).toBe("previous");
      expect(result).toMatchObject({ nextCursor: "next", truncated: true });
    },
  );
  it("campaign list uses Graph cursors, not local offsets", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        data: [{ id: "1", name: "one" }],
        paging: {
          next: "https://graph.facebook.com/next",
          cursors: { after: "opaque-next" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await new MetaAdsAdapter().listCampaigns(
      ctx,
      undefined,
      25,
      "opaque-previous",
    );
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get("after")).toBe(
      "opaque-previous",
    );
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe("opaque-next");
  });
  it("sends requested fields and retains actions, action_values, reach and frequency", async () => {
    const fetch = vi.fn().mockResolvedValue(
      response({
        data: [
          {
            reach: "20",
            frequency: "1.5",
            actions: [{ action_type: "lead", value: "2" }],
            action_values: [{ action_type: "purchase", value: "100" }],
          },
        ],
        paging: {
          next: "https://graph.facebook.com/next?access_token=not-returned",
          cursors: { after: "next-cursor" },
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const r = await new MetaAdsAdapter().flexibleInsights(
      ctx,
      metaInsightsParameters({
        metrics: [
          "reach",
          "frequency",
          "actions",
          "action_values",
          "conversions",
        ],
      }),
    );
    expect(
      new URL(fetch.mock.calls[0]![0]).searchParams.get("fields"),
    ).toContain("reach,frequency,actions,action_values");
    expect(r.items[0]).toMatchObject({
      reach: 20,
      frequency: 1.5,
      actions: [{ action_type: "lead", value: 2 }],
      action_values: [{ action_type: "purchase", value: 100 }],
    });
    expect(r.nextCursor).toBe("next-cursor");
    expect(r.truncated).toBe(true);
    expect(JSON.stringify(r)).not.toContain("access_token");
  });
  it("uses provider cursor rather than local offsets", async () => {
    const fetch = vi.fn().mockResolvedValue(response({ data: [] }));
    vi.stubGlobal("fetch", fetch);
    await new MetaAdsAdapter().flexibleInsights(
      ctx,
      metaInsightsParameters({ cursor: "opaque" }),
    );
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get("after")).toBe(
      "opaque",
    );
  });
  it("detailed report combines per-campaign insights with status and verified parent account", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          data: [
            {
              campaign_id: "123",
              campaign_name: "Sample",
              spend: "15",
              impressions: "100",
              clicks: "5",
              actions: [],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        response({
          id: "123",
          name: "Sample",
          status: "PAUSED",
          account_id: "111",
        }),
      );
    vi.stubGlobal("fetch", fetch);
    const r = await new MetaAdsAdapter().detailedReport(
      ctx,
      metaInsightsParameters({}, true),
    );
    expect(r.items[0]).toMatchObject({
      id: "123",
      status: "PAUSED",
      metrics: { spend: 15, impressions: 100, clicks: 5 },
    });
    expect(new URL(fetch.mock.calls[0]![0]).searchParams.get("level")).toBe(
      "campaign",
    );
  });
});

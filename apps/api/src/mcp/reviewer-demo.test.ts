import { describe, expect, it, vi } from "vitest";
import { isReviewerDemoWorkspace, reviewerDemoCall } from "./reviewer-demo.js";

const account = { provider: "GOOGLE_ADS", account_id: "9990000001" };

describe("isolated synthetic reviewer fixtures", () => {
  it("requires the owner-created marker, fixed slug and active workspace", async () => {
    const workspace = {
      slug: "holypilot-anthropic-reviewer-demo",
      accessStatus: "ACTIVE",
      entitlements: [
        { value: true, source: "reviewer_demo_bootstrap", expiresAt: null },
      ],
    };
    const database = {
      client: { workspace: { findUnique: vi.fn(async () => workspace) } },
    };
    await expect(
      isReviewerDemoWorkspace(database as never, "demo"),
    ).resolves.toBe(true);
    workspace.entitlements[0]!.source = "admin_manual";
    await expect(
      isReviewerDemoWorkspace(database as never, "demo"),
    ).rejects.toThrow();
    workspace.entitlements = [];
    await expect(
      isReviewerDemoWorkspace(database as never, "demo"),
    ).rejects.toThrow();
    workspace.slug = "ordinary";
    await expect(
      isReviewerDemoWorkspace(database as never, "demo"),
    ).resolves.toBe(false);
    workspace.entitlements = [
      { value: true, source: "reviewer_demo_bootstrap", expiresAt: null },
    ];
    workspace.slug = "client-workspace";
    await expect(
      isReviewerDemoWorkspace(database as never, "demo"),
    ).rejects.toThrow();
    workspace.slug = "holypilot-anthropic-reviewer-demo";
    workspace.accessStatus = "SUSPENDED";
    await expect(
      isReviewerDemoWorkspace(database as never, "demo"),
    ).rejects.toThrow();
  });

  it("labels inventory, metrics, report and Search Console as synthetic", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    try {
      const inventory = reviewerDemoCall("list_ad_accounts", {}) as Array<
        Record<string, unknown>
      >;
      expect(inventory).toHaveLength(2);
      expect(
        inventory.every(
          (item) => item.realData === false && item.dataStatus === "demo",
        ),
      ).toBe(true);
      const current = {
        ...account,
        current_start_date: "2026-10-07",
        current_end_date: "2026-10-20",
        previous_start_date: "2026-09-23",
        previous_end_date: "2026-10-06",
      };
      const comparison = reviewerDemoCall("compare_periods", current) as Record<
        string,
        unknown
      >;
      expect(comparison).toMatchObject({ realData: false, dataStatus: "demo" });
      expect(comparison.current).not.toEqual(comparison.previous);
      const report = reviewerDemoCall("generate_monthly_ads_report", {
        ...account,
        start_date: "2026-10-07",
        end_date: "2026-10-20",
      }) as Record<string, unknown>;
      expect(report).toMatchObject({ realData: false, dataStatus: "demo" });
      expect(report.campaigns).toHaveLength(5);
      const seo = reviewerDemoCall("get_search_console_report", {
        site_url: "sc-domain:demo.invalid",
      }) as Record<string, unknown>;
      expect(seo).toMatchObject({ realData: false, dataStatus: "demo" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects foreign IDs, live diagnostics, preview and invalid periods", () => {
    expect(() =>
      reviewerDemoCall("get_account_status", {
        provider: "GOOGLE_ADS",
        account_id: "5113594991",
      }),
    ).toThrow("Demo account is unavailable");
    expect(() =>
      reviewerDemoCall("get_search_console_report", {
        site_url: "sc-domain:client.example",
      }),
    ).toThrow("Demo property is unavailable");
    expect(() =>
      reviewerDemoCall("run_connection_diagnostics", account),
    ).toThrow("unavailable");
    expect(() => reviewerDemoCall("preview_pause_campaign", account)).toThrow(
      "unavailable",
    );
    expect(() =>
      reviewerDemoCall("list_campaigns", {
        ...account,
        start_date: "2026-02-30",
        end_date: "2026-03-01",
      }),
    ).toThrow("valid YYYY-MM-DD");
  });

  it("rejects periods outside the fixture and cross-provider reports", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    try {
      expect(() =>
        reviewerDemoCall("list_campaigns", {
          ...account,
          start_date: "2026-09-22",
          end_date: "2026-10-20",
        }),
      ).toThrow("outside the available synthetic fixture");
      expect(() =>
        reviewerDemoCall("get_meta_ads_detailed_report", account),
      ).toThrow("Demo account is unavailable");
      expect(() =>
        reviewerDemoCall("get_google_ads_detailed_report", {
          provider: "META_ADS",
          account_id: "9990000002",
        }),
      ).toThrow("Demo account is unavailable");
    } finally {
      vi.useRealTimers();
    }
  });
});

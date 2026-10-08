import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import {
  changedMicros,
  parseStage2Intent,
  assertStage2Gate,
  assertStage2Plan,
  type Stage2Plan,
} from "../providers/google-ads-stage2.js";
import {
  stage2ToolIntent,
  stage2ToolSchema,
} from "./mcp-google-stage2-schema.js";
import { publicTools } from "./mcp-public-tools.js";
import {
  fixture,
  object,
  principal,
  prefix,
  customer,
  keyword,
  type MockRow,
} from "./google-write-test.fixture.js";

function setup() {
  const f = fixture(false, { stage2: true });
  for (const row of f.resources.values()) {
    if (row.campaign)
      Object.assign(object(row.campaign), {
        campaignBudget: `${prefix}/campaignBudgets/20`,
        biddingStrategyType: "MANUAL_CPC",
      });
    if (row.adGroup)
      Object.assign(object(row.adGroup), {
        cpcBidMicros: "100000000",
        targetCpaMicros: "10000000",
      });
  }
  f.resources.set(`${prefix}/campaignBudgets/20`, {
    campaignBudget: {
      resourceName: `${prefix}/campaignBudgets/20`,
      name: "TEST PPC",
      amountMicros: "200000000",
      explicitlyShared: false,
      deliveryMethod: "STANDARD",
      period: "DAILY",
    },
  });
  return f;
}
const absolute = (amount = "200", currency = "KZT") => ({
  mode: "absolute",
  amount,
  currency,
});
const item = (field = "keyword_cpc", change = absolute()): MockRow => ({
  field,
  ...(field === "campaign_daily_budget" ? { campaign_id: "1" } : keyword()),
  change,
});
const preview = (f: ReturnType<typeof setup>, items = [item()]) =>
  f.call("google_ads_bid_budget_preview", { items });
const state = (f: ReturnType<typeof setup>) =>
  object(f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion);

describe("Stage 2 foundation: stock controlled lifecycle, mock HTTP only", () => {
  it("post-write budget association change is NOT VERIFIED even when amount matches", async () => {
    const f = setup(),
      p = await preview(f, [item("campaign_daily_budget", absolute("220"))]);
    await f.approve(p);
    const prior = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await prior(...args);
      const b = JSON.parse(String(args[1]?.body)) as MockRow;
      if (
        String(args[0]).endsWith("campaignBudgets:mutate") &&
        b.validateOnly === false
      )
        object(
          f.resources.get(`${prefix}/campaigns/1`)?.campaign,
        ).campaignBudget = `${prefix}/campaignBudgets/21`;
      return response;
    };
    const r = (await f.mcp.call(principal, "commit_preview", {
      preview_token: p.preview_token,
    })) as MockRow;
    expect(r.status).toBe("NOT_VERIFIED");
    expect(f.writes()).toBe(1);
  });
  it("gate switched OFF after approval blocks commit, and adapter missing adwords fails closed", async () => {
    const f = setup(),
      p = await preview(f);
    await f.approve(p);
    const serviceConfig = object(object(f.previews).config);
    serviceConfig.providerGoogleAdsStage2WriteEnabled = false;
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
    expect(p).toMatchObject({
      partial_failure: true,
      atomic: false,
      provider_request_groups: 1,
      excluded_row_count: 0,
    });
    f.context.credentials.scopes = [];
    await expect(
      f.adapter.stage2(f.context, "build", {
        action: "bid_budget_update",
        items: [item()],
      }),
    ).rejects.toThrow(/adwords/);
  });
  it("durable attempted audit failure precedes every provider write", async () => {
    const f = setup(),
      p = await preview(f);
    await f.approve(p);
    f.audit.record.mockImplementation(async (input) => {
      if (input.eventType === "mcp_google_stage1_operation")
        throw new Error("Mock audit unavailable");
    });
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
  it("MaximizeConversions target CPA override requires explicit campaign target", async () => {
    const f = setup();
    for (const r of f.resources.values())
      if (r.campaign)
        object(r.campaign).biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    const target = {
      field: "ad_group_target_cpa",
      campaign_id: "1",
      ad_group_id: "10",
      change: absolute("25"),
    };
    await expect(preview(f, [target])).rejects.toThrow();
    expect(f.writes()).toBe(0);
    for (const r of f.resources.values())
      if (r.campaign)
        object(r.campaign).maximizeConversions = {
          targetCpaMicros: "12000000",
        };
    expect((await preview(f, [target])).status).toBe("preview");
  });
  it("read-only principal cannot preview bids", async () => {
    const f = setup();
    await expect(
      f.mcp.call(
        { ...principal, scopes: ["adforge:mcp:read"] },
        "google_ads_bid_budget_preview",
        { provider: "GOOGLE_ADS", account_id: customer, items: [item()] },
      ),
    ).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
  });
  it("HTTP 503 mutation stops subsequent groups, no automatic retry", async () => {
    const f = setup(),
      p = await preview(f, [
        item(),
        item("campaign_daily_budget", absolute("220")),
      ]);
    await f.approve(p);
    const prior = globalThis.fetch;
    let mutations = 0;
    globalThis.fetch = async (...args) => {
      const body = JSON.parse(String(args[1]?.body)) as MockRow;
      if (String(args[0]).endsWith(":mutate") && body.validateOnly === false) {
        mutations++;
        return Response.json(
          { error: { code: 503, status: "UNAVAILABLE" } },
          { status: 503 },
        );
      }
      return prior(...args);
    };
    const r = (await f.mcp.call(principal, "commit_preview", {
      preview_token: p.preview_token,
    })) as MockRow;
    expect(r.status).toBe("NOT_VERIFIED");
    expect(mutations).toBe(1);
    expect(state(f).cpcBidMicros).toBe("150000000");
  });
  it("zero/inherited override does not promise automatic rollback", async () => {
    const f = setup();
    state(f).cpcBidMicros = "0";
    const r = await f.commit(await preview(f));
    expect(r.status).toBe("VERIFIED");
    await expect(
      f.mcp.call(principal, "preview_rollback_commit", {
        commit_id: r.commit_id,
      }),
    ).rejects.toThrow(/Inherited/);
    expect(f.writes()).toBe(1);
  });
  it("generic budget schema has no null/undefined branches and Meta handler unchanged", async () => {
    const f = setup(),
      schema = f.mcp
        .tools()
        .find((t) => t.name === "preview_change_campaign_budget")!
        .inputSchema as { oneOf: unknown[] };
    expect(schema.oneOf).toHaveLength(2);
    expect(schema.oneOf.every(Boolean)).toBe(true);
    const create = vi
      .spyOn(f.previews, "create")
      .mockResolvedValue({ status: "meta_fixture" } as never);
    await f.mcp.call(principal, "preview_change_campaign_budget", {
      provider: "META_ADS",
      account_id: "act_1",
      campaign_id: "2",
      daily_budget: 100,
    });
    expect(create).toHaveBeenCalledWith(
      principal,
      expect.objectContaining({
        provider: "META_ADS",
        operation: "change_budget",
        payload: { daily_budget: 100 },
      }),
    );
    expect(f.requests).toHaveLength(0);
  });
  it("defaults OFF independently of the Stage 0/1 gate", () => {
    const c = loadConfig({
      NODE_ENV: "test",
      PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
      GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: customer,
    });
    expect(c.providerGoogleAdsStage2WriteEnabled).toBe(false);
    expect(() => assertStage2Gate(c, customer)).toThrow(/Stage 2/);
  });
  it("keyword absolute preview validates only, approves exact plan, commits/rereads/journals and rolls back through a NEW preview", async () => {
    const f = setup(),
      p = await preview(f);
    expect(f.writes()).toBe(0);
    expect(object((p.items as MockRow[])[0]!.before).cpcBidMicros).toBe(
      "150000000",
    );
    expect(object((p.items as MockRow[])[0]!.after).cpcBidMicros).toBe(
      "200000000",
    );
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(state(f).cpcBidMicros).toBe("200000000");
    expect(state(f)).toMatchObject({
      status: "ENABLED",
      keyword: { text: "тест 101", matchType: "EXACT" },
    });
    const inverse = (await f.mcp.call(principal, "preview_rollback_commit", {
      commit_id: result.commit_id,
    })) as MockRow;
    expect(inverse.rollback_of).toBe(result.commit_id);
    expect(inverse.preview_token).not.toBe(p.preview_token);
    expect(f.writes()).toBe(1);
    expect((await f.commit(inverse)).status).toBe("VERIFIED");
    expect(state(f).cpcBidMicros).toBe("150000000");
    expect((await f.call("list_change_journal", {})).items).toHaveLength(2);
    expect(
      f.requests
        .filter((r) => r.url.endsWith(":mutate"))
        .every((r) => r.body.partialFailure === true),
    ).toBe(true);
  });
  it("group CPC and budget mixed plan retain per-service ordering and do not change status", async () => {
    const f = setup(),
      p = await preview(
        f,
        [
          { ...item("ad_group_cpc"), criterion_id: undefined },
          item("campaign_daily_budget", absolute("220")),
        ].map((x) =>
          Object.fromEntries(
            Object.entries(x).filter(([, v]) => v !== undefined),
          ),
        ),
      );
    expect(p.operation_count).toBe(2);
    expect(f.writes()).toBe(0);
    expect((await f.commit(p)).status).toBe("VERIFIED");
    expect(f.writes()).toBe(2);
    expect(
      object(f.resources.get(`${prefix}/campaigns/1`)?.campaign).status,
    ).toBe("PAUSED");
  });
  it("generic budget tool reuses the Stage 2 builder; no independent write contract", async () => {
    const f = setup(),
      p = await f.call("preview_change_campaign_budget", {
        items: [item("campaign_daily_budget", absolute("220"))],
      });
    expect(p.status).toBe("preview");
    expect(object((p.items as MockRow[])[0]!.after).amountMicros).toBe(
      "220000000",
    );
    expect(f.writes()).toBe(0);
  });
  it("target CPA override supported only for eligible conversion bidding", async () => {
    const f = setup();
    for (const r of f.resources.values())
      if (r.campaign) object(r.campaign).biddingStrategyType = "TARGET_CPA";
    const p = await preview(f, [
      {
        field: "ad_group_target_cpa",
        campaign_id: "1",
        ad_group_id: "10",
        change: absolute("20"),
      },
    ]);
    expect((await f.commit(p)).status).toBe("VERIFIED");
    expect(
      object(f.resources.get(`${prefix}/adGroups/10`)?.adGroup).targetCpaMicros,
    ).toBe("20000000");
  });
  it("target CPA incompatible strategy fails before validate_only", async () => {
    const f = setup();
    await expect(
      preview(f, [
        {
          field: "ad_group_target_cpa",
          campaign_id: "1",
          ad_group_id: "10",
          change: absolute("20"),
        },
      ]),
    ).rejects.toThrow(/Все строки/);
    expect(f.requests.filter((r) => r.url.endsWith(":mutate"))).toHaveLength(0);
  });
  it("shared budget impact names ALL affected campaigns and participates in stale snapshot", async () => {
    const f = setup();
    object(
      f.resources.get(`${prefix}/campaignBudgets/20`)?.campaignBudget,
    ).explicitlyShared = true;
    f.resources.set(`${prefix}/campaigns/2`, {
      campaign: {
        ...object(f.resources.get(`${prefix}/campaigns/1`)?.campaign),
        id: "2",
        resourceName: `${prefix}/campaigns/2`,
        name: "SECOND",
      },
    });
    const p = await preview(f, [
      item("campaign_daily_budget", absolute("250")),
    ]);
    expect(JSON.stringify((p.items as MockRow[])[0]!.warnings)).toContain(
      "SECOND",
    );
    await f.approve(p);
    object(f.resources.get(`${prefix}/campaigns/2`)?.campaign).name = "CHANGED";
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow(/изменился|stale/i);
    expect(f.writes()).toBe(0);
  });
  it("percent, >50% and automated-bidding warnings are explicit without strategy mutation", async () => {
    const f = setup();
    for (const r of f.resources.values())
      if (r.campaign)
        object(r.campaign).biddingStrategyType = "MAXIMIZE_CLICKS";
    const p = await preview(f, [
      item("keyword_cpc", {
        mode: "percent",
        percent: "60",
        currency: "KZT",
      } as never),
    ]);
    expect(object((p.items as MockRow[])[0]!.after).cpcBidMicros).toBe(
      "240000000",
    );
    expect(JSON.stringify(p.items)).toContain("50%");
    expect(JSON.stringify(p.items)).toContain("automated");
    expect(f.writes()).toBe(0);
  });
  it("mixed unavailable row is HOLYMEDIA, valid operation only; never fakes Google error", async () => {
    const f = setup(),
      p = await preview(f, [item(), { ...item(), criterion_id: "999" }]);
    expect(p.operation_count).toBe(1);
    expect((p.items as MockRow[])[1]).toMatchObject({
      provider_operations: [],
      row_error: {
        source: "HOLYMEDIA",
        code: "google_stage2_object_unavailable",
      },
    });
    const r = await f.commit(p);
    expect(r.status).toBe("PARTIAL_FAILURE");
    expect(f.writes()).toBe(1);
  });
  it("Google operation error remains provider-coded, no retry", async () => {
    const f = setup(),
      p = await preview(f);
    f.fail(0);
    const r = await f.commit(p);
    expect(r.status).toBe("NOT_VERIFIED");
    expect(JSON.stringify(r)).toContain("RESOURCE_NOT_FOUND");
    expect(f.writes()).toBe(1);
    expect(state(f).cpcBidMicros).toBe("150000000");
  });
  it("failed Google validate_only does not persist a committable preview", async () => {
    const f = setup();
    f.validationFail();
    const p = await preview(f);
    expect(p.status).toBe("validation_failed");
    expect(f.previewsRows).toHaveLength(0);
    expect(f.writes()).toBe(0);
  });
  it("unapproved commit rejected before mutation", async () => {
    const f = setup(),
      p = await preview(f);
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
  it("stale bid rejected, rejection audit exists", async () => {
    const f = setup(),
      p = await preview(f);
    await f.approve(p);
    state(f).cpcBidMicros = "190000000";
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
    expect(
      f.events.some((e) => e.eventType === "mcp_commit_attempt_failed"),
    ).toBe(true);
  });
  it("tampering approved immutable payload rejected", async () => {
    const f = setup(),
      p = await preview(f);
    await f.approve(p);
    const stored = f.previewsRows[0]!;
    const plan = stored.requestedState as Stage2Plan;
    plan.operations[0]!.fields.cpcBidMicros = "900000000";
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
  it("expired and consumed previews cannot be committed", async () => {
    const f = setup(),
      p = await preview(f);
    await f.approve(p);
    f.previewsRows[0]!.expiresAt = new Date(0);
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
    const next = await preview(f);
    await f.commit(next);
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: next.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(1);
  });
  it("revoked principal rejects commit", async () => {
    const f = setup(),
      p = await preview(f);
    await f.approve(p);
    f.revoke();
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
  });
  it("foreign provider resource rejects WHOLE mixed batch", async () => {
    const f = setup();
    state(f).resourceName = "customers/9999999999/adGroupCriteria/10~101";
    await expect(
      preview(f, [{ ...item(), criterion_id: "102" }, item()]),
    ).rejects.toThrow(/принадлежит/);
    expect(f.requests.filter((r) => r.url.endsWith(":mutate"))).toHaveLength(0);
  });
  it("non-allowlisted account rejected before any provider call", async () => {
    const f = setup();
    await expect(
      f.mcp.call(principal, "google_ads_bid_budget_preview", {
        provider: "GOOGLE_ADS",
        account_id: "9999999999",
        items: [item()],
      }),
    ).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
  });
  it("roll back ONLY server-recorded successful rows, stale post-state rejected", async () => {
    const f = setup(),
      r = await f.commit(await preview(f));
    state(f).cpcBidMicros = "210000000";
    await expect(
      f.mcp.call(principal, "preview_rollback_commit", {
        commit_id: r.commit_id,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(1);
  });
  it("no-op and all invalid rows fail without validation or writes", async () => {
    const f = setup();
    await expect(
      preview(f, [
        item("keyword_cpc", absolute("150")),
        { ...item(), criterion_id: "999" },
      ]),
    ).rejects.toThrow();
    expect(f.requests.filter((r) => r.url.endsWith(":mutate"))).toHaveLength(0);
  });
  it("same shared budget through different campaign aliases rejects duplicate effective resource", async () => {
    const f = setup();
    object(
      f.resources.get(`${prefix}/campaignBudgets/20`)?.campaignBudget,
    ).explicitlyShared = true;
    f.resources.set(`${prefix}/campaigns/2`, {
      campaign: {
        ...object(f.resources.get(`${prefix}/campaigns/1`)?.campaign),
        id: "2",
        resourceName: `${prefix}/campaigns/2`,
      },
    });
    await expect(
      preview(f, [
        item("campaign_daily_budget", absolute("250")),
        { ...item("campaign_daily_budget", absolute("260")), campaign_id: "2" },
      ]),
    ).rejects.toThrow(/одно и то же/);
    expect(f.requests.filter((r) => r.url.endsWith(":mutate"))).toHaveLength(0);
  });
  it("provider outage after mutation stays uncertain, no duplicate mutation", async () => {
    const f = setup(),
      p = await preview(f);
    f.outage();
    const r = await f.commit(p);
    expect(r.status).toBe("NOT_VERIFIED");
    expect(f.writes()).toBe(1);
  });
  it("tool schema is closed, provider explicit, public exposure unchanged", () => {
    const schema = stage2ToolSchema("google_ads_bid_budget_preview")!;
    expect(schema.additionalProperties).toBe(false);
    expect(
      publicTools(setup().mcp.tools(), true).map((x) => x.name),
    ).not.toContain("google_ads_bid_budget_preview");
    expect(() =>
      stage2ToolIntent("google_ads_bid_budget_preview", {
        provider: "GOOGLE_ADS",
        account_id: customer,
        items: [item()],
        payload: { status: "ENABLED" },
      }),
    ).toThrow();
  });
});

describe("money/parser guards (pure, zero external requests)", () => {
  it.each([
    ["150000000", "10", "165000000"],
    ["150000000", "-50", "75000000"],
    ["1", "50", "2"],
    ["999", "0.0001", "999"],
  ])("percent %s / %s -> %s", (current, percent, result) =>
    expect(
      changedMicros(
        current,
        { mode: "percent", percent, currency: "KZT" },
        "KZT",
      ),
    ).toBe(result),
  );
  it("absolute micros retains 6 decimals without floating point", () =>
    expect(
      changedMicros(
        "1",
        { mode: "absolute", amount: "0.123456", currency: "USD" },
        "USD",
      ),
    ).toBe("123456"));
  it.each(["-100", "-101", "1001"])("rejects unsafe percent %s", (percent) =>
    expect(() =>
      changedMicros(
        "100",
        { mode: "percent", percent, currency: "USD" },
        "USD",
      ),
    ).toThrow(),
  );
  it("rejects inherited percent and FX mismatch", () => {
    expect(() =>
      changedMicros(
        "0",
        { mode: "percent", percent: "10", currency: "USD" },
        "USD",
      ),
    ).toThrow();
    expect(() =>
      changedMicros(
        "1",
        { mode: "absolute", amount: "1", currency: "USD" },
        "KZT",
      ),
    ).toThrow();
  });
  it("rejects >500, duplicate identity, arbitrary provider objects", () => {
    const parse = (items: unknown[]) =>
      parseStage2Intent({ action: "bid_budget_update", items });
    expect(() => parse([item(), item()])).toThrow();
    expect(() =>
      parse(
        Array.from({ length: 501 }, (_, i) => ({
          ...item(),
          criterion_id: String(i + 1),
        })),
      ),
    ).toThrow();
    expect(() => parse([{ ...item(), resourceName: "foreign" }])).toThrow();
  });
  it("commit plan forbids status changes even if plan hash were recomputed elsewhere", async () => {
    const f = setup();
    await preview(f);
    const plan = f.previewsRows[0]!.requestedState as Stage2Plan;
    plan.operations[0]!.fields.status = "PAUSED";
    expect(() => assertStage2Plan(plan, customer)).toThrow();
  });
});

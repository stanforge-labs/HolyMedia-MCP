import { describe, expect, it } from "vitest";
import {
  assertStage2Plan,
  buildStage2Plan,
  parseStage2Intent,
  rereadStage2Checks,
  stage2CpcVerificationEntity,
  stage2RollbackIntent,
  verifyStage2Mutation,
  type Stage2Intent,
  type Stage2Plan,
} from "./google-ads-stage2.js";
import { buildStage2AdvancedPlan } from "./google-ads-stage2-advanced.js";
import { canonical, type Stage1Reader } from "./google-ads-stage1.js";
import {
  stage2ToolIntent,
  stage2ToolSchema,
} from "../mcp/mcp-google-stage2-schema.js";
import { stage2AdvancedToolIntent } from "../mcp/mcp-google-stage2-advanced-schema.js";
import {
  fixture as stockFixture,
  object,
  principal,
  customer as stockCustomer,
  prefix as stockPrefix,
} from "../mcp/google-write-test.fixture.js";

type Row = Record<string, unknown>;
const account = "8590146099",
  prefix = `customers/${account}`;
function fixture(absent = false) {
  const campaign: Row = {
    id: "1",
    resourceName: `${prefix}/campaigns/1`,
    name: "TEST Search",
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    biddingStrategyType: "MANUAL_CPC",
  };
  const parent: Row = {
    id: "2",
    resourceName: `${prefix}/adGroups/2`,
    name: "TEST Group",
    status: "PAUSED",
    cpcBidMicros: "100000",
    targetCpaMicros: "0",
  };
  const keyword: Row = {
    resourceName: `${prefix}/adGroupCriteria/2~3`,
    status: "ENABLED",
    negative: false,
    type: "KEYWORD",
    keyword: { text: "test marketing", matchType: "EXACT" },
    effectiveCpcBidSource: "AD_GROUP",
    effectiveCpcBidMicros: "100000",
    ...(absent ? {} : { cpcBidMicros: "0" }),
  };
  const neighbor: Row = {
    ...structuredClone(keyword),
    resourceName: `${prefix}/adGroupCriteria/2~4`,
    cpcBidMicros: "200000",
    effectiveCpcBidSource: "AD_GROUP_CRITERION",
    effectiveCpcBidMicros: "200000",
    keyword: { text: "neighbor test", matchType: "PHRASE" },
  };
  const state = {
    campaign,
    parent,
    keyword,
    neighbor,
    currency: "USD",
    unit: {
      resourceName: "currencyConstants/USD",
      code: "USD",
      billableUnitMicros: "10000",
    },
    queries: [] as string[],
  };
  const read: Stage1Reader = async (q) => {
    state.queries.push(q);
    const rows: Row[] = q.includes(" FROM currency_constant")
      ? [{ currencyConstant: state.unit }]
      : q.includes(" FROM customer")
        ? [
            {
              customer: {
                id: account,
                resourceName: prefix,
                currencyCode: state.currency,
                timeZone: "Asia/Almaty",
              },
            },
          ]
        : q.includes(" FROM keyword_view")
          ? [keyword, neighbor].map((k, i) => ({
              campaign: { id: "1" },
              adGroup: { id: "2" },
              adGroupCriterion: {
                resourceName: k.resourceName,
                criterionId: String(i + 3),
              },
              metrics: { clicks: "30" },
            }))
          : q.includes(" FROM ad_group_criterion")
            ? [
                {
                  campaign: { id: "1" },
                  adGroup: { id: "2" },
                  adGroupCriterion: q.includes("criterion_id = 4")
                    ? neighbor
                    : keyword,
                },
              ]
            : q.includes(" FROM ad_group")
              ? [{ campaign: { id: "1" }, adGroup: parent }]
              : q.includes(" FROM campaign")
                ? [{ campaign }]
                : [];
    return structuredClone(rows);
  };
  const apply = (plan: Stage2Plan) => {
    for (const op of plan.operations) {
      const target =
        op.resource_name === keyword.resourceName ? keyword : neighbor;
      if (op.fields.cpcBidMicros === undefined) {
        delete target.cpcBidMicros;
        target.effectiveCpcBidSource = "AD_GROUP";
        target.effectiveCpcBidMicros = parent.cpcBidMicros;
      } else {
        target.cpcBidMicros = op.fields.cpcBidMicros;
        target.effectiveCpcBidSource = "AD_GROUP_CRITERION";
        target.effectiveCpcBidMicros = op.fields.cpcBidMicros;
      }
    }
  };
  return { state, read, apply };
}
const item = (criterion_id = "3") => ({
  field: "keyword_cpc" as const,
  campaign_id: "1",
  ad_group_id: "2",
  criterion_id,
  change: { mode: "absolute" as const, amount: "0.11", currency: "USD" },
});
const intent = (...items: Stage2Intent["items"]) => ({
  action: "bid_budget_update",
  items,
});
const successes = (p: Stage2Plan) =>
  p.operations.map((o) => ({
    success: true,
    resource_name: o.resource_name,
    error: null,
  }));
const bulk = {
  action: "stage2_bulk",
  field: "keyword_cpc",
  campaign_ids: ["1"],
  date_range: { start: "2026-09-01", end: "2026-09-30" },
  filters: [{ metric: "clicks", operator: "GTE", value: "20" }],
  change: { mode: "absolute", amount: "0.11", currency: "USD" },
  max_items: 10,
};

describe("Bounded server-recorded inherited CPC rollback, no external calls", () => {
  it.each([false, true])(
    "inherited %s -> explicit -> unset inverse -> explicit inverse retains exact source and neighbors",
    async (absent) => {
      const f = fixture(absent),
        neighbors = structuredClone(f.state.neighbor);
      const p = await buildStage2Plan(account, intent(item()), f.read);
      expect(p.operations[0]!.before.cpcBidMicros).toBe("0");
      expect(p.operations[0]!.inherited_before).toMatchObject({
        source: "AD_GROUP",
        effective_cpc_bid_micros: "100000",
        parent_cpc_bid_micros: "100000",
      });
      expect(p.operations[0]!.fields).toEqual({
        resourceName: f.state.keyword.resourceName,
        cpcBidMicros: "110000",
      });
      expect(p.operations[0]!.expected).toMatchObject({
        effectiveCpcBidSource: "AD_GROUP_CRITERION",
        effectiveCpcBidMicros: "110000",
        status: "ENABLED",
      });
      expect(() => assertStage2Plan(p, account)).not.toThrow();
      f.apply(p);
      expect((await verifyStage2Mutation(p, successes(p), f.read)).status).toBe(
        "VERIFIED",
      );
      const inverse = stage2RollbackIntent(p, [0], "USD");
      expect(inverse.action).toBe("bid_budget_inherited_rollback");
      expect(inverse.items[0]!.change.mode).toBe("inherit");
      const clear = await buildStage2Plan(account, inverse, f.read);
      expect(clear.operations[0]!.fields).toEqual({
        resourceName: f.state.keyword.resourceName,
      });
      expect(clear.operations[0]!.update_mask).toBe("cpc_bid_micros");
      expect(() => assertStage2Plan(clear, account)).not.toThrow();
      f.apply(clear);
      const verification = await verifyStage2Mutation(
        clear,
        successes(clear),
        f.read,
      );
      expect(verification.status).toBe("VERIFIED");
      expect(verification.actual[0]).toMatchObject({
        cpcBidMicros: "0",
        effectiveCpcBidSource: "AD_GROUP",
        effectiveCpcBidMicros: "100000",
      });
      const restore = stage2RollbackIntent(clear, [0], "USD");
      expect(restore).toMatchObject({
        action: "bid_budget_update",
        items: [{ change: { mode: "absolute", amount: "0.110000" } }],
      });
      const explicitAgain = await buildStage2Plan(account, restore, f.read);
      expect(explicitAgain.operations[0]!.before).toEqual(
        verification.actual[0],
      );
      f.apply(explicitAgain);
      expect(
        (
          await verifyStage2Mutation(
            explicitAgain,
            successes(explicitAgain),
            f.read,
          )
        ).status,
      ).toBe("VERIFIED");
      expect(f.state.neighbor).toEqual(neighbors);
      expect(f.state.parent.cpcBidMicros).toBe("100000");
      expect(f.state.campaign.status).toBe("PAUSED");
    },
  );
  it("public schema and tool cannot request inherited/raw clear or server proof", async () => {
    const f = fixture(),
      p = await buildStage2Plan(account, intent(item()), f.read),
      inverse = stage2RollbackIntent(p, [0], "USD");
    expect(
      JSON.stringify(stage2ToolSchema("google_ads_bid_budget_preview")),
    ).not.toContain("inherit");
    expect(() =>
      parseStage2Intent({ ...inverse, action: "bid_budget_update" }),
    ).toThrow();
    expect(() =>
      stage2ToolIntent("google_ads_bid_budget_preview", {
        provider: "GOOGLE_ADS",
        account_id: account,
        items: inverse.items,
      }),
    ).toThrow();
    expect(() =>
      stage2ToolIntent("google_ads_bid_budget_preview", {
        provider: "GOOGLE_ADS",
        account_id: account,
        items: inverse.items,
        action: inverse.action,
      }),
    ).toThrow();
    expect(() =>
      stage2AdvancedToolIntent("google_ads_bulk_bid_budget_preview", {
        provider: "GOOGLE_ADS",
        account_id: account,
        ...bulk,
        change: inverse.items[0]!.change,
      }),
    ).toThrow();
  });
  it.each([
    "UNKNOWN",
    "UNSPECIFIED",
    "AD_GROUP_CRITERION",
    "CAMPAIGN_BIDDING_STRATEGY",
  ])("source %s never mints inherited inverse", async (source) => {
    const f = fixture();
    f.state.keyword.effectiveCpcBidSource = source;
    const p = await buildStage2Plan(account, intent(item()), f.read);
    expect(p.operations[0]!.inherited_before).toBeUndefined();
    expect(() => stage2RollbackIntent(p, [0], "USD")).toThrow(/Inherited/);
  });
  it("absent raw override without actual source proof is not normalized to zero", async () => {
    const f = fixture(true);
    delete f.state.keyword.effectiveCpcBidSource;
    await expect(
      buildStage2Plan(account, intent(item()), f.read),
    ).rejects.toThrow(/Все строки/);
  });
  it("mismatched inherited effective and parent CPC cannot be guessed", async () => {
    const f = fixture();
    f.state.keyword.effectiveCpcBidMicros = "90000";
    const p = await buildStage2Plan(account, intent(item()), f.read);
    expect(() => stage2RollbackIntent(p, [0], "USD")).toThrow(/Inherited/);
  });
  it("percent inherited base is still rejected; absolute does not reuse effective bid as base", async () => {
    const f = fixture();
    await expect(
      buildStage2Plan(
        account,
        intent({
          ...item(),
          change: { mode: "percent", percent: "10", currency: "USD" },
        }),
        f.read,
      ),
    ).rejects.toThrow(/Все строки/);
    const p = await buildStage2Plan(account, intent(item()), f.read);
    expect(p.operations[0]!.fields.cpcBidMicros).toBe("110000");
  });
  it.each(["parent", "strategy", "portfolio", "currency"])(
    "changed %s rejects reusing recorded inherited inverse proof",
    async (field) => {
      const f = fixture(),
        p = await buildStage2Plan(account, intent(item()), f.read);
      f.apply(p);
      const inverse = stage2RollbackIntent(p, [0], "USD");
      if (field === "parent") f.state.parent.cpcBidMicros = "120000";
      if (field === "strategy")
        f.state.campaign.biddingStrategyType = "MAXIMIZE_CLICKS";
      if (field === "portfolio")
        f.state.campaign.biddingStrategy = `${prefix}/biddingStrategies/8`;
      if (field === "currency") f.state.currency = "KZT";
      await expect(buildStage2Plan(account, inverse, f.read)).rejects.toThrow();
    },
  );
  it("parent/source/currency constant participate in unchanged stale checks", async () => {
    const f = fixture(),
      p = await buildStage2Plan(account, intent(item()), f.read);
    expect(await rereadStage2Checks(p, f.read)).toEqual(p.checks);
    f.state.parent.cpcBidMicros = "120000";
    expect(canonical(await rereadStage2Checks(p, f.read))).not.toBe(
      canonical(p.checks),
    );
    f.state.parent.cpcBidMicros = "100000";
    f.state.keyword.effectiveCpcBidSource = "UNKNOWN";
    expect(canonical(await rereadStage2Checks(p, f.read))).not.toBe(
      canonical(p.checks),
    );
    f.state.keyword.effectiveCpcBidSource = "AD_GROUP";
    f.state.unit.billableUnitMicros = "100000";
    expect(canonical(await rereadStage2Checks(p, f.read))).not.toBe(
      canonical(p.checks),
    );
  });
  it("foreign parent is fatal for whole mixed batch, not ignored as an excluded row", async () => {
    const f = fixture();
    f.state.parent.resourceName = "customers/9999999999/adGroups/2";
    await expect(
      buildStage2Plan(account, intent(item("4"), item()), f.read),
    ).rejects.toMatchObject({ writeCode: "google_stage2_ownership_invalid" });
  });
  it.each(["fields", "proof", "neighbor", "mask"])(
    "immutable clear %s tampering rejected",
    async (field) => {
      const f = fixture(),
        p = await buildStage2Plan(account, intent(item()), f.read);
      f.apply(p);
      const clear = await buildStage2Plan(
          account,
          stage2RollbackIntent(p, [0], "USD"),
          f.read,
        ),
        op = clear.operations[0]!;
      if (field === "fields") op.fields.status = "PAUSED";
      if (field === "proof")
        op.inherited_after!.effective_cpc_bid_micros = "120000";
      if (field === "neighbor") op.expected.status = "PAUSED";
      if (field === "mask") op.update_mask = "cpc_bid_micros,status";
      expect(() => assertStage2Plan(clear, account)).toThrow();
    },
  );
  it.each(["source", "effective", "raw", "null", "status", "text", "parent"])(
    "wrong clear reread %s is NOT_VERIFIED",
    async (field) => {
      const f = fixture(),
        p = await buildStage2Plan(account, intent(item()), f.read);
      f.apply(p);
      const clear = await buildStage2Plan(
        account,
        stage2RollbackIntent(p, [0], "USD"),
        f.read,
      );
      f.apply(clear);
      if (field === "source") f.state.keyword.effectiveCpcBidSource = "UNKNOWN";
      if (field === "effective")
        f.state.keyword.effectiveCpcBidMicros = "120000";
      if (field === "raw") f.state.keyword.cpcBidMicros = "110000";
      if (field === "null") f.state.keyword.cpcBidMicros = null;
      if (field === "status") f.state.keyword.status = "PAUSED";
      if (field === "text")
        f.state.keyword.keyword = { text: "changed", matchType: "EXACT" };
      if (field === "parent") f.state.parent.cpcBidMicros = "120000";
      expect(
        (await verifyStage2Mutation(clear, successes(clear), f.read)).status,
      ).toBe("NOT_VERIFIED");
    },
  );
  it("narrow comparison accepts numeric zero only with source proof and never treats null/absent expected as inherited", () => {
    const expected = {
      cpcBidMicros: "0",
      effectiveCpcBidSource: "AD_GROUP",
      effectiveCpcBidMicros: "100000",
    };
    expect(
      stage2CpcVerificationEntity(
        { ...expected, cpcBidMicros: 0, effectiveCpcBidMicros: 100000 },
        expected,
      ),
    ).toEqual(expected);
    expect(
      stage2CpcVerificationEntity(
        { ...expected, cpcBidMicros: null },
        expected,
      ),
    ).toBeNull();
    expect(
      stage2CpcVerificationEntity(
        { effectiveCpcBidSource: "UNKNOWN", effectiveCpcBidMicros: "100000" },
        expected,
      ),
    ).toBeNull();
  });
  it("auto bidding keeps G warning and excludes dynamic effective outputs from expectations and proof", async () => {
    const f = fixture();
    f.state.keyword.cpcBidMicros = "100000";
    f.state.keyword.effectiveCpcBidSource = "CAMPAIGN_BIDDING_STRATEGY";
    f.state.campaign.biddingStrategyType = "MAXIMIZE_CLICKS";
    const p = await buildStage2Plan(
      account,
      intent({
        ...item(),
        change: { mode: "percent", percent: "10", currency: "USD" },
      }),
      f.read,
    );
    expect(p.items[0]!.warnings.join(" ")).toContain("automated/portfolio");
    expect(p.operations[0]!.read_query).not.toContain("effective_cpc_bid");
    expect(p.operations[0]!.expected.effectiveCpcBidSource).toBeUndefined();
    f.apply(p);
    f.state.keyword.effectiveCpcBidSource = "CAMPAIGN_BIDDING_STRATEGY";
    f.state.keyword.effectiveCpcBidMicros = "900000";
    expect((await verifyStage2Mutation(p, successes(p), f.read)).status).toBe(
      "VERIFIED",
    );
  });
  it("N group 0.10 ->0.11 unchanged: exact positive CPC leaf, no keyword source selectors", async () => {
    const f = fixture(),
      p = await buildStage2Plan(
        account,
        intent({
          field: "ad_group_cpc",
          campaign_id: "1",
          ad_group_id: "2",
          change: { mode: "absolute", amount: "0.11", currency: "USD" },
        }),
        f.read,
      );
    expect(p.operations[0]!.fields).toEqual({
      resourceName: f.state.parent.resourceName,
      cpcBidMicros: "110000",
    });
    expect(p.operations[0]!.update_mask).toBe("cpc_bid_micros");
    expect(f.state.queries.every((q) => !q.includes("effective_cpc_bid"))).toBe(
      true,
    );
  });
  it("authoritative unit rounds positive write, rejects zero, and exact old inverse never silently rounds", async () => {
    const f = fixture();
    const p = await buildStage2Plan(
      account,
      intent({
        ...item(),
        change: { mode: "absolute", amount: "0.115", currency: "USD" },
      }),
      f.read,
    );
    expect(p.operations[0]!.fields.cpcBidMicros).toBe("120000");
    expect(p.items[0]!.warnings.join(" ")).toContain("billable");
    await expect(
      buildStage2Plan(
        account,
        intent({
          ...item(),
          change: { mode: "absolute", amount: "0.001", currency: "USD" },
        }),
        f.read,
      ),
    ).rejects.toThrow();
    f.state.keyword.cpcBidMicros = "115000";
    f.state.keyword.effectiveCpcBidSource = "AD_GROUP_CRITERION";
    f.state.keyword.effectiveCpcBidMicros = "115000";
    const unaligned = await buildStage2Plan(account, intent(item()), f.read);
    expect(() => stage2RollbackIntent(unaligned, [0], "USD")).toThrow(
      /выровнена/,
    );
  });
  it("mixed bulk inverse preserves inherited proof + explicit amount, returns inverse-of-clear restore", async () => {
    const f = fixture(),
      p = await buildStage2AdvancedPlan(account, bulk, f.read);
    expect(p.inverse_intent).toMatchObject({
      action: "stage2_bulk_inverse",
      items: [
        {
          criterion_id: "3",
          change: { mode: "inherit", proof: { source: "AD_GROUP" } },
        },
        { criterion_id: "4", change: { mode: "absolute", amount: "0.200000" } },
      ],
    });
    for (const op of p.operations) {
      const target =
        op.resource_name === f.state.keyword.resourceName
          ? f.state.keyword
          : f.state.neighbor;
      target.cpcBidMicros = op.fields.cpcBidMicros;
      target.effectiveCpcBidSource = "AD_GROUP_CRITERION";
      target.effectiveCpcBidMicros = op.fields.cpcBidMicros;
    }
    const inverse = await buildStage2AdvancedPlan(
      account,
      p.inverse_intent,
      f.read,
    );
    expect(inverse.operations[0]!.fields).toEqual({
      resourceName: f.state.keyword.resourceName,
    });
    expect(inverse.operations[1]!.fields.cpcBidMicros).toBe("200000");
    expect(inverse.inverse_intent).toMatchObject({
      action: "stage2_bulk_inverse",
      items: [
        { change: { mode: "absolute", amount: "0.110000" } },
        { change: { mode: "absolute", amount: "0.110000" } },
      ],
    });
  });
});

function controlledFixture() {
  const f = stockFixture(false, { stage2: true });
  const target = object(
    f.resources.get(`${stockPrefix}/adGroupCriteria/10~101`)!.adGroupCriterion,
  );
  const group = object(f.resources.get(`${stockPrefix}/adGroups/10`)!.adGroup);
  for (const row of f.resources.values())
    if (row.campaign)
      Object.assign(object(row.campaign), {
        advertisingChannelType: "SEARCH",
        biddingStrategyType: "MANUAL_CPC",
      });
  group.cpcBidMicros = "100000000";
  Object.assign(target, {
    cpcBidMicros: "0",
    effectiveCpcBidSource: "AD_GROUP",
    effectiveCpcBidMicros: "100000000",
  });
  // Extend this test's mocked provider semantics, never call an external endpoint.
  const mockFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await mockFetch(...args);
    const body = JSON.parse(String(args[1]?.body)) as Row;
    if (
      String(args[0]).endsWith("adGroupCriteria:mutate") &&
      body.validateOnly === false
    ) {
      for (const raw of body.operations as Row[]) {
        const update = object(raw.update);
        if (update.resourceName === target.resourceName) {
          if (update.cpcBidMicros === undefined) {
            delete target.cpcBidMicros;
            target.effectiveCpcBidSource = "AD_GROUP";
            target.effectiveCpcBidMicros = group.cpcBidMicros;
          } else {
            target.effectiveCpcBidSource = "AD_GROUP_CRITERION";
            target.effectiveCpcBidMicros = update.cpcBidMicros;
          }
        }
      }
    }
    return response;
  };
  const preview = () =>
    f.call("google_ads_bid_budget_preview", {
      items: [
        {
          field: "keyword_cpc",
          campaign_id: "1",
          ad_group_id: "10",
          criterion_id: "101",
          change: { mode: "absolute", amount: "110", currency: "KZT" },
        },
      ],
    });
  return { f, target, group, preview };
}
describe("Inherited inverse uses stock approval + immutable commit + audit, mocked HTTP only", () => {
  it("N inherited forward and rollback require separate approvals, two VERIFIED journal entries, no status change", async () => {
    const { f, target, preview } = controlledFixture(),
      neighbor = structuredClone(
        f.resources.get(`${stockPrefix}/adGroupCriteria/10~102`),
      );
    const p = await preview();
    expect(p.provider_validation).toBe("passed");
    expect(f.writes()).toBe(0);
    const forward = await f.commit(p);
    expect(forward.status).toBe("VERIFIED");
    expect(target.effectiveCpcBidSource).toBe("AD_GROUP_CRITERION");
    const inverse = (await f.mcp.call(principal, "preview_rollback_commit", {
      commit_id: forward.commit_id,
    })) as Row;
    expect(inverse.rollback_of).toBe(forward.commit_id);
    expect(inverse.provider_validation).toBe("passed");
    expect(f.writes()).toBe(1);
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: inverse.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(1);
    const result = await f.commit(inverse);
    expect(result.status).toBe("VERIFIED");
    expect(target.cpcBidMicros).toBeUndefined();
    expect(target.effectiveCpcBidSource).toBe("AD_GROUP");
    expect(target.effectiveCpcBidMicros).toBe("100000000");
    expect(target.status).toBe("ENABLED");
    expect(f.resources.get(`${stockPrefix}/adGroupCriteria/10~102`)).toEqual(
      neighbor,
    );
    expect((await f.call("list_change_journal", {})).items).toHaveLength(2);
    expect(f.writes()).toBe(2);
    const mutations = f.requests.filter((r) => r.url.endsWith(":mutate"));
    expect(mutations.filter((r) => r.body.validateOnly === true)).toHaveLength(
      2,
    );
    expect(mutations.every((r) => r.body.partialFailure === true)).toBe(true);
    expect((mutations.at(-1)!.body.operations as Row[])[0]).toEqual({
      update: { resourceName: target.resourceName },
      updateMask: "cpc_bid_micros",
    });
  });
  it("approved inverse with changed parent rejects stale before mutation, and clear field tamper rejects", async () => {
    const { f, group, preview } = controlledFixture(),
      forward = await f.commit(await preview());
    const inverse = (await f.mcp.call(principal, "preview_rollback_commit", {
      commit_id: forward.commit_id,
    })) as Row;
    await f.approve(inverse);
    group.cpcBidMicros = "120000000";
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: inverse.preview_token,
      }),
    ).rejects.toThrow();
    expect(f.writes()).toBe(1);
    expect(
      f.events.some((e) => e.eventType === "mcp_commit_attempt_failed"),
    ).toBe(true);
    group.cpcBidMicros = "100000000";
    const plan = f.previewsRows.at(-1)!.requestedState as Stage2Plan;
    plan.operations[0]!.fields.cpcBidMicros = "0";
    expect(() => assertStage2Plan(plan, stockCustomer)).toThrow();
  });
});

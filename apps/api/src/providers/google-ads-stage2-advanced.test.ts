import { describe, expect, it } from "vitest";
import {
  buildStage2AdvancedPlan,
  parseStage2AdvancedIntent,
} from "./google-ads-stage2-advanced.js";
import { canonical, type Stage1Reader } from "./google-ads-stage1.js";
import {
  extRow,
  extendedProviderOperation,
  rereadExtendedChecks,
  verifyExtendedMutation,
} from "./google-ads-extended-plan.js";
import {
  stage2AdvancedToolIntent,
  stage2AdvancedToolSchema,
} from "../mcp/mcp-google-stage2-advanced-schema.js";

const account = "8590146099",
  prefix = `customers/${account}`;
const money = (amount = "1") => ({ amount, currency: "USD" });
function fixture() {
  const c: Record<string, unknown> = {
    id: "1",
    resourceName: `${prefix}/campaigns/1`,
    name: "TEST Search",
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    campaignBudget: `${prefix}/campaignBudgets/8`,
    biddingStrategyType: "MANUAL_CPC",
    manualCpc: { enhancedCpcEnabled: false },
  };
  const b: Record<string, unknown> = {
    id: "3",
    resourceName: `${prefix}/biddingStrategies/3`,
    name: "TEST Portfolio",
    status: "ENABLED",
    type: "TARGET_CPA",
    effectiveCurrencyCode: "USD",
    alignedCampaignBudgetId: "0",
    targetCpa: { targetCpaMicros: "1000000" },
  };
  const criterion: Record<string, unknown> = {
    resourceName: `${prefix}/campaignCriteria/1~11`,
    criterionId: "11",
    campaign: c.resourceName,
    type: "DEVICE",
    status: "ENABLED",
    negative: false,
    bidModifier: 1,
    device: { type: "MOBILE" },
  };
  const audience: Record<string, unknown> = {
    resourceName: `${prefix}/adGroupCriteria/2~12`,
    adGroup: `${prefix}/adGroups/2`,
    type: "USER_LIST",
    status: "ENABLED",
    negative: false,
    bidModifier: 1,
    userList: { userList: `${prefix}/userLists/4` },
  };
  const keyword: Record<string, unknown> = {
    resourceName: `${prefix}/adGroupCriteria/2~13`,
    criterionId: "13",
    type: "KEYWORD",
    status: "ENABLED",
    negative: false,
    keyword: { text: "test marketing", matchType: "EXACT" },
    cpcBidMicros: "1000000",
  };
  const budget = {
    resourceName: `${prefix}/campaignBudgets/8`,
    name: "TEST Search",
    amountMicros: "2000000",
    explicitlyShared: false,
    deliveryMethod: "STANDARD",
    period: "DAILY",
  };
  const state = {
    c,
    b,
    criterion,
    audience,
    keyword,
    budget,
    goal: true,
    consumers: [
      {
        campaign: {
          ...c,
          id: "9",
          resourceName: `${prefix}/campaigns/9`,
          biddingStrategy: b.resourceName,
        },
      },
    ],
    bulkRows: [] as Record<string, unknown>[],
    moneyUnit: {
      resourceName: "currencyConstants/USD",
      code: "USD",
      billableUnitMicros: "10000",
    } as Record<string, unknown>,
    calls: [] as string[],
  };
  state.bulkRows = [
    {
      campaign: { id: "1" },
      adGroup: { id: "2" },
      adGroupCriterion: {
        resourceName: keyword.resourceName,
        criterionId: "13",
      },
      metrics: {
        clicks: "30",
        impressions: "100",
        conversions: 0,
        costMicros: "1000000",
      },
    },
  ];
  const read: Stage1Reader = async (q) => {
    state.calls.push(q);
    if (q.includes(" FROM currency_constant"))
      return [{ currencyConstant: structuredClone(state.moneyUnit) }];
    if (q.includes(" FROM customer"))
      return [
        {
          customer: {
            id: account,
            resourceName: prefix,
            currencyCode: "USD",
            timeZone: "Asia/Almaty",
          },
        },
      ];
    if (q.includes(" FROM campaign_conversion_goal"))
      return state.goal
        ? [
            {
              campaignConversionGoal: {
                campaign:
                  q.match(
                    /campaign_conversion_goal\.campaign = '([^']+)'/,
                  )?.[1] ?? c.resourceName,
                category: "LEAD",
                origin: "WEBSITE",
                biddable: true,
              },
            },
          ]
        : [];
    if (q.includes(" FROM bidding_strategy"))
      return q.includes(".name = ")
        ? []
        : q.includes("id = 3")
          ? [{ biddingStrategy: b }]
          : [];
    if (q.includes(" FROM campaign_criterion"))
      return q.includes("criterion_id = 11")
        ? [{ campaign: { id: "1" }, campaignCriterion: criterion }]
        : [];
    if (q.includes(" FROM keyword_view") || q.includes("metrics.clicks"))
      return state.bulkRows;
    if (q.includes(" FROM ad_group_criterion"))
      return q.includes("criterion_id = 12")
        ? [
            {
              campaign: { id: "1" },
              adGroup: { id: "2" },
              adGroupCriterion: audience,
            },
          ]
        : q.includes("criterion_id = 13")
          ? [
              {
                campaign: { id: "1" },
                adGroup: { id: "2" },
                adGroupCriterion: keyword,
              },
            ]
          : [];
    if (q.includes(" FROM campaign_budget"))
      return [{ campaignBudget: state.budget }];
    if (q.includes(" FROM ad_group"))
      return [
        {
          campaign: { id: "1" },
          adGroup: {
            id: "2",
            resourceName: `${prefix}/adGroups/2`,
            name: "TEST Group",
            status: "PAUSED",
            cpcBidMicros: "1000000",
            targetCpaMicros: "1000000",
          },
        },
      ];
    if (q.includes(" FROM campaign")) {
      if (q.includes("campaign.bidding_strategy =")) return state.consumers;
      return q.includes("campaign.id = 999") ? [] : [{ campaign: c }];
    }
    throw new Error("Unexpected mock GAQL: " + q);
  };
  return { state, read };
}
const advanced = (...items: Record<string, unknown>[]) => ({
  action: "stage2_advanced",
  items,
});
const campaignStrategy = (
  strategy: Record<string, unknown>,
  campaign_id = "1",
) => ({ operation: "campaign_strategy", campaign_id, strategy });
const bulk = (extra: Record<string, unknown> = {}) => ({
  action: "stage2_bulk",
  field: "keyword_cpc",
  campaign_ids: ["1"],
  date_range: { start: "2026-09-01", end: "2026-09-30" },
  filters: [{ metric: "clicks", operator: "GTE", value: "20" }],
  change: { mode: "percent", percent: "10", currency: "USD" },
  max_items: 100,
  ...extra,
});
describe("Stage 2 advanced authoritative billable-unit rounding", () => {
  it("strategy target CPA rounds half-up with frozen provider unit and visible warning", async () => {
    const f = fixture(),
      plan = await buildStage2AdvancedPlan(
        account,
        advanced(
          campaignStrategy({ type: "TARGET_CPA", target_cpa: money("1.005") }),
        ),
        f.read,
      );
    expect(extRow(plan.operations[0]?.fields.targetCpa).targetCpaMicros).toBe(
      "1010000",
    );
    expect(plan.items[0]?.warnings.join(" ")).toContain(
      "requested micros=1005000 → 1010000",
    );
    expect(
      plan.checks.some((c) =>
        c.query.includes("currency_constant.billable_unit_micros"),
      ),
    ).toBe(true);
    f.state.moneyUnit.billableUnitMicros = "100000";
    expect(canonical(await rereadExtendedChecks(plan, f.read))).not.toBe(
      canonical(plan.checks),
    );
  });
  it("portfolio floor/ceiling also quantized, but explicit clear zero remains zero", async () => {
    const f = fixture();
    const plan = await buildStage2AdvancedPlan(
      account,
      advanced({
        operation: "portfolio_update",
        strategy_id: "3",
        strategy: {
          type: "TARGET_CPA",
          target_cpa: money("1.005"),
          cpc_floor: money("0.005"),
          cpc_ceiling: money("0.015"),
        },
      }),
      f.read,
    );
    expect(plan.operations[0]?.fields.targetCpa).toEqual({
      targetCpaMicros: "1010000",
      cpcBidFloorMicros: "10000",
      cpcBidCeilingMicros: "20000",
    });
    f.state.b.targetCpa = {
      targetCpaMicros: "1000000",
      cpcBidFloorMicros: "10000",
      cpcBidCeilingMicros: "20000",
    };
    const clear = await buildStage2AdvancedPlan(
      account,
      advanced({
        operation: "portfolio_update",
        strategy_id: "3",
        strategy: {
          type: "TARGET_CPA",
          target_cpa: money("1"),
          clear_fields: ["cpc_floor"],
        },
      }),
      f.read,
    );
    expect(
      extRow(clear.operations[0]?.fields.targetCpa).cpcBidFloorMicros,
    ).toBe("0");
    expect(
      extRow(clear.operations[0]?.expected.targetCpa).cpcBidCeilingMicros,
    ).toBe("20000");
    expect(clear.inverse_intent).toBeDefined();
  });
  it("nonaligned historical strategy money never gets a silently rounded inverse", async () => {
    const f = fixture();
    f.state.b.targetCpa = {
      targetCpaMicros: "1000000",
      cpcBidFloorMicros: "10001",
    };
    const plan = await buildStage2AdvancedPlan(
      account,
      advanced({
        operation: "portfolio_update",
        strategy_id: "3",
        strategy: {
          type: "TARGET_CPA",
          target_cpa: money("1.2"),
          cpc_floor: money("0.02"),
        },
      }),
      f.read,
    );
    expect(plan.inverse_intent).toBeUndefined();
  });
  it("CPA performance thresholds remain exact micro filters, not billable write values", async () => {
    const f = fixture();
    f.state.bulkRows[0]!.metrics = {
      costMicros: "1000000",
      conversions: 1000000,
      clicks: "30",
    };
    const plan = await buildStage2AdvancedPlan(
      account,
      bulk({
        filters: [
          {
            metric: "cpa",
            operator: "GTE",
            value: "0.000001",
            currency: "USD",
          },
        ],
      }),
      f.read,
    );
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]?.fields.cpcBidMicros).toBe("1100000");
    expect(plan.items[0]?.warnings.join(" ")).toContain("not rounded CPA");
  });
  it("foreign/malformed currency proof fails before strategy operations", async () => {
    const f = fixture();
    f.state.moneyUnit.code = "KZT";
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced(
          campaignStrategy({ type: "TARGET_CPA", target_cpa: money("2") }),
        ),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_currency_unit_mismatch" });
    expect(f.state.calls.some((q) => q.includes(" FROM campaign "))).toBe(
      false,
    );
  });
});
describe("Stage 2 advanced v24 plans: mocked readers only", () => {
  it.each([
    [{ type: "MANUAL_CPC" }, "manualCpc", "manual_cpc.enhanced_cpc_enabled"],
    [
      { type: "MAXIMIZE_CLICKS", cpc_ceiling: money("2") },
      "targetSpend",
      "target_spend.cpc_bid_ceiling_micros",
    ],
    [
      { type: "MAXIMIZE_CONVERSIONS" },
      "maximizeConversions",
      "maximize_conversions.target_cpa_micros",
    ],
    [
      { type: "TARGET_CPA", target_cpa: money("3") },
      "targetCpa",
      "target_cpa.target_cpa_micros",
    ],
    [
      { type: "TARGET_ROAS", target_roas: "4" },
      "targetRoas",
      "target_roas.target_roas",
    ],
    [
      {
        type: "TARGET_IMPRESSION_SHARE",
        location: "TOP_OF_PAGE",
        share_percent: "75",
        cpc_ceiling: money("5"),
      },
      "targetImpressionShare",
      "target_impression_share",
    ],
  ])(
    "builds supported standard strategy %j with exact fields, no status changes",
    async (strategy, field, mask) => {
      const f = fixture();
      f.state.c.biddingStrategyType = "TARGET_SPEND";
      f.state.c.targetSpend = { cpcBidCeilingMicros: "1000000" };
      delete f.state.c.manualCpc;
      const p = await buildStage2AdvancedPlan(
          account,
          advanced(campaignStrategy(strategy as Record<string, unknown>)),
          f.read,
        ),
        op = p.operations[0]!;
      expect(p.version).toBe(5);
      expect(p.atomic).toBe(false);
      expect(op.update_mask).toContain(mask);
      expect(op.fields[field as string]).toBeDefined();
      expect(op.fields.status).toBeUndefined();
      expect(op.expected.status).toBe("PAUSED");
      expect(p.inverse_intent).toBeDefined();
      expect(extendedProviderOperation(op)).toHaveProperty(
        "campaignOperation.update",
      );
    },
  );
  it("does not invent mutable scheme parent masks for empty MaximizeClicks", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(
      account,
      advanced(campaignStrategy({ type: "MAXIMIZE_CLICKS" })),
      f.read,
    );
    expect(p.operations[0]!.update_mask).toBe(
      "target_spend.cpc_bid_ceiling_micros",
    );
  });
  it("requires an existing biddable conversion goal without creating goals", async () => {
    const f = fixture();
    f.state.goal = false;
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced(campaignStrategy({ type: "TARGET_CPA", target_cpa: money() })),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
    expect(
      f.state.calls.some((q) => q.includes("campaign_conversion_goal")),
    ).toBe(true);
  });
  it("does not claim conversion data health from goal configuration", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(
      account,
      advanced(campaignStrategy({ type: "TARGET_ROAS", target_roas: "2.5" })),
      f.read,
    );
    expect(p.items[0]!.warnings.join(" ")).toContain("actual recent");
  });
  it("validates campaign ownership even in a mixed batch", async () => {
    const f = fixture();
    f.state.c.resourceName = "customers/1111111111/campaigns/1";
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced(campaignStrategy({ type: "MAXIMIZE_CLICKS" })),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_extended_ownership_invalid" });
  });
  it("restricts advanced profile to Search without modifying a PMax campaign", async () => {
    const f = fixture();
    f.state.c.advertisingChannelType = "PERFORMANCE_MAX";
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced(campaignStrategy({ type: "MAXIMIZE_CLICKS" })),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("mixed unavailable campaigns retain local errors and valid immutable rows", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(
      account,
      advanced(
        campaignStrategy({ type: "MAXIMIZE_CLICKS" }),
        campaignStrategy({ type: "MANUAL_CPC" }, "999"),
      ),
      f.read,
    );
    expect(p.operations).toHaveLength(1);
    expect(p.items).toHaveLength(2);
    expect(p.items[1]!.row_error).toMatchObject({
      source: "HOLYMEDIA",
      code: "google_stage2_object_unavailable",
    });
    expect(p.items[1]!.provider_operations).toEqual([]);
  });
  it("portfolio create has no campaigns attached and no fake status field", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(
      account,
      advanced({
        operation: "portfolio_create",
        name: "TEST New",
        strategy: {
          type: "TARGET_CPA",
          target_cpa: money(),
          cpc_floor: money("0.5"),
          cpc_ceiling: money("2"),
        },
      }),
      f.read,
    );
    expect(p.operations[0]!.fields).toEqual({
      name: "TEST New",
      targetCpa: {
        targetCpaMicros: "1000000",
        cpcBidFloorMicros: "500000",
        cpcBidCeilingMicros: "2000000",
      },
    });
    expect(p.operations[0]!.fields.status).toBeUndefined();
    expect(p.inverse_intent).toBeUndefined();
  });
  it("portfolio update snapshots all consumers and preserves unspecified parameters", async () => {
    const f = fixture();
    f.state.b.targetCpa = {
      targetCpaMicros: "1000000",
      cpcBidCeilingMicros: "3000000",
    };
    const p = await buildStage2AdvancedPlan(
      account,
      advanced({
        operation: "portfolio_update",
        strategy_id: "3",
        strategy: { type: "TARGET_CPA", target_cpa: money("2") },
      }),
      f.read,
    );
    expect(p.items[0]!.warnings.join(" ")).toContain("9 TEST Search");
    expect(
      extRow(p.operations[0]!.expected.targetCpa).cpcBidCeilingMicros,
    ).toBe("3000000");
    expect(p.inverse_intent).toBeDefined();
  });
  it("portfolio type changes are explicit unsupported errors", async () => {
    const f = fixture();
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "portfolio_update",
          strategy_id: "3",
          strategy: { type: "TARGET_ROAS", target_roas: "2" },
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("portfolio attach freezes shared consumers and target campaign but changes only one reference", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(
      account,
      advanced({
        operation: "portfolio_attach",
        campaign_id: "1",
        strategy_id: "3",
      }),
      f.read,
    );
    expect(p.operations[0]!.fields).toEqual({
      resourceName: f.state.c.resourceName,
      biddingStrategy: f.state.b.resourceName,
    });
    expect(p.operations[0]!.update_mask).toBe("bidding_strategy");
    expect(
      p.checks.some((x) => x.query.includes("campaign.bidding_strategy =")),
    ).toBe(true);
    expect(p.inverse_intent).toMatchObject({
      action: "stage2_advanced",
      items: [
        { operation: "campaign_strategy", strategy: { type: "MANUAL_CPC" } },
      ],
    });
  });
  it("aligned portfolio budget mismatch never silently changes budget", async () => {
    const f = fixture();
    f.state.b.alignedCampaignBudgetId = "999";
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "portfolio_attach",
          campaign_id: "1",
          strategy_id: "3",
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("portfolio consumer resource identity mismatch is fatal", async () => {
    const f = fixture();
    f.state.consumers[0]!.campaign.id = "999";
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "portfolio_attach",
          campaign_id: "1",
          strategy_id: "3",
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_extended_ownership_invalid" });
  });
  it("a portfolio already attached cannot generate an unrelated write", async () => {
    const f = fixture();
    f.state.c.biddingStrategy = f.state.b.resourceName;
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "portfolio_attach",
          campaign_id: "1",
          strategy_id: "3",
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("impression share micros are exact, unsupported precision is rejected", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(
      account,
      advanced(
        campaignStrategy({
          type: "TARGET_IMPRESSION_SHARE",
          location: "TOP_OF_PAGE",
          share_percent: "75.0001",
          cpc_ceiling: money(),
        }),
      ),
      f.read,
    );
    expect(
      extRow(p.operations[0]!.fields.targetImpressionShare)
        .locationFractionMicros,
    ).toBe("750001");
    expect(() =>
      parseStage2AdvancedIntent(
        advanced(
          campaignStrategy({
            type: "TARGET_IMPRESSION_SHARE",
            location: "TOP_OF_PAGE",
            share_percent: "75.00001",
            cpc_ceiling: money(),
          }),
        ),
      ),
    ).toThrow();
  });
  it("cross-account portfolio resources cause fatal ownership rejection", async () => {
    const f = fixture();
    f.state.b.resourceName = "customers/1111111111/biddingStrategies/3";
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "portfolio_attach",
          campaign_id: "1",
          strategy_id: "3",
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_extended_ownership_invalid" });
  });
  it("portfolio detach specifies the replacement standard scheme, not status/network changes", async () => {
    const f = fixture();
    f.state.c.biddingStrategy = f.state.b.resourceName;
    f.state.c.biddingStrategyType = "TARGET_CPA";
    const p = await buildStage2AdvancedPlan(
      account,
      advanced({
        operation: "portfolio_detach",
        campaign_id: "1",
        strategy: { type: "MANUAL_CPC" },
      }),
      f.read,
    );
    expect(p.operations[0]!.fields).toEqual({
      resourceName: f.state.c.resourceName,
      manualCpc: { enhancedCpcEnabled: false },
    });
    expect(p.inverse_intent).toMatchObject({
      items: [{ operation: "portfolio_attach", strategy_id: "3" }],
    });
  });
  it.each(["DEVICE", "LOCATION", "AD_SCHEDULE"])(
    "existing campaign %s modifier changes only bid_modifier",
    async (type) => {
      const f = fixture();
      f.state.criterion.type = type;
      const p = await buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "modifier",
          campaign_id: "1",
          criterion_id: "11",
          criterion_type: type,
          multiplier: "1.2",
        }),
        f.read,
      );
      expect(p.operations[0]!.fields).toEqual({
        resourceName: f.state.criterion.resourceName,
        bidModifier: 1.2,
      });
      expect(p.operations[0]!.update_mask).toBe("bid_modifier");
      expect(p.operations[0]!.expected.device).toEqual(
        f.state.criterion.device,
      );
      expect(p.inverse_intent).toMatchObject({ items: [{ multiplier: "1" }] });
      if (type === "AD_SCHEDULE")
        expect(p.items[0]!.warnings.join(" ")).toContain("Asia/Almaty");
    },
  );
  it.each(["USER_LIST", "USER_INTEREST"])(
    "existing ad group %s audience modifier is supported under ManualCpc",
    async (type) => {
      const f = fixture();
      f.state.audience.type = type;
      const p = await buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "modifier",
          campaign_id: "1",
          ad_group_id: "2",
          criterion_id: "12",
          criterion_type: type,
          multiplier: "0.7",
        }),
        f.read,
      );
      expect(p.operations[0]!.kind).toBe("adGroupCriteria");
      expect(p.operations[0]!.fields.bidModifier).toBe(0.7);
      expect(p.operations[0]!.expected.userList).toEqual(
        f.state.audience.userList,
      );
    },
  );
  it("DEVICE opt-out 0 is explicit in preview and reversible from existing modifier", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(
      account,
      advanced({
        operation: "modifier",
        campaign_id: "1",
        criterion_id: "11",
        criterion_type: "DEVICE",
        multiplier: "0",
      }),
      f.read,
    );
    expect(p.operations[0]!.fields.bidModifier).toBe(0);
    expect(p.items[0]!.warnings.join(" ")).toContain("исключает");
  });
  it("rejects automatic-strategy modifiers instead of silently ignored changes", async () => {
    const f = fixture();
    f.state.c.biddingStrategyType = "TARGET_CPA";
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "modifier",
          campaign_id: "1",
          criterion_id: "11",
          criterion_type: "DEVICE",
          multiplier: "1.2",
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("negative targeting criteria cannot receive positive bid modifiers", async () => {
    const f = fixture();
    f.state.criterion.negative = true;
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "modifier",
          campaign_id: "1",
          criterion_id: "11",
          criterion_type: "DEVICE",
          multiplier: "1.2",
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("foreign criterion parent rejection is fatal", async () => {
    const f = fixture();
    f.state.criterion.resourceName = `${prefix}/campaignCriteria/999~11`;
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "modifier",
          campaign_id: "1",
          criterion_id: "11",
          criterion_type: "DEVICE",
          multiplier: "1.2",
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_extended_ownership_invalid" });
  });
  it("bulk freezes typed IDs and reuses foundation precise percent/micros logic", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(account, bulk(), f.read);
    expect(p.operations[0]!.fields.cpcBidMicros).toBe("1100000");
    expect(p.operations[0]!.expected.keyword).toEqual(f.state.keyword.keyword);
    expect(p.intent.resolved_items).toEqual([
      {
        field: "keyword_cpc",
        campaign_id: "1",
        ad_group_id: "2",
        criterion_id: "13",
        change: { mode: "percent", percent: "10", currency: "USD" },
      },
    ]);
    expect(p.inverse_intent).toMatchObject({
      action: "stage2_bulk_inverse",
      items: [
        { change: { mode: "absolute", amount: "1.000000", currency: "USD" } },
      ],
    });
    expect(p.checks.some((x) => x.query.includes("FROM keyword_view"))).toBe(
      true,
    );
  });
  it("bulk auto bidding warning G is retained from foundation", async () => {
    const f = fixture();
    f.state.c.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    const p = await buildStage2AdvancedPlan(account, bulk(), f.read);
    expect(p.items[0]!.warnings.join(" ")).toContain("automated/portfolio");
  });
  it("bulk inverse N is a new typed preview, not a mutation or raw request", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(account, bulk(), f.read);
    f.state.keyword.cpcBidMicros = "1100000";
    const inverse = await buildStage2AdvancedPlan(
      account,
      p.inverse_intent,
      f.read,
    );
    expect(inverse.operations[0]!.fields.cpcBidMicros).toBe("1000000");
    expect(inverse.operations[0]!.before?.cpcBidMicros).toBe("1100000");
  });
  it("bulk budget +60% shared impact H preserves all consumer snapshots", async () => {
    const f = fixture();
    f.state.budget.explicitlyShared = true;
    f.state.bulkRows = [{ campaign: f.state.c, metrics: { clicks: "40" } }];
    const p = await buildStage2AdvancedPlan(
      account,
      bulk({
        field: "campaign_daily_budget",
        change: { mode: "percent", percent: "60", currency: "USD" },
      }),
      f.read,
    );
    expect(p.operations[0]!.fields.amountMicros).toBe("3200000");
    expect(p.items[0]!.warnings.join(" ")).toContain("50%");
    expect(p.items[0]!.warnings.join(" ")).toContain("Shared budget");
  });
  it("bulk duplicate resolved resources are fatal, not silently deduplicated", async () => {
    const f = fixture();
    f.state.bulkRows.push(f.state.bulkRows[0]!);
    await expect(
      buildStage2AdvancedPlan(account, bulk(), f.read),
    ).rejects.toMatchObject({ writeCode: "google_stage2_duplicate" });
  });
  it("bulk never truncates selected rows to max_items", async () => {
    const f = fixture();
    f.state.bulkRows.push({
      ...f.state.bulkRows[0],
      adGroupCriterion: {
        resourceName: `${prefix}/adGroupCriteria/2~14`,
        criterionId: "14",
      },
    });
    await expect(
      buildStage2AdvancedPlan(account, bulk({ max_items: 1 }), f.read),
    ).rejects.toMatchObject({ writeCode: "google_stage2_bulk_limit" });
  });
  it("bulk mixed unavailable IDs produce source HOLYMEDIA row errors", async () => {
    const f = fixture();
    f.state.bulkRows.push({
      ...f.state.bulkRows[0],
      adGroupCriterion: {
        resourceName: `${prefix}/adGroupCriteria/2~999`,
        criterionId: "999",
      },
    });
    const p = await buildStage2AdvancedPlan(account, bulk(), f.read);
    expect(p.operations).toHaveLength(1);
    expect(p.items[1]!.row_error?.source).toBe("HOLYMEDIA");
  });
  it("bulk foreign campaign selection is rejected before build/validate", async () => {
    const f = fixture();
    f.state.bulkRows[0]!.campaign = { id: "999" };
    await expect(
      buildStage2AdvancedPlan(account, bulk(), f.read),
    ).rejects.toMatchObject({ writeCode: "google_extended_ownership_invalid" });
  });
  it("bulk all invalid rows cannot create an empty preview", async () => {
    const f = fixture();
    f.state.bulkRows[0]!.adGroupCriterion = {
      resourceName: `${prefix}/adGroupCriteria/2~999`,
      criterionId: "999",
    };
    await expect(
      buildStage2AdvancedPlan(account, bulk(), f.read),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("binds filtered criterion ID to the exact resource before selecting a mutation", async () => {
    const f = fixture();
    extRow(f.state.bulkRows[0]!.adGroupCriterion).criterionId = "999";
    await expect(
      buildStage2AdvancedPlan(account, bulk(), f.read),
    ).rejects.toMatchObject({ writeCode: "google_extended_ownership_invalid" });
  });
  it("bounds total inventory without silently truncating at 5000", async () => {
    const f = fixture();
    f.state.bulkRows = Array.from({ length: 5001 }, () => f.state.bulkRows[0]!);
    await expect(
      buildStage2AdvancedPlan(account, bulk(), f.read),
    ).rejects.toMatchObject({ writeCode: "google_inventory_limit" });
  });
  it("currency mismatch excludes the row rather than applying implicit FX", async () => {
    const f = fixture();
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced(
          campaignStrategy({
            type: "TARGET_CPA",
            target_cpa: { amount: "5", currency: "KZT" },
          }),
        ),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("existing standard parameter update preserves other explicit parameters", async () => {
    const f = fixture();
    f.state.c.biddingStrategyType = "TARGET_IMPRESSION_SHARE";
    f.state.c.targetImpressionShare = {
      location: "TOP_OF_PAGE",
      locationFractionMicros: "500000",
      cpcBidCeilingMicros: "3000000",
    };
    const p = await buildStage2AdvancedPlan(
      account,
      advanced(
        campaignStrategy({
          type: "TARGET_IMPRESSION_SHARE",
          location: "TOP_OF_PAGE",
          share_percent: "60",
          cpc_ceiling: money("3"),
        }),
      ),
      f.read,
    );
    expect(
      extRow(p.operations[0]!.expected.targetImpressionShare)
        .locationFractionMicros,
    ).toBe("600000");
    expect(p.inverse_intent).toBeDefined();
  });
  it("new previously inherited strategy parameter does not advertise unsafe clear rollback", async () => {
    const f = fixture();
    f.state.c.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    delete f.state.c.manualCpc;
    f.state.c.maximizeConversions = {};
    const p = await buildStage2AdvancedPlan(
      account,
      advanced(
        campaignStrategy({
          type: "MAXIMIZE_CONVERSIONS",
          target_cpa: money("2"),
        }),
      ),
      f.read,
    );
    expect(p.inverse_intent).toBeUndefined();
  });
  it("no-op standard strategy cannot consume preview approval for no change", async () => {
    const f = fixture();
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced(campaignStrategy({ type: "MANUAL_CPC" })),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("clearing existing MaximizeConversions target is an explicit limitation, not silently dropped", async () => {
    const f = fixture();
    f.state.c.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    f.state.c.maximizeConversions = { targetCpaMicros: "1000000" };
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced(campaignStrategy({ type: "MAXIMIZE_CONVERSIONS" })),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("negative modifier foreign parent fields never reach validate_only", async () => {
    const f = fixture();
    f.state.criterion.campaign = `${prefix}/campaigns/999`;
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "modifier",
          campaign_id: "1",
          criterion_id: "11",
          criterion_type: "DEVICE",
          multiplier: "1.2",
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_extended_ownership_invalid" });
  });
  it("stale checks include both metrics selection and exact resource snapshot", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(account, bulk(), f.read);
    const before = canonical(p.checks);
    f.state.keyword.cpcBidMicros = "1500000";
    expect(canonical(await rereadExtendedChecks(p, f.read))).not.toBe(before);
  });
  it("provider reread verifies actual changed value, rejects mismatch, and never retries", async () => {
    const f = fixture();
    const p = await buildStage2AdvancedPlan(
      account,
      advanced({
        operation: "modifier",
        campaign_id: "1",
        criterion_id: "11",
        criterion_type: "DEVICE",
        multiplier: "1.2",
      }),
      f.read,
    );
    const result = [
      {
        operation: 0,
        success: true,
        resource_name: String(f.state.criterion.resourceName),
        error: null,
      },
    ];
    expect((await verifyExtendedMutation(p, result, f.read)).status).toBe(
      "NOT_VERIFIED",
    );
    f.state.criterion.bidModifier = 1.2;
    expect((await verifyExtendedMutation(p, result, f.read)).status).toBe(
      "VERIFIED",
    );
  });
  it.each([
    advanced(campaignStrategy({ type: "UNKNOWN" })),
    advanced(campaignStrategy({ type: "TARGET_ROAS", target_roas: "1001" })),
    advanced(
      campaignStrategy({
        type: "TARGET_CPA",
        target_cpa: { amount: "1", currency: "usd" },
      }),
    ),
    advanced(
      campaignStrategy({ type: "MANUAL_CPC", enhanced_cpc_enabled: true }),
    ),
    advanced({
      operation: "modifier",
      campaign_id: "1",
      criterion_id: "11",
      criterion_type: "LOCATION",
      multiplier: "0",
    }),
    advanced({
      operation: "modifier",
      campaign_id: "1",
      criterion_id: "11",
      criterion_type: "DEVICE",
      multiplier: "0.01",
    }),
    advanced({
      operation: "modifier",
      campaign_id: "1",
      criterion_id: "11",
      criterion_type: "DEVICE",
      multiplier: "11",
    }),
    advanced({
      operation: "modifier",
      campaign_id: "1",
      criterion_id: "11",
      criterion_type: "USER_LIST",
      multiplier: "1.2",
    }),
    advanced({
      operation: "portfolio_create",
      name: " TEST",
      strategy: { type: "MAXIMIZE_CLICKS" },
    }),
    advanced({
      ...campaignStrategy({ type: "MANUAL_CPC" }),
      payload: { status: "ENABLED" },
    }),
    advanced(
      campaignStrategy({ type: "MANUAL_CPC" }),
      campaignStrategy({ type: "MAXIMIZE_CLICKS" }),
    ),
    bulk({ campaign_ids: ["1", "1"] }),
    bulk({
      filters: [{ metric: "clicks OR true", operator: "GTE", value: "0" }],
    }),
    bulk({ date_range: { start: "2026-02-30", end: "2026-03-01" } }),
    bulk({ max_items: 501 }),
  ])("rejects malformed/security input %j before mock provider reads", (raw) =>
    expect(() => parseStage2AdvancedIntent(raw)).toThrow(),
  );
  it("unsupported portfolio ManualCpc and standard CPC limits are not dropped", async () => {
    const f = fixture();
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced({
          operation: "portfolio_create",
          name: "TEST New",
          strategy: { type: "MANUAL_CPC" },
        }),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
    await expect(
      buildStage2AdvancedPlan(
        account,
        advanced(
          campaignStrategy({
            type: "TARGET_CPA",
            target_cpa: money(),
            cpc_floor: money(),
          }),
        ),
        f.read,
      ),
    ).rejects.toMatchObject({ writeCode: "google_stage2_no_eligible_rows" });
  });
  it("closed MCP schema/runtime excludes arbitrary payload, raw micros and account swaps", () => {
    const s = stage2AdvancedToolSchema("google_ads_strategy_modifier_preview")!;
    expect(s.additionalProperties).toBe(false);
    expect(s.required).toEqual(["provider", "account_id", "items"]);
    expect(
      stage2AdvancedToolIntent("google_ads_strategy_modifier_preview", {
        provider: "GOOGLE_ADS",
        account_id: account,
        items: [campaignStrategy({ type: "MANUAL_CPC" })],
      }),
    ).toMatchObject({ action: "stage2_advanced" });
    expect(() =>
      stage2AdvancedToolIntent("google_ads_strategy_modifier_preview", {
        provider: "META",
        account_id: account,
        items: [],
      }),
    ).toThrow();
    expect(() =>
      stage2AdvancedToolIntent("google_ads_strategy_modifier_preview", {
        provider: "GOOGLE_ADS",
        account_id: account,
        items: [],
        payload: {},
      }),
    ).toThrow();
  });
});

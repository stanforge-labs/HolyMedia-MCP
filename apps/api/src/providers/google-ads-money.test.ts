import { describe, expect, it } from "vitest";
import { canonical, type Stage1Reader } from "./google-ads-stage1.js";
import {
  buildStage2Plan,
  changedMicros,
  rereadStage2Checks,
  stage2RollbackIntent,
} from "./google-ads-stage2.js";
import {
  alignedMoneyMicros,
  currencyConstantQuery,
  moneyUnitFromRows,
  moneyUnitWarnings,
  quantizePositiveMicros,
  resolveGoogleMoneyUnit,
} from "./google-ads-money.js";
const account = "8590146099",
  prefix = `customers/${account}`;
const constant = (code = "USD", unit = "10000") => ({
  resourceName: `currencyConstants/${code}`,
  code,
  billableUnitMicros: unit,
});
const unit = (code = "USD", micros = "10000") =>
  moneyUnitFromRows(code, [{ currencyConstant: constant(code, micros) }]);
const intent = (amount = "0.105", currency = "USD") => ({
  action: "bid_budget_update",
  items: [
    {
      field: "ad_group_cpc",
      campaign_id: "1",
      ad_group_id: "2",
      change: { mode: "absolute", amount, currency },
    },
  ],
});
function fixture(code = "USD", micros = "10000") {
  const state = {
    currency: code,
    constant: constant(code, micros) as Record<string, unknown>,
    campaign: {
      resourceName: `${prefix}/campaigns/1`,
      id: "1",
      name: "TEST",
      status: "PAUSED",
      campaignBudget: `${prefix}/campaignBudgets/3`,
      biddingStrategyType: "MANUAL_CPC",
    } as Record<string, unknown>,
    group: {
      resourceName: `${prefix}/adGroups/2`,
      id: "2",
      name: "TEST",
      status: "PAUSED",
      cpcBidMicros: "100000",
      targetCpaMicros: "0",
    } as Record<string, unknown>,
    calls: [] as string[],
  };
  const read: Stage1Reader = async (q) => {
    state.calls.push(q);
    if (q.includes(" FROM currency_constant"))
      return [{ currencyConstant: structuredClone(state.constant) }];
    if (q.includes(" FROM customer"))
      return [{ customer: { id: account, currencyCode: state.currency } }];
    if (q.includes(" FROM campaign "))
      return [{ campaign: structuredClone(state.campaign) }];
    if (q.includes(" FROM ad_group "))
      return [{ campaign: { id: "1" }, adGroup: structuredClone(state.group) }];
    throw new Error("Mock missing query: " + q);
  };
  return { state, read };
}
describe("Google v24 authoritative currency unit", () => {
  it("queries exact account ISO code and immutable global constant reference", async () => {
    const f = fixture();
    expect(await resolveGoogleMoneyUnit("USD", f.read)).toEqual({
      currency: "USD",
      unit_micros: "10000",
      resource_name: "currencyConstants/USD",
    });
    expect(f.state.calls).toEqual([
      "SELECT currency_constant.resource_name, currency_constant.code, currency_constant.billable_unit_micros FROM currency_constant WHERE currency_constant.code = 'USD'",
    ]);
    expect(() => currencyConstantQuery("USD' OR 1=1")).toThrow();
  });
  it.each([
    { rows: [] },
    {
      rows: [
        { currencyConstant: constant() },
        { currencyConstant: constant() },
      ],
    },
  ])("missing/duplicate unit never defaults: %j", ({ rows }) => {
    expect(() => moneyUnitFromRows("USD", rows)).toThrow();
  });
  it.each([
    { ...constant(), code: "KZT" },
    { ...constant(), resourceName: "currencyConstants/KZT" },
    {
      ...constant(),
      resourceName: "customers/8590146099/currencyConstants/USD",
    },
    { ...constant(), billableUnitMicros: "0" },
    { ...constant(), billableUnitMicros: "-1" },
    { ...constant(), billableUnitMicros: "1.1" },
    { ...constant(), billableUnitMicros: "0010000" },
    { ...constant(), billableUnitMicros: "9223372036854775808" },
    { ...constant(), billableUnitMicros: Number.MAX_SAFE_INTEGER + 1 },
    { ...constant(), billableUnitMicros: undefined },
  ])("malformed/foreign unit rejected: %j", (row) => {
    expect(() =>
      moneyUnitFromRows("USD", [{ currencyConstant: row }]),
    ).toThrow();
  });
  it.each([
    ["USD", "10000", "104999", "100000"],
    ["USD", "10000", "105000", "110000"],
    ["KZT", "1000000", "15499999", "15000000"],
    ["KZT", "1000000", "15500000", "16000000"],
    ["JPY", "1000000", "1500000", "2000000"],
    ["USD", "3", "10", "9"],
  ])(
    "%s mock provider unit %s, requested %s → %s (not a hardcoded currency table)",
    (code, quantum, requested, expected) => {
      expect(quantizePositiveMicros(requested, unit(code, quantum))).toBe(
        expected,
      );
    },
  );
  it("rejects rounding positive money to zero and profile overflow", () => {
    expect(() => quantizePositiveMicros("4999", unit())).toThrow(/нул/);
    expect(quantizePositiveMicros("5000", unit())).toBe("10000");
    expect(() =>
      quantizePositiveMicros("999999999999999999", unit()),
    ).toThrow();
  });
  it("explicit warning includes exact requested/rounded micros, currency and unit", () => {
    expect(moneyUnitWarnings("105000", "110000", unit()).join(" ")).toMatch(
      /requested micros=105000 → 110000.*USD/,
    );
    expect(moneyUnitWarnings("110000", "110000", unit())).toHaveLength(1);
    expect(alignedMoneyMicros("110000", unit())).toBe(true);
    expect(alignedMoneyMicros("110001", unit())).toBe(false);
  });
});
describe("Stage 2 currency-unit mutation semantics", () => {
  it.each([
    ["USD", "10000", "0.105", "110000"],
    ["KZT", "1000000", "15.5", "16000000"],
    ["JPY", "1000000", "2.5", "3000000"],
  ])(
    "%s account preview uses its proved provider unit %s",
    async (code, quantum, amount, expected) => {
      const f = fixture(code, quantum);
      f.state.group.cpcBidMicros = quantum;
      const plan = await buildStage2Plan(account, intent(amount, code), f.read);
      expect(plan.operations[0]?.fields.cpcBidMicros).toBe(expected);
      expect(plan.items[0]?.after).toMatchObject({
        currency: code,
        billable_unit_micros: quantum,
      });
      expect(
        plan.checks.some((c) => c.query === currencyConstantQuery(code)),
      ).toBe(true);
    },
  );
  it("raw Stage 1/default changedMicros behavior remains compatible", () => {
    expect(
      changedMicros(
        "100000",
        { mode: "absolute", amount: "0.105001", currency: "USD" },
        "USD",
      ),
    ).toBe("105001");
    expect(
      changedMicros(
        "100000",
        { mode: "absolute", amount: "0.105001", currency: "USD" },
        "USD",
        unit(),
      ),
    ).toBe("110000");
  });
  it("percent direct rational-unit rounding handles tie and avoids double rounding", () => {
    expect(
      changedMicros(
        "100000",
        { mode: "percent", percent: "5", currency: "USD" },
        "USD",
        unit(),
      ),
    ).toBe("110000");
    // 100000*1.024996 = 102499.6; first rounding to a micro would incorrectly hit a 5000-unit tie.
    expect(
      changedMicros(
        "100000",
        { mode: "percent", percent: "2.4996", currency: "USD" },
        "USD",
        unit("USD", "5000"),
      ),
    ).toBe("100000");
    expect(() =>
      changedMicros(
        "0",
        { mode: "percent", percent: "10", currency: "USD" },
        "USD",
        unit(),
      ),
    ).toThrow(/inherited/);
    expect(() =>
      changedMicros(
        "100000",
        { mode: "absolute", amount: "1", currency: "KZT" },
        "USD",
        unit(),
      ),
    ).toThrow(/Валюта/);
  });
  it("preview freezes unit proof, updates only CPC and shows rounding/quantum", async () => {
    const f = fixture(),
      plan = await buildStage2Plan(account, intent(), f.read);
    expect(
      plan.checks.find((c) => c.query === currencyConstantQuery("USD"))?.rows,
    ).toEqual([{ currencyConstant: constant() }]);
    expect(plan.operations[0]?.fields).toEqual({
      resourceName: `${prefix}/adGroups/2`,
      cpcBidMicros: "110000",
    });
    expect(plan.operations[0]?.update_mask).toBe("cpc_bid_micros");
    expect(plan.items[0]?.after).toMatchObject({
      cpcBidMicros: "110000",
      currency: "USD",
      billable_unit_micros: "10000",
    });
    expect(plan.items[0]?.warnings.join(" ")).toContain("Округление");
    f.state.constant.billableUnitMicros = "100000";
    expect(canonical(await rereadStage2Checks(plan, f.read))).not.toBe(
      canonical(plan.checks),
    );
  });
  it("rounded noop rejected with no operations/validation; unavailable unit fatal", async () => {
    const f = fixture();
    await expect(
      buildStage2Plan(account, intent("0.1049"), f.read),
    ).rejects.toThrow(/Все строки/);
    f.state.constant.billableUnitMicros = "0";
    await expect(
      buildStage2Plan(account, intent("0.11"), f.read),
    ).rejects.toThrow(/billable_unit/);
    expect(f.state.group.cpcBidMicros).toBe("100000");
  });
  it("inverse exact for aligned existing money; nonaligned money never silently rounded in rollback", async () => {
    const f = fixture(),
      plan = await buildStage2Plan(account, intent(), f.read),
      inverse = stage2RollbackIntent(plan, [0], "USD");
    expect(inverse.items[0]?.change).toEqual({
      mode: "absolute",
      amount: "0.100000",
      currency: "USD",
    });
    f.state.group.cpcBidMicros = "110000";
    const restored = await buildStage2Plan(account, inverse, f.read);
    expect(restored.operations[0]?.fields.cpcBidMicros).toBe("100000");
    f.state.group.cpcBidMicros = "100001";
    const notAligned = await buildStage2Plan(account, intent("0.12"), f.read);
    expect(() => stage2RollbackIntent(notAligned, [0], "USD")).toThrow(
      /выровнена/,
    );
  });
});

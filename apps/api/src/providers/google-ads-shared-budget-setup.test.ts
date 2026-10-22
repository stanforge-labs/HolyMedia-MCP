import { describe, expect, it } from "vitest";
import { canonical } from "./google-ads-stage1.js";
import { parseSharedBudgetSetup } from "./google-ads-shared-budget-setup.js";
import { buildStage2AdvancedPlan } from "./google-ads-stage2-advanced.js";
import {
  decodeExtendedMutation,
  extendedProviderOperation,
  rereadExtendedChecks,
  replaceExtendedTemps,
  verifyExtendedMutation,
  type ExtendedPlan,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";
import {
  stage2AdvancedToolIntent,
  stage2AdvancedToolSchema,
} from "../mcp/mcp-google-stage2-advanced-schema.js";
const account = "1234567890",
  prefix = `customers/${account}`;
const intent = () => ({
  action: "stage2_shared_budget",
  operation: "create_and_attach",
  name: "HM_MCP_ACCEPTANCE_SHARED_mock",
  daily_budget: { amount: "2.00", currency: "USD" },
  campaign_ids: ["1", "2"],
});
function fixture() {
  const customer: ExtendedRow = {
    id: account,
    resourceName: prefix,
    currencyCode: "USD",
    timeZone: "Asia/Almaty",
    testAccount: true,
  };
  const campaigns = [1, 2, 3].map(
    (id) =>
      ({
        id: String(id),
        resourceName: `${prefix}/campaigns/${id}`,
        name: `TEST ${id}`,
        status: id === 3 ? "ENABLED" : "PAUSED",
        advertisingChannelType: "SEARCH",
        biddingStrategyType: "MANUAL_CPC",
        manualCpc: { enhancedCpcEnabled: false },
        experimentType: "BASE",
        campaignBudget: `${prefix}/campaignBudgets/${id + 10}`,
        networkSettings: {
          targetGoogleSearch: true,
          targetContentNetwork: false,
        },
        finalUrlSuffix: "utm_source=google",
      }) as ExtendedRow,
  );
  const budgets = [11, 12, 13].map(
    (id) =>
      ({
        id: String(id),
        resourceName: `${prefix}/campaignBudgets/${id}`,
        name: `TEST ${id}`,
        status: "ENABLED",
        amountMicros: "2000000",
        period: "DAILY",
        deliveryMethod: "STANDARD",
        type: "STANDARD",
        explicitlyShared: false,
      }) as ExtendedRow,
  );
  const unit: ExtendedRow = {
    resourceName: "currencyConstants/USD",
    code: "USD",
    billableUnitMicros: "10000",
  };
  const calls: string[] = [];
  const read = async (q: string) => {
    calls.push(q);
    if (q.includes("FROM currency_constant"))
      return [{ currencyConstant: structuredClone(unit) }];
    if (q.includes("FROM customer"))
      return [{ customer: structuredClone(customer) }];
    const isBudget = q.includes("FROM campaign_budget"),
      rows = isBudget ? budgets : campaigns;
    const id = q.match(/campaign\.id = ([0-9]+)/)?.[1],
      resource = q.match(/campaign_budget\.resource_name = '([^']+)'/)?.[1];
    return rows
      .filter(
        (r) =>
          (!id || r.id === id) &&
          (!resource || r.resourceName === resource) &&
          r.status !== "REMOVED",
      )
      .map((r) => ({
        [isBudget ? "campaignBudget" : "campaign"]: structuredClone(r),
      }));
  };
  const build = (raw: unknown = intent()) =>
    buildStage2AdvancedPlan(account, raw, read);
  const apply = (plan: ExtendedPlan) => {
    const refs = new Map<string, string>();
    for (const o of plan.operations)
      if (o.method === "create")
        refs.set(o.resource_name!, `${prefix}/campaignBudgets/901`);
    const results = plan.operations.map((o) => ({
      success: true,
      resource_name: refs.get(o.resource_name!) ?? o.resource_name,
      error: null,
    }));
    for (const o of plan.operations) {
      const fields = replaceExtendedTemps(o.fields, refs) as ExtendedRow;
      if (o.method === "create")
        budgets.push({ ...fields, id: "901", status: "ENABLED" });
      else
        Object.assign(
          campaigns.find((c) => c.resourceName === o.resource_name)!,
          fields,
        );
    }
    return results;
  };
  return { customer, campaigns, budgets, unit, calls, read, build, apply };
}
describe("TEST-only shared budget setup: mock provider only", () => {
  it("dispatches typed atomic 1-create + 2-reference updates, frozen impact and exact unchanged masks", async () => {
    const f = fixture(),
      before = canonical(f.campaigns),
      p = await f.build();
    expect(p.version).toBe(5);
    expect(p.atomic).toBe(true);
    expect(p.irreversible).toBe(false);
    expect(p.inverse_intent).toBeUndefined();
    expect(p.operations).toHaveLength(3);
    expect(p.operations[0]!.fields).toMatchObject({
      name: intent().name,
      amountMicros: "2000000",
      explicitlyShared: true,
      period: "DAILY",
      type: "STANDARD",
    });
    expect(p.operations[0]!.fields.status).toBeUndefined();
    for (const o of p.operations.slice(1)) {
      expect(o.update_mask).toBe("campaign_budget");
      expect(Object.keys(o.fields).sort()).toEqual([
        "campaignBudget",
        "resourceName",
      ]);
      expect(o.expected.status).toBe("PAUSED");
      expect(o.expected.finalUrlSuffix).toBe("utm_source=google");
    }
    expect(JSON.stringify(p.items)).toContain("Consumers BEFORE");
    expect(p.items[0]!.after).toHaveProperty(
      "affected_campaigns",
      expect.arrayContaining([
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({ id: "2" }),
      ]),
    );
    expect(canonical(f.campaigns)).toBe(before);
    expect(extendedProviderOperation(p.operations[0]!)).toHaveProperty(
      "campaignBudgetOperation.create.explicitlyShared",
      true,
    );
    const results = f.apply(p);
    expect((await verifyExtendedMutation(p, results, f.read)).status).toBe(
      "VERIFIED",
    );
  });
  it("explicit separate assign restores original IDs without deleting residual shared budget; inverse updates are reversible", async () => {
    const f = fixture(),
      original = canonical(f.campaigns),
      setup = await f.build();
    f.apply(setup);
    const restore = await f.build({
      action: "stage2_shared_budget",
      operation: "assign",
      assignments: [
        { campaign_id: "1", budget_id: "11" },
        { campaign_id: "2", budget_id: "12" },
      ],
    });
    expect(
      restore.operations.every(
        (o) => o.method === "update" && o.update_mask === "campaign_budget",
      ),
    ).toBe(true);
    expect(restore.inverse_intent).toMatchObject({
      operation: "assign",
      assignments: [
        { campaign_id: "1", budget_id: "901" },
        { campaign_id: "2", budget_id: "901" },
      ],
    });
    const results = f.apply(restore);
    expect(
      (await verifyExtendedMutation(restore, results, f.read)).status,
    ).toBe("VERIFIED");
    expect(canonical(f.campaigns)).toBe(original);
    expect(f.budgets.find((b) => b.id === "901")?.explicitlyShared).toBe(true);
  });
  it.each([false, undefined, "true", 1])(
    "production/unproved TEST value %s rejects before budgets/build",
    async (value) => {
      const f = fixture();
      f.customer.testAccount = value;
      await expect(f.build()).rejects.toMatchObject({
        writeCode: "google_shared_setup_test_account_required",
      });
      expect(f.calls.some((q) => q.includes("FROM campaign_budget"))).toBe(
        false,
      );
    },
  );
  it.each([
    "ENABLED",
    "REMOVED",
    "DRAFT",
    "EXPERIMENT",
    "TARGET_SPEND",
    "portfolio",
    "enhanced",
  ])("unsafe campaign proof %s rejects whole atomic batch", async (value) => {
    const f = fixture(),
      c = f.campaigns[1]!;
    if (["ENABLED", "REMOVED"].includes(value)) c.status = value;
    else if (["DRAFT", "EXPERIMENT"].includes(value)) c.experimentType = value;
    else if (value === "portfolio")
      c.biddingStrategy = `${prefix}/biddingStrategies/5`;
    else if (value === "enhanced") c.manualCpc = { enhancedCpcEnabled: true };
    else c.biddingStrategyType = value;
    await expect(f.build()).rejects.toBeDefined();
  });
  it.each([
    "currency",
    "fraction",
    "period",
    "delivery",
    "aligned",
    "type",
    "shared",
    "removed",
  ])("budget incompatibility %s fails closed", async (value) => {
    const f = fixture(),
      b = f.budgets[0]!;
    if (value === "currency")
      await expect(
        f.build({
          ...intent(),
          daily_budget: { amount: "2", currency: "EUR" },
        }),
      ).rejects.toMatchObject({ writeCode: "google_currency_mismatch" });
    else {
      if (value === "fraction") b.amountMicros = "2000001";
      if (value === "period") b.period = "CUSTOM_PERIOD";
      if (value === "delivery") b.deliveryMethod = "ACCELERATED";
      if (value === "aligned") b.alignedBiddingStrategyId = "77";
      if (value === "type") b.type = "FIXED_CPA";
      if (value === "shared") b.explicitlyShared = true;
      if (value === "removed") b.status = "REMOVED";
      await expect(f.build()).rejects.toBeDefined();
    }
  });
  it("foreign/missing/duplicate identities and name collisions cannot be hidden in otherwise valid setup", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) =>
        (f.campaigns[1]!.resourceName = "customers/9999999999/campaigns/2"),
      (f: ReturnType<typeof fixture>) =>
        (f.budgets[0]!.resourceName =
          "customers/9999999999/campaignBudgets/11"),
      (f: ReturnType<typeof fixture>) => (f.budgets[0]!.name = intent().name),
      (f: ReturnType<typeof fixture>) =>
        f.campaigns.push(structuredClone(f.campaigns[0]!)),
      (f: ReturnType<typeof fixture>) => f.campaigns.splice(1, 1),
    ]) {
      const f = fixture();
      mutate(f);
      await expect(f.build()).rejects.toBeDefined();
    }
  });
  it("full consumers/currency/budget snapshots cause stale and neighbor mutation cannot be hidden", async () => {
    const f = fixture(),
      p = await f.build();
    expect(canonical(await rereadExtendedChecks(p, f.read))).toBe(
      canonical(p.checks),
    );
    f.budgets[0]!.amountMicros = "3000000";
    expect(canonical(await rereadExtendedChecks(p, f.read))).not.toBe(
      canonical(p.checks),
    );
    const g = fixture(),
      plan = await g.build(),
      results = g.apply(plan);
    g.campaigns[2]!.status = "PAUSED";
    const result = await verifyExtendedMutation(plan, results, g.read);
    expect(result.status).toBe("NOT_VERIFIED");
    expect(result.context_verified).toBe(false);
  });
  it("wrong provider shared/name/amount or campaign reference never verify", async () => {
    for (const field of [
      "explicitlyShared",
      "name",
      "amountMicros",
      "campaignBudget",
    ]) {
      const f = fixture(),
        p = await f.build(),
        results = f.apply(p);
      if (field === "campaignBudget")
        f.campaigns[0]!.campaignBudget = `${prefix}/campaignBudgets/11`;
      else
        f.budgets.at(-1)![field] =
          field === "explicitlyShared" ? false : "wrong";
      expect(
        (await verifyExtendedMutation(p, results, f.read)).status,
      ).not.toBe("VERIFIED");
    }
  });
  it("complete impact checks reject nonshared double-consumers and stale new consumers", async () => {
    const f = fixture();
    f.apply(await f.build());
    await expect(
      f.build({
        action: "stage2_shared_budget",
        operation: "assign",
        assignments: [
          { campaign_id: "1", budget_id: "11" },
          { campaign_id: "2", budget_id: "11" },
        ],
      }),
    ).rejects.toMatchObject({
      writeCode: "google_shared_setup_budget_not_shareable",
    });
    f.campaigns[2]!.campaignBudget = `${prefix}/campaignBudgets/901`;
    await expect(
      f.build({
        action: "stage2_shared_budget",
        operation: "assign",
        assignments: [{ campaign_id: "1", budget_id: "11" }],
      }),
    ).rejects.toMatchObject({
      writeCode: "google_shared_setup_campaign_incompatible",
    });
  });
  it("exact Google result ownership/atomic provider failures remain structured and not successful", async () => {
    const f = fixture(),
      p = await f.build();
    const r = decodeExtendedMutation(
      {
        partialFailureError: {
          code: 3,
          details: [
            {
              errors: [
                {
                  errorCode: { campaignBudgetError: "BUDGET_ERROR" },
                  location: {
                    fieldPathElements: [
                      { fieldName: "mutateOperations", index: 1 },
                    ],
                  },
                },
              ],
            },
          ],
        },
      },
      p,
      false,
    );
    expect(r.every((x) => !x.success)).toBe(true);
    const bad = decodeExtendedMutation(
      {
        mutateOperationResponses: p.operations.map(() => ({
          campaignBudgetResult: {
            resourceName: "customers/9999999999/campaignBudgets/901",
          },
        })),
      },
      p,
      false,
    );
    expect(bad.every((x) => !x.success)).toBe(true);
  });
  it.each([
    { ...intent(), campaign_ids: ["1", "1"] },
    { ...intent(), campaign_ids: ["1"] },
    { ...intent(), name: "unscoped" },
    { ...intent(), daily_budget: { amount: "2.000001", currency: "USD" } },
    { ...intent(), raw_payload: {} },
    { action: "stage2_shared_budget", operation: "remove", budget_id: "11" },
    {
      action: "stage2_shared_budget",
      operation: "assign",
      assignments: [
        { campaign_id: "1", budget_id: "11" },
        { campaign_id: "1", budget_id: "12" },
      ],
    },
  ])("typed limits/fields reject invalid row %#", async (raw) => {
    const f = fixture();
    await expect(f.build(raw)).rejects.toBeDefined();
  });
  it("MCP closed schema exposes setup/assign only and cannot override internal action/provider fields", () => {
    const name = "google_ads_shared_budget_setup_preview",
      args = { provider: "GOOGLE_ADS", account_id: account, ...intent() };
    delete (args as Partial<typeof args>).action;
    expect(stage2AdvancedToolSchema(name)).toMatchObject({
      type: "object",
      oneOf: expect.any(Array),
    });
    expect(stage2AdvancedToolIntent(name, args)).toMatchObject(intent());
    expect(() =>
      stage2AdvancedToolIntent(name, { ...args, action: "stage2_advanced" }),
    ).toThrow();
    expect(() =>
      parseSharedBudgetSetup({ ...intent(), operation: "clear" }),
    ).toThrow();
  });
});

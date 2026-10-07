import { describe, expect, it, vi } from "vitest";
import {
  stage0Query,
  verifyStage0Mutation,
  type Stage0Plan,
  type JsonRow,
} from "./google-ads-stage0.js";
import { canonical, type Stage1MutationResult } from "./google-ads-stage1.js";

const campaignName = "HM_MCP_WRITE_ACCEPTANCE_20261007T134837Z";
const prefix = "customers/8590146099";
const budgetResource = `${prefix}/campaignBudgets/15934365976`;
const campaignResource = `${prefix}/campaigns/24324170853`;
function evidence(shared = false, legacy = true) {
  const budgetFields = {
    resourceName: `${prefix}/campaignBudgets/-1`,
    ...(shared || legacy ? { name: `${campaignName} — daily` } : {}),
    amountMicros: "2000000",
    explicitlyShared: shared,
    deliveryMethod: "STANDARD",
  };
  const campaignFields = {
    resourceName: `${prefix}/campaigns/-2`,
    campaignBudget: budgetFields.resourceName,
    name: campaignName,
    status: "PAUSED",
    manualCpc: {},
  };
  const plan: Stage0Plan = {
    version: 0,
    account_id: "8590146099",
    intent: {
      action: "campaign_create",
      brief: { campaign_name: campaignName },
    },
    checks: [],
    operations: [
      {
        kind: "campaignBudget",
        method: "create",
        fields: budgetFields,
        expected: {
          ...budgetFields,
          name: shared || legacy ? budgetFields.name : campaignName,
        },
        resource_name: budgetFields.resourceName,
        update_mask: null,
        before: null,
        row: 0,
      },
      {
        kind: "campaign",
        method: "create",
        fields: campaignFields,
        expected: campaignFields,
        resource_name: campaignFields.resourceName,
        update_mask: null,
        before: null,
        row: 1,
      },
    ],
    items: [],
    summary: { strategy: "MANUAL_CPC" },
  };
  const budget: JsonRow = {
    ...budgetFields,
    resourceName: budgetResource,
    name: shared ? budgetFields.name : campaignName,
  };
  const campaign: JsonRow = {
    resourceName: campaignResource,
    campaignBudget: budgetResource,
    name: campaignName,
    status: "PAUSED",
    biddingStrategyType: "MANUAL_CPC",
  };
  const results: Stage1MutationResult[] = [
    { success: true, resource_name: budgetResource, error: null },
    { success: true, resource_name: campaignResource, error: null },
  ];
  const read = vi.fn(async (query: string) =>
    query.includes("FROM campaign_budget")
      ? [{ campaignBudget: budget }]
      : [{ campaign }],
  );
  return { plan, budget, campaign, results, read };
}
describe("Stage 0 budget verification: Google provider-managed names, no mutations", () => {
  it("selects the complete budget post-state including name", () => {
    const query = stage0Query(
      "campaignBudget",
      `campaign_budget.resource_name = '${budgetResource}'`,
    );
    for (const field of [
      "resource_name",
      "name",
      "amount_micros",
      "explicitly_shared",
      "delivery_method",
    ])
      expect(query).toContain(`campaign_budget.${field}`);
  });
  it.each([true, false])(
    "verifies live non-shared semantics with immutable legacy/new plan (legacy=%s)",
    async (legacy) => {
      const f = evidence(false, legacy),
        immutable = canonical(f.plan);
      const verified = await verifyStage0Mutation(f.plan, f.results, f.read);
      expect(verified.status).toBe("VERIFIED");
      expect(verified.items.every((item) => item.success)).toBe(true);
      expect(canonical(f.plan)).toBe(immutable);
      expect(f.read.mock.calls[0]![0]).toContain("campaign_budget.name");
      expect(f.read.mock.calls[1]![0]).toContain(campaignResource);
      expect(f.read.mock.calls.every(([q]) => !q.includes("/-"))).toBe(true);
    },
  );
  it("keeps an explicitly shared independent budget name exact", async () => {
    const f = evidence(true);
    expect((await verifyStage0Mutation(f.plan, f.results, f.read)).status).toBe(
      "VERIFIED",
    );
    f.budget.name = campaignName;
    expect((await verifyStage0Mutation(f.plan, f.results, f.read)).status).toBe(
      "UNVERIFIED",
    );
  });
  it.each([
    ["amountMicros", "3000000"],
    ["explicitlyShared", true],
    ["deliveryMethod", "ACCELERATED"],
    ["name", "Wrong campaign"],
    ["resourceName", `${prefix}/campaignBudgets/999`],
  ])("still rejects a genuinely wrong budget %s", async (field, value) => {
    const f = evidence();
    f.budget[String(field)] = value;
    const verified = await verifyStage0Mutation(f.plan, f.results, f.read);
    expect(verified.status).toBe("UNVERIFIED");
    expect(verified.items[0]!.success).toBe(false);
  });
  it.each([
    ["campaignBudget", `${prefix}/campaignBudgets/999`],
    ["name", "Externally renamed"],
    ["resourceName", `${prefix}/campaigns/-2`],
  ])(
    "rejects wrong actual campaign association/name/identity (%s)",
    async (field, value) => {
      const f = evidence();
      f.campaign[field] = value;
      const verified = await verifyStage0Mutation(f.plan, f.results, f.read);
      expect(verified.status).toBe("UNVERIFIED");
      expect(verified.items[0]!.success).toBe(false);
    },
  );
  it("fails closed for missing or ambiguous non-shared campaign association", async () => {
    const f = evidence();
    f.plan.operations[1]!.expected = {
      ...f.plan.operations[1]!.expected,
      campaignBudget: `${prefix}/campaignBudgets/-999`,
    };
    expect((await verifyStage0Mutation(f.plan, f.results, f.read)).status).toBe(
      "UNVERIFIED",
    );
    const g = evidence();
    g.plan.operations.push({ ...g.plan.operations[1]! });
    expect((await verifyStage0Mutation(g.plan, g.results, g.read)).status).toBe(
      "UNVERIFIED",
    );
  });
  it("does not turn missing budget or campaign reread into VERIFIED", async () => {
    const f = evidence();
    for (const missing of ["campaign_budget", "campaign"]) {
      const read = async (q: string) =>
        q.includes(`FROM ${missing} WHERE`) ? [] : f.read(q);
      expect((await verifyStage0Mutation(f.plan, f.results, read)).status).toBe(
        "UNVERIFIED",
      );
    }
  });
});

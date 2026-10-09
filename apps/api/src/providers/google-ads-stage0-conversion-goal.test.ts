import { describe, expect, it, vi } from "vitest";
import {
  buildStage0Plan,
  stage0CampaignGoalResource,
  stage0ProviderOperations,
  verifyStage0Mutation,
  type JsonRow,
  type Stage0Plan,
} from "./google-ads-stage0.js";
import type {
  Stage1Reader,
  Stage1MutationResult,
} from "./google-ads-stage1.js";

const account = "8590146099",
  prefix = `customers/${account}`;
const goal = () => ({
  resourceName: `${prefix}/customerConversionGoals/13~2`,
  category: "SUBMIT_LEAD_FORM",
  origin: "WEBSITE",
  biddable: true,
});
function mock() {
  const state = {
    goals: [goal()] as JsonRow[],
    confirmed: null as JsonRow[] | null,
    selectedCategory: "SUBMIT_LEAD_FORM",
  };
  const read = vi.fn<Stage1Reader>(async (q) => {
    if (q.includes("FROM currency_constant"))
      return [
        {
          currencyConstant: {
            resourceName: "currencyConstants/USD",
            code: "USD",
            billableUnitMicros: "10000",
          },
        },
      ];
    if (q.includes("FROM customer_conversion_goal"))
      return (
        q.includes("WHERE") && state.confirmed ? state.confirmed : state.goals
      ).map((customerConversionGoal) => ({ customerConversionGoal }));
    if (q.includes("FROM conversion_action"))
      return [
        {
          conversionAction: {
            resourceName: `${prefix}/conversionActions/500`,
            id: "500",
            name: "TEST lead",
            status: "ENABLED",
            primaryForGoal: true,
            category: state.selectedCategory,
            origin: "WEBSITE",
          },
        },
      ];
    if (q.includes("FROM geo_target_constant"))
      return [
        {
          geoTargetConstant: {
            resourceName: "geoTargetConstants/1000000",
            status: "ENABLED",
          },
        },
      ];
    if (q.includes("FROM language_constant"))
      return [
        {
          languageConstant: {
            resourceName: "languageConstants/1000",
            id: "1000",
            name: "English",
            code: "en",
            targetable: true,
          },
        },
      ];
    if (q.includes("FROM customer") && !q.includes("metrics."))
      return [
        {
          customer: {
            resourceName: prefix,
            id: account,
            currencyCode: "USD",
            timeZone: "Asia/Almaty",
            conversionTrackingSetting: { googleAdsConversionCustomer: prefix },
          },
        },
      ];
    return [];
  });
  const suggest = vi.fn(async () => [
    {
      geoTargetConstant: {
        resourceName: "geoTargetConstants/1000000",
        id: "1000000",
        name: "Алматы",
        countryCode: "KZ",
        status: "ENABLED",
      },
    },
  ]);
  const brief = {
    provider: "GOOGLE_ADS",
    account_id: account,
    campaign_name: "TEST canonical conversion goal",
    daily_budget: { amount: "2", currency: "USD" },
    locations: [{ name: "Алматы" }],
    languages: ["en"],
    conversion_actions: ["500"],
    ad_groups: [
      {
        name: "TEST group",
        default_bid: { amount: "1", currency: "USD" },
        keywords: [{ text: "test canonical goal", match_type: "EXACT" }],
        rsa: [
          {
            final_url: "https://example.test/",
            headlines: ["Test one", "Test two", "Test three"].map((text) => ({
              text,
            })),
            descriptions: ["Test description one", "Test description two"].map(
              (text) => ({ text }),
            ),
          },
        ],
      },
    ],
  };
  const build = () => buildStage0Plan(account, brief, read, suggest);
  return { state, read, suggest, brief, build };
}
describe("Stage 0 canonical conversion goal references — no real Google calls", () => {
  it("uses provider numeric suffix, exact mask and semantic expected fields", async () => {
    const f = mock(),
      p = await f.build(),
      op = p.operations.find((o) => o.kind === "campaignConversionGoal")!;
    expect(op.fields).toEqual({
      resourceName: `${prefix}/campaignConversionGoals/-2~13~2`,
      biddable: true,
    });
    expect(op.method).toBe("update");
    expect(op.update_mask).toBe("biddable");
    expect(op.expected).toMatchObject({
      campaign: `${prefix}/campaigns/-2`,
      category: "SUBMIT_LEAD_FORM",
      origin: "WEBSITE",
    });
    expect(stage0ProviderOperations(p)[op.row]).toEqual({
      campaignConversionGoalOperation: {
        update: op.fields,
        updateMask: "biddable",
      },
    });
    expect(
      f.read.mock.calls.some(
        ([q]) =>
          q.includes("customer_conversion_goal.resource_name") &&
          q.includes("WHERE customer_conversion_goal.resource_name"),
      ),
    ).toBe(true);
    expect(
      p.checks.some((c) => c.query.includes("customerConversionGoals/13~2")),
    ).toBe(true);
  });
  it("does not invent category IDs from JSON enum names", () => {
    const providerGoal = {
      ...goal(),
      resourceName: `${prefix}/customerConversionGoals/123~456`,
    };
    expect(
      stage0CampaignGoalResource(
        account,
        `${prefix}/campaigns/-2`,
        providerGoal,
      ),
    ).toBe(`${prefix}/campaignConversionGoals/-2~123~456`);
  });
  it.each([
    undefined,
    `${prefix}/customerConversionGoals/SUBMIT_LEAD_FORM~WEBSITE`,
    `${prefix}/customerConversionGoals/13`,
    `${prefix}/customerConversionGoals/13~2~4`,
    `${prefix}/customerConversionGoals/-13~2`,
    `${prefix}/customerConversionGoals/013~2`,
    `${prefix}/customerConversionGoals/13~0`,
    `${prefix}/customerConversionGoals/9999999999~2`,
    `customers/1111111111/customerConversionGoals/13~2`,
  ])(
    "missing/foreign/malformed canonical suffix rejects without guessing %#",
    async (resourceName) => {
      const f = mock();
      f.state.goals = [{ ...goal(), resourceName }];
      await expect(f.build()).rejects.toMatchObject({
        writeCode: "google_conversion_goal_invalid",
      });
      expect(
        f.read.mock.calls.some(([q]) =>
          q.includes("WHERE customer_conversion_goal.resource_name"),
        ),
      ).toBe(false);
    },
  );
  it.each(["UNKNOWN", "UNSPECIFIED", undefined, "website", "bad'name"])(
    "invalid semantic origin %s rejects",
    async (origin) => {
      const f = mock();
      f.state.goals = [{ ...goal(), origin }];
      await expect(f.build()).rejects.toMatchObject({
        writeCode: "google_conversion_goal_invalid",
      });
    },
  );
  it.each(
    [
      [{ ...goal(), category: "PURCHASE" }],
      [{ ...goal(), origin: "APP" }],
      [{ ...goal(), resourceName: `${prefix}/customerConversionGoals/4~2` }],
      [],
      [goal(), goal()],
    ].map((confirmed) => ({ confirmed })),
  )(
    "independent canonical reread mismatch/absence/ambiguity rejects %#",
    async ({ confirmed }) => {
      const f = mock();
      f.state.confirmed = confirmed;
      await expect(f.build()).rejects.toMatchObject({
        writeCode: "google_conversion_goal_invalid",
      });
    },
  );
  it("selected action/goal category mismatch fails closed", async () => {
    const f = mock();
    f.state.selectedCategory = "PURCHASE";
    await expect(f.build()).rejects.toMatchObject({
      writeCode: "google_conversion_invalid",
    });
  });
  it.each(
    [
      [goal(), goal()],
      [
        goal(),
        { ...goal(), resourceName: `${prefix}/customerConversionGoals/23~2` },
      ],
      [goal(), { ...goal(), category: "PURCHASE" }],
    ].map((goals) => ({ goals })),
  )("duplicate resource or semantic mapping rejects %#", async ({ goals }) => {
    const f = mock();
    f.state.goals = goals;
    await expect(f.build()).rejects.toMatchObject({
      writeCode: "google_conversion_goal_invalid",
    });
  });
  it("no selected goals does not invent or emit goal operations", async () => {
    const f = mock();
    delete (f.brief as JsonRow).conversion_actions;
    f.state.goals = [
      { category: "SUBMIT_LEAD_FORM", origin: "WEBSITE", biddable: true },
    ];
    const p = await f.build();
    expect(p.operations.some((o) => o.kind === "campaignConversionGoal")).toBe(
      false,
    );
  });
  it("canonical goal reread resolves temporary campaign and verifies category/origin/association", async () => {
    const f = mock(),
      full = await f.build(),
      op = full.operations.find((o) => o.kind === "campaignConversionGoal")!,
      tempCampaign = `${prefix}/campaigns/-2`,
      actualCampaign = `${prefix}/campaigns/900`,
      actualGoal = `${prefix}/campaignConversionGoals/900~13~2`;
    // Focus the verifier on the campaign and goal, retaining real provider identities.
    const campaign = full.operations.find((o) => o.kind === "campaign")!;
    const p: Stage0Plan = {
      ...full,
      operations: [campaign, op],
      items: [full.items[campaign.row]!, full.items[op.row]!],
    };
    const entity: JsonRow = {
      resourceName: actualGoal,
      campaign: actualCampaign,
      category: "SUBMIT_LEAD_FORM",
      origin: "WEBSITE",
      biddable: true,
    };
    const results: Stage1MutationResult[] = [
      { success: true, resource_name: actualCampaign, error: null },
      { success: true, resource_name: actualGoal, error: null },
    ];
    const read = vi.fn<Stage1Reader>(async (q) =>
      q.includes("FROM campaign_conversion_goal")
        ? [{ campaignConversionGoal: entity }]
        : [
            {
              campaign: {
                ...campaign.expected,
                resourceName: actualCampaign,
                biddingStrategyType: "MANUAL_CPC",
              },
            },
          ],
    );
    expect((await verifyStage0Mutation(p, results, read)).status).toBe(
      "VERIFIED",
    );
    expect(read.mock.calls.every(([q]) => !q.includes(tempCampaign))).toBe(
      true,
    );
    for (const [key, value] of [
      ["category", "PURCHASE"],
      ["origin", "APP"],
      ["campaign", `${prefix}/campaigns/901`],
    ] as const) {
      const before = entity[key];
      entity[key] = value;
      expect((await verifyStage0Mutation(p, results, read)).status).toBe(
        "UNVERIFIED",
      );
      entity[key] = before;
    }
  });
});

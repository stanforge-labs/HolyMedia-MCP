import { describe, expect, it } from "vitest";
import {
  makeIsolatedGBrief,
  assertIsolatedGPlan,
} from "../../../../scripts/google-live-acceptance/stage234/g-isolated-contract.mjs";
import {
  buildStage0Plan,
  stage0ProviderOperations,
} from "./google-ads-stage0.js";
import { buildStage2Plan } from "./google-ads-stage2.js";
const account = "8590146099",
  prefix = `customers/${account}`;
describe("G isolated proposal against actual typed builders: MOCK only", () => {
  it("exact 7-op stock atomic graph has explicit keyword CPC and every delivery leaf PAUSED", async () => {
    const calls: string[] = [];
    const geo = {
      resourceName: "geoTargetConstants/9235214",
      id: "9235214",
      name: "Almaty",
      canonicalName: "Almaty,Kazakhstan",
      countryCode: "KZ",
      status: "ENABLED",
      targetType: "City",
    };
    const read = async (q: string) => {
      calls.push(q);
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
      if (q.includes("FROM geo_target_constant"))
        return [{ geoTargetConstant: geo }];
      if (q.includes("FROM language_constant"))
        return [
          {
            languageConstant: {
              resourceName: "languageConstants/1031",
              id: "1031",
              name: "Russian",
              code: "ru",
              targetable: true,
            },
          },
        ];
      if (q.includes(" FROM customer"))
        return [
          {
            customer: {
              resourceName: prefix,
              id: account,
              currencyCode: "USD",
              timeZone: "Asia/Almaty",
              testAccount: true,
            },
          },
        ];
      return [];
    };
    const plan = await buildStage0Plan(
      account,
      makeIsolatedGBrief("20261011T170000Z"),
      read,
      async () => [{ geoTargetConstant: geo }],
    );
    expect(assertIsolatedGPlan(plan)).toBe(true);
    expect(stage0ProviderOperations(plan)).toHaveLength(7);
    expect(calls.every((q) => q.startsWith("SELECT "))).toBe(true);
    for (const kind of ["campaign", "adGroup", "adGroupCriterion", "adGroupAd"])
      expect(plan.operations.find((o) => o.kind === kind)!.fields.status).toBe(
        "PAUSED",
      );
  });
  it("G actual +10% builder emits automatic bidding warning from provider context, no inherited CPC guess", async () => {
    const c = {
        id: "901",
        resourceName: `${prefix}/campaigns/901`,
        name: "new TEST",
        status: "PAUSED",
        biddingStrategyType: "TARGET_SPEND",
        advertisingChannelType: "SEARCH",
      },
      g = {
        id: "902",
        resourceName: `${prefix}/adGroups/902`,
        campaign: c.resourceName,
        status: "PAUSED",
        cpcBidMicros: "100000",
      },
      k = {
        criterionId: "903",
        resourceName: `${prefix}/adGroupCriteria/902~903`,
        adGroup: g.resourceName,
        status: "PAUSED",
        type: "KEYWORD",
        negative: false,
        cpcBidMicros: "100000",
        effectiveCpcBidMicros: "100000",
        effectiveCpcBidSource: "AD_GROUP_CRITERION",
        keyword: { text: "test automatic bidding warning", matchType: "EXACT" },
      };
    const read = async (q: string) => {
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
      if (q.includes("FROM ad_group_criterion"))
        return [{ campaign: c, adGroup: g, adGroupCriterion: k }];
      if (q.includes("FROM ad_group")) return [{ campaign: c, adGroup: g }];
      if (q.includes("FROM campaign")) return [{ campaign: c }];
      if (q.includes("FROM customer"))
        return [
          {
            customer: {
              id: account,
              resourceName: prefix,
              currencyCode: "USD",
            },
          },
        ];
      return [];
    };
    const raw = {
      action: "bid_budget_update",
      items: [
        {
          field: "keyword_cpc",
          campaign_id: "901",
          ad_group_id: "902",
          criterion_id: "903",
          change: { mode: "percent", percent: "10", currency: "USD" },
        },
      ],
    };
    const plan = await buildStage2Plan(account, raw, read);
    expect(plan.operations[0]!.fields.cpcBidMicros).toBe("110000");
    expect(JSON.stringify(plan.items[0]!.warnings)).toMatch(
      /автомат|automated|automatic/i,
    );
    delete (k as Partial<typeof k>).cpcBidMicros;
    await expect(buildStage2Plan(account, raw, read)).rejects.toBeDefined();
  });
});

import { describe, expect, it } from "vitest";
import { loadConfig } from "@holymedia/config";
import {
  assertExtendedGate,
  assertExtendedPlan,
  decodeExtendedMutation,
  extOwner,
  extClosed,
  extRead,
  extContains,
  rereadExtendedChecks,
  verifyExtendedMutation,
  extendedProviderOperation,
  extItem,
  replaceExtendedTemps,
  type ExtendedPlan,
} from "./google-ads-extended-plan.js";
const account = "1234567890",
  prefix = `customers/${account}`;
function plan(): ExtendedPlan {
  const entity = {
    resourceName: `${prefix}/campaigns/1`,
    name: "old",
    status: "PAUSED",
    trackingUrlTemplate: "https://example.test/{lpurl}",
  };
  const item = extItem(0, "rename", "1");
  item.before = entity;
  item.after = { ...entity, name: "new" };
  item.provider_operations = [0];
  return {
    version: 4,
    account_id: account,
    intent: {
      action: "campaign_update",
      items: [{ campaign_id: "1", name: "new" }],
    },
    checks: [
      {
        query: "SELECT customer.id FROM customer",
        rows: [{ customer: { id: account } }],
      },
      {
        query:
          "SELECT campaign.resource_name, campaign.name, campaign.status, campaign.tracking_url_template FROM campaign WHERE campaign.id = 1",
        rows: [{ campaign: entity }],
      },
    ],
    operations: [
      {
        kind: "campaigns",
        method: "update",
        resource_name: entity.resourceName,
        fields: { resourceName: entity.resourceName, name: "new" },
        update_mask: "name",
        before: entity,
        expected: { ...entity, name: "new" },
        row: 0,
        read_query:
          "SELECT campaign.resource_name, campaign.name, campaign.status, campaign.tracking_url_template FROM campaign WHERE campaign.id = 1",
        response_key: "campaign",
      },
    ],
    items: [item],
    atomic: false,
    irreversible: false,
  };
}
describe("Google extension immutable plan primitives (mock reads only)", () => {
  it("ad-group device modifier uses the real v24 mutate operation and ownership", () => {
    const p = plan();
    p.operations[0] = {
      ...p.operations[0]!,
      kind: "adGroupBidModifiers",
      resource_name: `${prefix}/adGroupBidModifiers/10~11`,
      fields: {
        resourceName: `${prefix}/adGroupBidModifiers/10~11`,
        bidModifier: 1.1,
      },
      update_mask: "bid_modifier",
      response_key: "adGroupBidModifier",
    };
    expect(() => assertExtendedPlan(p, account)).not.toThrow();
    expect(extendedProviderOperation(p.operations[0]!)).toHaveProperty(
      "adGroupBidModifierOperation.update.bidModifier",
      1.1,
    );
    p.operations[0]!.resource_name = "customers/999/adGroupBidModifiers/10~11";
    expect(() => assertExtendedPlan(p, account)).toThrow(/Resource/);
  });
  it("temporary goal config update requires exact new campaign in the same atomic graph", () => {
    const p = plan();
    p.atomic = true;
    const campaign = `${prefix}/campaigns/-1`;
    p.operations[0] = {
      ...p.operations[0]!,
      method: "create",
      resource_name: campaign,
      fields: { resourceName: campaign, status: "PAUSED" },
      expected: { resourceName: campaign, status: "PAUSED" },
      before: null,
      update_mask: null,
    };
    p.operations.push({
      ...p.operations[0]!,
      kind: "conversionGoalCampaignConfigs",
      method: "update",
      resource_name: `${prefix}/conversionGoalCampaignConfigs/-1`,
      fields: {
        resourceName: `${prefix}/conversionGoalCampaignConfigs/-1`,
        goalConfigLevel: "CAMPAIGN",
      },
      expected: { campaign, goalConfigLevel: "CAMPAIGN" },
      update_mask: "goal_config_level",
      response_key: "conversionGoalCampaignConfig",
    });
    expect(() => assertExtendedPlan(p, account)).not.toThrow();
    p.operations[1]!.expected.campaign = `${prefix}/campaigns/-2`;
    expect(() => assertExtendedPlan(p, account)).toThrow(/Resource/);
    p.operations[1]!.expected.campaign = campaign;
    p.atomic = false;
    expect(() => assertExtendedPlan(p, account)).toThrow();
  });
  it("arbitrary negative update IDs do not bypass existing-resource guards", () => {
    const p = plan();
    p.atomic = true;
    p.operations[0]!.resource_name = `${prefix}/campaigns/-1`;
    p.operations[0]!.fields.resourceName = p.operations[0]!.resource_name;
    expect(() => assertExtendedPlan(p, account)).toThrow(/Resource/);
  });
  it.each([
    ["TARGET_SPEND", "targetSpend", "cpcBidCeilingMicros"],
    ["MAXIMIZE_CONVERSIONS", "maximizeConversions", "targetCpaMicros"],
    ["TARGET_CPA", "targetCpa", "cpcBidCeilingMicros"],
    ["TARGET_ROAS", "targetRoas", "cpcBidFloorMicros"],
  ])(
    "clear optional %s limit normalizes only an independently proven zero",
    async (type, scheme, field) => {
      const p = plan();
      p.version = 5;
      const expected = {
        ...p.operations[0]!.expected,
        biddingStrategyType: type,
        [scheme]: { [field]: "0" },
      };
      p.operations[0]!.expected = expected;
      const result = [
        {
          success: true,
          resource_name: p.operations[0]!.resource_name,
          error: null,
        },
      ];
      const read = async (q: string) =>
        q.includes("FROM customer")
          ? p.checks[0]!.rows
          : [{ campaign: { ...expected, [scheme]: {} } }];
      expect((await verifyExtendedMutation(p, result, read)).status).toBe(
        "VERIFIED",
      );
      expect(
        (
          await verifyExtendedMutation(p, result, async (q) =>
            q.includes("FROM customer")
              ? p.checks[0]!.rows
              : [
                  {
                    campaign: {
                      ...expected,
                      biddingStrategyType: "OTHER",
                      [scheme]: {},
                    },
                  },
                ],
          )
        ).status,
      ).toBe("NOT_VERIFIED");
      expect(
        (
          await verifyExtendedMutation(p, result, async (q) =>
            q.includes("FROM customer")
              ? p.checks[0]!.rows
              : [{ campaign: { ...expected, [scheme]: { [field]: "100" } } }],
          )
        ).status,
      ).toBe("NOT_VERIFIED");
    },
  );
  it("mandatory target CPA zero is never globally normalized", async () => {
    const p = plan();
    p.operations[0]!.expected = {
      ...p.operations[0]!.expected,
      biddingStrategyType: "TARGET_CPA",
      targetCpa: { targetCpaMicros: "0" },
    };
    const actual = { ...p.operations[0]!.expected, targetCpa: {} };
    expect(
      (
        await verifyExtendedMutation(
          p,
          [
            {
              success: true,
              resource_name: p.operations[0]!.resource_name,
              error: null,
            },
          ],
          async (q) =>
            q.includes("FROM customer")
              ? p.checks[0]!.rows
              : [{ campaign: actual }],
        )
      ).status,
    ).toBe("NOT_VERIFIED");
  });
  it("temporary -1 never corrupts -10/-11 refs or user text", () => {
    const refs = new Map(
      Array.from({ length: 12 }, (_, i) => [
        `${prefix}/assets/-${i + 1}`,
        `${prefix}/assets/${500 + i}`,
      ]),
    );
    const input = {
      refs: [...refs.keys()],
      label: `Budget mentions ${prefix}/assets/-1`,
      query: `SELECT asset.resource_name FROM asset WHERE asset.resource_name IN (${[...refs.keys()].map((k) => `'${k}'`).join(",")})`,
    };
    const actual = replaceExtendedTemps(input, refs) as typeof input;
    expect(actual.refs).toEqual([...refs.values()]);
    expect(actual.label).toBe(input.label);
    expect(actual.query).toContain(`'${prefix}/assets/509'`);
    expect(actual.query).not.toContain("/-");
  });
  it("CREATE inventory verification retains unchanged sibling ads", async () => {
    const p = plan(),
      old = { resourceName: `${prefix}/adGroupAds/10~1`, status: "PAUSED" },
      created = { resourceName: `${prefix}/adGroupAds/10~2`, status: "PAUSED" };
    const query =
      "SELECT ad_group_ad.resource_name, ad_group_ad.status FROM ad_group_ad";
    p.checks = [p.checks[0]!, { query, rows: [{ adGroupAd: old }] }];
    p.operations = [
      {
        ...p.operations[0]!,
        kind: "adGroupAds",
        method: "create",
        resource_name: null,
        before: null,
        fields: { status: "PAUSED" },
        expected: { status: "PAUSED" },
        read_query: query,
        response_key: "adGroupAd",
      },
    ];
    const result = [
      { success: true, resource_name: created.resourceName, error: null },
    ];
    const reread = async (q: string) =>
      q.includes("FROM customer")
        ? p.checks[0]!.rows
        : [{ adGroupAd: old }, { adGroupAd: created }];
    expect((await verifyExtendedMutation(p, result, reread)).status).toBe(
      "VERIFIED",
    );
    const changed = await verifyExtendedMutation(p, result, async (q) =>
      q.includes("FROM customer")
        ? p.checks[0]!.rows
        : [
            { adGroupAd: { ...old, status: "ENABLED" } },
            { adGroupAd: created },
          ],
    );
    expect(changed.context_verified).toBe(false);
    expect(changed.status).toBe("NOT_VERIFIED");
  });
  it("nested Ad updates do not discard parent status protection", async () => {
    const p = plan(),
      resource = `${prefix}/ads/3`,
      oldAd = {
        resourceName: resource,
        finalUrls: ["https://example.test/old"],
      },
      query =
        "SELECT ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.resource_name, ad_group_ad.ad.final_urls FROM ad_group_ad";
    const old = {
      resourceName: `${prefix}/adGroupAds/10~3`,
      status: "PAUSED",
      ad: oldAd,
    };
    p.checks = [p.checks[0]!, { query, rows: [{ adGroupAd: old }] }];
    p.operations = [
      {
        ...p.operations[0]!,
        kind: "ads",
        resource_name: resource,
        fields: {
          resourceName: resource,
          finalUrls: ["https://example.test/new"],
        },
        before: oldAd,
        expected: {
          resourceName: resource,
          finalUrls: ["https://example.test/new"],
        },
        read_query: query,
        response_key: "adGroupAd.ad",
      },
    ];
    const results = [{ success: true, resource_name: resource, error: null }];
    expect(
      (
        await verifyExtendedMutation(p, results, async (q) =>
          q.includes("FROM customer")
            ? p.checks[0]!.rows
            : [{ adGroupAd: { ...old, ad: p.operations[0]!.expected } }],
        )
      ).status,
    ).toBe("VERIFIED");
    expect(
      (
        await verifyExtendedMutation(p, results, async (q) =>
          q.includes("FROM customer")
            ? p.checks[0]!.rows
            : [
                {
                  adGroupAd: {
                    ...old,
                    status: "ENABLED",
                    ad: p.operations[0]!.expected,
                  },
                },
              ],
        )
      ).status,
    ).toBe("NOT_VERIFIED");
  });
  it("portfolio attach expected N to N+1 consumers, not arbitrary topology", async () => {
    const p = plan();
    p.version = 5;
    const consumer = {
      resourceName: `${prefix}/campaigns/2`,
      id: "2",
      biddingStrategy: `${prefix}/biddingStrategies/10`,
    };
    const inventory =
      "SELECT campaign.resource_name, campaign.id, campaign.bidding_strategy FROM campaign WHERE campaign.bidding_strategy = 'customers/1234567890/biddingStrategies/10'";
    p.operations[0]!.expected = {
      ...p.operations[0]!.before,
      biddingStrategy: consumer.biddingStrategy,
    };
    p.checks.push({ query: inventory, rows: [{ campaign: consumer }] });
    const results = [
      {
        success: true,
        resource_name: p.operations[0]!.resource_name,
        error: null,
      },
    ];
    const read = async (q: string) =>
      q === inventory
        ? [{ campaign: consumer }, { campaign: p.operations[0]!.expected }]
        : q.includes("FROM customer")
          ? p.checks[0]!.rows
          : [{ campaign: p.operations[0]!.expected }];
    expect((await verifyExtendedMutation(p, results, read)).status).toBe(
      "VERIFIED",
    );
    expect(
      (
        await verifyExtendedMutation(p, results, async (q) =>
          q === inventory
            ? [
                ...(await read(q)),
                {
                  campaign: {
                    ...consumer,
                    resourceName: `${prefix}/campaigns/3`,
                    id: "3",
                  },
                },
              ]
            : read(q),
        )
      ).status,
    ).toBe("NOT_VERIFIED");
  });
  it("verified poststate preserves raw protobuf omissions for inverse stale comparison", async () => {
    const p = plan();
    p.operations[0]!.expected = {
      ...p.operations[0]!.expected,
      biddingStrategyType: "MANUAL_CPC",
      manualCpc: { enhancedCpcEnabled: false },
    };
    const raw = { ...p.operations[0]!.expected };
    delete raw.manualCpc;
    const result = await verifyExtendedMutation(
      p,
      [
        {
          success: true,
          resource_name: p.operations[0]!.resource_name,
          error: null,
        },
      ],
      async (q) =>
        q.includes("FROM customer") ? p.checks[0]!.rows : [{ campaign: raw }],
    );
    expect(result.status).toBe("VERIFIED");
    expect(result.actual[0]).toEqual(raw);
    expect(
      (
        await verifyExtendedMutation(
          p,
          [
            {
              success: true,
              resource_name: p.operations[0]!.resource_name,
              error: null,
            },
          ],
          async (q) =>
            q.includes("FROM customer")
              ? p.checks[0]!.rows
              : [{ campaign: { ...raw, biddingStrategyType: "TARGET_CPA" } }],
        )
      ).status,
    ).toBe("NOT_VERIFIED");
  });
  it("Google policy details retain code/field and sanitize provider text", () => {
    const p = plan();
    const payload = {
      partialFailureError: {
        code: 3,
        details: [
          {
            errors: [
              {
                errorCode: { policyFindingError: "POLICY_FINDING" },
                message: "Restricted copy. Bearer fixture-data",
                location: {
                  fieldPathElements: [
                    { fieldName: "mutateOperations", index: 0 },
                  ],
                },
              },
            ],
          },
        ],
      },
    };
    const result = decodeExtendedMutation(payload, p, true);
    expect(result[0]!.error?.google_details?.[0]?.google_code).toBe(
      "POLICY_FINDING",
    );
    expect(result[0]!.error?.google_details?.[0]?.message).toContain(
      "[redacted]",
    );
    expect(result[0]!.error?.google_details?.[0]?.message).not.toContain(
      "fixture-data",
    );
  });
  it("stage3/4 gates defaultOFF and foundation allowlist failclosed", () => {
    for (const version of [3, 4, 5] as const)
      expect(() =>
        assertExtendedGate(loadConfig({ NODE_ENV: "test" }), account, version),
      ).toThrow();
  });
  it("eachstagegate andv24required independently", () => {
    const c = loadConfig({
      NODE_ENV: "test",
      PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
      GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: account,
      PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true",
    });
    expect(() => assertExtendedGate(c, account, 4)).not.toThrow();
    expect(() => assertExtendedGate(c, account, 3)).toThrow(/выключен/);
    expect(() =>
      assertExtendedGate({ ...c, providerGoogleApiVersion: "v23" }, account, 4),
    ).toThrow(/v24/);
    expect(() => assertExtendedGate(c, "9999999999", 4)).toThrow();
  });
  it("canonicalcustomerresource valid, foreigncustomer fails", () => {
    expect(extOwner(prefix, account, "customers")).toBe(prefix);
    expect(() =>
      extOwner("customers/9999999999", account, "customers"),
    ).toThrow();
  });
  it("closedruntime rejectsrawGoogleandextraobjects", () => {
    expect(() =>
      extClosed({ name: "x", request: {} }, ["name"], ["name"]),
    ).toThrow();
    expect(() => extClosed([], ["name"])).toThrow();
  });
  it("mask path1 allowed; maskinjection rejected", () => {
    const p = plan();
    p.operations[0]!.update_mask =
      "responsive_search_ad.path1,responsive_search_ad.path2";
    expect(() => assertExtendedPlan(p, account)).not.toThrow();
    p.operations[0]!.update_mask = "name;DROP";
    expect(() => assertExtendedPlan(p, account)).toThrow();
  });
  it("batchlimit and duplicateidentities rejected before mutation", () => {
    const p = plan();
    p.operations.push({ ...p.operations[0]! });
    expect(() => assertExtendedPlan(p, account)).toThrow(/несколько/);
    p.operations = Array.from({ length: 501 }, () => ({ ...p.operations[0]! }));
    expect(() => assertExtendedPlan(p, account)).toThrow();
  });
  it("foreignresource rejectswholedangerousmixedbatch", () => {
    const p = plan();
    p.operations[0]!.resource_name = "customers/9999999999/campaigns/1";
    expect(() => assertExtendedPlan(p, account)).toThrow(/customer/);
  });
  it("campaign/group/RSAcreate ENAforbidden", () => {
    for (const kind of ["campaigns", "adGroups", "adGroupAds"] as const) {
      const p = plan();
      p.operations[0] = {
        ...p.operations[0]!,
        kind,
        method: "create",
        resource_name: null,
        fields: { status: "ENABLED" },
      };
      expect(() => assertExtendedPlan(p, account)).toThrow(/PAUSED/);
    }
  });
  it("account creation/removal never allowed", () => {
    const p = plan();
    p.irreversible = true;
    p.operations[0] = {
      ...p.operations[0]!,
      kind: "customers",
      method: "remove",
      resource_name: prefix,
    };
    expect(() => assertExtendedPlan(p, account)).toThrow(/аккаунта/);
  });
  it("remove needsirreversibleflag;tempdependency needsatomic", () => {
    const p = plan();
    p.operations[0]!.method = "remove";
    expect(() => assertExtendedPlan(p, account)).toThrow(/необратимым/);
    p.operations[0]!.method = "create";
    p.operations[0]!.fields = {
      status: "PAUSED",
      resourceName: `${prefix}/campaigns/-1`,
    };
    p.operations[0]!.resource_name = `${prefix}/campaigns/-1`;
    expect(() => assertExtendedPlan(p, account)).toThrow(/atomic/);
    p.atomic = true;
    expect(() => assertExtendedPlan(p, account)).not.toThrow();
  });
  it("customaudiencescannotmixed service/partialfailure", () => {
    const p = plan();
    p.operations[0] = {
      ...p.operations[0]!,
      kind: "customAudiences",
      resource_name: `${prefix}/customAudiences/1`,
      fields: { resourceName: `${prefix}/customAudiences/1`, name: "new" },
    };
    expect(() => assertExtendedPlan(p, account)).toThrow(
      /CustomAudienceService/,
    );
    p.atomic = true;
    expect(() => assertExtendedPlan(p, account)).not.toThrow();
    p.operations.push({ ...plan().operations[0]! });
    expect(() => assertExtendedPlan(p, account)).toThrow(/смешивать/);
  });
  it("validateemptyJSONsuccess noresources, malformedfails", () => {
    expect(decodeExtendedMutation({}, plan(), true)[0]!.success).toBe(true);
    expect(decodeExtendedMutation(null, plan(), true)[0]!.success).toBe(false);
    expect(
      decodeExtendedMutation({}, plan(), false)[0]!.error?.google_code,
    ).toBe("OUTCOME_UNCERTAIN");
  });
  it("resourceownership andexpected identity validatedinmutateresponse", () => {
    const p = plan();
    const ok = {
      mutateOperationResponses: [
        { campaignResult: { resourceName: p.operations[0]!.resource_name } },
      ],
    };
    expect(decodeExtendedMutation(ok, p, false)[0]!.success).toBe(true);
    ok.mutateOperationResponses[0]!.campaignResult.resourceName =
      "customers/9999999999/campaigns/1";
    expect(decodeExtendedMutation(ok, p, false)[0]!.success).toBe(false);
  });
  it("partialfailureindex retainsGooglecode notHolyMediafake", () => {
    const p = plan();
    p.operations.push({
      ...p.operations[0]!,
      resource_name: `${prefix}/campaigns/2`,
    });
    const d = decodeExtendedMutation(
      {
        mutateOperationResponses: [
          { campaignResult: { resourceName: p.operations[0]!.resource_name } },
          {},
        ],
        partialFailureError: {
          code: 3,
          details: [
            {
              errors: [
                {
                  errorCode: { campaignError: "RESOURCE_NOT_FOUND" },
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
    expect(d[0]!.success).toBe(true);
    expect(d[1]!.error?.google_code).toBe("RESOURCE_NOT_FOUND");
    p.atomic = true;
    expect(
      decodeExtendedMutation(
        { partialFailureError: { code: 3 } },
        p,
        true,
      ).every((x) => !x.success),
    ).toBe(true);
  });
  it("canonical snapshot order stable, inventory cannot truncate", async () => {
    const r = async () => [
      { customer: { id: "2" } },
      { customer: { id: "1" } },
    ];
    expect((await extRead(r, "SELECT customer.id FROM customer"))[0]).toEqual({
      customer: { id: "1" },
    });
    await expect(
      extRead(async () => Array.from({ length: 5001 }, () => ({})), "SELECT x"),
    ).rejects.toThrow(/5000/);
    expect((await rereadExtendedChecks(plan(), r)).length).toBe(2);
  });
  it("fullselectedneighborstate verified, notonly changedfield", async () => {
    const p = plan(),
      r = [
        {
          success: true,
          resource_name: p.operations[0]!.resource_name,
          error: null,
        },
      ];
    const read = async (q: string) =>
      q.includes("FROM customer")
        ? p.checks[0]!.rows
        : [{ campaign: { ...p.operations[0]!.expected } }];
    expect((await verifyExtendedMutation(p, r, read)).status).toBe("VERIFIED");
    expect(
      (
        await verifyExtendedMutation(p, r, async (q) =>
          q.includes("FROM customer")
            ? p.checks[0]!.rows
            : [
                {
                  campaign: { ...p.operations[0]!.expected, status: "ENABLED" },
                },
              ],
        )
      ).status,
    ).toBe("NOT_VERIFIED");
  });
  it("missingreread/foreignresource/parentchange neververified", async () => {
    const p = plan(),
      r = [
        {
          success: true,
          resource_name: p.operations[0]!.resource_name,
          error: null,
        },
      ];
    expect((await verifyExtendedMutation(p, r, async () => [])).status).toBe(
      "NOT_VERIFIED",
    );
    expect(
      (
        await verifyExtendedMutation(p, r, async (q) =>
          q.includes("FROM customer")
            ? [{ customer: { id: "different" } }]
            : [{ campaign: p.operations[0]!.expected }],
        )
      ).status,
    ).toBe("NOT_VERIFIED");
  });
  it("removalreread acceptsREMOVEDorabsent only", async () => {
    const p = plan();
    p.irreversible = true;
    p.operations[0]!.method = "remove";
    p.operations[0]!.expected = {};
    const r = [
      {
        success: true,
        resource_name: p.operations[0]!.resource_name,
        error: null,
      },
    ];
    const read = async (q: string) =>
      q.includes("FROM customer")
        ? p.checks[0]!.rows
        : [{ campaign: { ...p.operations[0]!.before, status: "REMOVED" } }];
    expect((await verifyExtendedMutation(p, r, read)).status).toBe("VERIFIED");
  });
  it("nestedAd reread path andprovider mask mapping correct", async () => {
    const p = plan(),
      resource = `${prefix}/ads/9`;
    p.operations[0] = {
      ...p.operations[0]!,
      kind: "ads",
      resource_name: resource,
      fields: {
        resourceName: resource,
        finalUrls: ["https://example.test/new"],
      },
      expected: {
        resourceName: resource,
        finalUrls: ["https://example.test/new"],
      },
      read_query: "SELECT ad_group_ad.ad.resource_name FROM ad_group_ad",
      response_key: "adGroupAd.ad",
    };
    p.checks = p.checks.slice(0, 1);
    expect(
      (
        await verifyExtendedMutation(
          p,
          [{ success: true, resource_name: resource, error: null }],
          async (q) =>
            q.includes("FROM customer")
              ? p.checks[0]!.rows
              : [{ adGroupAd: { ad: p.operations[0]!.expected } }],
        )
      ).status,
    ).toBe("VERIFIED");
    expect(extendedProviderOperation(p.operations[0]!)).toHaveProperty(
      "adOperation.update.resourceName",
      resource,
    );
  });
  it("contains requiresarraylength, knownneighborvaluesandnestedfields", () => {
    expect(extContains({ a: { b: 1 }, server: "x" }, { a: { b: 1 } })).toBe(
      true,
    );
    expect(extContains({ a: [1, 2] }, { a: [1] })).toBe(false);
    expect(extContains({ a: { b: 2 } }, { a: { b: 1 } })).toBe(false);
  });
});

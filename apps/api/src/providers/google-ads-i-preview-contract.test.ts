import { afterEach, it, expect, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { GoogleAdsAdapter } from "./adapters/google.ads.js";
import { type ExtendedPlan } from "./google-ads-extended-plan.js";
import { stage3ToolIntent } from "../mcp/mcp-google-stage3-schema.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it.each(["preview", "commit"])(
  "actual stock I Stage3 %s transport and provider verifier preserve the atomic OBSERVATION graph (mock only)",
  async (phase) => {
    const g = await import(
      new URL(
        "../../../../scripts/google-live-acceptance/stage234/audience-preview-guard.mjs",
        import.meta.url,
      ).href
    );
    const prefix = "customers/8590146099";
    const tool = {
      name: "google_ads_targeting_preview",
      arguments: {
        provider: "GOOGLE_ADS",
        account_id: "8590146099",
        items: [
          {
            operation: "audience_add",
            level: "AD_GROUP",
            campaign_id: "24324170853",
            ad_group_id: "206587491811",
            audience: { kind: "AFFINITY", id: "90100" },
            mode: "OBSERVATION",
          },
        ],
      },
    };
    const queries = g.stage3Queries(tool),
      readQueries: string[] = [];
    const customer = {
      resourceName: prefix,
      id: "8590146099",
      currencyCode: "USD",
      timeZone: "Asia/Almaty",
    };
    const campaign = {
      resourceName: prefix + "/campaigns/24324170853",
      id: "24324170853",
      status: "PAUSED",
      name: "fixture",
      advertisingChannelType: "SEARCH",
      biddingStrategyType: "MANUAL_CPC",
    };
    const group = {
      resourceName: prefix + "/adGroups/206587491811",
      id: "206587491811",
      campaign: campaign.resourceName,
      status: "PAUSED",
      name: "fixture",
    };
    const catalog = {
      resourceName: prefix + "/userInterests/90100",
      userInterestId: "90100",
      name: "Synthetic mock audience",
      taxonomyType: "AFFINITY",
      launchedToAll: true,
    };
    const existing = {
      resourceName: prefix + "/adGroupCriteria/206587491811~123456789",
      adGroup: group.resourceName,
      criterionId: "123456789",
      status: "ENABLED",
      type: "USER_LIST",
      userList: { userList: prefix + "/userLists/987654321" },
    };
    const created = {
      resourceName: prefix + "/adGroupCriteria/206587491811~827463920329",
      adGroup: group.resourceName,
      criterionId: "827463920329",
      status: "ENABLED",
      type: "USER_INTEREST",
      userInterest: { userInterestCategory: catalog.resourceName },
      // Google omits default negative=false. Verification must not rewrite raw data.
    };
    const env = {
      NODE_ENV: "test",
      PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
      PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true",
      GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
      PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: "4378327049",
      PROVIDER_GOOGLE_API_VERSION: "v24",
      V2_PREVIEW_ONLY: phase === "commit" ? "false" : "true",
      V2_CONFIRMED_WRITE_ENABLED: phase === "commit" ? "true" : "false",
    };
    let validations = 0,
      mutations = 0,
      committed = false;
    vi.stubGlobal(
      "fetch",
      async (input: string | URL, init: RequestInit = {}) => {
        const body = JSON.parse(String(init.body)),
          url = String(input);
        expect(new Headers(init.headers).get("login-customer-id")).toBe(
          "4378327049",
        );
        if (url.endsWith(":mutate")) {
          expect(url).toBe(
            "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:mutate",
          );
          expect(body).toEqual({
            ...g.assertPreparedI(plan, tool),
            validateOnly: body.validateOnly,
          });
          expect(body.partialFailure).toBe(false);
          expect(body.mutateOperations).toHaveLength(2);
          if (body.validateOnly === true) {
            validations++;
            return new Response("{}", { status: 200 });
          }
          expect(phase).toBe("commit");
          expect(body.validateOnly).toBe(false);
          mutations++;
          expect(mutations).toBe(1);
          committed = true;
          return new Response(
            JSON.stringify({
              mutateOperationResponses: [
                { adGroupResult: { resourceName: group.resourceName } },
                {
                  adGroupCriterionResult: {
                    resourceName: created.resourceName,
                  },
                },
              ],
            }),
            { status: 200 },
          );
        }
        expect(url).toBe(
          "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:searchStream",
        );
        readQueries.push(body.query);
        const rows =
          body.query === queries[0]
            ? [{ customer }]
            : body.query === queries[1]
              ? [{ campaign }]
              : body.query === queries[2]
                ? [
                    {
                      adGroup: committed
                        ? {
                            ...group,
                            targetingSetting: {
                              targetRestrictions: [
                                {
                                  targetingDimension: "AUDIENCE",
                                  bidOnly: true,
                                },
                              ],
                            },
                          }
                        : group,
                    },
                  ]
                : body.query === queries[3]
                  ? [{ userInterest: catalog }]
                  : body.query === queries[4]
                    ? [
                        { adGroupCriterion: existing },
                        ...(committed ? [{ adGroupCriterion: created }] : []),
                      ]
                    : null;
        if (!rows) throw Error("guard query mismatch");
        return new Response(JSON.stringify([{ results: rows }]), {
          status: 200,
        });
      },
    );
    const adapter = new GoogleAdsAdapter(loadConfig(env)),
      ctx = {
        accountId: "8590146099",
        loginCustomerId: "4378327049",
        credentials: {
          accessToken: "fixture-access",
          scopes: ["https://www.googleapis.com/auth/adwords"],
        },
      };
    const plan = (await adapter.extended(
      ctx,
      3,
      "build",
      stage3ToolIntent(tool.name, tool.arguments),
    )) as ExtendedPlan;
    expect(readQueries).toEqual(queries);
    expect(plan.operations).toHaveLength(2);
    expect(plan.operations[0]?.expected).toMatchObject({
      status: "PAUSED",
      targetingSetting: {
        targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: true }],
      },
    });
    expect(plan.items[0]?.after).toMatchObject({
      audience_mode: "OBSERVATION",
    });
    expect(plan.items[0]?.warnings.join(" ")).toMatch(/OBSERVATION/);
    expect(g.assertPreparedI(plan, tool)).toMatchObject({
      validateOnly: true,
      partialFailure: false,
    });
    expect(await adapter.extended(ctx, 3, "validate", plan)).toMatchObject([
      { success: true },
      { success: true },
    ]);
    expect(group).not.toHaveProperty("targetingSetting");
    if (phase === "preview") {
      await expect(
        adapter.extended(ctx, 3, "commit", plan),
      ).rejects.toMatchObject({
        writeCode: "confirmed_write_disabled",
      });
      expect(mutations).toBe(0);
    } else {
      const results = await adapter.extended(ctx, 3, "commit", plan);
      expect(results).toEqual([
        { success: true, resource_name: group.resourceName, error: null },
        { success: true, resource_name: created.resourceName, error: null },
      ]);
      const verified = await adapter.extended(
        ctx,
        3,
        "verify",
        plan,
        results as Parameters<GoogleAdsAdapter["extended"]>[4],
      );
      expect(verified).toMatchObject({
        status: "VERIFIED",
        context_verified: true,
        items: [
          {
            success: true,
            operations: [
              { success: true, error: null },
              { success: true, error: null },
            ],
          },
        ],
      });
      expect(created).not.toHaveProperty("negative");
      expect(existing).toMatchObject({
        status: "ENABLED",
        type: "USER_LIST",
        criterionId: "123456789",
      });
      expect(
        readQueries.filter((q) => q === queries[4]).length,
      ).toBeGreaterThanOrEqual(2);
      expect(mutations).toBe(1);
      existing.status = "PAUSED";
      expect(
        await adapter.extended(
          ctx,
          3,
          "verify",
          plan,
          results as Parameters<GoogleAdsAdapter["extended"]>[4],
        ),
      ).toMatchObject({ status: "NOT_VERIFIED", context_verified: false });
      expect(mutations).toBe(1);
    }
    expect(validations).toBe(1);
  },
);

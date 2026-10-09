import { afterEach, it, expect, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { GoogleAdsAdapter } from "./adapters/google.ads.js";
import { type ExtendedPlan } from "./google-ads-extended-plan.js";
import { stage3ToolIntent } from "../mcp/mcp-google-stage3-schema.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it("actual stock I Stage3 builder and validate payload match guard, with OBSERVATION explicit and zero real writes", async () => {
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
  const env = {
    NODE_ENV: "test",
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
    PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: "4378327049",
    PROVIDER_GOOGLE_API_VERSION: "v24",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
  };
  let validations = 0;
  vi.stubGlobal(
    "fetch",
    async (input: string | URL, init: RequestInit = {}) => {
      const body = JSON.parse(String(init.body)),
        url = String(input);
      expect(new Headers(init.headers).get("login-customer-id")).toBe(
        "4378327049",
      );
      if (url.endsWith(":mutate")) {
        validations++;
        expect(url).toBe(
          "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:mutate",
        );
        expect(body).toEqual(g.assertPreparedI(plan, tool));
        return new Response("{}", { status: 200 });
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
              ? [{ adGroup: group }]
              : body.query === queries[3]
                ? [{ userInterest: catalog }]
                : body.query === queries[4]
                  ? []
                  : null;
      if (!rows) throw Error("guard query mismatch");
      return new Response(JSON.stringify([{ results: rows }]), { status: 200 });
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
  expect(plan.items[0]?.after).toMatchObject({ audience_mode: "OBSERVATION" });
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
  await expect(adapter.extended(ctx, 3, "commit", plan)).rejects.toMatchObject({
    writeCode: "confirmed_write_disabled",
  });
  expect(validations).toBe(1);
});

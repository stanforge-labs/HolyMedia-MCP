import { createRequire } from "node:module";
import {
  restoreJTool,
  assertRestoreJPlan,
  classifyRestoreJ,
} from "./geo-restore-guard.mjs";
import {
  J_QUERIES,
  target,
  sourceHead,
  imageDigest,
} from "./geo-preview-guard.mjs";
const { tsImport } = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
)("tsx/esm/api");
export async function restoreFixture() {
  const campaign = `customers/${target.customer}/campaigns/${target.campaign}`,
    prefix = `customers/${target.customer}/campaignCriteria/${target.campaign}~`;
  const city = {
    resourceName: prefix + "9235214",
    campaign,
    type: "LOCATION",
    status: "ENABLED",
    negative: false,
    location: { geoTargetConstant: "geoTargetConstants/9235214" },
  };
  const actual = [
    {
      resourceName: prefix + "11",
      criterionId: "11",
      campaign,
      type: "LOCATION",
      status: "ENABLED",
      negative: true,
      location: { geoTargetConstant: "geoTargetConstants/9196209" },
    },
    {
      resourceName: prefix + "12",
      criterionId: "12",
      campaign,
      type: "PROXIMITY",
      status: "ENABLED",
      negative: false,
      proximity: {
        geoPoint: {
          latitudeInMicroDegrees: 43186900,
          longitudeInMicroDegrees: 76887000,
        },
        radius: 2,
        radiusUnits: "KILOMETERS",
      },
    },
  ];
  const origin = {
    result: "J add VERIFIED; restoration pending",
    journal: { result: "VERIFIED" },
    test_customer_id: target.customer,
    preview_id: "mock-preview",
    commit_id: "hmc_" + "a".repeat(43),
    created_criteria: actual.map((a, i) => ({
      criterion_id: String(11 + i),
      resource_name: a.resourceName,
      type: a.type,
      provider_state: a,
    })),
    commit: {
      status: "VERIFIED",
      preview_id: "mock-preview",
      commit_id: "hmc_" + "a".repeat(43),
      items: actual.map((a, i) => ({
        operations: [
          {
            operation: i,
            success: true,
            error: null,
            resource_name: a.resourceName,
            actual: a,
          },
        ],
      })),
    },
  };
  const { buildStage3Plan } = await tsImport(
    "../../../apps/api/src/providers/google-ads-stage3.ts",
    import.meta.url,
  );
  const reads = [];
  const plan = await buildStage3Plan(
    target.customer,
    { action: "targeting", items: restoreJTool(origin).arguments.items },
    async (q) => {
      reads.push(q);
      if (q === J_QUERIES.customer)
        return [
          {
            customer: {
              id: target.customer,
              resourceName: `customers/${target.customer}`,
              currencyCode: "USD",
              timeZone: "Asia/Almaty",
            },
          },
        ];
      if (q === J_QUERIES.campaign)
        return [
          {
            campaign: {
              resourceName: campaign,
              id: target.campaign,
              status: "PAUSED",
              advertisingChannelType: "SEARCH",
              biddingStrategyType: "MANUAL_CPC",
            },
          },
        ];
      if (q === J_QUERIES.locations)
        return [city, actual[0]].map((c) => ({ campaignCriterion: c }));
      if (q === J_QUERIES.proximity) return [{ campaignCriterion: actual[1] }];
      throw Error("unexpected mock query");
    },
  );
  const env = {
    STAGE234_SOURCE_HEAD: sourceHead,
    STAGE234_IMAGE_DIGEST: imageDigest,
    STAGE234_RUN_DIR: "/acceptance-state/stage234-j-restore-mock",
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "false",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.customer,
    PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: target.mcc,
    PROVIDER_GOOGLE_API_VERSION: "v24",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  };
  const proof = {
    customer_id: target.customer,
    mcc_id: target.mcc,
    test_account: true,
    hierarchy: true,
    currency: "USD",
    group_resource: target.groupResource,
    group_cpc_micros: "100000",
    fixture_paused: true,
    fixture_sha256: "a".repeat(64),
    source_head: sourceHead,
    verified_at: new Date().toISOString(),
  };
  return { origin, plan, env, proof, reads };
}

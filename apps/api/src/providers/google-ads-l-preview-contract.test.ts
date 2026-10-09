// Actual stock adapter + production builder against a guarded mock transport.
// No Google/VPS calls and no commit/approval; L LIVE remains pending.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { GoogleAdsAdapter } from "./adapters/google.ads.js";
import {
  type ExtendedPlan,
  extendedProviderOperation,
} from "./google-ads-extended-plan.js";
import { stage4ToolIntent } from "../mcp/mcp-google-stage4-schema.js";
const script = (name: string) =>
  new URL(
    "../../../../scripts/google-live-acceptance/stage234/" + name,
    import.meta.url,
  ).href;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
async function setup() {
  const guard = await import(script("rsa-preview-guard.mjs"));
  const scenario = await import(script("scenario-preparation.mjs"));
  const now = Date.now();
  const env = {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
    PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: "4378327049",
    PROVIDER_GOOGLE_API_VERSION: "v24",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
    STAGE234_GUARD_PRELOAD: "0",
    STAGE234_SOURCE_HEAD: "a".repeat(40),
    STAGE234_IMAGE_DIGEST: "sha256:" + "b".repeat(64),
  };
  const config = loadConfig({ ...env, NODE_ENV: "test" });
  const proof = {
    customer_id: "8590146099",
    mcc_id: "4378327049",
    test_account: true,
    hierarchy: true,
    currency: "USD",
    group_resource: "customers/8590146099/adGroups/206587491811",
    group_cpc_micros: "100000",
    fixture_paused: true,
    fixture_sha256: "c".repeat(64),
    source_head: env.STAGE234_SOURCE_HEAD,
    verified_at: new Date(now).toISOString(),
  };
  const prefix = "customers/8590146099";
  const customer = {
    id: "8590146099",
    resourceName: prefix,
    currencyCode: "USD",
    timeZone: "Asia/Almaty",
    testAccount: true,
  };
  const campaign = {
    id: "24324170853",
    resourceName: prefix + "/campaigns/24324170853",
    name: "HM_MCP_WRITE_ACCEPTANCE_20261007T134837Z",
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
  };
  const group = {
    id: "206587491811",
    resourceName: prefix + "/adGroups/206587491811",
    campaign: campaign.resourceName,
    name: "Acceptance Group",
    status: "PAUSED",
    type: "SEARCH_STANDARD",
  };
  const ad = {
    resourceName: prefix + "/adGroupAds/206587491811~827349040712",
    adGroup: group.resourceName,
    status: "PAUSED",
    ad: {
      id: "827349040712",
      resourceName: prefix + "/ads/827349040712",
      finalUrls: ["https://mcp.holymedia.kz/"],
      responsiveSearchAd: {
        headlines: [{ text: "Existing paused RSA" }],
        descriptions: [{ text: "Existing RSA preserved" }],
      },
    },
  };
  const inventory = [{ adGroupAd: ad }];
  const records: {
    url: string;
    type: string;
    body: Record<string, unknown>;
  }[] = [];
  const mock = vi.fn(
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = String(input);
      const type = guard.validateLRequest(url, init, { env, proof, now });
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      records.push({ url, type, body });
      if (type === "validate_only")
        return new Response(JSON.stringify({}), { status: 200 });
      const rows =
        body.query === guard.rsaQueries.customer
          ? [{ customer }]
          : body.query === guard.rsaQueries.campaign
            ? [{ campaign }]
            : body.query === guard.rsaQueries.group
              ? [{ adGroup: group }]
              : body.query === guard.rsaQueries.inventory
                ? inventory
                : null;
      if (!rows) throw Error("unexpected mock query");
      return new Response(JSON.stringify([{ results: rows }]), { status: 200 });
    },
  );
  vi.stubGlobal("fetch", mock);
  const adapter = new GoogleAdsAdapter(config);
  const context = {
    accountId: "8590146099",
    loginCustomerId: "4378327049",
    credentials: {
      accessToken: "fixture-access",
      scopes: ["https://www.googleapis.com/auth/adwords"],
    },
  };
  const tool = scenario.plannedRsaArguments(false);
  const intent = stage4ToolIntent(tool.name, tool.arguments);
  return {
    guard,
    adapter,
    context,
    intent,
    tool,
    records,
    mock,
    inventory,
    ad,
    campaign,
    group,
  };
}
describe("Acceptance L exact production adapter contract — mock transport only", () => {
  it("stock build emits the exact guard-approved four ownership/inventory reads and PAUSED create", async () => {
    const f = await setup();
    const plan = (await f.adapter.extended(
      f.context,
      4,
      "build",
      f.intent,
    )) as ExtendedPlan;
    expect(f.records.map((r) => r.body.query)).toEqual(
      Object.values(f.guard.rsaQueries),
    );
    expect(plan.version).toBe(4);
    expect(plan.atomic).toBe(false);
    expect(plan.irreversible).toBe(false);
    expect(plan.operations).toHaveLength(1);
    expect(plan.operations[0]).toMatchObject({
      kind: "adGroupAds",
      method: "create",
      resource_name: null,
      before: null,
      fields: f.guard.createFields,
      expected: f.guard.createFields,
      read_query: f.guard.rsaQueries.inventory,
    });
    expect(plan.checks).toHaveLength(4);
    expect(plan.checks[3]?.rows).toEqual(f.inventory);
    expect(plan.items[0]?.warnings.join(" ")).toMatch(/PAUSED.*moderation/);
    expect(plan.items[0]?.before).toBeNull();
    expect(plan.items[0]?.after).toEqual(f.guard.createFields);
    expect(f.records.every((r) => r.type === "read")).toBe(true);
  });
  it("stock validate uses the exact GoogleAdsService validateOnly=true payload; no mutation and existing RSA preserved", async () => {
    const f = await setup(),
      before = JSON.stringify(f.inventory);
    const plan = (await f.adapter.extended(
      f.context,
      4,
      "build",
      f.intent,
    )) as ExtendedPlan;
    const result = await f.adapter.extended(f.context, 4, "validate", plan);
    expect(result).toMatchObject([{ success: true }]);
    const validation = f.records.filter((r) => r.type === "validate_only");
    expect(validation).toHaveLength(1);
    expect(validation[0]?.url).toBe(
      "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:mutate",
    );
    expect(validation[0]?.body).toEqual(f.guard.validationPayload);
    expect(extendedProviderOperation(plan.operations[0]!)).toEqual(
      f.guard.validationPayload.mutateOperations[0],
    );
    expect(JSON.stringify(f.inventory)).toBe(before);
    // Preview-only config blocks a real commit before the mock transport.
    const calls = f.mock.mock.calls.length;
    await expect(
      f.adapter.extended(f.context, 4, "commit", plan),
    ).rejects.toMatchObject({ writeCode: "confirmed_write_disabled" });
    expect(f.mock).toHaveBeenCalledTimes(calls);
  });
  it("actual built immutable plan satisfies persisted-L assertion and actual items satisfy preview assertion", async () => {
    const f = await setup();
    const plan = (await f.adapter.extended(
      f.context,
      4,
      "build",
      f.intent,
    )) as ExtendedPlan;
    const stored = {
      accountId: "account",
      serviceTokenId: "key",
      provider: "GOOGLE_ADS",
      commitStatus: "PREVIEWED",
      requestedState: plan,
      snapshotDigest: f.guard.digest(plan),
    };
    expect(() =>
      f.guard.assertStoredL(stored, { id: "account" }, { id: "key" }),
    ).not.toThrow();
    expect(() =>
      f.guard.assertLPreview({
        status: "preview",
        provider: "GOOGLE_ADS",
        account_id: "8590146099",
        operation_count: plan.operations.length,
        provider_validation: "passed",
        partial_failure: !plan.atomic,
        atomic: plan.atomic,
        items: plan.items,
        preview_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        expires_at: new Date(Date.now() + 240000).toISOString(),
        approval_url: "http://localhost:4403/mcp/approve#intentionalnonce",
      }),
    ).not.toThrow();
    const changed = structuredClone(plan);
    changed.operations[0]!.fields.status = "ENABLED";
    expect(() =>
      f.guard.assertStoredL(
        {
          ...stored,
          requestedState: changed,
          snapshotDigest: f.guard.digest(changed),
        },
        { id: "account" },
        { id: "key" },
      ),
    ).toThrow(/immutable_preview_invalid/);
  });
  it("production parser rejects headline31 before any provider request; duplicate RSA rejects without validate", async () => {
    const f = await setup();
    const invalid = structuredClone(f.tool);
    invalid.arguments.items[0].rsa.headlines[0].text = "A".repeat(31);
    expect(() => stage4ToolIntent(invalid.name, invalid.arguments)).toThrow();
    expect(f.mock).not.toHaveBeenCalled();
    f.inventory[0]!.adGroupAd.ad = { ...f.ad.ad, ...f.guard.createFields.ad };
    await expect(
      f.adapter.extended(f.context, 4, "build", f.intent),
    ).rejects.toMatchObject({ writeCode: "google_stage4_duplicate" });
    expect(f.records.every((r) => r.type === "read")).toBe(true);
  });
});

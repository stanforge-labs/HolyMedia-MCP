import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { safeGet } from "@holymedia/site-audit";
import {
  fixture,
  customer,
  prefix,
  principal,
  object,
  type MockRow,
} from "./google-write-test.fixture.js";
import {
  buildPausePlan,
  type Stage0Plan,
} from "../providers/google-ads-stage0.js";
import { McpPreviewService } from "./mcp-preview.service.js";
import {
  campaignIdSchema,
  validateBriefSchema,
} from "./mcp-google-stage0-schema.js";
import { publicTools } from "./mcp-public-tools.js";

vi.mock("@holymedia/site-audit", () => ({
  safeGet: vi.fn(async () => {
    throw new Error("A campaign PAUSE must never probe launch URLs");
  }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const args = {
  provider: "GOOGLE_ADS",
  account_id: customer,
  campaign_id: "1",
};
function pauseFixture() {
  const f = fixture(true);
  f.resources.set(`${prefix}/campaigns/1`, {
    campaign: {
      resourceName: `${prefix}/campaigns/1`,
      id: "1",
      name: "TEST campaign pause",
      status: "ENABLED",
      advertisingChannelType: "SEARCH",
      biddingStrategyType: "MAXIMIZE_CONVERSIONS",
    },
  });
  // Intentionally not launch-ready: no goals/geo/keywords, paused children,
  // disapproved RSA and unreachable URL. None may prevent stopping delivery.
  f.resources.set(`${prefix}/adGroups/10`, {
    campaign: object(f.resources.get(`${prefix}/campaigns/1`)!.campaign),
    adGroup: {
      resourceName: `${prefix}/adGroups/10`,
      id: "10",
      status: "PAUSED",
    },
  });
  f.resources.set(`${prefix}/adGroupAds/10~20`, {
    adGroupAd: {
      resourceName: `${prefix}/adGroupAds/10~20`,
      status: "PAUSED",
      ad: { finalUrls: ["https://unreachable.example.test"] },
      policySummary: { approvalStatus: "DISAPPROVED" },
    },
  });
  return f;
}
const campaign = (f: ReturnType<typeof pauseFixture>) =>
  object(f.resources.get(`${prefix}/campaigns/1`)!.campaign);
const mutations = (f: ReturnType<typeof pauseFixture>, validateOnly: boolean) =>
  f.requests.filter(
    (r) =>
      r.url.endsWith("/googleAds:mutate") &&
      r.body.validateOnly === validateOnly,
  );

describe("Google Search campaign PAUSE uses existing Stage0 approval lifecycle (mock only)", () => {
  it("previews one immutable atomic status effect, requires separate approval, verifies and journals without changing children", async () => {
    const f = pauseFixture(),
      children = structuredClone(
        [...f.resources.values()].filter((r) => r.adGroup || r.adGroupAd),
      ),
      p = await f.call("preview_pause_campaign", { campaign_id: "1" });
    expect(p.status).toBe("preview");
    expect(p.partial_failure).toBe(false);
    expect(p.provider_mutation_sent).toBe(false);
    expect(campaign(f).status).toBe("ENABLED");
    expect(f.writes()).toBe(0);
    expect(mutations(f, true)).toHaveLength(1);
    expect(mutations(f, true)[0]!.body).toMatchObject({
      partialFailure: false,
      mutateOperations: [
        {
          campaignOperation: {
            update: { resourceName: `${prefix}/campaigns/1`, status: "PAUSED" },
            updateMask: "status",
          },
        },
      ],
    });
    const plan = f.previewsRows[0]!.requestedState as Stage0Plan;
    expect(plan.intent.action).toBe("campaign_pause");
    expect(plan.operations).toHaveLength(1);
    expect(plan.items[0]!.before).toMatchObject({ status: "ENABLED" });
    expect(plan.items[0]!.after).toMatchObject({ status: "PAUSED" });
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    expect(f.writes()).toBe(0);
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(result.partial_failure).toBe(false);
    expect(campaign(f).status).toBe("PAUSED");
    expect(mutations(f, false)).toHaveLength(1);
    expect(mutations(f, false)[0]!.body.partialFailure).toBe(false);
    expect(
      [...f.resources.values()].filter((r) => r.adGroup || r.adGroupAd),
    ).toEqual(children);
    expect(
      f.events
        .filter((e) => e.eventType === "mcp_google_stage1_operation")
        .map((e) => object(e.metadata).result),
    ).toEqual(["rejected", "attempted", "success"]);
    const journal = await f.call("list_change_journal", {});
    expect((journal.items as MockRow[])[0]!.commit_id).toBe(result.commit_id);
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "preview_already_consumed" });
    expect(mutations(f, false)).toHaveLength(1);
  });
  it("does not read launch prerequisites or probe URLs to stop delivery", async () => {
    const f = pauseFixture();
    await f.call("preview_pause_campaign", { campaign_id: "1" });
    const reads = f.requests.filter((r) =>
      r.url.endsWith("/googleAds:searchStream"),
    );
    expect(reads).toHaveLength(1);
    expect(reads[0]!.body.query).toContain(
      " FROM campaign WHERE campaign.id = 1",
    );
    expect(safeGet).not.toHaveBeenCalled();
    expect(f.writes()).toBe(0);
  });
  it.each(["status", "name"])(
    "stale campaign %s rejects approved commit before mutation",
    async (field) => {
      const f = pauseFixture(),
        p = await f.call("preview_pause_campaign", { campaign_id: "1" });
      await f.approve(p);
      campaign(f)[field] = field === "status" ? "PAUSED" : "externally renamed";
      await expect(
        f.previews.commit(principal, String(p.preview_token)),
      ).rejects.toMatchObject({ code: "google_preview_stale" });
      expect(f.writes()).toBe(0);
    },
  );
  it.each(["PAUSED", "REMOVED"])(
    "does not manufacture a pause/no-op for %s",
    async (status) => {
      const f = pauseFixture();
      campaign(f).status = status;
      await expect(
        f.call("preview_pause_campaign", { campaign_id: "1" }),
      ).rejects.toMatchObject({ writeCode: "google_campaign_status_invalid" });
      expect(mutations(f, true)).toHaveLength(0);
      expect(f.previewsRows).toHaveLength(0);
      expect(f.writes()).toBe(0);
    },
  );
  it("rejects unsupported channels and missing/ambiguous/foreign provider identities", async () => {
    const f = pauseFixture();
    campaign(f).advertisingChannelType = "PERFORMANCE_MAX";
    await expect(
      f.call("preview_pause_campaign", { campaign_id: "1" }),
    ).rejects.toMatchObject({ writeCode: "google_campaign_type_unsupported" });
    for (const rows of [
      [],
      [{ campaign: campaign(f) }, { campaign: campaign(f) }],
      [
        {
          campaign: {
            ...campaign(f),
            resourceName: "customers/9999999999/campaigns/1",
          },
        },
      ],
      [{ campaign: { ...campaign(f), id: "2" } }],
    ]) {
      await expect(
        buildPausePlan(customer, args, async () => rows),
      ).rejects.toMatchObject({ writeCode: "google_campaign_unavailable" });
    }
    expect(f.writes()).toBe(0);
  });
  it("strict schema rejects extra status/mutation fields and malformed identity before provider access", async () => {
    const f = pauseFixture();
    for (const extra of [
      { status: "ENABLED" },
      { operations: [] },
      { campaign_id: "1 OR 1=1" },
    ]) {
      await expect(
        f.call("preview_pause_campaign", { campaign_id: "1", ...extra }),
      ).rejects.toMatchObject({ writeCode: "google_brief_invalid" });
    }
    expect(f.requests).toHaveLength(0);
    expect(f.previewsRows).toHaveLength(0);
  });
  it.each([
    ["PROVIDER_GOOGLE_ADS_WRITE_ENABLED", "false", "google_write_disabled"],
    [
      "GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST",
      "",
      "google_account_not_allowlisted",
    ],
  ])("%s denies before provider access", async (key, value, writeCode) => {
    const f = pauseFixture();
    vi.stubEnv(key, value);
    const denied = new McpPreviewService(
      f.db as never,
      f.audit as never,
      {} as never,
    );
    await expect(
      denied.createGoogleCampaign(principal, args, "pause"),
    ).rejects.toMatchObject({ writeCode });
    expect(f.requests).toHaveLength(0);
    expect(f.writes()).toBe(0);
  });
  it("read-only principal, expired preview and changed commit allowlist cannot write", async () => {
    const f = pauseFixture();
    await expect(
      f.previews.createGoogleCampaign(
        { ...principal, scopes: ["adforge:mcp:read"] },
        args,
        "pause",
      ),
    ).rejects.toBeDefined();
    expect(f.requests).toHaveLength(0);
    const p = await f.call("preview_pause_campaign", { campaign_id: "1" });
    await f.approve(p);
    f.previewsRows[0]!.expiresAt = new Date(0);
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "preview_expired" });
    f.previewsRows[0]!.expiresAt = new Date(Date.now() + 60_000);
    vi.stubEnv("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", "");
    const denied = new McpPreviewService(
      f.db as never,
      f.audit as never,
      {} as never,
    );
    await expect(
      denied.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ writeCode: "google_account_not_allowlisted" });
    expect(f.writes()).toBe(0);
  });
  it("validation failure has no committable token; reread outage never retries or reports VERIFIED", async () => {
    const f = pauseFixture();
    f.validationFail();
    const denied = await f.call("preview_pause_campaign", { campaign_id: "1" });
    expect(denied.status).toBe("validation_failed");
    expect(denied.preview_token).toBeUndefined();
    expect(f.previewsRows).toHaveLength(0);
    expect(f.writes()).toBe(0);
    const g = pauseFixture(),
      p = await g.call("preview_pause_campaign", { campaign_id: "1" });
    g.outage();
    expect((await g.commit(p)).status).toBe("UNVERIFIED");
    await expect(
      g.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "preview_already_consumed" });
    expect(mutations(g, false)).toHaveLength(1);
  });
  it("attempt-audit failure closes the claimed pause without provider mutation", async () => {
    const f = pauseFixture(),
      p = await f.call("preview_pause_campaign", { campaign_id: "1" });
    await f.approve(p);
    const original = f.audit.record.getMockImplementation()!;
    f.audit.record.mockImplementation(async (input: MockRow) => {
      if (input.eventType === "mcp_google_stage1_operation")
        throw new Error("audit unavailable");
      return original(input);
    });
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toThrow();
    expect(f.writes()).toBe(0);
    expect(f.previewsRows[0]!.consumedAt).toBeTruthy();
  });
  it("keeps legacy Meta campaign pause dispatch unchanged", async () => {
    const f = pauseFixture(),
      create = vi
        .spyOn(f.previews, "create")
        .mockResolvedValue({ status: "preview" } as never);
    await f.mcp.call(principal, "preview_pause_campaign", {
      provider: "META_ADS",
      account_id: "act_123",
      campaign_id: "456",
    });
    expect(create).toHaveBeenCalledWith(principal, {
      provider: "META_ADS",
      accountId: "act_123",
      objectId: "456",
      operation: "pause",
      payload: {},
    });
    expect(f.requests).toHaveLength(0);
  });
  it("publishes strict legacy schema/annotations; Public defaults remain read-only and Meta public schema unchanged", () => {
    validateBriefSchema(args, campaignIdSchema);
    const defaults = loadConfig({ NODE_ENV: "test" });
    expect(defaults.providerGoogleAdsWriteEnabled).toBe(false);
    expect(defaults.publicMcpWriteScopeEnabled).toBe(false);
    expect(defaults.publicMcpControlledWriteEnabled).toBe(false);
    const f = pauseFixture(),
      tool = f.mcp.tools().find((t) => t.name === "preview_pause_campaign")!;
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
    });
    expect(tool.inputSchema).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          additionalProperties: false,
          required: ["provider", "account_id", "campaign_id"],
        }),
      ]),
    });
    expect(publicTools(f.mcp.tools())).toHaveLength(42);
    expect(
      publicTools(f.mcp.tools()).some(
        (t) => t.name === "preview_pause_campaign",
      ),
    ).toBe(false);
    const meta = publicTools(f.mcp.tools(), true).find(
      (t) => t.name === "preview_pause_campaign",
    )!;
    expect(meta.description).toContain("Meta Ads");
    expect(meta.inputSchema).toMatchObject({
      required: ["account_id", "campaign_id"],
      additionalProperties: false,
    });
    expect(object(meta.inputSchema.properties).provider).toBeUndefined();
  });
});

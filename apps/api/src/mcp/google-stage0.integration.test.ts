import { afterEach, describe, expect, it, vi } from "vitest";
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
  normalizeBrief,
  type Stage0Plan,
} from "../providers/google-ads-stage0.js";
import {
  campaignBriefSchema,
  validateBriefSchema,
} from "./mcp-google-stage0-schema.js";
import { loadConfig } from "@holymedia/config";
import { publicTools } from "./mcp-public-tools.js";
import { McpPreviewService } from "./mcp-preview.service.js";
vi.mock("@holymedia/site-audit", () => ({
  safeGet: vi.fn(async (url: string) => ({
    statusCode: 200,
    url,
    body: Buffer.from("ok"),
    headers: {},
  })),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function brief(): MockRow {
  return {
    provider: "GOOGLE_ADS",
    account_id: customer,
    campaign_name: "TEST Search from brief",
    daily_budget: { amount: "15000", currency: "KZT" },
    locations: [{ name: "Алматы", country_code: "KZ" }],
    languages: ["русский"],
    conversion_actions: ["500"],
    utm: {
      final_url_suffix:
        "utm_source=google&utm_medium=cpc&utm_campaign={campaignid}",
    },
    ad_groups: [0, 1].map((i) => ({
      name: `TEST group ${i}`,
      default_bid: { amount: "150", currency: "KZT" },
      keywords: [0, 1, 2, 3, 4].map((n) => ({
        text: `тест ${i} ${n}`,
        match_type: "EXACT",
      })),
      rsa: [
        {
          final_url: "https://example.test/landing",
          headlines: [
            "Тестовый заголовок",
            "Вторая строка",
            "Третья строка",
          ].map((text) => ({ text })),
          descriptions: [
            "Тестовое описание номер один",
            "Тестовое описание номер два",
          ].map((text) => ({ text })),
        },
      ],
    })),
    assets: {
      sitelinks: [0, 1, 2, 3].map((n) => ({
        text: `Тест ссылка ${n}`,
        final_url: `https://example.test/page-${n}`,
      })),
    },
  };
}
const groups = (b: MockRow) => b.ad_groups as MockRow[];
const rsa = (b: MockRow) => groups(b)[0]!.rsa as MockRow[];
const fetchPlan = (f: ReturnType<typeof fixture>) =>
  f.previewsRows[0]!.requestedState as Stage0Plan;
const mutationRequests = (f: ReturnType<typeof fixture>, validate: boolean) =>
  f.requests.filter(
    (r) =>
      r.url.endsWith("/googleAds:mutate") && r.body.validateOnly === validate,
  );
const resource = (f: ReturnType<typeof fixture>, key: string) =>
  [...f.resources.values()].filter((r) => r[key]).map((r) => object(r[key]));
describe("Google Stage 0 atomic campaign lifecycle — no real external calls", () => {
  it("T: typed brief validates only, approval, atomic commit, PAUSED structure reread and journal", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", brief());
    expect(p.status).toBe("preview");
    expect(p.policy_warnings).toEqual([]);
    expect(f.writes()).toBe(0);
    expect(mutationRequests(f, true)).toHaveLength(1);
    expect(mutationRequests(f, false)).toHaveLength(0);
    expect(object(p.campaign_plan).keywords_count).toBe(10);
    expect(object(p.campaign_plan).rsa_count).toBe(2);
    expect(object(p.campaign_plan).assets_count).toBe(4);
    expect(mutationRequests(f, true)[0]!.body.partialFailure).toBe(false);
    expect(mutationRequests(f, true)[0]!.headers["login-customer-id"]).toBe(
      "9999999999",
    );
    const plan = fetchPlan(f);
    expect(plan.operations.length).toBe(p.operation_count);
    const names = plan.operations
      .filter((o) => o.method === "create" && o.resource_name)
      .map((o) => o.resource_name!.split("/").at(-1));
    expect(new Set(names).size).toBe(names.length);
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(result.partial_failure).toBe(false);
    expect(String(result.commit_id)).toMatch(/^hmc_/);
    expect(
      resource(f, "campaign").filter((c) => c.resourceName && c.id),
    ).toContainEqual(
      expect.objectContaining({
        status: "PAUSED",
        advertisingChannelType: "SEARCH",
      }),
    );
    expect(resource(f, "adGroup").every((g) => g.status === "PAUSED")).toBe(
      true,
    );
    expect(resource(f, "adGroupAd").every((a) => a.status === "PAUSED")).toBe(
      true,
    );
    expect(mutationRequests(f, false)).toHaveLength(1);
    expect(
      f.events.filter((e) => e.eventType === "mcp_google_stage1_operation"),
    ).toHaveLength(plan.operations.length * 2);
    const journal = await f.call("list_change_journal", {});
    expect((journal.items as MockRow[])[0]!.commit_id).toBe(result.commit_id);
    await expect(
      f.previews.previewRollbackCommit(principal, String(result.commit_id)),
    ).rejects.toMatchObject({ writeCode: "rollback_unsupported" });
  });
  it("U: 31-character headline fails before any provider request or preview", async () => {
    const f = fixture(true),
      b = brief();
    (rsa(b)[0]!.headlines as MockRow[])[0]!.text = "а".repeat(31);
    await expect(f.call("create_campaign_from_brief", b)).rejects.toMatchObject(
      { writeCode: "google_brief_invalid" },
    );
    expect(f.requests).toHaveLength(0);
    expect(f.writes()).toBe(0);
    expect(f.previewsRows).toHaveLength(0);
  });
  it("V: missing conversion goal is a warning for manual CPC and failure for conversions strategy", async () => {
    const f = fixture(true),
      b = brief();
    delete b.conversion_actions;
    await f.commit(await f.call("create_campaign_from_brief", b));
    // The simulated campaign intentionally has no inherited campaign goals.
    const id = String(resource(f, "campaign")[0]!.id),
      check = await f.call("get_launch_checklist", { campaign_id: id });
    expect(
      (check.checklist as MockRow[]).find((c) => c.code === "conversion_goal")!
        .status,
    ).toBe("WARNING");
    expect(check.ready).toBe(false);
    resource(f, "campaign")[0]!.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    expect(
      ((await f.call("get_launch_checklist", { campaign_id: id })) as MockRow)
        .can_resume,
    ).toBe(false);
  });
  it("W: activation is separate approved preview; campaign enabled, groups and ads unchanged", async () => {
    const f = fixture(true);
    await f.commit(await f.call("create_campaign_from_brief", brief()));
    const campaign = resource(f, "campaign")[0]!,
      id = String(campaign.id);
    for (const g of resource(f, "adGroup")) g.status = "ENABLED";
    for (const a of resource(f, "adGroupAd")) {
      a.status = "ENABLED";
      a.policySummary = { approvalStatus: "APPROVED" };
    }
    const check = await f.call("get_launch_checklist", { campaign_id: id });
    expect(check.ready).toBe(true);
    const p = await f.call("preview_resume_campaign", { campaign_id: id });
    expect(campaign.status).toBe("PAUSED");
    expect(p.items as MockRow[]).toHaveLength(1);
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(resource(f, "campaign")[0]!.status).toBe("ENABLED");
    expect(fetchPlan(f).operations[1]!.fields.status).toBe("PAUSED");
    const latest = f.previewsRows[1]!.requestedState as Stage0Plan;
    expect(latest.operations).toHaveLength(1);
    expect(latest.operations[0]!.update_mask).toBe("status");
  });
  it("Safe defaults: partners/display OFF, presence, paused entities and exact currency micros", async () => {
    const f = fixture(true);
    await f.call("create_campaign_from_brief", brief());
    const p = fetchPlan(f),
      campaign = p.operations[1]!.fields;
    expect(campaign.networkSettings).toEqual({
      targetGoogleSearch: true,
      targetSearchNetwork: false,
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false,
    });
    expect(campaign.geoTargetTypeSetting).toEqual({
      positiveGeoTargetType: "PRESENCE",
      negativeGeoTargetType: "PRESENCE",
    });
    expect(p.operations[0]!.fields).toMatchObject({
      amountMicros: "15000000000",
      explicitlyShared: false,
    });
    expect(p.operations[0]!.fields).not.toHaveProperty("name");
    expect(p.operations[0]!.expected.name).toBe(brief().campaign_name);
    expect(p.items[0]!.keyword).toBe(`Budget for ${brief().campaign_name}`);
    expect(
      p.operations
        .filter((o) => ["campaign", "adGroup", "adGroupAd"].includes(o.kind))
        .every((o) => o.fields.status === "PAUSED"),
    ).toBe(true);
    const wrong = brief();
    wrong.daily_budget = { amount: "20", currency: "USD" };
    await expect(
      f.call("create_campaign_from_brief", wrong),
    ).rejects.toMatchObject({ writeCode: "google_currency_mismatch" });
  });
  it("Schedule quarter hours, overlap/overnight rejection, timezone and optional dates/pins", async () => {
    const f = fixture(true),
      b = brief();
    b.ad_schedule = [
      { days: ["MONDAY", "FRIDAY"], start: "09:15", end: "18:45" },
    ];
    b.start_date = "2026-11-01";
    b.end_date = "2026-12-31";
    (rsa(b)[0]!.headlines as MockRow[])[0]!.pinned_field = "HEADLINE_1";
    const p = await f.call("create_campaign_from_brief", b);
    expect(object(p.campaign_plan).timezone).toBe("Asia/Almaty");
    expect(fetchPlan(f).operations[1]!.fields.startDateTime).toBe(
      "2026-11-01 00:00:00",
    );
    expect(
      fetchPlan(f).operations.filter((o) => o.fields.adSchedule),
    ).toHaveLength(2);
    b.ad_schedule = [
      { days: ["MONDAY"], start: "09:00", end: "18:00" },
      { days: ["MONDAY"], start: "10:00", end: "19:00" },
    ];
    expect(() => normalizeBrief(b)).toThrow(/пересекается/);
    b.ad_schedule = [{ days: ["MONDAY"], start: "23:00", end: "01:00" }];
    expect(() => normalizeBrief(b)).toThrow(/полночь/);
  });
  it("Geo ambiguity and invalid language reject without Google mutation", async () => {
    const f = fixture(true);
    f.resources.set("geoTargetConstants/101", {
      geoTargetConstant: {
        resourceName: "geoTargetConstants/101",
        id: "101",
        name: "Алматы",
        countryCode: "KZ",
        status: "ENABLED",
      },
    });
    await expect(
      f.call("create_campaign_from_brief", brief()),
    ).rejects.toMatchObject({ writeCode: "google_geo_ambiguous" });
    f.resources.delete("geoTargetConstants/101");
    const b = brief();
    b.languages = ["неизвестный язык"];
    await expect(f.call("create_campaign_from_brief", b)).rejects.toMatchObject(
      { writeCode: "google_language_invalid" },
    );
    expect(f.writes()).toBe(0);
  });
  it("Missing/unusable actions and cross-account goals fail closed; exact subsets use custom goals", async () => {
    const f = fixture(true),
      b = brief();
    b.conversion_actions = ["999"];
    await expect(f.call("create_campaign_from_brief", b)).rejects.toMatchObject(
      { writeCode: "google_conversion_invalid" },
    );
    f.resources.set(`${prefix}/conversionActions/501`, {
      conversionAction: {
        ...object(
          f.resources.get(`${prefix}/conversionActions/500`)!.conversionAction,
        ),
        id: "501",
        resourceName: `${prefix}/conversionActions/501`,
      },
    });
    expect((await f.call("create_campaign_from_brief", brief())).status).toBe(
      "preview",
    );
    expect(
      fetchPlan(f).operations.some((o) => o.kind === "customConversionGoal"),
    ).toBe(true);
    f.resources.delete(`${prefix}/conversionActions/501`);
    object(object(f.resources.get(prefix)).customer).conversionTrackingSetting =
      { googleAdsConversionCustomer: "customers/9999999999" };
    await expect(
      f.call("create_campaign_from_brief", brief()),
    ).rejects.toMatchObject({
      writeCode: "google_conversion_cross_account_unsupported",
    });
    expect(f.writes()).toBe(0);
  });
  it("Duplicate keywords, group names, invalid URLs and >500 ops fail before provider", async () => {
    for (const change of [
      (b: MockRow) => {
        (groups(b)[0]!.keywords as MockRow[]).push({
          ...object((groups(b)[0]!.keywords as MockRow[])[0]),
        });
      },
      (b: MockRow) => {
        groups(b)[1]!.name = groups(b)[0]!.name;
      },
      (b: MockRow) => {
        rsa(b)[0]!.final_url = "javascript:alert(1)";
      },
      (b: MockRow) => {
        groups(b)[0]!.keywords = Array.from({ length: 500 }, (_, i) => ({
          text: `test ${i}`,
          match_type: "EXACT",
        }));
      },
    ]) {
      const f = fixture(true),
        b = brief();
      change(b);
      await expect(
        f.call("create_campaign_from_brief", b),
      ).rejects.toBeDefined();
      expect(f.requests).toHaveLength(0);
      expect(f.writes()).toBe(0);
    }
  });
  it("Stage 1 keyword and negative builders retain explicit conflict warnings", async () => {
    const f = fixture(true),
      b = brief();
    b.negative_keywords = [{ text: "тест", match_type: "BROAD" }];
    groups(b)[0]!.negative_keywords = [
      { text: "тест 0 0", match_type: "EXACT" },
    ];
    (groups(b)[0]!.keywords as MockRow[])[0]!.cpc_bid = {
      amount: "0.5",
      currency: "KZT",
    };
    const p = await f.call("create_campaign_from_brief", b);
    const plan = fetchPlan(f);
    expect(plan.items.some((i) => i.conflicts.length > 0)).toBe(true);
    expect(
      plan.operations.some((o) => o.fields.cpcBidMicros === "500000"),
    ).toBe(true);
    expect(
      plan.operations.filter((o) => o.fields.negative === true),
    ).toHaveLength(2);
    expect(f.writes()).toBe(0);
    expect(
      (p.items as MockRow[]).some((i) => (i.warnings as unknown[]).length > 0),
    ).toBe(true);
  });
  it("Provider validate_only policy failure creates no committable preview or structure", async () => {
    const f = fixture(true);
    f.validationFail();
    const p = await f.call("create_campaign_from_brief", brief());
    expect(p.status).toBe("validation_failed");
    expect(f.previewsRows).toHaveLength(0);
    expect(f.writes()).toBe(0);
    expect(JSON.stringify(p)).toContain("POLICY_FINDING");
    expect((p.policy_warnings as MockRow[]).length).toBeGreaterThan(0);
    expect(JSON.stringify(p.policy_warnings)).toContain("POLICY_FINDING");
    expect(JSON.stringify(p)).not.toContain("Bearer secret");
  });
  it("Atomic provider rejection creates NOTHING, records failed audit/journal and consumes token", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", brief());
    f.fail(12);
    const result = await f.commit(p);
    expect(result.status).toBe("FAILED");
    expect(f.writes()).toBe(0);
    expect(resource(f, "campaign")).toHaveLength(0);
    expect(result.commit_id).toBeDefined();
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toBeDefined();
  });
  it("Approval, expiry, snapshot integrity and replacement payload protection", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", brief());
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
        daily_budget: { amount: "1", currency: "KZT" },
      }),
    ).rejects.toThrow(/only/);
    await f.approve(p);
    fetchPlan(f).operations[0]!.fields.amountMicros = "1";
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "confirmation_context_mismatch" });
    const g = fixture(true),
      q = await g.call("create_campaign_from_brief", brief());
    await g.approve(q);
    g.previewsRows[0]!.expiresAt = new Date(0);
    await expect(
      g.previews.commit(principal, String(q.preview_token)),
    ).rejects.toMatchObject({ code: "preview_expired" });
    expect(g.writes()).toBe(0);
  });
  it("Allowlist, feature gate, scope, revocation and stale references reject without writes", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", brief());
    await f.approve(p);
    object(
      f.resources.get(`${prefix}/conversionActions/500`)!.conversionAction,
    ).status = "REMOVED";
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "google_preview_stale" });
    expect(f.writes()).toBe(0);
    vi.stubEnv("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", "");
    const g = fixture(true);
    vi.stubEnv("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", "");
    const denied = new McpPreviewService(
      g.db as never,
      g.audit as never,
      {} as never,
    );
    await expect(
      denied.createGoogleCampaign(principal, brief()),
    ).rejects.toMatchObject({ writeCode: "google_account_not_allowlisted" });
    const h = fixture(true);
    await expect(
      h.previews.createGoogleCampaign(
        { ...principal, scopes: ["adforge:mcp:read"] },
        brief(),
      ),
    ).rejects.toBeDefined();
    expect(h.requests).toHaveLength(0);
  });
  it("Checklist URL errors and redirects use bounded safeGet; no provider mutation", async () => {
    const f = fixture(true);
    await f.commit(await f.call("create_campaign_from_brief", brief()));
    const id = String(resource(f, "campaign")[0]!.id),
      before = f.writes();
    vi.mocked(safeGet).mockRejectedValueOnce(new Error("unsafe redirect"));
    const c = await f.call("get_launch_checklist", { campaign_id: id });
    expect(
      (c.checklist as MockRow[]).find((i) => i.code === "final_urls")!.status,
    ).toBe("FAIL");
    expect(f.writes()).toBe(before);
    expect(vi.mocked(safeGet)).toHaveBeenCalledWith(
      "https://example.test/landing",
      { timeoutMs: 4000, maxBytes: 65536, maxRedirects: 3, headOnly: true },
    );
  });
  it("Clone supported Search structure PAUSED; source snapshot change prevents commit", async () => {
    const f = fixture(true);
    await f.commit(await f.call("create_campaign_from_brief", brief()));
    const campaign = resource(f, "campaign")[0]!,
      id = String(campaign.id),
      p = await f.call("clone_campaign_preview", {
        source_campaign_id: id,
        new_name: "TEST cloned",
        new_dates: {},
      });
    expect(p.status).toBe("preview");
    await f.approve(p);
    campaign.name = "Externally changed";
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "google_preview_stale" });
  });
  it("Schemas are concrete, default write gates OFF and public catalog stays READ-only", () => {
    validateBriefSchema(brief(), campaignBriefSchema);
    expect(campaignBriefSchema.additionalProperties).toBe(false);
    expect(loadConfig({ NODE_ENV: "test" }).providerGoogleAdsWriteEnabled).toBe(
      false,
    );
    const f = fixture(true);
    const tools = publicTools(f.mcp.tools());
    expect(tools).toHaveLength(42);
    expect(
      tools.some(
        (t) =>
          String(t.name) === "create_campaign_from_brief" ||
          String(t.name) === "clone_campaign_preview",
      ),
    ).toBe(false);
    const tool = f.mcp
      .tools()
      .find((t) => t.name === "create_campaign_from_brief")!;
    expect(tool.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(tool.inputSchema).toMatchObject({
      oneOf: expect.arrayContaining([
        expect.objectContaining({
          required: expect.arrayContaining([
            "provider",
            "account_id",
            "daily_budget",
            "locations",
            "languages",
            "ad_groups",
          ]),
        }),
      ]),
    });
  });
  it("Callouts/snippets/call/business name and existing image/logo references commit and reread", async () => {
    const f = fixture(true),
      b = brief();
    f.resources.set(`${prefix}/assets/800`, {
      asset: { resourceName: `${prefix}/assets/800`, type: "IMAGE" },
    });
    b.assets = {
      ...object(b.assets),
      callouts: ["Тестовый текст"],
      structured_snippets: [
        { header: "Services", values: ["Первое", "Второе", "Третье"] },
      ],
      call: { country_code: "KZ", phone_number: "+7 700 000 0000" },
      business_name: "TEST clinic",
      image_asset_ids: ["800"],
      logo_asset_ids: ["800"],
    };
    const p = await f.call("create_campaign_from_brief", b),
      result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(resource(f, "campaignAsset").map((a) => a.fieldType)).toEqual(
      expect.arrayContaining([
        "SITELINK",
        "CALLOUT",
        "STRUCTURED_SNIPPET",
        "CALL",
        "BUSINESS_NAME",
        "AD_IMAGE",
        "BUSINESS_LOGO",
      ]),
    );
  });
  it("Invalid/missing image reference and binary input cannot bypass typed schema", async () => {
    const f = fixture(true),
      b = brief();
    b.assets = { image_asset_ids: ["999"] };
    await expect(f.call("create_campaign_from_brief", b)).rejects.toMatchObject(
      { writeCode: "google_asset_invalid" },
    );
    b.assets = { image_data: "raw-binary" };
    await expect(f.call("create_campaign_from_brief", b)).rejects.toMatchObject(
      { writeCode: "google_brief_invalid" },
    );
    expect(f.writes()).toBe(0);
  });
  it("Clone supported structure succeeds atomically and remains PAUSED", async () => {
    const f = fixture(true);
    await f.commit(await f.call("create_campaign_from_brief", brief()));
    const id = String(resource(f, "campaign")[0]!.id);
    const p = await f.call("clone_campaign_preview", {
        source_campaign_id: id,
        new_name: "TEST supported clone",
        new_budget: { amount: "20000", currency: "KZT" },
        new_dates: {},
      }),
      result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(
      resource(f, "campaign").filter(
        (c) => c.name === "TEST supported clone",
      )[0]!.status,
    ).toBe("PAUSED");
  });
  it("Clone does not silently omit unsupported source assets or shared list links", async () => {
    const f = fixture(true),
      b = brief();
    b.assets = {
      call: { country_code: "KZ", phone_number: "+7 700 000 0000" },
    };
    await f.commit(await f.call("create_campaign_from_brief", b));
    const id = String(resource(f, "campaign")[0]!.id);
    await expect(
      f.call("clone_campaign_preview", {
        source_campaign_id: id,
        new_name: "TEST unsupported clone",
      }),
    ).rejects.toMatchObject({
      writeCode: "google_clone_unsupported_components",
    });
  });
  it("Lost mutate response and reread outage never claim verified success or retry", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", brief()),
      original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const response = await original(url, init);
        if (
          url.endsWith("/googleAds:mutate") &&
          JSON.parse(String(init?.body)).validateOnly === false
        )
          throw new Error("lost response");
        return response;
      }),
    );
    const result = await f.commit(p);
    expect(result.status).toBe("UNVERIFIED");
    expect(f.writes()).toBeGreaterThan(0);
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toBeDefined();
    const g = fixture(true),
      q = await g.call("create_campaign_from_brief", brief());
    g.outage();
    expect((await g.commit(q)).status).toBe("UNVERIFIED");
  });
  it("Audit failure after claim sends no provider mutation", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", brief());
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
  it("Landing HEAD fallback, HTTP failure and policy pending are explicit checklist failures/warnings", async () => {
    const f = fixture(true);
    await f.commit(await f.call("create_campaign_from_brief", brief()));
    const id = String(resource(f, "campaign")[0]!.id);
    vi.mocked(safeGet)
      .mockResolvedValueOnce({
        statusCode: 405,
        url: "https://example.test/landing",
        body: Buffer.alloc(0),
        headers: {},
      })
      .mockResolvedValueOnce({
        statusCode: 503,
        url: "https://example.test/landing",
        body: Buffer.alloc(0),
        headers: {},
      });
    const c = await f.call("get_launch_checklist", { campaign_id: id });
    expect(
      (c.checklist as MockRow[]).find((i) => i.code === "final_urls")!.status,
    ).toBe("FAIL");
    expect(
      (c.checklist as MockRow[]).find((i) => i.code === "policy")!.status,
    ).toBe("WARNING");
  });
  it("Creation uniqueness changing after preview is stale, and global write gate is mandatory", async () => {
    const f = fixture(true),
      p = await f.call("create_campaign_from_brief", brief());
    await f.approve(p);
    f.resources.set(`${prefix}/campaigns/999`, {
      campaign: {
        id: "999",
        resourceName: `${prefix}/campaigns/999`,
        name: brief().campaign_name,
        status: "PAUSED",
      },
    });
    await expect(
      f.previews.commit(principal, String(p.preview_token)),
    ).rejects.toMatchObject({ code: "google_preview_stale" });
    expect(f.writes()).toBe(0);
    const g = fixture(true);
    vi.stubEnv("PROVIDER_GOOGLE_ADS_WRITE_ENABLED", "false");
    const off = new McpPreviewService(
      g.db as never,
      g.audit as never,
      {} as never,
    );
    await expect(
      off.createGoogleCampaign(principal, brief()),
    ).rejects.toMatchObject({ writeCode: "google_write_disabled" });
  });
  it("Exact conversion subset uses custom goal, atomic config references, checklist and stale guard", async () => {
    const f = fixture(true);
    f.resources.set(`${prefix}/conversionActions/501`, {
      conversionAction: {
        ...object(
          f.resources.get(`${prefix}/conversionActions/500`)!.conversionAction,
        ),
        id: "501",
        resourceName: `${prefix}/conversionActions/501`,
      },
    });
    const p = await f.call("create_campaign_from_brief", brief()),
      plan = fetchPlan(f);
    expect(
      plan.operations.find((o) => o.kind === "customConversionGoal")!.fields
        .conversionActions,
    ).toEqual([`${prefix}/conversionActions/500`]);
    expect(
      plan.operations
        .filter((o) => o.kind === "campaignConversionGoal")
        .every((o) => o.fields.biddable === false),
    ).toBe(true);
    expect(
      plan.operations.find((o) => o.kind === "conversionGoalCampaignConfig")!
        .fields.customConversionGoal,
    ).toMatch(/customConversionGoals\/-/);
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    const id = String(resource(f, "campaign")[0]!.id),
      c = await f.call("get_launch_checklist", { campaign_id: id });
    expect(
      (c.checklist as MockRow[]).find((i) => i.code === "conversion_goal")!
        .status,
    ).toBe("PASS");
    const resume = await f.call("preview_resume_campaign", { campaign_id: id });
    await f.approve(resume);
    resource(f, "customConversionGoal")[0]!.conversionActions = [
      `${prefix}/conversionActions/501`,
    ];
    await expect(
      f.previews.commit(principal, String(resume.preview_token)),
    ).rejects.toMatchObject({ code: "google_preview_stale" });
  });
  it("Explicit secondary action is a warned custom goal; max conversions strategy remains paused", async () => {
    const f = fixture(true),
      b = brief();
    object(
      f.resources.get(`${prefix}/conversionActions/500`)!.conversionAction,
    ).primaryForGoal = false;
    b.bidding_strategy = "MAXIMIZE_CONVERSIONS";
    for (const g of groups(b)) delete g.default_bid;
    const p = await f.call("create_campaign_from_brief", b);
    expect(
      (object(p.campaign_plan).warnings as string[]).some((w) =>
        w.includes("secondary"),
      ),
    ).toBe(true);
    expect((await f.commit(p)).status).toBe("VERIFIED");
    expect(resource(f, "campaign")[0]).toMatchObject({
      status: "PAUSED",
      biddingStrategyType: "MAXIMIZE_CONVERSIONS",
    });
  });
});

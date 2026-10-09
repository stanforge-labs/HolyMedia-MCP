import { describe, expect, it, vi } from "vitest";
import type { AppConfig } from "@holymedia/config";
import { extendedFixture } from "./google-extended-test.fixture.js";
import { object, prefix, principal } from "./google-write-test.fixture.js";
import { publicTools } from "./mcp-public-tools.js";
const rename = (f: ReturnType<typeof extendedFixture>, name = "Renamed TEST") =>
  f.call("google_ads_ads_assets_preview", {
    action: "campaign_update",
    items: [{ campaign_id: "1", name }],
  });
const commit = (
  f: ReturnType<typeof extendedFixture>,
  p: Record<string, unknown>,
) =>
  f.mcp.call(principal, "commit_preview", { preview_token: p.preview_token });
const status = (f: ReturnType<typeof extendedFixture>) =>
  object(f.resources.get(`${prefix}/campaigns/1`)?.campaign).status;
describe("Stage 2–4 use stock human controlled lifecycle: mocked HTTP only", () => {
  it("I OBSERVATION audience add explicit incremental mode, safeapprovedremove", async () => {
    const f = extendedFixture(),
      group = object(f.resources.get(`${prefix}/adGroups/10`)?.adGroup);
    group.targetingSetting = {
      targetRestrictions: [{ targetingDimension: "PLACEMENT", bidOnly: false }],
    };
    f.resources.set(`${prefix}/userLists/42`, {
      userList: {
        resourceName: `${prefix}/userLists/42`,
        id: "42",
        name: "TEST remarketing",
        membershipStatus: "OPEN",
        accountUserListStatus: "ENABLED",
        accessReason: "OWNED",
        eligibleForSearch: true,
        eligibleForDisplay: true,
      },
    });
    const p = await f.call("google_ads_targeting_preview", {
      items: [
        {
          operation: "audience_add",
          level: "AD_GROUP",
          campaign_id: "1",
          ad_group_id: "10",
          audience: { kind: "USER_LIST", id: "42" },
          mode: "OBSERVATION",
        },
      ],
    });
    expect(p.status).toBe("preview");
    expect(p.atomic).toBe(true);
    expect(p.partial_failure).toBe(false);
    expect(JSON.stringify(p.items)).toContain("OBSERVATION");
    expect(f.counts().write).toBe(0);
    await f.approve(p);
    const r = object(await commit(f, p));
    expect(r.status).toBe("VERIFIED");
    expect(object(group.targetingSetting).targetRestrictions).toEqual([
      { targetingDimension: "PLACEMENT", bidOnly: false },
      { targetingDimension: "AUDIENCE", bidOnly: true },
    ]);
    const created = [...f.resources.values()]
      .map((v) => object(v.adGroupCriterion))
      .find((v) => v.userList)!;
    expect(created).toBeDefined();
    const criterion = String(created.resourceName).split("~").at(-1)!;
    const removal = await f.call("google_ads_targeting_preview", {
      items: [
        {
          operation: "audience_remove",
          level: "AD_GROUP",
          campaign_id: "1",
          ad_group_id: "10",
          criterion_id: criterion,
          acknowledge_irreversible: true,
        },
      ],
    });
    expect(removal.irreversible).toBe(true);
    await expect(commit(f, removal)).rejects.toThrow();
    await f.approve(removal);
    expect(object(await commit(f, removal)).status).toBe("VERIFIED");
    expect(f.counts().write).toBe(2);
    expect(status(f)).toBe("PAUSED");
  });
  it("J city/exclusion/radiusresolve atomiccreate throughactualcontrolledpath", async () => {
    const f = extendedFixture();
    f.resources.set("geoTargetConstants/101", {
      geoTargetConstant: {
        resourceName: "geoTargetConstants/101",
        id: "101",
        name: "Astana",
        countryCode: "KZ",
        status: "ENABLED",
      },
    });
    const p = await f.call("google_ads_targeting_preview", {
      items: [
        {
          operation: "geo_add",
          level: "CAMPAIGN",
          campaign_id: "1",
          name: "Алматы",
          country_code: "KZ",
        },
        {
          operation: "geo_exclude",
          level: "CAMPAIGN",
          campaign_id: "1",
          name: "Астана",
          country_code: "KZ",
        },
        {
          operation: "radius_add",
          level: "CAMPAIGN",
          campaign_id: "1",
          latitude: 43.238949,
          longitude: 76.889709,
          radius: 10,
          unit: "KILOMETERS",
        },
      ],
    });
    expect(p.status).toBe("preview");
    expect(p.operation_count).toBe(3);
    expect(p.partial_failure).toBe(false);
    expect(f.counts().write).toBe(0);
    await f.approve(p);
    const r = object(await commit(f, p));
    expect(r.status).toBe("VERIFIED");
    const criteria = [...f.resources.values()]
      .filter((v) => v.campaignCriterion)
      .map((v) => object(v.campaignCriterion));
    expect(criteria).toHaveLength(3);
    expect(criteria.some((c) => c.negative === true)).toBe(true);
    expect(criteria.some((c) => c.proximity)).toBe(true);
    expect(status(f)).toBe("PAUSED");
  });
  it("read-onlyaudience search notrequirewriteapproval/notexposeforeignaccount", async () => {
    const f = extendedFixture();
    f.resources.set(`${prefix}/userLists/42`, {
      userList: {
        resourceName: `${prefix}/userLists/42`,
        id: "42",
        name: "TEST remarketing",
        membershipStatus: "OPEN",
        accountUserListStatus: "ENABLED",
        eligibleForSearch: true,
        eligibleForDisplay: true,
      },
    });
    const r = object(
      await f.mcp.call(
        { ...principal, scopes: ["adforge:mcp:read"] },
        "google_ads_audience_search",
        {
          provider: "GOOGLE_ADS",
          account_id: "1234567890",
          kind: "USER_LIST",
          name: "TEST",
        },
      ),
    );
    expect((r.matches as unknown[]).length).toBe(1);
    expect(f.counts().write).toBe(0);
    expect(f.counts().validate_only).toBe(0);
    await expect(
      f.mcp.call(
        { ...principal, accountIds: [] },
        "google_ads_audience_search",
        {
          provider: "GOOGLE_ADS",
          account_id: "1234567890",
          kind: "USER_LIST",
          name: "TEST",
        },
      ),
    ).rejects.toThrow();
  });
  it("Stage3gate denied atpreview beforeproviderread", async () => {
    const f = extendedFixture();
    const c = (f.previews as unknown as { config: AppConfig }).config;
    c.providerGoogleAdsStage3WriteEnabled = false;
    await expect(
      f.call("google_ads_targeting_preview", {
        items: [
          {
            operation: "geo_add",
            level: "CAMPAIGN",
            campaign_id: "1",
            name: "Алматы",
          },
        ],
      }),
    ).rejects.toThrow(/выключен/);
    expect(f.counts()).toEqual({ read: 0, validate_only: 0, write: 0 });
  });
  it("preview showsprovider BEFORE/exactAFTERand validateOnly without writes", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    expect(p.status).toBe("preview");
    expect(p.provider_validation).toBe("passed");
    expect(p.atomic).toBe(false);
    expect(p.partial_failure).toBe(true);
    expect(p.mutation_plan).toEqual([
      {
        resource_name: `${prefix}/campaigns/1`,
        update_mask: "name",
        fields: { resourceName: `${prefix}/campaigns/1`, name: "Renamed TEST" },
        row: 0,
      },
    ]);
    expect(object((p.items as Record<string, unknown>[])[0]!.before).name).toBe(
      "TEST PPC",
    );
    expect(object((p.items as Record<string, unknown>[])[0]!.after).name).toBe(
      "Renamed TEST",
    );
    expect(f.counts().write).toBe(0);
    expect(f.counts().validate_only).toBe(1);
    expect(status(f)).toBe("PAUSED");
  });
  it("unapproved commitdeniedbeforemutation", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("newmanualapproval immutablecommit reread/journal no autopretry", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    expect(f.previewsRows[0]!.confirmedAt).toBeInstanceOf(Date);
    expect(
      f.events.some((e) => e.eventType === "mcp_preview_web_approved"),
    ).toBe(true);
    const r = object(await commit(f, p));
    expect(r.status).toBe("VERIFIED");
    expect(
      object(f.resources.get(`${prefix}/campaigns/1`)?.campaign).name,
    ).toBe("Renamed TEST");
    expect(status(f)).toBe("PAUSED");
    expect(f.counts().write).toBe(1);
    const j = object(await f.call("list_change_journal", {}));
    expect(JSON.stringify(j)).toContain(String(r.commit_id));
    expect(
      f.events.some(
        (e) =>
          e.eventType === "mcp_google_stage1_operation" &&
          object(e.metadata).result === "success",
      ),
    ).toBe(true);
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(1);
  });
  it("commit cannot replace approved fields", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    await expect(
      f.mcp.call(principal, "commit_preview", {
        preview_token: p.preview_token,
        items: [{ name: "Injected" }],
      }),
    ).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("expiredpreviewafterapproval deniedbeforemutation", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    f.previewsRows[0]!.expiresAt = new Date(0);
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("staleobject snapshot aftermanualapproval rejects/audits beforemutation", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    object(f.resources.get(`${prefix}/campaigns/1`)?.campaign).name =
      "External change";
    await expect(commit(f, p)).rejects.toThrow(/stale/i);
    expect(f.counts().write).toBe(0);
    expect(f.events.some((e) => object(e.metadata).result === "rejected")).toBe(
      true,
    );
  });
  it("immutable storedpayload tamper denied", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    object(object(f.previewsRows[0]!.requestedState).intent).action =
      "ad_remove";
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("stage4gate revocation betweenapproval/commit closeswrite", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    const c = (f.previews as unknown as { config: AppConfig }).config;
    c.providerGoogleAdsStage4WriteEnabled = false;
    await expect(commit(f, p)).rejects.toThrow(/выключен/);
    expect(f.counts().write).toBe(0);
  });
  it("allowlist revocation and tokenrevocation neverwritetootheraccount", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    const c = (f.previews as unknown as { config: AppConfig }).config;
    c.googleAdsWriteAccountAllowlist = [];
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("service token revoked afterhumanapproval rejectsclaim", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    f.revoke();
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("auditfailurebeforemutation failsclosed consumedclaim not retried", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    const prior = f.audit.record.getMockImplementation()!;
    f.audit.record.mockImplementation(async (input) => {
      if (
        input.eventType === "mcp_google_stage1_operation" &&
        object(input.metadata).result === "attempted"
      )
        throw new Error("Mock audit failure");
      return prior(input);
    });
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
    await expect(commit(f, p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("Googlevalidationerror hasoriginalcode no previewcommit", async () => {
    const f = extendedFixture();
    f.failOperation(0);
    const p = await rename(f);
    expect(p.status).toBe("validation_failed");
    expect(p.preview_token).toBeUndefined();
    expect(JSON.stringify(p)).toContain("RESOURCE_NOT_FOUND");
    expect(f.counts()).toMatchObject({ validate_only: 1, write: 0 });
  });
  it("reread uncertainty NOT_VERIFIED and never automatic retry", async () => {
    const f = extendedFixture(),
      p = await rename(f);
    await f.approve(p);
    const prior = globalThis.fetch;
    vi.stubGlobal("fetch", async (...args: Parameters<typeof fetch>) => {
      const r = await prior(...args);
      if (
        String(args[0]).endsWith("googleAds:mutate") &&
        JSON.parse(String(args[1]?.body)).validateOnly === false
      )
        f.readOutage();
      return r;
    });
    const result = object(await commit(f, p));
    expect(result.status).toBe("NOT_VERIFIED");
    expect(f.counts().write).toBe(1);
  });
  it("partialfailure appliesonlysuccessfulimmutable rows, journals each", async () => {
    const f = extendedFixture();
    f.resources.set(`${prefix}/campaigns/2`, {
      campaign: {
        ...object(f.resources.get(`${prefix}/campaigns/1`)?.campaign),
        resourceName: `${prefix}/campaigns/2`,
        id: "2",
        name: "Second",
      },
    });
    const p = await f.call("google_ads_ads_assets_preview", {
      action: "campaign_update",
      items: [
        { campaign_id: "1", name: "first" },
        { campaign_id: "2", name: "second" },
      ],
    });
    await f.approve(p);
    f.failOperation(1);
    const result = object(await commit(f, p));
    expect(result.status).toBe("PARTIAL_FAILURE");
    expect(JSON.stringify(result)).toContain("RESOURCE_NOT_FOUND");
    expect(
      object(f.resources.get(`${prefix}/campaigns/1`)?.campaign).name,
    ).toBe("first");
    expect(
      object(f.resources.get(`${prefix}/campaigns/2`)?.campaign).name,
    ).toBe("Second");
    expect(f.counts().write).toBe(1);
  });
  it("Stage2 strategy usesidenticalcontrolledflowand exactinverse newapproval", async () => {
    const f = extendedFixture(),
      p = await f.call("google_ads_strategy_modifier_preview", {
        items: [
          {
            operation: "campaign_strategy",
            campaign_id: "1",
            strategy: {
              type: "MAXIMIZE_CLICKS",
              cpc_ceiling: { amount: "2", currency: "KZT" },
            },
          },
        ],
      });
    expect(p.provider_validation).toBe("passed");
    expect(f.counts().write).toBe(0);
    await f.approve(p);
    const result = object(await commit(f, p));
    expect(result.status).toBe("VERIFIED");
    expect(
      object(f.resources.get(`${prefix}/campaigns/1`)?.campaign)
        .biddingStrategyType,
    ).toBe("TARGET_SPEND");
    const inverse = object(
      await f.mcp.call(principal, "preview_rollback_commit", {
        commit_id: result.commit_id,
      }),
    );
    expect(inverse.status).toBe("preview");
    expect(inverse.preview_id).not.toBe(p.preview_id);
    await expect(commit(f, inverse)).rejects.toThrow();
    await f.approve(inverse);
    expect(object(await commit(f, inverse)).status).toBe("VERIFIED");
    expect(
      object(f.resources.get(`${prefix}/campaigns/1`)?.campaign)
        .biddingStrategyType,
    ).toBe("MANUAL_CPC");
    expect(status(f)).toBe("PAUSED");
    expect(f.counts().write).toBe(2);
  });
  it("irreversiblead removalwithoutack rejected BEFORE providercall", async () => {
    const f = extendedFixture();
    await expect(
      f.call("google_ads_ads_assets_preview", {
        action: "ad_remove",
        items: [{ campaign_id: "1", ad_group_id: "10", ad_id: "1" }],
      }),
    ).rejects.toThrow();
    expect(f.counts()).toEqual({ read: 0, validate_only: 0, write: 0 });
  });
  it("K31charactersfailsbeforeanyproviderrequest;nofakePMaxfullsupport", async () => {
    const f = extendedFixture();
    await expect(
      f.call("google_ads_ads_assets_preview", {
        action: "rsa_create",
        items: [
          {
            campaign_id: "1",
            ad_group_id: "10",
            rsa: {
              final_url: "https://example.test/",
              headlines: [
                { text: "x".repeat(31) },
                { text: "Second" },
                { text: "Third" },
              ],
              descriptions: [{ text: "One" }, { text: "Two" }],
            },
          },
        ],
      }),
    ).rejects.toThrow();
    expect(f.counts()).toEqual({ read: 0, validate_only: 0, write: 0 });
    await expect(
      f.call("google_ads_pmax_preview", { action: "pmax_create", items: [{}] }),
    ).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("L RSA createdPAUSED throughapprovedstockflow,reread,journal", async () => {
    const f = extendedFixture(),
      p = await f.call("google_ads_ads_assets_preview", {
        action: "rsa_create",
        items: [
          {
            campaign_id: "1",
            ad_group_id: "10",
            rsa: {
              final_url: "https://example.test/",
              headlines: [
                { text: "Test headline one" },
                { text: "Test headline two" },
                { text: "Test headline three" },
              ],
              descriptions: [
                { text: "Test description one" },
                { text: "Test description two" },
              ],
            },
          },
        ],
      });
    expect(p.status).toBe("preview");
    expect(f.counts().write).toBe(0);
    await f.approve(p);
    const result = object(await commit(f, p));
    expect(result.status).toBe("VERIFIED");
    const ads = [...f.resources.values()].filter((r) => r.adGroupAd);
    expect(ads).toHaveLength(1);
    expect(object(ads[0]!.adGroupAd).status).toBe("PAUSED");
    expect(status(f)).toBe("PAUSED");
    expect(
      object(f.resources.get(`${prefix}/adGroups/10`)?.adGroup).status,
    ).toBe("PAUSED");
  });
  it("privateStage2–4tools neverexposedbyPublicMCP", () => {
    const f = extendedFixture();
    const names = publicTools(f.mcp.tools()).map((t) => t.name);
    for (const t of f.mcp
      .tools()
      .filter((t) =>
        /^google_ads_(strategy|bulk_bid|targeting|audience_search|ads_assets|pmax)/.test(
          t.name,
        ),
      )) {
      expect(names).not.toContain(t.name);
      expect(t.inputSchema).toHaveProperty("additionalProperties", false);
    }
  });
});

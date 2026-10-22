import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { extendedFixture } from "./google-extended-test.fixture.js";
import { object, principal } from "./google-write-test.fixture.js";
import {
  qrsPmaxIntentAllowed,
  qrsPmaxWriteAllowed,
} from "../providers/google-ads-pmax-test-gate.js";
import type { ExtendedPlan } from "../providers/google-ads-extended-plan.js";

const account = "8590146099";
const prefix = `customers/${account}`;
const campaignName = "HM HolyPilot gated MOCK";

async function prepared() {
  const f = extendedFixture({ customerId: account });
  Object.assign(
    object(f.resources.get(`${prefix}/customers/${account}`)?.customer),
    {
      currencyCode: "USD",
      conversionTrackingSetting: { googleAdsConversionCustomer: prefix },
    },
  );
  f.resources.set(`${prefix}/conversionActions/5`, {
    conversionAction: {
      id: "5",
      resourceName: `${prefix}/conversionActions/5`,
      name: "MOCK lead",
      ownerCustomer: prefix,
      status: "ENABLED",
      category: "SUBMIT_LEAD_FORM",
      origin: "WEBSITE",
    },
  });
  f.resources.set(`${prefix}/customerConversionGoals/13~2`, {
    customerConversionGoal: {
      resourceName: `${prefix}/customerConversionGoals/13~2`,
      category: "SUBMIT_LEAD_FORM",
      origin: "WEBSITE",
      biddable: true,
    },
  });
  for (const [id, width, height] of [
    ["50", 1200, 628],
    ["51", 1200, 1200],
  ] as const)
    f.resources.set(`${prefix}/assets/${id}`, {
      asset: {
        id,
        resourceName: `${prefix}/assets/${id}`,
        type: "IMAGE",
        imageAsset: {
          fileSize: "10000",
          mimeType: "PNG",
          fullSize: { widthPixels: width, heightPixels: height },
        },
      },
    });
  const logo = (
    await sharp({
      create: { width: 128, height: 128, channels: 3, background: "#123456" },
    })
      .png()
      .toBuffer()
  ).toString("base64");
  const brief = {
    campaign_name: campaignName,
    daily_budget: { amount: "2", currency: "USD" },
    conversion_actions: ["5"],
    business_name: "HolyPilot",
    logos: [{ mime_type: "image/png", data_base64: logo }],
    locations: [{ geo_target_id: "100" }],
    languages: ["1031"],
    contains_eu_political_advertising:
      "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    asset_groups: [
      {
        name: "PAUSED MOCK group",
        final_url: "https://mcp.holymedia.kz/",
        headlines: ["HolyPilot", "Your AI marketer", "HolyPilot by HolyMedia"],
        long_headlines: ["HolyPilot — your personal AI marketer"],
        descriptions: [
          "Meet HolyPilot, your personal AI marketer.",
          "Learn about HolyPilot from HolyMedia.",
        ],
        images: [
          { field_type: "MARKETING_IMAGE", media: { asset_id: "50" } },
          { field_type: "SQUARE_MARKETING_IMAGE", media: { asset_id: "51" } },
        ],
      },
    ],
  };
  const isolated = loadConfig({
    ...process.env,
    NODE_ENV: "test",
    HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp-test.holymedia.kz",
    QRS_TEST_RESTRICTED_AUTH: "true",
    QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED: "true",
    QRS_TEST_PMAX_ALLOWED_ACTIONS: "pmax_create",
    QRS_TEST_PMAX_CAMPAIGN_NAME: campaignName,
    QRS_TEST_PMAX_FINAL_URL: "https://mcp.holymedia.kz/",
    QRS_TEST_PMAX_CONVERSION_ACTION_ID: "5",
    QRS_TEST_PMAX_GEO_ID: "100",
    QRS_TEST_PMAX_LANGUAGE_ID: "1031",
    QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED: "false",
    QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: account,
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_API_VERSION: "v24",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  });
  Object.assign(f.adapter, { config: isolated });
  Object.assign(f.previews, { config: isolated });
  const raw = { action: "pmax_create", items: [{ brief }] };
  const preview = () => f.call("google_ads_pmax_preview", raw);
  const plan = () => f.previewsRows.at(-1)!.requestedState as ExtendedPlan;
  const commit = (p: Record<string, unknown>) =>
    f.previews.commit(principal, String(p.preview_token));
  const mutations = () =>
    f.requests.filter(
      (request) =>
        request.url.endsWith("/googleAds:mutate") &&
        request.body.validateOnly === false,
    );
  return { ...f, isolated, raw, brief, preview, plan, commit, mutations };
}

describe("isolated TEST PMax gate", () => {
  it("binds a real PMax search-theme profile to one PAUSED parent and exact owner-selected text", async () => {
    const f = await prepared();
    Object.assign(object(f.resources.get(`${prefix}/campaigns/1`)?.campaign), {
      advertisingChannelType: "PERFORMANCE_MAX",
      status: "PAUSED",
    });
    f.resources.set(`${prefix}/assetGroups/5`, {
      assetGroup: {
        id: "5",
        resourceName: `${prefix}/assetGroups/5`,
        campaign: `${prefix}/campaigns/1`,
        status: "PAUSED",
        name: "PAUSED MOCK group",
      },
    });
    const config: AppConfig = {
      ...f.isolated,
      qrsTestPmaxAllowedActions: [
        "pmax_search_theme_add",
        "pmax_signal_remove",
      ],
      qrsTestPmaxCampaignName: undefined,
      qrsTestPmaxParentCampaignId: "1",
      qrsTestPmaxParentAssetGroupId: "5",
      qrsTestPmaxSearchTheme: "personal AI marketer",
    };
    Object.assign(f.adapter, { config });
    Object.assign(f.previews, { config });
    const add = {
      action: "pmax_search_theme_add",
      items: [
        {
          campaign_id: "1",
          asset_group_id: "5",
          search_theme: "personal AI marketer",
        },
      ],
    };
    const preview = await f.call("google_ads_pmax_preview", add);
    expect(preview.provider_validation).toBe("passed");
    expect(qrsPmaxWriteAllowed(config, f.plan())).toBe(true);
    await expect(f.commit(preview)).rejects.toMatchObject({
      code: "preview_not_confirmed",
    });
    await f.approve(preview);
    expect((await f.commit(preview)).status).toBe("VERIFIED");
    expect(f.mutations()).toHaveLength(1);
    const wrongTheme = {
      ...add,
      items: [{ ...add.items[0], search_theme: "unapproved theme" }],
    };
    expect(qrsPmaxIntentAllowed(config, account, wrongTheme)).toBe(false);
    await expect(
      f.call("google_ads_pmax_preview", wrongTheme),
    ).rejects.toThrow();

    // A removal is a different, explicitly acknowledged preview and approval.
    const signal = [...f.resources.values()]
      .map((entry) => object(entry.assetGroupSignal))
      .find(
        (entry) => object(entry.searchTheme).text === "personal AI marketer",
      )!;
    const signalId = String(signal.id);
    const restoredResource = `${prefix}/assetGroupSignals/5~${signalId}`;
    f.resources.delete(String(signal.resourceName));
    f.resources.set(restoredResource, {
      assetGroupSignal: {
        ...signal,
        resourceName: restoredResource,
        id: signalId,
      },
    });
    const remove = {
      action: "pmax_signal_remove",
      items: [
        {
          campaign_id: "1",
          asset_group_id: "5",
          signal_id: signalId,
          acknowledge_irreversible: true,
        },
      ],
    };
    const removal = await f.call("google_ads_pmax_preview", remove);
    expect(removal.provider_validation).toBe("passed");
    expect(qrsPmaxWriteAllowed(config, f.plan())).toBe(true);
    await expect(f.commit(removal)).rejects.toMatchObject({
      code: "preview_not_confirmed",
    });
    expect(f.mutations()).toHaveLength(1);
    await f.approve(removal);
    expect((await f.commit(removal)).status).toBe("VERIFIED");
    expect(f.mutations()).toHaveLength(2);
  });

  it("permits only a PAUSED owned asset-group name edit and separate approved restoration", async () => {
    const f = await prepared();
    const campaign = object(f.resources.get(`${prefix}/campaigns/1`)?.campaign);
    Object.assign(campaign, {
      advertisingChannelType: "PERFORMANCE_MAX",
      status: "PAUSED",
    });
    f.resources.set(`${prefix}/assetGroups/5`, {
      assetGroup: {
        id: "5",
        resourceName: `${prefix}/assetGroups/5`,
        campaign: `${prefix}/campaigns/1`,
        status: "PAUSED",
        name: "Original MOCK group",
        finalUrls: ["https://example.com/"],
      },
    });
    const config: AppConfig = {
      ...f.isolated,
      qrsTestPmaxAllowedActions: ["asset_group_update"],
      qrsTestPmaxCampaignName: undefined,
      qrsTestPmaxParentCampaignId: "1",
      qrsTestPmaxParentAssetGroupId: "5",
    };
    Object.assign(f.adapter, { config });
    Object.assign(f.previews, { config });
    const input = (name: string) => ({
      action: "asset_group_update",
      items: [{ campaign_id: "1", asset_group_id: "5", name }],
    });
    const edit = await f.call(
      "google_ads_pmax_preview",
      input("Edited MOCK group"),
    );
    expect(edit.provider_validation).toBe("passed");
    expect(qrsPmaxWriteAllowed(config, f.plan())).toBe(true);
    await f.approve(edit);
    expect((await f.commit(edit)).status).toBe("VERIFIED");
    expect(
      object(f.resources.get(`${prefix}/assetGroups/5`)?.assetGroup).name,
    ).toBe("Edited MOCK group");
    const restore = await f.call(
      "google_ads_pmax_preview",
      input("Original MOCK group"),
    );
    expect(restore.provider_validation).toBe("passed");
    await expect(f.commit(restore)).rejects.toMatchObject({
      code: "preview_not_confirmed",
    });
    expect(
      object(f.resources.get(`${prefix}/assetGroups/5`)?.assetGroup).name,
    ).toBe("Edited MOCK group");
    await f.approve(restore);
    expect((await f.commit(restore)).status).toBe("VERIFIED");
    expect(
      object(f.resources.get(`${prefix}/assetGroups/5`)?.assetGroup).name,
    ).toBe("Original MOCK group");
    expect(f.mutations()).toHaveLength(2);
    for (const unsupported of [
      {
        ...input("Unsafe"),
        items: [
          {
            campaign_id: "1",
            asset_group_id: "5",
            name: "Unsafe",
            status: "ENABLED",
          },
        ],
      },
      {
        ...input("Unsafe"),
        items: [
          {
            campaign_id: "1",
            asset_group_id: "5",
            name: "Unsafe",
            final_url: "https://example.com/",
          },
        ],
      },
      {
        ...input("Unsafe"),
        items: [{ campaign_id: "2", asset_group_id: "5", name: "Unsafe" }],
      },
    ]) {
      expect(qrsPmaxIntentAllowed(config, account, unsupported)).toBe(false);
      await expect(
        f.call("google_ads_pmax_preview", unsupported),
      ).rejects.toThrow();
    }
    expect(f.mutations()).toHaveLength(2);
  });

  it("validates bounded negative, audience, brand and image-link previews without writing", async () => {
    for (const profile of [
      {
        action: "pmax_negative_add",
        item: { campaign_id: "1", text: "mock unrelated", match_type: "EXACT" },
        binding: { qrsTestPmaxNegativeText: "mock unrelated" },
      },
      {
        action: "pmax_audience_signal_add",
        item: { campaign_id: "1", asset_group_id: "5", audience_id: "9" },
        binding: { qrsTestPmaxAudienceId: "9" },
      },
      {
        action: "pmax_brand_exclude",
        item: { campaign_id: "1", shared_set_id: "8" },
        binding: { qrsTestPmaxBrandSharedSetId: "8" },
      },
      {
        action: "pmax_asset_attach",
        item: {
          campaign_id: "1",
          asset_group_id: "5",
          asset_id: "50",
          field_type: "MARKETING_IMAGE",
        },
        binding: {
          qrsTestPmaxAssetId: "50",
          qrsTestPmaxAssetFieldType: "MARKETING_IMAGE",
        },
      },
    ] as const) {
      const f = await prepared();
      Object.assign(
        object(f.resources.get(`${prefix}/campaigns/1`)?.campaign),
        {
          advertisingChannelType: "PERFORMANCE_MAX",
          status: "PAUSED",
        },
      );
      f.resources.set(`${prefix}/assetGroups/5`, {
        assetGroup: {
          id: "5",
          resourceName: `${prefix}/assetGroups/5`,
          campaign: `${prefix}/campaigns/1`,
          status: "PAUSED",
          name: "MOCK group",
        },
      });
      f.resources.set(`${prefix}/audiences/9`, {
        audience: {
          id: "9",
          resourceName: `${prefix}/audiences/9`,
          status: "ENABLED",
        },
      });
      f.resources.set(`${prefix}/sharedSets/8`, {
        sharedSet: {
          id: "8",
          resourceName: `${prefix}/sharedSets/8`,
          type: "BRANDS",
          status: "ENABLED",
        },
      });
      const config: AppConfig = {
        ...f.isolated,
        qrsTestPmaxAllowedActions: [profile.action],
        qrsTestPmaxCampaignName: undefined,
        qrsTestPmaxParentCampaignId: "1",
        qrsTestPmaxParentAssetGroupId: "5",
        ...profile.binding,
      };
      Object.assign(f.adapter, { config });
      Object.assign(f.previews, { config });
      const input = { action: profile.action, items: [profile.item] };
      expect(qrsPmaxIntentAllowed(config, account, input)).toBe(true);
      const preview = await f.call("google_ads_pmax_preview", input);
      expect(preview.provider_validation).toBe("passed");
      expect(qrsPmaxWriteAllowed(config, f.plan())).toBe(true);
      expect(f.mutations()).toHaveLength(0);
      await expect(f.commit(preview)).rejects.toMatchObject({
        code: "preview_not_confirmed",
      });
      expect(f.mutations()).toHaveLength(0);
    }
  });

  it("allows one PAUSED fixture only after validation and human approval, then denies replay", async () => {
    const f = await prepared();
    expect(qrsPmaxIntentAllowed(f.isolated, account, f.raw)).toBe(true);
    const p = await f.preview();
    expect(p.provider_validation).toBe("passed");
    expect(f.counts().write).toBe(0);
    expect(qrsPmaxWriteAllowed(f.isolated, f.plan())).toBe(true);
    await expect(f.commit(p)).rejects.toMatchObject({
      code: "preview_not_confirmed",
    });
    expect(f.counts().write).toBe(0);
    await f.approve(p);
    const result = await f.commit(p);
    expect(result).toMatchObject({ status: "VERIFIED", atomic: true });
    expect(f.mutations()).toHaveLength(1);
    const campaign = [...f.resources.values()]
      .map((entry) => object(entry.campaign))
      .find((entry) => entry.name === campaignName)!;
    expect(campaign.status).toBe("PAUSED");
    expect(
      [...f.resources.values()]
        .map((entry) => object(entry.assetGroup))
        .filter((entry) => entry.campaign === campaign.resourceName)
        .every((entry) => entry.status === "PAUSED"),
    ).toBe(true);
    await expect(f.commit(p)).rejects.toThrow();
    expect(f.mutations()).toHaveLength(1);
  });

  it("denies expired preview and a foreign workspace before any provider write", async () => {
    const f = await prepared();
    const p = await f.preview();
    await f.approve(p);
    await expect(
      f.previews.commit(
        { ...principal, workspaceId: "other-workspace" },
        String(p.preview_token),
      ),
    ).rejects.toThrow();
    f.previewsRows.at(-1)!.expiresAt = new Date(0);
    await expect(f.commit(p)).rejects.toMatchObject({
      code: "preview_expired",
    });
    expect(f.mutations()).toHaveLength(0);
  });

  it("blocks stale source at service and independently at adapter", async () => {
    const f = await prepared();
    const p = await f.preview();
    await f.approve(p);
    object(
      f.resources.get(`${prefix}/conversionActions/5`)?.conversionAction,
    ).name = "Changed MOCK action";
    await expect(
      f.adapter.extended(f.context, 4, "commit", f.plan()),
    ).rejects.toMatchObject({ writeCode: "google_preview_stale" });
    await expect(f.commit(p)).rejects.toMatchObject({
      code: "google_preview_stale",
    });
    expect(f.mutations()).toHaveLength(0);
  });

  it("rejects foreign accounts, unsupported Stage 4 profiles, ENABLED delivery and production drift", async () => {
    const f = await prepared();
    const p = await f.preview();
    const plan = f.plan();
    expect(qrsPmaxWriteAllowed(f.isolated, plan)).toBe(true);
    for (const unsafeBrief of [
      { business_name: "Agency" },
      { daily_budget: { amount: "20", currency: "USD" } },
      { conversion_actions: ["99"] },
      { locations: [{ geo_target_id: "999" }] },
      {
        asset_groups: [
          { ...f.brief.asset_groups[0], final_url: "https://holymedia.kz/" },
        ],
      },
    ]) {
      const unsafe = {
        action: "pmax_create",
        items: [{ brief: { ...f.brief, ...unsafeBrief } }],
      };
      expect(qrsPmaxIntentAllowed(f.isolated, account, unsafe)).toBe(false);
      expect(
        qrsPmaxWriteAllowed(f.isolated, {
          ...plan,
          intent: unsafe,
        }),
      ).toBe(false);
    }
    // The isolated TEST Docker container intentionally uses NODE_ENV=production.
    expect(
      qrsPmaxWriteAllowed({ ...f.isolated, environment: "production" }, plan),
    ).toBe(true);
    for (const mutation of [
      { ...plan, account_id: "4378327049" },
      { ...plan, intent: { ...plan.intent, action: "pmax_negative_add" } },
      {
        ...plan,
        operations: plan.operations.map((op) =>
          op.kind === "campaigns"
            ? { ...op, fields: { ...op.fields, status: "ENABLED" } }
            : op,
        ),
      },
      {
        ...plan,
        operations: plan.operations.map((op) =>
          op.kind === "assetGroups"
            ? { ...op, fields: { ...op.fields, status: "ENABLED" } }
            : op,
        ),
      },
      { ...plan, operations: [{ ...plan.operations[0]!, kind: "adGroupAds" }] },
    ]) {
      expect(qrsPmaxWriteAllowed(f.isolated, mutation)).toBe(false);
      await expect(
        f.adapter.extended(f.context, 4, "commit", mutation),
      ).rejects.toThrow();
    }
    for (const drift of [
      { publicBaseUrl: "https://mcp.holymedia.kz" },
      { googleAdsWriteAccountAllowlist: ["4378327049"] },
      { qrsTestPmaxConfirmedWriteEnabled: false },
      { confirmedWriteEnabled: true },
      { providerGoogleAdsStage4WriteEnabled: true },
      { publicMcpControlledWriteEnabled: true },
    ] satisfies Partial<AppConfig>[])
      expect(qrsPmaxWriteAllowed({ ...f.isolated, ...drift }, plan)).toBe(
        false,
      );
    expect(f.mutations()).toHaveLength(0);
    expect(p.provider_validation).toBe("passed");
  });

  it("leaves an ambiguous response unverified and never retries the consumed preview", async () => {
    const f = await prepared();
    const p = await f.preview();
    await f.approve(p);
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const response = await originalFetch(url, init);
        if (
          url.endsWith("/googleAds:mutate") &&
          JSON.parse(String(init?.body)).validateOnly === false
        )
          throw new Error("lost response after provider mutation");
        return response;
      }),
    );
    const result = await f.commit(p);
    expect(result.status).not.toBe("VERIFIED");
    expect(f.mutations()).toHaveLength(1);
    await expect(f.commit(p)).rejects.toThrow();
    expect(f.mutations()).toHaveLength(1);
  });
});

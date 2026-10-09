import { describe, expect, it, vi } from "vitest";
import {
  buildStage4Plan,
  parseStage4Intent,
  stage4CapabilityMatrix,
} from "./google-ads-stage4.js";
import {
  extendedProviderOperation,
  verifyExtendedMutation,
} from "./google-ads-extended-plan.js";
import {
  stage4ToolSchema,
  stage4ToolIntent,
} from "../mcp/mcp-google-stage4-schema.js";
const account = "8590146099",
  prefix = `customers/${account}`;
const customer = {
  resourceName: prefix,
  id: account,
  currencyCode: "USD",
  timeZone: "Asia/Almaty",
  finalUrlSuffix: "old=1",
  trackingUrlTemplate: "https://example.com/?u={lpurl}",
};
const campaign = {
  resourceName: `${prefix}/campaigns/1`,
  id: "1",
  name: "Test",
  status: "PAUSED",
  advertisingChannelType: "SEARCH",
  networkSettings: {
    targetGoogleSearch: true,
    targetSearchNetwork: false,
    targetContentNetwork: false,
    targetPartnerSearchNetwork: false,
  },
  finalUrlSuffix: "old=1",
};
const group = {
  resourceName: `${prefix}/adGroups/2`,
  id: "2",
  campaign: campaign.resourceName,
  name: "Test group",
  status: "PAUSED",
  type: "SEARCH_STANDARD",
};
const rsa = {
  final_url: "https://example.com/",
  headlines: [
    { text: "Headline one", pinned_field: "HEADLINE_1" },
    { text: "Headline two" },
    { text: "Headline three" },
  ],
  descriptions: [{ text: "Description one" }, { text: "Description two" }],
  path1: "test",
};
const ad = {
  resourceName: `${prefix}/ads/3`,
  id: "3",
  finalUrls: [rsa.final_url],
  responsiveSearchAd: {
    headlines: rsa.headlines.map((h) => ({
      text: h.text,
      ...(h.pinned_field ? { pinnedField: h.pinned_field } : {}),
    })),
    descriptions: rsa.descriptions,
    path1: "test",
  },
};
const groupAd = {
  resourceName: `${prefix}/adGroupAds/2~3`,
  adGroup: group.resourceName,
  status: "PAUSED",
  ad,
};
const asset = {
  resourceName: `${prefix}/assets/4`,
  type: "IMAGE",
  imageAsset: { fullSize: { widthPixels: 1200, heightPixels: 1200 } },
};
const assetGroup = {
  resourceName: `${prefix}/assetGroups/5`,
  id: "5",
  campaign: campaign.resourceName,
  status: "PAUSED",
  name: "PMax group",
  finalUrls: ["https://example.com/"],
};
function fixture(overrides: Record<string, unknown> = {}) {
  const data = {
    customer,
    campaign,
    group,
    groupAd,
    asset,
    assetGroup,
    assetGroupLinks: [] as Record<string, unknown>[],
    ...overrides,
  };
  return vi.fn(async (q: string): Promise<Record<string, unknown>[]> => {
    if (q.includes(" FROM customer")) return [{ customer: data.customer }];
    if (
      q.includes(" FROM campaign_asset") ||
      q.includes(" FROM ad_group_asset") ||
      q.includes(" FROM customer_asset")
    )
      return [];
    if (q.includes(" FROM campaign ")) return [{ campaign: data.campaign }];
    if (q.includes(" FROM ad_group ")) return [{ adGroup: data.group }];
    if (q.includes(" FROM ad_group_ad ")) return [{ adGroupAd: data.groupAd }];
    if (q.includes(" FROM asset_group_asset"))
      return data.assetGroupLinks as Record<string, unknown>[];
    if (q.includes(" FROM asset_group_signal")) return [];
    if (q.includes(" FROM asset_group "))
      return [{ assetGroup: data.assetGroup }];
    if (q.includes(" FROM asset ")) return [{ asset: data.asset }];
    if (q.includes(" FROM audience "))
      return [
        {
          audience: {
            resourceName: `${prefix}/audiences/6`,
            status: "ENABLED",
          },
        },
      ];
    return [];
  });
}
const intent = (action: string, items: Record<string, unknown>[]) => ({
  provider: "GOOGLE_ADS",
  account_id: account,
  action,
  items,
});
describe("Stage 4 typed provider plans — mock only", () => {
  it("campaign PAUSE cannot promise inverse that bypasses resume checklist", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("campaign_update", [{ campaign_id: "1", status: "PAUSED" }]),
      fixture({ campaign: { ...campaign, status: "ENABLED" } }),
    );
    expect(plan.operations[0]!.expected.status).toBe("PAUSED");
    expect(plan.inverse_intent).toBeUndefined();
  });
  it.each([
    "HEADLINE",
    "LONG_HEADLINE",
    "DESCRIPTION",
    "MARKETING_IMAGE",
    "SQUARE_MARKETING_IMAGE",
  ])(
    "PMax existing %s reference creates PAUSED exact association",
    async (fieldType) => {
      const text = ["HEADLINE", "LONG_HEADLINE", "DESCRIPTION"].includes(
          fieldType,
        ),
        a = text
          ? {
              resourceName: asset.resourceName,
              type: "TEXT",
              textAsset: { text: "Existing supplied copy" },
            }
          : {
              ...asset,
              imageAsset: {
                fullSize: {
                  widthPixels: 1200,
                  heightPixels: fieldType === "MARKETING_IMAGE" ? 628 : 1200,
                },
              },
            };
      const plan = await buildStage4Plan(
        account,
        intent("pmax_asset_attach", [
          {
            campaign_id: "1",
            asset_group_id: "5",
            asset_id: "4",
            field_type: fieldType,
          },
        ]),
        fixture({
          campaign: { ...campaign, advertisingChannelType: "PERFORMANCE_MAX" },
          asset: a,
        }),
      );
      expect(plan.operations).toHaveLength(1);
      expect(plan.operations[0]!.kind).toBe("assetGroupAssets");
      expect(plan.operations[0]!.fields).toEqual({
        assetGroup: assetGroup.resourceName,
        asset: asset.resourceName,
        fieldType,
        status: "PAUSED",
      });
      expect(extendedProviderOperation(plan.operations[0]!)).toEqual({
        assetGroupAssetOperation: { create: plan.operations[0]!.fields },
      });
      expect(plan.inverse_intent).toBeUndefined();
      expect(
        plan.checks.some((c) => c.query.includes("FROM asset_group_asset")),
      ).toBe(true);
    },
  );
  it("PMax existing association duplicates, parent mismatch and foreign references rejected", async () => {
    const row = {
        campaign_id: "1",
        asset_group_id: "5",
        asset_id: "4",
        field_type: "HEADLINE",
      },
      link = {
        resourceName: `${prefix}/assetGroupAssets/5~4~HEADLINE`,
        assetGroup: assetGroup.resourceName,
        asset: asset.resourceName,
        fieldType: "HEADLINE",
        status: "ENABLED",
      },
      config = {
        campaign: { ...campaign, advertisingChannelType: "PERFORMANCE_MAX" },
        asset: {
          resourceName: asset.resourceName,
          type: "TEXT",
          textAsset: { text: "Test" },
        },
      };
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [row]),
        fixture({ ...config, assetGroupLinks: [{ assetGroupAsset: link }] }),
      ),
    ).rejects.toThrow(/уже существует/);
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [row]),
        fixture({
          ...config,
          assetGroupLinks: [
            {
              assetGroupAsset: {
                ...link,
                assetGroup: `${prefix}/assetGroups/99`,
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/parent mismatch/);
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [row]),
        fixture({
          ...config,
          assetGroupLinks: [
            {
              assetGroupAsset: {
                ...link,
                asset: "customers/9999999999/assets/4",
              },
            },
          ],
        }),
      ),
    ).rejects.toThrow(/не принадлежит/);
  });
  it("PMax TEXT limits and wrong asset type rejected before mutation", async () => {
    const row = {
        campaign_id: "1",
        asset_group_id: "5",
        asset_id: "4",
        field_type: "HEADLINE",
      },
      config = {
        campaign: { ...campaign, advertisingChannelType: "PERFORMANCE_MAX" },
      };
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [row]),
        fixture({
          ...config,
          asset: {
            resourceName: asset.resourceName,
            type: "TEXT",
            textAsset: { text: "x".repeat(31) },
          },
        }),
      ),
    ).rejects.toThrow(/максимум/);
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [row]),
        fixture(config),
      ),
    ).rejects.toThrow(/Тип Google asset/);
  });
  it("PMax square metadata and minimum image dimensions guarded", async () => {
    const row = {
        campaign_id: "1",
        asset_group_id: "5",
        asset_id: "4",
        field_type: "SQUARE_MARKETING_IMAGE",
      },
      config = {
        campaign: { ...campaign, advertisingChannelType: "PERFORMANCE_MAX" },
      };
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [row]),
        fixture({
          ...config,
          asset: {
            ...asset,
            imageAsset: { fullSize: { widthPixels: 1200, heightPixels: 628 } },
          },
        }),
      ),
    ).rejects.toThrow(/квадрат/);
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [
          { ...row, field_type: "MARKETING_IMAGE" },
        ]),
        fixture({
          ...config,
          asset: {
            ...asset,
            imageAsset: { fullSize: { widthPixels: 599, heightPixels: 314 } },
          },
        }),
      ),
    ).rejects.toThrow(/минимум/);
  });
  it("PMax active parent profile and brand role rejected without hidden activation", async () => {
    const row = {
      campaign_id: "1",
      asset_group_id: "5",
      asset_id: "4",
      field_type: "SQUARE_MARKETING_IMAGE",
    };
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [row]),
        fixture({
          campaign: {
            ...campaign,
            status: "ENABLED",
            advertisingChannelType: "PERFORMANCE_MAX",
          },
          assetGroup: { ...assetGroup, status: "ENABLED" },
        }),
      ),
    ).rejects.toThrow(/PAUSED/);
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [{ ...row, field_type: "BUSINESS_NAME" }]),
        fixture({
          campaign: { ...campaign, advertisingChannelType: "PERFORMANCE_MAX" },
        }),
      ),
    ).rejects.toThrow(/Brand logos/);
  });
  it("PMax field type maximum and duplicated batch cannot be truncated", async () => {
    const row = {
        campaign_id: "1",
        asset_group_id: "5",
        asset_id: "4",
        field_type: "HEADLINE",
      },
      config = {
        campaign: { ...campaign, advertisingChannelType: "PERFORMANCE_MAX" },
        asset: {
          resourceName: asset.resourceName,
          type: "TEXT",
          textAsset: { text: "Test" },
        },
      };
    const links = Array.from({ length: 15 }, (_, i) => ({
      assetGroupAsset: {
        resourceName: `${prefix}/assetGroupAssets/5~${100 + i}~HEADLINE`,
        assetGroup: assetGroup.resourceName,
        asset: `${prefix}/assets/${100 + i}`,
        fieldType: "HEADLINE",
        status: "ENABLED",
      },
    }));
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [row]),
        fixture({ ...config, assetGroupLinks: links }),
      ),
    ).rejects.toThrow(/asset limit/);
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_attach", [row, row]),
        fixture(config),
      ),
    ).rejects.toThrow(/Duplicate/);
  });
  it("PMax detach refuses before provider read until minimum remaining graph proven", async () => {
    const read = fixture();
    await expect(
      buildStage4Plan(
        account,
        intent("pmax_asset_detach", [
          {
            campaign_id: "1",
            asset_group_id: "5",
            asset_id: "4",
            field_type: "HEADLINE",
            acknowledge_irreversible: true,
          },
        ]),
        read,
      ),
    ).rejects.toThrow(/minimum remaining/);
    expect(read).not.toHaveBeenCalled();
  });
  it("wide-character RSA and asset limits fail before any reader", async () => {
    for (const [action, items] of [
      [
        "rsa_create",
        [
          {
            campaign_id: "1",
            ad_group_id: "2",
            rsa: {
              ...rsa,
              headlines: [{ text: "界".repeat(16) }, ...rsa.headlines.slice(1)],
            },
          },
        ],
      ],
      [
        "asset_create",
        [
          {
            campaign_id: "1",
            level: "campaign",
            assets: { callouts: ["界".repeat(13)] },
          },
        ],
      ],
    ] as [string, Record<string, unknown>[]][]) {
      const read = fixture();
      await expect(
        buildStage4Plan(account, intent(action, items), read),
      ).rejects.toThrow(/максимум/);
      expect(read).not.toHaveBeenCalled();
    }
  });
  it("campaign activation cannot bypass existing launch checklist flow", async () => {
    await expect(
      buildStage4Plan(
        account,
        intent("campaign_update", [{ campaign_id: "1", status: "ENABLED" }]),
        fixture(),
      ),
    ).rejects.toThrow(/preview_resume_campaign/);
  });
  it("immutable payload is cloned, caller mutation cannot replace RSA", async () => {
    const input = intent("rsa_create", [
      {
        campaign_id: "1",
        ad_group_id: "2",
        rsa: {
          ...rsa,
          headlines: [
            { text: "Immutable headline" },
            ...rsa.headlines.slice(1),
          ],
        },
      },
    ]);
    const plan = await buildStage4Plan(account, input, fixture());
    input.items[0]!.rsa = {};
    expect(plan.operations[0]!.fields.ad).toHaveProperty(
      "responsiveSearchAd.headlines.0.text",
      "Immutable headline",
    );
  });
  it("missing IMAGE dimensions reject reference before provider mutation", async () => {
    await expect(
      buildStage4Plan(
        account,
        intent("asset_attach", [
          {
            level: "campaign",
            campaign_id: "1",
            asset_id: "4",
            field_type: "AD_IMAGE",
          },
        ]),
        fixture({ asset: { resourceName: asset.resourceName, type: "IMAGE" } }),
      ),
    ).rejects.toThrow(/dimensions/);
  });
  it("more than 500 underlying mutations rejected without truncation", async () => {
    const items = Array.from({ length: 6 }, (_, n) => ({
      level: "campaign",
      campaign_id: "1",
      assets: {
        callouts: Array.from({ length: 50 }, (_, i) => `Callout ${n} ${i}`),
      },
    }));
    await expect(
      buildStage4Plan(account, intent("asset_create", items), fixture()),
    ).rejects.toThrow(/immutable extension plan/);
  });
  it("wrong customer and missing parent prevent entire plan", async () => {
    await expect(
      buildStage4Plan(
        account,
        intent("campaign_update", [{ campaign_id: "1", name: "Safe" }]),
        fixture({ customer: { ...customer, id: "9999999999" } }),
      ),
    ).rejects.toThrow(/Customer proof/);
    await expect(
      buildStage4Plan(
        account,
        intent("asset_attach", [
          { level: "campaign", asset_id: "4", field_type: "AD_IMAGE" },
        ]),
        fixture(),
      ),
    ).rejects.toThrow(/campaign_id/);
  });
  it("invalid tracking placeholders and dates fail safely", async () => {
    await expect(
      buildStage4Plan(
        account,
        intent("tracking_update", [
          {
            level: "campaign",
            campaign_id: "1",
            final_url_suffix: "utm_source={unsupported}",
          },
        ]),
        fixture(),
      ),
    ).rejects.toThrow(/placeholder/);
    await expect(
      buildStage4Plan(
        account,
        intent("campaign_update", [
          { campaign_id: "1", start_date: "2026-02-30" },
        ]),
        fixture(),
      ),
    ).rejects.toThrow(/дата/);
  });
  it("K: 31-character headline rejected before provider mutation", async () => {
    const mutate = vi.fn(),
      read = fixture();
    await expect(
      buildStage4Plan(
        account,
        intent("rsa_create", [
          {
            campaign_id: "1",
            ad_group_id: "2",
            rsa: {
              ...rsa,
              headlines: [{ text: "x".repeat(31) }, ...rsa.headlines.slice(1)],
            },
          },
        ]),
        read,
      ),
    ).rejects.toThrow(/headlines|headline/);
    expect(mutate).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("L: valid new RSA PAUSED with pins, paths, full preview, Google operation and verified reread", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("rsa_create", [
        {
          campaign_id: "1",
          ad_group_id: "2",
          rsa: {
            ...rsa,
            headlines: [{ text: "New headline" }, ...rsa.headlines.slice(1)],
          },
        },
      ]),
      fixture(),
    );
    const op = plan.operations[0]!;
    expect(op.fields.status).toBe("PAUSED");
    expect(op.before).toBeNull();
    expect(op.expected).toEqual(op.fields);
    expect(extendedProviderOperation(op)).toEqual({
      adGroupAdOperation: { create: op.fields },
    });
    const actual = { ...op.fields, resourceName: `${prefix}/adGroupAds/2~9` };
    const result = await verifyExtendedMutation(
      plan,
      [
        {
          success: true,
          resource_name: String(actual.resourceName),
          error: null,
        },
      ],
      async (q) =>
        q.includes("FROM ad_group_ad") ? [{ adGroupAd: actual }] : fixture()(q),
    );
    expect(result.status).toBe("VERIFIED");
  });
  it("uses AdService for RSA edits, exact mask and moderation warning", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("rsa_update", [
        {
          campaign_id: "1",
          ad_group_id: "2",
          ad_id: "3",
          rsa: { ...rsa, final_url: "https://example.com/changed" },
        },
      ]),
      fixture(),
    );
    expect(plan.operations[0]!.kind).toBe("ads");
    expect(plan.operations[0]!.response_key).toBe("adGroupAd.ad");
    expect(extendedProviderOperation(plan.operations[0]!)).toHaveProperty(
      "adOperation.update.responsiveSearchAd",
    );
    expect(plan.items[0]!.warnings.join(" ")).toContain("модерация");
  });
  it("status inverse changes only status and preserves identity/content", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("ad_status", [
        { campaign_id: "1", ad_group_id: "2", ad_id: "3", status: "ENABLED" },
      ]),
      fixture(),
    );
    expect(plan.operations[0]!.fields).toEqual({
      resourceName: groupAd.resourceName,
      status: "ENABLED",
    });
    expect(plan.inverse_intent).toMatchObject({
      items: [{ status: "PAUSED" }],
    });
    expect(plan.operations[0]!.expected.ad).toEqual(ad);
  });
  it("irreversible removal cannot proceed without explicit acknowledgement", async () => {
    const read = fixture();
    await expect(
      buildStage4Plan(
        account,
        intent("ad_remove", [
          { campaign_id: "1", ad_group_id: "2", ad_id: "3" },
        ]),
        read,
      ),
    ).rejects.toThrow(/acknowledge/);
    expect(read).not.toHaveBeenCalled();
  });
  it("removal visible irreversible and no automatic inverse", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("ad_remove", [
        {
          campaign_id: "1",
          ad_group_id: "2",
          ad_id: "3",
          acknowledge_irreversible: true,
        },
      ]),
      fixture(),
    );
    expect(plan.irreversible).toBe(true);
    expect(plan.inverse_intent).toBeUndefined();
    expect(plan.operations[0]!.method).toBe("remove");
  });
  it.each([
    "sitelinks",
    "callouts",
    "structured_snippets",
    "call",
    "business_name",
  ])(
    "creates supported %s assets and associations in atomic temporary graph",
    async (type) => {
      const input: Record<string, unknown> = {
        sitelinks: [{ text: "More", final_url: "https://example.com/more" }],
        callouts: ["Test callout"],
        structured_snippets: [
          { header: "Services", values: ["One", "Two", "Three"] },
        ],
        call: { country_code: "KZ", phone_number: "+7 700 000 0000" },
        business_name: "Test company",
      };
      const plan = await buildStage4Plan(
        account,
        intent("asset_create", [
          {
            campaign_id: "1",
            level: "campaign",
            assets: { [type]: input[type] },
          },
        ]),
        fixture(),
      );
      expect(plan.atomic).toBe(true);
      expect(plan.operations).toHaveLength(2);
      expect(plan.operations[1]!.fields.asset).toBe(
        plan.operations[0]!.resource_name,
      );
    },
  );
  it("existing image reference checked for account and type", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("asset_attach", [
        {
          campaign_id: "1",
          level: "campaign",
          asset_id: "4",
          field_type: "BUSINESS_LOGO",
        },
      ]),
      fixture(),
    );
    expect(plan.operations[0]!.fields).toMatchObject({
      asset: asset.resourceName,
      fieldType: "BUSINESS_LOGO",
    });
    await expect(
      buildStage4Plan(
        account,
        intent("asset_attach", [
          {
            campaign_id: "1",
            level: "campaign",
            asset_id: "4",
            field_type: "SITELINK",
          },
        ]),
        fixture(),
      ),
    ).rejects.toThrow(/type/);
  });
  it("ad group create always PAUSED and duplicate name rejected", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("ad_group_create", [{ campaign_id: "1", name: "New group" }]),
      fixture(),
    );
    expect(plan.operations[0]!.fields.status).toBe("PAUSED");
    await expect(
      buildStage4Plan(
        account,
        intent("ad_group_create", [{ campaign_id: "1", name: "Test group" }]),
        fixture(),
      ),
    ).rejects.toThrow(/уже/);
  });
  it("campaign rename reversible, adjacent networks preserved", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("campaign_update", [
        { campaign_id: "1", name: "New campaign name" },
      ]),
      fixture(),
    );
    expect(plan.operations[0]!.update_mask).toBe("name");
    expect(plan.operations[0]!.expected.networkSettings).toEqual(
      campaign.networkSettings,
    );
    expect(plan.inverse_intent).toMatchObject({ items: [{ name: "Test" }] });
  });
  it("network changes use leaf masks without replacing neighbours", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("campaign_update", [
        { campaign_id: "1", networks: { search_partners: true } },
      ]),
      fixture(),
    );
    expect(plan.operations[0]!.update_mask).toBe(
      "network_settings.target_search_network",
    );
    expect(plan.operations[0]!.fields.networkSettings).toEqual({
      targetSearchNetwork: true,
    });
    expect(plan.operations[0]!.expected.networkSettings).toEqual({
      ...campaign.networkSettings,
      targetSearchNetwork: true,
    });
  });
  it.each(["account", "campaign", "ad_group"])(
    "tracking %s uses exact field only and never modifies landing URLs",
    async (level) => {
      const plan = await buildStage4Plan(
        account,
        intent("tracking_update", [
          {
            level,
            ...(level !== "account" ? { campaign_id: "1" } : {}),
            ...(level === "ad_group" ? { ad_group_id: "2" } : {}),
            final_url_suffix: "utm_source=test",
          },
        ]),
        fixture(),
      );
      expect(plan.operations[0]!.update_mask).toBe("final_url_suffix");
      expect(plan.operations[0]!.fields).not.toHaveProperty("finalUrls");
      expect(plan.operations[0]!.fields).not.toHaveProperty(
        "trackingUrlTemplate",
      );
    },
  );
  it.each(["http://127.0.0.1/test", "https://name:password@example.com/"])(
    "unsafe landing URL rejected: %s",
    async (url) => {
      await expect(
        buildStage4Plan(
          account,
          intent("rsa_create", [
            {
              campaign_id: "1",
              ad_group_id: "2",
              rsa: { ...rsa, final_url: url },
            },
          ]),
          fixture(),
        ),
      ).rejects.toThrow();
    },
  );
  it("foreign resource parent and duplicate identity reject whole plan", async () => {
    await expect(
      buildStage4Plan(
        account,
        intent("ad_status", [
          { campaign_id: "1", ad_group_id: "2", ad_id: "3", status: "ENABLED" },
        ]),
        fixture({
          group: { ...group, campaign: "customers/9999999999/campaigns/1" },
        }),
      ),
    ).rejects.toThrow(/принадлежит/);
    await expect(
      buildStage4Plan(
        account,
        intent(
          "ad_status",
          Array(2).fill({
            campaign_id: "1",
            ad_group_id: "2",
            ad_id: "3",
            status: "ENABLED",
          }),
        ),
        fixture(),
      ),
    ).rejects.toThrow(/Duplicate/);
  });
  it("rejects arbitrary provider request, binary ingestion and unknown fields", () => {
    expect(() =>
      parseStage4Intent({
        action: "rsa_create",
        items: [{ campaign_id: "1", mutateOperations: [] }],
      }),
    ).toThrow();
    expect(() =>
      parseStage4Intent({
        action: "asset_create",
        items: [
          {
            assets: { image_bytes: "fake" },
            level: "campaign",
            campaign_id: "1",
          },
        ],
      }),
    ).toThrow();
  });
  it("PMax creation explicit unsupported, no partial graph and no provider request", async () => {
    const read = fixture();
    await expect(
      buildStage4Plan(account, intent("pmax_create", [{}]), read),
    ).rejects.toThrow(/PMax creation/);
    expect(read).not.toHaveBeenCalled();
    expect(stage4CapabilityMatrix.pmax_create).toContain("UNSUPPORTED");
  });
  it("existing PMax asset group exact update preserves other fields", async () => {
    const plan = await buildStage4Plan(
      account,
      intent("asset_group_update", [
        { campaign_id: "1", asset_group_id: "5", name: "New" },
      ]),
      fixture({
        campaign: { ...campaign, advertisingChannelType: "PERFORMANCE_MAX" },
      }),
    );
    expect(plan.operations[0]!.fields).toEqual({
      resourceName: assetGroup.resourceName,
      name: "New",
    });
    expect(plan.operations[0]!.expected.finalUrls).toEqual(
      assetGroup.finalUrls,
    );
  });
  it.each(["pmax_search_theme_add", "pmax_audience_signal_add"])(
    "typed existing PMax signal %s",
    async (action) => {
      const plan = await buildStage4Plan(
        account,
        intent(action, [
          {
            campaign_id: "1",
            asset_group_id: "5",
            ...(action.includes("search")
              ? { search_theme: "test marketing" }
              : { audience_id: "6" }),
          },
        ]),
        fixture({
          campaign: { ...campaign, advertisingChannelType: "PERFORMANCE_MAX" },
        }),
      );
      expect(plan.operations[0]!.kind).toBe("assetGroupSignals");
      expect(plan.operations[0]!.fields.assetGroup).toBe(
        assetGroup.resourceName,
      );
    },
  );
  it("schema exposes bounded typed tools and adapters preserve semantics", () => {
    for (const name of [
      "google_ads_ads_assets_preview",
      "google_ads_pmax_preview",
    ]) {
      const schema = stage4ToolSchema(name)!;
      expect(schema.additionalProperties).toBe(false);
      expect(schema.properties!.items!.maxItems).toBe(100);
    }
    expect(
      stage4ToolIntent(
        "google_ads_ads_assets_preview",
        intent("rsa_create", [{ campaign_id: "1", ad_group_id: "2", rsa }]),
      ).action,
    ).toBe("rsa_create");
  });
});

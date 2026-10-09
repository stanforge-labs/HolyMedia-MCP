import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  buildStage4Plan,
  parseStage4Intent,
  stage4CapabilityMatrix,
} from "./google-ads-stage4.js";
import {
  buildPmaxCreatePlan,
  buildPmaxEditPlan,
  PMAX_ASSET_FIELDS,
  preflightPmaxBrief,
} from "./google-ads-pmax.js";
import {
  extendedProviderOperation,
  replaceExtendedTemps,
  verifyExtendedMutation,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";
import { safeMediaSummary } from "./google-ads-media.js";
import {
  stage4ToolSchema,
  stage4ToolIntent,
} from "../mcp/mcp-google-stage4-schema.js";
const account = "8590146099",
  prefix = "customers/" + account;
const customer = {
  id: account,
  resourceName: prefix,
  currencyCode: "USD",
  timeZone: "Asia/Almaty",
  conversionTrackingSetting: { googleAdsConversionCustomer: prefix },
};
const campaign = {
  id: "1",
  resourceName: prefix + "/campaigns/1",
  advertisingChannelType: "PERFORMANCE_MAX",
  brandGuidelinesEnabled: true,
  status: "PAUSED",
};
const group = {
  id: "2",
  resourceName: prefix + "/assetGroups/2",
  campaign: campaign.resourceName,
  status: "PAUSED",
  name: "Group",
  finalUrls: ["https://example.com/"],
};
const asset = (id: string, width = 1200, height = 1200) => ({
  resourceName: prefix + "/assets/" + id,
  type: "IMAGE",
  imageAsset: {
    fileSize: "10000",
    mimeType: "PNG",
    fullSize: { widthPixels: width, heightPixels: height },
  },
});
const refs = [asset("10", 1200, 628), asset("11"), asset("12", 128, 128)];
const action = {
  id: "5",
  resourceName: prefix + "/conversionActions/5",
  name: "Test lead",
  ownerCustomer: prefix,
  status: "ENABLED",
  category: "SUBMIT_LEAD_FORM",
  origin: "WEBSITE",
};
const brief = () => ({
  campaign_name: "HM PMax controlled test",
  daily_budget: { amount: "2", currency: "USD" },
  conversion_actions: ["5"],
  business_name: "HolyMedia Test",
  logos: [{ asset_id: "12" }],
  locations: [{ geo_target_id: "1000000" }],
  languages: ["1000"],
  contains_eu_political_advertising:
    "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
  asset_groups: [
    {
      name: "Test group",
      final_url: "https://example.com/",
      headlines: ["Test marketing", "Test advertising", "HolyMedia test"],
      long_headlines: ["Controlled test campaign"],
      descriptions: ["Safe test description one", "Safe test description two"],
      images: [
        { field_type: "MARKETING_IMAGE", media: { asset_id: "10" } },
        { field_type: "SQUARE_MARKETING_IMAGE", media: { asset_id: "11" } },
      ],
    },
  ],
});
function reader(opts: ExtendedRow = {}) {
  return vi.fn(async (q: string): Promise<ExtendedRow[]> => {
    if (q.includes(" FROM currency_constant"))
      return (opts.currencyRows ?? [
        {
          currencyConstant: {
            resourceName: "currencyConstants/USD",
            code: "USD",
            billableUnitMicros: "10000",
          },
        },
      ]) as ExtendedRow[];
    if (q.includes(" FROM customer_conversion_goal"))
      return [
        {
          customerConversionGoal: {
            resourceName: prefix + "/customerConversionGoals/13~2",
            category: action.category,
            origin: action.origin,
            biddable: true,
          },
        },
      ];
    if (q.includes(" FROM conversion_action"))
      return [{ conversionAction: opts.action ?? action }];
    if (q.includes("segments.conversion_action"))
      return [{ metrics: { allConversions: 2 } }];
    if (q.includes(" FROM customer"))
      return [{ customer: opts.customer ?? customer }];
    if (q.includes(" FROM geo_target_constant"))
      return [
        {
          geoTargetConstant: {
            id: "1000000",
            resourceName: "geoTargetConstants/1000000",
            name: "Almaty",
            status: "ENABLED",
          },
        },
      ];
    if (q.includes(" FROM language_constant"))
      return [
        {
          languageConstant: {
            id: "1000",
            resourceName: "languageConstants/1000",
            targetable: true,
          },
        },
      ];
    if (q.includes(" FROM campaign "))
      return q.includes("campaign.name =")
        ? []
        : [{ campaign: opts.campaign ?? campaign }];
    if (q.includes(" FROM asset_group ")) return [{ assetGroup: group }];
    if (q.includes(" FROM asset_group_asset"))
      return (opts.links ?? []) as ExtendedRow[];
    if (q.includes(" FROM campaign_asset"))
      return (opts.brandLinks ?? [
        {
          campaignAsset: {
            campaign: campaign.resourceName,
            resourceName: prefix + "/campaignAssets/1~12~LOGO",
            asset: refs[2]!.resourceName,
            fieldType: "LOGO",
            status: "ENABLED",
          },
          asset: refs[2],
        },
        {
          campaignAsset: {
            campaign: campaign.resourceName,
            resourceName: prefix + "/campaignAssets/1~13~BUSINESS_NAME",
            asset: prefix + "/assets/13",
            fieldType: "BUSINESS_NAME",
            status: "ENABLED",
          },
          asset: {
            resourceName: prefix + "/assets/13",
            type: "TEXT",
            textAsset: { text: "HolyMedia Test" },
          },
        },
      ]) as ExtendedRow[];
    if (q.includes(" FROM campaign_criterion"))
      return (opts.criteria ?? []) as ExtendedRow[];
    if (q.includes(" FROM shared_set"))
      return [
        {
          sharedSet: {
            resourceName: prefix + "/sharedSets/50",
            type: opts.sharedType ?? "BRANDS",
            status: "ENABLED",
          },
        },
      ];
    if (q.includes(" FROM asset_group_signal"))
      return (opts.signals ?? []) as ExtendedRow[];
    if (q.includes(" FROM asset ")) {
      const match = q.match(/assets\/(\d+)'/);
      return refs
        .filter((a) => a.resourceName.endsWith("/" + match?.[1]))
        .map((a) => ({ asset: a }));
    }
    throw new Error("Unmodeled query (safe mock): " + q);
  });
}
function links(extra = 0) {
  let id = 100;
  return [
    ["HEADLINE", 3 + extra, "Headline"],
    ["LONG_HEADLINE", 1, "Long headline"],
    ["DESCRIPTION", 2, "Description"],
    ["MARKETING_IMAGE", 1, null],
    ["SQUARE_MARKETING_IMAGE", 1, null],
  ].flatMap(([role, count, text]) =>
    Array.from({ length: Number(count) }, (_, index) => {
      const aid = String(++id),
        a = text
          ? {
              resourceName: prefix + "/assets/" + aid,
              type: "TEXT",
              textAsset: { text: text + " " + index },
            }
          : asset(aid, 1200, role === "MARKETING_IMAGE" ? 628 : 1200);
      return {
        assetGroupAsset: {
          resourceName: prefix + "/assetGroupAssets/2~" + aid + "~" + role,
          assetGroup: group.resourceName,
          asset: a.resourceName,
          fieldType: role,
          status: "ENABLED",
        },
        asset: a,
      };
    }),
  );
}
const edit = (name: string, row: ExtendedRow) => ({
  action: name,
  items: [
    {
      campaign_id: "1",
      asset_group_id: "2",
      acknowledge_irreversible: true,
      ...row,
    },
  ],
});
describe("v24 non-retail PMax exact atomic provider plans (mock only)", () => {
  it("creates full paused graph, actual same-account goals, atomic temp dependencies and provider-derived budget name", async () => {
    const p = await buildPmaxCreatePlan(account, brief(), reader());
    expect(p.atomic).toBe(true);
    expect(p.version).toBe(4);
    const c = p.operations.find((o) => o.kind === "campaigns")!;
    expect(c.fields).toMatchObject({
      status: "PAUSED",
      advertisingChannelType: "PERFORMANCE_MAX",
      brandGuidelinesEnabled: true,
      maximizeConversions: {},
    });
    expect(
      p.operations.find((o) => o.kind === "campaignBudgets")!.expected,
    ).toMatchObject({
      amountMicros: "2000000",
      name: brief().campaign_name,
      explicitlyShared: false,
    });
    expect(
      p.operations
        .filter((o) => o.kind === "assetGroups")
        .every((o) => o.fields.status === "PAUSED"),
    ).toBe(true);
    expect(
      p.operations
        .filter((o) => o.kind === "assetGroupAssets")
        .every((o) => o.fields.status === "ENABLED"),
    ).toBe(true);
    expect(
      p.operations
        .filter((o) => o.kind === "campaignAssets")
        .map((o) => o.fields.fieldType),
    ).toEqual(["BUSINESS_NAME", "LOGO"]);
    expect(p.operations.some((o) => o.kind === "customConversionGoals")).toBe(
      true,
    );
    const config = p.operations.find(
      (o) => o.kind === "conversionGoalCampaignConfigs",
    )!;
    expect(config.expected.campaign).toBe(c.resource_name);
    expect(config.update_mask).toBe("custom_conversion_goal");
    for (const op of p.operations)
      expect(extendedProviderOperation(op)).toBeTruthy();
    expect(p.inverse_intent).toBeUndefined();
  });
  it("disabled brand guidelines explicitly uses per-group LOGO/business, never Search BUSINESS_LOGO", async () => {
    const p = await buildPmaxCreatePlan(
      account,
      { ...brief(), brand_guidelines_enabled: false },
      reader(),
    );
    expect(
      p.operations.filter((o) => o.kind === "campaignAssets"),
    ).toHaveLength(0);
    expect(
      p.operations
        .filter((o) => o.kind === "assetGroupAssets")
        .map((o) => o.fields.fieldType),
    ).toContain("LOGO");
    expect(JSON.stringify(p.operations)).not.toContain("BUSINESS_LOGO");
  });
  it("dates and value strategy preserve exact supported settings", async () => {
    const p = await buildPmaxCreatePlan(
      account,
      {
        ...brief(),
        start_date: "2027-01-01",
        end_date: "2027-02-01",
        bidding_strategy: "MAXIMIZE_CONVERSION_VALUE",
        target_roas: 3,
      },
      reader(),
    );
    const c = p.operations.find((o) => o.kind === "campaigns")!;
    expect(c.fields).toMatchObject({
      startDateTime: "2027-01-01 00:00:00",
      endDateTime: "2027-02-01 23:59:59",
      maximizeConversionValue: { targetRoas: 3 },
    });
    expect(c.read_query).toContain("campaign.start_date_time");
  });
  it("omitted targets are explicit provider-semantic zero expectations, never accepts unexpected automatic targets", async () => {
    const p = await buildPmaxCreatePlan(account, brief(), reader()),
      c = p.operations.find((o) => o.kind === "campaigns")!;
    expect(c.fields.maximizeConversions).toEqual({});
    expect(c.expected.maximizeConversions).toEqual({ targetCpaMicros: "0" });
    const value = await buildPmaxCreatePlan(
        account,
        { ...brief(), bidding_strategy: "MAXIMIZE_CONVERSION_VALUE" },
        reader(),
      ),
      v = value.operations.find((o) => o.kind === "campaigns")!;
    expect(v.fields.maximizeConversionValue).toEqual({});
    expect(v.expected.maximizeConversionValue).toEqual({ targetRoas: 0 });
    const only = {
      ...p,
      checks: [],
      operations: [
        {
          ...c,
          method: "update" as const,
          resource_name: campaign.resourceName,
          fields: { resourceName: campaign.resourceName },
          expected: {
            resourceName: campaign.resourceName,
            biddingStrategyType: "MAXIMIZE_CONVERSIONS",
            maximizeConversions: { targetCpaMicros: "0" },
          },
          read_query: "SELECT campaign.resource_name FROM campaign",
        },
      ],
      items: [{ ...p.items[0]!, provider_operations: [0] }],
    };
    const read = async () => [
      {
        campaign: {
          resourceName: campaign.resourceName,
          biddingStrategyType: "MAXIMIZE_CONVERSIONS",
          maximizeConversions: { targetCpaMicros: "1000000" },
        },
      },
    ];
    const result = await verifyExtendedMutation(
      only,
      [{ success: true, resource_name: campaign.resourceName, error: null }],
      read,
    );
    expect(result.status).toBe("NOT_VERIFIED");
  });
  it("daily budget and positive CPA are exact half-up quantized to provider-proven Google billable units", async () => {
    const p = await buildPmaxCreatePlan(
      account,
      {
        ...brief(),
        daily_budget: { amount: "2.005", currency: "USD" },
        target_cpa: { amount: "0.025", currency: "USD" },
      },
      reader(),
    );
    expect(
      p.operations.find((o) => o.kind === "campaignBudgets")!.fields
        .amountMicros,
    ).toBe("2010000");
    expect(
      p.operations.find((o) => o.kind === "campaigns")!.fields
        .maximizeConversions,
    ).toEqual({ targetCpaMicros: "30000" });
    expect(
      p.items[0]!.warnings.filter((w) => w.includes("Округление")),
    ).toHaveLength(2);
    expect(p.items[0]!.after).toHaveProperty(
      "money_unit.resource_name",
      "currencyConstants/USD",
    );
    expect(
      p.checks.find((c) => c.query.includes(" FROM currency_constant"))!.rows,
    ).toEqual([
      {
        currencyConstant: {
          resourceName: "currencyConstants/USD",
          code: "USD",
          billableUnitMicros: "10000",
        },
      },
    ]);
    expect(p.atomic).toBe(true);
    expect(
      p.operations
        .filter((o) => ["campaigns", "assetGroups"].includes(o.kind))
        .every((o) => o.fields.status === "PAUSED"),
    ).toBe(true);
  });
  it("unproven units and positive money rounded to zero fail closed; no FX or hardcoded currency fallback", async () => {
    for (const currencyRows of [
      [],
      [
        {
          currencyConstant: {
            resourceName: "currencyConstants/EUR",
            code: "EUR",
            billableUnitMicros: "10000",
          },
        },
      ],
      [
        {
          currencyConstant: {
            resourceName: "currencyConstants/USD",
            code: "USD",
            billableUnitMicros: "0",
          },
        },
      ],
    ])
      await expect(
        buildPmaxCreatePlan(account, brief(), reader({ currencyRows })),
      ).rejects.toThrow(/currency|Google|billable/);
    await expect(
      buildPmaxCreatePlan(
        account,
        { ...brief(), daily_budget: { amount: "0.004999", currency: "USD" } },
        reader(),
      ),
    ).rejects.toThrow(/нуля/);
    await expect(
      buildPmaxCreatePlan(
        account,
        { ...brief(), target_cpa: { amount: "0.000001", currency: "USD" } },
        reader(),
      ),
    ).rejects.toThrow(/нуля/);
    await expect(
      buildPmaxCreatePlan(
        account,
        { ...brief(), daily_budget: { amount: "2", currency: "EUR" } },
        reader(),
      ),
    ).rejects.toThrow(/валют|Валют|currency/);
  });
  it("31 headline, unknown/raw API fields, wrong date, private URL, duplicates reject before provider reads", async () => {
    const cases = [
      { ...brief(), retail_feed_id: "42" },
      { ...brief(), start_date: "2027-02-30" },
      {
        ...brief(),
        locations: [
          { geo_target_id: "1000000" },
          { geo_target_id: "1000000", exclude: true },
        ],
      },
    ];
    for (const url of [
      "http://localhost/",
      "http://172.16.1.1/",
      "http://[::1]/",
    ]) {
      const b = brief();
      b.asset_groups[0]!.final_url = url;
      cases.push(b);
    }
    const b = brief();
    b.asset_groups[0]!.headlines[0] = "x".repeat(31);
    cases.push(b);
    for (const invalid of cases) {
      const r = reader();
      await expect(buildPmaxCreatePlan(account, invalid, r)).rejects.toThrow();
      expect(r).not.toHaveBeenCalled();
    }
  });
  it.each([
    { action: { ...action, status: "REMOVED" } },
    { action: { ...action, ownerCustomer: "customers/2" } },
    {
      customer: {
        ...customer,
        conversionTrackingSetting: {
          googleAdsConversionCustomer: "customers/2",
        },
      },
    },
  ])("fails closed unavailable/cross-account conversions %s", async (opts) => {
    await expect(
      buildPmaxCreatePlan(account, brief(), reader(opts)),
    ).rejects.toThrow(/conversion|Conversion|action/);
  });
  it("real inline pixels decoded into typed IMAGE mutation, summary contains no binary", async () => {
    const bytes = await sharp({
      create: { width: 128, height: 128, channels: 3, background: "#234567" },
    })
      .png()
      .toBuffer();
    const b = {
      ...brief(),
      logos: [
        { mime_type: "image/png", data_base64: bytes.toString("base64") },
      ],
    };
    const p = await buildPmaxCreatePlan(account, b, reader());
    expect(
      p.operations.filter((o) => o.kind === "assets" && o.fields.imageAsset),
    ).toHaveLength(1);
    expect(JSON.stringify(safeMediaSummary(p))).not.toContain(
      bytes.toString("base64"),
    );
    expect(p.intent.media_summary).toBeTruthy();
  });
  it("aggregate local quota is enforced before provider reads", async () => {
    const data = Buffer.alloc(800000).toString("base64"),
      b = {
        ...brief(),
        logos: Array.from({ length: 3 }, () => ({
          mime_type: "image/png",
          data_base64: data,
        })),
      };
    const r = reader();
    await expect(buildPmaxCreatePlan(account, b, r)).rejects.toThrow(
      /aggregate/,
    );
    expect(r).not.toHaveBeenCalled();
  });
  it("exposes typed finite profile without raw mutation objects", () => {
    expect(stage4ToolSchema("google_ads_pmax_preview")).toBeTruthy();
    expect(
      stage4ToolIntent("google_ads_pmax_preview", {
        provider: "GOOGLE_ADS",
        account_id: account,
        action: "pmax_create",
        items: [{ brief: brief() }],
      }),
    ).toBeTruthy();
    expect(() =>
      preflightPmaxBrief({ ...brief(), campaign_budget: { raw: true } }),
    ).toThrow();
    expect(stage4CapabilityMatrix.pmax_create).toContain("NON_RETAIL");
  });
  it("minimum-assets detach rejects removing third headline; safe fourth detach preserves all other assets", async () => {
    const base = links(),
      row = { asset_id: "101", field_type: "HEADLINE" };
    await expect(
      buildPmaxEditPlan(
        account,
        edit("pmax_asset_detach", row),
        reader({ links: base }),
      ),
    ).rejects.toThrow(/minimum/);
    const p = await buildPmaxEditPlan(
      account,
      edit("pmax_asset_detach", row),
      reader({ links: links(1) }),
    );
    expect(p.operations).toHaveLength(1);
    expect(p.operations[0]!.method).toBe("remove");
    expect(p.irreversible).toBe(true);
    expect(p.inverse_intent).toBeUndefined();
  });
  it("atomic text replacement satisfies minimum without modifying neighbors or deleting original asset", async () => {
    const p = await buildPmaxEditPlan(
      account,
      edit("pmax_asset_replace", {
        asset_id: "101",
        field_type: "HEADLINE",
        text: "New safe headline",
      }),
      reader({ links: links() }),
    );
    expect(p.atomic).toBe(true);
    expect(p.operations.map((o) => [o.kind, o.method])).toEqual([
      ["assets", "create"],
      ["assetGroupAssets", "create"],
      ["assetGroupAssets", "remove"],
    ]);
    expect(p.operations[1]!.fields.status).toBe("ENABLED");
    expect(p.operations[2]!.resource_name).toBe(
      prefix + "/assetGroupAssets/2~101~HEADLINE",
    );
    expect(p.checks.some((c) => c.query.includes(PMAX_ASSET_FIELDS))).toBe(
      true,
    );
  });
  it("detach rejects missing acknowledgement, unknown brand mode, wrong ownership and missing branding", async () => {
    const row = { asset_id: "101", field_type: "HEADLINE" };
    const r = reader();
    await expect(
      buildPmaxEditPlan(
        account,
        edit("pmax_asset_detach", { ...row, acknowledge_irreversible: false }),
        r,
      ),
    ).rejects.toThrow(/acknowledge/);
    expect(r).not.toHaveBeenCalled();
    for (const opts of [
      {
        campaign: { ...campaign, brandGuidelinesEnabled: undefined },
        links: links(1),
      },
      { links: links(1), brandLinks: [] },
      {
        links: links(1).map((l, i) =>
          i === 0
            ? {
                ...l,
                assetGroupAsset: {
                  ...l.assetGroupAsset,
                  asset: "customers/2/assets/101",
                },
              }
            : l,
        ),
      },
    ])
      await expect(
        buildPmaxEditPlan(
          account,
          edit("pmax_asset_detach", row),
          reader(opts),
        ),
      ).rejects.toThrow();
  });
  it("supports only actual BRANDS SharedSet enum and v24 negative keywords", async () => {
    const p = await buildPmaxEditPlan(
      account,
      edit("pmax_brand_exclude", { shared_set_id: "50" }),
      reader(),
    );
    expect(p.operations[0]!.fields).toEqual({
      campaign: campaign.resourceName,
      negative: true,
      brandList: { sharedSet: prefix + "/sharedSets/50" },
    });
    for (const sharedType of [
      "BRAND_HINT",
      "BRAND_EXCLUSION",
      "NEGATIVE_KEYWORDS",
    ])
      await expect(
        buildPmaxEditPlan(
          account,
          edit("pmax_brand_exclude", { shared_set_id: "50" }),
          reader({ sharedType }),
        ),
      ).rejects.toThrow(/BRANDS/);
    const n = await buildPmaxEditPlan(
      account,
      edit("pmax_negative_add", {
        text: "safe irrelevant test",
        match_type: "EXACT",
      }),
      reader(),
    );
    expect(n.operations[0]!.fields).toMatchObject({
      negative: true,
      keyword: { text: "safe irrelevant test", matchType: "EXACT" },
    });
  });
  it("cannot remove positive targeting as negative and rejects raw provider fields", async () => {
    const before = {
      resourceName: prefix + "/campaignCriteria/1~123",
      campaign: campaign.resourceName,
      negative: false,
      keyword: { text: "positive", matchType: "EXACT" },
    };
    await expect(
      buildPmaxEditPlan(
        account,
        edit("pmax_negative_remove", { criterion_id: "123" }),
        reader({ criteria: [{ campaignCriterion: before }] }),
      ),
    ).rejects.toThrow(/Positive/);
    expect(() =>
      parseStage4Intent(
        edit("pmax_negative_add", {
          text: "safe",
          match_type: "EXACT",
          partialFailure: false,
        }),
      ),
    ).toThrow();
  });
  it("signal remove is scoped to group and explicit irreversible approval contract", async () => {
    const before = {
      resourceName: prefix + "/assetGroupSignals/2~7",
      assetGroup: group.resourceName,
      searchTheme: { text: "safe search" },
    };
    const p = await buildPmaxEditPlan(
      account,
      edit("pmax_signal_remove", { signal_id: "7" }),
      reader({ signals: [{ assetGroupSignal: before }] }),
    );
    expect(p.operations[0]!.before).toEqual(before);
    expect(p.operations[0]!.resource_name).toBe(before.resourceName);
  });
  it("source ambiguity, quota mixed batch, foreign goal suffix, duplicate association and missing Google metadata fail closed", async () => {
    const r = reader();
    await expect(
      buildPmaxEditPlan(
        account,
        edit("image_asset_create", {
          level: "account",
          field_type: "AD_IMAGE",
          media: {
            asset_id: "11",
            data_base64: "AAAA",
            mime_type: "image/png",
          },
        }),
        r,
      ),
    ).rejects.toThrow(/reference|inline/);
    expect(r).not.toHaveBeenCalled();
    const data = Buffer.alloc(800000).toString("base64"),
      r2 = reader();
    await expect(
      buildPmaxEditPlan(
        account,
        {
          action: "image_asset_create",
          items: Array.from({ length: 3 }, () => ({
            level: "account",
            field_type: "AD_IMAGE",
            media: { mime_type: "image/png", data_base64: data },
          })),
        },
        r2,
      ),
    ).rejects.toThrow(/aggregate/);
    expect(r2).not.toHaveBeenCalled();
    const b = brief();
    b.asset_groups[0]!.images.push(b.asset_groups[0]!.images[0]!);
    await expect(buildPmaxCreatePlan(account, b, reader())).rejects.toThrow(
      /Duplicate/,
    );
    const fake = reader();
    const read = vi.fn(async (q: string) =>
      q.includes(" FROM customer_conversion_goal")
        ? [
            {
              customerConversionGoal: {
                resourceName: "customers/2/customerConversionGoals/13~2",
                category: action.category,
                origin: action.origin,
                biddable: true,
              },
            },
          ]
        : fake(q),
    );
    await expect(buildPmaxCreatePlan(account, brief(), read)).rejects.toThrow(
      /account|customer/,
    );
    const bad = links(1).map((r, i) =>
      i === 7
        ? {
            ...r,
            asset: {
              ...r.asset,
              imageAsset: {
                fullSize: { widthPixels: 1200, heightPixels: 628 },
              },
            },
          }
        : r,
    );
    await expect(
      buildPmaxEditPlan(
        account,
        edit("pmax_asset_detach", { asset_id: "101", field_type: "HEADLINE" }),
        reader({ links: bad }),
      ),
    ).rejects.toThrow(/size|dimensions/);
  });
  it("logo/image replacement uses actual pixels and keeps brand-false group minimum composition", async () => {
    const base = links(),
      logo = {
        assetGroupAsset: {
          resourceName: prefix + "/assetGroupAssets/2~12~LOGO",
          assetGroup: group.resourceName,
          asset: refs[2]!.resourceName,
          fieldType: "LOGO",
          status: "ENABLED",
        },
        asset: refs[2]!,
      },
      business = {
        assetGroupAsset: {
          resourceName: prefix + "/assetGroupAssets/2~13~BUSINESS_NAME",
          assetGroup: group.resourceName,
          asset: prefix + "/assets/13",
          fieldType: "BUSINESS_NAME",
          status: "ENABLED",
        },
        asset: {
          resourceName: prefix + "/assets/13",
          type: "TEXT",
          textAsset: { text: "Test business" },
        },
      };
    const media = {
      mime_type: "image/png",
      data_base64: (
        await sharp({
          create: {
            width: 128,
            height: 128,
            channels: 3,
            background: "#abcdef",
          },
        })
          .png()
          .toBuffer()
      ).toString("base64"),
    };
    const parsed = parseStage4Intent(
      edit("pmax_asset_replace", { asset_id: "12", field_type: "LOGO", media }),
    );
    const p = await buildPmaxEditPlan(
      account,
      parsed,
      reader({
        links: [...base, logo, business],
        campaign: { ...campaign, brandGuidelinesEnabled: false },
      }),
    );
    expect(p.atomic).toBe(true);
    expect(p.operations.map((o) => o.kind)).toEqual([
      "assets",
      "assetGroupAssets",
      "assetGroupAssets",
    ]);
    expect(p.operations[1]!.fields.fieldType).toBe("LOGO");
    await expect(
      buildPmaxEditPlan(
        account,
        edit("pmax_asset_detach", { asset_id: "12", field_type: "LOGO" }),
        reader({
          links: [...base, logo, business],
          campaign: { ...campaign, brandGuidelinesEnabled: false },
        }),
      ),
    ).rejects.toThrow(/minimum/);
    await expect(
      buildPmaxEditPlan(
        account,
        edit("pmax_asset_replace", {
          asset_id: "12",
          field_type: "LOGO",
          media,
        }),
        reader({ links: [...base, logo, business] }),
      ),
    ).rejects.toThrow(/campaign-level/);
  });
  it("Search inline image upload permits verified landscape, typed bytes and PAUSED association", async () => {
    const buffer = await sharp({
      create: { width: 600, height: 314, channels: 3, background: "#345678" },
    })
      .png()
      .toBuffer();
    const p = await buildStage4Plan(
      account,
      {
        action: "image_asset_create",
        items: [
          {
            level: "account",
            field_type: "AD_IMAGE",
            media: {
              mime_type: "image/png",
              data_base64: buffer.toString("base64"),
            },
          },
        ],
      },
      reader(),
    );
    expect(p.atomic).toBe(true);
    expect(p.operations[0]!.fields.imageAsset).toBeTruthy();
    expect(p.operations[1]!.fields).toMatchObject({
      fieldType: "AD_IMAGE",
      status: "PAUSED",
    });
    expect(extendedProviderOperation(p.operations[0]!)).toHaveProperty(
      "assetOperation.create.imageAsset.data",
    );
  });
  it("generic campaign detach cannot bypass PMax mandatory branding", async () => {
    await expect(
      buildStage4Plan(
        account,
        {
          action: "asset_detach",
          items: [
            {
              level: "campaign",
              campaign_id: "1",
              asset_id: "13",
              field_type: "BUSINESS_NAME",
              acknowledge_irreversible: true,
            },
          ],
        },
        reader(),
      ),
    ).rejects.toThrow(/PMax branding/);
  });
  it("campaign-level branding replacement is exact atomic and last logo/business detach fails", async () => {
    const parsed = parseStage4Intent({
      action: "pmax_campaign_asset_replace",
      items: [
        {
          campaign_id: "1",
          asset_id: "13",
          field_type: "BUSINESS_NAME",
          text: "New Test Business",
          acknowledge_irreversible: true,
        },
      ],
    });
    const p = await buildPmaxEditPlan(account, parsed, reader());
    expect(p.atomic).toBe(true);
    expect(p.operations.map((o) => [o.kind, o.method])).toEqual([
      ["assets", "create"],
      ["campaignAssets", "create"],
      ["campaignAssets", "remove"],
    ]);
    expect(p.operations[1]!.fields.status).toBe("ENABLED");
    expect(p.operations[2]!.resource_name).toBe(
      prefix + "/campaignAssets/1~13~BUSINESS_NAME",
    );
    expect(p.irreversible).toBe(true);
    for (const [asset_id, field_type] of [
      ["12", "LOGO"],
      ["13", "BUSINESS_NAME"],
    ])
      await expect(
        buildPmaxEditPlan(
          account,
          {
            action: "pmax_campaign_asset_detach",
            items: [
              {
                campaign_id: "1",
                asset_id,
                field_type,
                acknowledge_irreversible: true,
              },
            ],
          },
          reader(),
        ),
      ).rejects.toThrow(/minimum/);
    await expect(
      buildPmaxEditPlan(
        account,
        parsed,
        reader({ campaign: { ...campaign, brandGuidelinesEnabled: false } }),
      ),
    ).rejects.toThrow(/enabled brand guidelines/);
  });
  it("complete new group on existing PAUSED PMax creates only graph, preserves campaign/budget/goals/branding", async () => {
    const input = {
        action: "pmax_asset_group_create",
        items: [{ campaign_id: "1", asset_group: brief().asset_groups[0] }],
      },
      p = await buildStage4Plan(account, input, reader());
    expect(p.atomic).toBe(true);
    expect(
      p.operations.every((o) =>
        [
          "assets",
          "assetGroups",
          "assetGroupAssets",
          "assetGroupSignals",
        ].includes(o.kind),
      ),
    ).toBe(true);
    expect(
      p.operations.find((o) => o.kind === "assetGroups")!.fields,
    ).toMatchObject({ campaign: campaign.resourceName, status: "PAUSED" });
    expect(
      p.operations.filter((o) => o.kind === "assetGroupAssets"),
    ).toHaveLength(8);
    expect(p.operations.some((o) => o.kind === "campaignAssets")).toBe(false);
    expect(
      p.checks.some((c) => c.query.includes("asset_group.campaign =")),
    ).toBe(true);
    expect(p.items[0]!.after).toMatchObject({ campaign_changed: false });
  });
  it("capability label remains human-readable without token-shaped false positive or scanner exclusion", () => {
    expect(
      stage4CapabilityMatrix.pmax_asset_group_create_full_minimum_assets,
    ).toContain("EXISTING PAUSED PMAX");
    expect(
      /EA[A-Za-z0-9_-]{30,}/.test(
        stage4CapabilityMatrix.pmax_asset_group_create_full_minimum_assets,
      ),
    ).toBe(false);
  });
  it("existing group create validates full minimum and owner/PAUSED parent, duplicate name, actual branding", async () => {
    const input = {
      action: "pmax_asset_group_create",
      items: [{ campaign_id: "1", asset_group: brief().asset_groups[0] }],
    };
    for (const candidate of [
      { ...campaign, status: "ENABLED" },
      { ...campaign, brandGuidelinesEnabled: undefined },
      { ...campaign, resourceName: "customers/2/campaigns/1" },
    ])
      await expect(
        buildStage4Plan(account, input, reader({ campaign: candidate })),
      ).rejects.toThrow(/PAUSED PMax|parent/);
    const duplicate = {
      ...input,
      items: [
        {
          campaign_id: "1",
          asset_group: { ...brief().asset_groups[0], name: group.name },
        },
      ],
    };
    await expect(buildStage4Plan(account, duplicate, reader())).rejects.toThrow(
      /name exists/,
    );
    await expect(
      buildStage4Plan(
        account,
        { ...input, items: [...input.items, ...input.items] },
        reader(),
      ),
    ).rejects.toThrow(/name exists/);
    const invalid = {
        ...input,
        items: [
          {
            campaign_id: "1",
            asset_group: { ...brief().asset_groups[0], images: [] },
          },
        ],
      },
      r = reader();
    await expect(buildStage4Plan(account, invalid, r)).rejects.toThrow();
    expect(r).not.toHaveBeenCalled();
    await expect(
      buildStage4Plan(account, input, reader({ brandLinks: [] })),
    ).rejects.toThrow(/minimum/);
  });
  it("existing group brand-false requires explicit group logo/name, never mutates campaign branding", async () => {
    const base = {
        action: "pmax_asset_group_create",
        items: [{ campaign_id: "1", asset_group: brief().asset_groups[0] }],
      },
      r = reader({ campaign: { ...campaign, brandGuidelinesEnabled: false } });
    await expect(buildStage4Plan(account, base, r)).rejects.toThrow(
      /business_name/,
    );
    const input = {
        ...base,
        items: [
          {
            ...base.items[0],
            business_name: "New Group Business",
            logos: [{ asset_id: "12" }],
          },
        ],
      },
      p = await buildStage4Plan(
        account,
        input,
        reader({ campaign: { ...campaign, brandGuidelinesEnabled: false } }),
      );
    expect(
      p.operations
        .filter((o) => o.kind === "assetGroupAssets")
        .map((o) => o.fields.fieldType),
    ).toContain("LOGO");
    expect(p.operations.some((o) => o.kind === "campaignAssets")).toBe(false);
    await expect(buildStage4Plan(account, input, reader())).rejects.toThrow(
      /override branding/,
    );
  });
  it.each(["campaign", "existing-group"])(
    "atomic %s graph post-read resolves actual temp resources and verifies exact complete rows",
    async (mode) => {
      const p =
          mode === "campaign"
            ? await buildPmaxCreatePlan(account, brief(), reader())
            : await buildStage4Plan(
                account,
                {
                  action: "pmax_asset_group_create",
                  items: [
                    { campaign_id: "1", asset_group: brief().asset_groups[0] },
                  ],
                },
                reader(),
              ),
        resources = new Map<string, string>();
      let id = 200;
      for (const o of p.operations)
        if (o.resource_name?.includes("/-") && o.method === "create")
          resources.set(
            o.resource_name,
            o.resource_name.replace(/-\d+$/, String(++id)),
          );
      const createdCampaign = p.operations.find(
          (o) => o.kind === "campaigns",
        )?.resource_name,
        campaignID = createdCampaign
          ? resources.get(createdCampaign)!.split("/").at(-1)!
          : "1";
      for (const o of p.operations)
        if (
          ["campaignConversionGoals", "conversionGoalCampaignConfigs"].includes(
            o.kind,
          ) &&
          o.resource_name
        )
          resources.set(
            o.resource_name,
            o.resource_name.replace(/\/-\d+(?=~|$)/, "/" + campaignID),
          );
      const actual = p.operations.map((o) => {
        const resource = o.resource_name
          ? replaceExtendedTemps(o.resource_name, resources)
          : prefix + "/" + o.kind + "/" + ++id;
        const expected = replaceExtendedTemps(
          o.expected,
          resources,
        ) as ExtendedRow;
        return {
          operation: o,
          entity: { ...expected, resourceName: resource },
          query: replaceExtendedTemps(o.read_query, resources),
        };
      });
      const re = vi.fn(async (q: string): Promise<ExtendedRow[]> => {
        const entries = actual.filter((a) => a.query === q);
        if (entries.length)
          return entries.map((a) => ({ [a.operation.response_key]: a.entity }));
        const check = p.checks.find((c) => c.query === q);
        if (check)
          return [
            ...structuredClone(check.rows),
            ...(q.includes("FROM asset_group WHERE asset_group.campaign")
              ? actual
                  .filter((a) => a.operation.kind === "assetGroups")
                  .map((a) => ({ assetGroup: a.entity }))
              : []),
          ];
        throw new Error("Unknown mock reread");
      });
      const result = await verifyExtendedMutation(
        p,
        actual.map((a) => ({
          success: true,
          resource_name: String(a.entity.resourceName),
          error: null,
        })),
        re,
      );
      expect(result.context_verified).toBe(true);
      expect(
        result.items[0]!.operations.filter((o) => !o.success).map((o) => ({
          operation: o.operation,
          resource_name: o.resource_name,
          error: o.error,
        })),
      ).toEqual([]);
      expect(result.status).toBe("VERIFIED");
    },
  );
});

import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { extendedFixture } from "./google-extended-test.fixture.js";
import {
  customer,
  object,
  prefix,
  principal,
} from "./google-write-test.fixture.js";
type Row = Record<string, unknown>;
async function prepared() {
  const f = extendedFixture();
  Object.assign(
    object(f.resources.get(`${prefix}/customers/${customer}`)?.customer),
    { conversionTrackingSetting: { googleAdsConversionCustomer: prefix } },
  );
  f.resources.set(`${prefix}/conversionActions/5`, {
    conversionAction: {
      id: "5",
      resourceName: `${prefix}/conversionActions/5`,
      name: "TEST lead",
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
        resourceName: `${prefix}/assets/${id}`,
        id,
        type: "IMAGE",
        imageAsset: {
          fileSize: "10000",
          mimeType: "PNG",
          fullSize: { widthPixels: width, heightPixels: height },
        },
      },
    });
  const bytes = await sharp({
    create: { width: 128, height: 128, channels: 3, background: "#123456" },
  })
    .png()
    .toBuffer();
  const inline = bytes.toString("base64");
  const brief = {
    campaign_name: "HM PMax stock controlled MOCK",
    daily_budget: { amount: "100", currency: "KZT" },
    conversion_actions: ["5"],
    business_name: "HolyMedia Test",
    logos: [{ mime_type: "image/png", data_base64: inline }],
    locations: [{ geo_target_id: "100" }],
    languages: ["1031"],
    contains_eu_political_advertising:
      "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    utm: {
      final_url_suffix: "utm_source=google&utm_campaign=pmax_stock",
      tracking_url_template: "https://tracker.example.test/?u={lpurl}",
    },
    asset_groups: [
      {
        name: "PMax complete MOCK group",
        final_url: "https://example.com/",
        headlines: ["Test marketing", "Test advertising", "HolyMedia test"],
        long_headlines: ["Controlled test campaign"],
        descriptions: [
          "Safe test description one",
          "Safe test description two",
        ],
        images: [
          { field_type: "MARKETING_IMAGE", media: { asset_id: "50" } },
          { field_type: "SQUARE_MARKETING_IMAGE", media: { asset_id: "51" } },
        ],
      },
    ],
  };
  const preview = () =>
    f.call("google_ads_pmax_preview", {
      action: "pmax_create",
      items: [{ brief }],
    });
  const commit = (p: Row) =>
    f.mcp
      .call(principal, "commit_preview", { preview_token: p.preview_token })
      .then(object);
  return { ...f, inline, brief, preview, commit };
}
describe("PMax complete graph: stock MCP services with mocked provider HTTP", () => {
  it("validates only, requires human approval, atomically creates/rereads full PAUSED graph and journal with no exposed media", async () => {
    const f = await prepared(),
      before = JSON.stringify([...f.resources]),
      p = await f.preview();
    expect(p.status).toBe("preview");
    expect(p.provider_validation).toBe("passed");
    expect(p.atomic).toBe(true);
    expect(p.partial_failure).toBe(false);
    expect(JSON.stringify([...f.resources])).toBe(before);
    expect(f.counts().write).toBe(0);
    expect(JSON.stringify(p)).not.toContain(f.inline);
    expect(JSON.stringify(p)).not.toContain('"data_base64"');
    await expect(f.commit(p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
    await f.approve(p);
    const result = await f.commit(p);
    const boundaryResults = await Promise.allSettled(
      vi.mocked(fetch).mock.results.map((r) => Promise.resolve(r.value)),
    );
    const safeErrors = boundaryResults
      .filter((r) => r.status === "rejected")
      .map((r) => String((r as PromiseRejectedResult).reason));
    expect(result.status, safeErrors.join("; ")).toBe("VERIFIED");
    const plan = object(f.previewsRows[0]!.requestedState),
      operations = plan.operations as Row[];
    expect(Number(p.operation_count)).toBe(operations.length);
    expect(operations).toHaveLength(26);
    const campaigns = [...f.resources.values()]
      .map((v) => object(v.campaign))
      .filter(
        (c) =>
          c.name === f.brief.campaign_name &&
          c.advertisingChannelType === "PERFORMANCE_MAX",
      );
    const campaign = campaigns[0]!;
    expect(campaigns).toHaveLength(1);
    expect(campaign.status).toBe("PAUSED");
    expect(campaign.biddingStrategyType).toBe("MAXIMIZE_CONVERSIONS");
    expect(object(campaign.maximizeConversions).targetCpaMicros).toBe("0");
    expect(campaign.resourceName).not.toMatch(/\/-\d/);
    expect(campaign.campaignBudget).not.toMatch(/\/-\d/);
    expect(campaign.finalUrlSuffix).toBe(f.brief.utm.final_url_suffix);
    const budget = object(
      f.resources.get(String(campaign.campaignBudget))?.campaignBudget,
    );
    expect(budget).toMatchObject({
      name: f.brief.campaign_name,
      amountMicros: "100000000",
      explicitlyShared: false,
      deliveryMethod: "STANDARD",
    });
    const goal = [...f.resources.values()]
      .map((v) => object(v.campaignConversionGoal))
      .find((g) => g.campaign === campaign.resourceName)!;
    expect(goal).toMatchObject({
      category: "SUBMIT_LEAD_FORM",
      origin: "WEBSITE",
      biddable: false,
    });
    expect(goal.resourceName).toMatch(/\/campaignConversionGoals\/\d+~13~2$/);
    const config = [...f.resources.values()]
      .map((v) => object(v.conversionGoalCampaignConfig))
      .find((c) => c.campaign === campaign.resourceName)!;
    const selected = object(
      f.resources.get(String(config.customConversionGoal))
        ?.customConversionGoal,
    );
    expect(selected.conversionActions).toEqual([
      `${prefix}/conversionActions/5`,
    ]);
    const groups = [...f.resources.values()]
      .map((v) => object(v.assetGroup))
      .filter((g) => g.campaign === campaign.resourceName);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.status).toBe("PAUSED");
    const links = [...f.resources.values()]
      .map((v) => object(v.assetGroupAsset))
      .filter((l) => l.assetGroup === groups[0]!.resourceName);
    expect(links).toHaveLength(8);
    expect(links.every((l) => l.status === "ENABLED")).toBe(true);
    expect(links.map((l) => l.fieldType).sort()).toEqual(
      [
        "HEADLINE",
        "HEADLINE",
        "HEADLINE",
        "LONG_HEADLINE",
        "DESCRIPTION",
        "DESCRIPTION",
        "MARKETING_IMAGE",
        "SQUARE_MARKETING_IMAGE",
      ].sort(),
    );
    const branding = [...f.resources.values()]
      .map((v) => object(v.campaignAsset))
      .filter((l) => l.campaign === campaign.resourceName);
    expect(branding.map((l) => l.fieldType).sort()).toEqual([
      "BUSINESS_NAME",
      "LOGO",
    ]);
    expect(branding.every((l) => l.status === "ENABLED")).toBe(true);
    const logo = object(
      f.resources.get(
        String(branding.find((l) => l.fieldType === "LOGO")!.asset),
      )?.asset,
    );
    expect(logo.type).toBe("IMAGE");
    expect(object(object(logo.imageAsset).fullSize)).toMatchObject({
      widthPixels: 128,
      heightPixels: 128,
    });
    expect(object(logo.imageAsset).data).toBeUndefined();
    const criteria = [...f.resources.values()]
      .map((v) => object(v.campaignCriterion))
      .filter((c) => c.campaign === campaign.resourceName);
    expect(criteria).toHaveLength(2);
    expect(
      criteria.some(
        (c) =>
          object(c.location).geoTargetConstant === "geoTargetConstants/100",
      ),
    ).toBe(true);
    expect(
      criteria.some(
        (c) => object(c.language).languageConstant === "languageConstants/1031",
      ),
    ).toBe(true);
    const journal = await f.call("list_change_journal", {});
    expect(JSON.stringify(journal)).toContain(String(result.commit_id));
    for (const value of [
      result,
      journal,
      f.events,
      f.previewsRows[0]!.providerResult,
    ])
      expect(JSON.stringify(value)).not.toContain(f.inline);
    const mutate = f.requests.filter((r) => r.url.endsWith("googleAds:mutate"));
    expect(mutate).toHaveLength(2);
    expect(mutate.every((r) => r.body.partialFailure === false)).toBe(true);
    expect(mutate.map((r) => r.body.validateOnly)).toEqual([true, false]);
    expect(f.counts().validate_only).toBe(1);
    expect(f.counts().write).toBe(1);
    expect(
      f.events.filter(
        (e) =>
          e.eventType === "mcp_google_stage1_operation" &&
          object(e.metadata).result === "success",
      ),
    ).toHaveLength(operations.length);
    await expect(f.commit(p)).rejects.toThrow();
    expect(f.counts().write).toBe(1);
  });
  it("atomic provider rejection creates no partial graph and never retries", async () => {
    const f = await prepared(),
      p = await f.preview();
    await f.approve(p);
    const before = JSON.stringify([...f.resources]);
    f.failOperation(2);
    expect((await f.commit(p)).status).not.toBe("VERIFIED");
    expect(JSON.stringify([...f.resources])).toBe(before);
    expect(f.counts().write).toBe(1);
    await expect(f.commit(p)).rejects.toThrow();
    expect(f.counts().write).toBe(1);
  });
  it("rejects a complete graph exceeding 500 operations before validation or mutation", async () => {
    const f = await prepared(),
      before = JSON.stringify([...f.resources]),
      group = f.brief.asset_groups[0]!;
    f.brief.asset_groups = Array.from({ length: 10 }, (_, index) => ({
      ...group,
      name: `Bounded PMax group ${index}`,
      headlines: Array.from({ length: 15 }, (_, i) => `Test headline ${i}`),
      long_headlines: Array.from(
        { length: 5 },
        (_, i) => `Test long headline ${i}`,
      ),
      descriptions: Array.from(
        { length: 5 },
        (_, i) => `Test description ${i}`,
      ),
    }));
    // Ten complete groups require at least 530 operations; the stock
    // immutable-plan cap rejects this before any Google validation call.
    await expect(f.preview()).rejects.toMatchObject({
      writeCode: "google_extended_plan_invalid",
    });
    expect(f.counts().validate_only).toBe(0);
    expect(f.counts().write).toBe(0);
    expect(JSON.stringify([...f.resources])).toBe(before);
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  buildClonePlan,
  buildStage0Plan,
  decodeStage0Mutation,
  rereadStage0Checks,
  row,
  stage0ProviderOperations,
  stage0ProximityFields,
  verifyStage0Mutation,
  type JsonRow,
  type Stage0Plan,
} from "./google-ads-stage0.js";
import { canonical, type Stage1MutationResult } from "./google-ads-stage1.js";
const account = "8590146099",
  prefix = `customers/${account}`;
function fixture() {
  const customer = {
    resourceName: prefix,
    id: account,
    currencyCode: "USD",
    timeZone: "Asia/Almaty",
    conversionTrackingSetting: { googleAdsConversionCustomer: prefix },
  };
  const campaign: JsonRow = {
    resourceName: `${prefix}/campaigns/1`,
    id: "1",
    name: "TEST source",
    status: "PAUSED",
    advertisingChannelType: "SEARCH",
    biddingStrategyType: "MANUAL_CPC",
    campaignBudget: `${prefix}/campaignBudgets/3`,
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: false,
      targetContentNetwork: false,
      targetPartnerSearchNetwork: false,
    },
    geoTargetTypeSetting: {
      positiveGeoTargetType: "PRESENCE",
      negativeGeoTargetType: "PRESENCE",
    },
    finalUrlSuffix: "utm_source=google&utm_medium=cpc&utm_campaign=source",
  };
  const budget: JsonRow = {
    resourceName: campaign.campaignBudget,
    name: campaign.name,
    amountMicros: "2000000",
    explicitlyShared: false,
    deliveryMethod: "STANDARD",
  };
  const geo = {
    resourceName: "geoTargetConstants/9063099",
    id: "9063099",
    name: "Алматы",
    countryCode: "KZ",
    status: "ENABLED",
  };
  const group: JsonRow = {
    resourceName: `${prefix}/adGroups/2`,
    id: "2",
    campaign: campaign.resourceName,
    name: "Source group",
    status: "PAUSED",
    type: "SEARCH_STANDARD",
    cpcBidMicros: "100000",
  };
  const keys: JsonRow[] = [
    {
      resourceName: `${prefix}/adGroupCriteria/2~20`,
      adGroup: group.resourceName,
      status: "ENABLED",
      negative: false,
      keyword: { text: "test marketing", matchType: "EXACT" },
    },
  ];
  const ads: JsonRow[] = [
    {
      resourceName: `${prefix}/adGroupAds/2~21`,
      adGroup: group.resourceName,
      status: "PAUSED",
      ad: {
        finalUrls: ["https://example.com/"],
        responsiveSearchAd: {
          headlines: [
            { text: "Test one" },
            { text: "Test two" },
            { text: "Test three" },
          ],
          descriptions: [
            { text: "Description one" },
            { text: "Description two" },
          ],
        },
      },
    },
  ];
  const criteria: JsonRow[] = [
    {
      resourceName: `${prefix}/campaignCriteria/1~4`,
      campaign: campaign.resourceName,
      type: "LOCATION",
      negative: false,
      location: { geoTargetConstant: geo.resourceName },
    },
    {
      resourceName: `${prefix}/campaignCriteria/1~5`,
      campaign: campaign.resourceName,
      type: "LANGUAGE",
      negative: false,
      language: { languageConstant: "languageConstants/1031" },
    },
  ];
  for (const [id, type] of Object.entries({
    "30000": "DESKTOP",
    "30001": "MOBILE",
    "30002": "TABLET",
  }))
    criteria.push({
      resourceName: `${prefix}/campaignCriteria/1~${id}`,
      criterionId: id,
      campaign: campaign.resourceName,
      type: "DEVICE",
      status: "ENABLED",
      negative: false,
      device: { type },
    });
  const lists: JsonRow[] = [],
    conversionGoals: JsonRow[] = [],
    conversionActions: JsonRow[] = [],
    links: JsonRow[] = [],
    members: JsonRow[] = [],
    assetLinks: JsonRow[] = [],
    assets = new Map<string, JsonRow>();
  const read = vi.fn(async (q: string): Promise<JsonRow[]> => {
    let result: JsonRow[] = [];
    if (q.includes("FROM campaign_budget"))
      result = [{ campaignBudget: budget }];
    else if (q.includes("FROM customer_conversion_goal"))
      result = conversionGoals.map((customerConversionGoal) => ({
        customerConversionGoal,
      }));
    else if (q.includes("FROM campaign_conversion_goal"))
      result = conversionGoals.map((goal) => ({
        campaignConversionGoal: {
          ...goal,
          campaign: campaign.resourceName,
          resourceName: `${prefix}/campaignConversionGoals/1~13~2`,
        },
      }));
    else if (q.includes("FROM conversion_action"))
      result = conversionActions.map((conversionAction) => ({
        conversionAction,
      }));
    else if (q.includes("FROM conversion_goal_campaign_config")) result = [];
    else if (q.includes("FROM customer")) result = [{ customer }];
    else if (q.includes("FROM currency_constant"))
      result = [
        {
          currencyConstant: {
            resourceName: "currencyConstants/USD",
            code: "USD",
            billableUnitMicros: "10000",
          },
        },
      ];
    else if (q.includes("FROM geo_target_constant"))
      result = [{ geoTargetConstant: geo }];
    else if (q.includes("FROM language_constant"))
      result = [
        {
          languageConstant: {
            resourceName: "languageConstants/1031",
            code: "ru",
            name: "Russian",
            targetable: true,
          },
        },
      ];
    else if (q.includes("FROM campaign_shared_set"))
      result = links.map((campaignSharedSet) => ({ campaignSharedSet }));
    else if (q.includes("FROM shared_criterion"))
      result = members
        .filter((m) => q.includes(`'${m.sharedSet}'`))
        .map((sharedCriterion) => ({ sharedCriterion }));
    else if (q.includes("FROM shared_set"))
      result = lists
        .filter((s) => q.includes(`'${s.resourceName}'`))
        .map((sharedSet) => ({ sharedSet }));
    else if (q.includes("FROM campaign_criterion"))
      result = criteria.map((campaignCriterion) => ({ campaignCriterion }));
    else if (q.includes("FROM campaign_asset"))
      result = assetLinks.map((campaignAsset) => ({ campaignAsset }));
    else if (q.includes("FROM campaign "))
      result = q.includes("campaign.name =") ? [] : [{ campaign }];
    else if (q.includes("FROM ad_group_criterion"))
      result = keys.map((adGroupCriterion) => ({ adGroupCriterion }));
    else if (q.includes("FROM ad_group_ad"))
      result = ads.map((adGroupAd) => ({ adGroupAd }));
    else if (q.includes("FROM ad_group ")) result = [{ adGroup: group }];
    else if (q.includes("FROM asset "))
      result = [...assets.values()]
        .filter((a) => q.includes(`'${a.resourceName}'`))
        .map((asset) => ({ asset }));
    return structuredClone(result);
  });
  const build = vi.fn((brief: JsonRow) =>
    buildStage0Plan(account, brief, read, async () => [geo]),
  );
  const input = {
    provider: "GOOGLE_ADS",
    account_id: account,
    source_campaign_id: "1",
    new_name: "TEST clone",
    new_dates: {},
  };
  const clone = (extra: JsonRow = {}) =>
    buildClonePlan(account, { ...input, ...extra }, read, build);
  const addRadius = () =>
    criteria.push({
      resourceName: `${prefix}/campaignCriteria/1~6`,
      campaign: campaign.resourceName,
      type: "PROXIMITY",
      negative: false,
      proximity: stage0ProximityFields({
        latitude: 43.238949,
        longitude: 76.889709,
        radius: 10,
        unit: "KILOMETERS",
      }),
    });
  const addShared = () => {
    const s = {
      resourceName: `${prefix}/sharedSets/10`,
      id: "10",
      name: "TEST shared list",
      type: "NEGATIVE_KEYWORDS",
      status: "ENABLED",
    };
    lists.push(s);
    links.push({
      resourceName: `${prefix}/campaignSharedSets/1~10`,
      campaign: campaign.resourceName,
      sharedSet: s.resourceName,
      status: "ENABLED",
    });
    members.push({
      resourceName: `${prefix}/sharedCriteria/10~11`,
      sharedSet: s.resourceName,
      keyword: { text: "test marketing", matchType: "EXACT" },
    });
  };
  const addAssets = () => {
    assets.set(`${prefix}/assets/13`, {
      resourceName: `${prefix}/assets/13`,
      type: "CALL",
      callAsset: {
        countryCode: "KZ",
        phoneNumber: "+7 700 000 0000",
        callConversionReportingState: "DISABLED",
        adScheduleTargets: [
          {
            dayOfWeek: "MONDAY",
            startHour: 9,
            startMinute: "ZERO",
            endHour: 18,
            endMinute: "ZERO",
          },
        ],
      },
    });
    assets.set(`${prefix}/assets/14`, {
      resourceName: `${prefix}/assets/14`,
      type: "TEXT",
      textAsset: { text: "TEST advertiser" },
    });
    assetLinks.push(
      {
        resourceName: `${prefix}/campaignAssets/1~13~6`,
        campaign: campaign.resourceName,
        asset: `${prefix}/assets/13`,
        fieldType: "CALL",
        status: "ENABLED",
      },
      {
        resourceName: `${prefix}/campaignAssets/1~14~25`,
        campaign: campaign.resourceName,
        asset: `${prefix}/assets/14`,
        fieldType: "BUSINESS_NAME",
        status: "PAUSED",
      },
    );
  };
  const addConversion = () => {
    conversionGoals.push({
      resourceName: `${prefix}/customerConversionGoals/13~2`,
      category: "SUBMIT_LEAD_FORM",
      origin: "WEBSITE",
      biddable: true,
    });
    conversionActions.push({
      resourceName: `${prefix}/conversionActions/500`,
      id: "500",
      name: "TEST lead",
      status: "ENABLED",
      primaryForGoal: true,
      category: "SUBMIT_LEAD_FORM",
      origin: "WEBSITE",
      ownerCustomer: prefix,
    });
  };
  return {
    customer,
    campaign,
    budget,
    geo,
    group,
    keys,
    ads,
    criteria,
    lists,
    links,
    members,
    assetLinks,
    assets,
    read,
    build,
    input,
    clone,
    addRadius,
    addShared,
    addAssets,
    addConversion,
  };
}
function mockCreated(plan: Stage0Plan) {
  const references = new Map<string, string>(),
    actual = new Map<string, JsonRow>();
  const resolve = (v: unknown): unknown =>
    typeof v === "string"
      ? (references.get(v) ?? v)
      : Array.isArray(v)
        ? v.map(resolve)
        : v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v).map(([k, value]) => [k, resolve(value)]),
            )
          : v;
  const results: Stage1MutationResult[] = plan.operations.map((op, index) => {
    const fields = row(resolve(op.fields)),
      expected = row(resolve(op.expected));
    const kind: Record<string, string> = {
      campaignBudget: "campaignBudgets",
      campaign: "campaigns",
      campaignCriterion: "campaignCriteria",
      adGroup: "adGroups",
      adGroupCriterion: "adGroupCriteria",
      adGroupAd: "adGroupAds",
      asset: "assets",
      campaignAsset: "campaignAssets",
      campaignSharedSet: "campaignSharedSets",
      campaignConversionGoal: "campaignConversionGoals",
      customConversionGoal: "customConversionGoals",
      conversionGoalCampaignConfig: "conversionGoalCampaignConfigs",
    };
    let name = `${prefix}/${kind[op.kind]}/${1000 + index}`;
    if (op.kind === "campaignSharedSet")
      name = `${prefix}/campaignSharedSets/${String(fields.campaign).split("/").at(-1)}~${String(fields.sharedSet).split("/").at(-1)}`;
    if (op.kind === "campaignConversionGoal")
      name = `${prefix}/campaignConversionGoals/${String(expected.campaign).split("/").at(-1)}~13~2`;
    if (op.kind === "conversionGoalCampaignConfig")
      name = `${prefix}/conversionGoalCampaignConfigs/${String(expected.campaign).split("/").at(-1)}`;
    if (op.resource_name) references.set(op.resource_name, name);
    const entity: JsonRow = { ...fields, ...expected, resourceName: name };
    if (op.kind === "campaign")
      entity.biddingStrategyType = plan.summary.strategy;
    actual.set(name, { [op.kind]: entity });
    return { success: true, resource_name: name, error: null };
  });
  const campaignResult =
    results[plan.operations.findIndex((op) => op.kind === "campaign")]
      ?.resource_name;
  if (campaignResult)
    for (const [id, type] of Object.entries({
      "30000": "DESKTOP",
      "30001": "MOBILE",
      "30002": "TABLET",
    })) {
      const resourceName = `${campaignResult.replace("/campaigns/", "/campaignCriteria/")}~${id}`;
      actual.set(resourceName, {
        campaignCriterion: {
          resourceName,
          criterionId: id,
          campaign: campaignResult,
          type: "DEVICE",
          status: "ENABLED",
          negative: false,
          device: { type },
        },
      });
    }
  const read = async (q: string) =>
    [...actual.values()].filter((v) =>
      q.includes("FROM campaign_criterion") && q.includes("type = DEVICE")
        ? row(v.campaignCriterion).type === "DEVICE" &&
          q.includes(`'${row(v.campaignCriterion).campaign}'`)
        : q.includes(
            `'${Object.values(v)[0] && row(Object.values(v)[0]).resourceName}'`,
          ),
    );
  return { results, actual, read };
}
describe("Bounded Search clone P104–106: atomic reusable references, mock only", () => {
  it("proximity, call/business and shared negatives reuse the genuine Stage0 PAUSED builder", async () => {
    const f = fixture();
    f.addRadius();
    f.addAssets();
    f.addShared();
    const source = canonical({
      c: f.campaign,
      g: f.group,
      assets: [...f.assets],
      members: f.members,
      links: f.links,
    });
    const plan = await f.clone(),
      payload = stage0ProviderOperations(plan);
    expect(f.build).toHaveBeenCalledOnce();
    expect(plan.operations.every((o) => o.method === "create")).toBe(true);
    expect(
      plan.operations
        .filter((o) => ["campaign", "adGroup", "adGroupAd"].includes(o.kind))
        .every((o) => o.fields.status === "PAUSED"),
    ).toBe(true);
    expect(
      plan.operations.find(
        (o) => o.kind === "campaignCriterion" && o.fields.proximity,
      )!.fields.proximity,
    ).toEqual(row(f.criteria.at(-1)!.proximity));
    const attached = plan.operations.find(
      (o) => o.kind === "campaignSharedSet",
    )!;
    expect(attached.fields).toEqual({
      campaign: plan.operations.find((o) => o.kind === "campaign")!
        .resource_name,
      sharedSet: `${prefix}/sharedSets/10`,
    });
    expect(attached.fields).not.toHaveProperty("status");
    expect(attached.expected.status).toBe("ENABLED");
    expect(payload.some((op) => "campaignSharedSetOperation" in op)).toBe(true);
    expect(plan.operations.filter((o) => o.kind === "asset")).toHaveLength(0);
    expect(plan.items[attached.row]!.conflicts).toHaveLength(1);
    expect(plan.items[attached.row]!.warnings.join(" ")).toContain(
      "Future list changes affect both",
    );
    expect(plan.summary.operation_count).toBe(plan.operations.length);
    expect(
      canonical({
        c: f.campaign,
        g: f.group,
        assets: [...f.assets],
        members: f.members,
        links: f.links,
      }),
    ).toBe(source);
  });
  it("generated actual campaign shared-set IDs and radius/call links verify without temporary ID comparison", async () => {
    const f = fixture();
    f.addRadius();
    f.addAssets();
    f.addShared();
    const plan = await f.clone(),
      created = mockCreated(plan);
    const input = {
      mutateOperationResponses: created.results.map((r, i) => ({
        [`${plan.operations[i]!.kind}Result`]: {
          resourceName: r.resource_name,
        },
      })),
    };
    expect(
      decodeStage0Mutation(input, plan, false).every((r) => r.success),
    ).toBe(true);
    expect(
      (await verifyStage0Mutation(plan, created.results, created.read)).status,
    ).toBe("VERIFIED");
    const index = plan.operations.findIndex(
        (o) => o.kind === "campaignSharedSet",
      ),
      resource = created.results[index]!.resource_name!;
    row(created.actual.get(resource)!.campaignSharedSet).sharedSet =
      `${prefix}/sharedSets/999`;
    expect(
      (await verifyStage0Mutation(plan, created.results, created.read)).status,
    ).toBe("UNVERIFIED");
  });
  it("full source call settings/members/radius are frozen and changed source snapshots stale", async () => {
    const f = fixture();
    f.addRadius();
    f.addAssets();
    f.addShared();
    const plan = await f.clone(),
      before = canonical(plan.checks);
    expect(
      plan.checks.some((c) =>
        c.query.includes("asset.call_asset.ad_schedule_targets"),
      ),
    ).toBe(true);
    row(
      f.assets.get(`${prefix}/assets/13`)!.callAsset,
    ).callConversionReportingState = "USE_ACCOUNT_LEVEL_CALL_CONVERSION_ACTION";
    f.members[0]!.keyword = { text: "external", matchType: "EXACT" };
    expect(canonical(await rereadStage0Checks(plan, f.read))).not.toBe(before);
    expect(canonical(plan.checks)).toBe(before);
  });
  it("preserves PAUSED business association and never changes existing Asset content", async () => {
    const f = fixture();
    f.addAssets();
    const plan = await f.clone();
    const links = plan.operations.filter((o) => o.kind === "campaignAsset");
    expect(
      links.find((o) => o.fields.fieldType === "BUSINESS_NAME")!.fields.status,
    ).toBe("PAUSED");
    expect(
      links.every(
        (o) =>
          o.fields.asset === `${prefix}/assets/13` ||
          o.fields.asset === `${prefix}/assets/14`,
      ),
    ).toBe(true);
    expect(plan.operations.some((o) => o.kind === "asset")).toBe(false);
  });
  it.each([
    "asset",
    "member",
    "list",
    "association",
    "criterion",
    "group",
    "budget",
  ])(
    "foreign %s is rejected before builder and no foreign resource query",
    async (target) => {
      const f = fixture();
      f.addRadius();
      f.addAssets();
      f.addShared();
      if (target === "asset")
        f.assetLinks[0]!.asset = "customers/1234567890/assets/13";
      if (target === "member")
        f.members[0]!.resourceName =
          "customers/1234567890/sharedCriteria/10~11";
      if (target === "list")
        f.links[0]!.sharedSet = "customers/1234567890/sharedSets/10";
      if (target === "association")
        f.links[0]!.campaign = `${prefix}/campaigns/999`;
      if (target === "criterion")
        f.criteria[0]!.campaign = `${prefix}/campaigns/999`;
      if (target === "group") f.group.campaign = `${prefix}/campaigns/999`;
      if (target === "budget")
        f.campaign.campaignBudget = "customers/1234567890/campaignBudgets/3";
      await expect(f.clone()).rejects.toBeInstanceOf(Error);
      expect(f.build).not.toHaveBeenCalled();
      expect(
        f.read.mock.calls.every(([q]) => !q.includes("customers/1234567890")),
      ).toBe(true);
    },
  );
  it("inline Maximize Conversions preserves exact validated target CPA and provider reread proves it", async () => {
    const f = fixture();
    f.addConversion();
    f.campaign.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    f.campaign.maximizeConversions = { targetCpaMicros: "1250000" };
    const p = await f.clone(),
      op = p.operations.find((o) => o.kind === "campaign")!;
    expect(op.fields.maximizeConversions).toEqual({
      targetCpaMicros: "1250000",
    });
    expect(op.expected.maximizeConversions).toEqual(
      op.fields.maximizeConversions,
    );
    expect(op.fields.status).toBe("PAUSED");
    expect(p.summary.bidding_parameters).toMatchObject({
      currency: "USD",
      targetCpaMicros: "1250000",
      billable_unit_micros: "10000",
    });
    expect(p.items[op.row]!.after).toMatchObject({
      maximizeConversions: { targetCpaMicros: "1250000" },
    });
    const created = mockCreated(p);
    expect(
      (await verifyStage0Mutation(p, created.results, created.read)).status,
    ).toBe("VERIFIED");
    row(
      created.actual.get(created.results[op.row]!.resource_name!)!.campaign,
    ).maximizeConversions = { targetCpaMicros: "1000000" };
    expect(
      (await verifyStage0Mutation(p, created.results, created.read)).status,
    ).toBe("UNVERIFIED");
    f.campaign.maximizeConversions = { targetCpaMicros: "1500000" };
    expect(canonical(await rereadStage0Checks(p, f.read))).not.toBe(
      canonical(p.checks),
    );
  });
  it("inline CPA does not bypass real goals, account unit, portfolio or malformed source guards", async () => {
    const f = fixture();
    f.campaign.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    f.campaign.maximizeConversions = { targetCpaMicros: "1250000" };
    await expect(f.clone()).rejects.toMatchObject({
      writeCode: "google_conversion_missing",
    });
    f.addConversion();
    for (const micros of ["1", "10001"]) {
      f.campaign.maximizeConversions = { targetCpaMicros: micros };
      await expect(f.clone()).rejects.toMatchObject({
        writeCode: "google_clone_target_cpa_invalid",
      });
    }
    f.campaign.maximizeConversions = { targetCpaMicros: "9223372036854775808" };
    await expect(f.clone()).rejects.toMatchObject({
      writeCode: "google_clone_reference_invalid",
    });
    f.campaign.maximizeConversions = { targetCpaMicros: "1250000" };
    f.campaign.biddingStrategy = `${prefix}/biddingStrategies/7`;
    await expect(f.clone()).rejects.toMatchObject({
      writeCode: "google_clone_unsupported_components",
    });
  });
  it.each(["campaign", "template_only"])(
    "source %s tracking overrides cannot be silently dropped by bounded clone",
    async (level) => {
      const f = fixture();
      if (level === "campaign" || level === "template_only")
        f.campaign.finalUrlSuffix = undefined;
      if (level === "template_only")
        f.campaign.trackingUrlTemplate =
          "https://track.example.test/?u={lpurl}";
      await expect(f.clone()).rejects.toMatchObject({
        writeCode: "google_clone_tracking_unsupported",
      });
      expect(f.build).not.toHaveBeenCalled();
    },
  );
  it("preserves typed campaign/group/positive-keyword/RSA tracking hierarchy and URL encoding, mock verification only", async () => {
    const f = fixture();
    f.campaign.urlCustomParameters = [{ key: "Campaign", value: "source" }];
    f.group.trackingUrlTemplate =
      "https://group.example.test/?u={lpurl}&channel={_channel}";
    f.group.finalUrlSuffix = "utm_source=group&custom={_channel}";
    f.group.urlCustomParameters = [
      { key: "channel", value: "group" },
      { key: "Source", value: "original" },
    ];
    f.keys[0]!.trackingUrlTemplate = "https://keyword.example.test/?u={lpurl}";
    f.keys[0]!.finalUrlSuffix = "utm_source=keyword";
    f.keys[0]!.finalUrls = [
      "https://example.test/?landing=%2f&label={_channel}",
    ];
    f.keys[0]!.finalMobileUrls = [
      "https://mobile.example.test/?source=keyword",
    ];
    f.keys[0]!.urlCustomParameters = [{ key: "channel", value: "keyword" }];
    const ad = row(f.ads[0]!.ad);
    ad.trackingUrlTemplate = "https://ad.example.test/?u={lpurl}";
    ad.finalUrlSuffix = "utm_source=ad";
    ad.finalMobileUrls = ["https://mobile.example.test/?source=ad"];
    ad.urlCustomParameters = [{ key: "channel", value: "ad" }];
    const before = canonical({
        campaign: f.campaign,
        group: f.group,
        keys: f.keys,
        ads: f.ads,
      }),
      plan = await f.clone();
    const campaignOp = plan.operations.find((o) => o.kind === "campaign")!,
      groupOp = plan.operations.find((o) => o.kind === "adGroup")!,
      keyOp = plan.operations.find(
        (o) => o.kind === "adGroupCriterion" && !o.fields.negative,
      )!,
      adOp = plan.operations.find((o) => o.kind === "adGroupAd")!;
    expect(campaignOp.fields.urlCustomParameters).toEqual(
      f.campaign.urlCustomParameters,
    );
    for (const [op, source, nested] of [
      [groupOp, f.group, false],
      [keyOp, f.keys[0]!, false],
      [adOp, ad, true],
    ] as const) {
      const fields = nested ? row(op.fields.ad) : op.fields,
        expected = nested ? row(op.expected.ad) : op.expected;
      for (const field of [
        "trackingUrlTemplate",
        "finalUrlSuffix",
        "urlCustomParameters",
        "finalUrls",
        "finalMobileUrls",
      ]) {
        if (source[field] !== undefined) {
          expect(fields[field]).toEqual(source[field]);
          expect(expected[field]).toEqual(source[field]);
        }
      }
      expect(op.fields.status).toBe("PAUSED");
      expect(
        canonical(
          plan.items.find((i) =>
            i.provider_operations.includes(plan.operations.indexOf(op)),
          )!.after,
        ),
      ).toBe(canonical(op.expected));
    }
    expect(
      canonical({
        campaign: f.campaign,
        group: f.group,
        keys: f.keys,
        ads: f.ads,
      }),
    ).toBe(before);
    expect(plan.operations.every((o) => o.method === "create")).toBe(true);
    const made = mockCreated(plan),
      queries: string[] = [];
    const verified = await verifyStage0Mutation(
      plan,
      made.results,
      async (query) => {
        queries.push(query);
        return made.read(query);
      },
    );
    expect(verified.status).toBe("VERIFIED");
    for (const field of [
      "campaign.url_custom_parameters",
      "ad_group.tracking_url_template",
      "ad_group_criterion.final_mobile_urls",
      "ad_group_ad.ad.url_custom_parameters",
      "ad_group_ad.ad.final_mobile_urls",
    ])
      expect(queries.some((q) => q.includes(field))).toBe(true);
    // Google parameter mappings have semantic keys; provider array ordering is immaterial.
    row(
      made.actual.get(
        made.results[plan.operations.indexOf(groupOp)]!.resource_name!,
      )!.adGroup,
    ).urlCustomParameters = [
      ...(f.group.urlCustomParameters as unknown[]),
    ].reverse();
    expect(
      (await verifyStage0Mutation(plan, made.results, made.read)).status,
    ).toBe("VERIFIED");
    row(
      made.actual.get(
        made.results[plan.operations.indexOf(keyOp)]!.resource_name!,
      )!.adGroupCriterion,
    ).finalMobileUrls = ["https://wrong.example.test/"];
    expect(
      (await verifyStage0Mutation(plan, made.results, made.read)).status,
    ).toBe("UNVERIFIED");
  });
  it.each(["template", "suffix", "parameters", "mobile", "desktop"])(
    "provider override %s remains a frozen stale dependency",
    async (field) => {
      const f = fixture(),
        source = f.keys[0]!;
      source.trackingUrlTemplate = "https://track.example.test/?u={lpurl}";
      source.finalUrlSuffix = "utm_source=keyword";
      source.urlCustomParameters = [{ key: "channel", value: "source" }];
      source.finalMobileUrls = ["https://mobile.example.test/"];
      source.finalUrls = ["https://desktop.example.test/"];
      const plan = await f.clone(),
        before = canonical(plan.checks);
      if (field === "template")
        source.trackingUrlTemplate = "https://changed.example.test/?u={lpurl}";
      if (field === "suffix") source.finalUrlSuffix = "utm_source=changed";
      if (field === "parameters")
        source.urlCustomParameters = [{ key: "channel", value: "changed" }];
      if (field === "mobile")
        source.finalMobileUrls = ["https://changed-mobile.example.test/"];
      if (field === "desktop")
        source.finalUrls = ["https://changed-desktop.example.test/"];
      expect(canonical(await rereadStage0Checks(plan, f.read))).not.toBe(
        before,
      );
      expect(canonical(plan.checks)).toBe(before);
    },
  );
  it("eight parameters/200 UTF8-byte value preserved; only known empty-value omission normalizes", async () => {
    const f = fixture();
    f.group.urlCustomParameters = Array.from({ length: 8 }, (_, i) => ({
      key: "key" + i,
      ...(i === 0 ? {} : { value: i === 1 ? "Я".repeat(100) : "value" }),
    }));
    const plan = await f.clone(),
      made = mockCreated(plan),
      groupIndex = plan.operations.findIndex((o) => o.kind === "adGroup"),
      actual = row(
        made.actual.get(made.results[groupIndex]!.resource_name!)!.adGroup,
      );
    const parameters = actual.urlCustomParameters as JsonRow[];
    expect(parameters[0]!.value).toBe("");
    delete parameters[0]!.value;
    expect(
      (await verifyStage0Mutation(plan, made.results, made.read)).status,
    ).toBe("VERIFIED");
    parameters[1]!.value = "wrong";
    expect(
      (await verifyStage0Mutation(plan, made.results, made.read)).status,
    ).toBe("UNVERIFIED");
  });
  it("same-account tracking inheritance is a frozen customer dependency", async () => {
    const f = fixture();
    Object.assign(f.customer, {
      trackingUrlTemplate: "https://account.example.test/?u={lpurl}",
      finalUrlSuffix: "utm_source=account",
    });
    const plan = await f.clone(),
      before = canonical(plan.checks);
    expect(
      plan.checks.some((c) =>
        c.query.includes("customer.tracking_url_template"),
      ),
    ).toBe(true);
    Object.assign(f.customer, {
      trackingUrlTemplate: "https://changed.example.test/?u={lpurl}",
    });
    expect(canonical(await rereadStage0Checks(plan, f.read))).not.toBe(before);
    expect(canonical(plan.checks)).toBe(before);
  });
  it.each(["template", "suffix", "mobile", "custom"])(
    "recreated sitelink %s override rejected rather than dropped",
    async (field) => {
      const f = fixture(),
        asset: JsonRow = {
          resourceName: `${prefix}/assets/15`,
          type: "SITELINK",
          finalUrls: ["https://example.test/"],
          sitelinkAsset: { linkText: "Test link" },
        };
      if (field === "template")
        asset.trackingUrlTemplate = "https://track.example.test/?u={lpurl}";
      if (field === "suffix") asset.finalUrlSuffix = "utm_source=asset";
      if (field === "mobile")
        asset.finalMobileUrls = ["https://mobile.example.test/"];
      if (field === "custom")
        asset.urlCustomParameters = [{ key: "channel", value: "asset" }];
      f.assets.set(String(asset.resourceName), asset);
      f.assetLinks.push({
        resourceName: `${prefix}/campaignAssets/1~15~1`,
        campaign: f.campaign.resourceName,
        asset: asset.resourceName,
        fieldType: "SITELINK",
        status: "ENABLED",
      });
      await expect(f.clone()).rejects.toMatchObject({
        writeCode: "google_clone_tracking_unsupported",
      });
      expect(f.build).not.toHaveBeenCalled();
      expect(
        f.read.mock.calls.some(([q]) => q.includes("asset.final_mobile_urls")),
      ).toBe(true);
    },
  );
  it.each(["group_parent", "group_count", "keyword_identity"])(
    "internal target %s mismatch cannot redirect a source override",
    async (fault) => {
      const f = fixture();
      f.group.finalUrlSuffix = "utm_source=source";
      f.build.mockImplementationOnce(async (brief) => {
        const plan = await buildStage0Plan(account, brief, f.read, async () => [
          f.geo,
        ]);
        const group = plan.operations.find((o) => o.kind === "adGroup")!,
          keyword = plan.operations.find((o) => o.kind === "adGroupCriterion")!;
        if (fault === "group_parent")
          group.fields.campaign = `customers/1111111111/campaigns/-1`;
        if (fault === "group_count")
          plan.operations = plan.operations.filter((o) => o !== group);
        if (fault === "keyword_identity")
          keyword.fields.keyword = { text: "different", matchType: "EXACT" };
        return plan;
      });
      await expect(f.clone()).rejects.toMatchObject({
        writeCode: "google_clone_target_invalid",
      });
    },
  );
  it.each([
    "duplicate_case",
    "long_key",
    "nonalphanumeric_key",
    "utf8_value",
    "too_many_parameters",
    "unknown_parameter_leaf",
    "invalid_parameter_type",
    "mobile_multiple",
    "mobile_credentials",
    "desktop_multiple",
    "desktop_type",
    "template_http",
    "template_braces",
    "template_credentials",
    "suffix_querymark",
    "negative_override",
    "app_urls",
    "url_collections",
  ])(
    "unsafe/unsupported tracking %s fails before target builder",
    async (fault) => {
      const f = fixture(),
        k = f.keys[0]!,
        ad = row(f.ads[0]!.ad);
      if (fault === "duplicate_case")
        k.urlCustomParameters = [
          { key: "Channel", value: "a" },
          { key: "channel", value: "b" },
        ];
      if (fault === "long_key")
        k.urlCustomParameters = [{ key: "a".repeat(17), value: "a" }];
      if (fault === "nonalphanumeric_key")
        k.urlCustomParameters = [{ key: "bad_key", value: "a" }];
      if (fault === "utf8_value")
        k.urlCustomParameters = [{ key: "value", value: "Я".repeat(101) }];
      if (fault === "too_many_parameters")
        k.urlCustomParameters = Array.from({ length: 9 }, (_, i) => ({
          key: "k" + i,
          value: "a",
        }));
      if (fault === "unknown_parameter_leaf")
        k.urlCustomParameters = [
          { key: "value", value: "a", extra: "not-typed" },
        ];
      if (fault === "invalid_parameter_type") k.urlCustomParameters = "invalid";
      if (fault === "mobile_multiple")
        k.finalMobileUrls = [
          "https://m1.example.test/",
          "https://m2.example.test/",
        ];
      if (fault === "mobile_credentials")
        k.finalMobileUrls = ["https://user:password@example.test/"];
      if (fault === "desktop_multiple")
        k.finalUrls = ["https://a.example.test/", "https://b.example.test/"];
      if (fault === "desktop_type") k.finalUrls = "https://a.example.test/";
      if (fault === "template_http")
        k.trackingUrlTemplate = "http://track.example.test/?u={lpurl}";
      if (fault === "template_braces")
        k.trackingUrlTemplate =
          "https://track.example.test/?u={lpurl}&x={invalid";
      if (fault === "template_credentials")
        k.trackingUrlTemplate = "https://user:password@example.test/?u={lpurl}";
      if (fault === "suffix_querymark") k.finalUrlSuffix = "?utm_source=bad";
      if (fault === "negative_override") {
        k.negative = true;
        k.finalUrlSuffix = "utm_source=bad";
      }
      if (fault === "app_urls")
        ad.finalAppUrls = [
          { osType: "ANDROID", url: "android-app://example.test/" },
        ];
      if (fault === "url_collections")
        ad.urlCollections = [
          { id: "collection", finalUrls: ["https://example.test/"] },
        ];
      await expect(f.clone()).rejects.toBeInstanceOf(Error);
      expect(f.build).not.toHaveBeenCalled();
    },
  );
  it.each([
    "duplicate_link",
    "duplicate_member",
    "inactive",
    "wrong_type",
    "member_type",
    "call_type",
  ])("invalid reference profile %s fails closed", async (fault) => {
    const f = fixture();
    f.addShared();
    f.addAssets();
    if (fault === "duplicate_link") f.links.push({ ...f.links[0] });
    if (fault === "duplicate_member") f.members.push({ ...f.members[0] });
    if (fault === "inactive") f.lists[0]!.status = "REMOVED";
    if (fault === "wrong_type") f.lists[0]!.type = "BRANDS";
    if (fault === "member_type") f.members[0]!.keyword = {};
    if (fault === "call_type")
      f.assets.get(`${prefix}/assets/13`)!.type = "TEXT";
    await expect(f.clone()).rejects.toBeInstanceOf(Error);
    expect(f.build).not.toHaveBeenCalled();
  });
  it.each([
    "audience",
    "device",
    "custom_goal",
    "non_rsa",
    "non_search",
    "target_cpa",
  ])(
    "remaining source %s is explicit unsupported, not silently dropped",
    async (part) => {
      const f = fixture();
      if (part === "audience" || part === "device")
        f.criteria.push({
          resourceName: `${prefix}/campaignCriteria/1~99`,
          campaign: f.campaign.resourceName,
          [part]: {},
        });
      if (part === "non_rsa") row(f.ads[0]!.ad).responsiveSearchAd = undefined;
      if (part === "non_search")
        f.campaign.advertisingChannelType = "PERFORMANCE_MAX";
      if (part === "target_cpa")
        f.campaign.maximizeConversions = { targetCpaMicros: "100000" };
      const read =
        part === "custom_goal"
          ? async (q: string) =>
              q.includes("FROM conversion_goal_campaign_config")
                ? [
                    {
                      conversionGoalCampaignConfig: {
                        customConversionGoal: `${prefix}/customConversionGoals/90`,
                      },
                    },
                  ]
                : f.read(q)
          : f.read;
      await expect(
        buildClonePlan(account, f.input, read, f.build),
      ).rejects.toMatchObject({
        writeCode: "google_clone_unsupported_components",
      });
      expect(f.build).not.toHaveBeenCalled();
    },
  );
  it("radius geo override/negative/address-only/invalid source coordinates are explicit rejects", async () => {
    const f = fixture();
    f.addRadius();
    await expect(
      f.clone({ new_locations: [{ name: "Астана" }] }),
    ).rejects.toMatchObject({
      writeCode: "google_clone_geo_override_requires_radius",
    });
    f.criteria.at(-1)!.negative = true;
    await expect(f.clone()).rejects.toMatchObject({
      writeCode: "google_clone_unsupported_components",
    });
    f.criteria.at(-1)!.negative = false;
    row(f.criteria.at(-1)!.proximity).geoPoint = undefined;
    await expect(f.clone()).rejects.toMatchObject({
      writeCode: "google_clone_unsupported_components",
    });
    row(f.criteria.at(-1)!.proximity).geoPoint = {
      latitudeInMicroDegrees: 90_000_001,
      longitudeInMicroDegrees: 0,
    };
    await expect(f.clone()).rejects.toMatchObject({
      writeCode: "google_clone_reference_invalid",
    });
    expect(f.build).not.toHaveBeenCalled();
  });
  it("rechecks 500-operation limit after reference associations, without truncation", async () => {
    const f = fixture();
    f.addShared();
    const build = async (brief: JsonRow) => {
      const plan = await f.build(brief),
        original = plan.operations.find((o) => o.kind === "campaignCriterion")!;
      while (plan.operations.length < 500)
        plan.operations.push({ ...original });
      return plan;
    };
    await expect(
      buildClonePlan(account, f.input, f.read, build),
    ).rejects.toMatchObject({ writeCode: "google_batch_limit_exceeded" });
  });
  it("foreign account/unknown caller fields reject before reads; source stays unmodified", async () => {
    const f = fixture();
    await expect(f.clone({ account_id: "1234567890" })).rejects.toMatchObject({
      writeCode: "google_account_mismatch",
    });
    await expect(f.clone({ operations: [] })).rejects.toBeInstanceOf(Error);
    expect(f.read).not.toHaveBeenCalled();
  });
  it("malformed provider micros and non-global geo/language references reject safely", async () => {
    for (const value of ["not-number", "-1", "1.5", "9".repeat(20)]) {
      const f = fixture();
      f.budget.amountMicros = value;
      await expect(f.clone()).rejects.toMatchObject({
        writeCode: "google_clone_reference_invalid",
      });
      expect(f.build).not.toHaveBeenCalled();
    }
    for (const type of ["location", "language"]) {
      const f = fixture(),
        criterion = f.criteria.find((c) => c[type])!;
      row(criterion[type])[
        type === "location" ? "geoTargetConstant" : "languageConstant"
      ] = "customers/1234567890/campaignCriteria/1~2";
      await expect(f.clone()).rejects.toMatchObject({
        writeCode: "google_clone_reference_invalid",
      });
      expect(
        f.read.mock.calls.every(([q]) => !q.includes("customers/1234567890")),
      ).toBe(true);
      expect(f.build).not.toHaveBeenCalled();
    }
  });
  it("default devices are explicit immutable postconditions and cause no device mutations", async () => {
    const f = fixture(),
      p = await f.clone();
    expect(p.provider_managed_defaults).toEqual([
      {
        kind: "campaign_default_devices",
        campaign_resource: p.operations.find((o) => o.kind === "campaign")!
          .resource_name,
      },
    ]);
    expect(
      p.operations.some(
        (o) => o.fields.device || o.fields.bidModifier !== undefined,
      ),
    ).toBe(false);
    expect(
      p.checks.some(
        (c) =>
          c.query.includes("campaign_criterion.device.type") &&
          c.query.includes("campaign_criterion.bid_modifier"),
      ),
    ).toBe(true);
    const source = f.criteria.find((c) => c.type === "DEVICE")!;
    source.bidModifier = 1.2;
    expect(canonical(await rereadStage0Checks(p, f.read))).not.toBe(
      canonical(p.checks),
    );
  });
  it.each([
    "zero",
    "custom",
    "null",
    "string",
    "missing",
    "none",
    "duplicate",
    "foreign",
    "wrong_type",
    "paused",
    "negative",
    "id",
    "extra",
  ])("source device %s fails closed before typed create", async (failure) => {
    const f = fixture(),
      d = f.criteria.find((c) => c.type === "DEVICE")!;
    if (failure === "zero") d.bidModifier = 0;
    if (failure === "custom") d.bidModifier = 1.2;
    if (failure === "null") d.bidModifier = null;
    if (failure === "string") d.bidModifier = "1";
    if (failure === "missing") f.criteria.splice(f.criteria.indexOf(d), 1);
    if (failure === "none") f.criteria.splice(2);
    if (failure === "duplicate") f.criteria.push(structuredClone(d));
    if (failure === "foreign") d.campaign = "customers/1234567890/campaigns/1";
    if (failure === "wrong_type") d.device = { type: "MOBILE" };
    if (failure === "paused") d.status = "PAUSED";
    if (failure === "negative") d.negative = true;
    if (failure === "id") d.criterionId = "30001";
    if (failure === "extra")
      f.criteria.push({
        ...d,
        resourceName: `${prefix}/campaignCriteria/1~30004`,
        criterionId: "30004",
        device: { type: "CONNECTED_TV" },
      });
    await expect(f.clone()).rejects.toMatchObject({
      writeCode:
        failure === "foreign" || failure === "paused"
          ? "google_clone_reference_invalid"
          : "google_clone_device_defaults_unproven",
    });
    expect(f.build).not.toHaveBeenCalled();
  });
  it("explicit neutral source/target1 is safe but target missing/custom/read failure never verifies", async () => {
    const f = fixture();
    f.criteria
      .filter((c) => c.type === "DEVICE")
      .forEach((c) => (c.bidModifier = 1));
    const p = await f.clone(),
      created = mockCreated(p);
    const deviceRows = [...created.actual.values()].filter(
      (c) => row(c.campaignCriterion).type === "DEVICE",
    );
    deviceRows.forEach((c) => (row(c.campaignCriterion).bidModifier = 1));
    expect(
      (await verifyStage0Mutation(p, created.results, created.read)).status,
    ).toBe("VERIFIED");
    row(deviceRows[0]!.campaignCriterion).bidModifier = 0;
    expect(
      (await verifyStage0Mutation(p, created.results, created.read)).status,
    ).toBe("UNVERIFIED");
    row(deviceRows[0]!.campaignCriterion).bidModifier = 1;
    created.actual.delete(
      String(row(deviceRows[0]!.campaignCriterion).resourceName),
    );
    expect(
      (await verifyStage0Mutation(p, created.results, created.read)).status,
    ).toBe("UNVERIFIED");
    const readFailure = (q: string) => {
      if (q.includes("type = DEVICE")) throw new Error("mock unavailable");
      return created.read(q);
    };
    expect(
      (await verifyStage0Mutation(p, created.results, readFailure)).status,
    ).toBe("UNVERIFIED");
  });
  it("non-neutral source geo and any ad-group bid modifiers are not silently dropped", async () => {
    const f = fixture();
    f.criteria[0]!.bidModifier = 1.2;
    await expect(f.clone()).rejects.toMatchObject({
      writeCode: "google_clone_unsupported_components",
    });
    f.criteria[0]!.bidModifier = 1;
    const customRead = async (q: string) =>
      q.includes("FROM ad_group_bid_modifier")
        ? [
            {
              adGroupBidModifier: {
                resourceName: `${prefix}/adGroupBidModifiers/2~30001`,
                adGroup: f.group.resourceName,
                device: { type: "MOBILE" },
                bidModifier: 1.2,
                bidModifierSource: "AD_GROUP",
              },
            },
          ]
        : f.read(q);
    await expect(
      buildClonePlan(account, f.input, customRead, f.build),
    ).rejects.toMatchObject({
      writeCode: "google_clone_unsupported_components",
    });
    expect(f.build).not.toHaveBeenCalled();
  });
  it.each([
    "foreign",
    "wrong_id",
    "wrong_type",
    "paused",
    "negative",
    "extra",
    "duplicate",
    "oneof",
  ])(
    "target device %s keeps all mutation results but blocks VERIFIED post-state",
    async (failure) => {
      const f = fixture(),
        p = await f.clone(),
        created = mockCreated(p);
      const targetRead = async (q: string) => {
        const rows = structuredClone(await created.read(q));
        if (!q.includes("type = DEVICE")) return rows;
        const first = row(rows[0]!.campaignCriterion);
        if (failure === "foreign")
          first.campaign = "customers/1234567890/campaigns/1";
        if (failure === "wrong_id") first.criterionId = "30001";
        if (failure === "wrong_type") first.device = { type: "MOBILE" };
        if (failure === "paused") first.status = "PAUSED";
        if (failure === "negative") first.negative = true;
        if (failure === "extra")
          rows.push({
            campaignCriterion: {
              ...first,
              resourceName: String(first.resourceName).replace(
                "~30000",
                "~30004",
              ),
              criterionId: "30004",
              device: { type: "CONNECTED_TV" },
            },
          });
        if (failure === "duplicate") rows.push(structuredClone(rows[0]!));
        if (failure === "oneof")
          first.location = { geoTargetConstant: "geoTargetConstants/1" };
        return rows;
      };
      const verified = await verifyStage0Mutation(
        p,
        created.results,
        targetRead,
      );
      expect(verified.items.every((i) => i.success)).toBe(true);
      expect(verified.status).toBe("UNVERIFIED");
      expect(verified.provider_managed_defaults![0]).toMatchObject({
        success: false,
        error: { google_code: "OUTCOME_UNCERTAIN" },
      });
    },
  );
});

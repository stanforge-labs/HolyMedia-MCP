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
  const lists: JsonRow[] = [],
    links: JsonRow[] = [],
    members: JsonRow[] = [],
    assetLinks: JsonRow[] = [],
    assets = new Map<string, JsonRow>();
  const read = vi.fn(async (q: string): Promise<JsonRow[]> => {
    let result: JsonRow[] = [];
    if (q.includes("FROM campaign_budget"))
      result = [{ campaignBudget: budget }];
    else if (
      q.includes("FROM customer_conversion_goal") ||
      q.includes("FROM conversion_action") ||
      q.includes("FROM campaign_conversion_goal") ||
      q.includes("FROM conversion_goal_campaign_config")
    )
      result = [];
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
    };
    let name = `${prefix}/${kind[op.kind]}/${1000 + index}`;
    if (op.kind === "campaignSharedSet")
      name = `${prefix}/campaignSharedSets/${String(fields.campaign).split("/").at(-1)}~${String(fields.sharedSet).split("/").at(-1)}`;
    if (op.resource_name) references.set(op.resource_name, name);
    const entity: JsonRow = { ...fields, ...expected, resourceName: name };
    if (op.kind === "campaign")
      entity.biddingStrategyType = plan.summary.strategy;
    actual.set(name, { [op.kind]: entity });
    return { success: true, resource_name: name, error: null };
  });
  const read = async (q: string) =>
    [...actual.values()].filter((v) =>
      q.includes(
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
});

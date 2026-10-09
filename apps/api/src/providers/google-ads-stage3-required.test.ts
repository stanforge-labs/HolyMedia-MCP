import { describe, expect, it, vi } from "vitest";
import {
  buildStage3Plan,
  parseStage3Intent,
  searchStage3Audiences,
} from "./google-ads-stage3.js";
import { canonical } from "./google-ads-stage1.js";
import {
  extRow,
  rereadExtendedChecks,
  verifyExtendedMutation,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";
import {
  stage3ToolSchema,
  stage3ToolIntent,
} from "../mcp/mcp-google-stage3-schema.js";

// All identities are synthetic mock data, not claims of live Google taxonomy availability.
const account = "8590146099",
  prefix = `customers/${account}`,
  c = `${prefix}/campaigns/1`,
  g = `${prefix}/adGroups/2`;
const campaign = { level: "CAMPAIGN", campaign_id: "1" },
  group = { level: "AD_GROUP", campaign_id: "1", ad_group_id: "2" };
function mock() {
  const s = {
    customer: {
      resourceName: prefix,
      id: account,
      currencyCode: "USD",
      timeZone: "Asia/Almaty",
    } as ExtendedRow,
    campaign: {
      resourceName: c,
      id: "1",
      name: "TEST",
      status: "PAUSED",
      advertisingChannelType: "SEARCH",
      advertisingChannelSubType: "UNSPECIFIED",
      biddingStrategyType: "MANUAL_CPC",
      biddingStrategy: "",
      targetingSetting: {},
      geoTargetTypeSetting: {
        positiveGeoTargetType: "PRESENCE",
        negativeGeoTargetType: "PRESENCE",
      },
    } as ExtendedRow,
    group: {
      resourceName: g,
      id: "2",
      campaign: c,
      status: "PAUSED",
      name: "TEST group",
      targetingSetting: {
        targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: true }],
      },
    } as ExtendedRow,
    criteria: [] as ExtendedRow[],
    groupCriteria: [] as ExtendedRow[],
    catalog: {
      resourceName: `${prefix}/detailedDemographics/6`,
      id: "6",
      name: "synthetic detail",
      launchedToAll: true,
    } as ExtendedRow,
    list: {
      resourceName: `${prefix}/userLists/3`,
      id: "3",
      name: "synthetic remarketing",
      membershipStatus: "OPEN",
      accountUserListStatus: "ENABLED",
      eligibleForSearch: true,
      eligibleForDisplay: true,
    } as ExtendedRow,
    geo: {
      resourceName: "geoTargetConstants/100",
      id: "100",
      name: "synthetic district",
      canonicalName: "synthetic district,Almaty,Kazakhstan",
      countryCode: "KZ",
      targetType: "District",
      status: "ENABLED",
    } as ExtendedRow,
  };
  const read = vi.fn(async (q: string): Promise<ExtendedRow[]> => {
    if (q.includes(" FROM customer"))
      return [{ customer: structuredClone(s.customer) }];
    if (q.includes(" FROM campaign "))
      return [{ campaign: structuredClone(s.campaign) }];
    if (q.includes(" FROM ad_group "))
      return [{ adGroup: structuredClone(s.group) }];
    if (q.includes(" FROM campaign_criterion "))
      return s.criteria
        .filter((x) => q.includes(`'${x.type}'`))
        .map((x) => ({ campaignCriterion: structuredClone(x) }));
    if (q.includes(" FROM ad_group_criterion "))
      return s.groupCriteria
        .filter((x) => q.includes(`'${x.type}'`))
        .map((x) => ({ adGroupCriterion: structuredClone(x) }));
    if (q.includes(" FROM detailed_demographic "))
      return [{ detailedDemographic: structuredClone(s.catalog) }];
    if (q.includes(" FROM user_list "))
      return [{ userList: structuredClone(s.list) }];
    if (q.includes(" FROM geo_target_constant "))
      return [{ geoTargetConstant: structuredClone(s.geo) }];
    throw new Error(`Unmocked query ${q}`);
  });
  return { s, read };
}
const intent = (...items: ExtendedRow[]) => ({ action: "targeting", items });
function criterion(
  type: string,
  field: ExtendedRow = {},
  isGroup = true,
  id = "7",
) {
  return {
    resourceName: `${prefix}/${isGroup ? "adGroupCriteria/2" : "campaignCriteria/1"}~${id}`,
    criterionId: id,
    [isGroup ? "adGroup" : "campaign"]: isGroup ? g : c,
    type,
    status: "ENABLED",
    negative: false,
    bidModifier: 1,
    ...field,
  };
}
async function rejects(p: Promise<unknown>, writeCode: string) {
  await expect(p).rejects.toMatchObject({ writeCode });
}

describe("Original DOCX P194–225 REQUIRED Stage 3 mock profiles", () => {
  it("P203 audience add with modifier rejects TARGETING before account read", async () => {
    const f = mock();
    await rejects(
      buildStage3Plan(
        account,
        intent({
          ...group,
          operation: "audience_add",
          audience: { kind: "USER_LIST", id: "3" },
          mode: "TARGETING",
          bid_modifier: 1.2,
        }),
        f.read,
      ),
      "google_stage3_observation_required",
    );
    expect(f.read).not.toHaveBeenCalled();
  });
  it.each([undefined, false])(
    "P203 actual default/TARGETING bidOnly %s cannot be bypassed by modifier",
    async (bidOnly) => {
      const f = mock();
      f.s.group.targetingSetting = {
        targetRestrictions: [
          {
            targetingDimension: "AUDIENCE",
            ...(bidOnly !== undefined ? { bidOnly } : {}),
          },
        ],
      };
      f.s.groupCriteria.push(
        criterion("USER_LIST", {
          userList: { userList: `${prefix}/userLists/3` },
        }),
      );
      await rejects(
        buildStage3Plan(
          account,
          intent({
            ...group,
            operation: "audience_bid_modifier",
            criterion_id: "7",
            bid_modifier: 1.2,
          }),
          f.read,
        ),
        "google_stage3_observation_required",
      );
    },
  );
  it("P198–203 campaign audience modifier in OBSERVATION is leaf-only, reversible and provider-verified", async () => {
    const f = mock();
    f.s.campaign.targetingSetting = {
      targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: true }],
    };
    f.s.group.targetingSetting = {};
    f.s.criteria.push(
      criterion(
        "USER_LIST",
        { userList: { userList: `${prefix}/userLists/3` } },
        false,
      ),
    );
    const p = await buildStage3Plan(
      account,
      intent({
        ...campaign,
        operation: "audience_bid_modifier",
        criterion_id: "7",
        bid_modifier: 1.2,
      }),
      f.read,
    );
    expect(p.operations[0]!.fields).toEqual({
      resourceName: `${prefix}/campaignCriteria/1~7`,
      bidModifier: 1.2,
    });
    expect(p.operations[0]!.update_mask).toBe("bid_modifier");
    expect(p.items[0]!.before).toMatchObject({ audience_mode: "OBSERVATION" });
    expect(p.items[0]!.after).toMatchObject({ audience_mode: "OBSERVATION" });
    expect(p.inverse_intent!.items).toEqual([
      {
        ...campaign,
        operation: "audience_bid_modifier",
        criterion_id: "7",
        bid_modifier: 1,
      },
    ]);
    f.s.criteria[0]!.bidModifier = 1.2;
    expect(
      (
        await verifyExtendedMutation(
          p,
          [
            {
              success: true,
              resource_name: `${prefix}/campaignCriteria/1~7`,
              error: null,
            },
          ],
          f.read,
        )
      ).status,
    ).toBe("VERIFIED");
    f.s.campaign.targetingSetting = {
      targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: false }],
    };
    expect(canonical(await rereadExtendedChecks(p, f.read))).not.toBe(
      canonical(p.checks),
    );
  });
  it("P200–203 inherited campaign OBSERVATION supports group add/modifier without hidden campaign edits", async () => {
    const f = mock();
    f.s.campaign.targetingSetting = {
      targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: true }],
    };
    f.s.group.targetingSetting = {};
    const add = await buildStage3Plan(
      account,
      intent({
        ...group,
        operation: "audience_add",
        audience: { kind: "USER_LIST", id: "3" },
        mode: "OBSERVATION",
        bid_modifier: 1.25,
      }),
      f.read,
    );
    expect(add.operations).toHaveLength(1);
    expect(add.operations[0]!.kind).toBe("adGroupCriteria");
    expect(add.operations[0]!.fields.bidModifier).toBe(1.25);
    expect(add.items[0]!.warnings.join(" ")).toContain("унаследован");
    f.s.groupCriteria.push(
      criterion("USER_LIST", {
        userList: { userList: `${prefix}/userLists/3` },
      }),
    );
    expect(
      (
        await buildStage3Plan(
          account,
          intent({
            ...group,
            operation: "audience_bid_modifier",
            criterion_id: "7",
            bid_modifier: 1.3,
          }),
          f.read,
        )
      ).operations[0]!.fields.bidModifier,
    ).toBe(1.3);
    await rejects(
      buildStage3Plan(
        account,
        intent({
          ...group,
          operation: "audience_add",
          audience: { kind: "USER_LIST", id: "3" },
          mode: "TARGETING",
        }),
        f.read,
      ),
      "google_stage3_mode_parent_conflict",
    );
  });
  it.each(["AGE_RANGE", "GENDER", "PARENTAL_STATUS", "INCOME_RANGE"])(
    "P210–212 %s demographic bid modifier updates exact existing group criterion, with inverse",
    async (dimension) => {
      const f = mock(),
        field = {
          AGE_RANGE: "ageRange",
          GENDER: "gender",
          PARENTAL_STATUS: "parentalStatus",
          INCOME_RANGE: "incomeRange",
        }[dimension]!;
      f.s.groupCriteria.push(
        criterion(dimension, {
          [field]: { type: dimension === "GENDER" ? "MALE" : "TEST_VALUE" },
        }),
      );
      const row = {
        ...group,
        operation: "demographic_bid_modifier",
        dimension,
        criterion_id: "7",
        bid_modifier: 1.15,
      };
      const p = await buildStage3Plan(account, intent(row), f.read);
      expect(p.operations[0]!.fields).toEqual({
        resourceName: `${prefix}/adGroupCriteria/2~7`,
        bidModifier: 1.15,
      });
      expect(p.operations[0]!.update_mask).toBe("bid_modifier");
      expect(p.operations[0]!.expected[field]).toEqual(
        f.s.groupCriteria[0]![field],
      );
      expect(p.inverse_intent!.items).toEqual([{ ...row, bid_modifier: 1 }]);
      f.s.groupCriteria[0]!.bidModifier = 1.15;
      expect(
        (
          await verifyExtendedMutation(
            p,
            [
              {
                success: true,
                resource_name: `${prefix}/adGroupCriteria/2~7`,
                error: null,
              },
            ],
            f.read,
          )
        ).status,
      ).toBe("VERIFIED");
    },
  );
  it("P210–212 demographic create can specify a supported multiplier; negative cannot carry one", async () => {
    const f = mock(),
      p = await buildStage3Plan(
        account,
        intent({
          ...group,
          operation: "demographic_add",
          dimension: "GENDER",
          value: "MALE",
          bid_modifier: 1.2,
        }),
        f.read,
      );
    expect(p.operations[0]!.fields).toMatchObject({
      gender: { type: "MALE" },
      bidModifier: 1.2,
      negative: false,
    });
    expect(() =>
      parseStage3Intent(
        intent({
          ...group,
          operation: "demographic_exclude",
          dimension: "GENDER",
          value: "MALE",
          bid_modifier: 1.2,
        }),
      ),
    ).toThrow();
  });
  it("P210–212 wrong dimension, negative, foreign-parent and auto-strategy modifiers reject", async () => {
    const f = mock();
    f.s.groupCriteria.push(criterion("GENDER", { gender: { type: "MALE" } }));
    const row = {
      ...group,
      operation: "demographic_bid_modifier",
      dimension: "AGE_RANGE",
      criterion_id: "7",
      bid_modifier: 1.2,
    };
    await rejects(
      buildStage3Plan(account, intent(row), f.read),
      "google_stage3_criterion_unavailable",
    );
    f.s.groupCriteria[0]!.negative = true;
    await rejects(
      buildStage3Plan(account, intent({ ...row, dimension: "GENDER" }), f.read),
      "google_stage3_modifier_invalid",
    );
    f.s.groupCriteria[0]!.negative = false;
    f.s.groupCriteria[0]!.adGroup = `${prefix}/adGroups/99`;
    await rejects(
      buildStage3Plan(account, intent({ ...row, dimension: "GENDER" }), f.read),
      "google_extended_ownership_invalid",
    );
    f.s.groupCriteria[0]!.adGroup = g;
    f.s.campaign.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    await rejects(
      buildStage3Plan(account, intent({ ...row, dimension: "GENDER" }), f.read),
      "google_stage3_strategy_incompatible",
    );
  });
  it("P198–200 detailed demographics resolve owned real catalog references, numeric taxonomy leaf and mode", async () => {
    const f = mock(),
      p = await buildStage3Plan(
        account,
        intent({
          ...group,
          operation: "audience_add",
          audience: { kind: "DETAILED_DEMOGRAPHIC", name: "synthetic detail" },
          mode: "OBSERVATION",
        }),
        f.read,
      );
    expect(p.operations[0]!.fields.extendedDemographic).toEqual({
      extendedDemographicId: "6",
    });
    expect(p.operations[0]!.fields).not.toHaveProperty("userInterest");
    expect(
      p.checks.some((x) => x.query.includes(" FROM detailed_demographic ")),
    ).toBe(true);
    expect(p.operations[0]!.read_query).toContain(
      "extended_demographic.extended_demographic_id",
    );
    expect(p.items[0]!.after).toMatchObject({ audience_mode: "OBSERVATION" });
    const exclude = await buildStage3Plan(
      account,
      intent({
        ...group,
        operation: "audience_exclude",
        audience: { kind: "DETAILED_DEMOGRAPHIC", id: "6" },
        mode: "OBSERVATION",
      }),
      f.read,
    );
    expect(exclude.operations[0]!.fields.negative).toBe(true);
    const search = await searchStage3Audiences(
      account,
      { name: "synthetic", kind: "DETAILED_DEMOGRAPHIC" },
      f.read,
    );
    expect(search.matches[0]!.resourceName).toBe(
      `${prefix}/detailedDemographics/6`,
    );
  });
  it("Detailed demographic missing/foreign/ineligible/ambiguous catalog is not replaced by invented IDs", async () => {
    const row = {
        ...group,
        operation: "audience_add",
        audience: { kind: "DETAILED_DEMOGRAPHIC", id: "6" },
        mode: "OBSERVATION",
      },
      f = mock();
    await rejects(
      buildStage3Plan(account, intent(row), async (q) =>
        q.includes(" FROM detailed_demographic ") ? [] : f.read(q),
      ),
      "google_stage3_audience_ambiguous",
    );
    f.s.catalog.resourceName = "customers/0000000000/detailedDemographics/6";
    await rejects(
      buildStage3Plan(account, intent(row), f.read),
      "google_extended_ownership_invalid",
    );
    f.s.catalog.resourceName = `${prefix}/detailedDemographics/6`;
    f.s.catalog.launchedToAll = false;
    await rejects(
      buildStage3Plan(account, intent(row), f.read),
      "google_stage3_audience_ineligible",
    );
    f.s.catalog.launchedToAll = true;
    await rejects(
      buildStage3Plan(account, intent(row), async (q) =>
        q.includes(" FROM detailed_demographic ")
          ? [
              { detailedDemographic: f.s.catalog },
              { detailedDemographic: f.s.catalog },
            ]
          : f.read(q),
      ),
      "google_stage3_audience_ambiguous",
    );
  });
  it("Detailed demographic supported channel availability works; locale-constrained unproven profile rejects", async () => {
    const f = mock();
    f.s.catalog.launchedToAll = false;
    f.s.catalog.availabilities = [
      {
        channel: {
          availabilityMode: "CHANNEL_TYPE",
          advertisingChannelType: "SEARCH",
        },
        locale: [{ availabilityMode: "LAUNCHED_TO_ALL" }],
      },
    ];
    const row = {
      ...group,
      operation: "audience_add",
      audience: { kind: "DETAILED_DEMOGRAPHIC", id: "6" },
      mode: "OBSERVATION",
    };
    expect(
      (await buildStage3Plan(account, intent(row), f.read)).operations,
    ).toHaveLength(1);
    f.s.catalog.availabilities = [
      {
        channel: {
          availabilityMode: "CHANNEL_TYPE",
          advertisingChannelType: "DISPLAY",
        },
        locale: [{ availabilityMode: "LAUNCHED_TO_ALL" }],
      },
    ];
    await rejects(
      buildStage3Plan(account, intent(row), f.read),
      "google_stage3_audience_ineligible",
    );
    f.s.catalog.availabilities = [
      {
        channel: {
          availabilityMode: "CHANNEL_TYPE",
          advertisingChannelType: "SEARCH",
        },
        locale: [{ availabilityMode: "COUNTRY", countryCode: "KZ" }],
      },
    ];
    await rejects(
      buildStage3Plan(account, intent(row), f.read),
      "google_stage3_audience_ineligible",
    );
  });
  it("Detailed name lookup cannot substitute mismatching numeric taxonomy ID", async () => {
    const f = mock();
    f.s.catalog.id = "999";
    await rejects(
      buildStage3Plan(
        account,
        intent({
          ...group,
          operation: "audience_add",
          audience: { kind: "DETAILED_DEMOGRAPHIC", name: "synthetic detail" },
          mode: "OBSERVATION",
        }),
        f.read,
      ),
      "google_stage3_audience_invalid",
    );
  });
  it("Detailed demographic remove and observation modifier use exact extended criterion, never ad keyword", async () => {
    const f = mock();
    f.s.groupCriteria.push(
      criterion("EXTENDED_DEMOGRAPHIC", {
        extendedDemographic: { extendedDemographicId: "6" },
      }),
    );
    const p = await buildStage3Plan(
      account,
      intent({
        ...group,
        operation: "audience_bid_modifier",
        criterion_id: "7",
        bid_modifier: 1.2,
      }),
      f.read,
    );
    expect(p.operations[0]!.update_mask).toBe("bid_modifier");
    const remove = await buildStage3Plan(
      account,
      intent({
        ...group,
        operation: "audience_remove",
        criterion_id: "7",
        acknowledge_irreversible: true,
      }),
      f.read,
    );
    expect(remove.operations[0]!.resource_name).toBe(
      `${prefix}/adGroupCriteria/2~7`,
    );
    expect(remove.irreversible).toBe(true);
  });
  it("P219–221 schedule modifier preserves interval, uses account timezone and has exact inverse", async () => {
    const f = mock(),
      schedule = {
        dayOfWeek: "MONDAY",
        startHour: 9,
        startMinute: "FIFTEEN",
        endHour: 17,
        endMinute: "ZERO",
      };
    f.s.criteria.push(
      criterion("AD_SCHEDULE", { adSchedule: schedule }, false),
    );
    const row = {
        ...campaign,
        operation: "schedule_bid_modifier",
        criterion_id: "7",
        bid_modifier: 0.8,
      },
      p = await buildStage3Plan(account, intent(row), f.read);
    expect(p.operations[0]!.fields).toEqual({
      resourceName: `${prefix}/campaignCriteria/1~7`,
      bidModifier: 0.8,
    });
    expect(p.operations[0]!.expected.adSchedule).toEqual(schedule);
    expect(p.items[0]!.warnings.join(" ")).toContain("Asia/Almaty");
    expect(p.inverse_intent!.items).toEqual([{ ...row, bid_modifier: 1 }]);
    f.s.criteria[0]!.bidModifier = 0.8;
    expect(
      (
        await verifyExtendedMutation(
          p,
          [
            {
              success: true,
              resource_name: `${prefix}/campaignCriteria/1~7`,
              error: null,
            },
          ],
          f.read,
        )
      ).status,
    ).toBe("VERIFIED");
    const add = await buildStage3Plan(
      account,
      intent({
        ...campaign,
        operation: "schedule_add",
        days: ["TUESDAY"],
        start: "09:00",
        end: "17:00",
        bid_modifier: 1.3,
      }),
      f.read,
    );
    expect(add.operations[0]!.fields.bidModifier).toBe(1.3);
  });
  it("P215 GeoTargetConstantService suggestion is independently GAQL-proven and frozen, not raw candidate trust", async () => {
    const f = mock(),
      suggest = vi.fn(async () => [{ geoTargetConstant: f.s.geo }]),
      row = {
        ...campaign,
        operation: "geo_add",
        name: "Алматинский район",
        country_code: "KZ",
      };
    const p = await buildStage3Plan(account, intent(row), f.read, suggest);
    expect(suggest).toHaveBeenCalledWith("Алматинский район", "KZ");
    expect(p.operations[0]!.fields.location).toEqual({
      geoTargetConstant: "geoTargetConstants/100",
    });
    expect(
      p.checks.some((x) => x.query.includes("geo_target_constant.id = 100")),
    ).toBe(true);
    expect(p.items[0]!.warnings.join(" ")).toContain(
      "GeoTargetConstantService",
    );
    f.s.geo.status = "REMOVAL_PLANNED";
    expect(canonical(await rereadExtendedChecks(p, f.read))).not.toBe(
      canonical(p.checks),
    );
  });
  it("Geo suggestions ambiguity, mismatch, inventory overflow and injection reject safely", async () => {
    const f = mock(),
      row = {
        ...campaign,
        operation: "geo_add",
        name: "district",
        country_code: "KZ",
      };
    await rejects(
      buildStage3Plan(account, intent(row), f.read, async () => [
        { geoTargetConstant: f.s.geo },
        {
          geoTargetConstant: {
            ...f.s.geo,
            id: "101",
            resourceName: "geoTargetConstants/101",
          },
        },
      ]),
      "google_stage3_geo_ambiguous",
    );
    await rejects(
      buildStage3Plan(account, intent(row), f.read, async () =>
        Array.from({ length: 101 }, () => ({ geoTargetConstant: f.s.geo })),
      ),
      "google_stage3_geo_limit",
    );
    await rejects(
      buildStage3Plan(account, intent(row), f.read, async () => [
        {
          geoTargetConstant: {
            ...f.s.geo,
            id: "101",
            resourceName: "geoTargetConstants/101",
          },
        },
      ]),
      "google_stage3_geo_invalid",
    );
    await rejects(
      buildStage3Plan(account, intent(row), f.read, async () => [
        {
          geoTargetConstant: {
            ...f.s.geo,
            id: "1 OR 1=1",
            resourceName: "geoTargetConstants/100",
          },
        },
      ]),
      "google_extended_id_invalid",
    );
  });
  it("Typed schemas expose required demographic/schedule fields and detailed catalog; arbitrary provider objects stay forbidden", () => {
    const schema = stage3ToolSchema("google_ads_targeting_preview")!,
      rows = extRow(extRow(extRow(schema.properties).items).items)
        .oneOf as ExtendedRow[];
    expect(
      rows.some(
        (r) =>
          extRow(extRow(r.properties).operation).const ===
          "demographic_bid_modifier",
      ),
    ).toBe(true);
    expect(
      rows.some(
        (r) =>
          extRow(extRow(r.properties).operation).const ===
          "schedule_bid_modifier",
      ),
    ).toBe(true);
    expect(
      stage3ToolIntent("google_ads_targeting_preview", {
        provider: "GOOGLE_ADS",
        account_id: account,
        items: [
          {
            ...group,
            operation: "demographic_bid_modifier",
            criterion_id: "7",
            dimension: "GENDER",
            bid_modifier: 1.2,
          },
        ],
      }),
    ).toMatchObject({ action: "targeting" });
    expect(
      stage3ToolIntent("google_ads_audience_search", {
        provider: "GOOGLE_ADS",
        account_id: account,
        name: "education",
        kind: "DETAILED_DEMOGRAPHIC",
      }),
    ).toMatchObject({ action: "audience_search" });
    expect(() =>
      parseStage3Intent(
        intent({
          ...group,
          operation: "demographic_bid_modifier",
          criterion_id: "7",
          dimension: "GENDER",
          bid_modifier: 1.2,
          fields: { status: "ENABLED" },
        }),
      ),
    ).toThrow();
  });
});

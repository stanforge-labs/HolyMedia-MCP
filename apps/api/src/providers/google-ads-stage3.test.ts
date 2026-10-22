import { describe, expect, it, vi } from "vitest";
import { canonical } from "./google-ads-stage1.js";
import { GoogleAdsWriteError } from "./google-ads-write.js";
import {
  assertExtendedPlan,
  extRow,
  rereadExtendedChecks,
  verifyExtendedMutation,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";
import {
  buildStage3Plan,
  parseStage3Intent,
  searchStage3Audiences,
} from "./google-ads-stage3.js";
import {
  GOOGLE_STAGE3_TOOLS,
  stage3ToolIntent,
  stage3ToolSchema,
} from "../mcp/mcp-google-stage3-schema.js";

const account = "8590146099",
  prefix = `customers/${account}`,
  campaignResource = `${prefix}/campaigns/1`,
  groupResource = `${prefix}/adGroups/2`;
function fixture() {
  const state = {
    customer: {
      resourceName: prefix,
      id: account,
      currencyCode: "USD",
      timeZone: "Asia/Almaty",
    },
    campaign: {
      resourceName: campaignResource,
      id: "1",
      name: "isolated",
      status: "PAUSED",
      advertisingChannelType: "SEARCH",
      biddingStrategyType: "MANUAL_CPC",
      biddingStrategy: "",
      targetingSetting: {},
      geoTargetTypeSetting: {
        positiveGeoTargetType: "PRESENCE",
        negativeGeoTargetType: "PRESENCE",
      },
    } as ExtendedRow,
    group: {
      resourceName: groupResource,
      id: "2",
      name: "group",
      campaign: campaignResource,
      status: "PAUSED",
      targetingSetting: {
        targetRestrictions: [
          { targetingDimension: "AGE_RANGE", bidOnly: false },
        ],
      },
    } as ExtendedRow,
    criteria: [] as ExtendedRow[],
    groupCriteria: [] as ExtendedRow[],
    audience: {
      resourceName: `${prefix}/userLists/3`,
      id: "3",
      name: "test remarketing",
      membershipStatus: "OPEN",
      accountUserListStatus: "ENABLED",
      eligibleForSearch: true,
      eligibleForDisplay: true,
    } as ExtendedRow,
    interest: {
      resourceName: `${prefix}/userInterests/4`,
      userInterestId: "4",
      name: "test interest",
      taxonomyType: "IN_MARKET",
      launchedToAll: true,
    } as ExtendedRow,
    detailed: {
      resourceName: `${prefix}/detailedDemographics/6`,
      id: "6",
      name: "synthetic education catalog entry",
      launchedToAll: true,
    } as ExtendedRow,
    custom: {
      resourceName: `${prefix}/customAudiences/5`,
      id: "5",
      name: "custom test",
      status: "ENABLED",
      type: "AUTO",
      description: "safe description",
      members: [{ memberType: "KEYWORD", keyword: "marketing training" }],
    } as ExtendedRow,
    customExists: false,
    geoAmbiguous: false,
  };
  const read = vi.fn(async (q: string): Promise<ExtendedRow[]> => {
    if (q.includes(" FROM customer"))
      return [{ customer: structuredClone(state.customer) }];
    if (q.includes(" FROM campaign "))
      return [{ campaign: structuredClone(state.campaign) }];
    if (q.includes(" FROM ad_group "))
      return [{ adGroup: structuredClone(state.group) }];
    if (q.includes(" FROM campaign_criterion "))
      return state.criteria
        .filter((r) => !q.includes(".type IN (") || q.includes(`'${r.type}'`))
        .map((r) => ({ campaignCriterion: structuredClone(r) }));
    if (q.includes(" FROM ad_group_criterion "))
      return state.groupCriteria
        .filter((r) => !q.includes(".type IN (") || q.includes(`'${r.type}'`))
        .map((r) => ({ adGroupCriterion: structuredClone(r) }));
    if (q.includes(" FROM user_list "))
      return [{ userList: structuredClone(state.audience) }];
    if (q.includes(" FROM user_interest "))
      return [{ userInterest: structuredClone(state.interest) }];
    if (q.includes(" FROM detailed_demographic "))
      return [{ detailedDemographic: structuredClone(state.detailed) }];
    if (q.includes(" FROM custom_audience "))
      return state.customExists
        ? [{ customAudience: structuredClone(state.custom) }]
        : [];
    if (q.includes(" FROM geo_target_constant ")) {
      const geo = {
        resourceName: "geoTargetConstants/100",
        id: "100",
        name: "Almaty",
        canonicalName: "Almaty,Kazakhstan",
        countryCode: "KZ",
        targetType: "City",
        status: "ENABLED",
      };
      return state.geoAmbiguous
        ? [
            { geoTargetConstant: geo },
            {
              geoTargetConstant: {
                ...geo,
                id: "101",
                resourceName: "geoTargetConstants/101",
              },
            },
          ]
        : [{ geoTargetConstant: geo }];
    }
    if (q.includes(" FROM language_constant "))
      return q.includes("'ru'")
        ? [
            {
              languageConstant: {
                resourceName: "languageConstants/1031",
                id: "1031",
                name: "Russian",
                code: "ru",
                targetable: true,
              },
            },
          ]
        : [];
    throw new Error(`Unmocked GAQL: ${q}`);
  });
  return { state, read };
}
const intent = (...items: ExtendedRow[]) => ({ action: "targeting", items });
const base = { level: "CAMPAIGN", campaign_id: "1" };
const group = { level: "AD_GROUP", campaign_id: "1", ad_group_id: "2" };
const audienceAdd = {
  ...group,
  operation: "audience_add",
  audience: { kind: "USER_LIST", id: "3" },
  mode: "OBSERVATION",
};
const geo = {
  ...base,
  operation: "geo_add",
  name: "Алматы",
  country_code: "KZ",
};
async function errorCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ writeCode: code });
}
function criterion(type: string, extra: ExtendedRow = {}, isGroup = false) {
  return {
    resourceName: `${prefix}/${isGroup ? "adGroupCriteria/2" : "campaignCriteria/1"}~7`,
    criterionId: "7",
    [isGroup ? "adGroup" : "campaign"]: isGroup
      ? groupResource
      : campaignResource,
    type,
    status: "ENABLED",
    negative: false,
    bidModifier: 1,
    ...extra,
  };
}

describe("Stage 3 typed audiences and targeting (provider transport is mocked)", () => {
  it("Acceptance I: audience OBSERVATION adds criterion plus explicit mode while preserving unrelated restriction", async () => {
    const f = fixture(),
      p = await buildStage3Plan(account, intent(audienceAdd), f.read);
    expect(p.version).toBe(3);
    expect(p.operations).toHaveLength(2);
    expect(p.operations[0]).toMatchObject({
      kind: "adGroups",
      method: "update",
      update_mask: "targeting_setting.target_restriction_operations",
      fields: {
        targetingSetting: {
          targetRestrictionOperations: [
            {
              operator: "ADD",
              value: { targetingDimension: "AUDIENCE", bidOnly: true },
            },
          ],
        },
      },
    });
    expect(
      extRow(p.operations[0]!.expected.targetingSetting).targetRestrictions,
    ).toEqual([
      { targetingDimension: "AGE_RANGE", bidOnly: false },
      { targetingDimension: "AUDIENCE", bidOnly: true },
    ]);
    expect(p.operations[1]).toMatchObject({
      kind: "adGroupCriteria",
      method: "create",
      fields: {
        adGroup: groupResource,
        userList: { userList: `${prefix}/userLists/3` },
        negative: false,
      },
    });
    expect(p.items[0]!.after).toMatchObject({ audience_mode: "OBSERVATION" });
    expect(p.items[0]!.warnings.join(" ")).toContain("OBSERVATION");
    expect(f.state.group.status).toBe("PAUSED");
    expect(p.atomic).toBe(true);
  });
  it("Acceptance I remove is exact criterion-only, warns about mode and irreversible new identity", async () => {
    const f = fixture();
    f.state.groupCriteria.push(
      criterion(
        "USER_LIST",
        { userList: { userList: `${prefix}/userLists/3` } },
        true,
      ),
    );
    const p = await buildStage3Plan(
      account,
      intent({
        ...group,
        operation: "audience_remove",
        criterion_id: "7",
        acknowledge_irreversible: true,
      }),
      f.read,
    );
    expect(p.operations[0]).toMatchObject({
      kind: "adGroupCriteria",
      method: "remove",
      resource_name: `${prefix}/adGroupCriteria/2~7`,
    });
    expect(p.irreversible).toBe(true);
    expect(p.inverse_intent).toBeUndefined();
    expect(p.items[0]!.warnings.join(" ")).toContain("mode");
  });
  it("Audience TARGETING explicitly narrows traffic and campaign impact freezes all children", async () => {
    const f = fixture();
    f.state.group.targetingSetting = {};
    const p = await buildStage3Plan(
      account,
      intent({
        ...base,
        operation: "audience_add",
        audience: { kind: "USER_LIST", id: "3" },
        mode: "TARGETING",
      }),
      f.read,
    );
    expect(p.operations[0]!.fields.targetingSetting).toEqual({
      targetRestrictionOperations: [
        {
          operator: "ADD",
          value: { targetingDimension: "AUDIENCE", bidOnly: false },
        },
      ],
    });
    expect(p.checks.some((c) => c.query.includes("ad_group.campaign ="))).toBe(
      true,
    );
    expect(p.items[0]!.warnings.join(" ")).toContain("ограничивает");
  });
  it("Audience exclusion emits negative:true without removing positive criteria", async () => {
    const f = fixture(),
      p = await buildStage3Plan(
        account,
        intent({ ...audienceAdd, operation: "audience_exclude" }),
        f.read,
      );
    expect(p.operations.at(-1)!.fields.negative).toBe(true);
    expect(p.irreversible).toBe(false);
  });
  it("Mode inverse is exact only when an explicit prior restriction exists", async () => {
    const f = fixture();
    const createdMode = await buildStage3Plan(
      account,
      intent({ ...group, operation: "audience_mode", mode: "OBSERVATION" }),
      f.read,
    );
    expect(createdMode.inverse_intent).toBeUndefined();
    f.state.group.targetingSetting = {
      targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: false }],
    };
    const updatedMode = await buildStage3Plan(
      account,
      intent({ ...group, operation: "audience_mode", mode: "OBSERVATION" }),
      f.read,
    );
    expect(updatedMode.inverse_intent!.items).toEqual([
      { ...group, operation: "audience_mode", mode: "TARGETING" },
    ]);
  });
  it("Optional bidOnly omission means TARGETING, preserves sibling bytes and provides no fabricated inverse", async () => {
    const f = fixture();
    f.state.group.targetingSetting = {
      targetRestrictions: [
        { targetingDimension: "AGE_RANGE" },
        { targetingDimension: "AUDIENCE" },
      ],
    };
    const p = await buildStage3Plan(
      account,
      intent({ ...group, operation: "audience_mode", mode: "OBSERVATION" }),
      f.read,
    );
    expect(p.inverse_intent).toBeUndefined();
    expect(
      extRow(p.operations[0]!.expected.targetingSetting).targetRestrictions,
    ).toEqual([
      { targetingDimension: "AGE_RANGE" },
      { targetingDimension: "AUDIENCE", bidOnly: true },
    ]);
    const g = fixture();
    g.state.group.targetingSetting = {
      targetRestrictions: [{ targetingDimension: "AUDIENCE" }],
    };
    const unchanged = await buildStage3Plan(
      account,
      intent({ ...audienceAdd, mode: "TARGETING" }),
      g.read,
    );
    expect(unchanged.operations).toHaveLength(1);
    expect(unchanged.operations[0]!.kind).toBe("adGroupCriteria");
    const bad = fixture();
    bad.state.group.targetingSetting = {
      targetRestrictions: [
        { targetingDimension: "AUDIENCE", bidOnly: "false" },
      ],
    };
    await errorCode(
      buildStage3Plan(
        account,
        intent({ ...group, operation: "audience_mode", mode: "OBSERVATION" }),
        bad.read,
      ),
      "google_stage3_mode_invalid",
    );
  });
  it("Incremental ADD replaces only AUDIENCE dimension, preserving multiple siblings and verifying merged provider state", async () => {
    const f = fixture(),
      siblings = [
        { targetingDimension: "AGE_RANGE", bidOnly: false },
        { targetingDimension: "GENDER", bidOnly: true },
      ];
    f.state.group.targetingSetting = {
      targetRestrictions: [
        ...siblings,
        { targetingDimension: "AUDIENCE", bidOnly: false },
      ],
    };
    const p = await buildStage3Plan(
        account,
        intent({ ...group, operation: "audience_mode", mode: "OBSERVATION" }),
        f.read,
      ),
      op = p.operations[0]!;
    expect(op.fields.targetingSetting).toEqual({
      targetRestrictionOperations: [
        {
          operator: "ADD",
          value: { targetingDimension: "AUDIENCE", bidOnly: true },
        },
      ],
    });
    expect(op.fields.targetingSetting).not.toHaveProperty("targetRestrictions");
    const add = extRow(
      (
        extRow(op.fields.targetingSetting)
          .targetRestrictionOperations as unknown[]
      )[0],
    );
    expect(add.operator).toBe("ADD");
    f.state.group.targetingSetting = {
      targetRestrictions: [...siblings, add.value],
    };
    expect(extRow(f.state.group.targetingSetting).targetRestrictions).toEqual([
      ...siblings,
      { targetingDimension: "AUDIENCE", bidOnly: true },
    ]);
    expect(
      (
        await verifyExtendedMutation(
          p,
          [{ success: true, resource_name: groupResource, error: null }],
          f.read,
        )
      ).status,
    ).toBe("VERIFIED");
  });
  it.each(["IN_MARKET", "AFFINITY"])(
    "Resolves %s audience with exact taxonomy",
    async (kind) => {
      const f = fixture();
      f.state.interest.taxonomyType = kind;
      const p = await buildStage3Plan(
        account,
        intent({ ...audienceAdd, audience: { kind, name: "test interest" } }),
        f.read,
      );
      expect(p.operations.at(-1)!.fields.userInterest).toEqual({
        userInterestCategory: `${prefix}/userInterests/4`,
      });
    },
  );
  it("Audience manual bid modifier updates only one field and emits inverse", async () => {
    const f = fixture();
    f.state.group.targetingSetting = {
      targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: true }],
    };
    f.state.groupCriteria.push(
      criterion(
        "USER_LIST",
        { userList: { userList: `${prefix}/userLists/3` } },
        true,
      ),
    );
    const p = await buildStage3Plan(
      account,
      intent({
        ...group,
        operation: "audience_bid_modifier",
        criterion_id: "7",
        bid_modifier: 1.25,
      }),
      f.read,
    );
    expect(p.operations[0]!.fields).toEqual({
      resourceName: `${prefix}/adGroupCriteria/2~7`,
      bidModifier: 1.25,
    });
    expect(p.operations[0]!.update_mask).toBe("bid_modifier");
    expect(p.inverse_intent!.items).toEqual([
      {
        ...group,
        operation: "audience_bid_modifier",
        criterion_id: "7",
        bid_modifier: 1,
      },
    ]);
  });
  it("Acceptance J resolves Алматы, excluded city and radius independently without clearing collection", async () => {
    const f = fixture(),
      p = await buildStage3Plan(
        account,
        intent(
          geo,
          {
            ...geo,
            operation: "geo_exclude",
            name: "other city",
            geo_target_id: "101",
          },
          {
            ...base,
            operation: "radius_add",
            latitude: 43.25,
            longitude: 76.95,
            radius: 10,
            unit: "KILOMETERS",
          },
        ),
        async (q) =>
          q.includes("geo_target_constant.id = 101")
            ? [
                {
                  geoTargetConstant: {
                    resourceName: "geoTargetConstants/101",
                    id: "101",
                    canonicalName: "other city,Kazakhstan",
                    countryCode: "KZ",
                    status: "ENABLED",
                    targetType: "City",
                  },
                },
              ]
            : f.read(q),
      );
    expect(p.operations).toHaveLength(3);
    expect(p.operations[0]!.fields.location).toEqual({
      geoTargetConstant: "geoTargetConstants/100",
    });
    expect(p.operations[1]!.fields.negative).toBe(true);
    expect(p.operations[2]!.fields.proximity).toEqual({
      geoPoint: {
        latitudeInMicroDegrees: 43250000,
        longitudeInMicroDegrees: 76950000,
      },
      radius: 10,
      radiusUnits: "KILOMETERS",
    });
    expect(p.items[0]!.warnings.join(" ")).toContain("PRESENCE");
  });
  it("Presence mode updates exact nested field and preserves negative geo mode", async () => {
    const f = fixture(),
      p = await buildStage3Plan(
        account,
        intent({
          ...base,
          operation: "presence",
          positive: "PRESENCE_OR_INTEREST",
        }),
        f.read,
      );
    expect(p.operations[0]!.update_mask).toBe(
      "geo_target_type_setting.positive_geo_target_type",
    );
    expect(
      extRow(p.operations[0]!.expected.geoTargetTypeSetting)
        .negativeGeoTargetType,
    ).toBe("PRESENCE");
    expect(p.inverse_intent!.items).toEqual([
      { ...base, operation: "presence", positive: "PRESENCE" },
    ]);
  });
  it.each(["Russian", "русский", "ru"])(
    "Language %s resolves real constant",
    async (name) => {
      const f = fixture(),
        p = await buildStage3Plan(
          account,
          intent({ ...base, operation: "language_add", name }),
          f.read,
        );
      expect(p.operations[0]!.fields.language).toEqual({
        languageConstant: "languageConstants/1031",
      });
    },
  );
  it("Schedules use account timezone, one operation per day and quarter-hour enums", async () => {
    const f = fixture(),
      p = await buildStage3Plan(
        account,
        intent({
          ...base,
          operation: "schedule_add",
          days: ["MONDAY", "TUESDAY"],
          start: "09:15",
          end: "24:00",
        }),
        f.read,
      );
    expect(p.operations).toHaveLength(2);
    expect(p.operations[0]!.fields.adSchedule).toMatchObject({
      startHour: 9,
      startMinute: "FIFTEEN",
      endHour: 24,
      endMinute: "ZERO",
    });
    expect(p.items[0]!.warnings.join(" ")).toContain("Asia/Almaty");
  });
  it.each(["AGE_RANGE", "GENDER", "PARENTAL_STATUS", "INCOME_RANGE"])(
    "Creates scoped negative %s demographic",
    async (dimension) => {
      const values: Record<string, string> = {
        AGE_RANGE: "AGE_RANGE_18_24",
        GENDER: "MALE",
        PARENTAL_STATUS: "PARENT",
        INCOME_RANGE: "INCOME_RANGE_0_50",
      };
      const f = fixture(),
        p = await buildStage3Plan(
          account,
          intent({
            ...group,
            operation: "demographic_exclude",
            dimension,
            value: values[dimension],
          }),
          f.read,
        );
      expect(p.operations[0]!.fields.negative).toBe(true);
      expect(p.operations[0]!.kind).toBe("adGroupCriteria");
    },
  );
  it("Device exclusion is existing criterion bidModifier=0 only, reversible", async () => {
    const f = fixture();
    f.state.criteria.push(criterion("DEVICE", { device: { type: "MOBILE" } }));
    const p = await buildStage3Plan(
      account,
      intent({
        ...base,
        operation: "device_modifier",
        device: "MOBILE",
        bid_modifier: 0,
      }),
      f.read,
    );
    expect(p.operations[0]!.update_mask).toBe("bid_modifier");
    expect(p.operations[0]!.fields.bidModifier).toBe(0);
    expect(p.inverse_intent!.items).toEqual([
      {
        ...base,
        operation: "device_modifier",
        device: "MOBILE",
        bid_modifier: 1,
      },
    ]);
  });
  it("Custom audience creation is standalone AUTO definition with no output-only status", async () => {
    const f = fixture(),
      p = await buildStage3Plan(
        account,
        intent({
          operation: "custom_audience_create",
          name: "new definition",
          privacy_ack: true,
          members: [
            { type: "KEYWORD", value: "generic marketing" },
            { type: "URL", value: "https://example.com/marketing" },
            { type: "APP", value: "com.example.app" },
          ],
        }),
        f.read,
      );
    expect(p.operations[0]).toMatchObject({
      kind: "customAudiences",
      method: "create",
      resource_name: null,
      fields: { type: "AUTO", name: "new definition" },
    });
    expect(p.operations[0]!.fields).not.toHaveProperty("status");
    expect(p.operations[0]!.fields).not.toHaveProperty("resourceName");
    expect(p.atomic).toBe(true);
    expect(p.inverse_intent).toBeUndefined();
  });
  it("Custom update acknowledges member replacement; frozen before and inverse contains original definition", async () => {
    const f = fixture();
    f.state.customExists = true;
    const p = await buildStage3Plan(
      account,
      intent({
        operation: "custom_audience_update",
        custom_audience_id: "5",
        privacy_ack: true,
        acknowledge_replace_members: true,
        members: [{ type: "KEYWORD", value: "new context" }],
      }),
      f.read,
    );
    expect(p.operations[0]!.update_mask).toBe("members");
    expect(p.operations[0]!.before).toMatchObject({ name: "custom test" });
    expect(p.inverse_intent!.items).toEqual([
      {
        operation: "custom_audience_update",
        custom_audience_id: "5",
        privacy_ack: true,
        acknowledge_replace_members: true,
        members: [{ type: "KEYWORD", value: "marketing training" }],
      },
    ]);
  });
  it("Audience search by name is read-only, bounded and returns only verified-owned references", async () => {
    const f = fixture(),
      result = await searchStage3Audiences(
        account,
        { name: "test", kind: "USER_LIST" },
        f.read,
      );
    expect(result.matches).toHaveLength(1);
    expect(result.truncated).toBe(false);
    expect(f.read.mock.calls.at(-1)![0]).toContain("LIKE '%test%'");
  });
  it("Actual provider reread verifies intended device field without weakening other fields", async () => {
    const f = fixture();
    f.state.criteria.push(criterion("DEVICE", { device: { type: "MOBILE" } }));
    const p = await buildStage3Plan(
      account,
      intent({
        ...base,
        operation: "device_modifier",
        device: "MOBILE",
        bid_modifier: 0,
      }),
      f.read,
    );
    f.state.criteria[0]!.bidModifier = 0;
    const results = [
      {
        success: true,
        resource_name: String(f.state.criteria[0]!.resourceName),
        error: null,
      },
    ];
    const verified = await verifyExtendedMutation(p, results, f.read);
    expect(verified.status).toBe("VERIFIED");
    f.state.criteria[0]!.device = { type: "DESKTOP" };
    expect((await verifyExtendedMutation(p, results, f.read)).status).toBe(
      "NOT_VERIFIED",
    );
  });
  it("Stale snapshot includes parent strategy, geo mode, full restrictions and changed device", async () => {
    const f = fixture();
    f.state.criteria.push(criterion("DEVICE", { device: { type: "MOBILE" } }));
    const p = await buildStage3Plan(
      account,
      intent({
        ...base,
        operation: "device_modifier",
        device: "MOBILE",
        bid_modifier: 1.2,
      }),
      f.read,
    );
    f.state.campaign.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    expect(canonical(await rereadExtendedChecks(p, f.read))).not.toBe(
      canonical(p.checks),
    );
  });
});

describe("Stage 3 negative / security / capability rejection", () => {
  it("Negative CUSTOM_AUDIENCE is unsupported in v24: rejected by parser/schema before provider read", async () => {
    const f = fixture();
    await errorCode(
      buildStage3Plan(
        account,
        intent({
          ...audienceAdd,
          operation: "audience_exclude",
          audience: { kind: "CUSTOM", id: "5" },
        }),
        f.read,
      ),
      "google_stage3_unsupported",
    );
    expect(f.read).not.toHaveBeenCalled();
    const schema = stage3ToolSchema("google_ads_targeting_preview")!,
      rows = extRow(extRow(extRow(schema.properties).items).items)
        .oneOf as ExtendedRow[];
    const negative = rows.find(
      (r) =>
        extRow(extRow(r.properties).operation).const === "audience_exclude",
    )!;
    expect(
      extRow(extRow(extRow(negative.properties).audience).properties).kind,
    ).toEqual({
      enum: ["USER_LIST", "IN_MARKET", "AFFINITY", "DETAILED_DEMOGRAPHIC"],
    });
  });
  it("Campaign PARENTAL_STATUS positive is unsupported; campaign exclusion and group positive remain available", async () => {
    const f = fixture();
    await errorCode(
      buildStage3Plan(
        account,
        intent({
          ...base,
          operation: "demographic_add",
          dimension: "PARENTAL_STATUS",
          value: "PARENT",
        }),
        f.read,
      ),
      "google_stage3_unsupported",
    );
    expect(f.read).not.toHaveBeenCalled();
    expect(
      (
        await buildStage3Plan(
          account,
          intent({
            ...base,
            operation: "demographic_exclude",
            dimension: "PARENTAL_STATUS",
            value: "PARENT",
          }),
          f.read,
        )
      ).operations[0]!.fields.negative,
    ).toBe(true);
    expect(
      (
        await buildStage3Plan(
          account,
          intent({
            ...group,
            operation: "demographic_add",
            dimension: "PARENTAL_STATUS",
            value: "PARENT",
          }),
          f.read,
        )
      ).operations[0]!.fields.negative,
    ).toBe(false);
    const schema = stage3ToolSchema("google_ads_targeting_preview")!,
      rows = extRow(extRow(extRow(schema.properties).items).items)
        .oneOf as ExtendedRow[];
    const positive = rows.find(
      (r) => extRow(extRow(r.properties).operation).const === "demographic_add",
    )!;
    expect(positive.allOf).toContainEqual({
      not: {
        properties: {
          level: { const: "CAMPAIGN" },
          dimension: { const: "PARENTAL_STATUS" },
        },
        required: ["level", "dimension"],
      },
    });
  });
  it.each([
    [{ ...audienceAdd, mode: "DEFAULT" }, "google_stage3_input_invalid"],
    [
      {
        ...base,
        operation: "device_modifier",
        device: "MOBILE",
        bid_modifier: 11,
      },
      "google_stage3_modifier_invalid",
    ],
    [
      {
        ...base,
        operation: "radius_add",
        latitude: 91,
        longitude: 10,
        radius: 10,
        unit: "KILOMETERS",
      },
      "google_stage3_geo_invalid",
    ],
    [
      {
        ...base,
        operation: "schedule_add",
        days: ["MONDAY"],
        start: "09:01",
        end: "12:00",
      },
      "google_stage3_schedule_invalid",
    ],
    [
      {
        ...base,
        operation: "schedule_add",
        days: ["MONDAY"],
        start: "23:00",
        end: "01:00",
      },
      "google_stage3_schedule_invalid",
    ],
    [
      {
        ...base,
        operation: "criterion_remove",
        criterion_id: "7",
        criterion_type: "LOCATION",
      },
      "google_extended_input_invalid",
    ],
    [
      {
        ...base,
        operation: "criterion_remove",
        criterion_id: "7",
        criterion_type: "LOCATION",
        acknowledge_irreversible: false,
      },
      "google_stage3_removal_requires_ack",
    ],
    [
      { ...group, operation: "geo_add", name: "city" },
      "google_stage3_unsupported",
    ],
    [
      { ...base, operation: "raw_mutate", fields: { status: "ENABLED" } },
      "google_stage3_unsupported",
    ],
    [
      { ...audienceAdd, fields: { resourceName: "evil" } },
      "google_extended_input_invalid",
    ],
    [
      {
        ...audienceAdd,
        audience: { kind: "USER_LIST", id: `${prefix}/userLists/3` },
      },
      "google_extended_id_invalid",
    ],
    [
      {
        ...base,
        operation: "demographic_add",
        dimension: "AGE_RANGE",
        value: "MALE",
      },
      "google_stage3_input_invalid",
    ],
    [
      {
        operation: "custom_audience_create",
        name: "PII",
        privacy_ack: true,
        members: [{ type: "KEYWORD", value: "user@example.com" }],
      },
      "google_stage3_custom_invalid",
    ],
    [
      {
        operation: "custom_audience_create",
        name: "local",
        privacy_ack: true,
        members: [{ type: "URL", value: "https://127.0.0.1/file" }],
      },
      "google_stage3_custom_invalid",
    ],
    [
      {
        operation: "custom_audience_update",
        custom_audience_id: "5",
        privacy_ack: true,
        members: [{ type: "KEYWORD", value: "context" }],
      },
      "google_stage3_custom_replace_requires_ack",
    ],
  ])(
    "Runtime rejects invalid row %# before any provider request",
    async (row, code) => {
      const f = fixture();
      await errorCode(buildStage3Plan(account, intent(row), f.read), code);
      expect(f.read).not.toHaveBeenCalled();
    },
  );
  it("No arbitrary top-level fields and no raw micro status payload", () => {
    expect(() =>
      parseStage3Intent({ ...intent(geo), partialFailure: false }),
    ).toThrow(GoogleAdsWriteError);
    expect(() =>
      stage3ToolIntent("google_ads_targeting_preview", {
        provider: "GOOGLE_ADS",
        account_id: account,
        items: [geo],
        approved: true,
      }),
    ).toThrow(GoogleAdsWriteError);
  });
  it("Duplicate batch rows reject before account read", async () => {
    const f = fixture();
    await errorCode(
      buildStage3Plan(account, intent(geo, geo), f.read),
      "google_stage3_duplicate",
    );
    expect(f.read).not.toHaveBeenCalled();
  });
  it("Operations above 500 are not truncated", async () => {
    const f = fixture();
    await errorCode(
      buildStage3Plan(
        account,
        intent(
          ...Array.from({ length: 501 }, (_, i) => ({
            ...geo,
            name: `city ${i}`,
          })),
        ),
        f.read,
      ),
      "google_stage3_input_invalid",
    );
    expect(f.read).not.toHaveBeenCalled();
  });
  it("Underlying schedules >500 reject even with <=500 input rows", async () => {
    const f = fixture();
    // Unique campaigns keep daily schedule caps independent. Mock each requested parent exactly.
    const read = async (q: string) =>
      q.includes(" FROM campaign ")
        ? [
            {
              campaign: {
                ...f.state.campaign,
                resourceName: `${prefix}/campaigns/${q.match(/campaign.id = ([0-9]+)/)![1]}`,
              },
            },
          ]
        : q.includes(" FROM campaign_criterion ")
          ? []
          : f.read(q);
    const rows = Array.from({ length: 72 }, (_, i) => ({
      ...base,
      campaign_id: String(i + 1),
      operation: "schedule_add",
      days: [
        "MONDAY",
        "TUESDAY",
        "WEDNESDAY",
        "THURSDAY",
        "FRIDAY",
        "SATURDAY",
        "SUNDAY",
      ],
      start: "09:00",
      end: "10:00",
    }));
    await errorCode(
      buildStage3Plan(account, intent(...rows), read),
      "google_operation_limit",
    );
  });
  it("Foreign account proof is fatal, never per-row bypass", async () => {
    const f = fixture();
    f.state.customer.id = "0000000000";
    await errorCode(
      buildStage3Plan(account, intent(geo), f.read),
      "google_extended_ownership_invalid",
    );
  });
  it("Foreign campaign/group/reference and inventory proof rejected", async () => {
    const f = fixture();
    f.state.group.campaign = `customers/0000000000/campaigns/1`;
    await errorCode(
      buildStage3Plan(account, intent(audienceAdd), f.read),
      "google_extended_ownership_invalid",
    );
    const g = fixture();
    g.state.audience.resourceName = `customers/0000000000/userLists/3`;
    await errorCode(
      buildStage3Plan(account, intent(audienceAdd), g.read),
      "google_extended_ownership_invalid",
    );
    const h = fixture();
    h.state.criteria.push({
      ...criterion("LOCATION", {
        location: { geoTargetConstant: "geoTargetConstants/100" },
      }),
      campaign: `${prefix}/campaigns/99`,
    });
    await errorCode(
      buildStage3Plan(account, intent(geo), h.read),
      "google_extended_ownership_invalid",
    );
  });
  it("Unbounded inventory is not silently truncated", async () => {
    const f = fixture();
    await errorCode(
      buildStage3Plan(account, intent(geo), async (q) =>
        q.includes("geo_target_constant")
          ? Array.from({ length: 5001 }, () => ({ geoTargetConstant: {} }))
          : f.read(q),
      ),
      "google_inventory_limit",
    );
  });
  it("Geo ambiguity, invalid language and missing audience explicit", async () => {
    const f = fixture();
    f.state.geoAmbiguous = true;
    await errorCode(
      buildStage3Plan(account, intent(geo), f.read),
      "google_stage3_geo_ambiguous",
    );
    await errorCode(
      buildStage3Plan(
        account,
        intent({ ...base, operation: "language_add", name: "xx" }),
        fixture().read,
      ),
      "google_stage3_language_invalid",
    );
    const g = fixture();
    await errorCode(
      buildStage3Plan(account, intent(audienceAdd), async (q) =>
        q.includes(" FROM user_list ") ? [] : g.read(q),
      ),
      "google_stage3_audience_ambiguous",
    );
  });
  it("Resolved aliases and include/exclude contradictions reject before provider validation", async () => {
    const f = fixture();
    await errorCode(
      buildStage3Plan(
        account,
        intent(geo, { ...geo, operation: "geo_exclude", name: "Almaty" }),
        f.read,
      ),
      "google_stage3_duplicate",
    );
    const g = fixture();
    await errorCode(
      buildStage3Plan(
        account,
        intent(audienceAdd, {
          ...audienceAdd,
          audience: { kind: "USER_LIST", name: "test remarketing" },
        }),
        g.read,
      ),
      "google_stage3_duplicate",
    );
  });
  it("Custom + campaign criteria mixed service rejects before any reads", async () => {
    const f = fixture();
    await errorCode(
      buildStage3Plan(
        account,
        intent(geo, {
          operation: "custom_audience_create",
          name: "test",
          privacy_ack: true,
          members: [{ type: "KEYWORD", value: "context" }],
        }),
        f.read,
      ),
      "google_stage3_custom_service_mixed",
    );
    expect(f.read).not.toHaveBeenCalled();
  });
  it("Missing eligibility and custom audience Search not guessed", async () => {
    const f = fixture();
    f.state.audience.eligibleForSearch = false;
    await errorCode(
      buildStage3Plan(account, intent(audienceAdd), f.read),
      "google_stage3_audience_ineligible",
    );
    const g = fixture();
    g.state.customExists = true;
    await errorCode(
      buildStage3Plan(
        account,
        intent({ ...audienceAdd, audience: { kind: "CUSTOM", id: "5" } }),
        g.read,
      ),
      "google_stage3_audience_ineligible",
    );
  });
  it("Competing campaign/adgroup restrictions rejected, no broad overwrite", async () => {
    const f = fixture();
    f.state.campaign.targetingSetting = {
      targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: true }],
    };
    await errorCode(
      buildStage3Plan(account, intent(audienceAdd), f.read),
      "google_stage3_mode_parent_conflict",
    );
    const g = fixture();
    await errorCode(
      buildStage3Plan(
        account,
        intent({ ...base, operation: "audience_mode", mode: "OBSERVATION" }),
        g.read,
      ),
      "google_stage3_mode_child_conflict",
    );
  });
  it("Planned mode conflicts and provider duplicates rejected", async () => {
    const f = fixture();
    await errorCode(
      buildStage3Plan(
        account,
        intent(audienceAdd, {
          ...audienceAdd,
          operation: "audience_mode",
          mode: "TARGETING",
          audience: undefined,
        }),
        f.read,
      ),
      "google_extended_input_invalid",
    );
    const g = fixture();
    g.state.criteria.push(
      criterion("LOCATION", {
        location: { geoTargetConstant: "geoTargetConstants/100" },
      }),
    );
    await errorCode(
      buildStage3Plan(account, intent(geo), g.read),
      "google_stage3_duplicate",
    );
    const h = fixture();
    h.state.group.targetingSetting = {
      targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: true }],
    };
    await errorCode(
      buildStage3Plan(
        account,
        intent(audienceAdd, {
          ...group,
          operation: "audience_mode",
          mode: "TARGETING",
        }),
        h.read,
      ),
      "google_stage3_mode_conflict",
    );
  });
  it("Existing and planned schedule overlaps and six/day cap reject", async () => {
    const f = fixture();
    f.state.criteria.push(
      criterion("AD_SCHEDULE", {
        adSchedule: {
          dayOfWeek: "MONDAY",
          startHour: 9,
          startMinute: "ZERO",
          endHour: 12,
          endMinute: "ZERO",
        },
      }),
    );
    await errorCode(
      buildStage3Plan(
        account,
        intent({
          ...base,
          operation: "schedule_add",
          days: ["MONDAY"],
          start: "11:45",
          end: "13:00",
        }),
        f.read,
      ),
      "google_stage3_schedule_overlap",
    );
    const g = fixture();
    await errorCode(
      buildStage3Plan(
        account,
        intent(
          {
            ...base,
            operation: "schedule_add",
            days: ["MONDAY"],
            start: "09:00",
            end: "12:00",
          },
          {
            ...base,
            operation: "schedule_add",
            days: ["MONDAY"],
            start: "11:00",
            end: "13:00",
          },
        ),
        g.read,
      ),
      "google_stage3_schedule_overlap",
    );
  });
  it("Automatic strategy modifier rejected explicitly, device opt-out remains allowed", async () => {
    const f = fixture();
    f.state.campaign.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
    f.state.criteria.push(criterion("DEVICE", { device: { type: "MOBILE" } }));
    await errorCode(
      buildStage3Plan(
        account,
        intent({
          ...base,
          operation: "device_modifier",
          device: "MOBILE",
          bid_modifier: 1.1,
        }),
        f.read,
      ),
      "google_stage3_strategy_incompatible",
    );
    expect(
      (
        await buildStage3Plan(
          account,
          intent({
            ...base,
            operation: "device_modifier",
            device: "MOBILE",
            bid_modifier: 0,
          }),
          f.read,
        )
      ).operations[0]!.fields.bidModifier,
    ).toBe(0);
  });
  it("Remove keyword through targeting tool cannot bypass keyword destructive protection", async () => {
    const f = fixture();
    f.state.groupCriteria.push(
      criterion(
        "KEYWORD",
        { keyword: { text: "unchanged", matchType: "EXACT" } },
        true,
      ),
    );
    await errorCode(
      buildStage3Plan(
        account,
        intent({
          ...group,
          operation: "audience_remove",
          criterion_id: "7",
          acknowledge_irreversible: true,
        }),
        f.read,
      ),
      "google_stage3_criterion_unavailable",
    );
  });
  it("All typed MCP object schemas closed, no arbitrary Google request objects", () => {
    function walk(v: unknown) {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        const r = extRow(v);
        if (r.type === "object") expect(r.additionalProperties).toBe(false);
        Object.values(r).forEach(walk);
      }
    }
    GOOGLE_STAGE3_TOOLS.forEach((n) => walk(stage3ToolSchema(n)));
    expect(stage3ToolSchema("unknown")).toBeUndefined();
    expect(stage3ToolIntent("unknown", {})).toBeNull();
    expect(
      stage3ToolIntent("google_ads_targeting_preview", {
        provider: "GOOGLE_ADS",
        account_id: account,
        items: [geo],
      }),
    ).toMatchObject({ action: "targeting" });
    expect(
      stage3ToolIntent("google_ads_audience_search", {
        provider: "GOOGLE_ADS",
        account_id: account,
        name: "test",
        kind: "USER_LIST",
      }),
    ).toMatchObject({ action: "audience_search" });
  });
  it("Shared immutable-plan guard rejects foreign plan after normalization", async () => {
    const f = fixture();
    f.state.criteria.push(criterion("DEVICE", { device: { type: "MOBILE" } }));
    const p = await buildStage3Plan(
      account,
      intent({
        ...base,
        operation: "device_modifier",
        device: "MOBILE",
        bid_modifier: 0,
      }),
      f.read,
    );
    p.operations[0]!.resource_name = `customers/0000000000/campaignCriteria/1~7`;
    expect(() => assertExtendedPlan(p, account)).toThrow(GoogleAdsWriteError);
  });
});

import { vi } from "vitest";
import sharp from "sharp";
import {
  replaceExtendedTemps,
  resolveExtendedResourceReference,
} from "../providers/google-ads-extended-plan.js";
import {
  fixture,
  object,
  prefix,
  customer,
  type MockRow,
} from "./google-write-test.fixture.js";

// Stock MCP/approval/audit services, HTTP mocked at the provider boundary only.
export function extendedFixture() {
  const f = fixture(false, { stage2: true, extended: true });
  const campaign = object(f.resources.get(`${prefix}/campaigns/1`)?.campaign);
  Object.assign(campaign, {
    advertisingChannelType: "SEARCH",
    biddingStrategyType: "MANUAL_CPC",
    manualCpc: { enhancedCpcEnabled: false },
    campaignBudget: `${prefix}/campaignBudgets/20`,
    geoTargetTypeSetting: {
      positiveGeoTargetType: "PRESENCE",
      negativeGeoTargetType: "PRESENCE",
    },
  });
  const group = object(f.resources.get(`${prefix}/adGroups/10`)?.adGroup);
  Object.assign(group, {
    campaign: campaign.resourceName,
    status: "PAUSED",
    type: "SEARCH_STANDARD",
    cpcBidMicros: "1000000",
    targetingSetting: { targetRestrictions: [] },
  });
  const c = object(
    f.resources.get(`${prefix}/customers/${customer}`)?.customer,
  );
  Object.assign(c, { timeZone: "Asia/Almaty" });
  f.resources.set(`${prefix}/campaignBudgets/20`, {
    campaignBudget: {
      resourceName: `${prefix}/campaignBudgets/20`,
      name: "TEST PPC",
      amountMicros: "2000000",
      explicitlyShared: false,
      period: "DAILY",
      deliveryMethod: "STANDARD",
    },
  });
  f.resources.set("geoTargetConstants/100", {
    geoTargetConstant: {
      id: "100",
      resourceName: "geoTargetConstants/100",
      name: "Almaty",
      canonicalName: "Алматы,Казахстан",
      countryCode: "KZ",
      status: "ENABLED",
      targetType: "City",
    },
  });
  f.resources.set("languageConstants/1031", {
    languageConstant: {
      id: "1031",
      resourceName: "languageConstants/1031",
      name: "Russian",
      code: "ru",
      targetable: true,
    },
  });
  const entity: Record<string, string> = {
    campaigns: "campaign",
    adGroups: "adGroup",
    adGroupBidModifiers: "adGroupBidModifier",
    campaignBudgets: "campaignBudget",
    adGroupCriteria: "adGroupCriterion",
    campaignCriteria: "campaignCriterion",
    adGroupAds: "adGroupAd",
    ads: "ad",
    assets: "asset",
    campaignAssets: "campaignAsset",
    adGroupAssets: "adGroupAsset",
    customerAssets: "customerAsset",
    customAudiences: "customAudience",
    biddingStrategies: "biddingStrategy",
    assetGroups: "assetGroup",
    assetGroupAssets: "assetGroupAsset",
    assetGroupSignals: "assetGroupSignal",
    customers: "customer",
    campaignConversionGoals: "campaignConversionGoal",
    customConversionGoals: "customConversionGoal",
    conversionGoalCampaignConfigs: "conversionGoalCampaignConfig",
  };
  const tables: Record<string, string> = {
    campaign: "campaign",
    ad_group: "adGroup",
    ad_group_bid_modifier: "adGroupBidModifier",
    campaign_budget: "campaignBudget",
    ad_group_criterion: "adGroupCriterion",
    campaign_criterion: "campaignCriterion",
    ad_group_ad: "adGroupAd",
    asset: "asset",
    campaign_asset: "campaignAsset",
    ad_group_asset: "adGroupAsset",
    customer_asset: "customerAsset",
    custom_audience: "customAudience",
    bidding_strategy: "biddingStrategy",
    asset_group: "assetGroup",
    asset_group_asset: "assetGroupAsset",
    asset_group_signal: "assetGroupSignal",
    customer: "customer",
    currency_constant: "currencyConstant",
    user_list: "userList",
    user_interest: "userInterest",
    detailed_demographic: "detailedDemographic",
    conversion_action: "conversionAction",
    geo_target_constant: "geoTargetConstant",
    language_constant: "languageConstant",
    campaign_conversion_goal: "campaignConversionGoal",
    customer_conversion_goal: "customerConversionGoal",
    custom_conversion_goal: "customConversionGoal",
    conversion_goal_campaign_config: "conversionGoalCampaignConfig",
  };
  const camel = (v: string) =>
    v.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const at = (v: unknown, path: string) =>
    path.split(".").reduce<unknown>((a, k) => object(a)[camel(k)], v);
  const set = (target: MockRow, path: string, value: unknown) => {
    const parts = path.split(".").map(camel);
    let r = target;
    for (const k of parts.slice(0, -1)) {
      if (!r[k] || typeof r[k] !== "object") r[k] = {};
      r = object(r[k]);
    }
    if (value === undefined) delete r[parts.at(-1)!];
    else r[parts.at(-1)!] = structuredClone(value);
  };
  let seq = 9000,
    readCalls = 0,
    validateCalls = 0,
    writeCalls = 0,
    failIndex: number | null = null,
    outage = false,
    omitManualDefault = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (!String(url).startsWith("https://googleads.googleapis.com/v24/"))
        throw new Error("Unexpected provider URL: test network is closed");
      const body = JSON.parse(String(init?.body)) as MockRow;
      f.requests.push({ url, body, headers: init?.headers as MockRow });
      if (url.endsWith("geoTargetConstants:suggest")) {
        readCalls++;
        const requested = String(
          (object(body.locationNames).names as string[])[0],
        ).toLocaleLowerCase();
        return new Response(
          JSON.stringify({
            geoTargetConstantSuggestions: [...f.resources.values()]
              .filter(
                (r) =>
                  r.geoTargetConstant &&
                  (requested === "алматы"
                    ? object(r.geoTargetConstant).id === "100"
                    : requested === "астана"
                      ? object(r.geoTargetConstant).id === "101"
                      : String(
                          object(r.geoTargetConstant).name,
                        ).toLocaleLowerCase() === requested),
              )
              .map((r) => ({ geoTargetConstant: r.geoTargetConstant })),
          }),
        );
      }
      if (url.endsWith("googleAds:searchStream")) {
        readCalls++;
        if (outage) throw new Error("Mock provider read unavailable");
        const q = String(body.query),
          table = q.match(/ FROM (\w+)/)?.[1] ?? "",
          key = tables[table];
        if (!key) throw new Error(`Unmodelled table ${table}`);
        let rows = [...f.resources.values()].filter((r) => r[key]);
        if (table === "campaign")
          rows = rows.filter((r) => Object.keys(r).length === 1);
        if (table === "ad_group")
          rows = rows.filter((r) => !r.adGroupCriterion && !r.adGroupAd);
        for (const match of q.matchAll(
          /([a-z_]+(?:\.[a-z_0-9]+)+)\s*=\s*(?:'([^']*)'|(\d+)|(TRUE|FALSE)|(ENABLED|PAUSED|REMOVED|SEARCH|DISPLAY|VIDEO|PERFORMANCE_MAX))/g,
        )) {
          const expected: unknown =
            match[2] ?? match[3] ?? (match[4] ? match[4] === "TRUE" : match[5]);
          rows = rows.filter(
            (r) => String(at(r, match[1]!)) === String(expected),
          );
        }
        for (const match of q.matchAll(
          /([a-z_]+\.[a-z_0-9]+)\s+IN\s*\(([^)]+)\)/g,
        )) {
          const values = match[2]!
            .split(",")
            .map((v) => v.trim().replace(/^'|'$/g, ""));
          rows = rows.filter((r) => values.includes(String(at(r, match[1]!))));
        }
        if (q.includes("status != REMOVED"))
          rows = rows.filter((r) => object(r[key!]).status !== "REMOVED");
        const found = structuredClone(rows);
        if (omitManualDefault)
          for (const r of found) {
            const c = object(r.campaign);
            if (c.biddingStrategyType === "MANUAL_CPC") delete c.manualCpc;
          }
        return Response.json([{ results: found }]);
      }
      const custom = url.endsWith("customAudiences:mutate");
      if (!custom && !url.endsWith("googleAds:mutate"))
        throw new Error("Unexpected mock mutation service");
      const validation = body.validateOnly === true;
      if (validation) validateCalls++;
      else writeCalls++;
      const ops = (
        custom ? body.operations : body.mutateOperations
      ) as MockRow[];
      if (!Array.isArray(ops)) throw new Error("Missing operation list");
      const failures =
        failIndex === null
          ? []
          : [
              {
                errorCode: { criterionError: "RESOURCE_NOT_FOUND" },
                location: {
                  fieldPathElements: [
                    {
                      fieldName: custom ? "operations" : "mutateOperations",
                      index: failIndex,
                    },
                  ],
                },
              },
            ];
      if (failures.length && (custom || body.partialFailure === false))
        return Response.json(
          {
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              details: [
                { "@type": "google.ads.GoogleAdsFailure", errors: failures },
              ],
            },
          },
          { status: 400 },
        );
      if (validation)
        return Response.json(
          failures.length
            ? {
                partialFailureError: {
                  code: 3,
                  details: [{ errors: failures }],
                },
              }
            : {},
        );
      const images = new Map<string, MockRow>();
      for (const raw of ops) {
        const op = object(raw.assetOperation);
        const fields = object(op.create);
        const data = object(fields.imageAsset).data;
        if (typeof data === "string") {
          const bytes = Buffer.from(data, "base64"),
            metadata = await sharp(bytes).metadata();
          images.set(data, {
            fileSize: String(bytes.length),
            mimeType: metadata.format === "png" ? "PNG" : "JPEG",
            fullSize: {
              widthPixels: metadata.width,
              heightPixels: metadata.height,
            },
          });
        }
      }
      const references = new Map<string, string>();
      const results = ops.map((raw, index) => {
        if (index === failIndex) return {};
        const singular = custom
            ? "customAudience"
            : Object.keys(raw)[0]!.replace(/Operation$/, ""),
          op = custom ? raw : object(raw[`${singular}Operation`]);
        const kind = Object.keys(entity).find((k) => entity[k] === singular)!;
        const originalFields = object(op.create ?? op.update);
        const fields = object(replaceExtendedTemps(originalFields, references)),
          create = op.create !== undefined;
        let resource = resolveExtendedResourceReference(
          String(op.remove ?? fields.resourceName ?? ""),
          references,
        );
        if (create) {
          const id = String(++seq);
          resource = `${prefix}/${kind}/${id}`;
          if (
            ["campaignCriteria", "adGroupCriteria", "adGroupAds"].includes(kind)
          ) {
            const p = String(fields.campaign ?? fields.adGroup)
              .split("/")
              .at(-1);
            resource = `${prefix}/${kind}/${p}~${id}`;
          }
          if (
            [
              "campaignAssets",
              "adGroupAssets",
              "customerAssets",
              "assetGroupAssets",
            ].includes(kind)
          ) {
            const p = String(
              fields.campaign ?? fields.adGroup ?? fields.assetGroup ?? prefix,
            )
              .split("/")
              .at(-1);
            resource = `${prefix}/${kind}/${p}~${String(fields.asset).split("/").at(-1)}~${fields.fieldType}`;
          }
          if (originalFields.resourceName)
            references.set(String(originalFields.resourceName), resource);
        }
        let stored = f.resources.get(resource);
        if (kind === "ads")
          stored = [...f.resources.values()].find(
            (r) => object(object(r.adGroupAd).ad).resourceName === resource,
          );
        const value =
          kind === "ads"
            ? object(object(stored?.adGroupAd).ad)
            : object(stored?.[singular]);
        if (op.remove) {
          if (value.status !== undefined) value.status = "REMOVED";
          else f.resources.delete(resource);
        } else if (create) {
          const v: MockRow = {
            ...structuredClone(fields),
            resourceName: resource,
            id: resource.split("/").at(-1),
          };
          if (kind === "assets" && object(fields.imageAsset).data) {
            v.type = "IMAGE";
            v.imageAsset = images.get(String(object(fields.imageAsset).data));
          }
          if (kind === "assets" && fields.textAsset) v.type = "TEXT";
          if (kind === "campaigns") {
            const campaignId = resource.split("/").at(-1)!;
            if (fields.maximizeConversions !== undefined) {
              v.biddingStrategyType = "MAXIMIZE_CONVERSIONS";
              v.maximizeConversions = {
                targetCpaMicros: "0",
                ...object(fields.maximizeConversions),
              };
            }
            if (fields.maximizeConversionValue !== undefined) {
              v.biddingStrategyType = "MAXIMIZE_CONVERSION_VALUE";
              v.maximizeConversionValue = {
                targetRoas: 0,
                ...object(fields.maximizeConversionValue),
              };
            }
            const budget = object(
              f.resources.get(String(fields.campaignBudget))?.campaignBudget,
            );
            // Google names non-shared budgets after their attached campaign.
            if (budget.explicitlyShared === false) budget.name = fields.name;
            // Campaign creation materializes provider-managed goal/config rows;
            // subsequent operations update them via numeric canonical references.
            for (const existing of [...f.resources.values()]) {
              const goal = object(existing.customerConversionGoal);
              if (!goal.resourceName) continue;
              const suffix = String(goal.resourceName).split("/").at(-1)!;
              if (!/^\d+~\d+$/.test(suffix))
                throw new Error("Invalid mock canonical customer goal");
              const goalResource = `${prefix}/campaignConversionGoals/${campaignId}~${suffix}`;
              f.resources.set(goalResource, {
                campaignConversionGoal: {
                  resourceName: goalResource,
                  campaign: resource,
                  category: goal.category,
                  origin: goal.origin,
                  biddable: goal.biddable,
                },
              });
            }
            const configResource = `${prefix}/conversionGoalCampaignConfigs/${campaignId}`;
            f.resources.set(configResource, {
              conversionGoalCampaignConfig: {
                resourceName: configResource,
                campaign: resource,
                goalConfigLevel: "CUSTOMER",
              },
            });
          }
          if (["adGroupCriteria", "campaignCriteria"].includes(kind)) {
            const types: Record<string, string> = {
              keyword: "KEYWORD",
              userList: "USER_LIST",
              userInterest: "USER_INTEREST",
              customAudience: "CUSTOM_AUDIENCE",
              location: "LOCATION",
              language: "LANGUAGE",
              proximity: "PROXIMITY",
              adSchedule: "AD_SCHEDULE",
              ageRange: "AGE_RANGE",
              gender: "GENDER",
              parentalStatus: "PARENTAL_STATUS",
              incomeRange: "INCOME_RANGE",
              device: "DEVICE",
            };
            Object.assign(v, {
              type: Object.keys(types)
                .filter((k) => fields[k] !== undefined)
                .map((k) => types[k])[0],
              criterionId: resource.split("~").at(-1),
            });
          }
          f.resources.set(resource, {
            [singular]: v,
            ...(fields.campaign ? { campaign } : {}),
            ...(fields.adGroup ? { campaign, adGroup: group } : {}),
          });
        } else {
          const masks = String(op.updateMask).split(",");
          const schemes = [
            "manualCpc",
            "targetSpend",
            "maximizeConversions",
            "targetCpa",
            "targetRoas",
            "targetImpressionShare",
          ];
          if (schemes.some((k) => fields[k] !== undefined)) {
            for (const k of schemes)
              if (fields[k] === undefined) delete value[k];
          }
          for (const mask of masks) {
            if (mask === "targeting_setting.target_restriction_operations") {
              const setting = object(value.targetingSetting),
                old = Array.isArray(setting.targetRestrictions)
                  ? (setting.targetRestrictions as MockRow[])
                  : [];
              let restrictions = [...old];
              for (const raw of object(fields.targetingSetting)
                .targetRestrictionOperations as MockRow[]) {
                const op = object(raw),
                  replacement = object(op.value);
                if (op.operator !== "ADD")
                  throw new Error("Unsupported fixture targeting operation");
                restrictions = [
                  ...restrictions.filter(
                    (r) =>
                      r.targetingDimension !== replacement.targetingDimension,
                  ),
                  structuredClone(replacement),
                ];
              }
              value.targetingSetting = {
                ...setting,
                targetRestrictions: restrictions,
              };
            } else set(value, mask, at(fields, mask));
          }
          if (kind === "campaigns") {
            const map: Record<string, string> = {
              manualCpc: "MANUAL_CPC",
              targetSpend: "TARGET_SPEND",
              maximizeConversions: "MAXIMIZE_CONVERSIONS",
              targetCpa: "TARGET_CPA",
              targetRoas: "TARGET_ROAS",
              targetImpressionShare: "TARGET_IMPRESSION_SHARE",
            };
            for (const k of Object.keys(map))
              if (fields[k] !== undefined) value.biddingStrategyType = map[k];
          }
        }
        return custom
          ? { resourceName: resource }
          : { [`${singular}Result`]: { resourceName: resource } };
      });
      return Response.json({
        [custom ? "results" : "mutateOperationResponses"]: results,
        ...(failures.length
          ? {
              partialFailureError: { code: 3, details: [{ errors: failures }] },
            }
          : {}),
      });
    }),
  );
  return {
    ...f,
    counts: () => ({
      read: readCalls,
      validate_only: validateCalls,
      write: writeCalls,
    }),
    failOperation: (i: number | null) => {
      failIndex = i;
    },
    readOutage: (enabled = true) => {
      outage = enabled;
    },
    omitManualDefault: () => {
      omitManualDefault = true;
    },
  };
}

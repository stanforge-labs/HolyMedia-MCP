import { afterEach, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { GoogleAdsAdapter } from "../providers/adapters/google.ads.js";
import {
  canonical,
  type Stage1Plan,
  type Stage1MutationResult,
} from "../providers/google-ads-stage1.js";
import { McpPreviewService } from "./mcp-preview.service.js";
import { McpService } from "./mcp.service.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
export const customer = "1234567890",
  prefix = `customers/${customer}`;
export const principal = {
  kind: "service" as const,
  tokenId: "token-a",
  serviceIdentityId: "identity-a",
  workspaceId: "workspace-a",
  accountIds: ["account-a"],
  scopes: ["adforge:mcp:read", "adforge:mcp:write"],
};
export const human = {
  kind: "human" as const,
  userId: "user-a",
  sessionId: "session-a",
};
export const placement = { campaign_id: "1", ad_group_id: "10" };
export const keyword = (id = "101") => ({ ...placement, criterion_id: id });
export type MockRow = Record<string, unknown>;
export function object(value: unknown): MockRow {
  return value && typeof value === "object" ? (value as MockRow) : {};
}
export function fixture(
  stage0 = false,
  options: {
    strictCampaignAssetGaql?: boolean;
    stage2?: boolean;
    extended?: boolean;
  } = {},
) {
  for (const [key, value] of Object.entries({
    NODE_ENV: "test",
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: options.stage2 ? "true" : "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: options.extended
      ? "true"
      : "false",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: options.extended
      ? "true"
      : "false",
    ...(options.stage2 ? { PROVIDER_GOOGLE_API_VERSION: "v24" } : {}),
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: customer,
    V2_PREVIEW_ONLY: "false",
    V2_CONFIRMED_WRITE_ENABLED: "true",
    HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
  }))
    vi.stubEnv(key, value);
  const config = loadConfig({
    ...process.env,
    PROVIDER_GOOGLE_CLIENT_ID: "fixture-client",
    PROVIDER_GOOGLE_CLIENT_SECRET: "fixture-secret",
    PROVIDER_GOOGLE_REDIRECT_URI: "https://example.test/oauth",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: options.stage2 ? "true" : "false",
  });
  const adapter = new GoogleAdsAdapter(config),
    context = {
      accountId: customer,
      loginCustomerId: "9999999999",
      credentials: {
        accessToken: "fixture-access",
        scopes: ["https://www.googleapis.com/auth/adwords"],
      },
    };
  const campaign = {
      id: "1",
      resourceName: `${prefix}/campaigns/1`,
      name: "TEST PPC",
      status: "PAUSED",
    },
    group = {
      id: "10",
      resourceName: `${prefix}/adGroups/10`,
      name: "TEST group",
      status: "ENABLED",
    };
  const resources = new Map<string, MockRow>();
  resources.set(campaign.resourceName, { campaign });
  resources.set(group.resourceName, { campaign, adGroup: group });
  resources.set(`${prefix}/customers/${customer}`, {
    customer: { id: customer, resourceName: prefix, currencyCode: "KZT" },
  });
  for (let i = 101; i <= 120; i++)
    resources.set(`${prefix}/adGroupCriteria/10~${i}`, {
      campaign,
      adGroup: group,
      adGroupCriterion: {
        resourceName: `${prefix}/adGroupCriteria/10~${i}`,
        criterionId: String(i),
        type: "KEYWORD",
        keyword: { text: `тест ${i}`, matchType: "EXACT" },
        negative: false,
        status: "ENABLED",
        finalUrls: ["https://example.test/old"],
        cpcBidMicros: "150000000",
      },
    });
  let sequence = 1000,
    writes = 0,
    failIndex: number | null = null,
    validationFailure = false,
    activeToken = true,
    outage = false;
  const requests: { url: string; body: MockRow; headers: MockRow }[] = [];
  const entityKeys: Record<string, string> = {
    adGroups: "adGroup",
    campaignBudgets: "campaignBudget",
    adGroupCriteria: "adGroupCriterion",
    campaignCriteria: "campaignCriterion",
    sharedSets: "sharedSet",
    sharedCriteria: "sharedCriterion",
    campaignSharedSets: "campaignSharedSet",
  };
  const tables: Record<string, string> = {
    ad_group_criterion: "adGroupCriterion",
    campaign_criterion: "campaignCriterion",
    shared_set: "sharedSet",
    shared_criterion: "sharedCriterion",
    campaign_shared_set: "campaignSharedSet",
    campaign: "campaign",
    ad_group: "adGroup",
    customer: "customer",
    currency_constant: "currencyConstant",
    geo_target_constant: "geoTargetConstant",
    language_constant: "languageConstant",
    customer_conversion_goal: "customerConversionGoal",
    campaign_conversion_goal: "campaignConversionGoal",
    custom_conversion_goal: "customConversionGoal",
    conversion_action: "conversionAction",
    campaign_budget: "campaignBudget",
    ad_group_ad: "adGroupAd",
    campaign_asset: "campaignAsset",
    asset: "asset",
    conversion_goal_campaign_config: "conversionGoalCampaignConfig",
  };
  if (stage0) {
    resources.clear();
    resources.set(prefix, {
      customer: {
        id: customer,
        resourceName: prefix,
        currencyCode: "KZT",
        timeZone: "Asia/Almaty",
        conversionTrackingSetting: { googleAdsConversionCustomer: prefix },
      },
    });
    resources.set("geoTargetConstants/100", {
      geoTargetConstant: {
        resourceName: "geoTargetConstants/100",
        id: "100",
        name: "Алматы",
        canonicalName: "Алматы,Казахстан",
        countryCode: "KZ",
        status: "ENABLED",
      },
    });
    resources.set("languageConstants/1031", {
      languageConstant: {
        resourceName: "languageConstants/1031",
        id: "1031",
        name: "Russian",
        code: "ru",
        targetable: true,
      },
    });
    resources.set(`${prefix}/conversionActions/500`, {
      conversionAction: {
        resourceName: `${prefix}/conversionActions/500`,
        id: "500",
        name: "Lead",
        status: "ENABLED",
        primaryForGoal: true,
        category: "SUBMIT_LEAD_FORM",
        origin: "WEBSITE",
        ownerCustomer: prefix,
      },
    });
    resources.set("fixture-customer-goal", {
      customerConversionGoal: {
        resourceName: `${prefix}/customerConversionGoals/13~2`,
        category: "SUBMIT_LEAD_FORM",
        origin: "WEBSITE",
        biddable: true,
      },
    });
  }
  for (const currency of ["USD", "KZT"])
    resources.set(`currencyConstants/${currency}`, {
      currencyConstant: {
        resourceName: `currencyConstants/${currency}`,
        code: currency,
        billableUnitMicros: "10000",
      },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as MockRow;
      requests.push({ url, body, headers: init?.headers as MockRow });
      if (stage0 && url.endsWith("/geoTargetConstants:suggest"))
        return Response.json({
          geoTargetConstantSuggestions: [...resources.values()]
            .filter((r) => r.geoTargetConstant)
            .map((r) => ({ geoTargetConstant: r.geoTargetConstant })),
        });
      if (stage0 && url.endsWith("/googleAds:mutate")) {
        if (body.partialFailure !== false)
          throw new Error("Stage 0 must be atomic");
        if (body.validateOnly === true && !validationFailure)
          return Response.json({});
        if (validationFailure || failIndex !== null)
          return Response.json(
            {
              error: {
                code: 400,
                status: "INVALID_ARGUMENT",
                details: [
                  {
                    "@type": "google.ads.GoogleAdsFailure",
                    errors: [
                      {
                        errorCode: { policyFindingError: "POLICY_FINDING" },
                        message: "Medical policy finding. Bearer secret",
                        location: {
                          fieldPathElements: [
                            {
                              fieldName: "mutateOperations",
                              index: failIndex ?? 0,
                            },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            },
            { status: 400 },
          );
        const operations = body.mutateOperations as MockRow[],
          references = new Map<string, string>(),
          responses: MockRow[] = [];
        const kinds: Record<string, string> = {
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
        const resolve = (value: unknown): unknown => {
          if (typeof value === "string") {
            if (references.has(value)) return references.get(value);
            return value
              .replace(
                /conversionGoalCampaignConfigs\/(-\d+)$/,
                (_m, temp: string) =>
                  `conversionGoalCampaignConfigs/${references.get(`${prefix}/campaigns/${temp}`)?.split("/").at(-1)}`,
              )
              .replace(
                /campaignConversionGoals\/(-\d+)~/,
                (_m, temp: string) =>
                  `campaignConversionGoals/${references.get(`${prefix}/campaigns/${temp}`)?.split("/").at(-1)}~`,
              );
          }
          if (Array.isArray(value)) return value.map(resolve);
          if (value && typeof value === "object")
            return Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, resolve(v)]),
            );
          return value;
        };
        for (const op of operations) {
          const opKey = Object.keys(op)[0]!,
            kind = opKey.replace(/Operation$/, ""),
            command = object(op[opKey]),
            create = command.create !== undefined;
          const original = object(command.create ?? command.update),
            fields = resolve(original) as MockRow;
          let name = create
            ? `${prefix}/${kinds[kind]}/${++sequence}`
            : String(fields.resourceName);
          if (create && original.resourceName)
            references.set(String(original.resourceName), name);
          if (create && kind === "adGroupCriterion")
            name = `${prefix}/adGroupCriteria/${String(fields.adGroup).split("/").at(-1)}~${sequence}`;
          if (create && kind === "adGroupAd")
            name = `${prefix}/adGroupAds/${String(fields.adGroup).split("/").at(-1)}~${sequence}`;
          if (create && kind === "campaignCriterion")
            name = `${prefix}/campaignCriteria/${String(fields.campaign).split("/").at(-1)}~${sequence}`;
          if (create && kind === "campaignSharedSet")
            name = `${prefix}/campaignSharedSets/${String(fields.campaign).split("/").at(-1)}~${String(fields.sharedSet).split("/").at(-1)}`;
          const old = object(resources.get(name)?.[kind]),
            value: MockRow = {
              ...old,
              ...fields,
              resourceName: name,
              id: name.split("/").at(-1),
            };
          if (kind === "campaign") {
            value.biddingStrategyType = value.manualCpc
              ? "MANUAL_CPC"
              : value.maximizeConversions
                ? "MAXIMIZE_CONVERSIONS"
                : old.biddingStrategyType;
            // Google owns the name of a non-shared budget and syncs it to its campaign.
            const budget = object(
              resources.get(String(value.campaignBudget))?.campaignBudget,
            );
            if (budget.explicitlyShared === false) budget.name = value.name;
          }
          if (kind === "campaignConversionGoal") {
            const [campaignId, category, origin] = name
              .split("/")
              .at(-1)!
              .split("~");
            value.campaign = `${prefix}/campaigns/${campaignId}`;
            const canonicalGoal = [...resources.values()]
              .map((entry) => object(entry.customerConversionGoal))
              .find((goal) =>
                String(goal.resourceName).endsWith(`/${category}~${origin}`),
              );
            value.category = canonicalGoal?.category ?? category;
            value.origin = canonicalGoal?.origin ?? origin;
          }
          if (kind === "conversionGoalCampaignConfig") {
            value.campaign = `${prefix}/campaigns/${name.split("/").at(-1)}`;
            value.goalConfigLevel = "CAMPAIGN";
          }
          if (kind === "customConversionGoal") value.status = "ENABLED";
          if (kind === "campaignSharedSet") value.status = "ENABLED";
          if (kind === "asset")
            value.type = value.sitelinkAsset
              ? "SITELINK"
              : value.calloutAsset
                ? "CALLOUT"
                : value.structuredSnippetAsset
                  ? "STRUCTURED_SNIPPET"
                  : value.callAsset
                    ? "CALL"
                    : value.businessNameAsset
                      ? "BUSINESS_NAME"
                      : value.imageAsset
                        ? "IMAGE"
                        : value.type;
          const campaignResource =
            kind === "campaign"
              ? name
              : typeof value.campaign === "string"
                ? value.campaign
                : typeof value.adGroup === "string"
                  ? object(resources.get(value.adGroup)?.adGroup).campaign
                  : undefined;
          resources.set(name, {
            [kind]: value,
            ...(kind !== "campaign" && campaignResource
              ? {
                  campaign: object(
                    resources.get(String(campaignResource))?.campaign,
                  ),
                }
              : {}),
            ...(kind !== "adGroup" && value.adGroup
              ? {
                  adGroup: object(
                    resources.get(String(value.adGroup))?.adGroup,
                  ),
                }
              : {}),
          });
          responses.push({ [`${kind}Result`]: { resourceName: name } });
          writes++;
        }
        return Response.json({ mutateOperationResponses: responses });
      }
      if (url.endsWith("/googleAds:searchStream")) {
        if (outage && writes) throw new Error("Fixture outage");
        const query = String(body.query),
          table = query.match(/ FROM (\w+)/)?.[1] ?? "unknown",
          key = tables[table]!;
        if (
          options.strictCampaignAssetGaql &&
          table === "campaign_asset" &&
          /campaign\.id\s*=/.test(query) &&
          !query.split(" FROM ")[0]!.includes("campaign.id")
        )
          return Response.json(
            {
              error: {
                code: 400,
                status: "INVALID_ARGUMENT",
                details: [
                  {
                    "@type": "google.ads.GoogleAdsFailure",
                    errors: [
                      {
                        errorCode: {
                          queryError:
                            "EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE",
                        },
                        message:
                          "Mock of live Google referenced segment field missing from SELECT",
                      },
                    ],
                  },
                ],
              },
            },
            { status: 400 },
          );
        if (stage0 && query.includes("metrics.all_conversions"))
          return Response.json([
            { results: [{ metrics: { allConversions: 3 } }] },
          ]);
        let rows = [...resources.values()].filter((row) => row[key]);
        if (table === "currency_constant") {
          const code = query.match(
            /currency_constant\.code = '([A-Z]{3})'/,
          )?.[1];
          rows = rows.filter(
            (entry) => object(entry.currencyConstant).code === code,
          );
        }
        // A GAQL FROM campaign/ad_group returns one resource, not one row per child.
        if (table === "campaign")
          rows = rows.filter(
            (row) =>
              !row.adGroup &&
              !row.campaignCriterion &&
              !row.campaignSharedSet &&
              (!stage0 || Object.keys(row).length === 1),
          );
        if (table === "ad_group")
          rows = rows.filter(
            (row) => !row.adGroupCriterion && (!stage0 || !row.adGroupAd),
          );
        if (stage0) {
          const campaignName = query.match(/campaign\.name = '([^']+)'/)?.[1];
          if (campaignName)
            rows = rows.filter((r) => object(r.campaign).name === campaignName);
          const code = query.match(/language_constant\.code = '([^']+)'/)?.[1];
          if (code)
            rows = rows.filter((r) => object(r.languageConstant).code === code);
          const geoId = query.match(/geo_target_constant\.id = (\d+)/)?.[1];
          if (geoId)
            rows = rows.filter(
              (r) => String(object(r.geoTargetConstant).id) === geoId,
            );
        }
        const exactResources = [
          ...query.matchAll(/(?:resource_name) = '([^']+)'/g),
        ].map((x) => x[1]);
        if (options.stage2) {
          const criterion = query.match(
            /ad_group_criterion\.criterion_id = (\d+)/,
          )?.[1];
          if (criterion)
            rows = rows.filter(
              (r) =>
                String(object(r.adGroupCriterion).criterionId) === criterion,
            );
          const budget = query.match(
            /campaign\.campaign_budget = '([^']+)'/,
          )?.[1];
          if (budget)
            rows = rows.filter(
              (r) =>
                object(r.campaign).campaignBudget === budget &&
                object(r.campaign).status !== "REMOVED",
            );
        }
        const inResources = query.includes("resource_name IN")
          ? [...query.matchAll(/'([^']+)'/g)].map((x) => x[1])
          : [];
        if (exactResources.length)
          rows = rows.filter((row) =>
            exactResources.includes(String(object(row[key]).resourceName)),
          );
        if (inResources.length)
          rows = rows.filter((row) =>
            inResources.includes(String(object(row[key]).resourceName)),
          );
        if (table === "campaign_asset") {
          const campaignRef = query.match(
            /campaign_asset\.campaign = '([^']+)'/,
          )?.[1];
          if (campaignRef)
            rows = rows.filter(
              (r) => object(r.campaignAsset).campaign === campaignRef,
            );
        }
        for (const [field, objKey] of [
          ["campaign", "campaign"],
          ["ad_group", "adGroup"],
          ["shared_set", "sharedSet"],
        ]) {
          const id = query.match(new RegExp(`${field}\\.id = (\\d+)`))?.[1];
          if (id)
            rows = rows.filter((row) => String(object(row[objKey!]).id) === id);
        }
        if (/\.type = KEYWORD/.test(query))
          rows = rows.filter((row) => object(row[key]).type === "KEYWORD");
        const negative = query.match(/\.negative = (TRUE|FALSE)/)?.[1];
        if (negative)
          rows = rows.filter(
            (row) =>
              Boolean(object(row[key]).negative) === (negative === "TRUE"),
          );
        const status = query.match(/\.status = (ENABLED|PAUSED|REMOVED)/)?.[1];
        if (status)
          rows = rows.filter((row) => object(row[key]).status === status);
        const sharedSet = query.match(/\.shared_set = '([^']+)'/)?.[1];
        if (sharedSet)
          rows = rows.filter((row) => object(row[key]).sharedSet === sharedSet);
        return Response.json([{ results: structuredClone(rows) }]);
      }
      const kind = url.match(/\/(\w+):mutate$/)?.[1] ?? "unknown",
        key = entityKeys[kind];
      if (!key) throw new Error("Unexpected fixture URL");
      const operations = body.operations as MockRow[],
        validation = body.validateOnly === true,
        failed = validation ? (validationFailure ? 0 : null) : failIndex;
      if (!validation) writes++;
      const results = operations.map((operation, index) => {
        if (index === failed) return {};
        let resource = String(
          operation.remove ?? object(operation.update).resourceName ?? "",
        );
        if (operation.create) {
          const create = structuredClone(object(operation.create)),
            id = String(++sequence);
          const parent = String(
            create.adGroup ?? create.sharedSet ?? create.campaign ?? "",
          )
            .split("/")
            .pop();
          resource = `${prefix}/${kind}/${["adGroupCriteria", "campaignCriteria", "sharedCriteria"].includes(kind) ? `${parent}~${id}` : kind === "campaignSharedSets" ? `${String(create.campaign).split("/").pop()}~${String(create.sharedSet).split("/").pop()}` : id}`;
          if (!validation) {
            const row: MockRow = {
              [key]: {
                ...create,
                resourceName: resource,
                ...(kind === "sharedSets"
                  ? { id }
                  : kind === "adGroupCriteria" ||
                      kind === "sharedCriteria" ||
                      kind === "campaignCriteria"
                    ? { criterionId: id, type: "KEYWORD" }
                    : {}),
                ...(kind === "sharedSets" ||
                kind === "campaignSharedSets" ||
                kind === "adGroupCriteria" ||
                kind === "campaignCriteria"
                  ? { status: create.status ?? "ENABLED" }
                  : {}),
              },
            };
            if (create.campaign || create.adGroup) row.campaign = campaign;
            if (create.adGroup) row.adGroup = group;
            resources.set(resource, row);
          }
        } else if (!validation && operation.update)
          Object.assign(
            object(resources.get(resource)?.[key]),
            operation.update,
          );
        else if (!validation && operation.remove) {
          if (kind === "sharedCriteria") resources.delete(resource);
          else object(resources.get(resource)?.[key]).status = "REMOVED";
        }
        return { resourceName: resource };
      });
      return Response.json({
        ...(validation ? {} : { results }),
        ...(failed !== null
          ? {
              partialFailureError: {
                code: 3,
                details: [
                  {
                    errors: [
                      {
                        errorCode: { criterionError: "RESOURCE_NOT_FOUND" },
                        message: "Bearer secret fixture ignored",
                        location: {
                          fieldPathElements: [
                            { fieldName: "operations", index: failed },
                          ],
                        },
                      },
                    ],
                  },
                ],
              },
            }
          : {}),
      });
    }),
  );
  const account = {
    id: "account-a",
    workspaceId: principal.workspaceId,
    provider: "GOOGLE_ADS",
    externalAccountId: customer,
    connectionId: "connection-a",
    displayName: "TEST Ads",
  };
  const previewsRows: MockRow[] = [],
    events: MockRow[] = [];
  function whereMatch(row: MockRow, where: MockRow): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (value instanceof Date)
        return row[key] instanceof Date && Number(row[key]) === Number(value);
      if (key === "AND")
        return (value as MockRow[]).every((rule) => whereMatch(row, rule));
      if (key === "OR")
        return (value as MockRow[]).some((rule) => whereMatch(row, rule));
      if (key === "metadata") {
        const condition = object(value);
        const actual = (condition.path as string[]).reduce(
          (next, k) => object(next)[k],
          row.metadata as unknown,
        );
        return actual === condition.equals;
      }
      if (key === "serviceToken")
        return (
          activeToken &&
          (!object(object(value).serviceIdentity).createdById ||
            object(object(value).serviceIdentity).createdById === human.userId)
        );
      if (key === "account")
        return whereMatch(
          account,
          Object.fromEntries(
            Object.entries(object(value)).filter(
              ([k]) => !["enabled", "connection"].includes(k),
            ),
          ),
        );
      const condition = object(value);
      if ("in" in condition)
        return (condition.in as unknown[]).includes(row[key]);
      if ("gt" in condition)
        return row[key] instanceof Date && row[key] > (condition.gt as Date);
      if ("lt" in condition)
        return row[key] instanceof Date
          ? row[key] < (condition.lt as Date)
          : String(row[key]) < String(condition.lt);
      if ("gte" in condition && (row[key] as Date) < (condition.gte as Date))
        return false;
      if ("lte" in condition && (row[key] as Date) > (condition.lte as Date))
        return false;
      if ("gte" in condition || "lte" in condition) return true;
      if ("not" in condition)
        return condition.not === null
          ? row[key] !== null && row[key] !== undefined
          : row[key] !== null && row[key] !== undefined;
      if ("equals" in condition)
        return canonical(row[key]) === canonical(condition.equals);
      return row[key] === value;
    });
  }
  const audit = {
    record: vi.fn(async (input: MockRow) => {
      events.push({
        ...structuredClone(input),
        id: `event-${events.length}`,
        createdAt: new Date(),
      });
    }),
  };
  const db = {
    client: {
      providerAccount: { findFirst: vi.fn(async () => account) },
      serviceToken: {
        findFirst: vi.fn(async () =>
          activeToken
            ? {
                scopes: principal.scopes,
                accountIds: principal.accountIds,
                resourceAccessMode: "STATIC_ALLOWLIST",
                serviceIdentity: { createdById: human.userId },
              }
            : null,
        ),
      },
      auditEvent: {
        findFirst: vi.fn(
          async ({ where }: { where: MockRow }) =>
            events.find((row) => whereMatch(row, where)) ?? null,
        ),
      },
      mcpPreview: {
        create: vi.fn(async ({ data }: { data: MockRow }) => {
          const row = {
            ...structuredClone(data),
            id: `preview-${previewsRows.length}`,
            confirmedAt: null,
            consumedAt: null,
            cancelledAt: null,
            createdAt: new Date(),
          };
          previewsRows.push(row);
          return structuredClone(row);
        }),
        findFirst: vi.fn(async ({ where }: { where: MockRow }) => {
          const row = previewsRows.find((row) => whereMatch(row, where));
          return row
            ? {
                ...structuredClone(row),
                serviceToken: {
                  serviceIdentityId: principal.serviceIdentityId,
                },
              }
            : null;
        }),
        findMany: vi.fn(
          async ({ where, take }: { where: MockRow; take: number }) =>
            previewsRows
              .filter((row) => whereMatch(row, where))
              .sort(
                (a, b) =>
                  Number(b.commitAttemptedAt) - Number(a.commitAttemptedAt) ||
                  String(b.id).localeCompare(String(a.id)),
              )
              .slice(0, take)
              .map((row) => ({
                ...structuredClone(row),
                serviceToken: {
                  serviceIdentityId: principal.serviceIdentityId,
                },
              })),
        ),
        updateMany: vi.fn(
          async ({ where, data }: { where: MockRow; data: MockRow }) => {
            const row = previewsRows.find((row) => whereMatch(row, where));
            if (!row || !activeToken) return { count: 0 };
            Object.assign(row, structuredClone(data));
            return { count: 1 };
          },
        ),
        update: vi.fn(
          async ({ where, data }: { where: MockRow; data: MockRow }) => {
            const row = previewsRows.find((x) => x.id === where.id)!;
            Object.assign(row, structuredClone(data));
            return row;
          },
        ),
      },
    },
  };
  const providers = {
    googleExtended: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        version: 3 | 4 | 5,
        action: Parameters<GoogleAdsAdapter["extended"]>[2],
        input: unknown,
        results?: Stage1MutationResult[],
      ) => adapter.extended(context, version, action, input, results),
    ),
    googleStage2: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        action: Parameters<GoogleAdsAdapter["stage2"]>[1],
        input: unknown,
        results?: Stage1MutationResult[],
      ) => adapter.stage2(context, action, input, results),
    ),
    googleStage0: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        action: Parameters<GoogleAdsAdapter["stage0"]>[1],
        input: unknown,
        results?: Stage1MutationResult[],
      ) => adapter.stage0(context, action, input, results),
    ),
    googleStage1: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        action: string,
        input: unknown,
        results?: Stage1MutationResult[],
      ) =>
        action === "build"
          ? adapter.buildStage1(context, input)
          : action === "read"
            ? adapter.readStage1(context, input as Stage1Plan)
            : action === "verify"
              ? adapter.verifyStage1(context, input as Stage1Plan, results!)
              : adapter.mutateStage1(
                  context,
                  input as Stage1Plan,
                  action === "validate",
                ),
    ),
    readGoogleKeywordStates: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        items: Parameters<GoogleAdsAdapter["readKeywordStates"]>[1],
      ) => adapter.readKeywordStates(context, items),
    ),
    validateGoogleKeywordStatuses: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        items: Parameters<GoogleAdsAdapter["validateKeywordStatuses"]>[1],
      ) => adapter.validateKeywordStatuses(context, items),
    ),
    commitGoogleKeywordStatuses: vi.fn(
      async (
        _w: string,
        _c: string,
        _a: string,
        items: Parameters<GoogleAdsAdapter["commitKeywordStatuses"]>[1],
      ) => adapter.commitKeywordStatuses(context, items),
    ),
  };
  const previews = new McpPreviewService(
    db as never,
    audit as never,
    providers as never,
  );
  const mcp = new McpService(
    db as never,
    providers as never,
    {} as never,
    previews,
    {} as never,
    {} as never,
  );
  const call = (name: string, args: MockRow) =>
    mcp.call(principal, name, {
      provider: "GOOGLE_ADS",
      account_id: customer,
      ...args,
    }) as Promise<MockRow>;
  const approve = async (preview: MockRow) =>
    previews.decideGoogleApproval(
      human,
      String(preview.approval_url).split("#")[1]!,
      "approve",
    );
  const commit = async (preview: MockRow) => {
    await approve(preview);
    return mcp.call(principal, "commit_preview", {
      preview_token: preview.preview_token,
    }) as Promise<MockRow>;
  };
  return {
    adapter,
    context,
    resources,
    requests,
    call,
    approve,
    commit,
    previews,
    previewsRows,
    events,
    db,
    audit,
    mcp,
    writes: () => writes,
    fail: (index: number | null) => {
      failIndex = index;
    },
    validationFail: () => {
      validationFailure = true;
    },
    revoke: () => {
      activeToken = false;
    },
    outage: () => {
      outage = true;
    },
  };
}

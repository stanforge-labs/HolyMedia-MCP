import type { AppConfig } from "@holymedia/config";
import type { ExtendedPlan } from "./google-ads-extended-plan.js";

const TEST_ACCOUNT = "8590146099";
const TEST_ORIGIN = "https://mcp-test.holymedia.kz";
const PROFILES = [
  "pmax_create",
  "asset_group_update",
  "pmax_search_theme_add",
  "pmax_signal_remove",
  "pmax_negative_add",
  "pmax_brand_exclude",
  "pmax_audience_signal_add",
  "pmax_asset_attach",
  "pmax_asset_detach",
  "pmax_asset_replace",
  "pmax_campaign_asset_detach",
  "pmax_campaign_asset_replace",
  "pmax_negative_remove",
  "pmax_brand_remove",
  "pmax_asset_group_create",
] as const;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function isolated(config: AppConfig, account: string): boolean {
  const actions = config.qrsTestPmaxAllowedActions;
  return (
    config.qrsTestPmaxConfirmedWriteEnabled &&
    config.qrsTestRestrictedAuth &&
    !config.qrsTestGoogleConfirmedWriteEnabled &&
    !config.qrsTestCloneConfirmedWriteEnabled &&
    !config.qrsTestConversionActionConfirmedWriteEnabled &&
    config.providerGoogleAdsWriteEnabled &&
    config.previewOnly &&
    !config.confirmedWriteEnabled &&
    !config.providerGoogleAdsStage2WriteEnabled &&
    !config.providerGoogleAdsStage3WriteEnabled &&
    !config.providerGoogleAdsStage4WriteEnabled &&
    !config.publicMcpWriteScopeEnabled &&
    !config.publicMcpControlledWriteEnabled &&
    config.publicBaseUrl === TEST_ORIGIN &&
    config.providerGoogleApiVersion.replace(/^v/, "") === "24" &&
    account.replaceAll("-", "") === TEST_ACCOUNT &&
    config.googleAdsWriteAccountAllowlist.length === 1 &&
    config.googleAdsWriteAccountAllowlist[0] === TEST_ACCOUNT &&
    actions.length > 0 &&
    new Set(actions).size === actions.length &&
    actions.every((action) =>
      PROFILES.includes(action as (typeof PROFILES)[number]),
    )
  );
}

/** Checked before a provider build: no other Stage 4 intent can use the TEST exception. */
export function qrsPmaxIntentAllowed(
  config: AppConfig,
  account: string,
  raw: unknown,
): boolean {
  if (!isolated(config, account)) return false;
  const intent = object(raw);
  if (!config.qrsTestPmaxAllowedActions.includes(String(intent.action)))
    return false;
  const items = intent.items;
  if (!Array.isArray(items) || items.length !== 1) return false;
  const item = object(items[0]);
  if (intent.action === "pmax_create") {
    const brief = object(item.brief);
    const budget = object(brief.daily_budget);
    const groups = brief.asset_groups;
    const conversions = brief.conversion_actions;
    const locations = brief.locations;
    const languages = brief.languages;
    return (
      Object.keys(item).length === 1 &&
      typeof config.qrsTestPmaxCampaignName === "string" &&
      brief.campaign_name === config.qrsTestPmaxCampaignName &&
      brief.brand_guidelines_enabled !== false &&
      brief.business_name === "HolyPilot" &&
      budget.currency === "USD" &&
      budget.amount === "2" &&
      (brief.bidding_strategy === undefined ||
        brief.bidding_strategy === "MAXIMIZE_CONVERSIONS") &&
      brief.target_cpa === undefined &&
      brief.target_roas === undefined &&
      Array.isArray(conversions) &&
      conversions.length === 1 &&
      conversions[0] === config.qrsTestPmaxConversionActionId &&
      Array.isArray(locations) &&
      locations.length === 1 &&
      object(locations[0]).geo_target_id === config.qrsTestPmaxGeoId &&
      object(locations[0]).exclude !== true &&
      Array.isArray(languages) &&
      languages.length === 1 &&
      languages[0] === config.qrsTestPmaxLanguageId &&
      Array.isArray(groups) &&
      groups.length === 1 &&
      object(groups[0]).final_url === config.qrsTestPmaxFinalUrl
    );
  }
  if (
    typeof config.qrsTestPmaxParentCampaignId !== "string" ||
    item.campaign_id !== config.qrsTestPmaxParentCampaignId ||
    (typeof config.qrsTestPmaxParentAssetGroupId !== "string" &&
      ![
        "pmax_negative_add",
        "pmax_negative_remove",
        "pmax_brand_exclude",
        "pmax_brand_remove",
        "pmax_campaign_asset_detach",
        "pmax_campaign_asset_replace",
        "pmax_asset_group_create",
      ].includes(String(intent.action)))
  )
    return false;
  if (intent.action === "pmax_asset_group_create") {
    const group = object(item.asset_group);
    const images = group.images;
    return (
      Object.keys(item).sort().join(",") === "asset_group,campaign_id" &&
      Object.keys(group).sort().join(",") ===
        "descriptions,final_url,headlines,images,long_headlines,name" &&
      group.name === config.qrsTestPmaxGroupName &&
      group.final_url === config.qrsTestPmaxFinalUrl &&
      Array.isArray(group.headlines) &&
      Array.isArray(group.long_headlines) &&
      Array.isArray(group.descriptions) &&
      Array.isArray(images) &&
      images.every((image) => {
        const row = object(image);
        const media = object(row.media);
        return (
          Object.keys(row).sort().join(",") === "field_type,media" &&
          ["MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE"].includes(
            String(row.field_type),
          ) &&
          Object.keys(media).join(",") === "asset_id" &&
          /^[1-9][0-9]{0,19}$/.test(String(media.asset_id))
        );
      })
    );
  }
  if (
    ["pmax_negative_remove", "pmax_brand_remove"].includes(
      String(intent.action),
    )
  )
    return (
      item.criterion_id === config.qrsTestPmaxCriterionId &&
      item.acknowledge_irreversible === true &&
      Object.keys(item).sort().join(",") ===
        "acknowledge_irreversible,campaign_id,criterion_id" &&
      (intent.action === "pmax_negative_remove"
        ? Boolean(config.qrsTestPmaxNegativeText)
        : Boolean(config.qrsTestPmaxBrandSharedSetId))
    );
  if (
    ["pmax_campaign_asset_detach", "pmax_campaign_asset_replace"].includes(
      String(intent.action),
    )
  )
    return boundedAssetIntent(config, intent.action, item, true);
  if (intent.action === "pmax_negative_add")
    return (
      typeof config.qrsTestPmaxNegativeText === "string" &&
      item.text === config.qrsTestPmaxNegativeText &&
      item.match_type === "EXACT" &&
      Object.keys(item).sort().join(",") === "campaign_id,match_type,text"
    );
  if (intent.action === "pmax_brand_exclude")
    return (
      typeof config.qrsTestPmaxBrandSharedSetId === "string" &&
      item.shared_set_id === config.qrsTestPmaxBrandSharedSetId &&
      Object.keys(item).sort().join(",") === "campaign_id,shared_set_id"
    );
  if (item.asset_group_id !== config.qrsTestPmaxParentAssetGroupId)
    return false;
  if (intent.action === "asset_group_update")
    return (
      typeof item.name === "string" &&
      item.name.trim().length > 0 &&
      Object.keys(item).sort().join(",") === "asset_group_id,campaign_id,name"
    );
  if (intent.action === "pmax_audience_signal_add")
    return (
      typeof config.qrsTestPmaxAudienceId === "string" &&
      item.audience_id === config.qrsTestPmaxAudienceId &&
      Object.keys(item).sort().join(",") ===
        "asset_group_id,audience_id,campaign_id"
    );
  if (intent.action === "pmax_asset_attach")
    return (
      typeof config.qrsTestPmaxAssetId === "string" &&
      item.asset_id === config.qrsTestPmaxAssetId &&
      item.field_type === config.qrsTestPmaxAssetFieldType &&
      item.field_type !== "LOGO" &&
      item.field_type !== "BUSINESS_NAME" &&
      Object.keys(item).sort().join(",") ===
        "asset_group_id,asset_id,campaign_id,field_type"
    );
  if (
    ["pmax_asset_detach", "pmax_asset_replace"].includes(String(intent.action))
  )
    return boundedAssetIntent(config, intent.action, item, false);
  if (
    item.asset_group_id !== config.qrsTestPmaxParentAssetGroupId ||
    (!config.qrsTestPmaxSearchTheme && !config.qrsTestPmaxAudienceId)
  )
    return false;
  if (intent.action === "pmax_search_theme_add")
    return (
      item.search_theme === config.qrsTestPmaxSearchTheme &&
      Object.keys(item).sort().join(",") ===
        "asset_group_id,campaign_id,search_theme"
    );
  return (
    intent.action === "pmax_signal_remove" &&
    item.acknowledge_irreversible === true &&
    typeof item.signal_id === "string" &&
    /^[1-9][0-9]{0,19}$/.test(item.signal_id) &&
    Object.keys(item).sort().join(",") ===
      "acknowledge_irreversible,asset_group_id,campaign_id,signal_id"
  );
}

function boundedAssetIntent(
  config: AppConfig,
  action: unknown,
  item: Record<string, unknown>,
  campaignLevel: boolean,
): boolean {
  const role = config.qrsTestPmaxAssetFieldType;
  const textRole = [
    "HEADLINE",
    "LONG_HEADLINE",
    "DESCRIPTION",
    "BUSINESS_NAME",
  ].includes(String(role));
  const replacing =
    action ===
    (campaignLevel ? "pmax_campaign_asset_replace" : "pmax_asset_replace");
  if (
    !role ||
    (campaignLevel
      ? !["LOGO", "BUSINESS_NAME"].includes(role)
      : ["LOGO", "BUSINESS_NAME"].includes(role)) ||
    item.asset_id !== config.qrsTestPmaxAssetId ||
    item.field_type !== role ||
    item.acknowledge_irreversible !== true ||
    (!campaignLevel &&
      item.asset_group_id !== config.qrsTestPmaxParentAssetGroupId)
  )
    return false;
  const keys = campaignLevel
    ? "acknowledge_irreversible,asset_id,campaign_id,field_type"
    : "acknowledge_irreversible,asset_group_id,asset_id,campaign_id,field_type";
  if (!replacing) return Object.keys(item).sort().join(",") === keys;
  if (textRole)
    return (
      item.text === config.qrsTestPmaxReplacementText &&
      !Object.hasOwn(item, "media") &&
      Object.keys(item).sort().join(",") ===
        `${keys},text`.split(",").sort().join(",")
    );
  const media = object(item.media);
  return (
    media.asset_id === config.qrsTestPmaxReplacementAssetId &&
    Object.keys(media).join(",") === "asset_id" &&
    !Object.hasOwn(item, "text") &&
    Object.keys(item).sort().join(",") ===
      `${keys},media`.split(",").sort().join(",")
  );
}

/** Rechecked against the immutable plan by both preview service and adapter. */
export function qrsPmaxWriteAllowed(
  config: AppConfig,
  input: unknown,
): input is ExtendedPlan {
  const plan = object(input);
  if (
    !isolated(config, String(plan.account_id ?? "")) ||
    plan.version !== 4 ||
    !Array.isArray(plan.checks) ||
    plan.checks.length === 0 ||
    !Array.isArray(plan.operations) ||
    plan.operations.length === 0 ||
    plan.operations.length > 500
  )
    return false;
  const intent = object(plan.intent);
  if (!config.qrsTestPmaxAllowedActions.includes(String(intent.action)))
    return false;
  if (!qrsPmaxIntentAllowed(config, TEST_ACCOUNT, intent)) return false;
  const operations = plan.operations.map(object);
  const prefix = `customers/${TEST_ACCOUNT}`;
  if (intent.action === "pmax_create") {
    const items = intent.items;
    if (!Array.isArray(items) || items.length !== 1) return false;
    const brief = object(object(items[0]).brief);
    const campaigns = operations.filter((op) => op.kind === "campaigns");
    const budgets = operations.filter((op) => op.kind === "campaignBudgets");
    const groups = operations.filter((op) => op.kind === "assetGroups");
    const campaign = campaigns[0];
    const budget = budgets[0];
    const campaignFields = object(campaign?.fields);
    const budgetFields = object(budget?.fields);
    const campaignResource = campaign?.resource_name;
    if (
      plan.atomic !== true ||
      brief.campaign_name !== config.qrsTestPmaxCampaignName ||
      brief.brand_guidelines_enabled === false ||
      campaigns.length !== 1 ||
      budgets.length !== 1 ||
      groups.length !== 1 ||
      campaign?.method !== "create" ||
      budget?.method !== "create" ||
      !/^customers\/8590146099\/campaigns\/-[1-9][0-9]*$/.test(
        String(campaignResource),
      ) ||
      campaignFields.name !== config.qrsTestPmaxCampaignName ||
      campaignFields.status !== "PAUSED" ||
      campaignFields.advertisingChannelType !== "PERFORMANCE_MAX" ||
      campaignFields.brandGuidelinesEnabled !== true ||
      Object.keys(object(campaignFields.maximizeConversions)).length !== 0 ||
      campaignFields.maximizeConversionValue !== undefined ||
      campaignFields.campaignBudget !== budget?.resource_name ||
      budgetFields.explicitlyShared !== false ||
      budgetFields.amountMicros !== "2000000" ||
      !groups.every(
        (op) =>
          op.method === "create" &&
          object(op.fields).campaign === campaignResource &&
          object(op.fields).status === "PAUSED",
      )
    )
      return false;
    const kinds = new Set([
      "campaignBudgets",
      "campaigns",
      "campaignConversionGoals",
      "customConversionGoals",
      "conversionGoalCampaignConfigs",
      "campaignCriteria",
      "assets",
      "campaignAssets",
      "assetGroups",
      "assetGroupAssets",
      "assetGroupSignals",
    ]);
    return operations.every((op) => {
      if (!kinds.has(String(op.kind))) return false;
      const fields = object(op.fields);
      if (op.method === "create")
        return (
          op.before === null &&
          op.update_mask === null &&
          (op.resource_name === null ||
            /^customers\/8590146099\/[A-Za-z]+\/-[1-9][0-9]*$/.test(
              String(op.resource_name),
            ))
        );
      if (op.kind === "campaignConversionGoals")
        return (
          op.method === "update" &&
          fields.biddable === false &&
          String(op.resource_name).startsWith(
            `${prefix}/campaignConversionGoals/${String(campaignResource).split("/").at(-1)}~`,
          )
        );
      return (
        op.kind === "conversionGoalCampaignConfigs" &&
        op.method === "update" &&
        op.resource_name ===
          `${prefix}/conversionGoalCampaignConfigs/${String(campaignResource).split("/").at(-1)}`
      );
    });
  }
  if (
    ![
      "asset_group_update",
      "pmax_search_theme_add",
      "pmax_signal_remove",
      "pmax_negative_add",
      "pmax_brand_exclude",
      "pmax_audience_signal_add",
      "pmax_asset_attach",
      "pmax_asset_detach",
      "pmax_asset_replace",
      "pmax_campaign_asset_detach",
      "pmax_campaign_asset_replace",
      "pmax_negative_remove",
      "pmax_brand_remove",
      "pmax_asset_group_create",
    ].includes(String(intent.action))
  )
    return false;
  const items = intent.items;
  if (!Array.isArray(items) || items.length !== 1) return false;
  const item = object(items[0]);
  const action = String(intent.action);
  const boundedRemovals = [
    "pmax_asset_detach",
    "pmax_asset_replace",
    "pmax_campaign_asset_detach",
    "pmax_campaign_asset_replace",
    "pmax_negative_remove",
    "pmax_brand_remove",
  ];
  if (
    !config.qrsTestPmaxParentCampaignId ||
    item.campaign_id !== config.qrsTestPmaxParentCampaignId ||
    (!boundedRemovals.includes(action) &&
      action !== "pmax_asset_group_create" &&
      operations.length !== 1)
  )
    return false;
  const op = operations[0]!;
  const before = object(op.before);
  const fields = object(op.fields);
  const expected = object(op.expected);
  const parent = `${prefix}/campaigns/${config.qrsTestPmaxParentCampaignId}`;
  const group = `${prefix}/assetGroups/${String(item.asset_group_id)}`;
  const checks = plan.checks.flatMap((check) =>
    Array.isArray(object(check).rows) ? (object(check).rows as unknown[]) : [],
  );
  const pausedCampaign = checks.some((check) => {
    const campaign = object(object(check).campaign);
    return (
      campaign.resourceName === parent &&
      campaign.status === "PAUSED" &&
      campaign.advertisingChannelType === "PERFORMANCE_MAX"
    );
  });
  const pausedGroup = checks.some((check) => {
    const assetGroup = object(object(check).assetGroup);
    return (
      assetGroup.resourceName === group &&
      assetGroup.campaign === parent &&
      assetGroup.status === "PAUSED"
    );
  });
  if (!pausedCampaign) return false;
  if (action === "pmax_asset_group_create") {
    if (
      !qrsPmaxIntentAllowed(config, TEST_ACCOUNT, intent) ||
      plan.atomic !== true ||
      plan.irreversible !== false ||
      !checks.some((row) => {
        const campaign = object(object(row).campaign);
        return (
          campaign.resourceName === parent &&
          campaign.brandGuidelinesEnabled === true
        );
      }) ||
      !checks.some((row) => {
        const link = object(object(row).campaignAsset);
        return link.campaign === parent && link.fieldType === "LOGO";
      }) ||
      !checks.some((row) => {
        const link = object(object(row).campaignAsset);
        return link.campaign === parent && link.fieldType === "BUSINESS_NAME";
      })
    )
      return false;
    const groups = operations.filter(
      (candidate) => candidate.kind === "assetGroups",
    );
    const created = groups[0];
    const createdFields = object(created?.fields);
    if (
      groups.length !== 1 ||
      created?.method !== "create" ||
      !/^customers\/8590146099\/assetGroups\/-[1-9][0-9]*$/.test(
        String(created.resource_name),
      ) ||
      created.before !== null ||
      created.update_mask !== null ||
      createdFields.campaign !== parent ||
      createdFields.status !== "PAUSED" ||
      createdFields.name !== config.qrsTestPmaxGroupName ||
      !Array.isArray(createdFields.finalUrls) ||
      createdFields.finalUrls.length !== 1 ||
      createdFields.finalUrls[0] !== config.qrsTestPmaxFinalUrl
    )
      return false;
    const group = object(item.asset_group);
    const textRoles = new Map<string, string>();
    for (const [field, role] of [
      ["headlines", "HEADLINE"],
      ["long_headlines", "LONG_HEADLINE"],
      ["descriptions", "DESCRIPTION"],
    ] as const)
      for (const text of group[field] as string[]) textRoles.set(text, role);
    const expectedText = [...textRoles.keys()];
    const assets = operations.filter(
      (candidate) => candidate.kind === "assets",
    );
    const assetNames = new Set(
      assets.map((asset) => String(asset.resource_name)),
    );
    const text = assets.map(
      (asset) => object(object(asset.fields).textAsset).text,
    );
    if (
      assets.length !==
        (group.headlines as unknown[]).length +
          (group.long_headlines as unknown[]).length +
          (group.descriptions as unknown[]).length ||
      text.some((value) => !expectedText.includes(String(value))) ||
      assets.some(
        (asset) =>
          asset.method !== "create" ||
          asset.before !== null ||
          asset.update_mask !== null ||
          !/^customers\/8590146099\/assets\/-[1-9][0-9]*$/.test(
            String(asset.resource_name),
          ) ||
          object(asset.fields).resourceName !== asset.resource_name ||
          object(asset.expected).type !== "TEXT",
      )
    )
      return false;
    const links = operations.filter(
      (candidate) => candidate.kind === "assetGroupAssets",
    );
    if (
      links.length !== assets.length + (group.images as unknown[]).length ||
      operations.length !== 1 + assets.length + links.length
    )
      return false;
    const counts: Record<string, number> = {};
    const imageRoles = new Map(
      (group.images as unknown[]).map((image) => {
        const row = object(image);
        return [
          `${prefix}/assets/${object(row.media).asset_id}`,
          String(row.field_type),
        ];
      }),
    );
    if (
      [...imageRoles.keys()].some(
        (resource) =>
          !checks.some((row) => {
            const asset = object(object(row).asset);
            return asset.resourceName === resource && asset.type === "IMAGE";
          }),
      )
    )
      return false;
    const textAssetRoles = new Map(
      assets.map((asset) => [
        String(asset.resource_name),
        textRoles.get(String(object(object(asset.fields).textAsset).text)),
      ]),
    );
    for (const link of links) {
      const fields = object(link.fields);
      const role = String(fields.fieldType);
      counts[role] = (counts[role] ?? 0) + 1;
      if (
        link.method !== "create" ||
        link.resource_name !== null ||
        link.before !== null ||
        link.update_mask !== null ||
        fields.assetGroup !== created.resource_name ||
        fields.status !== "ENABLED" ||
        ![
          "HEADLINE",
          "LONG_HEADLINE",
          "DESCRIPTION",
          "MARKETING_IMAGE",
          "SQUARE_MARKETING_IMAGE",
        ].includes(role) ||
        (assetNames.has(String(fields.asset))
          ? textAssetRoles.get(String(fields.asset)) !== role
          : imageRoles.get(String(fields.asset)) !== role)
      )
        return false;
    }
    return (
      (counts.HEADLINE ?? 0) >= 3 &&
      (counts.LONG_HEADLINE ?? 0) >= 1 &&
      (counts.DESCRIPTION ?? 0) >= 2 &&
      (counts.MARKETING_IMAGE ?? 0) >= 1 &&
      (counts.SQUARE_MARKETING_IMAGE ?? 0) >= 1
    );
  }
  if (boundedRemovals.includes(action)) {
    if (
      plan.irreversible !== true ||
      !qrsPmaxIntentAllowed(config, TEST_ACCOUNT, intent)
    )
      return false;
    if (action === "pmax_negative_remove" || action === "pmax_brand_remove") {
      const resource = `${prefix}/campaignCriteria/${config.qrsTestPmaxParentCampaignId}~${config.qrsTestPmaxCriterionId}`;
      return (
        operations.length === 1 &&
        op.kind === "campaignCriteria" &&
        op.method === "remove" &&
        op.resource_name === resource &&
        op.update_mask === null &&
        Object.keys(fields).length === 0 &&
        before.resourceName === resource &&
        before.campaign === parent &&
        before.negative === true &&
        checks.some((row) => {
          const observed = object(object(row).campaignCriterion);
          return (
            observed.resourceName === resource &&
            observed.campaign === parent &&
            observed.negative === true &&
            (action === "pmax_negative_remove"
              ? object(observed.keyword).text ===
                  config.qrsTestPmaxNegativeText &&
                object(observed.keyword).matchType === "EXACT"
              : object(observed.brandList).sharedSet ===
                `${prefix}/sharedSets/${config.qrsTestPmaxBrandSharedSetId}`)
          );
        }) &&
        (action === "pmax_negative_remove"
          ? object(before.keyword).text === config.qrsTestPmaxNegativeText &&
            object(before.keyword).matchType === "EXACT"
          : object(before.brandList).sharedSet ===
            `${prefix}/sharedSets/${config.qrsTestPmaxBrandSharedSetId}`)
      );
    }
    const campaignLevel = action.startsWith("pmax_campaign_asset_");
    if (!campaignLevel && !pausedGroup) return false;
    const kind = campaignLevel ? "campaignAssets" : "assetGroupAssets";
    const parentKey = campaignLevel ? "campaign" : "assetGroup";
    const linkedParent = campaignLevel ? parent : group;
    const removeOps = operations.filter(
      (candidate) => candidate.kind === kind && candidate.method === "remove",
    );
    const remove = removeOps[0];
    const removedBefore = object(remove?.before);
    const old = `${prefix}/assets/${config.qrsTestPmaxAssetId}`;
    if (
      removeOps.length !== 1 ||
      !remove ||
      !String(remove.resource_name).startsWith(`${prefix}/${kind}/`) ||
      remove.resource_name !== removedBefore.resourceName ||
      remove.update_mask !== null ||
      Object.keys(object(remove.fields)).length !== 0 ||
      removedBefore[parentKey] !== linkedParent ||
      removedBefore.asset !== old ||
      removedBefore.fieldType !== config.qrsTestPmaxAssetFieldType ||
      !["PAUSED", "ENABLED"].includes(String(removedBefore.status)) ||
      !checks.some((row) => {
        const observed = object(
          object(row)[campaignLevel ? "campaignAsset" : "assetGroupAsset"],
        );
        return (
          observed.resourceName === remove.resource_name &&
          observed[parentKey] === linkedParent &&
          observed.asset === old &&
          observed.fieldType === config.qrsTestPmaxAssetFieldType &&
          observed.status === removedBefore.status
        );
      })
    )
      return false;
    if (action.endsWith("_detach")) return operations.length === 1;
    const linkOps = operations.filter(
      (candidate) => candidate.kind === kind && candidate.method === "create",
    );
    const link = linkOps[0];
    const linkFields = object(link?.fields);
    if (
      linkOps.length !== 1 ||
      !link ||
      link.resource_name !== null ||
      link.before !== null ||
      link.update_mask !== null ||
      linkFields[parentKey] !== linkedParent ||
      linkFields.fieldType !== config.qrsTestPmaxAssetFieldType ||
      linkFields.status !== removedBefore.status ||
      Object.keys(linkFields).sort().join(",") !==
        [parentKey, "asset", "fieldType", "status"].sort().join(",")
    )
      return false;
    const role = config.qrsTestPmaxAssetFieldType;
    const textRole = [
      "HEADLINE",
      "LONG_HEADLINE",
      "DESCRIPTION",
      "BUSINESS_NAME",
    ].includes(String(role));
    if (!textRole)
      return (
        operations.length === 2 &&
        linkFields.asset ===
          `${prefix}/assets/${config.qrsTestPmaxReplacementAssetId}` &&
        checks.some((row) => {
          const asset = object(object(row).asset);
          return (
            asset.resourceName === linkFields.asset && asset.type === "IMAGE"
          );
        })
      );
    const created = operations.filter(
      (candidate) =>
        candidate.kind === "assets" && candidate.method === "create",
    );
    const asset = created[0];
    const assetFields = object(asset?.fields);
    return (
      operations.length === 3 &&
      created.length === 1 &&
      Boolean(asset) &&
      /^customers\/8590146099\/assets\/-[1-9][0-9]*$/.test(
        String(asset?.resource_name),
      ) &&
      asset?.before === null &&
      asset?.update_mask === null &&
      assetFields.resourceName === asset?.resource_name &&
      object(assetFields.textAsset).text ===
        config.qrsTestPmaxReplacementText &&
      object(object(asset?.expected).textAsset).text ===
        config.qrsTestPmaxReplacementText &&
      object(asset?.expected).type === "TEXT" &&
      linkFields.asset === asset?.resource_name
    );
  }
  if (intent.action === "pmax_negative_add")
    return (
      typeof config.qrsTestPmaxNegativeText === "string" &&
      item.text === config.qrsTestPmaxNegativeText &&
      item.match_type === "EXACT" &&
      Object.keys(item).sort().join(",") === "campaign_id,match_type,text" &&
      op.kind === "campaignCriteria" &&
      op.method === "create" &&
      op.resource_name === null &&
      op.before === null &&
      op.update_mask === null &&
      fields.campaign === parent &&
      fields.negative === true &&
      object(fields.keyword).text === config.qrsTestPmaxNegativeText &&
      object(fields.keyword).matchType === "EXACT" &&
      Object.keys(fields).sort().join(",") === "campaign,keyword,negative"
    );
  if (intent.action === "pmax_brand_exclude")
    return (
      typeof config.qrsTestPmaxBrandSharedSetId === "string" &&
      item.shared_set_id === config.qrsTestPmaxBrandSharedSetId &&
      Object.keys(item).sort().join(",") === "campaign_id,shared_set_id" &&
      op.kind === "campaignCriteria" &&
      op.method === "create" &&
      op.resource_name === null &&
      op.before === null &&
      op.update_mask === null &&
      fields.campaign === parent &&
      fields.negative === true &&
      object(fields.brandList).sharedSet ===
        `${prefix}/sharedSets/${config.qrsTestPmaxBrandSharedSetId}` &&
      Object.keys(fields).sort().join(",") === "brandList,campaign,negative"
    );
  if (
    !pausedGroup ||
    item.asset_group_id !== config.qrsTestPmaxParentAssetGroupId
  )
    return false;
  if (intent.action === "pmax_audience_signal_add")
    return (
      typeof config.qrsTestPmaxAudienceId === "string" &&
      item.audience_id === config.qrsTestPmaxAudienceId &&
      Object.keys(item).sort().join(",") ===
        "asset_group_id,audience_id,campaign_id" &&
      op.kind === "assetGroupSignals" &&
      op.method === "create" &&
      op.resource_name === null &&
      op.before === null &&
      op.update_mask === null &&
      fields.assetGroup === group &&
      object(fields.audience).audience ===
        `${prefix}/audiences/${config.qrsTestPmaxAudienceId}` &&
      Object.keys(fields).sort().join(",") === "assetGroup,audience"
    );
  if (intent.action === "pmax_asset_attach")
    return (
      typeof config.qrsTestPmaxAssetId === "string" &&
      item.asset_id === config.qrsTestPmaxAssetId &&
      [
        "HEADLINE",
        "LONG_HEADLINE",
        "DESCRIPTION",
        "MARKETING_IMAGE",
        "SQUARE_MARKETING_IMAGE",
      ].includes(String(item.field_type)) &&
      Object.keys(item).sort().join(",") ===
        "asset_group_id,asset_id,campaign_id,field_type" &&
      op.kind === "assetGroupAssets" &&
      op.method === "create" &&
      op.resource_name === null &&
      op.before === null &&
      op.update_mask === null &&
      fields.assetGroup === group &&
      fields.asset === `${prefix}/assets/${config.qrsTestPmaxAssetId}` &&
      checks.some(
        (row) => object(object(row).asset).resourceName === fields.asset,
      ) &&
      fields.fieldType === item.field_type &&
      fields.status === "PAUSED" &&
      Object.keys(fields).sort().join(",") ===
        "asset,assetGroup,fieldType,status"
    );
  if (intent.action === "pmax_search_theme_add")
    return (
      item.asset_group_id === config.qrsTestPmaxParentAssetGroupId &&
      item.search_theme === config.qrsTestPmaxSearchTheme &&
      Object.keys(item).sort().join(",") ===
        "asset_group_id,campaign_id,search_theme" &&
      op.kind === "assetGroupSignals" &&
      op.method === "create" &&
      op.resource_name === null &&
      op.before === null &&
      op.update_mask === null &&
      fields.assetGroup === group &&
      object(fields.searchTheme).text === config.qrsTestPmaxSearchTheme &&
      Object.keys(fields).sort().join(",") === "assetGroup,searchTheme"
    );
  if (intent.action === "pmax_signal_remove")
    return (
      item.asset_group_id === config.qrsTestPmaxParentAssetGroupId &&
      item.acknowledge_irreversible === true &&
      typeof item.signal_id === "string" &&
      /^[1-9][0-9]{0,19}$/.test(item.signal_id) &&
      Object.keys(item).sort().join(",") ===
        "acknowledge_irreversible,asset_group_id,campaign_id,signal_id" &&
      op.kind === "assetGroupSignals" &&
      op.method === "remove" &&
      op.resource_name ===
        `${prefix}/assetGroupSignals/${item.asset_group_id}~${item.signal_id}` &&
      op.update_mask === null &&
      Object.keys(fields).length === 0 &&
      before.resourceName === op.resource_name &&
      before.assetGroup === group &&
      checks.some(
        (row) =>
          object(object(row).assetGroupSignal).resourceName ===
          op.resource_name,
      ) &&
      ((Boolean(config.qrsTestPmaxSearchTheme) &&
        object(before.searchTheme).text === config.qrsTestPmaxSearchTheme) ||
        (Boolean(config.qrsTestPmaxAudienceId) &&
          object(before.audience).audience ===
            `${prefix}/audiences/${config.qrsTestPmaxAudienceId}`)) &&
      plan.irreversible === true
    );
  return (
    Object.keys(item).sort().join(",") === "asset_group_id,campaign_id,name" &&
    op.kind === "assetGroups" &&
    op.method === "update" &&
    op.resource_name === group &&
    op.update_mask === "name" &&
    before.resourceName === group &&
    before.campaign === parent &&
    before.status === "PAUSED" &&
    fields.resourceName === group &&
    fields.name === item.name &&
    Object.keys(fields).sort().join(",") === "name,resourceName" &&
    expected.status === "PAUSED"
  );
}

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
    return (
      Object.keys(item).length === 1 &&
      typeof config.qrsTestPmaxCampaignName === "string" &&
      brief.campaign_name === config.qrsTestPmaxCampaignName &&
      brief.brand_guidelines_enabled !== false
    );
  }
  if (
    typeof config.qrsTestPmaxParentCampaignId !== "string" ||
    item.campaign_id !== config.qrsTestPmaxParentCampaignId ||
    (typeof config.qrsTestPmaxParentAssetGroupId !== "string" &&
      !["pmax_negative_add", "pmax_brand_exclude"].includes(
        String(intent.action),
      ))
  )
    return false;
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
      [
        "HEADLINE",
        "LONG_HEADLINE",
        "DESCRIPTION",
        "MARKETING_IMAGE",
        "SQUARE_MARKETING_IMAGE",
      ].includes(String(item.field_type)) &&
      Object.keys(item).sort().join(",") ===
        "asset_group_id,asset_id,campaign_id,field_type"
    );
  if (
    item.asset_group_id !== config.qrsTestPmaxParentAssetGroupId ||
    !config.qrsTestPmaxSearchTheme
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
      groups.length < 1 ||
      campaign?.method !== "create" ||
      budget?.method !== "create" ||
      !/^customers\/8590146099\/campaigns\/-[1-9][0-9]*$/.test(
        String(campaignResource),
      ) ||
      campaignFields.name !== config.qrsTestPmaxCampaignName ||
      campaignFields.status !== "PAUSED" ||
      campaignFields.advertisingChannelType !== "PERFORMANCE_MAX" ||
      campaignFields.brandGuidelinesEnabled !== true ||
      campaignFields.campaignBudget !== budget?.resource_name ||
      budgetFields.explicitlyShared !== false ||
      !/^[1-9][0-9]*$/.test(String(budgetFields.amountMicros)) ||
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
    ].includes(String(intent.action))
  )
    return false;
  const items = intent.items;
  if (!Array.isArray(items) || items.length !== 1) return false;
  const item = object(items[0]);
  if (
    !config.qrsTestPmaxParentCampaignId ||
    item.campaign_id !== config.qrsTestPmaxParentCampaignId ||
    operations.length !== 1
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
      object(before.searchTheme).text === config.qrsTestPmaxSearchTheme &&
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

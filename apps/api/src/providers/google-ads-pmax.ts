import { validateBriefSchema } from "../mcp/mcp-google-stage0-schema.js";
import {
  resolveGoogleMoneyUnit,
  quantizePositiveMicros,
  moneyUnitWarnings,
} from "./google-ads-money.js";
import {
  pmaxBriefSchema,
  pmaxAssetGroupSchema,
} from "../mcp/mcp-google-stage4-schema.js";
import {
  validateText,
  validateTracking,
  validateDate,
} from "./google-ads-stage0.js";
import {
  currencyMicros,
  finalUrl,
  parseStage1Intent,
  keywordCreateFields,
  canonical,
  type Stage1Reader,
} from "./google-ads-stage1.js";
import {
  extClosed,
  extContext,
  extFail,
  extId,
  extItem,
  extOwner,
  extQuote,
  extRow,
  assertExtendedPlan,
  type ExtendedPlan,
  type ExtendedOperation,
  type ExtendedKind,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";
import {
  GOOGLE_MEDIA_LIMITS,
  validateInlineMedia,
  mediaMetadata,
  type ValidatedGoogleMedia,
} from "./google-ads-media.js";

const rows = (v: unknown) => (Array.isArray(v) ? v.map(extRow) : []);
export const PMAX_ASSET_FIELDS =
  "asset.resource_name, asset.type, asset.text_asset.text, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels, asset.image_asset.file_size, asset.image_asset.mime_type";
const CAMPAIGN_FIELDS =
  "campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.start_date_time, campaign.end_date_time, campaign.advertising_channel_type, campaign.campaign_budget, campaign.brand_guidelines_enabled, campaign.bidding_strategy_type, campaign.maximize_conversions.target_cpa_micros, campaign.maximize_conversion_value.target_roas, campaign.geo_target_type_setting.positive_geo_target_type, campaign.geo_target_type_setting.negative_geo_target_type, campaign.final_url_suffix, campaign.tracking_url_template, campaign.contains_eu_political_advertising";
export const PMAX_LINK_FIELDS =
  "asset_group_asset.resource_name, asset_group_asset.asset_group, asset_group_asset.asset, asset_group_asset.field_type, asset_group_asset.status";
const GROUP_FIELDS =
  "asset_group.resource_name, asset_group.id, asset_group.campaign, asset_group.name, asset_group.status, asset_group.final_urls, asset_group.path1, asset_group.path2";
const BRAND_LINK_FIELDS =
  "campaign_asset.resource_name, campaign_asset.campaign, campaign_asset.asset, campaign_asset.field_type, campaign_asset.status, " +
  PMAX_ASSET_FIELDS;
const CRITERIA_FIELDS =
  "campaign_criterion.resource_name, campaign_criterion.campaign, campaign_criterion.status, campaign_criterion.negative, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.brand_list.shared_set, campaign_criterion.location.geo_target_constant, campaign_criterion.language.language_constant";
export const PMAX_ASSET_LIMITS: Record<
  string,
  { min: number; max: number; type: "TEXT" | "IMAGE"; length?: number }
> = {
  HEADLINE: { min: 3, max: 15, type: "TEXT", length: 30 },
  LONG_HEADLINE: { min: 1, max: 5, type: "TEXT", length: 90 },
  DESCRIPTION: { min: 2, max: 5, type: "TEXT", length: 90 },
  MARKETING_IMAGE: { min: 1, max: 20, type: "IMAGE" },
  SQUARE_MARKETING_IMAGE: { min: 1, max: 20, type: "IMAGE" },
  LOGO: { min: 1, max: 5, type: "IMAGE" },
  BUSINESS_NAME: { min: 1, max: 1, type: "TEXT", length: 25 },
};
function landing(v: unknown) {
  const url = finalUrl(v);
  if (!url) extFail("google_pmax_url_invalid", "PMax final URL обязателен.");
  const host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    /^(?:0\.|127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|(?:22[4-9]|23\d)\.)/.test(
      host,
    ) ||
    host === "localhost" ||
    host === "::" ||
    host === "::1" ||
    /^f[cd]|^fe[89ab]|^::ffff:/i.test(host) ||
    !host.includes(".") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  )
    extFail(
      "google_pmax_url_invalid",
      "PMax landing должен быть публичным; network probe не выполняется.",
    );
  return url;
}
function identity(prefix: string, kind: string, id: unknown) {
  return prefix + "/" + kind + "/" + extId(id);
}
function imageCheck(
  role: string,
  width: number,
  height: number,
  bytes: number,
  mime?: string,
) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096 ||
    width * height > GOOGLE_MEDIA_LIMITS.pixels ||
    !Number.isFinite(bytes) ||
    bytes < 1 ||
    bytes > 5 * 1024 * 1024
  )
    extFail(
      "google_pmax_image_invalid",
      "IMAGE dimensions/actual size не подтверждены безопасным profile.",
    );
  if (mime && !["PNG", "JPEG", "image/png", "image/jpeg"].includes(mime))
    extFail(
      "google_pmax_image_invalid",
      "Поддерживаются реальные PNG/JPEG, не GIF/SVG/animated media.",
    );
  if (
    ["LOGO", "SQUARE_MARKETING_IMAGE"].includes(role) &&
    (width !== height || width < (role === "LOGO" ? 128 : 300))
  )
    extFail(
      "google_pmax_image_invalid",
      "LOGO/square image требует квадрат и minimum128/300 pixels.",
    );
  if (
    role === "MARKETING_IMAGE" &&
    (width < 600 || height < 314 || Math.abs(width / height - 1.91) > 0.02)
  )
    extFail(
      "google_pmax_image_invalid",
      "Landscape image требует >=600x314 и 1.91:1; exact provider ratio дополнительно проверяет Google.",
    );
  if (
    role === "AD_IMAGE" &&
    !(
      (width === height && width >= 300) ||
      (width >= 600 && height >= 314 && Math.abs(width / height - 1.91) <= 0.02)
    )
  )
    extFail(
      "google_media_image_invalid",
      "AD_IMAGE требует >=300 square или >=600x314 1.91:1 landscape.",
    );
}
function brandComposition(
  links: ExtendedRow[],
  account: string,
  campaign: string,
  excluded: Set<string>,
  pending: ExtendedRow[] = [],
) {
  const counts: Record<string, number> = {};
  for (const row of links) {
    const link = extRow(row.campaignAsset),
      asset = extRow(row.asset);
    extOwner(link.resourceName, account, "campaignAssets");
    extOwner(link.asset, account, "assets");
    if (link.campaign !== campaign || link.asset !== asset.resourceName)
      extFail(
        "google_pmax_brand_proof_invalid",
        "Brand link/asset ownership and campaign relation not proven.",
      );
    if (excluded.has(String(link.resourceName)) || link.status !== "ENABLED")
      continue;
    if (link.fieldType === "LOGO") {
      if (asset.type !== "IMAGE")
        extFail(
          "google_pmax_brand_proof_invalid",
          "Logo должен быть реальным IMAGE.",
        );
      const image = extRow(asset.imageAsset),
        size = extRow(image.fullSize);
      imageCheck(
        "LOGO",
        Number(size.widthPixels),
        Number(size.heightPixels),
        Number(image.fileSize),
        String(image.mimeType),
      );
    } else if (link.fieldType === "BUSINESS_NAME") {
      if (asset.type !== "TEXT")
        extFail(
          "google_pmax_brand_proof_invalid",
          "Business name должен быть реальным TEXT.",
        );
      validateText(
        String(extRow(asset.textAsset).text ?? ""),
        25,
        "Business name",
      );
    } else continue;
    counts[String(link.fieldType)] = (counts[String(link.fieldType)] ?? 0) + 1;
  }
  for (const f of pending.filter(
    (p) => p.campaign === campaign && p.status === "ENABLED",
  ))
    counts[String(f.fieldType)] = (counts[String(f.fieldType)] ?? 0) + 1;
  if (
    (counts.LOGO ?? 0) < 1 ||
    (counts.LOGO ?? 0) > 5 ||
    (counts.BUSINESS_NAME ?? 0) !== 1
  )
    extFail(
      "google_pmax_minimum_assets",
      "Campaign branding requires 1–5 verified LOGO and exactly one BUSINESS_NAME; removal cannot violate minimum.",
    );
}
function validatePmaxGroup(g: ExtendedRow) {
  validateBriefSchema(g, pmaxAssetGroupSchema, "asset_group");
  landing(g.final_url);
  validateText(String(g.name).trim(), 128, "Asset group name");
  for (const [field, length] of [
    ["headlines", 30],
    ["long_headlines", 90],
    ["descriptions", 90],
  ] as const) {
    const texts = g[field] as string[];
    for (const text of texts) validateText(text, length, "PMax " + field);
    if (
      new Set(texts.map((t) => t.normalize("NFC").trim().toLowerCase()))
        .size !== texts.length
    )
      extFail("google_pmax_duplicate", "Duplicate text assets in field.");
  }
  if (g.path2 && !g.path1)
    extFail("google_ad_path_invalid", "path2 требует path1.");
  for (const p of ["path1", "path2"])
    if (g[p]) validateText(String(g[p]), 15, p);
  for (const role of ["MARKETING_IMAGE", "SQUARE_MARKETING_IMAGE"]) {
    const count = rows(g.images).filter((i) => i.field_type === role).length;
    if (count < 1 || count > 20)
      extFail(
        "google_pmax_minimum_assets",
        "Required 1–20 landscape AND square images.",
      );
  }
  const audiences = (g.audience_ids ?? []) as string[],
    themes = (g.search_themes ?? []) as string[];
  if (
    new Set(audiences).size !== audiences.length ||
    new Set(themes.map((t) => t.normalize("NFC").trim().toLowerCase())).size !==
      themes.length
  )
    extFail(
      "google_pmax_duplicate",
      "Duplicate audience IDs/search themes are rejected before provider reads.",
    );
  for (const theme of themes) validateText(theme, 80, "Search theme");
}
export function preflightPmaxBrief(raw: unknown) {
  validateBriefSchema(raw, pmaxBriefSchema, "pmax_brief");
  const b = structuredClone(raw) as ExtendedRow,
    groupNames = new Set<string>();
  validateText(String(b.campaign_name).trim(), 255, "Campaign name");
  validateText(String(b.business_name), 25, "Business name");
  validateDate(b.start_date);
  validateDate(b.end_date);
  if (b.start_date && b.end_date && String(b.end_date) < String(b.start_date))
    extFail("google_date_invalid", "Конец кампании раньше начала.");
  if (
    new Set(rows(b.locations).map((l) => String(l.geo_target_id))).size !==
    rows(b.locations).length
  )
    extFail(
      "google_pmax_duplicate",
      "Geo ID не может повторяться, в том числе include/exclude.",
    );
  let byteTotal = 0,
    files = 0;
  const mediaValues = [
    ...rows(b.logos),
    ...rows(b.asset_groups).flatMap((g) =>
      rows(g.images).map((i) => extRow(i.media)),
    ),
  ];
  for (const media of mediaValues) {
    const m = extClosed(media, ["asset_id", "mime_type", "data_base64"]);
    if (m.asset_id !== undefined) {
      extId(m.asset_id);
      if (Object.keys(m).length !== 1)
        extFail(
          "google_media_source_invalid",
          "Выберите только existing asset_id ИЛИ inline media.",
        );
    } else {
      if (!m.mime_type || typeof m.data_base64 !== "string")
        extFail(
          "google_media_source_invalid",
          "Inline требует mime_type/data_base64.",
        );
      byteTotal += Math.floor((m.data_base64.length * 3) / 4);
      files++;
    }
  }
  if (
    files > GOOGLE_MEDIA_LIMITS.files ||
    byteTotal > GOOGLE_MEDIA_LIMITS.aggregateBytes
  )
    extFail(
      "google_media_request_limit",
      "Local media profile: <=8 файлов и <=2 MiB aggregate decoded bytes; existing account references не ограничены этим byte quota.",
    );
  if (
    new Set(b.conversion_actions as string[]).size !==
    (b.conversion_actions as string[]).length
  )
    extFail(
      "google_conversion_invalid",
      "Повторяющиеся conversion action IDs.",
    );
  if (
    new Set(b.languages as string[]).size !== (b.languages as string[]).length
  )
    extFail("google_pmax_duplicate", "Повторяющиеся languages.");
  const strategy = String(b.bidding_strategy ?? "MAXIMIZE_CONVERSIONS");
  if (
    b.target_roas !== undefined &&
    (!Number.isFinite(b.target_roas) ||
      Number(b.target_roas) < 0.01 ||
      Number(b.target_roas) > 1000)
  )
    extFail(
      "google_pmax_strategy_invalid",
      "ROAS ratio требуется finite 0.01–1000.",
    );
  if (
    (strategy === "MAXIMIZE_CONVERSIONS" && b.target_roas !== undefined) ||
    (strategy === "MAXIMIZE_CONVERSION_VALUE" && b.target_cpa !== undefined)
  )
    extFail(
      "google_pmax_strategy_invalid",
      "Target CPA/ROAS не соответствует выбранной стратегии.",
    );
  for (const g of rows(b.asset_groups)) {
    const name = String(g.name).trim().toLowerCase();
    if (groupNames.has(name))
      extFail(
        "google_pmax_duplicate",
        "Имена asset groups должны быть уникальны.",
      );
    groupNames.add(name);
    validatePmaxGroup(g);
  }
  return b;
}

function checkMediaQuota(values: unknown[]) {
  let bytes = 0,
    files = 0;
  for (const raw of values) {
    const m = extClosed(raw, ["asset_id", "mime_type", "data_base64"]);
    if (m.asset_id !== undefined) {
      extId(m.asset_id);
      if (Object.keys(m).length !== 1)
        extFail(
          "google_media_source_invalid",
          "Existing reference excludes inline data.",
        );
    } else {
      if (
        typeof m.data_base64 !== "string" ||
        m.data_base64.length > Math.ceil(GOOGLE_MEDIA_LIMITS.bytes / 3) * 4
      )
        extFail(
          "google_media_request_limit",
          "Inline media exceeds safe local profile.",
        );
      bytes += Math.floor((m.data_base64.length * 3) / 4);
      files++;
    }
  }
  if (
    files > GOOGLE_MEDIA_LIMITS.files ||
    bytes > GOOGLE_MEDIA_LIMITS.aggregateBytes
  )
    extFail(
      "google_media_request_limit",
      "Local aggregate <=2MiB decoded, <=8 files required before provider reads.",
    );
}
type Context = Awaited<ReturnType<typeof extContext>>;
type Add = (
  kind: ExtendedKind,
  method: ExtendedOperation["method"],
  resource: string | null,
  fields: ExtendedRow,
  before: ExtendedRow | null,
  expected: ExtendedRow,
  query: string,
  key: string,
  mask?: string | null,
) => void;
async function mediaResolver(
  ctx: Context,
  prefix: string,
  temp: (kind: string) => string,
  add: Add,
) {
  const summaries: ExtendedRow[] = [],
    cache = new Map<string, { resource: string; asset: ExtendedRow }>();
  let normalizedBytes = 0;
  return {
    summaries,
    resolve: async (raw: unknown, role: string) => {
      const m = extClosed(raw, ["asset_id", "mime_type", "data_base64"]),
        cacheKey = canonical(m);
      let resolved = cache.get(cacheKey);
      if (!resolved) {
        if (m.asset_id !== undefined) {
          if (Object.keys(m).length !== 1)
            extFail(
              "google_media_source_invalid",
              "Existing asset_id исключает inline поля.",
            );
          const resource = identity(prefix, "assets", m.asset_id),
            q =
              "SELECT " +
              PMAX_ASSET_FIELDS +
              " FROM asset WHERE asset.resource_name = " +
              extQuote(resource),
            found = await ctx.query(q),
            asset = extRow(found[0]?.asset);
          if (
            found.length !== 1 ||
            asset.resourceName !== resource ||
            asset.type !== "IMAGE"
          )
            extFail(
              "google_pmax_image_unavailable",
              "Existing IMAGE asset не принадлежит выбранному account.",
            );
          extOwner(asset.resourceName, ctx.account_id, "assets");
          resolved = { resource, asset };
          summaries.push({
            existing_resource: resource,
            ...extRow(extRow(asset.imageAsset).fullSize),
          });
        } else {
          const decoded: ValidatedGoogleMedia = await validateInlineMedia(m);
          normalizedBytes += decoded.byte_length;
          if (normalizedBytes > GOOGLE_MEDIA_LIMITS.aggregateBytes)
            extFail(
              "google_media_request_limit",
              "Normalized aggregate images exceed local2MiB limit.",
            );
          const resource = temp("assets"),
            fields = {
              resourceName: resource,
              imageAsset: { data: decoded.data_base64 },
            },
            asset = {
              resourceName: resource,
              type: "IMAGE",
              imageAsset: {
                fullSize: {
                  widthPixels: decoded.width,
                  heightPixels: decoded.height,
                },
                fileSize: String(decoded.byte_length),
                mimeType: decoded.mime_type === "image/png" ? "PNG" : "JPEG",
              },
            };
          add(
            "assets",
            "create",
            resource,
            fields,
            null,
            { type: "IMAGE", imageAsset: asset.imageAsset },
            "SELECT " +
              PMAX_ASSET_FIELDS +
              " FROM asset WHERE asset.resource_name = " +
              extQuote(resource),
            "asset",
          );
          resolved = { resource, asset };
          summaries.push({
            temporary_resource: resource,
            ...mediaMetadata(decoded),
          });
        }
        cache.set(cacheKey, resolved);
      }
      const image = extRow(resolved.asset.imageAsset),
        size = extRow(image.fullSize);
      imageCheck(
        role,
        Number(size.widthPixels),
        Number(size.heightPixels),
        Number(image.fileSize),
        String(image.mimeType),
      );
      return resolved.resource;
    },
  };
}
async function appendCompleteGroups(
  ctx: Context,
  prefix: string,
  campaign: string,
  groups: ExtendedRow[],
  brand: boolean,
  business: string | null,
  logos: string[],
  temp: (kind: string) => string,
  add: Add,
  media: Awaited<ReturnType<typeof mediaResolver>>,
) {
  const resources: string[] = [];
  const createText = (text: string) => {
    const resource = temp("assets");
    add(
      "assets",
      "create",
      resource,
      { resourceName: resource, textAsset: { text } },
      null,
      { type: "TEXT", textAsset: { text } },
      "SELECT " +
        PMAX_ASSET_FIELDS +
        " FROM asset WHERE asset.resource_name = " +
        extQuote(resource),
      "asset",
    );
    return resource;
  };
  for (const group of groups) {
    const resource = temp("assetGroups"),
      fields = {
        resourceName: resource,
        campaign,
        name: String(group.name).trim(),
        status: "PAUSED",
        finalUrls: [landing(group.final_url)],
        ...(group.path1 ? { path1: group.path1 } : {}),
        ...(group.path2 ? { path2: group.path2 } : {}),
      };
    add(
      "assetGroups",
      "create",
      resource,
      fields,
      null,
      fields,
      "SELECT " +
        GROUP_FIELDS +
        " FROM asset_group WHERE asset_group.resource_name = " +
        extQuote(resource),
      "assetGroup",
    );
    resources.push(resource);
    const link = (asset: string, fieldType: string) => {
      const fields = {
        assetGroup: resource,
        asset,
        fieldType,
        status: "ENABLED",
      };
      add(
        "assetGroupAssets",
        "create",
        null,
        fields,
        null,
        fields,
        "SELECT " +
          PMAX_LINK_FIELDS +
          " FROM asset_group_asset WHERE asset_group_asset.asset_group = " +
          extQuote(resource) +
          " AND asset_group_asset.status != REMOVED",
        "assetGroupAsset",
      );
    };
    for (const [property, field] of [
      ["headlines", "HEADLINE"],
      ["long_headlines", "LONG_HEADLINE"],
      ["descriptions", "DESCRIPTION"],
    ])
      for (const text of group[property!] as string[])
        link(createText(text), field!);
    for (const image of rows(group.images))
      link(
        await media.resolve(image.media, String(image.field_type)),
        String(image.field_type),
      );
    if (!brand) {
      if (!business || !logos.length)
        extFail(
          "google_pmax_minimum_assets",
          "Disabled branding requires group business/logo, not inherited campaign assets.",
        );
      link(business, "BUSINESS_NAME");
      for (const logo of logos) link(logo, "LOGO");
    }
    for (const audienceID of (group.audience_ids ?? []) as string[]) {
      const audience = identity(prefix, "audiences", audienceID),
        found = await ctx.query(
          "SELECT audience.resource_name, audience.status FROM audience WHERE audience.resource_name = " +
            extQuote(audience),
        );
      if (
        found.length !== 1 ||
        extRow(found[0]?.audience).resourceName !== audience ||
        extRow(found[0]?.audience).status !== "ENABLED"
      )
        extFail(
          "google_pmax_audience_invalid",
          "Existing audience not ENABLED/owned.",
        );
      const fields = { assetGroup: resource, audience: { audience } };
      add(
        "assetGroupSignals",
        "create",
        null,
        fields,
        null,
        fields,
        "SELECT asset_group_signal.resource_name, asset_group_signal.asset_group, asset_group_signal.audience.audience, asset_group_signal.search_theme.text FROM asset_group_signal WHERE asset_group_signal.asset_group = " +
          extQuote(resource),
        "assetGroupSignal",
      );
    }
    for (const text of (group.search_themes ?? []) as string[]) {
      const fields = { assetGroup: resource, searchTheme: { text } };
      add(
        "assetGroupSignals",
        "create",
        null,
        fields,
        null,
        fields,
        "SELECT asset_group_signal.resource_name, asset_group_signal.asset_group, asset_group_signal.audience.audience, asset_group_signal.search_theme.text FROM asset_group_signal WHERE asset_group_signal.asset_group = " +
          extQuote(resource),
        "assetGroupSignal",
      );
    }
  }
  return resources;
}

export async function buildPmaxAssetGroupPlan(
  account: string,
  intent: ExtendedRow & { action: string; items: ExtendedRow[] },
  read: Stage1Reader,
): Promise<ExtendedPlan> {
  for (const row of intent.items) {
    extClosed(
      row,
      ["campaign_id", "asset_group", "business_name", "logos"],
      ["campaign_id", "asset_group"],
    );
    validatePmaxGroup(extRow(row.asset_group));
    if (row.business_name !== undefined)
      validateText(String(row.business_name), 25, "Business name");
  }
  checkMediaQuota(
    intent.items.flatMap((r) => [
      ...rows(r.logos),
      ...rows(extRow(r.asset_group).images).map((i) => i.media),
    ]),
  );
  const ctx = await extContext(account, read),
    prefix = "customers/" + ctx.account_id,
    operations: ExtendedOperation[] = [],
    items: ExtendedPlan["items"] = [],
    mediaSummary: ExtendedRow[] = [],
    names = new Set<string>();
  let sequence = 0;
  const temp = (kind: string) => prefix + "/" + kind + "/" + --sequence;
  for (const [index, row] of intent.items.entries()) {
    const campaign = identity(prefix, "campaigns", row.campaign_id),
      cRows = await ctx.query(
        "SELECT " +
          CAMPAIGN_FIELDS +
          " FROM campaign WHERE campaign.resource_name = " +
          extQuote(campaign) +
          " AND campaign.status != REMOVED",
      ),
      c = extRow(cRows[0]?.campaign);
    if (
      cRows.length !== 1 ||
      c.resourceName !== campaign ||
      c.advertisingChannelType !== "PERFORMANCE_MAX" ||
      c.status !== "PAUSED" ||
      typeof c.brandGuidelinesEnabled !== "boolean"
    )
      extFail(
        "google_pmax_campaign_unavailable",
        "Новая полная группа требует proven owned PAUSED PMax parent and explicit brand mode.",
      );
    const group = extRow(row.asset_group),
      name = String(group.name).normalize("NFC").trim().toLowerCase(),
      key = campaign + ":" + name,
      inventoryQuery =
        "SELECT " +
        GROUP_FIELDS +
        " FROM asset_group WHERE asset_group.campaign = " +
        extQuote(campaign) +
        " AND asset_group.status != REMOVED",
      inventory = await ctx.query(inventoryQuery);
    for (const r of inventory) {
      const g = extRow(r.assetGroup);
      extOwner(g.resourceName, ctx.account_id, "assetGroups");
      if (g.campaign !== campaign)
        extFail(
          "google_pmax_group_unavailable",
          "Group inventory contains foreign parent.",
        );
    }
    if (
      names.has(key) ||
      inventory.some(
        (r) =>
          String(extRow(r.assetGroup).name)
            .normalize("NFC")
            .trim()
            .toLowerCase() === name,
      )
    )
      extFail(
        "google_pmax_duplicate",
        "Asset group name exists/planned; whole atomic graph rejected.",
      );
    names.add(key);
    const item = extItem(
      index,
      "PMax complete asset group",
      String(row.campaign_id),
    );
    items.push(item);
    const add: Add = (
      kind,
      method,
      resource,
      fields,
      before,
      expected,
      query,
      response_key,
      update_mask = null,
    ) => {
      item.provider_operations.push(operations.length);
      operations.push({
        kind,
        method,
        resource_name: resource,
        fields,
        before,
        expected,
        read_query: query,
        response_key,
        update_mask,
        row: index,
      });
    };
    const media = await mediaResolver(ctx, prefix, temp, add),
      logos: string[] = [];
    let business: string | null = null;
    if (c.brandGuidelinesEnabled) {
      if (row.business_name !== undefined || row.logos !== undefined)
        extFail(
          "google_pmax_brand_level_invalid",
          "Enabled branding uses existing campaign LOGO/BUSINESS_NAME; new group cannot silently override branding.",
        );
      const brandRows = await ctx.query(
        "SELECT " +
          BRAND_LINK_FIELDS +
          " FROM campaign_asset WHERE campaign_asset.campaign = " +
          extQuote(campaign) +
          " AND campaign_asset.status != REMOVED",
      );
      brandComposition(brandRows, ctx.account_id, campaign, new Set());
    } else {
      if (
        typeof row.business_name !== "string" ||
        !rows(row.logos).length ||
        rows(row.logos).length > 5
      )
        extFail(
          "google_pmax_minimum_assets",
          "Disabled branding requires explicit business_name and1–5logos.",
        );
      business = temp("assets");
      add(
        "assets",
        "create",
        business,
        { resourceName: business, textAsset: { text: row.business_name } },
        null,
        { type: "TEXT", textAsset: { text: row.business_name } },
        "SELECT " +
          PMAX_ASSET_FIELDS +
          " FROM asset WHERE asset.resource_name = " +
          extQuote(business),
        "asset",
      );
      for (const logo of rows(row.logos))
        logos.push(await media.resolve(logo, "LOGO"));
    }
    const resources = await appendCompleteGroups(
      ctx,
      prefix,
      campaign,
      [group],
      c.brandGuidelinesEnabled,
      business,
      logos,
      temp,
      add,
      media,
    );
    mediaSummary.push(...media.summaries);
    item.before = {
      campaign: c,
      existing_groups: inventory.map((r) => r.assetGroup),
    };
    item.after = {
      campaign,
      groups: resources,
      status: "PAUSED",
      mandatory_links_status: "ENABLED",
      campaign_changed: false,
    };
    item.warnings.push(
      "Complete asset group+minimum texts/images created atomically under existing PAUSED parent. Existing campaign/budget/goals/branding untouched; no standalone half-group/no automatic deletion rollback.",
    );
  }
  if (
    mediaSummary.reduce((n, m) => n + Number(m.byte_length ?? 0), 0) >
    GOOGLE_MEDIA_LIMITS.aggregateBytes
  )
    extFail("google_media_request_limit", "Normalized aggregate exceeds2MiB.");
  const seen = new Set<string>();
  for (const o of operations) {
    const key = o.resource_name ?? o.kind + canonical(o.fields);
    if (seen.has(key))
      extFail(
        "google_pmax_duplicate",
        "Duplicate group assets/associations/signals rejected.",
      );
    seen.add(key);
  }
  const plan: ExtendedPlan = {
    version: 4,
    account_id: ctx.account_id,
    intent: { ...intent, media_summary: mediaSummary },
    checks: ctx.checks,
    operations,
    items,
    atomic: true,
    irreversible: false,
  };
  assertExtendedPlan(plan, ctx.account_id);
  return plan;
}

export async function buildPmaxCreatePlan(
  account: string,
  raw: unknown,
  read: Stage1Reader,
): Promise<ExtendedPlan> {
  const brief = preflightPmaxBrief(raw),
    ctx = await extContext(account, read),
    prefix = "customers/" + ctx.account_id,
    operations: ExtendedOperation[] = [],
    item = extItem(0, "PMax campaign from brief");
  let sequence = 0;
  const temp = (kind: string) => prefix + "/" + kind + "/" + --sequence,
    add: Add = (
      kind,
      method,
      resource,
      fields,
      before,
      expected,
      query,
      key,
      mask = null,
    ) => {
      item.provider_operations.push(operations.length);
      operations.push({
        kind,
        method,
        resource_name: resource,
        fields,
        before,
        expected,
        read_query: query,
        response_key: key,
        update_mask: mask,
        row: 0,
      });
    };
  const duplicate = await ctx.query(
    "SELECT campaign.resource_name, campaign.name FROM campaign WHERE campaign.name = " +
      extQuote(String(brief.campaign_name).trim()) +
      " AND campaign.status != REMOVED",
  );
  if (duplicate.length)
    extFail(
      "google_pmax_duplicate",
      "Campaign name уже существует; новый atomic graph не сформирован.",
    );
  const moneyUnit = await resolveGoogleMoneyUnit(ctx.currency, ctx.query);
  const money = extRow(brief.daily_budget),
    requestedAmount = currencyMicros(
      String(money.amount),
      String(money.currency),
      ctx.currency,
    ),
    amount = quantizePositiveMicros(requestedAmount, moneyUnit),
    strategy = String(brief.bidding_strategy ?? "MAXIMIZE_CONVERSIONS"),
    tracking = validateTracking(extRow(brief.utm));
  item.warnings.push(
    ...moneyUnitWarnings(requestedAmount, amount, moneyUnit).map(
      (w) => "Daily budget: " + w,
    ),
  );
  const requestedCPA = brief.target_cpa
    ? currencyMicros(
        String(extRow(brief.target_cpa).amount),
        String(extRow(brief.target_cpa).currency),
        ctx.currency,
      )
    : undefined;
  const targetCPA =
    requestedCPA === undefined
      ? undefined
      : quantizePositiveMicros(requestedCPA, moneyUnit);
  if (requestedCPA !== undefined && targetCPA !== undefined)
    item.warnings.push(
      ...moneyUnitWarnings(requestedCPA, targetCPA, moneyUnit).map(
        (w) => "Target CPA: " + w,
      ),
    );
  const custRows = await ctx.query(
      "SELECT customer.resource_name, customer.id, customer.conversion_tracking_setting.google_ads_conversion_customer FROM customer",
    ),
    conversionCustomer = extRow(
      extRow(custRows[0]?.customer).conversionTrackingSetting,
    ).googleAdsConversionCustomer;
  if (conversionCustomer !== prefix)
    extFail(
      "google_pmax_cross_account_goals_unsupported",
      "Atomic PMax profile требует same-account conversion customer; cross-account custom goals не опускаются молча.",
    );
  const actionRows = await ctx.query(
      "SELECT conversion_action.resource_name, conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.owner_customer, conversion_action.category, conversion_action.origin FROM conversion_action",
    ),
    selected: ExtendedRow[] = [];
  for (const id of brief.conversion_actions as string[]) {
    const matches = actionRows
        .map((r) => extRow(r.conversionAction))
        .filter((a) => String(a.id) === id),
      a = matches[0];
    if (
      matches.length !== 1 ||
      !a ||
      a.resourceName !== identity(prefix, "conversionActions", id) ||
      a.ownerCustomer !== prefix ||
      a.status !== "ENABLED"
    )
      extFail(
        "google_conversion_invalid",
        "Selected conversion action отсутствует, отключён или принадлежит другому account.",
      );
    selected.push(a);
    const recent = await ctx.query(
      "SELECT segments.conversion_action, metrics.all_conversions FROM customer WHERE segments.date DURING LAST_30_DAYS AND segments.conversion_action = " +
        extQuote(String(a.resourceName)),
    );
    if (!recent.some((r) => Number(extRow(r.metrics).allConversions) > 0))
      item.warnings.push(
        "Conversion " +
          String(a.name ?? id) +
          ": no confirmed conversions in LAST_30_DAYS; health не выдумана.",
      );
  }
  const budget = temp("campaignBudgets"),
    campaign = temp("campaigns"),
    name = String(brief.campaign_name).trim(),
    brand = brief.brand_guidelines_enabled !== false;
  add(
    "campaignBudgets",
    "create",
    budget,
    {
      resourceName: budget,
      amountMicros: amount,
      explicitlyShared: false,
      deliveryMethod: "STANDARD",
    },
    null,
    {
      amountMicros: amount,
      explicitlyShared: false,
      deliveryMethod: "STANDARD",
      name,
    },
    "SELECT campaign_budget.resource_name, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.delivery_method FROM campaign_budget WHERE campaign_budget.resource_name = " +
      extQuote(budget),
    "campaignBudget",
  );
  const bidding: ExtendedRow =
    strategy === "MAXIMIZE_CONVERSIONS"
      ? {
          maximizeConversions: {
            ...(brief.target_cpa
              ? {
                  targetCpaMicros: targetCPA,
                }
              : {}),
          },
        }
      : {
          maximizeConversionValue: {
            ...(brief.target_roas !== undefined
              ? { targetRoas: brief.target_roas }
              : {}),
          },
        };
  const campaignCreate = {
    resourceName: campaign,
    name,
    status: "PAUSED",
    advertisingChannelType: "PERFORMANCE_MAX",
    campaignBudget: budget,
    brandGuidelinesEnabled: brand,
    containsEuPoliticalAdvertising: brief.contains_eu_political_advertising,
    geoTargetTypeSetting: {
      positiveGeoTargetType: "PRESENCE",
      negativeGeoTargetType: "PRESENCE",
    },
    ...bidding,
    ...tracking,
    ...(brief.start_date
      ? { startDateTime: `${brief.start_date} 00:00:00` }
      : {}),
    ...(brief.end_date ? { endDateTime: `${brief.end_date} 23:59:59` } : {}),
  };
  add(
    "campaigns",
    "create",
    campaign,
    campaignCreate,
    null,
    {
      ...campaignCreate,
      ...(strategy === "MAXIMIZE_CONVERSIONS"
        ? {
            maximizeConversions: {
              targetCpaMicros: "0",
              ...extRow(extRow(campaignCreate).maximizeConversions),
            },
          }
        : {
            maximizeConversionValue: {
              targetRoas: 0,
              ...extRow(extRow(campaignCreate).maximizeConversionValue),
            },
          }),
      biddingStrategyType: strategy,
    },
    "SELECT " +
      CAMPAIGN_FIELDS +
      " FROM campaign WHERE campaign.resource_name = " +
      extQuote(campaign),
    "campaign",
  );
  const goals = await ctx.query(
    "SELECT customer_conversion_goal.resource_name, customer_conversion_goal.category, customer_conversion_goal.origin, customer_conversion_goal.biddable FROM customer_conversion_goal",
  );
  if (
    selected.some(
      (a) =>
        !goals.some((r) => {
          const g = extRow(r.customerConversionGoal);
          return g.category === a.category && g.origin === a.origin;
        }),
    )
  )
    extFail(
      "google_conversion_invalid",
      "Selected action category/origin отсутствует в реальных customer conversion goals.",
    );
  for (const row of goals) {
    const g = extRow(row.customerConversionGoal);
    const goalResource = extOwner(
        g.resourceName,
        ctx.account_id,
        "customerConversionGoals",
      ),
      suffix = goalResource.split("/").at(-1)!;
    if (!/^[0-9]{1,20}~[0-9]{1,20}$/.test(suffix))
      extFail(
        "google_conversion_invalid",
        "Canonical provider customer-goal suffix required; enum resource IDs are not guessed.",
      );
    if (
      !/^[A-Z_]+$/.test(String(g.category)) ||
      !/^[A-Z_]+$/.test(String(g.origin))
    )
      extFail(
        "google_conversion_invalid",
        "Google goal metadata не подтверждена.",
      );
    const resource =
      prefix +
      "/campaignConversionGoals/" +
      campaign.split("/").at(-1) +
      "~" +
      suffix;
    add(
      "campaignConversionGoals",
      "update",
      resource,
      { resourceName: resource, biddable: false },
      null,
      { campaign, biddable: false, category: g.category, origin: g.origin },
      "SELECT campaign_conversion_goal.resource_name, campaign_conversion_goal.campaign, campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable FROM campaign_conversion_goal WHERE campaign_conversion_goal.campaign = " +
        extQuote(campaign) +
        " AND campaign_conversion_goal.category = " +
        String(g.category) +
        " AND campaign_conversion_goal.origin = " +
        String(g.origin),
      "campaignConversionGoal",
      "biddable",
    );
  }
  const custom = temp("customConversionGoals"),
    customName = [...name].slice(0, 220).join("") + " selected actions";
  add(
    "customConversionGoals",
    "create",
    custom,
    {
      resourceName: custom,
      name: customName,
      conversionActions: selected.map((a) => a.resourceName),
    },
    null,
    {
      name: customName,
      conversionActions: selected.map((a) => a.resourceName),
    },
    "SELECT custom_conversion_goal.resource_name, custom_conversion_goal.name, custom_conversion_goal.conversion_actions FROM custom_conversion_goal WHERE custom_conversion_goal.resource_name = " +
      extQuote(custom),
    "customConversionGoal",
  );
  const config =
    prefix + "/conversionGoalCampaignConfigs/" + campaign.split("/").at(-1);
  add(
    "conversionGoalCampaignConfigs",
    "update",
    config,
    { resourceName: config, customConversionGoal: custom },
    null,
    { campaign, customConversionGoal: custom },
    "SELECT conversion_goal_campaign_config.resource_name, conversion_goal_campaign_config.campaign, conversion_goal_campaign_config.custom_conversion_goal FROM conversion_goal_campaign_config WHERE conversion_goal_campaign_config.campaign = " +
      extQuote(campaign),
    "conversionGoalCampaignConfig",
    "custom_conversion_goal",
  );
  const criterionQuery =
    "SELECT " +
    CRITERIA_FIELDS +
    " FROM campaign_criterion WHERE campaign_criterion.campaign = " +
    extQuote(campaign) +
    " AND campaign_criterion.status != REMOVED";
  for (const l of rows(brief.locations)) {
    const id = extId(l.geo_target_id),
      found = await ctx.query(
        "SELECT geo_target_constant.resource_name, geo_target_constant.id, geo_target_constant.name, geo_target_constant.status FROM geo_target_constant WHERE geo_target_constant.id = " +
          id,
      ),
      g = extRow(found[0]?.geoTargetConstant);
    if (
      found.length !== 1 ||
      g.resourceName !== "geoTargetConstants/" + id ||
      g.status !== "ENABLED"
    )
      extFail(
        "google_pmax_geo_invalid",
        "Google geo constant не найден/не ENABLED.",
      );
    add(
      "campaignCriteria",
      "create",
      null,
      {
        campaign,
        negative: l.exclude === true,
        location: { geoTargetConstant: g.resourceName },
      },
      null,
      {
        campaign,
        negative: l.exclude === true,
        location: { geoTargetConstant: g.resourceName },
      },
      criterionQuery,
      "campaignCriterion",
    );
    item.warnings.push(
      "Location " +
        String(g.name) +
        " → " +
        String(g.resourceName) +
        ", " +
        (l.exclude ? "EXCLUDE" : "PRESENCE include"),
    );
  }
  if (!rows(brief.locations).some((l) => l.exclude !== true))
    extFail(
      "google_pmax_geo_invalid",
      "Требуется хотя бы одна positive location; worldwide fallback запрещён.",
    );
  for (const id of brief.languages as string[]) {
    const found = await ctx.query(
        "SELECT language_constant.resource_name, language_constant.id, language_constant.name, language_constant.targetable FROM language_constant WHERE language_constant.id = " +
          id,
      ),
      l = extRow(found[0]?.languageConstant);
    if (
      found.length !== 1 ||
      l.resourceName !== "languageConstants/" + id ||
      l.targetable !== true
    )
      extFail(
        "google_pmax_language_invalid",
        "Language constant не targetable.",
      );
    add(
      "campaignCriteria",
      "create",
      null,
      { campaign, language: { languageConstant: l.resourceName } },
      null,
      { campaign, language: { languageConstant: l.resourceName } },
      criterionQuery,
      "campaignCriterion",
    );
  }
  const media = await mediaResolver(ctx, prefix, temp, add),
    logos: string[] = [];
  for (const l of rows(brief.logos)) logos.push(await media.resolve(l, "LOGO"));
  const createText = (text: string) => {
      const resource = temp("assets");
      add(
        "assets",
        "create",
        resource,
        { resourceName: resource, textAsset: { text } },
        null,
        { type: "TEXT", textAsset: { text } },
        "SELECT " +
          PMAX_ASSET_FIELDS +
          " FROM asset WHERE asset.resource_name = " +
          extQuote(resource),
        "asset",
      );
      return resource;
    },
    business = createText(String(brief.business_name));
  if (brand)
    for (const [asset, fieldType] of [
      [business, "BUSINESS_NAME"],
      ...logos.map((l) => [l, "LOGO"]),
    ]) {
      const fields = { campaign, asset, fieldType, status: "ENABLED" };
      add(
        "campaignAssets",
        "create",
        null,
        fields,
        null,
        fields,
        "SELECT campaign_asset.resource_name, campaign_asset.campaign, campaign_asset.asset, campaign_asset.field_type, campaign_asset.status FROM campaign_asset WHERE campaign_asset.campaign = " +
          extQuote(campaign) +
          " AND campaign_asset.status != REMOVED",
        "campaignAsset",
      );
    }
  await appendCompleteGroups(
    ctx,
    prefix,
    campaign,
    rows(brief.asset_groups),
    brand,
    business,
    logos,
    temp,
    add,
    media,
  );
  item.after = {
    campaign,
    budget,
    status: "PAUSED",
    asset_groups: rows(brief.asset_groups).length,
    operation_count: operations.length,
    brand_guidelines_enabled: brand,
    money_unit: moneyUnit,
    media: media.summaries,
  };
  item.warnings.push(
    "Non-retail atomic PMax graph: campaign/groups PAUSED, mandatory links ENABLED under paused parents; никаких hidden activations. Conversion targets/media/policy validate_only обязательны. Video autogenerated by provider may occur; no fabricated video assets. Creation rollback/delete unsupported.",
  );
  const plan: ExtendedPlan = {
    version: 4,
    account_id: ctx.account_id,
    intent: {
      action: "pmax_create",
      items: [{ brief }],
      media_summary: media.summaries,
    },
    checks: ctx.checks,
    operations,
    items: [item],
    atomic: true,
    irreversible: false,
  };
  const associations = new Set<string>();
  for (const op of operations.filter(
    (o) => o.method === "create" && !o.resource_name,
  )) {
    const key = op.kind + canonical(op.fields);
    if (associations.has(key))
      extFail(
        "google_pmax_duplicate",
        "Duplicate association/target/signal in immutable creation graph.",
      );
    associations.add(key);
  }
  assertExtendedPlan(plan, ctx.account_id);
  return plan;
}

export async function buildPmaxEditPlan(
  account: string,
  intent: ExtendedRow & { action: string; items: ExtendedRow[] },
  read: Stage1Reader,
): Promise<ExtendedPlan> {
  checkMediaQuota(
    intent.items.filter((r) => r.media !== undefined).map((r) => r.media),
  );
  const destructive = [
    "pmax_asset_detach",
    "pmax_asset_replace",
    "pmax_campaign_asset_replace",
    "pmax_campaign_asset_detach",
    "pmax_signal_remove",
    "pmax_negative_remove",
    "pmax_brand_remove",
  ].includes(intent.action);
  if (
    destructive &&
    intent.items.some((r) => r.acknowledge_irreversible !== true)
  )
    extFail(
      "google_irreversible_acknowledgement_required",
      "Requires acknowledge_irreversible=true and separate manual browser approval; automatic cleanup prohibited.",
    );
  const ctx = await extContext(account, read),
    prefix = "customers/" + ctx.account_id,
    operations: ExtendedOperation[] = [],
    items: ExtendedPlan["items"] = [],
    mediaSummaries: ExtendedRow[] = [];
  let sequence = 0,
    atomic = false;
  const temp = (kind: string) => prefix + "/" + kind + "/" + --sequence;
  const required = (r: ExtendedRow, keys: string[]) => {
    if (keys.some((k) => r[k] === undefined))
      extFail(
        "google_pmax_input_invalid",
        "Отсутствуют обязательные fields: " + keys.join(", "),
      );
  };
  const campaign = async (id: unknown) => {
    const resource = identity(prefix, "campaigns", id),
      q =
        "SELECT " +
        CAMPAIGN_FIELDS +
        " FROM campaign WHERE campaign.resource_name = " +
        extQuote(resource) +
        " AND campaign.status != REMOVED",
      r = await ctx.query(q),
      c = extRow(r[0]?.campaign);
    if (
      r.length !== 1 ||
      c.resourceName !== resource ||
      c.advertisingChannelType !== "PERFORMANCE_MAX"
    )
      extFail(
        "google_pmax_campaign_unavailable",
        "Требуется existing owned PERFORMANCE_MAX campaign.",
      );
    extOwner(c.resourceName, ctx.account_id, "campaigns");
    return c;
  };
  for (const [index, row] of intent.items.entries()) {
    const item = extItem(index, intent.action, String(row.campaign_id ?? ""));
    items.push(item);
    const add: Add = (
      kind,
      method,
      resource,
      fields,
      before,
      expected,
      query,
      key,
      mask = null,
    ) => {
      item.provider_operations.push(operations.length);
      operations.push({
        kind,
        method,
        resource_name: resource,
        fields,
        before,
        expected,
        read_query: query,
        response_key: key,
        update_mask: mask,
        row: index,
      });
      item.before = before;
      item.after = expected;
    };
    if (intent.action === "image_asset_create") {
      required(row, ["level", "field_type", "media"]);
      if (!["AD_IMAGE", "BUSINESS_LOGO"].includes(String(row.field_type)))
        extFail(
          "google_media_role_invalid",
          "Search inline image profile permits AD_IMAGE/BUSINESS_LOGO only.",
        );
      const level = String(row.level);
      if (!["account", "campaign", "ad_group"].includes(level))
        extFail("google_media_role_invalid", "Неподдерживаемый asset level.");
      let parent: ExtendedRow = {};
      if (level !== "account") {
        const id = extId(row.campaign_id),
          resource = identity(prefix, "campaigns", id),
          found = await ctx.query(
            "SELECT campaign.resource_name, campaign.advertising_channel_type, campaign.status FROM campaign WHERE campaign.resource_name = " +
              extQuote(resource) +
              " AND campaign.status != REMOVED",
          ),
          c = extRow(found[0]?.campaign);
        if (
          found.length !== 1 ||
          c.resourceName !== resource ||
          c.advertisingChannelType !== "SEARCH"
        )
          extFail(
            "google_media_parent_invalid",
            "Search media profile требует owned SEARCH campaign.",
          );
        parent = { campaign: resource };
        if (level === "ad_group") {
          const group = identity(prefix, "adGroups", row.ad_group_id),
            found = await ctx.query(
              "SELECT ad_group.resource_name, ad_group.campaign, ad_group.status FROM ad_group WHERE ad_group.resource_name = " +
                extQuote(group) +
                " AND ad_group.status != REMOVED",
            );
          if (
            found.length !== 1 ||
            extRow(found[0]?.adGroup).campaign !== resource ||
            extRow(found[0]?.adGroup).resourceName !== group
          )
            extFail("google_media_parent_invalid", "Ad group parent mismatch.");
          parent = { adGroup: group };
        }
      }
      const resolver = await mediaResolver(ctx, prefix, temp, add),
        asset = await resolver.resolve(
          row.media,
          row.field_type === "BUSINESS_LOGO" ? "LOGO" : "AD_IMAGE",
        );
      mediaSummaries.push(...resolver.summaries);
      const kind =
          level === "account"
            ? "customerAssets"
            : level === "campaign"
              ? "campaignAssets"
              : "adGroupAssets",
        key =
          level === "account"
            ? "customerAsset"
            : level === "campaign"
              ? "campaignAsset"
              : "adGroupAsset",
        table =
          level === "account"
            ? "customer_asset"
            : level === "campaign"
              ? "campaign_asset"
              : "ad_group_asset",
        where =
          level === "account"
            ? ""
            : table +
              "." +
              (level === "campaign" ? "campaign" : "ad_group") +
              " = " +
              extQuote(String(parent.campaign ?? parent.adGroup)) +
              " AND ",
        q =
          "SELECT " +
          table +
          ".resource_name, " +
          table +
          ".asset, " +
          table +
          ".field_type, " +
          table +
          ".status" +
          (level === "account"
            ? ""
            : ", " +
              table +
              "." +
              (level === "campaign" ? "campaign" : "ad_group")) +
          " FROM " +
          table +
          " WHERE " +
          where +
          table +
          ".status != REMOVED",
        existing = await ctx.query(q);
      if (
        existing.some(
          (r) =>
            extRow(r[key]).asset === asset &&
            extRow(r[key]).fieldType === row.field_type,
        )
      )
        extFail("google_pmax_duplicate", "Media association уже существует.");
      const fields = {
        ...parent,
        asset,
        fieldType: row.field_type,
        status: "PAUSED",
      };
      add(kind, "create", null, fields, null, fields, q, key);
      atomic = operations.some((o) => o.resource_name?.includes("/-"));
      item.warnings.push(
        "Media uploaded/reference only; association PAUSED. Google policy/level eligibility validated; no external URLs/downloads.",
      );
      continue;
    }
    required(row, ["campaign_id"]);
    const c = await campaign(row.campaign_id);
    if (
      ["pmax_campaign_asset_replace", "pmax_campaign_asset_detach"].includes(
        intent.action,
      )
    ) {
      required(row, ["asset_id", "field_type"]);
      if (c.brandGuidelinesEnabled !== true)
        extFail(
          "google_pmax_brand_level_invalid",
          "Campaign branding operations require provider-proven enabled brand guidelines.",
        );
      const role = String(row.field_type);
      if (!["LOGO", "BUSINESS_NAME"].includes(role))
        extFail(
          "google_pmax_asset_field_unsupported",
          "Campaign branding supports LOGO/BUSINESS_NAME only.",
        );
      const q =
          "SELECT " +
          BRAND_LINK_FIELDS +
          " FROM campaign_asset WHERE campaign_asset.campaign = " +
          extQuote(String(c.resourceName)) +
          " AND campaign_asset.status != REMOVED",
        links = await ctx.query(q),
        old = identity(prefix, "assets", row.asset_id),
        matches = links.filter(
          (r) =>
            extRow(r.campaignAsset).asset === old &&
            extRow(r.campaignAsset).fieldType === role,
        );
      if (matches.length !== 1)
        extFail(
          "google_pmax_asset_unavailable",
          "Exact existing campaign branding association not found.",
        );
      const before = extRow(matches[0]!.campaignAsset),
        remove = extOwner(
          before.resourceName,
          ctx.account_id,
          "campaignAssets",
        ),
        excluded = new Set(
          operations
            .filter((o) => o.method === "remove")
            .map((o) => String(o.resource_name)),
        );
      excluded.add(remove);
      let replacement: string | null = null;
      if (intent.action === "pmax_campaign_asset_replace") {
        if (role === "BUSINESS_NAME") {
          if (typeof row.text !== "string" || row.media !== undefined)
            extFail(
              "google_pmax_text_invalid",
              "Business name replacement требует только typed text.",
            );
          validateText(row.text, 25, "Business name");
          if (extRow(extRow(matches[0]!.asset).textAsset).text === row.text)
            extFail("google_pmax_noop", "Business name уже совпадает.");
          replacement = temp("assets");
          add(
            "assets",
            "create",
            replacement,
            { resourceName: replacement, textAsset: { text: row.text } },
            null,
            { type: "TEXT", textAsset: { text: row.text } },
            "SELECT " +
              PMAX_ASSET_FIELDS +
              " FROM asset WHERE asset.resource_name = " +
              extQuote(replacement),
            "asset",
          );
        } else {
          if (!row.media || row.text !== undefined)
            extFail(
              "google_pmax_image_invalid",
              "Logo replacement требует only reference/inline media.",
            );
          const media = await mediaResolver(ctx, prefix, temp, add);
          replacement = await media.resolve(row.media, "LOGO");
          mediaSummaries.push(...media.summaries);
          if (replacement === old)
            extFail("google_pmax_noop", "Same logo reference.");
        }
        if (
          links.some(
            (r) =>
              extRow(r.campaignAsset).asset === replacement &&
              extRow(r.campaignAsset).fieldType === role,
          )
        )
          extFail(
            "google_pmax_duplicate",
            "Replacement campaign association already exists.",
          );
        const fields = {
          campaign: c.resourceName,
          asset: replacement,
          fieldType: role,
          status: before.status,
        };
        add(
          "campaignAssets",
          "create",
          null,
          fields,
          null,
          fields,
          q,
          "campaignAsset",
        );
      }
      brandComposition(
        links,
        ctx.account_id,
        String(c.resourceName),
        excluded,
        operations
          .filter((o) => o.kind === "campaignAssets" && o.method === "create")
          .map((o) => o.fields),
      );
      add(
        "campaignAssets",
        "remove",
        remove,
        {},
        before,
        {},
        q,
        "campaignAsset",
      );
      atomic = true;
      item.after = {
        association_removed: remove,
        replacement_asset: replacement,
        field_type: role,
        original_asset_retained: true,
      };
      item.warnings.push(
        "Campaign-level branding association replacement/removal: exact owner/type/image data and minimum composition checked, original asset retained; separate destructive approval and Google policy validation mandatory.",
      );
      continue;
    }
    if (
      [
        "pmax_negative_add",
        "pmax_negative_remove",
        "pmax_brand_exclude",
        "pmax_brand_remove",
      ].includes(intent.action)
    ) {
      const q =
          "SELECT " +
          CRITERIA_FIELDS +
          " FROM campaign_criterion WHERE campaign_criterion.campaign = " +
          extQuote(String(c.resourceName)) +
          " AND campaign_criterion.status != REMOVED",
        existing = await ctx.query(q);
      if (intent.action.endsWith("_remove")) {
        required(row, ["criterion_id"]);
        const resource =
            prefix +
            "/campaignCriteria/" +
            row.campaign_id +
            "~" +
            extId(row.criterion_id),
          matches = existing
            .map((r) => extRow(r.campaignCriterion))
            .filter((r) => r.resourceName === resource),
          before = matches[0];
        if (
          matches.length !== 1 ||
          !before ||
          before.negative !== true ||
          (intent.action === "pmax_negative_remove"
            ? !extRow(before.keyword).text
            : !extRow(before.brandList).sharedSet)
        )
          extFail(
            "google_pmax_criterion_unavailable",
            "Requested negative/brand criterion не подтверждён. Positive targeting не удаляется.",
          );
        add(
          "campaignCriteria",
          "remove",
          resource,
          {},
          before,
          {},
          q,
          "campaignCriterion",
        );
      } else if (intent.action === "pmax_negative_add") {
        required(row, ["text", "match_type"]);
        const keyword = parseStage1Intent({
            action: "negative_add",
            level: "campaign",
            items: [
              {
                campaign_id: row.campaign_id,
                text: row.text,
                match_type: row.match_type,
              },
            ],
          }).items[0]!,
          fields = keywordCreateFields(
            keyword,
            { campaign: String(c.resourceName) },
            true,
            ctx.currency,
          );
        if (
          existing.some(
            (r) =>
              canonical(extRow(extRow(r.campaignCriterion).keyword)) ===
                canonical(fields.keyword) &&
              extRow(r.campaignCriterion).negative === true,
          )
        )
          extFail("google_pmax_duplicate", "Negative keyword уже существует.");
        add(
          "campaignCriteria",
          "create",
          null,
          fields,
          null,
          fields,
          q,
          "campaignCriterion",
        );
        item.warnings.push(
          "PMax negative keyword действует на Search/Shopping inventory; не создаётся positive keyword. Google validates v24 account eligibility.",
        );
      } else {
        required(row, ["shared_set_id"]);
        const resource = identity(prefix, "sharedSets", row.shared_set_id),
          found = await ctx.query(
            "SELECT shared_set.resource_name, shared_set.type, shared_set.status FROM shared_set WHERE shared_set.resource_name = " +
              extQuote(resource),
          ),
          set = extRow(found[0]?.sharedSet);
        if (
          found.length !== 1 ||
          set.resourceName !== resource ||
          set.type !== "BRANDS" ||
          set.status !== "ENABLED"
        )
          extFail(
            "google_pmax_brand_invalid",
            "Existing owned ENABLED SharedSet BRANDS required. Deprecated proto comment BRAND_HINT is not enum capability.",
          );
        if (
          existing.some(
            (r) =>
              extRow(extRow(r.campaignCriterion).brandList).sharedSet ===
              resource,
          )
        )
          extFail("google_pmax_duplicate", "Brand exclusion уже существует.");
        const fields = {
          campaign: c.resourceName,
          negative: true,
          brandList: { sharedSet: resource },
        };
        add(
          "campaignCriteria",
          "create",
          null,
          fields,
          null,
          fields,
          q,
          "campaignCriterion",
        );
        item.warnings.push(
          "BRANDS list eligibility may be account-allowlisted by Google; validate_only must pass. No fabricated brand identifiers/list creation.",
        );
      }
      continue;
    }
    required(row, ["asset_group_id"]);
    const resource = identity(prefix, "assetGroups", row.asset_group_id),
      groupQuery =
        "SELECT " +
        GROUP_FIELDS +
        " FROM asset_group WHERE asset_group.resource_name = " +
        extQuote(resource) +
        " AND asset_group.status != REMOVED",
      groupRows = await ctx.query(groupQuery),
      group = extRow(groupRows[0]?.assetGroup);
    if (
      groupRows.length !== 1 ||
      group.resourceName !== resource ||
      group.campaign !== c.resourceName
    )
      extFail(
        "google_pmax_group_unavailable",
        "Asset group ownership/parent proof failed.",
      );
    if (intent.action === "pmax_signal_remove") {
      required(row, ["signal_id"]);
      const q =
          "SELECT asset_group_signal.resource_name, asset_group_signal.asset_group, asset_group_signal.audience.audience, asset_group_signal.search_theme.text FROM asset_group_signal WHERE asset_group_signal.asset_group = " +
          extQuote(resource),
        found = await ctx.query(q),
        signal =
          prefix +
          "/assetGroupSignals/" +
          row.asset_group_id +
          "~" +
          extId(row.signal_id),
        matches = found
          .map((r) => extRow(r.assetGroupSignal))
          .filter((r) => r.resourceName === signal);
      if (matches.length !== 1)
        extFail(
          "google_pmax_signal_unavailable",
          "Only selected existing signal can be removed.",
        );
      add(
        "assetGroupSignals",
        "remove",
        signal,
        {},
        matches[0]!,
        {},
        q,
        "assetGroupSignal",
      );
      continue;
    }
    required(row, ["asset_id", "field_type"]);
    if (!PMAX_ASSET_LIMITS[String(row.field_type)])
      extFail(
        "google_pmax_asset_field_unsupported",
        "Unknown PMax asset role; no silently dropped field.",
      );
    const linksQuery =
        "SELECT " +
        PMAX_LINK_FIELDS +
        ", " +
        PMAX_ASSET_FIELDS +
        ", asset_group_asset.policy_summary.approval_status FROM asset_group_asset WHERE asset_group_asset.asset_group = " +
        extQuote(resource) +
        " AND asset_group_asset.status != REMOVED",
      links = await ctx.query(linksQuery);
    for (const r of links) {
      const l = extRow(r.assetGroupAsset);
      extOwner(l.resourceName, ctx.account_id, "assetGroupAssets");
      extOwner(l.asset, ctx.account_id, "assets");
      if (l.assetGroup !== resource || extRow(r.asset).resourceName !== l.asset)
        extFail(
          "google_pmax_link_proof_invalid",
          "Full link/asset relationship not provider-proven.",
        );
    }
    const old = identity(prefix, "assets", row.asset_id),
      matches = links.filter(
        (r) =>
          extRow(r.assetGroupAsset).asset === old &&
          extRow(r.assetGroupAsset).fieldType === row.field_type,
      );
    if (matches.length !== 1)
      extFail(
        "google_pmax_asset_unavailable",
        "Selected exact association not found.",
      );
    const before = extRow(matches[0]!.assetGroupAsset),
      removeResource = extOwner(
        before.resourceName,
        ctx.account_id,
        "assetGroupAssets",
      );
    const role = String(row.field_type),
      brand = c.brandGuidelinesEnabled;
    if (typeof brand !== "boolean")
      extFail(
        "google_pmax_brand_mode_unverified",
        "Brand-guidelines state must be explicitly provider-proven for safe minimum-asset change.",
      );
    if (brand && ["LOGO", "BUSINESS_NAME"].includes(role))
      extFail(
        "google_pmax_brand_level_invalid",
        "Enabled brand guidelines требует campaign-level branding, не asset-group LOGO/BUSINESS_NAME.",
      );
    const removals = new Set(
      operations
        .filter((o) => o.method === "remove")
        .map((o) => o.resource_name),
    );
    removals.add(removeResource);
    let replacement: string | null = null;
    if (intent.action === "pmax_asset_replace") {
      const type = PMAX_ASSET_LIMITS[role]!.type;
      if (type === "TEXT") {
        if (row.media !== undefined || typeof row.text !== "string")
          extFail(
            "google_pmax_text_invalid",
            "TEXT replacement requires explicit text only.",
          );
        validateText(
          row.text,
          PMAX_ASSET_LIMITS[role]!.length!,
          "PMax " + role,
        );
        if (
          extRow(matches[0]!.asset).textAsset &&
          extRow(extRow(matches[0]!.asset).textAsset).text === row.text
        )
          extFail("google_pmax_noop", "TEXT already identical.");
        replacement = temp("assets");
        add(
          "assets",
          "create",
          replacement,
          { resourceName: replacement, textAsset: { text: row.text } },
          null,
          { type: "TEXT", textAsset: { text: row.text } },
          "SELECT " +
            PMAX_ASSET_FIELDS +
            " FROM asset WHERE asset.resource_name = " +
            extQuote(replacement),
          "asset",
        );
      } else {
        if (row.text !== undefined || !row.media)
          extFail(
            "google_pmax_image_invalid",
            "IMAGE replacement requires reference or bounded inline media only.",
          );
        const resolver = await mediaResolver(ctx, prefix, temp, add);
        replacement = await resolver.resolve(row.media, role);
        mediaSummaries.push(...resolver.summaries);
        if (replacement === old)
          extFail("google_pmax_noop", "IMAGE reference already identical.");
      }
      if (
        links.some(
          (r) =>
            extRow(r.assetGroupAsset).asset === replacement &&
            extRow(r.assetGroupAsset).fieldType === role,
        )
      )
        extFail("google_pmax_duplicate", "Replacement link already exists.");
      const fields = {
        assetGroup: resource,
        asset: replacement,
        fieldType: role,
        status: before.status,
      };
      add(
        "assetGroupAssets",
        "create",
        null,
        fields,
        null,
        fields,
        linksQuery,
        "assetGroupAsset",
      );
    }
    const eligible = links.filter(
        (r) =>
          !removals.has(String(extRow(r.assetGroupAsset).resourceName)) &&
          extRow(r.assetGroupAsset).status === "ENABLED",
      ),
      counts: Record<string, number> = {};
    for (const r of eligible) {
      const l = extRow(r.assetGroupAsset),
        asset = extRow(r.asset),
        limit = PMAX_ASSET_LIMITS[String(l.fieldType)];
      if (!limit) continue;
      if (asset.type !== limit.type)
        extFail("google_pmax_minimum_assets", "Remaining asset type mismatch.");
      if (limit.type === "TEXT")
        validateText(
          String(extRow(asset.textAsset).text ?? ""),
          limit.length!,
          "Remaining PMax " + l.fieldType,
        );
      else {
        const image = extRow(asset.imageAsset),
          size = extRow(image.fullSize);
        imageCheck(
          String(l.fieldType),
          Number(size.widthPixels),
          Number(size.heightPixels),
          Number(image.fileSize),
          String(image.mimeType),
        );
      }
      counts[String(l.fieldType)] = (counts[String(l.fieldType)] ?? 0) + 1;
    }
    for (const o of operations.filter(
      (o) =>
        o.kind === "assetGroupAssets" &&
        o.method === "create" &&
        o.fields.assetGroup === resource &&
        o.fields.status === "ENABLED",
    ))
      counts[String(o.fields.fieldType)] =
        (counts[String(o.fields.fieldType)] ?? 0) + 1;
    for (const [field, limit] of Object.entries(PMAX_ASSET_LIMITS)) {
      if (brand && ["LOGO", "BUSINESS_NAME"].includes(field)) continue;
      if ((counts[field] ?? 0) < limit.min || (counts[field] ?? 0) > limit.max)
        extFail(
          "google_pmax_minimum_assets",
          "Safe remaining minimum/maximum failed for " +
            field +
            "; no mutation sent.",
        );
    }
    if (brand) {
      const q =
          "SELECT " +
          BRAND_LINK_FIELDS +
          " FROM campaign_asset WHERE campaign_asset.campaign = " +
          extQuote(String(c.resourceName)) +
          " AND campaign_asset.status != REMOVED",
        brandLinks = await ctx.query(q);
      brandComposition(
        brandLinks,
        ctx.account_id,
        String(c.resourceName),
        new Set(),
      );
    }
    add(
      "assetGroupAssets",
      "remove",
      removeResource,
      {},
      before,
      {},
      linksQuery,
      "assetGroupAsset",
    );
    atomic = true;
    item.after = {
      association_removed: removeResource,
      replacement_asset: replacement,
      field_type: role,
      ...(replacement ? { replacement_status: before.status } : {}),
      original_asset_retained: true,
    };
    item.warnings.push(
      "Immutable association remove" +
        (replacement ? "/replace" : "") +
        ": minimum remaining assets and branding checked; original asset retained, no delete rollback. Google validate_only policy check required.",
    );
  }
  const seen = new Set<string>();
  if (
    mediaSummaries.reduce((n, m) => n + Number(m.byte_length ?? 0), 0) >
    GOOGLE_MEDIA_LIMITS.aggregateBytes
  )
    extFail(
      "google_media_request_limit",
      "Normalized aggregate media exceeds local2MiB profile.",
    );
  for (const o of operations) {
    const key = o.resource_name ?? o.kind + canonical(o.fields);
    if (seen.has(key))
      extFail(
        "google_pmax_duplicate",
        "Duplicate rows/resources in immutable batch.",
      );
    seen.add(key);
  }
  const plan: ExtendedPlan = {
    version: 4,
    account_id: ctx.account_id,
    intent: { ...intent, media_summary: mediaSummaries },
    checks: ctx.checks,
    operations,
    items,
    atomic: atomic || operations.some((o) => o.resource_name?.includes("/-")),
    irreversible: destructive,
  };
  assertExtendedPlan(plan, ctx.account_id);
  return plan;
}

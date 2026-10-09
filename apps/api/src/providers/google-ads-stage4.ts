import { validateBriefSchema } from "../mcp/mcp-google-stage0-schema.js";
import {
  stage4RowSchema,
  stage4Actions,
} from "../mcp/mcp-google-stage4-schema.js";
import { normalizeBrief, validateText } from "./google-ads-stage0.js";
import { buildPmaxCreatePlan, buildPmaxEditPlan } from "./google-ads-pmax.js";
import { finalUrl, canonical, type Stage1Reader } from "./google-ads-stage1.js";
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
  type ExtendedKind,
  type ExtendedOperation,
  type ExtendedRow,
} from "./google-ads-extended-plan.js";

export type Stage4Intent = ExtendedRow & {
  action: string;
  items: ExtendedRow[];
};
export function parseStage4Intent(raw: unknown): Stage4Intent {
  const intent = extClosed(
    raw,
    ["provider", "account_id", "action", "items"],
    ["action", "items"],
  );
  if (intent.provider !== undefined && intent.provider !== "GOOGLE_ADS")
    extFail("google_stage4_provider_invalid", "Требуется GOOGLE_ADS.");
  if (
    !stage4Actions.includes(intent.action as (typeof stage4Actions)[number]) ||
    !Array.isArray(intent.items) ||
    intent.items.length < 1 ||
    intent.items.length > 100
  )
    extFail(
      "google_stage4_input_invalid",
      "Неизвестное действие или batch вне 1–100 строк.",
    );
  const allowed: Record<string, string[]> = {
    rsa_create: ["campaign_id", "ad_group_id", "rsa"],
    rsa_update: ["campaign_id", "ad_group_id", "ad_id", "rsa"],
    ad_status: ["campaign_id", "ad_group_id", "ad_id", "status"],
    ad_remove: [
      "campaign_id",
      "ad_group_id",
      "ad_id",
      "acknowledge_irreversible",
    ],
    asset_create: ["assets", "level", "campaign_id", "ad_group_id"],
    asset_attach: [
      "asset_id",
      "field_type",
      "level",
      "campaign_id",
      "ad_group_id",
    ],
    asset_detach: [
      "asset_id",
      "field_type",
      "level",
      "campaign_id",
      "ad_group_id",
      "acknowledge_irreversible",
    ],
    campaign_update: [
      "campaign_id",
      "name",
      "status",
      "start_date",
      "end_date",
      "networks",
    ],
    ad_group_create: ["campaign_id", "name"],
    ad_group_update: ["campaign_id", "ad_group_id", "name", "status"],
    tracking_update: [
      "level",
      "campaign_id",
      "ad_group_id",
      "final_url_suffix",
      "tracking_url_template",
    ],
    asset_group_update: [
      "campaign_id",
      "asset_group_id",
      "name",
      "status",
      "final_url",
      "path1",
      "path2",
    ],
    pmax_search_theme_add: ["campaign_id", "asset_group_id", "search_theme"],
    pmax_audience_signal_add: ["campaign_id", "asset_group_id", "audience_id"],
    pmax_asset_attach: [
      "campaign_id",
      "asset_group_id",
      "asset_id",
      "field_type",
    ],
    pmax_asset_detach: [
      "campaign_id",
      "asset_group_id",
      "asset_id",
      "field_type",
      "acknowledge_irreversible",
    ],
    pmax_create: ["brief"],
    pmax_asset_replace: [
      "campaign_id",
      "asset_group_id",
      "asset_id",
      "field_type",
      "media",
      "text",
      "acknowledge_irreversible",
    ],
    pmax_campaign_asset_replace: [
      "campaign_id",
      "asset_id",
      "field_type",
      "media",
      "text",
      "acknowledge_irreversible",
    ],
    pmax_campaign_asset_detach: [
      "campaign_id",
      "asset_id",
      "field_type",
      "acknowledge_irreversible",
    ],
    pmax_signal_remove: [
      "campaign_id",
      "asset_group_id",
      "signal_id",
      "acknowledge_irreversible",
    ],
    pmax_negative_add: ["campaign_id", "text", "match_type"],
    pmax_negative_remove: [
      "campaign_id",
      "criterion_id",
      "acknowledge_irreversible",
    ],
    pmax_brand_exclude: ["campaign_id", "shared_set_id"],
    pmax_brand_remove: [
      "campaign_id",
      "criterion_id",
      "acknowledge_irreversible",
    ],
    image_asset_create: [
      "level",
      "campaign_id",
      "ad_group_id",
      "media",
      "field_type",
    ],
  };
  const items = intent.items.map((v) => {
    const r = extClosed(v, allowed[String(intent.action)]!);
    validateBriefSchema(r, stage4RowSchema, "items");
    return structuredClone(r);
  });
  for (const item of items)
    if (intent.action === "asset_create") {
      const assets = extRow(item.assets);
      for (const text of (assets.callouts ?? []) as string[])
        validateText(text, 25, "Callout");
      for (const a of arr(assets.sitelinks))
        for (const k of ["text", "description1", "description2"])
          if (a[k])
            validateText(String(a[k]), k === "text" ? 25 : 35, `Sitelink ${k}`);
      for (const a of arr(assets.structured_snippets)) {
        validateText(String(a.header), 25, "Snippet header");
        for (const text of a.values as string[])
          validateText(text, 25, "Snippet value");
      }
      if (assets.business_name)
        validateText(String(assets.business_name), 25, "Business name");
    }
  for (const item of items)
    if (item.rsa) {
      const rsa = extRow(item.rsa);
      publicLanding(rsa.final_url);
      for (const h of arr(rsa.headlines))
        validateText(String(h.text), 30, "RSA headline");
      for (const d of arr(rsa.descriptions))
        validateText(String(d.text), 90, "RSA description");
      for (const path of ["path1", "path2"])
        if (rsa[path]) validateText(String(rsa[path]), 15, path);
      if (rsa.path2 && !rsa.path1)
        extFail("google_ad_path_invalid", "path2 требует path1.");
    }
  return { ...intent, action: String(intent.action), items };
}
const arr = (v: unknown) => (Array.isArray(v) ? v.map(extRow) : []);
function publicLanding(value: unknown) {
  const normalized = finalUrl(value);
  if (normalized === null)
    extFail(
      "google_stage4_public_url_required",
      "Final URL нельзя очистить для RSA.",
    );
  const url = new URL(normalized),
    host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const octets = host.split(".").map(Number),
    ipv4 =
      octets.length === 4 &&
      octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255);
  if (
    host === "localhost" ||
    !host.includes(".") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.includes(":") ||
    (ipv4 &&
      (octets[0] === 0 ||
        octets[0] === 10 ||
        octets[0] === 127 ||
        octets[0]! >= 224 ||
        (octets[0] === 169 && octets[1] === 254) ||
        (octets[0] === 172 && octets[1]! >= 16 && octets[1]! <= 31) ||
        (octets[0] === 192 && octets[1] === 168) ||
        (octets[0] === 100 && octets[1]! >= 64 && octets[1]! <= 127)))
  )
    extFail(
      "google_stage4_public_url_required",
      "Требуется публичный landing URL; localhost/private literals/IPv6 literals не поддержаны. Сетевой запрос не выполняется.",
    );
  return normalized;
}
function imageDimensions(asset: ExtendedRow) {
  const size = extRow(extRow(asset.imageAsset).fullSize);
  if (
    !Number.isInteger(Number(size.widthPixels)) ||
    Number(size.widthPixels) <= 0 ||
    !Number.isInteger(Number(size.heightPixels)) ||
    Number(size.heightPixels) <= 0
  )
    extFail(
      "google_stage4_image_metadata_unavailable",
      "Google IMAGE asset dimensions не подтверждены. Google validate_only проверит ratio/eligibility; содержимое не скачивается.",
    );
}
const campaignFields =
  "campaign.resource_name, campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign.start_date_time, campaign.end_date_time, campaign.network_settings.target_google_search, campaign.network_settings.target_search_network, campaign.network_settings.target_content_network, campaign.network_settings.target_partner_search_network, campaign.final_url_suffix, campaign.tracking_url_template";
const groupFields =
  "ad_group.resource_name, ad_group.id, ad_group.name, ad_group.campaign, ad_group.status, ad_group.type, ad_group.final_url_suffix, ad_group.tracking_url_template";
const adFields =
  "ad_group_ad.resource_name, ad_group_ad.ad_group, ad_group_ad.status, ad_group_ad.ad.resource_name, ad_group_ad.ad.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions, ad_group_ad.ad.responsive_search_ad.path1, ad_group_ad.ad.responsive_search_ad.path2";
const assetFields =
  "asset.resource_name, asset.type, asset.final_urls, asset.sitelink_asset.link_text, asset.sitelink_asset.description1, asset.sitelink_asset.description2, asset.callout_asset.callout_text, asset.structured_snippet_asset.header, asset.structured_snippet_asset.values, asset.call_asset.country_code, asset.call_asset.phone_number, asset.text_asset.text, asset.image_asset.full_size.width_pixels, asset.image_asset.full_size.height_pixels";
const agFields =
  "asset_group.resource_name, asset_group.id, asset_group.campaign, asset_group.name, asset_group.status, asset_group.final_urls, asset_group.path1, asset_group.path2";
function reusableValidation(
  account: string,
  currency: string,
  values: {
    rsa?: ExtendedRow;
    assets?: ExtendedRow;
    utm?: ExtendedRow;
    start_date?: unknown;
    end_date?: unknown;
  },
) {
  // Reuse approved Stage 0 field, wide-character, URL and tracking validation verbatim.
  return normalizeBrief({
    provider: "GOOGLE_ADS",
    account_id: account,
    campaign_name: "validation only",
    daily_budget: { amount: "1", currency },
    locations: [{ name: "validation only" }],
    languages: ["Russian"],
    ad_groups: [
      {
        name: "validation only",
        keywords: [{ text: "validation only", match_type: "EXACT" }],
        rsa: [
          values.rsa ?? {
            final_url: "https://example.com/",
            headlines: [
              { text: "Validation one" },
              { text: "Validation two" },
              { text: "Validation three" },
            ],
            descriptions: [
              { text: "Validation description one" },
              { text: "Validation description two" },
            ],
          },
        ],
      },
    ],
    ...(values.assets ? { assets: values.assets } : {}),
    ...(values.utm ? { utm: values.utm } : {}),
    ...(values.start_date ? { start_date: values.start_date } : {}),
    ...(values.end_date ? { end_date: values.end_date } : {}),
  });
}
function rsaFields(raw: ExtendedRow, account: string, currency: string) {
  publicLanding(raw.final_url);
  const brief = reusableValidation(account, currency, { rsa: raw });
  const rsa = arr(arr(brief.ad_groups)[0]!.rsa)[0]!;
  return {
    finalUrls: [rsa.final_url],
    responsiveSearchAd: {
      headlines: arr(rsa.headlines).map((h) => ({
        text: h.text,
        ...(h.pinned_field ? { pinnedField: h.pinned_field } : {}),
      })),
      descriptions: arr(rsa.descriptions).map((h) => ({
        text: h.text,
        ...(h.pinned_field ? { pinnedField: h.pinned_field } : {}),
      })),
      ...(rsa.path1 ? { path1: rsa.path1 } : {}),
      ...(rsa.path2 ? { path2: rsa.path2 } : {}),
    },
  };
}
const actionRequired: Record<string, string[]> = {
  rsa_create: ["campaign_id", "ad_group_id", "rsa"],
  rsa_update: ["campaign_id", "ad_group_id", "ad_id", "rsa"],
  ad_status: ["campaign_id", "ad_group_id", "ad_id", "status"],
  ad_remove: ["campaign_id", "ad_group_id", "ad_id"],
  asset_create: ["assets", "level"],
  asset_attach: ["asset_id", "field_type", "level"],
  asset_detach: ["asset_id", "field_type", "level"],
  campaign_update: ["campaign_id"],
  ad_group_create: ["campaign_id", "name"],
  ad_group_update: ["campaign_id", "ad_group_id"],
  tracking_update: ["level"],
  asset_group_update: ["campaign_id", "asset_group_id"],
  pmax_search_theme_add: ["campaign_id", "asset_group_id", "search_theme"],
  pmax_audience_signal_add: ["campaign_id", "asset_group_id", "audience_id"],
  pmax_asset_attach: [
    "campaign_id",
    "asset_group_id",
    "asset_id",
    "field_type",
  ],
  pmax_asset_detach: [
    "campaign_id",
    "asset_group_id",
    "asset_id",
    "field_type",
  ],
  pmax_create: [],
};
export async function buildStage4Plan(
  account: string,
  raw: unknown,
  read: Stage1Reader,
): Promise<ExtendedPlan> {
  const intent = parseStage4Intent(raw);
  if (intent.action === "pmax_create") {
    if (intent.items.length !== 1)
      extFail(
        "google_pmax_atomic_campaign_limit",
        "One atomic PMax campaign brief per preview.",
      );
    return buildPmaxCreatePlan(account, intent.items[0]!.brief, read);
  }
  if (
    [
      "pmax_asset_detach",
      "pmax_asset_replace",
      "pmax_campaign_asset_replace",
      "pmax_campaign_asset_detach",
      "pmax_signal_remove",
      "pmax_negative_add",
      "pmax_negative_remove",
      "pmax_brand_exclude",
      "pmax_brand_remove",
      "image_asset_create",
    ].includes(intent.action)
  )
    return buildPmaxEditPlan(account, intent, read);
  if (
    ["ad_remove", "asset_detach"].includes(intent.action) &&
    intent.items.some((i) => i.acknowledge_irreversible !== true)
  )
    extFail(
      "google_irreversible_acknowledgement_required",
      "Remove/detach требует acknowledge_irreversible=true и отдельного browser approval.",
    );
  const ctx = await extContext(account, read);
  if (
    intent.account_id !== undefined &&
    String(intent.account_id).replace(/-/g, "") !== ctx.account_id
  )
    extFail(
      "google_extended_ownership_invalid",
      "account_id не совпадает с выбранным customer.",
    );
  const prefix = `customers/${ctx.account_id}`,
    operations: ExtendedOperation[] = [],
    items: ExtendedPlan["items"] = [];
  let temporary = -1,
    irreversible = false;
  const inverse: ExtendedRow[] = [];
  const one = async (
    query: string,
    key: string,
    identity: string,
    kind: string,
  ) => {
    const rows = await ctx.query(query),
      value = extRow(rows[0]?.[key]);
    if (rows.length !== 1 || value.resourceName !== identity)
      extFail(
        "google_stage4_resource_unavailable",
        "Google не вернул однозначный resource выбранного account.",
      );
    extOwner(value.resourceName, ctx.account_id, kind);
    return value;
  };
  const campaign = async (id: unknown) => {
    const identity = `${prefix}/campaigns/${extId(id, "campaign_id")}`;
    return one(
      `SELECT ${campaignFields} FROM campaign WHERE campaign.resource_name = ${extQuote(identity)} AND campaign.status != REMOVED`,
      "campaign",
      identity,
      "campaigns",
    );
  };
  const group = async (row: ExtendedRow) => {
    const c = await campaign(row.campaign_id),
      identity = `${prefix}/adGroups/${extId(row.ad_group_id, "ad_group_id")}`;
    const g = await one(
      `SELECT ${groupFields} FROM ad_group WHERE ad_group.resource_name = ${extQuote(identity)} AND ad_group.status != REMOVED`,
      "adGroup",
      identity,
      "adGroups",
    );
    if (g.campaign !== c.resourceName)
      extFail(
        "google_extended_ownership_invalid",
        "Ad group не принадлежит выбранной campaign.",
      );
    return { c, g };
  };
  const add = (
    rowIndex: number,
    kind: ExtendedKind,
    method: ExtendedOperation["method"],
    resource: string | null,
    fields: ExtendedRow,
    before: ExtendedRow | null,
    expected: ExtendedRow,
    query: string,
    key: string,
    mask: string | null = null,
  ) => {
    items[rowIndex]!.provider_operations.push(operations.length);
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
      row: rowIndex,
    });
    items[rowIndex]!.before = before;
    items[rowIndex]!.after = expected;
  };
  for (const [index, row] of intent.items.entries()) {
    if (actionRequired[intent.action]!.some((k) => row[k] === undefined))
      extFail(
        "google_stage4_input_invalid",
        `Строка ${index + 1}: отсутствуют обязательные поля ${actionRequired[intent.action]!.join(", ")}.`,
      );
    items.push(
      extItem(
        index,
        intent.action,
        String(row.campaign_id ?? ""),
        String(row.ad_group_id ?? ""),
      ),
    );
    const item = items[index]!;
    if (
      ["rsa_create", "rsa_update", "ad_status", "ad_remove"].includes(
        intent.action,
      )
    ) {
      const { c, g } = await group(row);
      if (c.advertisingChannelType !== "SEARCH" || g.type !== "SEARCH_STANDARD")
        extFail(
          "google_stage4_profile_unsupported",
          "RSA поддерживается только в Search standard ad group.",
        );
      const baseQuery = `SELECT ${adFields} FROM ad_group_ad WHERE ad_group.resource_name = ${extQuote(String(g.resourceName))} AND ad_group_ad.status != REMOVED`;
      const existing = await ctx.query(baseQuery);
      if (intent.action === "rsa_create") {
        const ad = rsaFields(extRow(row.rsa), ctx.account_id, ctx.currency);
        if (
          existing.some((v) => {
            const content = extRow(extRow(v.adGroupAd).ad);
            return (
              canonical({
                finalUrls: content.finalUrls,
                responsiveSearchAd: content.responsiveSearchAd,
              }) === canonical(ad)
            );
          })
        )
          extFail(
            "google_stage4_duplicate",
            "Эквивалентный RSA уже существует.",
          );
        add(
          index,
          "adGroupAds",
          "create",
          null,
          { adGroup: g.resourceName, status: "PAUSED", ad },
          null,
          { adGroup: g.resourceName, status: "PAUSED", ad },
          baseQuery,
          "adGroupAd",
        );
        item.warnings.push(
          "RSA создаётся PAUSED. Google moderation/policy validation обязательна; автоматического запуска нет.",
        );
      } else {
        const identity = `${prefix}/adGroupAds/${row.ad_group_id}~${extId(row.ad_id, "ad_id")}`,
          found = existing
            .map((v) => extRow(v.adGroupAd))
            .filter((v) => v.resourceName === identity);
        if (found.length !== 1)
          extFail(
            "google_stage4_resource_unavailable",
            "RSA/ad не найден в выбранной группе.",
          );
        const before = found[0]!;
        extOwner(before.resourceName, ctx.account_id, "adGroupAds");
        const query = `${baseQuery} AND ad_group_ad.ad.id = ${row.ad_id}`;
        if (intent.action === "rsa_update") {
          if (!extRow(extRow(before.ad).responsiveSearchAd).headlines)
            extFail(
              "google_stage4_profile_unsupported",
              "Edit поддерживает только RSA.",
            );
          const ad = extRow(before.ad),
            replacement = rsaFields(
              extRow(row.rsa),
              ctx.account_id,
              ctx.currency,
            ),
            resource = extOwner(ad.resourceName, ctx.account_id, "ads");
          const expected = {
            ...ad,
            ...replacement,
            responsiveSearchAd: {
              ...extRow(ad.responsiveSearchAd),
              ...replacement.responsiveSearchAd,
            },
          };
          if (canonical(ad) === canonical(expected))
            extFail(
              "google_stage4_noop",
              "RSA content уже совпадает; mutation не создаётся.",
            );
          const mask = [
            "final_urls",
            "responsive_search_ad.headlines",
            "responsive_search_ad.descriptions",
            ...Object.keys(extRow(row.rsa))
              .filter((k) => k === "path1" || k === "path2")
              .map((k) => `responsive_search_ad.${k}`),
          ].join(",");
          add(
            index,
            "ads" as ExtendedKind,
            "update",
            resource,
            { resourceName: resource, ...replacement },
            ad,
            expected,
            query,
            "adGroupAd.ad",
            mask,
          );
          item.warnings.push(
            "Редактирование RSA через AdService: повторная модерация; вся выбранная RSA content явно показана, status не меняется.",
          );
        } else if (intent.action === "ad_remove") {
          irreversible = true;
          add(
            index,
            "adGroupAds",
            "remove",
            identity,
            {},
            before,
            {},
            query,
            "adGroupAd",
          );
          item.warnings.push(
            "Необратимое REMOVED: требуется отдельное destructive browser approval; rollback не поддерживается.",
          );
        } else {
          if (before.status === row.status)
            extFail("google_stage4_noop", "Status уже равен requested value.");
          add(
            index,
            "adGroupAds",
            "update",
            identity,
            { resourceName: identity, status: row.status },
            before,
            { ...before, status: row.status },
            query,
            "adGroupAd",
            "status",
          );
          inverse.push({ ...row, status: before.status });
        }
      }
    } else if (
      ["asset_create", "asset_attach", "asset_detach"].includes(intent.action)
    ) {
      const level = String(row.level),
        c = level === "account" ? null : await campaign(row.campaign_id),
        g = level === "ad_group" ? (await group(row)).g : null;
      if (
        intent.action === "asset_detach" &&
        c?.advertisingChannelType === "PERFORMANCE_MAX" &&
        ["LOGO", "BUSINESS_LOGO", "BUSINESS_NAME"].includes(
          String(row.field_type),
        )
      )
        extFail(
          "google_pmax_brand_minimum_unsupported",
          "Generic detach не может удалить обязательный PMax branding. Campaign-level branding replacement/minimum proof требуется отдельно; этот путь не bypass.",
        );
      const kind =
          level === "campaign"
            ? "campaignAssets"
            : level === "ad_group"
              ? "adGroupAssets"
              : "customerAssets",
        table =
          level === "campaign"
            ? "campaign_asset"
            : level === "ad_group"
              ? "ad_group_asset"
              : "customer_asset",
        key =
          level === "campaign"
            ? "campaignAsset"
            : level === "ad_group"
              ? "adGroupAsset"
              : "customerAsset";
      const parent =
        level === "campaign"
          ? { campaign: c!.resourceName }
          : level === "ad_group"
            ? { adGroup: g!.resourceName }
            : {};
      const linkQuery = `SELECT ${table}.resource_name, ${table}.asset, ${table}.field_type, ${table}.status${level === "account" ? "" : `, ${table}.${level === "campaign" ? "campaign" : "ad_group"}`} FROM ${table} WHERE ${level === "account" ? `${table}.status != REMOVED` : `${table}.${level === "campaign" ? "campaign" : "ad_group"} = ${extQuote(String(g?.resourceName ?? c?.resourceName))} AND ${table}.status != REMOVED`}`;
      const links = await ctx.query(linkQuery);
      const attach = (asset: string, fieldType: string) => {
        if (
          links.some(
            (v) =>
              extRow(v[key]).asset === asset &&
              extRow(v[key]).fieldType === fieldType,
          )
        )
          extFail(
            "google_stage4_duplicate",
            "Asset association уже существует.",
          );
        add(
          index,
          kind,
          "create",
          null,
          { ...parent, asset, fieldType },
          null,
          { ...parent, asset, fieldType },
          linkQuery,
          key,
        );
      };
      if (intent.action === "asset_create") {
        const rawAssets = extRow(row.assets),
          normalized = reusableValidation(ctx.account_id, ctx.currency, {
            assets: rawAssets,
          }),
          assets = extRow(normalized.assets);
        const create = (type: string, fields: ExtendedRow) => {
          const resource = `${prefix}/assets/${temporary--}`;
          add(
            index,
            "assets",
            "create",
            resource,
            { resourceName: resource, ...fields },
            null,
            fields,
            `SELECT ${assetFields} FROM asset WHERE asset.resource_name = ${extQuote(resource)}`,
            "asset",
          );
          attach(resource, type);
        };
        for (const a of arr(assets.sitelinks))
          create("SITELINK", {
            finalUrls: [publicLanding(a.final_url)],
            sitelinkAsset: {
              linkText: a.text,
              ...(a.description1
                ? { description1: a.description1, description2: a.description2 }
                : {}),
            },
          });
        for (const text of (assets.callouts ?? []) as string[])
          create("CALLOUT", { calloutAsset: { calloutText: text } });
        for (const a of arr(assets.structured_snippets))
          create("STRUCTURED_SNIPPET", {
            structuredSnippetAsset: { header: a.header, values: a.values },
          });
        if (assets.call)
          create("CALL", {
            callAsset: {
              countryCode: extRow(assets.call).country_code,
              phoneNumber: extRow(assets.call).phone_number,
            },
          });
        if (assets.business_name)
          create("BUSINESS_NAME", {
            textAsset: { text: assets.business_name },
          });
        for (const [property, type] of [
          ["image_asset_ids", "AD_IMAGE"],
          ["logo_asset_ids", "BUSINESS_LOGO"],
        ])
          for (const assetId of (assets[property!] ?? []) as string[]) {
            const resource = `${prefix}/assets/${extId(assetId)}`,
              a = await one(
                `SELECT ${assetFields} FROM asset WHERE asset.resource_name = ${extQuote(resource)}`,
                "asset",
                resource,
                "assets",
              );
            if (a.type !== "IMAGE")
              extFail(
                "google_stage4_asset_type_invalid",
                "Image/logo reference не является IMAGE asset.",
              );
            imageDimensions(a);
            attach(resource, type!);
          }
        item.warnings.push(
          "Binary ingestion не выполняется. Image/logo только существующие account-scoped IMAGE references. Policy/level eligibility проверяет Google validate_only.",
        );
      } else {
        const resource = `${prefix}/assets/${extId(row.asset_id)}`,
          a = await one(
            `SELECT ${assetFields} FROM asset WHERE asset.resource_name = ${extQuote(resource)}`,
            "asset",
            resource,
            "assets",
          ),
          type = String(row.field_type);
        const expectedType: Record<string, string> = {
          SITELINK: "SITELINK",
          CALLOUT: "CALLOUT",
          STRUCTURED_SNIPPET: "STRUCTURED_SNIPPET",
          CALL: "CALL",
          AD_IMAGE: "IMAGE",
          BUSINESS_LOGO: "IMAGE",
          BUSINESS_NAME: "TEXT",
        };
        if (a.type !== expectedType[type])
          extFail(
            "google_stage4_asset_type_invalid",
            "Asset type не соответствует field_type.",
          );
        if (a.type === "IMAGE") imageDimensions(a);
        if (intent.action === "asset_attach") attach(resource, type);
        else {
          const matches = links
            .map((v) => extRow(v[key]))
            .filter((v) => v.asset === resource && v.fieldType === type);
          if (matches.length !== 1)
            extFail(
              "google_stage4_resource_unavailable",
              "Asset association не найдена однозначно.",
            );
          const before = matches[0]!,
            identity = extOwner(before.resourceName, ctx.account_id, kind);
          irreversible = true;
          add(index, kind, "remove", identity, {}, before, {}, linkQuery, key);
          item.warnings.push(
            "Удаляется только association; asset сохраняется. Requires explicit removal approval.",
          );
        }
      }
    } else if (
      [
        "campaign_update",
        "ad_group_create",
        "ad_group_update",
        "tracking_update",
      ].includes(intent.action)
    ) {
      if (intent.action === "ad_group_create") {
        const c = await campaign(row.campaign_id);
        if (c.advertisingChannelType !== "SEARCH")
          extFail(
            "google_stage4_profile_unsupported",
            "Создание ad group только SEARCH_STANDARD.",
          );
        const query = `SELECT ${groupFields} FROM ad_group WHERE campaign.id = ${row.campaign_id} AND ad_group.status != REMOVED`,
          all = await ctx.query(query);
        if (
          all.some(
            (v) =>
              String(extRow(v.adGroup).name).toLowerCase() ===
              String(row.name).trim().toLowerCase(),
          )
        )
          extFail("google_stage4_duplicate", "Имя ad group уже существует.");
        const resource = `${prefix}/adGroups/${temporary--}`,
          fields = {
            resourceName: resource,
            campaign: c.resourceName,
            name: String(row.name).trim(),
            status: "PAUSED",
            type: "SEARCH_STANDARD",
          };
        add(
          index,
          "adGroups",
          "create",
          resource,
          fields,
          null,
          fields,
          query,
          "adGroup",
        );
      } else {
        const accountLevel =
            intent.action === "tracking_update" && row.level === "account",
          groupLevel =
            intent.action === "ad_group_update" ||
            (intent.action === "tracking_update" && row.level === "ad_group");
        const customerQuery =
          "SELECT customer.resource_name, customer.id, customer.currency_code, customer.time_zone, customer.final_url_suffix, customer.tracking_url_template FROM customer";
        const before = accountLevel
            ? await one(customerQuery, "customer", prefix, "customers")
            : groupLevel
              ? (await group(row)).g
              : await campaign(row.campaign_id),
          kind = accountLevel
            ? "customers"
            : groupLevel
              ? "adGroups"
              : "campaigns",
          table = groupLevel ? "ad_group" : "campaign",
          key = accountLevel ? "customer" : groupLevel ? "adGroup" : "campaign",
          resource = String(before.resourceName),
          fields: ExtendedRow = { resourceName: resource },
          masks: string[] = [];
        if (intent.action === "campaign_update" && row.status === "ENABLED")
          extFail(
            "google_campaign_resume_requires_checklist",
            "Используйте штатный preview_resume_campaign с launch checklist. Campaign activation нельзя обходить через Stage 4 generic update.",
          );
        if (intent.action === "tracking_update") {
          if (
            row.final_url_suffix === undefined &&
            row.tracking_url_template === undefined
          )
            extFail(
              "google_stage4_input_invalid",
              "Tracking requires explicit change.",
            );
          const normalized = reusableValidation(ctx.account_id, ctx.currency, {
            utm: {
              ...(row.final_url_suffix !== undefined
                ? { final_url_suffix: row.final_url_suffix }
                : {}),
              ...(row.tracking_url_template !== undefined
                ? { tracking_url_template: row.tracking_url_template }
                : {}),
            },
          });
          const tracking = extRow(normalized.effective_tracking);
          if (row.final_url_suffix !== undefined) {
            fields.finalUrlSuffix = tracking.finalUrlSuffix;
            masks.push("final_url_suffix");
          }
          if (row.tracking_url_template !== undefined) {
            fields.trackingUrlTemplate = tracking.trackingUrlTemplate;
            masks.push("tracking_url_template");
          }
        } else {
          for (const property of ["name", "status"])
            if (row[property] !== undefined) {
              fields[property] =
                property === "name"
                  ? String(row[property]).trim()
                  : row[property];
              masks.push(property);
            }
          if (row.start_date !== undefined || row.end_date !== undefined) {
            reusableValidation(ctx.account_id, ctx.currency, {
              start_date:
                row.start_date ??
                (before.startDateTime
                  ? String(before.startDateTime).slice(0, 10)
                  : undefined),
              end_date:
                row.end_date ??
                (before.endDateTime
                  ? String(before.endDateTime).slice(0, 10)
                  : undefined),
            });
            for (const p of ["start", "end"])
              if (row[`${p}_date`] !== undefined) {
                fields[`${p}DateTime`] = `${row[`${p}_date`]} 00:00:00`;
                masks.push(`${p}_date_time`);
              }
          }
          if (row.networks) {
            if (before.advertisingChannelType !== "SEARCH")
              extFail(
                "google_stage4_profile_unsupported",
                "Networks editing поддерживает SEARCH only.",
              );
            fields.networkSettings = {};
            for (const [input, field, mask] of [
              [
                "search_partners",
                "targetSearchNetwork",
                "target_search_network",
              ],
              [
                "display_expansion",
                "targetContentNetwork",
                "target_content_network",
              ],
            ])
              if (extRow(row.networks)[input!] !== undefined) {
                extRow(fields.networkSettings)[field!] = extRow(row.networks)[
                  input!
                ];
                masks.push(`network_settings.${mask}`);
              }
          }
        }
        if (!masks.length)
          extFail("google_stage4_noop", "Не указаны изменяемые поля.");
        const expected = {
          ...before,
          ...fields,
          ...(fields.networkSettings
            ? {
                networkSettings: {
                  ...extRow(before.networkSettings),
                  ...extRow(fields.networkSettings),
                },
              }
            : {}),
        };
        const query = accountLevel
          ? customerQuery
          : `SELECT ${groupLevel ? groupFields : campaignFields} FROM ${table} WHERE ${table}.resource_name = ${extQuote(resource)} AND ${table}.status != REMOVED`;
        add(
          index,
          kind,
          "update",
          resource,
          fields,
          before,
          expected,
          query,
          key,
          masks.join(","),
        );
        if (canonical(before) === canonical(expected))
          extFail(
            "google_stage4_noop",
            "Provider state уже совпадает с изменением.",
          );
        if (intent.action === "tracking_update") {
          const previous: ExtendedRow = { ...row };
          const mapping = {
            final_url_suffix: "finalUrlSuffix",
            tracking_url_template: "trackingUrlTemplate",
          } as const;
          const missing = masks.some((mask) => {
            const old = before[mapping[mask as keyof typeof mapping]];
            if (typeof old !== "string" || !old.length) return true;
            previous[mask] = old;
            return false;
          });
          let reason = missing
            ? "google_tracking_rollback_clear_unsupported"
            : "";
          if (!reason) {
            try {
              // Only the captured changed fields are inverse input. Validation
              // never writes its default UTM into an untouched neighboring field.
              reusableValidation(ctx.account_id, ctx.currency, {
                utm: Object.fromEntries(
                  masks.map((mask) => [mask, previous[mask]]),
                ),
              });
            } catch {
              reason = "google_tracking_rollback_previous_invalid";
            }
          }
          if (!reason) {
            inverse.push(previous);
            Object.assign(item, {
              rollback: { supported: true, source: "HOLYMEDIA", fields: masks },
            });
          } else {
            const message = missing
              ? "Tracking rollback к missing/empty BEFORE требует отдельно проверенный clear contract; пустое значение не подменяется default UTM."
              : "Tracking BEFORE не проходит поддерживаемую typed URL/UTM validation; автоматический inverse не обещан.";
            item.warnings.push(`${reason}: ${message}`);
            Object.assign(item, {
              rollback: {
                supported: false,
                source: "HOLYMEDIA",
                code: reason,
                message,
              },
            });
          }
        } else if (
          intent.action === "ad_group_update" ||
          (intent.action === "campaign_update" &&
            masks.every((m) => m === "name" || m === "status") &&
            !(masks.includes("status") && before.status === "ENABLED"))
        )
          inverse.push({
            ...row,
            ...Object.fromEntries(masks.map((m) => [m, before[m]])),
          });
      }
    } else {
      const c = await campaign(row.campaign_id);
      if (c.advertisingChannelType !== "PERFORMANCE_MAX")
        extFail(
          "google_stage4_profile_unsupported",
          "Asset group/signal requires existing PERFORMANCE_MAX campaign.",
        );
      const resource = `${prefix}/assetGroups/${extId(row.asset_group_id)}`,
        query = `SELECT ${agFields} FROM asset_group WHERE asset_group.resource_name = ${extQuote(resource)} AND asset_group.status != REMOVED`,
        before = await one(query, "assetGroup", resource, "assetGroups");
      if (before.campaign !== c.resourceName)
        extFail(
          "google_extended_ownership_invalid",
          "Asset group parent mismatch.",
        );
      if (intent.action === "asset_group_update") {
        const fields: ExtendedRow = { resourceName: resource },
          masks: string[] = [];
        for (const p of ["name", "status", "path1", "path2"])
          if (row[p] !== undefined) {
            fields[p] = row[p];
            masks.push(p.replace(/([0-9])/g, "$1"));
          }
        if (row.name !== undefined)
          validateText(String(row.name), 128, "Asset group name");
        for (const path of ["path1", "path2"])
          if (row[path]) validateText(String(row[path]), 15, path);
        if (row.final_url !== undefined) {
          fields.finalUrls = [publicLanding(row.final_url)];
          masks.push("final_urls");
        }
        if ((fields.path2 ?? before.path2) && !(fields.path1 ?? before.path1))
          extFail("google_ad_path_invalid", "path2 требует path1.");
        if (!masks.length)
          extFail(
            "google_stage4_noop",
            "Asset group requires explicit change.",
          );
        add(
          index,
          "assetGroups",
          "update",
          resource,
          fields,
          before,
          { ...before, ...fields },
          query,
          "assetGroup",
          masks.join(","),
        );
      } else if (intent.action === "pmax_asset_attach") {
        const fieldType = String(row.field_type),
          permitted = [
            "HEADLINE",
            "LONG_HEADLINE",
            "DESCRIPTION",
            "MARKETING_IMAGE",
            "SQUARE_MARKETING_IMAGE",
          ];
        if (!permitted.includes(fieldType))
          extFail(
            "google_pmax_asset_field_unsupported",
            "PMax profile допускает только HEADLINE/LONG_HEADLINE/DESCRIPTION/MARKETING_IMAGE/SQUARE_MARKETING_IMAGE. Brand logos/business name требуют отдельного campaign-level profile.",
          );
        if (before.status !== "PAUSED" && c.status !== "PAUSED")
          extFail(
            "google_pmax_active_profile_unsupported",
            "Attachment profile требует PAUSED asset group или campaign. Активный PMax не затрагивается.",
          );
        const assetResource = `${prefix}/assets/${extId(row.asset_id)}`,
          asset = await one(
            `SELECT ${assetFields} FROM asset WHERE asset.resource_name = ${extQuote(assetResource)}`,
            "asset",
            assetResource,
            "assets",
          );
        const textType = ["HEADLINE", "LONG_HEADLINE", "DESCRIPTION"].includes(
          fieldType,
        );
        if (asset.type !== (textType ? "TEXT" : "IMAGE"))
          extFail(
            "google_stage4_asset_type_invalid",
            "Тип Google asset не соответствует PMax field_type.",
          );
        if (textType)
          validateText(
            String(extRow(asset.textAsset).text ?? ""),
            fieldType === "HEADLINE" ? 30 : 90,
            `PMax ${fieldType}`,
          );
        else {
          imageDimensions(asset);
          const dimensions = extRow(extRow(asset.imageAsset).fullSize),
            width = Number(dimensions.widthPixels),
            height = Number(dimensions.heightPixels);
          if (
            fieldType === "SQUARE_MARKETING_IMAGE" &&
            (width !== height || width < 300)
          )
            extFail(
              "google_pmax_image_dimensions_invalid",
              "SQUARE_MARKETING_IMAGE требует квадрат минимум 300x300.",
            );
          if (fieldType === "MARKETING_IMAGE" && (width < 600 || height < 314))
            extFail(
              "google_pmax_image_dimensions_invalid",
              "MARKETING_IMAGE требует минимум 600x314; Google validate_only проверяет landscape ratio и policy.",
            );
        }
        const linksQuery = `SELECT asset_group_asset.resource_name, asset_group_asset.asset_group, asset_group_asset.asset, asset_group_asset.field_type, asset_group_asset.status FROM asset_group_asset WHERE asset_group_asset.asset_group = ${extQuote(resource)} AND asset_group_asset.status != REMOVED`,
          links = await ctx.query(linksQuery);
        for (const row of links) {
          const link = extRow(row.assetGroupAsset);
          extOwner(link.resourceName, ctx.account_id, "assetGroupAssets");
          if (link.assetGroup !== resource)
            extFail(
              "google_extended_ownership_invalid",
              "AssetGroupAsset parent mismatch.",
            );
          extOwner(link.asset, ctx.account_id, "assets");
        }
        if (
          links.some(
            (v) =>
              extRow(v.assetGroupAsset).asset === assetResource &&
              extRow(v.assetGroupAsset).fieldType === fieldType,
          )
        )
          extFail(
            "google_stage4_duplicate",
            "PMax asset association уже существует.",
          );
        const maximum: Record<string, number> = {
          HEADLINE: 15,
          LONG_HEADLINE: 5,
          DESCRIPTION: 5,
          MARKETING_IMAGE: 20,
          SQUARE_MARKETING_IMAGE: 20,
        };
        const planned = operations.filter(
          (o) =>
            o.kind === "assetGroupAssets" &&
            o.fields.assetGroup === resource &&
            o.fields.fieldType === fieldType,
        ).length;
        if (
          links.filter((v) => extRow(v.assetGroupAsset).fieldType === fieldType)
            .length +
            planned >=
          maximum[fieldType]!
        )
          extFail(
            "google_pmax_asset_limit",
            "PMax field type asset limit превышен; данные не обрезаны.",
          );
        const fields = {
          assetGroup: resource,
          asset: assetResource,
          fieldType,
          status: "PAUSED",
        };
        add(
          index,
          "assetGroupAssets",
          "create",
          null,
          fields,
          null,
          fields,
          linksQuery,
          "assetGroupAsset",
        );
        item.warnings.push(
          "Связь создаётся PAUSED без activation родителя. Google validate_only проверяет minimum-assets/ratio/brand/policy eligibility. Автоматический detach/rollback запрещён до minimum remaining asset proof.",
        );
      } else {
        const fields: ExtendedRow = { assetGroup: resource };
        if (intent.action === "pmax_search_theme_add")
          fields.searchTheme = { text: row.search_theme };
        else {
          const audience = `${prefix}/audiences/${extId(row.audience_id)}`,
            aud = await one(
              `SELECT audience.resource_name, audience.status FROM audience WHERE audience.resource_name = ${extQuote(audience)}`,
              "audience",
              audience,
              "audiences",
            );
          if (aud.status !== "ENABLED")
            extFail(
              "google_stage4_audience_unavailable",
              "Audience not ENABLED.",
            );
          fields.audience = { audience };
        }
        const signalQuery = `SELECT asset_group_signal.resource_name, asset_group_signal.asset_group, asset_group_signal.audience.audience, asset_group_signal.search_theme.text FROM asset_group_signal WHERE asset_group_signal.asset_group = ${extQuote(resource)}`,
          signals = await ctx.query(signalQuery);
        if (
          signals.some(
            (v) =>
              canonical(
                extRow(v.assetGroupSignal).searchTheme ??
                  extRow(v.assetGroupSignal).audience,
              ) === canonical(fields.searchTheme ?? fields.audience),
          )
        )
          extFail(
            "google_stage4_duplicate",
            "Asset group signal уже существует.",
          );
        add(
          index,
          "assetGroupSignals",
          "create",
          null,
          fields,
          null,
          fields,
          signalQuery,
          "assetGroupSignal",
        );
        item.warnings.push(
          "Signal immutable: update requires explicitly approved remove/create, not implemented in this profile. Google policy validation required.",
        );
      }
    }
  }
  if (!operations.length)
    extFail("google_stage4_empty", "Нет операций; ничего не создано.");
  const identities = new Set<string>();
  for (const operation of operations) {
    const identity =
      operation.resource_name ??
      `${operation.kind}:${canonical(operation.fields)}`;
    if (identities.has(identity))
      extFail(
        "google_stage4_duplicate",
        "Duplicate resource/creation rows отклонены.",
      );
    identities.add(identity);
  }
  const plan: ExtendedPlan = {
    version: 4,
    account_id: ctx.account_id,
    intent,
    checks: ctx.checks,
    operations,
    items,
    atomic: operations.some((o) => o.resource_name?.includes("/-")),
    irreversible,
    ...(inverse.length === intent.items.length && !irreversible
      ? { inverse_intent: { ...intent, items: inverse } }
      : {}),
  };
  assertExtendedPlan(plan, ctx.account_id);
  return plan;
}

export const stage4CapabilityMatrix = {
  rsa_create: "IMPLEMENTED_PAUSED",
  rsa_content_update: "IMPLEMENTED_AD_SERVICE",
  ad_status: "IMPLEMENTED",
  ad_remove: "IMPLEMENTED_EXPLICIT_IRREVERSIBLE",
  text_call_business_assets: "IMPLEMENTED",
  existing_images_logos: "IMPLEMENTED_REFERENCE_ONLY",
  binary_ingestion: "IMPLEMENTED_BOUNDED_INLINE_JPEG_PNG_ACTUAL_DECODE",
  campaign_ad_group_updates: "IMPLEMENTED_POINT_MASKS",
  campaign_group_tracking: "IMPLEMENTED",
  account_tracking: "IMPLEMENTED_CUSTOMER_OPERATION",
  pmax_create:
    "IMPLEMENTED_ATOMIC_PAUSED_NON_RETAIL_EXPLICIT_SAME_ACCOUNT_GOALS",
  pmax_existing_asset_group_update: "IMPLEMENTED",
  pmax_existing_search_theme_audience_signal_add: "IMPLEMENTED",
  pmax_asset_group_create_full_minimum_assets:
    "IMPLEMENTED_INSIDE_ATOMIC_CREATE_BRIEF",
  pmax_brand_exclusions_negatives:
    "IMPLEMENTED_EXISTING_BRANDS_AND_V24_NEGATIVE_CRITERIA_PROVIDER_ELIGIBILITY_REQUIRED",
  pmax_image_text_attachment:
    "IMPLEMENTED_EXISTING_REFERENCES_PAUSED_LINK_ONLY",
  pmax_asset_detach: "IMPLEMENTED_MINIMUM_REMAINING_ASSETS_BRANDING_PROOF",
  pmax_asset_replace: "IMPLEMENTED_ATOMIC_TEXT_IMAGE_ASSOCIATION_REPLACEMENT",
  pmax_campaign_brand_assets:
    "IMPLEMENTED_ATOMIC_REPLACEMENT_AND_MINIMUM_SAFE_DETACH",
  pmax_signal_remove: "IMPLEMENTED_EXPLICIT_IRREVERSIBLE_ASSOCIATION_REMOVE",
  pmax_retail_feed_travel_local_services: "UNSUPPORTED_NOT_NON_RETAIL_PROFILE",
  pmax_cross_account_conversion_goals: "UNSUPPORTED_EXPLICIT_REJECTION",
} as const;

import { negativeMatch } from "./google-ads-negatives.js";
import {
  assertGoogleBatch,
  customerId,
  GoogleAdsWriteError,
  googleWriteFailure,
  type GoogleWriteFailure,
} from "./google-ads-write.js";

export type MatchType = "BROAD" | "PHRASE" | "EXACT";
export type Stage1Action =
  | "keyword_add"
  | "keyword_match"
  | "keyword_url"
  | "keyword_remove"
  | "negative_add"
  | "negative_remove"
  | "shared_create"
  | "shared_attach"
  | "shared_detach";
export type Stage1Item = {
  campaign_id?: string;
  ad_group_id?: string;
  criterion_id?: string;
  text?: string;
  match_type?: MatchType;
  cpc_bid?: { amount: string; currency: string };
  final_url?: string | null;
  shared_set_id?: string;
  shared_list_name?: string;
};
export type Stage1Intent = {
  action: Stage1Action;
  level?: "campaign" | "ad_group" | "shared_list";
  items: Stage1Item[];
};
export type GoogleResourceKind =
  | "adGroupCriteria"
  | "campaignCriteria"
  | "sharedSets"
  | "sharedCriteria"
  | "campaignSharedSets";
export type ResourceSnapshot = {
  kind: GoogleResourceKind | "campaigns" | "adGroups" | "customers";
  resource_name: string;
  id: string;
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
  shared_set_id: string;
  name: string;
  text: string;
  match_type: string;
  status: string;
  negative: boolean;
  final_urls: string[];
  cpc_bid_micros: string;
  currency: string;
  type: string;
};
export type Stage1Operation = {
  kind: GoogleResourceKind;
  method: "create" | "update" | "remove";
  resource_name: string | null;
  fields: {
    adGroup?: string;
    campaign?: string;
    sharedSet?: string;
    resourceName?: string;
    keyword?: { text: string; matchType: MatchType };
    status?: "ENABLED" | "PAUSED";
    negative?: boolean;
    finalUrls?: string[];
    cpcBidMicros?: string;
    name?: string;
    type?: "NEGATIVE_KEYWORDS";
  };
  update_mask: "status" | "final_urls" | null;
  expected: Partial<ResourceSnapshot>;
  before: ResourceSnapshot | null;
  row: number;
};
export type Stage1Plan = {
  version: 1;
  account_id: string;
  intent: Stage1Intent;
  checks: { query: string; rows: ResourceSnapshot[] }[];
  operations: Stage1Operation[];
  items: {
    item: number;
    keyword: string;
    campaign_id: string;
    campaign_name: string;
    ad_group_id: string;
    ad_group_name: string;
    before: unknown;
    after: unknown;
    warnings: string[];
    conflicts: unknown[];
    duplicate_status: string;
    provider_operations: number[];
  }[];
};
export type Stage1MutationResult = {
  success: boolean;
  resource_name: string | null;
  error: GoogleWriteFailure | null;
};
export type Stage1Reader = (
  query: string,
) => Promise<Record<string, unknown>[]>;
const actions: Stage1Action[] = [
  "keyword_add",
  "keyword_match",
  "keyword_url",
  "keyword_remove",
  "negative_add",
  "negative_remove",
  "shared_create",
  "shared_attach",
  "shared_detach",
];
const matches = ["BROAD", "PHRASE", "EXACT"];
const kinds = {
  adGroupCriteria: "ad_group_criterion",
  campaignCriteria: "campaign_criterion",
  sharedSets: "shared_set",
  sharedCriteria: "shared_criterion",
  campaignSharedSets: "campaign_shared_set",
  campaigns: "campaign",
  adGroups: "ad_group",
  customers: "customer",
} as const;
const fields = {
  adGroupCriteria:
    "campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.final_urls, ad_group_criterion.cpc_bid_micros, ad_group_criterion.type",
  campaignCriteria:
    "campaign.id, campaign.name, campaign_criterion.resource_name, campaign_criterion.criterion_id, campaign_criterion.keyword.text, campaign_criterion.keyword.match_type, campaign_criterion.status, campaign_criterion.negative, campaign_criterion.type",
  sharedSets:
    "shared_set.resource_name, shared_set.id, shared_set.name, shared_set.status, shared_set.type",
  sharedCriteria:
    "shared_criterion.resource_name, shared_criterion.criterion_id, shared_criterion.shared_set, shared_criterion.keyword.text, shared_criterion.keyword.match_type, shared_criterion.type",
  campaignSharedSets:
    "campaign.id, campaign.name, campaign_shared_set.resource_name, campaign_shared_set.campaign, campaign_shared_set.shared_set, campaign_shared_set.status",
  campaigns:
    "campaign.resource_name, campaign.id, campaign.name, campaign.status",
  adGroups:
    "campaign.id, campaign.name, ad_group.resource_name, ad_group.id, ad_group.name, ad_group.status",
  customers: "customer.resource_name, customer.id, customer.currency_code",
} as const;
export function stage1Error(code: string, message: string): never {
  throw new GoogleAdsWriteError(code, message);
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function normalizeKeywordText(value: unknown): string {
  if (typeof value !== "string")
    stage1Error(
      "google_keyword_text_invalid",
      "Укажите текст ключевого слова.",
    );
  const text = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (
    !text ||
    text.length > 80 ||
    [...text].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    stage1Error(
      "google_keyword_text_invalid",
      "Текст ключа должен содержать 1–80 символов без управляющих символов.",
    );
  return text;
}
export function finalUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 2048)
    stage1Error(
      "google_final_url_invalid",
      "Укажите абсолютный HTTP(S) final_url или null для сброса.",
    );
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      !url.hostname.includes(".")
    )
      throw new Error();
    return url.href;
  } catch {
    return stage1Error(
      "google_final_url_invalid",
      "Final URL должен быть абсолютным HTTP(S) адресом без логина и пароля.",
    );
  }
}
export function currencyMicros(
  amount: string,
  currency: string,
  actualCurrency: string,
): string {
  if (currency !== actualCurrency)
    stage1Error(
      "google_currency_mismatch",
      `Валюта ставки должна совпадать с валютой аккаунта (${actualCurrency}).`,
    );
  if (!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,6})?$/.test(amount))
    stage1Error(
      "google_bid_invalid",
      "CPC задаётся обычной суммой в валюте аккаунта, не micros; не более 6 знаков после точки.",
    );
  const [whole, fraction = ""] = amount.split(".");
  const micros = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (micros <= 0n)
    stage1Error("google_bid_invalid", "CPC должен быть больше нуля.");
  return micros.toString();
}
export function parseStage1Intent(raw: unknown): Stage1Intent {
  const input = record(raw);
  if (
    Object.keys(input).some((k) => !["action", "level", "items"].includes(k)) ||
    !actions.includes(input.action as Stage1Action) ||
    !Array.isArray(input.items)
  )
    stage1Error(
      "google_stage1_input_invalid",
      "Укажите тип операции и items без raw mutation полей.",
    );
  const action = input.action as Stage1Action;
  assertGoogleBatch(input.items);
  if (action === "keyword_match" && input.items.length > 250)
    stage1Error(
      "google_batch_limit_exceeded",
      "Не более 500 операций Google Ads: match type требует две операции на ключ. Разделите batch.",
    );
  const level = input.level as Stage1Intent["level"];
  if (
    action.startsWith("negative_")
      ? !["campaign", "ad_group", "shared_list"].includes(String(level))
      : level !== undefined
  )
    stage1Error(
      "google_stage1_input_invalid",
      "Для negative укажите campaign, ad_group или shared_list; другие операции не принимают level.",
    );
  const items = input.items.map((value) => {
    const item = record(value);
    const needed =
      action === "shared_create"
        ? ["shared_list_name"]
        : action.startsWith("shared_")
          ? ["shared_set_id", "campaign_id"]
          : action.startsWith("negative_")
            ? [
                ...(level === "shared_list"
                  ? ["shared_set_id"]
                  : [
                      "campaign_id",
                      ...(level === "ad_group" ? ["ad_group_id"] : []),
                    ]),
                ...(action === "negative_add"
                  ? ["text", "match_type"]
                  : ["criterion_id"]),
              ]
            : [
                "campaign_id",
                "ad_group_id",
                ...(action === "keyword_add"
                  ? ["text", "match_type"]
                  : [
                      "criterion_id",
                      ...(action === "keyword_match"
                        ? ["match_type"]
                        : action === "keyword_url"
                          ? ["final_url"]
                          : []),
                    ]),
              ];
    const allowed = [
      ...needed,
      ...(action === "keyword_add" ? ["cpc_bid", "final_url"] : []),
    ];
    if (
      Object.keys(item).some((k) => !allowed.includes(k)) ||
      needed.some((k) => item[k] === undefined)
    )
      stage1Error(
        "google_stage1_input_invalid",
        `Для ${action} обязательны: ${needed.join(", ")}. Лишние поля запрещены.`,
      );
    for (const k of allowed.filter((k) => k.endsWith("_id")))
      if (typeof item[k] !== "string" || !/^\d{1,20}$/.test(item[k] as string))
        stage1Error(
          "google_resource_identity_invalid",
          `Укажите числовой ${k}.`,
        );
    if (item.text !== undefined) item.text = normalizeKeywordText(item.text);
    if (
      item.match_type !== undefined &&
      !matches.includes(String(item.match_type))
    )
      stage1Error(
        "google_match_type_invalid",
        "Match type: BROAD, PHRASE или EXACT.",
      );
    if (item.final_url !== undefined) item.final_url = finalUrl(item.final_url);
    if (
      item.shared_list_name !== undefined &&
      (typeof item.shared_list_name !== "string" ||
        !item.shared_list_name.trim() ||
        item.shared_list_name.length > 255 ||
        [...item.shared_list_name].some((c) => c.charCodeAt(0) < 32))
    )
      stage1Error(
        "google_shared_name_invalid",
        "Укажите имя списка из 1–255 символов.",
      );
    if (typeof item.shared_list_name === "string")
      item.shared_list_name = item.shared_list_name.trim();
    if (item.cpc_bid !== undefined) {
      const bid = record(item.cpc_bid);
      if (
        Object.keys(bid).sort().join(",") !== "amount,currency" ||
        typeof bid.amount !== "string" ||
        typeof bid.currency !== "string" ||
        !/^[A-Z]{3}$/.test(bid.currency)
      )
        stage1Error(
          "google_bid_invalid",
          "cpc_bid: amount — обычная десятичная сумма строкой, currency — ISO валюта аккаунта.",
        );
      currencyMicros(bid.amount, bid.currency, bid.currency);
    }
    return item as Stage1Item;
  });
  if (new Set(items.map(canonical)).size !== items.length)
    stage1Error(
      "google_duplicate_input",
      "Batch содержит повторяющиеся строки.",
    );
  const targets = items
    .filter((x) => x.criterion_id)
    .map(
      (x) =>
        `${x.campaign_id}/${x.ad_group_id}/${x.shared_set_id}/${x.criterion_id}`,
    );
  if (new Set(targets).size !== targets.length)
    stage1Error(
      "google_duplicate_input",
      "Один ресурс нельзя изменять дважды в preview.",
    );
  return { action, ...(level ? { level } : {}), items };
}
export function resourceQuery(
  kind: ResourceSnapshot["kind"],
  where = "",
): string {
  return `SELECT ${fields[kind]} FROM ${kinds[kind]}${where ? ` WHERE ${where}` : ""}`;
}
export function normalizeResources(
  kind: ResourceSnapshot["kind"],
  rows: Record<string, unknown>[],
): ResourceSnapshot[] {
  if (rows.length > 20_000)
    stage1Error(
      "google_inventory_limit",
      "Инвентарь слишком большой для безопасной полной проверки. Разделите preview по кампании/группе.",
    );
  return rows
    .map((row) => {
      const key = kinds[kind].replace(/_([a-z])/g, (_, c: string) =>
        c.toUpperCase(),
      );
      const entity = record(row[key]),
        campaign = record(row.campaign),
        group = record(row.adGroup),
        keyword = record(entity.keyword);
      const resource = String(entity.resourceName ?? "");
      const suffix = [
        "adGroupCriteria",
        "campaignCriteria",
        "sharedCriteria",
        "campaignSharedSets",
      ].includes(kind)
        ? "[0-9]{1,20}~[0-9]{1,20}"
        : "[0-9]{1,20}";
      const resourcePattern =
        kind === "customers"
          ? /^customers\/[0-9]{10}$/
          : new RegExp(`^customers/[0-9]{10}/${kind}/${suffix}$`);
      const tail = resource.split("/").at(-1) ?? "",
        [parentId, criterionId] = tail.split("~");
      const id = String(entity.id ?? entity.criterionId ?? "");
      const validParent =
        kind === "adGroupCriteria"
          ? parentId === String(group.id) && criterionId === id
          : kind === "campaignCriteria"
            ? parentId === String(campaign.id) && criterionId === id
            : kind === "sharedCriteria"
              ? parentId === String(entity.sharedSet).split("/").at(-1) &&
                criterionId === id
              : kind === "campaignSharedSets"
                ? parentId === String(campaign.id) &&
                  criterionId === String(entity.sharedSet).split("/").at(-1)
                : tail === id;
      if (!resourcePattern.test(resource) || !validParent)
        stage1Error(
          "google_provider_response_invalid",
          "Google не вернул идентификатор ресурса.",
        );
      return {
        kind,
        resource_name: resource,
        id: String(entity.id ?? entity.criterionId ?? ""),
        campaign_id: String(
          campaign.id ?? (kind === "campaigns" ? entity.id : ""),
        ),
        campaign_name: String(campaign.name ?? ""),
        ad_group_id: String(group.id ?? (kind === "adGroups" ? entity.id : "")),
        ad_group_name: String(group.name ?? ""),
        shared_set_id:
          String(entity.sharedSet ?? "")
            .split("/")
            .pop() ?? "",
        name: String(entity.name ?? ""),
        text: String(keyword.text ?? ""),
        match_type: String(keyword.matchType ?? ""),
        status: String(entity.status ?? ""),
        negative: entity.negative === true,
        final_urls: Array.isArray(entity.finalUrls)
          ? entity.finalUrls.map(String)
          : [],
        cpc_bid_micros: String(entity.cpcBidMicros ?? "0"),
        currency: String(entity.currencyCode ?? ""),
        type: String(entity.type ?? ""),
      };
    })
    .sort((a, b) => a.resource_name.localeCompare(b.resource_name, "en"));
}
function sameText(a: string, b: string) {
  return (
    a.normalize("NFC").toLocaleLowerCase("und") ===
    b.normalize("NFC").toLocaleLowerCase("und")
  );
}
export function conflictReason(
  text: string,
  match_type: MatchType,
  keyword: string,
): string | null {
  return negativeMatch(
    { text: text.toLocaleLowerCase("und"), match_type },
    keyword,
  )
    ? {
        BROAD: "BROAD_ALL_TERMS_PRESENT",
        PHRASE: "PHRASE_CONTIGUOUS_ORDER",
        EXACT: "EXACT_NORMALIZED_TEXT",
      }[match_type]
    : null;
}
/** Shared typed criterion constructor for existing and temporary campaign parents. */
export function keywordCreateFields(
  item: Stage1Item,
  parent: { adGroup?: string; campaign?: string; sharedSet?: string },
  negative: boolean,
  currency: string,
): Stage1Operation["fields"] {
  return {
    ...parent,
    keyword: {
      text: normalizeKeywordText(item.text),
      matchType: item.match_type!,
    },
    ...(parent.sharedSet ? {} : { negative }),
    ...(!negative ? { status: "ENABLED" as const } : {}),
    ...(item.cpc_bid
      ? {
          cpcBidMicros: currencyMicros(
            item.cpc_bid.amount,
            item.cpc_bid.currency,
            currency,
          ),
        }
      : {}),
    ...(item.final_url ? { finalUrls: [finalUrl(item.final_url)!] } : {}),
  };
}
function active(row: ResourceSnapshot) {
  return (
    row.kind === "sharedCriteria" ||
    row.kind === "customers" ||
    ["ENABLED", "PAUSED"].includes(row.status)
  );
}
function expectOne(
  rows: ResourceSnapshot[],
  message: string,
): ResourceSnapshot {
  if (rows.length !== 1 || !active(rows[0]!))
    stage1Error("google_resource_unavailable", message);
  return rows[0]!;
}
export async function buildStage1Plan(
  account: string,
  raw: unknown,
  read: Stage1Reader,
): Promise<Stage1Plan> {
  const account_id = customerId(account),
    intent = parseStage1Intent(raw),
    checks: Stage1Plan["checks"] = [];
  const query = async (kind: ResourceSnapshot["kind"], where = "") => {
    const sql = resourceQuery(kind, where),
      cached = checks.find((c) => c.query === sql);
    if (cached) return cached.rows;
    const rows = normalizeResources(kind, await read(sql));
    if (
      rows.some(
        (x) =>
          x.resource_name !== `customers/${account_id}` &&
          !x.resource_name.startsWith(`customers/${account_id}/`),
      )
    )
      stage1Error(
        "google_resource_account_mismatch",
        "Google ресурс относится к другому аккаунту.",
      );
    checks.push({ query: sql, rows });
    return rows;
  };
  const operations: Stage1Operation[] = [],
    items: Stage1Plan["items"] = [];
  for (const [index, item] of intent.items.entries()) {
    let campaign: ResourceSnapshot | null = null,
      group: ResourceSnapshot | null = null;
    if (item.campaign_id)
      campaign = expectOne(
        await query("campaigns", `campaign.id = ${item.campaign_id}`),
        "Кампания не найдена или удалена.",
      );
    if (item.ad_group_id) {
      group = expectOne(
        await query("adGroups", `ad_group.id = ${item.ad_group_id}`),
        "Группа объявлений не найдена или удалена.",
      );
      if (group.campaign_id !== item.campaign_id)
        stage1Error(
          "google_group_campaign_mismatch",
          "Группа не принадлежит выбранной кампании.",
        );
    }
    if (item.shared_set_id) {
      const set = expectOne(
        await query("sharedSets", `shared_set.id = ${item.shared_set_id}`),
        "Shared negative list не найден или удалён.",
      );
      if (set.type !== "NEGATIVE_KEYWORDS")
        stage1Error(
          "google_shared_type_invalid",
          "Выберите shared negative keyword list.",
        );
    }
    const display: Stage1Plan["items"][number] = {
      item: index,
      keyword: item.text ?? item.shared_list_name ?? "",
      campaign_id: item.campaign_id ?? "",
      campaign_name: campaign?.name ?? "",
      ad_group_id: item.ad_group_id ?? "",
      ad_group_name: group?.name ?? "",
      before: null,
      after: item,
      warnings: [],
      conflicts: [],
      duplicate_status: "none",
      provider_operations: [],
    };
    const add = (operation: Omit<Stage1Operation, "row">) => {
      display.provider_operations.push(operations.length);
      operations.push({ ...operation, row: index });
    };
    const criterionInventory = async (negative: boolean) => {
      const kind: GoogleResourceKind =
        intent.level === "campaign"
          ? "campaignCriteria"
          : intent.level === "shared_list"
            ? "sharedCriteria"
            : "adGroupCriteria";
      const where =
        kind === "campaignCriteria"
          ? `campaign.id = ${item.campaign_id} AND campaign_criterion.type = KEYWORD`
          : kind === "sharedCriteria"
            ? `shared_criterion.shared_set = 'customers/${account_id}/sharedSets/${item.shared_set_id}' AND shared_criterion.type = KEYWORD`
            : `ad_group.id = ${item.ad_group_id} AND ad_group_criterion.type = KEYWORD`;
      return {
        kind,
        rows: (await query(kind, where)).filter(
          (x) =>
            active(x) &&
            x.type === "KEYWORD" &&
            (kind === "sharedCriteria" || x.negative === negative),
        ),
      };
    };
    if (
      intent.action.startsWith("keyword_") ||
      intent.action.startsWith("negative_")
    ) {
      const negative = intent.action.startsWith("negative_"),
        { kind, rows } = await criterionInventory(negative);
      const existing = item.criterion_id
        ? expectOne(
            rows.filter((x) => x.id === item.criterion_id),
            "Критерий не найден или не соответствует группе/кампании и типу positive/negative.",
          )
        : null;
      if (existing) {
        display.before = existing;
        display.keyword = existing.text;
      }
      if (intent.action === "keyword_url") {
        const urls = item.final_url === null ? [] : [item.final_url!];
        if (canonical(existing!.final_urls) === canonical(urls))
          stage1Error(
            "google_no_change",
            "Final URL уже установлен; изменение не требуется.",
          );
        display.after = { final_urls: urls };
        add({
          kind,
          method: "update",
          resource_name: existing!.resource_name,
          fields: { resourceName: existing!.resource_name, finalUrls: urls },
          update_mask: "final_urls",
          before: existing,
          expected: { final_urls: urls },
        });
      } else if (
        intent.action === "keyword_remove" ||
        intent.action === "negative_remove"
      ) {
        if (!negative)
          display.warnings.push(
            "ПОСТОЯННОЕ УДАЛЕНИЕ: удалённый ключ нельзя восстановить. Более безопасная альтернатива — PAUSE.",
          );
        display.after = { status: "REMOVED", reversible: false };
        add({
          kind,
          method: "remove",
          resource_name: existing!.resource_name,
          fields: {},
          update_mask: null,
          before: existing,
          expected: { status: "REMOVED" },
        });
      } else {
        const text =
            intent.action === "keyword_match" ? existing!.text : item.text!,
          match_type = item.match_type!;
        if (
          intent.action === "keyword_match" &&
          existing!.match_type === match_type
        )
          stage1Error("google_no_change", "Match type уже установлен.");
        const duplicate = rows.find(
          (x) => sameText(x.text, text) && x.match_type === match_type,
        );
        if (duplicate)
          stage1Error(
            "google_keyword_duplicate",
            `Эквивалентный действующий критерий уже существует: ${duplicate.resource_name}.`,
          );
        // Also detect equivalent rows inside this pending batch, before Google is contacted.
        if (
          operations.some(
            (x) =>
              x.method === "create" &&
              x.kind === kind &&
              x.fields.adGroup ===
                (item.ad_group_id
                  ? `customers/${account_id}/adGroups/${item.ad_group_id}`
                  : undefined) &&
              x.fields.campaign ===
                (kind === "campaignCriteria"
                  ? `customers/${account_id}/campaigns/${item.campaign_id}`
                  : undefined) &&
              x.fields.sharedSet ===
                (kind === "sharedCriteria"
                  ? `customers/${account_id}/sharedSets/${item.shared_set_id}`
                  : undefined) &&
              x.fields.keyword?.matchType === match_type &&
              sameText(x.fields.keyword.text, text),
          )
        )
          stage1Error(
            "google_keyword_duplicate",
            "Batch содержит эквивалентные создаваемые критерии.",
          );
        const currency = item.cpc_bid
          ? expectOne(
              await query("customers"),
              "Не удалось определить валюту аккаунта.",
            ).currency
          : "";
        const mutation = keywordCreateFields(
          { ...item, text, match_type },
          kind === "adGroupCriteria"
            ? {
                adGroup: `customers/${account_id}/adGroups/${item.ad_group_id}`,
              }
            : kind === "campaignCriteria"
              ? {
                  campaign: `customers/${account_id}/campaigns/${item.campaign_id}`,
                }
              : {
                  sharedSet: `customers/${account_id}/sharedSets/${item.shared_set_id}`,
                },
          negative,
          currency,
        );
        if (intent.action === "keyword_match") {
          mutation.finalUrls = existing!.final_urls;
          if (existing!.cpc_bid_micros !== "0")
            mutation.cpcBidMicros = existing!.cpc_bid_micros;
        } else if (item.final_url) mutation.finalUrls = [item.final_url];
        const conflicts: {
          negative: string;
          affected_keyword: string;
          resource_name: string;
          campaign_id: string;
          ad_group_id: string;
          reason_code: string;
        }[] = [];
        if (negative) {
          let campaignIds = item.campaign_id
            ? [item.campaign_id]
            : (
                await query(
                  "campaignSharedSets",
                  `campaign_shared_set.shared_set = 'customers/${account_id}/sharedSets/${item.shared_set_id}' AND campaign_shared_set.status = ENABLED`,
                )
              ).map((x) => x.campaign_id);
          campaignIds = [...new Set(campaignIds)];
          for (const campaignId of campaignIds) {
            const activeKeywords = await query(
              "adGroupCriteria",
              `campaign.id = ${campaignId} AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status = ENABLED${intent.level === "ad_group" ? ` AND ad_group.id = ${item.ad_group_id}` : ""}`,
            );
            for (const keyword of activeKeywords) {
              const reason = conflictReason(text, match_type, keyword.text);
              if (reason)
                conflicts.push({
                  negative: text,
                  affected_keyword: keyword.text,
                  resource_name: keyword.resource_name,
                  campaign_id: keyword.campaign_id,
                  ad_group_id: keyword.ad_group_id,
                  reason_code: reason,
                });
            }
          }
        } else {
          const negatives = [
            ...(await query(
              "campaignCriteria",
              `campaign.id = ${item.campaign_id} AND campaign_criterion.type = KEYWORD AND campaign_criterion.negative = TRUE`,
            )),
            ...(await query(
              "adGroupCriteria",
              `ad_group.id = ${item.ad_group_id} AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = TRUE`,
            )),
          ];
          const links = await query(
            "campaignSharedSets",
            `campaign.id = ${item.campaign_id} AND campaign_shared_set.status = ENABLED`,
          );
          for (const link of links)
            negatives.push(
              ...(await query(
                "sharedCriteria",
                `shared_criterion.shared_set = 'customers/${account_id}/sharedSets/${link.shared_set_id}' AND shared_criterion.type = KEYWORD`,
              )),
            );
          for (const criterion of negatives.filter(active)) {
            const reason = conflictReason(
              criterion.text,
              criterion.match_type as MatchType,
              text,
            );
            if (reason)
              conflicts.push({
                negative: criterion.text,
                affected_keyword: text,
                resource_name: criterion.resource_name,
                campaign_id: item.campaign_id!,
                ad_group_id: item.ad_group_id!,
                reason_code: reason,
              });
          }
        }
        display.conflicts = conflicts;
        if (conflicts.length)
          display.warnings.push(
            `Минус-слово блокирует действующий/создаваемый ключ: ${conflicts.length} конфликтов. Проверьте строки перед подтверждением.`,
          );
        display.after = { ...mutation, cpc_bid: item.cpc_bid ?? null };
        add({
          kind,
          method: "create",
          resource_name: null,
          fields: mutation,
          update_mask: null,
          before: null,
          expected: {
            text,
            match_type,
            ...(kind === "adGroupCriteria"
              ? {
                  ad_group_id: item.ad_group_id!,
                  campaign_id: item.campaign_id!,
                  negative,
                  ...(!negative
                    ? {
                        status: "ENABLED",
                        final_urls: mutation.finalUrls ?? [],
                      }
                    : {}),
                }
              : kind === "campaignCriteria"
                ? { campaign_id: item.campaign_id!, negative: true }
                : { shared_set_id: item.shared_set_id! }),
            ...(mutation.cpcBidMicros
              ? { cpc_bid_micros: mutation.cpcBidMicros }
              : {}),
          },
        });
        if (intent.action === "keyword_match") {
          display.after = { new_keyword: mutation, old_status: "PAUSED" };
          display.warnings.push(
            "Две операции: создать новый ключ и приостановить старый. При частичном результате возможны два активных ключа; автоматический rollback не поддерживается.",
          );
          add({
            kind,
            method: "update",
            resource_name: existing!.resource_name,
            fields: { resourceName: existing!.resource_name, status: "PAUSED" },
            update_mask: "status",
            before: existing,
            expected: { status: "PAUSED" },
          });
        }
      }
    } else if (intent.action === "shared_create") {
      if (
        operations.some(
          (x) =>
            x.kind === "sharedSets" &&
            x.fields.name &&
            sameText(x.fields.name, item.shared_list_name!),
        )
      )
        stage1Error(
          "google_shared_duplicate",
          "Batch содержит эквивалентные имена shared lists.",
        );
      if (
        (await query("sharedSets")).some(
          (x) => active(x) && sameText(x.name, item.shared_list_name!),
        )
      )
        stage1Error(
          "google_shared_duplicate",
          "Shared list с таким именем уже существует.",
        );
      add({
        kind: "sharedSets",
        method: "create",
        resource_name: null,
        fields: { name: item.shared_list_name!, type: "NEGATIVE_KEYWORDS" },
        update_mask: null,
        before: null,
        expected: {
          name: item.shared_list_name!,
          type: "NEGATIVE_KEYWORDS",
          status: "ENABLED",
        },
      });
    } else {
      const links = await query(
        "campaignSharedSets",
        `campaign.id = ${item.campaign_id} AND campaign_shared_set.shared_set = 'customers/${account_id}/sharedSets/${item.shared_set_id}'`,
      );
      const link = links.find((x) => active(x));
      if (intent.action === "shared_attach") {
        if (link)
          stage1Error(
            "google_shared_duplicate",
            "Список уже подключён к кампании.",
          );
        add({
          kind: "campaignSharedSets",
          method: "create",
          resource_name: null,
          fields: {
            campaign: `customers/${account_id}/campaigns/${item.campaign_id}`,
            sharedSet: `customers/${account_id}/sharedSets/${item.shared_set_id}`,
          },
          update_mask: null,
          before: null,
          expected: {
            campaign_id: item.campaign_id!,
            shared_set_id: item.shared_set_id!,
            status: "ENABLED",
          },
        });
        const members = await query(
          "sharedCriteria",
          `shared_criterion.shared_set = 'customers/${account_id}/sharedSets/${item.shared_set_id}' AND shared_criterion.type = KEYWORD`,
        );
        const keywords = await query(
          "adGroupCriteria",
          `campaign.id = ${item.campaign_id} AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status = ENABLED`,
        );
        for (const member of members)
          for (const keyword of keywords) {
            const reason = conflictReason(
              member.text,
              member.match_type as MatchType,
              keyword.text,
            );
            if (reason)
              display.conflicts.push({
                negative: member.text,
                affected_keyword: keyword.text,
                campaign_id: keyword.campaign_id,
                ad_group_id: keyword.ad_group_id,
                reason_code: reason,
              });
          }
        if (display.conflicts.length)
          display.warnings.push(
            `Подключение списка блокирует активные ключи: ${display.conflicts.length} конфликтов.`,
          );
      } else {
        if (!link)
          stage1Error(
            "google_shared_not_attached",
            "Список не подключён к кампании.",
          );
        display.before = link;
        add({
          kind: "campaignSharedSets",
          method: "remove",
          resource_name: link.resource_name,
          fields: {},
          update_mask: null,
          before: link,
          expected: { status: "REMOVED" },
        });
      }
    }
    items.push(display);
  }
  assertGoogleBatch(operations);
  return { version: 1, account_id, intent, checks, operations, items };
}
export async function rereadStage1Checks(plan: Stage1Plan, read: Stage1Reader) {
  const result: Stage1Plan["checks"] = [];
  for (const check of plan.checks) {
    const kind = Object.entries(kinds).find(
      ([, table]) =>
        check.query.includes(` FROM ${table}`) &&
        (check.query.includes(` FROM ${table} `) ||
          check.query.endsWith(` FROM ${table}`)),
    )?.[0] as ResourceSnapshot["kind"] | undefined;
    if (!kind)
      stage1Error("google_plan_invalid", "Неизвестный snapshot selector.");
    result.push({
      query: check.query,
      rows: normalizeResources(kind, await read(check.query)),
    });
  }
  return result;
}
export function providerOperation(operation: Stage1Operation) {
  return operation.method === "remove"
    ? { remove: operation.resource_name }
    : operation.method === "create"
      ? { create: operation.fields }
      : { update: operation.fields, updateMask: operation.update_mask };
}
export function decodeStage1Mutation(
  payload: unknown,
  plan: {
    account_id: string;
    operations: { kind: string; resource_name: string | null }[];
  },
  validateOnly: boolean,
): Stage1MutationResult[] {
  const root = record(payload),
    partial = record(root.partialFailureError),
    errors = new Map<number, GoogleWriteFailure>();
  let globalFailure = false;
  if (Number(partial.code ?? 0)) {
    for (const detail of Array.isArray(partial.details) ? partial.details : [])
      for (const entry of Array.isArray(record(detail).errors)
        ? (record(detail).errors as unknown[])
        : []) {
        const error = record(entry),
          elements = record(error.location).fieldPathElements;
        const path = Array.isArray(elements) ? elements.map(record) : [],
          index = path.find((x) => x.fieldName === "operations")?.index;
        if (
          !Number.isInteger(index) ||
          Number(index) < 0 ||
          Number(index) >= plan.operations.length
        ) {
          globalFailure = true;
          continue;
        }
        const code =
          Object.values(record(error.errorCode)).find(
            (x) => typeof x === "string",
          ) ?? "GOOGLE_ADS_ERROR";
        errors.set(
          Number(index),
          googleWriteFailure(
            String(code),
            path
              .filter(
                (x) =>
                  typeof x.fieldName === "string" &&
                  /^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(x.fieldName) &&
                  (x.index === undefined ||
                    (Number.isInteger(x.index) &&
                      Number(x.index) >= 0 &&
                      Number(x.index) <= 500)),
              )
              .map(
                (x) =>
                  `${String(x.fieldName)}${x.index !== undefined ? `[${x.index}]` : ""}`,
              )
              .join("."),
          ),
        );
      }
    if (!errors.size) globalFailure = true;
  }
  const results = Array.isArray(root.results) ? root.results : [];
  return plan.operations.map((operation, index) => {
    const resource =
      typeof record(results[index]).resourceName === "string"
        ? String(record(results[index]).resourceName)
        : null;
    const suffix =
      operation.kind === "adGroupCriteria" ||
      operation.kind === "campaignCriteria" ||
      operation.kind === "campaignSharedSets" ||
      operation.kind === "sharedCriteria"
        ? "[0-9]{1,20}~[0-9]{1,20}"
        : "[0-9]{1,20}";
    const validResource =
      resource &&
      new RegExp(
        `^customers/${plan.account_id}/${operation.kind}/${suffix}$`,
      ).test(resource) &&
      (!operation.resource_name || resource === operation.resource_name);
    const error =
      errors.get(index) ??
      (globalFailure
        ? googleWriteFailure("GOOGLE_ADS_ERROR")
        : !validateOnly && !validResource
          ? googleWriteFailure("OUTCOME_UNCERTAIN")
          : null);
    return {
      success: !error,
      resource_name: validateOnly ? operation.resource_name : resource,
      error,
    };
  });
}
export async function verifyStage1Mutation(
  plan: Stage1Plan,
  results: Stage1MutationResult[],
  read: Stage1Reader,
) {
  // One complete resource query per service; bounded single-row fallback preserves
  // successful rows without 500 sequential API round trips in normal batches.
  const observed = new Map<string, ResourceSnapshot | null>();
  const targets = plan.operations
    .map((operation, index) => ({
      kind: operation.kind,
      resource: results[index]?.resource_name ?? operation.resource_name,
    }))
    .filter((x): x is { kind: GoogleResourceKind; resource: string } =>
      Boolean(
        x.resource &&
        new RegExp(
          `^customers/${plan.account_id}/${x.kind}/[0-9]{1,20}(?:~[0-9]{1,20})?$`,
        ).test(x.resource),
      ),
    );
  for (const kind of new Set(targets.map((x) => x.kind))) {
    const resources = [
      ...new Set(targets.filter((x) => x.kind === kind).map((x) => x.resource)),
    ];
    try {
      const rows = normalizeResources(
        kind,
        await read(
          resourceQuery(
            kind,
            `${kinds[kind]}.resource_name IN (${resources.map((x) => `'${x}'`).join(", ")})`,
          ),
        ),
      );
      for (const resource of resources) {
        const matches = rows.filter((x) => x.resource_name === resource);
        if (matches.length <= 1) observed.set(resource, matches[0] ?? null);
      }
    } catch {
      let next = 0;
      await Promise.all(
        Array.from({ length: Math.min(6, resources.length) }, async () => {
          while (next < resources.length) {
            const resource = resources[next++]!;
            try {
              const rows = normalizeResources(
                kind,
                await read(
                  resourceQuery(
                    kind,
                    `${kinds[kind]}.resource_name = '${resource}'`,
                  ),
                ),
              );
              const matches = rows.filter((x) => x.resource_name === resource);
              if (matches.length <= 1)
                observed.set(resource, matches[0] ?? null);
            } catch {
              /* Never retry a mutation. */
            }
          }
        }),
      );
    }
  }
  const actual: (ResourceSnapshot | null)[] = [];
  const operationResults: {
    operation: number;
    resource_name: string | null;
    success: boolean;
    before: ResourceSnapshot | null;
    requested: Partial<ResourceSnapshot>;
    actual: ResourceSnapshot | null;
    error: GoogleWriteFailure | null;
  }[] = [];
  for (const [index, operation] of plan.operations.entries()) {
    const result = results[index] ?? {
      success: false,
      resource_name: null,
      error: googleWriteFailure("OUTCOME_UNCERTAIN"),
    };
    const resource = result.resource_name ?? operation.resource_name;
    const readSucceeded = Boolean(resource && observed.has(resource));
    const state = resource ? (observed.get(resource) ?? null) : null;
    actual.push(state);
    const verified =
      operation.method === "remove"
        ? readSucceeded && (!state || state.status === "REMOVED")
        : Boolean(
            state &&
            Object.entries(operation.expected).every(
              ([key, value]) =>
                canonical(state[key as keyof ResourceSnapshot]) ===
                canonical(value),
            ),
          );
    const success = result.success && verified;
    operationResults.push({
      operation: index,
      resource_name: resource,
      success,
      before: operation.before,
      requested: operation.expected,
      actual: state,
      error: success
        ? null
        : (result.error ??
          googleWriteFailure(
            !readSucceeded ? "OUTCOME_UNCERTAIN" : "VERIFICATION_MISMATCH",
          )),
    });
  }
  const items = plan.items.map((item) => {
    const rows = item.provider_operations.map(
      (index) => operationResults[index]!,
    );
    const success = rows.every((x) => x.success),
      partial = rows.some((x) => x.success) && !success;
    return {
      ...item,
      success,
      result: success ? "success" : partial ? "DEGRADED" : "failure",
      operations: rows,
      ...(partial
        ? {
            remediation:
              "Операция применена частично. Проверьте actual каждой строки; создайте отдельный preview для PAUSE лишнего ключа или восстановления старого. Не повторяйте commit.",
          }
        : {}),
    };
  });
  return {
    items,
    actual,
    status: items.every((x) => x.success)
      ? "VERIFIED"
      : items.some((x) => x.success || x.result === "DEGRADED")
        ? "PARTIAL_FAILURE"
        : "NOT_VERIFIED",
  };
}

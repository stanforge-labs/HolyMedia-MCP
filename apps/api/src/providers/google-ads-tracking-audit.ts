import { isIP } from "node:net";
import type { Stage1Reader } from "./google-ads-stage1.js";
import { customerId } from "./google-ads-write.js";
import { ProviderError } from "./provider.errors.js";
import type { ProviderReadContext } from "./provider.types.js";

export type TrackingAuditOptions = {
  campaign_ids?: string[];
  ad_group_ids?: string[];
  ad_id?: string;
  limit?: number;
};
export type TrackingAuditWarning = {
  source: "HOLYMEDIA";
  code: string;
  message: string;
  field: string;
};
type Level = "account" | "campaign" | "ad_group" | "ad" | "keyword";
type RecordRow = Record<string, unknown>;
type Local = {
  template: string;
  suffix: string;
  final_urls: string[];
  final_mobile_urls: string[];
  custom_parameters: { key: string; value: string }[];
};
type Resolved = {
  state: "RESOLVED" | "UNKNOWN_AD_CONTEXT";
  value: string | null;
  source_resource: string | null;
};
type Entity = {
  level: Level;
  id: string;
  resource_name: string;
  campaign_id: string | null;
  ad_group_id: string | null;
  status: string;
  local: Local;
};
export interface GoogleTrackingAuditReadAdapter {
  trackingAudit(
    context: ProviderReadContext,
    action: "specs" | "audit",
    options: unknown,
  ): Promise<GoogleTrackingReport>;
}
export type GoogleTrackingReport = {
  provider: "GOOGLE_ADS";
  account_id: string;
  auto_tagging_enabled: boolean;
  audit_kind: "PROVIDER_TRACKING_SPECS" | "SYNTAX_AND_INHERITANCE_ONLY";
  landing_reachability: "NOT_CHECKED";
  serving_url_expansion: "NOT_EXECUTED";
  complete: boolean;
  truncated_levels: Level[];
  read_call_count: number;
  validate_only_call_count: 0;
  real_write_call_count: 0;
  rows: (Omit<Entity, "local"> & {
    local: Local;
    effective: { template: Resolved; suffix: Resolved; final_urls: Resolved };
    warnings: TrackingAuditWarning[];
  })[];
  warnings: TrackingAuditWarning[];
};
const rec = (v: unknown): RecordRow =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as RecordRow) : {};
const get = (r: RecordRow, key: string): unknown =>
  r[key] ?? r[key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)];
const text = (v: unknown): string => (typeof v === "string" ? v : "");
const id = (v: unknown): string => {
  const s =
    typeof v === "string" ? v : Number.isSafeInteger(v) ? String(v) : "";
  if (!/^[0-9]{1,20}$/.test(s))
    throw new ProviderError(
      "invalid_request",
      "Требуется числовой Google resource ID.",
    );
  return s;
};
const warn = (
  code: string,
  field: string,
  message: string,
): TrackingAuditWarning => ({
  source: "HOLYMEDIA",
  code,
  field,
  message,
});
export function parseTrackingAuditOptions(raw: unknown): TrackingAuditOptions {
  const r = raw === undefined ? {} : rec(raw);
  if (
    raw !== undefined &&
    (!raw || typeof raw !== "object" || Array.isArray(raw))
  )
    throw new ProviderError(
      "invalid_request",
      "Tracking audit: требуется typed object.",
    );
  if (
    Object.keys(r).some(
      (k) => !["campaign_ids", "ad_group_ids", "ad_id", "limit"].includes(k),
    )
  )
    throw new ProviderError(
      "invalid_request",
      "Tracking audit не принимает произвольные Google requests/GAQL.",
    );
  const out: TrackingAuditOptions = {};
  for (const k of ["campaign_ids", "ad_group_ids"] as const) {
    if (r[k] === undefined) continue;
    if (!Array.isArray(r[k]) || r[k].length < 1 || r[k].length > 20)
      throw new ProviderError("invalid_request", `${k}: допустимо 1–20 IDs.`);
    const ids = r[k].map((v: unknown) => {
      if (typeof v !== "string")
        throw new ProviderError(
          "invalid_request",
          `${k}: input ID должен быть строкой.`,
        );
      return id(v);
    });
    if (new Set(ids).size !== ids.length)
      throw new ProviderError(
        "invalid_request",
        `${k}: duplicate ID запрещён.`,
      );
    out[k] = ids;
  }
  if (r.ad_id !== undefined) {
    if (typeof r.ad_id !== "string")
      throw new ProviderError(
        "invalid_request",
        "ad_id: input ID должен быть строкой.",
      );
    out.ad_id = id(r.ad_id);
  }
  if (r.limit !== undefined) {
    if (
      !Number.isInteger(r.limit) ||
      Number(r.limit) < 1 ||
      Number(r.limit) > 200
    )
      throw new ProviderError(
        "invalid_request",
        "limit: требуется integer 1–200.",
      );
    out.limit = Number(r.limit);
  }
  return out;
}
const sensitiveKey =
  /(?:token|secret|password|authorization|credential|session|cookie|api.?key|client.?key|^(?:code|state|key|auth)$)/i;
const credentialPattern =
  /(?:GOCSPX-|sk-proj-|Bearer\s|-----BEGIN|EA[A-Za-z0-9_-]{30,})/i;
const tags = /\{([A-Za-z_][A-Za-z0-9_+]*)(?:=[^{}]*)?\}/g;
function sensitiveUrl(u: URL, depth = 0): boolean {
  if (u.username || u.password) return true;
  for (const params of [u.searchParams, new URLSearchParams(u.hash.slice(1))]) {
    for (const [key, value] of params) {
      if (sensitiveKey.test(key) || credentialPattern.test(value)) return true;
      if (/^https?:\/\//i.test(value)) {
        if (depth >= 2) return true;
        try {
          if (sensitiveUrl(new URL(value), depth + 1)) return true;
        } catch {
          return true;
        }
      }
    }
  }
  return false;
}
function unsafeHost(h: string): boolean {
  const host = h.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    !host.includes(".")
  )
    return true;
  if (isIP(host) === 6) return true;
  if (isIP(host) === 4) {
    const [a = 0, b = 0] = host.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return false;
}
function safeValue(
  value: string,
  field: string,
  warnings: TrackingAuditWarning[],
): string {
  if (!value) return "";
  if (
    value.length > 4096 ||
    [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127) ||
    credentialPattern.test(value)
  ) {
    warnings.push(
      warn(
        "tracking_value_redacted",
        field,
        "Некорректное или потенциально секретное значение скрыто.",
      ),
    );
    return "[REDACTED]";
  }
  try {
    const replaced = value.replace(tags, "value");
    const u = new URL(
      replaced.includes("://")
        ? replaced
        : `https://audit.invalid/?${replaced}`,
    );
    if (sensitiveUrl(u)) {
      warnings.push(
        warn(
          "tracking_credentials_redacted",
          field,
          "URL credentials/секретные query-параметры скрыты; исходное значение не возвращается.",
        ),
      );
      return "[REDACTED]";
    }
  } catch {
    warnings.push(
      warn(
        "tracking_invalid_syntax",
        field,
        "Значение имеет некорректный URL/query синтаксис; исходный текст скрыт.",
      ),
    );
    return "[INVALID]";
  }
  return value;
}
function auditValue(
  value: string,
  field: string,
  warnings: TrackingAuditWarning[],
  kind: "url" | "template" | "suffix",
) {
  if (!value || value === "[REDACTED]" || value === "[INVALID]") return;
  const normalized = value.replace(tags, "value");
  if (/[{}]/.test(normalized))
    warnings.push(
      warn(
        "tracking_placeholder_unknown",
        field,
        "Непарный/неизвестный ValueTrack placeholder; expansion не выполняется.",
      ),
    );
  if (kind === "suffix") {
    if (/^[?&]|#/.test(value))
      warnings.push(
        warn(
          "tracking_suffix_invalid",
          field,
          "Final URL suffix должен быть query без начального ?/& и fragment.",
        ),
      );
  } else if (
    kind === "template" &&
    /^\{(?:unescapedlpurl|escapedlpurl|lpurl(?:\+[23])?)\}/.test(value)
  ) {
    // A leading landing-page placeholder is a valid Google template, not an unsafe URL.
  } else {
    try {
      const u = new URL(normalized);
      if (!["http:", "https:"].includes(u.protocol) || unsafeHost(u.hostname))
        warnings.push(
          warn(
            "tracking_url_unsafe",
            field,
            "Недопустимый protocol/private/local literal host. DNS/reachability не проверялись.",
          ),
        );
      else if (u.protocol === "http:")
        warnings.push(
          warn(
            "tracking_url_http",
            field,
            "URL использует HTTP; HTTPS предпочтителен.",
          ),
        );
    } catch {
      warnings.push(
        warn(
          "tracking_url_invalid",
          field,
          "Требуется абсолютный HTTP(S) URL или допустимый landing placeholder template.",
        ),
      );
    }
  }
  if (
    kind === "template" &&
    !/\{(?:lpurl(?:\+[23])?|escapedlpurl|unescapedlpurl)\}/.test(value)
  )
    warnings.push(
      warn(
        "tracking_template_no_lpurl",
        field,
        "Tracking template не содержит landing URL placeholder; serving destination не подтверждён.",
      ),
    );
  const query =
    kind === "suffix"
      ? normalized
      : (normalized.split("?")[1]?.split("#")[0] ?? "");
  const params = new URLSearchParams(query);
  const utms = [...params.keys()].filter((k) => /^utm_/i.test(k));
  for (const k of new Set(utms)) {
    if (params.getAll(k).length > 1)
      warnings.push(
        warn("tracking_duplicate_utm", field, `UTM ${k}: duplicate key.`),
      );
    if (!params.get(k))
      warnings.push(
        warn("tracking_empty_utm", field, `UTM ${k}: пустое значение.`),
      );
  }
  if (
    utms.length &&
    ["utm_source", "utm_medium", "utm_campaign"].some((k) => !params.has(k))
  )
    warnings.push(
      warn(
        "tracking_utm_incomplete",
        field,
        "UTM набор не содержит source/medium/campaign целиком.",
      ),
    );
  for (const tag of value.matchAll(tags))
    if (tag[1]!.startsWith("_"))
      warnings.push(
        warn(
          "tracking_custom_parameter_context",
          field,
          "Custom parameter требует hierarchy/serving context; замена значения не выполнялась.",
        ),
      );
}
function local(r: RecordRow, warnings: TrackingAuditWarning[]): Local {
  const value = (k: string) => {
    const v = get(r, k);
    if (v !== undefined && typeof v !== "string")
      throw new ProviderError(
        "provider_response_invalid",
        "Google tracking field имеет некорректный тип.",
      );
    return safeValue(text(v), k, warnings);
  };
  const urls = (k: string) => {
    const a = get(r, k);
    if (a === undefined) return [];
    if (
      !Array.isArray(a) ||
      a.length > 20 ||
      a.some((v) => typeof v !== "string")
    )
      throw new ProviderError(
        "provider_response_invalid",
        "Google URL collection имеет некорректный тип/размер.",
      );
    return a.map((v) => safeValue(String(v), k, warnings));
  };
  const params = get(r, "urlCustomParameters");
  if (params !== undefined && (!Array.isArray(params) || params.length > 20))
    throw new ProviderError(
      "provider_response_invalid",
      "Google custom parameters имеют некорректный размер.",
    );
  return {
    template: value("trackingUrlTemplate"),
    suffix: value("finalUrlSuffix"),
    final_urls: urls("finalUrls"),
    final_mobile_urls: urls("finalMobileUrls"),
    custom_parameters: (Array.isArray(params) ? params : []).map((p) => {
      const entry = rec(p),
        rawKey = text(entry.key).slice(0, 64),
        key = credentialPattern.test(rawKey) ? "[REDACTED_KEY]" : rawKey;
      if (sensitiveKey.test(key)) {
        warnings.push(
          warn(
            "tracking_credentials_redacted",
            "urlCustomParameters",
            "Секретный custom parameter value скрыт.",
          ),
        );
        return { key, value: "[REDACTED]" };
      }
      return {
        key,
        value: safeValue(text(entry.value), "urlCustomParameters", warnings),
      };
    }),
  };
}
function owner(resource: unknown, expected: string): string {
  if (resource !== expected)
    throw new ProviderError(
      "provider_response_invalid",
      "Google tracking row не прошёл account/resource ownership proof.",
    );
  return expected;
}
const inIds = (field: string, ids: string[]) =>
  `${field} IN (${ids.join(",")})`;
export async function getGoogleTrackingSpecs(
  accountId: string,
  rawOptions: unknown,
  read: Stage1Reader,
): Promise<GoogleTrackingReport> {
  return report(accountId, rawOptions, read, false);
}
export async function auditGoogleLinksAndUtms(
  accountId: string,
  rawOptions: unknown,
  read: Stage1Reader,
): Promise<GoogleTrackingReport> {
  return report(accountId, rawOptions, read, true);
}
export type GoogleTrackingContextNode = {
  level: "account" | "campaign" | "ad_group";
  fields: Record<string, unknown>;
};
/** Same syntax/redaction rules as READ audit, limited to independently selected parent fields. */
export function auditGoogleTrackingContext(
  accountId: string,
  chain: GoogleTrackingContextNode[],
) {
  const account = customerId(accountId);
  const expectedLevels = ["account", "campaign", "ad_group"];
  if (
    !chain.length ||
    chain.length > 3 ||
    chain.some((node, i) => node.level !== expectedLevels[i])
  )
    throw new ProviderError(
      "invalid_request",
      "Tracking audit context требует account→campaign→group без пропущенных уровней.",
    );
  let previous = "";
  const rows = chain.map((node) => {
    const r = node.fields,
      kind =
        node.level === "account"
          ? "customers"
          : node.level === "campaign"
            ? "campaigns"
            : "adGroups";
    const resource = text(get(r, "resourceName"));
    if (node.level === "account") {
      owner(resource, `customers/${account}`);
      if (id(r.id) !== account)
        throw new ProviderError(
          "invalid_account",
          "Tracking audit customer mismatch.",
        );
    } else {
      if (
        !new RegExp(`^customers/${account}/${kind}/[0-9]{1,20}$`).test(resource)
      )
        throw new ProviderError(
          "provider_response_invalid",
          "Tracking audit context resource принадлежит другому account/type.",
        );
      if (node.level === "ad_group" && r.campaign !== previous)
        throw new ProviderError(
          "provider_response_invalid",
          "Tracking audit group parent mismatch.",
        );
    }
    previous = resource;
    const warnings: TrackingAuditWarning[] = [],
      values = local(r, warnings);
    auditValue(values.template, "tracking_url_template", warnings, "template");
    auditValue(values.suffix, "final_url_suffix", warnings, "suffix");
    return {
      level: node.level,
      resource_name: resource,
      local: {
        tracking_url_template: values.template,
        final_url_suffix: values.suffix,
      },
      warnings,
    };
  });
  const selected = rows.at(-1)!;
  const resolve = (field: "tracking_url_template" | "final_url_suffix") => {
    const source = [...rows].reverse().find((row) => row.local[field]);
    return {
      value: source?.local[field] ?? "",
      source_resource: source?.resource_name ?? null,
    };
  };
  return {
    provider: "GOOGLE_ADS" as const,
    scope: "EXACT_LOCAL_AND_PARENT_FIELDS" as const,
    resource_name: selected.resource_name,
    fields_selected: ["tracking_url_template", "final_url_suffix"],
    downstream_urls: "NOT_READ" as const,
    landing_reachability: "NOT_CHECKED" as const,
    serving_url_expansion: "NOT_EXECUTED" as const,
    rows,
    effective: {
      template: resolve("tracking_url_template"),
      suffix: resolve("final_url_suffix"),
    },
    warnings: rows.flatMap((row) => row.warnings),
  };
}
/** Display/audit copy only: never use this value to replace raw immutable provider snapshots. */
export function safeGoogleTrackingSummary<T>(value: T): T {
  const keys = new Set([
    "trackingUrlTemplate",
    "tracking_url_template",
    "finalUrlSuffix",
    "final_url_suffix",
    "finalUrls",
    "final_urls",
    "finalMobileUrls",
    "final_mobile_urls",
    "final_url",
    "template",
    "suffix",
  ]);
  const visit = (v: unknown, key = ""): unknown => {
    if (typeof v === "string") return keys.has(key) ? safeValue(v, key, []) : v;
    if (Array.isArray(v)) return v.map((item) => visit(item, key));
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v).map(([k, child]) => [k, visit(child, k)]),
      );
    return v;
  };
  return visit(value) as T;
}
async function report(
  accountId: string,
  rawOptions: unknown,
  read: Stage1Reader,
  audit: boolean,
): Promise<GoogleTrackingReport> {
  const account = customerId(accountId),
    options = parseTrackingAuditOptions(rawOptions),
    limit = options.limit ?? 100;
  const truncated: Level[] = [],
    warnings: TrackingAuditWarning[] = [],
    entities: Entity[] = [];
  const rowWarnings = new Map<string, TrackingAuditWarning[]>();
  let calls = 0;
  const query = async (q: string, level: Level) => {
    calls++;
    const rows = await read(q);
    if (
      !Array.isArray(rows) ||
      rows.length > limit + 1 ||
      rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))
    )
      throw new ProviderError(
        "provider_response_invalid",
        "Google tracking query вернул некорректный/неограниченный result.",
      );
    // Even the limit+1 sentinel must never conceal a foreign-account provider row.
    for (const row of rows) {
      const ad = rec(get(row, "adGroupAd"));
      for (const node of [
        row.customer,
        row.campaign,
        get(row, "adGroup"),
        ad,
        ad.ad,
        get(row, "adGroupCriterion"),
      ]) {
        const resource = get(rec(node), "resourceName");
        if (
          resource !== undefined &&
          (typeof resource !== "string" ||
            (!resource.startsWith(`customers/${account}/`) &&
              resource !== `customers/${account}`))
        )
          throw new ProviderError(
            "provider_response_invalid",
            "Google tracking row принадлежит другому account.",
          );
      }
    }
    if (rows.length > limit) {
      truncated.push(level);
      return rows.slice(0, limit);
    }
    return rows;
  };
  function add(
    level: Level,
    entityId: string,
    resource: string,
    r: RecordRow,
    campaign: string | null,
    group: string | null,
  ) {
    if (entities.some((e) => e.resource_name === resource))
      throw new ProviderError(
        "provider_response_invalid",
        "Google tracking query содержит duplicate resource.",
      );
    const w: TrackingAuditWarning[] = [];
    entities.push({
      level,
      id: entityId,
      resource_name: resource,
      campaign_id: campaign,
      ad_group_id: group,
      status: text(r.status),
      local: local(r, w),
    });
    rowWarnings.set(resource, w);
  }
  const customerRows = await query(
    "SELECT customer.resource_name, customer.id, customer.tracking_url_template, customer.final_url_suffix, customer.auto_tagging_enabled FROM customer LIMIT 1",
    "account",
  );
  if (customerRows.length !== 1)
    throw new ProviderError(
      "invalid_account",
      "Google customer для tracking audit недоступен.",
    );
  const customer = rec(customerRows[0]!.customer);
  if (id(customer.id) !== account)
    throw new ProviderError(
      "invalid_account",
      "Google tracking customer не совпадает с выбранным аккаунтом.",
    );
  add(
    "account",
    account,
    owner(get(customer, "resourceName"), `customers/${account}`),
    customer,
    null,
    null,
  );
  const campaignFilter = options.campaign_ids
    ? ` AND ${inIds("campaign.id", options.campaign_ids)}`
    : "";
  const campaigns = await query(
    `SELECT campaign.resource_name, campaign.id, campaign.status, campaign.tracking_url_template, campaign.final_url_suffix, campaign.url_custom_parameters FROM campaign WHERE campaign.status != 'REMOVED'${campaignFilter} ORDER BY campaign.id LIMIT ${limit + 1}`,
    "campaign",
  );
  for (const row of campaigns) {
    const c = rec(row.campaign),
      cid = id(c.id);
    if (options.campaign_ids && !options.campaign_ids.includes(cid))
      throw new ProviderError(
        "provider_response_invalid",
        "Google campaign вышел за заданный filter.",
      );
    add(
      "campaign",
      cid,
      owner(get(c, "resourceName"), `customers/${account}/campaigns/${cid}`),
      c,
      cid,
      null,
    );
  }
  const campaignIds = entities
    .filter((e) => e.level === "campaign")
    .map((e) => e.id);
  if (
    options.campaign_ids?.some((c) => !campaignIds.includes(c)) &&
    !truncated.includes("campaign")
  )
    warnings.push(
      warn(
        "tracking_requested_campaign_unavailable",
        "campaign_ids",
        "Некоторые requested campaign IDs отсутствуют/REMOVED; данных о них нет.",
      ),
    );
  if (campaignIds.length) {
    const gf = options.ad_group_ids
      ? ` AND ${inIds("ad_group.id", options.ad_group_ids)}`
      : "";
    const groups = await query(
      `SELECT campaign.id, campaign.resource_name, ad_group.resource_name, ad_group.id, ad_group.status, ad_group.tracking_url_template, ad_group.final_url_suffix, ad_group.url_custom_parameters FROM ad_group WHERE ${inIds("campaign.id", campaignIds)} AND ad_group.status != 'REMOVED'${gf} ORDER BY ad_group.id LIMIT ${limit + 1}`,
      "ad_group",
    );
    for (const row of groups) {
      const c = rec(row.campaign),
        cid = id(c.id),
        g = rec(get(row, "adGroup")),
        gid = id(g.id);
      owner(get(c, "resourceName"), `customers/${account}/campaigns/${cid}`);
      if (
        !campaignIds.includes(cid) ||
        (options.ad_group_ids && !options.ad_group_ids.includes(gid))
      )
        throw new ProviderError(
          "provider_response_invalid",
          "Google group parent/filter не совпадает.",
        );
      add(
        "ad_group",
        gid,
        owner(get(g, "resourceName"), `customers/${account}/adGroups/${gid}`),
        g,
        cid,
        gid,
      );
    }
    const groupIds = entities
      .filter((e) => e.level === "ad_group")
      .map((e) => e.id);
    if (
      options.ad_group_ids?.some((g) => !groupIds.includes(g)) &&
      !truncated.includes("ad_group")
    )
      warnings.push(
        warn(
          "tracking_requested_group_unavailable",
          "ad_group_ids",
          "Некоторые requested group IDs отсутствуют/REMOVED или вне выбранных campaign; данных о них нет.",
        ),
      );
    if (groupIds.length) {
      const af = options.ad_id
        ? ` AND ad_group_ad.ad.id = ${options.ad_id}`
        : "";
      const ads = await query(
        `SELECT campaign.id, campaign.resource_name, ad_group.id, ad_group.resource_name, ad_group_ad.resource_name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.resource_name, ad_group_ad.ad.tracking_url_template, ad_group_ad.ad.final_url_suffix, ad_group_ad.ad.final_urls, ad_group_ad.ad.final_mobile_urls, ad_group_ad.ad.url_custom_parameters FROM ad_group_ad WHERE ${inIds("ad_group.id", groupIds)} AND ad_group_ad.status != 'REMOVED'${af} ORDER BY ad_group_ad.ad.id LIMIT ${limit + 1}`,
        "ad",
      );
      const parent = (row: RecordRow) => {
        const c = rec(row.campaign),
          g = rec(get(row, "adGroup")),
          cid = id(c.id),
          gid = id(g.id);
        owner(get(c, "resourceName"), `customers/${account}/campaigns/${cid}`);
        owner(get(g, "resourceName"), `customers/${account}/adGroups/${gid}`);
        if (
          !entities.some(
            (e) =>
              e.level === "ad_group" && e.id === gid && e.campaign_id === cid,
          )
        )
          throw new ProviderError(
            "provider_response_invalid",
            "Google tracking child parent mismatch.",
          );
        return { cid, gid };
      };
      for (const row of ads) {
        const { cid, gid } = parent(row),
          aga = rec(get(row, "adGroupAd")),
          ad = rec(aga.ad),
          aid = id(ad.id);
        owner(
          get(aga, "resourceName"),
          `customers/${account}/adGroupAds/${gid}~${aid}`,
        );
        if (options.ad_id && aid !== options.ad_id)
          throw new ProviderError(
            "provider_response_invalid",
            "Google ad вышел за заданный filter.",
          );
        add(
          "ad",
          aid,
          owner(get(ad, "resourceName"), `customers/${account}/ads/${aid}`),
          { ...ad, status: aga.status },
          cid,
          gid,
        );
      }
      const keywords = await query(
        `SELECT campaign.id, campaign.resource_name, ad_group.id, ad_group.resource_name, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.tracking_url_template, ad_group_criterion.final_url_suffix, ad_group_criterion.final_urls, ad_group_criterion.final_mobile_urls, ad_group_criterion.url_custom_parameters FROM ad_group_criterion WHERE ${inIds("ad_group.id", groupIds)} AND ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE AND ad_group_criterion.status != 'REMOVED' ORDER BY ad_group_criterion.criterion_id LIMIT ${limit + 1}`,
        "keyword",
      );
      for (const row of keywords) {
        const { cid, gid } = parent(row),
          k = rec(get(row, "adGroupCriterion")),
          kid = id(get(k, "criterionId"));
        if (k.negative === true)
          throw new ProviderError(
            "provider_response_invalid",
            "Negative keyword не соответствует tracking query.",
          );
        add(
          "keyword",
          kid,
          owner(
            get(k, "resourceName"),
            `customers/${account}/adGroupCriteria/${gid}~${kid}`,
          ),
          k,
          cid,
          gid,
        );
      }
    }
  }
  if (truncated.length)
    warnings.push(
      warn(
        "tracking_audit_truncated",
        "limit",
        "Inventory ограничен limit; это не полный account audit. Уточните campaign/group filters.",
      ),
    );
  if (
    options.ad_id &&
    !entities.some((e) => e.level === "ad" && e.id === options.ad_id)
  )
    warnings.push(
      warn(
        "tracking_requested_ad_unavailable",
        "ad_id",
        "Requested ad не найден в прочитанных owned groups; served context остаётся UNKNOWN.",
      ),
    );
  const rows = entities.map((e) => {
    const w = rowWarnings.get(e.resource_name)!;
    const campaign = entities.find(
      (p) => p.level === "campaign" && p.id === e.campaign_id,
    );
    const group = entities.find(
      (p) => p.level === "ad_group" && p.id === e.ad_group_id,
    );
    const ad = options.ad_id
      ? entities.find(
          (p) =>
            p.level === "ad" &&
            p.id === options.ad_id &&
            p.ad_group_id === e.ad_group_id,
        )
      : undefined;
    const chain = [
      entities[0]!,
      campaign,
      group,
      e.level === "keyword" ? ad : undefined,
      e,
    ].filter((p): p is Entity => Boolean(p));
    const resolve = (field: "template" | "suffix"): Resolved => {
      if (e.level === "keyword" && !e.local[field] && !ad)
        return {
          state: "UNKNOWN_AD_CONTEXT",
          value: null,
          source_resource: null,
        };
      const source = [...chain].reverse().find((p) => p.local[field]);
      return {
        state: "RESOLVED",
        value: source?.local[field] ?? "",
        source_resource: source?.resource_name ?? null,
      };
    };
    const finalSource = e.local.final_urls.length
      ? e
      : e.level === "keyword"
        ? ad
        : undefined;
    const final: Resolved = {
      state:
        e.level === "keyword" && !finalSource
          ? "UNKNOWN_AD_CONTEXT"
          : "RESOLVED",
      value: finalSource ? JSON.stringify(finalSource.local.final_urls) : "",
      source_resource: finalSource?.resource_name ?? null,
    };
    if (
      e.level === "keyword" &&
      !ad &&
      (!e.local.template || !e.local.suffix || !e.local.final_urls.length)
    )
      w.push(
        warn(
          "tracking_ad_context_required",
          "ad_id",
          "Keyword→ad inheritance требует явного ad_id того же group; served ad не угадывается.",
        ),
      );
    if (audit) {
      auditValue(e.local.template, "tracking_url_template", w, "template");
      auditValue(e.local.suffix, "final_url_suffix", w, "suffix");
      for (const u of e.local.final_urls) auditValue(u, "final_urls", w, "url");
      for (const u of e.local.final_mobile_urls)
        auditValue(u, "final_mobile_urls", w, "url");
    }
    return {
      ...e,
      effective: {
        template: resolve("template"),
        suffix: resolve("suffix"),
        final_urls: final,
      },
      warnings: w,
    };
  });
  return {
    provider: "GOOGLE_ADS",
    account_id: account,
    auto_tagging_enabled: get(customer, "autoTaggingEnabled") === true,
    audit_kind: audit
      ? "SYNTAX_AND_INHERITANCE_ONLY"
      : "PROVIDER_TRACKING_SPECS",
    landing_reachability: "NOT_CHECKED",
    serving_url_expansion: "NOT_EXECUTED",
    complete:
      truncated.length === 0 &&
      !warnings.some((w) => w.code.startsWith("tracking_requested_")),
    truncated_levels: truncated,
    read_call_count: calls,
    validate_only_call_count: 0,
    real_write_call_count: 0,
    rows,
    warnings,
  };
}

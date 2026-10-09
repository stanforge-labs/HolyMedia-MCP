import type { AppConfig } from "@holymedia/config";
import type {
  Stage1Plan,
  Stage1Reader,
  Stage1MutationResult,
} from "./google-ads-stage1.js";
import { canonical } from "./google-ads-stage1.js";
import { googleAdsApiError } from "./google-ads.error.js";
import {
  assertGoogleWriteAccount,
  customerId,
  GoogleAdsWriteError,
  googleWriteFailure,
} from "./google-ads-write.js";

export type ExtendedRow = Record<string, unknown>;
export type ExtendedKind =
  | "customers"
  | "campaignBudgets"
  | "ads"
  | "campaigns"
  | "adGroups"
  | "adGroupCriteria"
  | "campaignCriteria"
  | "adGroupAds"
  | "assets"
  | "campaignAssets"
  | "adGroupAssets"
  | "customerAssets"
  | "customAudiences"
  | "biddingStrategies"
  | "assetGroups"
  | "assetGroupAssets"
  | "assetGroupSignals";
export type ExtendedOperation = {
  kind: ExtendedKind;
  method: "create" | "update" | "remove";
  resource_name: string | null;
  fields: ExtendedRow;
  update_mask: string | null;
  before: ExtendedRow | null;
  expected: ExtendedRow;
  row: number;
  read_query: string;
  response_key: string;
};
export type ExtendedPlan = {
  version: 3 | 4 | 5;
  account_id: string;
  intent: ExtendedRow & { action: string };
  checks: { query: string; rows: ExtendedRow[] }[];
  operations: ExtendedOperation[];
  items: (Stage1Plan["items"][number] & {
    row_error?: { source: "HOLYMEDIA"; code: string; message: string };
  })[];
  atomic: boolean;
  irreversible: boolean;
  inverse_intent?: ExtendedRow & { action: string };
};
export const extRow = (v: unknown): ExtendedRow =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as ExtendedRow) : {};
export function assertExtendedGate(
  config: AppConfig,
  account: string,
  version: 3 | 4 | 5,
) {
  assertGoogleWriteAccount(config, account);
  const enabled =
    version === 5
      ? config.providerGoogleAdsStage2WriteEnabled
      : version === 3
        ? config.providerGoogleAdsStage3WriteEnabled
        : config.providerGoogleAdsStage4WriteEnabled;
  if (!enabled)
    extFail(
      "google_extended_stage_disabled",
      `Google Ads Stage ${version === 5 ? 2 : version} выключен; preview/approval/commit/rollback недоступны.`,
    );
  if (config.providerGoogleApiVersion.replace(/^v/, "") !== "24")
    extFail(
      "google_extended_api_version_unsupported",
      "Stage 2–4 extension проверен только для Google Ads API v24.",
    );
}
export function extFail(code: string, message: string): never {
  throw new GoogleAdsWriteError(code, message);
}
export function extId(v: unknown, label = "ID"): string {
  if (typeof v !== "string" || !/^[0-9]{1,20}$/.test(v))
    extFail(
      "google_extended_id_invalid",
      `${label}: требуется числовой ID, не resource name.`,
    );
  return v;
}
export function extClosed(
  value: unknown,
  allowed: string[],
  required: string[] = [],
): ExtendedRow {
  const r = extRow(value);
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(r).some((k) => !allowed.includes(k)) ||
    required.some((k) => r[k] === undefined)
  )
    extFail(
      "google_extended_input_invalid",
      "Typed input содержит лишние или отсутствующие обязательные поля.",
    );
  return r;
}
export function extOwner(
  v: unknown,
  account: string,
  kind?: string,
  temporary = false,
): string {
  if (kind === "customers" && v === `customers/${customerId(account)}`)
    return String(v);
  if (
    typeof v !== "string" ||
    !new RegExp(
      `^customers/${customerId(account)}/${kind ?? "[A-Za-z]+"}/${temporary ? "-?" : ""}[0-9]{1,20}(?:~[A-Za-z0-9_~-]+)?$`,
    ).test(v)
  )
    extFail(
      "google_extended_ownership_invalid",
      "Resource не принадлежит выбранному Google customer; вся пачка отклонена.",
    );
  return v;
}
export async function extRead(
  read: Stage1Reader,
  query: string,
): Promise<ExtendedRow[]> {
  const rows = await read(query);
  if (rows.length > 5000)
    extFail(
      "google_inventory_limit",
      "Inventory превышает 5000 строк; данные не обрезаны.",
    );
  return rows
    .map(extRow)
    .sort((a, b) => canonical(a).localeCompare(canonical(b), "en"));
}
export function extItem(
  index: number,
  label: string,
  campaign = "",
  group = "",
): ExtendedPlan["items"][number] {
  return {
    item: index,
    keyword: label,
    campaign_id: campaign,
    campaign_name: "",
    ad_group_id: group,
    ad_group_name: "",
    before: null,
    after: null,
    warnings: [],
    conflicts: [],
    duplicate_status: "none",
    provider_operations: [],
  };
}
export function extQuote(v: string): string {
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
export async function extContext(account: string, read: Stage1Reader) {
  const account_id = customerId(account),
    checks: ExtendedPlan["checks"] = [],
    cache = new Map<string, ExtendedRow[]>();
  const query = async (q: string) => {
    if (!cache.has(q)) {
      const rows = await extRead(read, q);
      cache.set(q, rows);
      checks.push({ query: q, rows });
    }
    return cache.get(q)!;
  };
  const rows = await query(
    "SELECT customer.id, customer.resource_name, customer.currency_code, customer.time_zone FROM customer",
  );
  const c = extRow(rows[0]?.customer);
  if (rows.length !== 1 || String(c.id) !== account_id)
    extFail(
      "google_extended_ownership_invalid",
      "Customer proof не совпадает с выбранным account.",
    );
  extOwner(c.resourceName, account_id, "customers");
  return {
    account_id,
    checks,
    query,
    currency: String(c.currencyCode),
    timezone: String(c.timeZone),
  };
}
const kinds: ExtendedKind[] = [
  "customers",
  "campaignBudgets",
  "ads",
  "campaigns",
  "adGroups",
  "adGroupCriteria",
  "campaignCriteria",
  "adGroupAds",
  "assets",
  "campaignAssets",
  "adGroupAssets",
  "customerAssets",
  "customAudiences",
  "biddingStrategies",
  "assetGroups",
  "assetGroupAssets",
  "assetGroupSignals",
];
export function assertExtendedPlan(plan: ExtendedPlan, account: string) {
  if (
    ![3, 4, 5].includes(plan.version) ||
    plan.account_id !== customerId(account) ||
    !Array.isArray(plan.operations) ||
    plan.operations.length < 1 ||
    plan.operations.length > 500 ||
    !Array.isArray(plan.items) ||
    typeof plan.atomic !== "boolean" ||
    typeof plan.irreversible !== "boolean"
  )
    extFail(
      "google_extended_plan_invalid",
      "Некорректный immutable extension plan.",
    );
  const seen = new Set<string>();
  for (const o of plan.operations) {
    if (
      !kinds.includes(o.kind) ||
      !["create", "update", "remove"].includes(o.method) ||
      !Number.isInteger(o.row) ||
      !plan.items[o.row] ||
      !o.read_query.startsWith("SELECT ") ||
      !o.response_key
    )
      extFail(
        "google_extended_plan_invalid",
        "Неподдерживаемая операция immutable plan.",
      );
    if (o.resource_name) {
      extOwner(o.resource_name, plan.account_id, o.kind, o.method === "create");
      if (seen.has(o.resource_name))
        extFail(
          "google_extended_duplicate",
          "Один resource нельзя изменять несколько раз в batch.",
        );
      seen.add(o.resource_name);
    }
    if (o.method !== "create" && !o.resource_name)
      extFail(
        "google_extended_plan_invalid",
        "Update/remove требует существующий resource.",
      );
    if (
      o.method === "update" &&
      (!o.update_mask ||
        !/^[a-z_][a-z_0-9]*(?:\.[a-z_][a-z_0-9]*)*(?:,[a-z_][a-z_0-9]*(?:\.[a-z_][a-z_0-9]*)*)*$/.test(
          o.update_mask,
        ) ||
        o.fields.resourceName !== o.resource_name)
    )
      extFail(
        "google_extended_plan_invalid",
        "Точечная modification требует exact update mask и identity.",
      );
    if (o.method === "remove" && !plan.irreversible)
      extFail(
        "google_extended_removal_invalid",
        "Remove должен явно отмечаться необратимым в approved preview.",
      );
    if (
      o.method === "create" &&
      ["campaigns", "adGroups", "adGroupAds"].includes(o.kind) &&
      o.fields.status !== "PAUSED"
    )
      extFail(
        "google_extended_creation_status_invalid",
        "Новые campaign/group/ad должны создаваться PAUSED.",
      );
    if (
      o.method === "create" &&
      o.fields.resourceName &&
      o.fields.resourceName !== o.resource_name
    )
      extFail("google_extended_plan_invalid", "Temporary identity mismatch.");
    if (o.kind === "customers" && o.method !== "update")
      extFail(
        "google_extended_customer_operation_invalid",
        "Разрешены только typed updates существующего customer; создание/удаление аккаунта запрещено.",
      );
  }
  if (
    plan.operations.some(
      (o) => o.method === "create" && o.resource_name?.includes("/-"),
    ) &&
    !plan.atomic
  )
    extFail(
      "google_extended_dependencies_require_atomic",
      "Temporary dependency references требуют atomic partial_failure=false.",
    );
  if (
    plan.operations.some((o) => o.kind === "customAudiences") &&
    (!plan.atomic || plan.operations.some((o) => o.kind !== "customAudiences"))
  )
    extFail(
      "google_custom_audience_service_boundary",
      "CustomAudienceService требует отдельный atomic plan; смешивать с GoogleAdsService нельзя.",
    );
}
export async function rereadExtendedChecks(
  plan: ExtendedPlan,
  read: Stage1Reader,
) {
  return Promise.all(
    plan.checks.map(async (c) => ({
      query: c.query,
      rows: await extRead(read, c.query),
    })),
  );
}
export function extendedProviderOperation(o: ExtendedOperation) {
  const singular: Record<ExtendedKind, string> = {
    customers: "customer",
    campaignBudgets: "campaignBudget",
    ads: "ad",
    campaigns: "campaign",
    adGroups: "adGroup",
    adGroupCriteria: "adGroupCriterion",
    campaignCriteria: "campaignCriterion",
    adGroupAds: "adGroupAd",
    assets: "asset",
    campaignAssets: "campaignAsset",
    adGroupAssets: "adGroupAsset",
    customerAssets: "customerAsset",
    customAudiences: "customAudience",
    biddingStrategies: "biddingStrategy",
    assetGroups: "assetGroup",
    assetGroupAssets: "assetGroupAsset",
    assetGroupSignals: "assetGroupSignal",
  };
  return {
    [`${singular[o.kind]}Operation`]:
      o.method === "remove"
        ? { remove: o.resource_name }
        : {
            [o.method]: o.fields,
            ...(o.method === "update" ? { updateMask: o.update_mask } : {}),
          },
  };
}
export function decodeExtendedMutation(
  payload: unknown,
  plan: ExtendedPlan,
  validateOnly: boolean,
  customAudienceService = false,
): Stage1MutationResult[] {
  const root = extRow(payload),
    partial = extRow(root.partialFailureError),
    errors = new Map<number, ReturnType<typeof googleWriteFailure>>();
  let globalFailure =
    !payload || typeof payload !== "object" || Array.isArray(payload);
  if (Number(partial.code ?? 0)) {
    if (plan.atomic) globalFailure = true;
    for (const detail of Array.isArray(partial.details)
      ? partial.details
      : []) {
      for (const raw of Array.isArray(extRow(detail).errors)
        ? (extRow(detail).errors as unknown[])
        : []) {
        const e = extRow(raw),
          location = extRow(e.location),
          path = Array.isArray(location.fieldPathElements)
            ? location.fieldPathElements.map(extRow)
            : [];
        const index = path.find(
          (x) =>
            x.fieldName === "mutateOperations" || x.fieldName === "operations",
        )?.index;
        if (
          !Number.isInteger(index) ||
          Number(index) < 0 ||
          Number(index) >= plan.operations.length
        ) {
          globalFailure = true;
          continue;
        }
        const code = String(
          Object.values(extRow(e.errorCode)).find(
            (v) => typeof v === "string",
          ) ?? "GOOGLE_ADS_ERROR",
        );
        const failure = googleWriteFailure(
          code,
          path
            .filter(
              (p) =>
                typeof p.fieldName === "string" &&
                /^[A-Za-z_][A-Za-z0-9_]{0,80}$/.test(p.fieldName),
            )
            .map(
              (p) =>
                `${p.fieldName}${p.index === undefined ? "" : `[${Number(p.index)}]`}`,
            )
            .join("."),
        );
        const parsed = googleAdsApiError(
          {
            error: {
              details: [
                { "@type": "google.ads.GoogleAdsFailure", errors: [e] },
              ],
            },
          },
          new Response(null, { status: 400 }),
        );
        if (parsed)
          failure.google_details = parsed.errors.map((d) => ({
            google_code: d.error_code,
            message: d.message,
            ...(d.field_path ? { field_path: d.field_path } : {}),
          }));
        errors.set(Number(index), failure);
      }
    }
    if (!errors.size) globalFailure = true;
  }
  const response = customAudienceService
    ? root.results
    : root.mutateOperationResponses;
  if (
    !validateOnly &&
    (!Array.isArray(response) || response.length !== plan.operations.length)
  )
    globalFailure = true;
  return plan.operations.map((o, i) => {
    const r = extRow(Array.isArray(response) ? response[i] : null);
    const result = customAudienceService
      ? r
      : (Object.values(r)
          .map(extRow)
          .find((v) => typeof v.resourceName === "string") ?? {});
    const resource =
      typeof result.resourceName === "string" ? result.resourceName : null;
    let valid = false;
    try {
      if (resource) {
        extOwner(resource, plan.account_id, o.kind);
        valid = o.method === "create" || resource === o.resource_name;
      }
    } catch {
      valid = false;
    }
    const error =
      errors.get(i) ??
      (globalFailure
        ? googleWriteFailure("OUTCOME_UNCERTAIN")
        : !validateOnly && !valid
          ? googleWriteFailure("OUTCOME_UNCERTAIN")
          : null);
    return {
      success: !error,
      resource_name: validateOnly ? o.resource_name : resource,
      error,
    };
  });
}
export function replaceExtendedTemps(
  value: unknown,
  refs: Map<string, string>,
): unknown {
  if (typeof value === "string") {
    if (refs.has(value)) return refs.get(value)!;
    // GAQL resource literals are quoted. Never substring-replace -1 inside -10,
    // or alter user-facing names/text that happen to contain a resource string.
    if (value.startsWith("SELECT "))
      return value.replace(
        /'([^']+)'/g,
        (_m, resource: string) => `'${refs.get(resource) ?? resource}'`,
      );
    return value;
  }
  if (Array.isArray(value))
    return value.map((x) => replaceExtendedTemps(x, refs));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replaceExtendedTemps(v, refs)]),
    );
  return value;
}
export function extContains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((x, i) => extContains(actual[i], x))
    );
  if (expected && typeof expected === "object")
    return (
      Boolean(actual && typeof actual === "object") &&
      Object.entries(expected).every(([k, v]) =>
        extContains(extRow(actual)[k], v),
      )
    );
  return (
    actual === expected ||
    (typeof expected === "number" && String(actual) === String(expected))
  );
}
export async function verifyExtendedMutation(
  plan: ExtendedPlan,
  results: Stage1MutationResult[],
  read: Stage1Reader,
) {
  const refs = new Map<string, string>();
  plan.operations.forEach((o, i) => {
    if (o.resource_name && results[i]?.success && results[i]?.resource_name)
      refs.set(o.resource_name, results[i]!.resource_name!);
  });
  const actual: (ExtendedRow | null)[] = [],
    ops: ExtendedRow[] = [];
  let contextVerified = true;
  const mutable = new Set(
    plan.operations
      .filter((o) => o.method === "update")
      .map((o) => String(o.resource_name)),
  );
  const membershipChanges = new Set(
    plan.operations
      .filter((o) => o.method === "remove")
      .map((o) => String(o.resource_name)),
  );
  plan.operations.forEach((o, i) => {
    if (
      o.method === "create" &&
      results[i]?.success &&
      results[i]?.resource_name
    )
      membershipChanges.add(results[i]!.resource_name!);
  });
  const hasMembershipChange = (v: unknown): boolean =>
    Array.isArray(v)
      ? v.some(hasMembershipChange)
      : Boolean(
          v &&
          typeof v === "object" &&
          (membershipChanges.has(String(extRow(v).resourceName)) ||
            Object.values(v).some(hasMembershipChange)),
        );
  const stripMutable = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(stripMutable);
    if (v && typeof v === "object") {
      const r = extRow(v);
      if (mutable.has(String(r.resourceName)))
        return { resourceName: r.resourceName, verified_by_operation: true };
      return Object.fromEntries(
        Object.entries(r).map(([k, x]) => [k, stripMutable(x)]),
      );
    }
    return v;
  };
  const contextRows = (rows: ExtendedRow[]) =>
    rows
      .filter((r) => !hasMembershipChange(r))
      .map(stripMutable)
      .filter(
        (r) =>
          !Object.values(extRow(r)).every(
            (v) => extRow(v).verified_by_operation === true,
          ),
      )
      .sort((a, b) => canonical(a).localeCompare(canonical(b), "en"));
  for (const c of plan.checks) {
    // Remove only the exact changed entity from the comparison, never its siblings
    // or parent fields. Nested Ad changes must not hide unexpected AdGroupAd status.
    try {
      if (
        canonical(contextRows(await extRead(read, c.query))) !==
        canonical(contextRows(c.rows))
      )
        contextVerified = false;
    } catch {
      contextVerified = false;
    }
  }
  for (const [i, o] of plan.operations.entries()) {
    let entity: ExtendedRow | null = null,
      verified = false;
    const resource = results[i]?.resource_name ?? o.resource_name;
    try {
      const q = String(replaceExtendedTemps(o.read_query, refs)),
        rows = await extRead(read, q);
      const found = rows
        .map((r) =>
          extRow(
            o.response_key
              .split(".")
              .reduce<unknown>((v, k) => extRow(v)[k], r),
          ),
        )
        .filter((r) => r.resourceName === resource);
      if (found.length === 1) {
        entity = found[0]!;
        extOwner(entity.resourceName, plan.account_id, o.kind);
      }
      const expected = extRow(replaceExtendedTemps(o.expected, refs));
      if (resource) expected.resourceName = resource;
      const comparisonEntity = entity ? structuredClone(entity) : null;
      // Protobuf JSON omits selected default values. Normalize only documented
      // provider-managed defaults with an independent strategy-type proof.
      if (
        comparisonEntity &&
        extRow(expected.manualCpc).enhancedCpcEnabled === false &&
        comparisonEntity.biddingStrategyType === "MANUAL_CPC"
      )
        comparisonEntity.manualCpc = {
          ...extRow(comparisonEntity.manualCpc),
          enhancedCpcEnabled:
            extRow(comparisonEntity.manualCpc).enhancedCpcEnabled ?? false,
        };
      if (
        comparisonEntity &&
        expected.biddingStrategy === "" &&
        comparisonEntity.biddingStrategy === undefined
      )
        comparisonEntity.biddingStrategy = "";
      if (
        comparisonEntity &&
        expected.negative === false &&
        comparisonEntity.negative === undefined &&
        ["adGroupCriteria", "campaignCriteria"].includes(o.kind)
      )
        comparisonEntity.negative = false;
      verified =
        contextVerified &&
        results[i]?.success === true &&
        (o.method === "remove"
          ? found.length === 0 || entity?.status === "REMOVED"
          : Boolean(comparisonEntity) &&
            extContains(comparisonEntity, expected));
    } catch {
      /* Never retry a mutation when reread is uncertain. */
    }
    actual.push(entity);
    ops.push({
      operation: i,
      resource_name: resource,
      success: verified,
      before: o.before,
      requested: o.expected,
      actual: entity,
      error: verified
        ? null
        : (results[i]?.error ?? googleWriteFailure("VERIFICATION_MISMATCH")),
    });
  }
  const items = plan.items.map((item) => {
    const operations = item.provider_operations.map((i) => ops[i]!);
    const success =
      !item.row_error &&
      operations.length > 0 &&
      operations.every((o) => o.success === true);
    return {
      ...item,
      operations,
      success,
      result: success ? "success" : "failure",
    };
  });
  return {
    context_verified: contextVerified,
    items,
    actual,
    status: items.every((i) => i.success)
      ? "VERIFIED"
      : items.some((i) => i.success)
        ? "PARTIAL_FAILURE"
        : "NOT_VERIFIED",
  };
}

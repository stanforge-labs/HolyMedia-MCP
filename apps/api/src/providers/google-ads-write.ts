import type { AppConfig } from "@holymedia/config";
import { ProviderError } from "./provider.errors.js";
import { GoogleAdsApiError } from "./google-ads.error.js";
import type { ProviderReadContext } from "./provider.types.js";
import type { Stage0Plan } from "./google-ads-stage0.js";

export const GOOGLE_MUTATION_BATCH_LIMIT = 500;
export const GOOGLE_KEYWORD_PREVIEW_TTL_MS = 30 * 60_000;
export type GoogleKeywordIdentity = {
  campaign_id: string;
  ad_group_id: string;
  criterion_id: string;
  resource_name: string;
};
export type GoogleKeywordSnapshot = GoogleKeywordIdentity & {
  account_id: string;
  campaign_name: string;
  campaign_status: string;
  ad_group_name: string;
  ad_group_status: string;
  keyword: string;
  match_type: string;
  status: "ENABLED" | "PAUSED";
};
export type GoogleKeywordMutation = GoogleKeywordIdentity & {
  status: "ENABLED" | "PAUSED";
};
export type GoogleWriteFailure = {
  source?: "HOLYMEDIA";
  google_details?: {
    google_code: string;
    message: string;
    field_path?: string;
  }[];
  code: string;
  message: string;
  google_error_code: string;
  google_code: string;
  field_path?: string;
};
export type GoogleMutationResult = {
  success: boolean;
  error: GoogleWriteFailure | null;
};
export interface GoogleKeywordWriteAdapter {
  readKeywordStates(
    context: ProviderReadContext,
    items: GoogleKeywordIdentity[],
  ): Promise<GoogleKeywordSnapshot[]>;
  validateKeywordStatuses(
    context: ProviderReadContext,
    items: GoogleKeywordMutation[],
  ): Promise<GoogleMutationResult[]>;
  commitKeywordStatuses(
    context: ProviderReadContext,
    items: GoogleKeywordMutation[],
  ): Promise<GoogleMutationResult[]>;
}
export function customerId(value: string): string {
  const id = value.trim().replace(/-/g, "");
  if (!/^\d{10}$/.test(id))
    throw new ProviderError(
      "invalid_request",
      "Укажите Google customer ID из 10 цифр.",
    );
  return id;
}
export function assertGoogleWriteAccount(config: AppConfig, account: string) {
  if (!config.providerGoogleAdsWriteEnabled)
    throw new GoogleAdsWriteError(
      "google_write_disabled",
      "Запись Google Ads выключена на сервере.",
    );
  if (!config.googleAdsWriteAccountAllowlist.includes(customerId(account)))
    throw new GoogleAdsWriteError(
      "google_account_not_allowlisted",
      "Этот Google Ads аккаунт разрешён только для чтения: его нет в write allowlist.",
    );
}
/** Only the isolated, single-account Q/R/S keyword-status path may bypass V2 generic writes. */
export function qrsKeywordStatusWriteAllowed(config: AppConfig): boolean {
  return (
    config.qrsTestGoogleConfirmedWriteEnabled &&
    config.qrsTestRestrictedAuth &&
    config.providerGoogleAdsWriteEnabled &&
    config.previewOnly &&
    !config.confirmedWriteEnabled &&
    !config.providerGoogleAdsStage2WriteEnabled &&
    !config.providerGoogleAdsStage3WriteEnabled &&
    !config.providerGoogleAdsStage4WriteEnabled &&
    !config.publicMcpWriteScopeEnabled &&
    !config.publicMcpControlledWriteEnabled &&
    config.publicBaseUrl === "https://mcp-test.holymedia.kz" &&
    config.googleAdsWriteAccountAllowlist.length === 1 &&
    config.googleAdsWriteAccountAllowlist[0] === "8590146099"
  );
}

/** A distinct, default-OFF exception for one frozen Search/RSA TEST clone. */
export function qrsCloneWriteAllowed(
  config: AppConfig,
  input: unknown,
): input is Stage0Plan {
  if (
    !config.qrsTestCloneConfirmedWriteEnabled ||
    !config.qrsTestRestrictedAuth ||
    config.qrsTestGoogleConfirmedWriteEnabled ||
    !config.providerGoogleAdsWriteEnabled ||
    !config.previewOnly ||
    config.confirmedWriteEnabled ||
    config.providerGoogleAdsStage2WriteEnabled ||
    config.providerGoogleAdsStage3WriteEnabled ||
    config.providerGoogleAdsStage4WriteEnabled ||
    config.publicMcpWriteScopeEnabled ||
    config.publicMcpControlledWriteEnabled ||
    config.publicBaseUrl !== "https://mcp-test.holymedia.kz" ||
    config.googleAdsWriteAccountAllowlist.length !== 1 ||
    config.googleAdsWriteAccountAllowlist[0] !== "8590146099" ||
    !/^[1-9][0-9]{0,19}$/.test(config.qrsTestCloneSourceCampaignId ?? "")
  )
    return false;
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const plan = input as Partial<Stage0Plan>;
  if (
    plan.version !== 0 ||
    plan.account_id !== "8590146099" ||
    plan.intent?.action !== "campaign_create" ||
    plan.intent.brief?.account_id !== plan.account_id ||
    typeof plan.intent.brief.campaign_name !== "string" ||
    !plan.intent.brief.campaign_name.trim() ||
    plan.summary?.clone_source_campaign_id !==
      config.qrsTestCloneSourceCampaignId ||
    plan.summary?.campaign_name !== plan.intent.brief.campaign_name ||
    plan.summary?.strategy !== "MANUAL_CPC" ||
    !Array.isArray(plan.checks) ||
    !Array.isArray(plan.operations) ||
    plan.operations.length < 4 ||
    plan.operations.length > 500
  )
    return false;
  const sourceResource = `customers/8590146099/campaigns/${config.qrsTestCloneSourceCampaignId}`;
  if (
    !plan.checks.some((check) =>
      Array.isArray(check?.rows)
        ? check.rows.some((row) => {
            const source = row?.campaign as Record<string, unknown> | undefined;
            return (
              source &&
              typeof source === "object" &&
              !Array.isArray(source) &&
              source.resourceName === sourceResource &&
              source.status === "PAUSED" &&
              source.advertisingChannelType === "SEARCH" &&
              source.biddingStrategyType === "MANUAL_CPC"
            );
          })
        : false,
    )
  )
    return false;
  if (
    !plan.operations.every(
      (operation) =>
        operation?.method === "create" &&
        operation.before === null &&
        operation.update_mask === null,
    )
  )
    return false;
  const budgets = plan.operations.filter((o) => o.kind === "campaignBudget");
  const campaigns = plan.operations.filter((o) => o.kind === "campaign");
  const groups = plan.operations.filter((o) => o.kind === "adGroup");
  const ads = plan.operations.filter((o) => o.kind === "adGroupAd");
  return (
    budgets.length === 1 &&
    budgets[0]!.fields.explicitlyShared === false &&
    budgets[0]!.fields.deliveryMethod === "STANDARD" &&
    /^[1-9][0-9]{0,18}$/.test(String(budgets[0]!.fields.amountMicros)) &&
    campaigns.length === 1 &&
    campaigns[0]!.fields.status === "PAUSED" &&
    campaigns[0]!.fields.advertisingChannelType === "SEARCH" &&
    campaigns[0]!.fields.name === plan.intent.brief.campaign_name &&
    campaigns[0]!.fields.campaignBudget === budgets[0]!.resource_name &&
    Object.hasOwn(campaigns[0]!.fields, "manualCpc") &&
    groups.length >= 1 &&
    groups.every(
      (group) =>
        group.fields.status === "PAUSED" &&
        group.fields.campaign === campaigns[0]!.resource_name,
    ) &&
    ads.length >= 1 &&
    ads.every(
      (ad) =>
        ad.fields.status === "PAUSED" &&
        ad.fields.ad &&
        typeof ad.fields.ad === "object" &&
        !Array.isArray(ad.fields.ad) &&
        Object.hasOwn(ad.fields.ad, "responsiveSearchAd") &&
        groups.some((group) => group.resource_name === ad.fields.adGroup),
    )
  );
}
export class GoogleAdsWriteError extends ProviderError {
  public constructor(
    public readonly writeCode: string,
    message: string,
    public readonly failures: GoogleWriteFailure[] = [],
    public readonly fieldPath?: string,
  ) {
    super(
      "invalid_request",
      message,
      false,
      undefined,
      failures[0]?.google_error_code,
    );
    this.name = "GoogleAdsWriteError";
  }
}
export function googleWriteFailure(
  code: string,
  fieldPath?: string,
): GoogleWriteFailure {
  const safe = /^[A-Za-z0-9_]{1,80}$/.test(code) ? code : "GOOGLE_ADS_ERROR";
  const messages: Record<string, string> = {
    USER_PERMISSION_DENIED:
      "У подключения нет права изменять этот Google Ads аккаунт.",
    DEVELOPER_TOKEN_NOT_APPROVED:
      "Google отклонил API-доступ. Проверьте уровень доступа и ограничения developer token.",
    DEVELOPER_TOKEN_PROHIBITED:
      "Google запретил API-доступ для этого developer token.",
    RESOURCE_NOT_FOUND: "Ключевое слово не найдено. Создайте новый preview.",
    CANNOT_MODIFY_REMOVED_RESOURCE: "Удалённое ключевое слово изменять нельзя.",
    QUOTA_EXCEEDED:
      "Google Ads ограничил частоту запросов. Проверьте состояние перед новым preview.",
    OUTCOME_UNCERTAIN:
      "Результат запроса Google Ads неизвестен. Не повторяйте commit; проверьте фактическое состояние.",
    VERIFICATION_MISMATCH:
      "Повторное чтение Google Ads не подтвердило запрошенный статус.",
  };
  return {
    code: "google_ads_mutation_failed",
    message:
      messages[safe] ??
      `Google Ads отклонил изменение (${safe}). Проверьте разрешения и данные объекта.`,
    google_error_code: safe,
    google_code: safe,
    ...(fieldPath ? { field_path: fieldPath } : {}),
  };
}
export function writeFailureFromError(error: unknown): GoogleWriteFailure {
  if (error instanceof GoogleAdsApiError)
    return googleWriteFailure(
      error.errors[0]?.error_code ?? "GOOGLE_ADS_ERROR",
      error.errors[0]?.field_path,
    );
  if (error instanceof GoogleAdsWriteError) {
    if (error.failures[0]) return error.failures[0];
    const failure = googleWriteFailure(error.writeCode, error.fieldPath);
    return isLocalGoogleWriteRejection(error)
      ? { ...failure, message: error.message, source: "HOLYMEDIA" }
      : failure;
  }
  if (error instanceof ProviderError && error.providerCode)
    return googleWriteFailure(error.providerCode);
  return googleWriteFailure("OUTCOME_UNCERTAIN");
}
/** These errors are raised before any Google HTTP mutate request is constructed. */
export function isLocalGoogleWriteRejection(error: unknown): boolean {
  return (
    error instanceof GoogleAdsWriteError &&
    [
      "confirmed_write_disabled",
      "google_write_disabled",
      "google_account_not_allowlisted",
      "google_scope_required",
      "google_keyword_status_invalid",
      "google_batch_limit_exceeded",
      "google_batch_empty",
    ].includes(error.writeCode)
  );
}
export function assertGoogleBatch(items: unknown[]): void {
  if (items.length > GOOGLE_MUTATION_BATCH_LIMIT)
    throw new GoogleAdsWriteError(
      "google_batch_limit_exceeded",
      "Не более 500 операций Google Ads за запрос. Разделите batch на несколько preview.",
    );
  if (!items.length)
    throw new GoogleAdsWriteError(
      "google_batch_empty",
      "Укажите хотя бы одно ключевое слово.",
    );
}
export function keywordIdentity(
  account: string,
  raw: unknown,
): GoogleKeywordIdentity {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ProviderError(
      "invalid_request",
      "Неверный объект ключевого слова.",
    );
  const row = raw as Record<string, unknown>;
  if (
    Object.keys(row).some(
      (k) =>
        ![
          "campaign_id",
          "ad_group_id",
          "criterion_id",
          "resource_name",
        ].includes(k),
    )
  )
    throw new ProviderError(
      "invalid_request",
      "Ключевое слово принимает только campaign_id, ad_group_id, criterion_id и resource_name.",
    );
  for (const key of ["campaign_id", "ad_group_id", "criterion_id"])
    if (typeof row[key] !== "string" || !/^[0-9]{1,20}$/.test(row[key]))
      throw new ProviderError("invalid_request", `Укажите корректный ${key}.`);
  const resource = `customers/${customerId(account)}/adGroupCriteria/${row.ad_group_id}~${row.criterion_id}`;
  if (row.resource_name !== undefined && row.resource_name !== resource)
    throw new ProviderError(
      "invalid_request",
      "Google resource_name не соответствует аккаунту и ключевому слову.",
    );
  return {
    campaign_id: row.campaign_id as string,
    ad_group_id: row.ad_group_id as string,
    criterion_id: row.criterion_id as string,
    resource_name: resource,
  };
}
export function keywordBatch(
  account: string,
  raw: unknown,
): GoogleKeywordIdentity[] {
  if (!Array.isArray(raw))
    throw new ProviderError(
      "invalid_request",
      "items должен быть массивом ключевых слов.",
    );
  assertGoogleBatch(raw);
  const items = raw.map((v) => keywordIdentity(account, v));
  if (new Set(items.map((v) => v.resource_name)).size !== items.length)
    throw new ProviderError(
      "invalid_request",
      "Batch содержит повторяющееся ключевое слово.",
    );
  return items;
}

/** Decode indexed GoogleAdsFailure, never echo provider messages/triggers/headers. */
export function googleMutationResults(
  payload: unknown,
  items: GoogleKeywordMutation[],
  validateOnly: boolean,
): GoogleMutationResult[] {
  const root = record(payload),
    partial = record(root.partialFailureError);
  const errors = new Map<number, GoogleWriteFailure>();
  let globalFailure = false;
  if (Number(partial.code ?? 0) !== 0) {
    const details = Array.isArray(partial.details) ? partial.details : [];
    for (const detail of details) {
      const list = record(detail).errors;
      if (!Array.isArray(list)) continue;
      for (const entry of list) {
        const error = record(entry),
          elements = record(error.location).fieldPathElements;
        const operation = Array.isArray(elements)
          ? elements.map(record).find((x) => x.fieldName === "operations")
          : undefined;
        const index = operation?.index;
        const code =
          Object.values(record(error.errorCode)).find(
            (v) => typeof v === "string",
          ) ?? "GOOGLE_ADS_ERROR";
        if (
          !Number.isInteger(index) ||
          Number(index) < 0 ||
          Number(index) >= items.length
        ) {
          globalFailure = true;
          continue;
        }
        errors.set(
          Number(index),
          googleWriteFailure(
            String(code),
            `operations[${index}].update.status`,
          ),
        );
      }
    }
    if (!errors.size) globalFailure = true;
  }
  const results = Array.isArray(root.results) ? root.results : [];
  return items.map((item, index) => {
    const error =
      errors.get(index) ??
      (globalFailure
        ? googleWriteFailure("GOOGLE_ADS_ERROR")
        : !validateOnly &&
            record(results[index]).resourceName !== item.resource_name
          ? googleWriteFailure("OUTCOME_UNCERTAIN")
          : null);
    return { success: !error, error };
  });
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

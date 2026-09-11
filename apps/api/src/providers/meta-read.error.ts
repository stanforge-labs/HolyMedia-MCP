import { ForbiddenException } from "@nestjs/common";
import { ProviderError } from "./provider.errors.js";

const messages = {
  meta_asset_not_accessible:
    "Этот объект Meta недоступен текущему подключению.",
  meta_connection_required:
    "Выберите доступный кабинет текущего подключения Meta.",
  meta_connection_ambiguous:
    "Укажите account_id, чтобы выбрать подключение Meta.",
  meta_permission_missing:
    "Для этой операции Meta не предоставила необходимое разрешение.",
  meta_permission_required:
    "Для чтения реакций и комментариев Meta требует pages_read_user_content или Page Public Content Access. Текущее подключение не предоставляет этот доступ.",
  meta_reauth_required: "Подключение Meta требует повторной авторизации.",
  meta_rate_limited:
    "Meta временно ограничила количество запросов. Повторите позже.",
  meta_api_error:
    "Meta не удалось выполнить запрос. Повторите позже или проверьте доступ к объекту.",
  meta_invalid_parameters: "Проверьте параметры запроса Meta.",
  meta_insights_incompatible_parameters:
    "Эта комбинация параметров Meta Insights не поддерживается.",
} as const;

export class MetaReadError extends ForbiddenException {
  public readonly provider = "META_ADS";
  public context: {
    connectionId?: string;
    assetType?: string;
    assetId?: string;
    endpointCategory?: string;
  } = {};
  public constructor(
    public readonly code: keyof typeof messages,
    public readonly operation: string,
    public readonly retryable = false,
    public readonly upstream_code?: string,
    public readonly httpStatus?: string,
    public readonly upstream_subcode?: string,
    public readonly requirements?: ProviderError["requirements"],
  ) {
    super(messages[code]);
  }
  public publicResult() {
    return {
      code: this.code,
      message: messages[this.code],
      provider: this.provider,
      operation: this.operation,
      retryable: this.retryable,
      user_action: this.requirements
        ? "request_page_content_permission_or_feature"
        : this.code === "meta_reauth_required"
          ? "reconnect"
          : this.retryable
            ? "retry_later"
            : "check_parameters_and_asset_access",
      upstream_code: this.upstream_code ?? null,
      upstream_subcode: this.upstream_subcode ?? null,
      ...(this.requirements
        ? {
            required_permission: this.requirements.permission,
            alternative_feature: this.requirements.alternativeFeature ?? null,
          }
        : {}),
    };
  }
}

export function metaReadError(
  error: unknown,
  operation: string,
): MetaReadError {
  if (error instanceof MetaReadError) return error;
  if (!(error instanceof ProviderError))
    return new MetaReadError("meta_api_error", operation);
  const upstream = /^\d{1,12}$/.test(error.providerCode ?? "")
    ? error.providerCode
    : undefined;
  const code =
    upstream === "190" ||
    [
      "authentication_failed",
      "token_expired",
      "connection_revoked",
      "refresh_failed",
    ].includes(error.code)
      ? "meta_reauth_required"
      : error.code === "insufficient_permissions" ||
          ["10", "200"].includes(upstream ?? "")
        ? "meta_permission_missing"
        : error.code === "rate_limited" ||
            ["4", "17", "32", "613"].includes(upstream ?? "")
          ? "meta_rate_limited"
          : error.code === "invalid_account"
            ? "meta_asset_not_accessible"
            : "meta_api_error";
  return new MetaReadError(
    error.requirements ? "meta_permission_required" : code,
    operation,
    error.retryable || code === "meta_rate_limited",
    upstream,
    error.providerStatus,
    error.providerSubcode,
    error.requirements,
  );
}

import { HttpException } from "@nestjs/common";
import { ProviderError } from "../providers/provider.errors.js";
import { MetaReadError } from "../providers/meta-read.error.js";
import { PublicReadArgumentsError } from "./mcp-public-read-contract.js";

type PublicFailure = {
  code: string;
  message: string;
  retryable: boolean;
  field?: string;
};

/** Public READ responses contain no upstream payload, identifiers or stack traces. */
export function publicReadFailure(error: unknown): PublicFailure {
  if (error instanceof PublicReadArgumentsError)
    return {
      code: error.code,
      message: error.message,
      retryable: false,
      field: error.field,
    };
  if (error instanceof MetaReadError) {
    const code =
      error.code === "meta_reauth_required"
        ? "provider_auth_expired"
        : error.code === "meta_rate_limited"
          ? "rate_limited"
          : error.code === "meta_permission_missing" ||
              error.code === "meta_permission_required"
            ? "permission_denied"
            : error.code === "meta_connection_required" ||
                error.code === "meta_connection_ambiguous" ||
                error.code === "meta_asset_not_accessible"
              ? "account_unavailable"
              : "provider_unavailable";
    return known(code);
  }
  if (error instanceof ProviderError) {
    const code = [
      "token_expired",
      "refresh_failed",
      "connection_revoked",
      "authentication_failed",
      "authorization_denied",
    ].includes(error.code)
      ? "provider_auth_expired"
      : error.code === "rate_limited"
        ? "rate_limited"
        : error.code === "insufficient_permissions"
          ? "permission_denied"
          : ["invalid_account", "account_disabled"].includes(error.code)
            ? "account_unavailable"
            : error.code === "invalid_request"
              ? "invalid_arguments"
              : "provider_unavailable";
    return known(code);
  }
  if (error instanceof HttpException) {
    const message = error.message;
    if (
      message === "Account is not available to this service token." ||
      message === "Account is unavailable in restricted TEST MCP."
    )
      return known("account_unavailable");
    if (
      message === "Service token does not have read access." ||
      message === "MCP read scope is required."
    )
      return known("permission_denied");
    if (message === "Feature is not available for this workspace.")
      return known("billing_unavailable");
    if (message === "Workspace usage limit reached.")
      return known("quota_exceeded");
    if (
      [
        "Unsupported provider.",
        "account_id is required.",
        "start_date and end_date are required.",
        "campaign_id is required.",
        "Invalid Google campaign status.",
      ].includes(message)
    )
      return known("invalid_arguments");
    if (error.getStatus() === 429) return known("rate_limited");
    if (error.getStatus() === 403) return known("permission_denied");
    if (error.getStatus() === 404) return known("account_unavailable");
    if (error.getStatus() === 400) return known("invalid_arguments");
    if (error.getStatus() === 503) return known("provider_unavailable");
    if (error.getStatus() >= 500) return known("internal_error");
  }
  return known("internal_error");
}

function known(code: string): PublicFailure {
  const messages: Record<string, string> = {
    invalid_arguments:
      "Проверьте обязательные поля и типы аргументов инструмента.",
    account_unavailable:
      "Указанный аккаунт недоступен в текущем рабочем пространстве или для этого доступа.",
    permission_denied: "Для этого чтения не хватает разрешений.",
    billing_unavailable:
      "Функция MCP недоступна для текущего рабочего пространства.",
    quota_exceeded: "Лимит MCP-запросов рабочего пространства исчерпан.",
    provider_auth_expired:
      "Подключение провайдера требует повторной авторизации.",
    provider_unavailable: "Провайдер не ответил или временно недоступен.",
    rate_limited: "Достигнут лимит запросов; повторите чтение позже.",
    internal_error:
      "Внутренняя ошибка HolyPilot. Передайте поддержке время запроса.",
  };
  return {
    code,
    message: messages[code]!,
    retryable: [
      "provider_unavailable",
      "rate_limited",
      "internal_error",
    ].includes(code),
  };
}

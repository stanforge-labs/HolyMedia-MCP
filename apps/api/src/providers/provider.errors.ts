import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { ProviderErrorCode } from "./provider.types.js";

export class ProviderError extends Error {
  public constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly retryable = false,
    public readonly providerStatus?: string,
    public readonly providerCode?: string,
    public readonly providerSubcode?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function toSafeProviderException(error: unknown): Error {
  if (!(error instanceof ProviderError))
    return new ServiceUnavailableException("Provider operation failed.");
  const messages: Partial<Record<ProviderErrorCode, string>> = {
    authorization_denied: "Провайдер отклонил авторизацию.",
    insufficient_permissions: "У подключения недостаточно разрешений.",
    provider_not_configured: "Провайдер пока не настроен.",
    invalid_oauth_state: "OAuth-сессия недействительна или истекла.",
    token_expired: "Срок авторизации истёк. Подключите провайдер повторно.",
    refresh_failed: "Не удалось обновить авторизацию провайдера.",
    provider_unavailable: "Провайдер временно недоступен.",
    rate_limited: "Провайдер временно ограничил частоту запросов.",
    invalid_account: "Рекламный кабинет недействителен.",
    account_disabled: "Рекламный кабинет отключён.",
    connection_revoked: "Доступ к подключению отозван.",
    provider_response_invalid: "Провайдер вернул неожиданный ответ.",
    authentication_failed: "Провайдер не подтвердил авторизацию.",
  };
  const message = messages[error.code] ?? "Операция провайдера не выполнена.";
  if (
    error.code === "provider_not_configured" ||
    error.code === "invalid_oauth_state" ||
    error.code === "authorization_denied" ||
    error.code === "insufficient_permissions"
  ) {
    return new BadRequestException(message);
  }
  return new ServiceUnavailableException(message);
}

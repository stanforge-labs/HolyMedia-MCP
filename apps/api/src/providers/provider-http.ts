import { ProviderError } from "./provider.errors.js";

export async function providerJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const error = safeProviderError(payload);
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          error.code === "insufficient_permissions"
            ? "insufficient_permissions"
            : "authentication_failed",
          "Provider authorization was rejected.",
          false,
          String(response.status),
          error.providerCode,
          error.providerSubcode,
        );
      }
      if (response.status === 404) {
        throw new ProviderError(
          "invalid_account",
          "Provider account was not found.",
          false,
          String(response.status),
          error.providerCode,
          error.providerSubcode,
        );
      }
      if (response.status === 429) {
        throw new ProviderError(
          "rate_limited",
          "Provider rate limit was reached.",
          true,
          String(response.status),
          error.providerCode,
          error.providerSubcode,
        );
      }
      if (response.status >= 500) {
        throw new ProviderError(
          "provider_unavailable",
          "Provider is temporarily unavailable.",
          true,
          String(response.status),
          error.providerCode,
          error.providerSubcode,
        );
      }
      throw new ProviderError(
        error.code,
        "Provider rejected the request.",
        false,
        String(response.status),
        error.providerCode,
        error.providerSubcode,
      );
    }
    return payload as T;
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ProviderError(
        "provider_unavailable",
        "Provider request timed out.",
        true,
      );
    }
    throw new ProviderError(
      "provider_unavailable",
      "Provider request failed.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function assertExternalId(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(normalized)) {
    throw new ProviderError("invalid_account", `${label} is invalid.`);
  }
  return normalized;
}

function safeProviderError(payload: unknown): {
  code: "provider_response_invalid" | "insufficient_permissions";
  providerCode?: string;
  providerSubcode?: string;
} {
  if (!payload || typeof payload !== "object") {
    return { code: "provider_response_invalid" };
  }
  const value = payload as Record<string, unknown>;
  const error = value.error;
  const rawSubcode =
    error && typeof error === "object"
      ? String((error as Record<string, unknown>).error_subcode ?? "")
      : "";
  const subcode = /^\d{1,12}$/.test(rawSubcode)
    ? { providerSubcode: rawSubcode }
    : {};
  const providerCode =
    typeof error === "string"
      ? error.slice(0, 80) || undefined
      : error && typeof error === "object"
        ? String(
            (error as Record<string, unknown>).status ??
              (error as Record<string, unknown>).code ??
              "",
          ).slice(0, 80) || undefined
        : undefined;
  const message =
    typeof error === "string"
      ? String(value.error_description ?? "").toLowerCase()
      : error && typeof error === "object"
        ? String((error as Record<string, unknown>).message ?? "").toLowerCase()
        : "";
  return /permission|access|scope|forbidden|unauthorized/.test(message)
    ? {
        code: "insufficient_permissions",
        ...subcode,
        ...(providerCode ? { providerCode } : {}),
      }
    : {
        code: "provider_response_invalid",
        ...subcode,
        ...(providerCode ? { providerCode } : {}),
      };
}

export function encodeJson(value: unknown): string {
  return JSON.stringify(value);
}

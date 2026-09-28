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
      if (error.code === "google_ads_manager_metrics_unsupported") {
        throw new ProviderError(
          error.code,
          "Google Ads campaign metrics are not available for manager accounts.",
          false,
          String(response.status),
          error.providerCode,
        );
      }
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
          error.requirements,
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
          error.requirements,
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
          error.requirements,
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
          error.requirements,
        );
      }
      throw new ProviderError(
        error.code,
        "Provider rejected the request.",
        false,
        String(response.status),
        error.providerCode,
        error.providerSubcode,
        error.requirements,
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
  code:
    | "provider_response_invalid"
    | "insufficient_permissions"
    | "google_ads_manager_metrics_unsupported";
  providerCode?: string;
  providerSubcode?: string;
  requirements?: {
    permission: "pages_read_user_content";
    alternativeFeature?: "Page Public Content Access";
  };
} {
  if (!payload || typeof payload !== "object") {
    return { code: "provider_response_invalid" };
  }
  const first = Array.isArray(payload)
    ? payload.find((item): item is Record<string, unknown> =>
        Boolean(item && typeof item === "object" && "error" in item),
      )
    : payload;
  const value =
    first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : {};
  const error = value.error;
  const errorValue =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : value;
  const details = Array.isArray(errorValue.details) ? errorValue.details : [];
  const managerError = details
    .flatMap((detail) =>
      detail && typeof detail === "object" && Array.isArray(detail.errors)
        ? detail.errors
        : [],
    )
    .find((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const code = (entry as Record<string, unknown>).errorCode;
      return (
        Boolean(code) &&
        typeof code === "object" &&
        (code as Record<string, unknown>).queryError ===
          "REQUESTED_METRICS_FOR_MANAGER"
      );
    });
  if (managerError) {
    return {
      code: "google_ads_manager_metrics_unsupported",
      providerCode: "REQUESTED_METRICS_FOR_MANAGER",
    };
  }
  const rawSubcode =
    error && typeof error === "object"
      ? String(errorValue.error_subcode ?? "")
      : "";
  const subcode = /^\d{1,12}$/.test(rawSubcode)
    ? { providerSubcode: rawSubcode }
    : {};
  const providerCode =
    typeof error === "string"
      ? error.slice(0, 80) || undefined
      : error && typeof error === "object"
        ? String(errorValue.status ?? errorValue.code ?? "").slice(0, 80) ||
          undefined
        : undefined;
  const message =
    typeof error === "string"
      ? String(value.error_description ?? "").toLowerCase()
      : error && typeof error === "object"
        ? String(errorValue.message ?? "").toLowerCase()
        : "";
  return /permission|access|scope|forbidden|unauthorized/.test(message)
    ? {
        code: "insufficient_permissions",
        ...(providerCode === "10" && message.includes("pages_read_user_content")
          ? {
              requirements: {
                permission: "pages_read_user_content" as const,
                ...(message.includes("page public content access")
                  ? {
                      alternativeFeature: "Page Public Content Access" as const,
                    }
                  : {}),
              },
            }
          : {}),
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

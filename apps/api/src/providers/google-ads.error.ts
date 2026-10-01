import { ProviderError } from "./provider.errors.js";

export type GoogleAdsErrorDetail = {
  error_code: string;
  message: string;
  field_path?: string;
};

export class GoogleAdsApiError extends ProviderError {
  public constructor(
    public readonly errors: GoogleAdsErrorDetail[],
    public readonly requestId: string | undefined,
    status: number,
  ) {
    const managerMetrics = errors.some(
      (error) => error.error_code === "REQUESTED_METRICS_FOR_MANAGER",
    );
    super(
      managerMetrics
        ? "google_ads_manager_metrics_unsupported"
        : status === 401
          ? "authentication_failed"
          : status === 403
            ? "insufficient_permissions"
            : status === 429
              ? "rate_limited"
              : status >= 500
                ? "provider_unavailable"
                : "provider_response_invalid",
      errors[0]?.message ?? "Google Ads rejected the request.",
      status === 429 || status >= 500,
      String(status),
      errors[0]?.error_code,
    );
    this.name = "GoogleAdsApiError";
  }
}

export function googleAdsApiError(
  payload: unknown,
  response: Response,
): GoogleAdsApiError | undefined {
  const outer = record(payload);
  const error = record(outer.error);
  if (!Object.keys(error).length) return undefined;
  const details = Array.isArray(error.details) ? error.details : [];
  const failures = details.filter(
    (detail) =>
      typeof record(detail)["@type"] === "string" &&
      String(record(detail)["@type"]).includes("GoogleAdsFailure"),
  );
  const entries = failures.flatMap((failure) =>
    Array.isArray(record(failure).errors)
      ? (record(failure).errors as unknown[])
      : [],
  );
  const fallbackCode =
    safeCode(error.status) ?? safeCode(error.code) ?? "GOOGLE_ADS_ERROR";
  const errors = entries.slice(0, 50).map((entry) => {
    const value = record(entry);
    const codeValues = Object.values(record(value.errorCode));
    const code = codeValues.map(safeCode).find(Boolean) ?? fallbackCode;
    const fieldPath = fieldPathFromLocation(value.location);
    return {
      error_code: code,
      message: safeMessage(value.message) ?? "Google Ads rejected the request.",
      ...(fieldPath ? { field_path: fieldPath } : {}),
    };
  });
  if (!errors.length)
    errors.push({
      error_code: fallbackCode,
      message: safeMessage(error.message) ?? "Google Ads rejected the request.",
    });
  const requestId = safeIdentifier(
    failures.map((failure) => record(failure).requestId).find(Boolean) ??
      error.requestId ??
      response.headers.get("request-id"),
  );
  return new GoogleAdsApiError(errors, requestId, response.status);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function safeCode(value: unknown): string | undefined {
  const code = String(value ?? "");
  return /^[A-Za-z0-9_]{1,80}$/.test(code) ? code : undefined;
}

function safeIdentifier(value: unknown): string | undefined {
  const id = String(value ?? "");
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : undefined;
}

function safeMessage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const message = value
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(
      /\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|authorization|developer[_-]?token|api[_-]?key|password|set-cookie|cookie)\s*[:=]\s*[^\s,;]+/gi,
      "[redacted]",
    )
    .slice(0, 500)
    .trim();
  return message || undefined;
}

function fieldPathFromLocation(location: unknown): string | undefined {
  const elements = record(location).fieldPathElements;
  if (!Array.isArray(elements)) return undefined;
  const path = elements
    .map((element) => {
      const value = record(element);
      const name = String(value.fieldName ?? "");
      if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name)) return "";
      const index = value.index;
      return Number.isInteger(index) && Number(index) >= 0
        ? `${name}[${index}]`
        : name;
    })
    .filter(Boolean)
    .join(".");
  return path || undefined;
}

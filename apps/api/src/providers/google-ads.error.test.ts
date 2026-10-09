import { afterEach, describe, expect, it, vi } from "vitest";
import { providerJson } from "./provider-http.js";
import { GoogleAdsApiError, googleAdsApiError } from "./google-ads.error.js";
import { ProviderError } from "./provider.errors.js";
import {
  googleAdsMcpErrorFields,
  mcpFailureMessage,
} from "../mcp/mcp.controller.js";

afterEach(() => vi.unstubAllGlobals());

const failure = (errors: unknown[], requestId = "req-123") => ({
  error: {
    code: 400,
    status: "INVALID_ARGUMENT",
    message: "Request contains an invalid argument.",
    details: [
      {
        "@type":
          "type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure",
        errors,
        requestId,
      },
    ],
  },
});

async function request(payload: unknown, status = 400) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status,
        headers: {
          "content-type": "application/json",
          "request-id": "header-123",
        },
      }),
    ),
  );
  return providerJson(
    "https://googleads.googleapis.com/v24/test",
    { method: "GET" },
    1000,
    googleAdsApiError,
  );
}

describe("Google Ads structured REST errors", () => {
  it("maps a v24 searchStream array HTTP400 through providerJson, retaining detailed query code", async () => {
    const error = await request([
      failure(
        [
          {
            errorCode: { queryError: "BAD_ENUM_CONSTANT" },
            message: "Недопустимое enum-значение.",
            location: { fieldPathElements: [{ fieldName: "query" }] },
          },
        ],
        "stream-req-123",
      ),
    ]).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GoogleAdsApiError);
    expect(error).toMatchObject({
      providerStatus: "400",
      providerCode: "BAD_ENUM_CONSTANT",
      requestId: "stream-req-123",
    });
    expect(googleAdsMcpErrorFields(error)).toMatchObject({
      error_code: "BAD_ENUM_CONSTANT",
      request_id: "stream-req-123",
      field_path: "query",
    });
    expect(mcpFailureMessage(error)).toBe("Недопустимое enum-значение.");
  });

  it("preserves bounded multiple stream envelopes and error order without nesting arbitrary responses", async () => {
    const error = await request([
      { results: [{ customer: { id: "1234567890" } }] },
      failure(
        [
          {
            errorCode: { queryError: "INVALID_FIELD_NAME" },
            message: "Unknown field",
          },
        ],
        "first-request",
      ),
      null,
      failure(
        [
          {
            errorCode: { requestError: "REQUIRED_FIELD_MISSING" },
            message: "Missing field",
          },
        ],
        "second-request",
      ),
    ]).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GoogleAdsApiError);
    if (!(error instanceof GoogleAdsApiError))
      throw new Error("Expected structured Google Ads error");
    expect(
      error.errors.map((e: { error_code: string }) => e.error_code),
    ).toEqual(["INVALID_FIELD_NAME", "REQUIRED_FIELD_MISSING"]);
    expect(error.requestId).toBe("first-request");
    const response = new Response(null, { status: 400 });
    for (const unsupported of [
      [],
      [null, {}, { results: [] }],
      [[failure([])]],
      Array.from({ length: 51 }, () => failure([])),
    ])
      expect(googleAdsApiError(unsupported, response)).toBeUndefined();
  });

  it("caps aggregate details/errors/path elements and preserves HTTP classification", async () => {
    const payload = Array.from({ length: 50 }, (_, index) =>
      failure(
        Array.from({ length: 50 }, () => ({
          errorCode: { queryError: "INVALID_FIELD_NAME" },
          message: "Unknown field",
          location: {
            fieldPathElements: Array.from({ length: 100 }, () => ({
              fieldName: "query",
            })),
          },
        })),
        `req-${index}`,
      ),
    );
    const parsed = googleAdsApiError(
      payload,
      new Response(null, { status: 403 }),
    );
    expect(parsed?.errors).toHaveLength(50);
    expect(parsed?.errors[0]?.field_path?.split(".")).toHaveLength(50);
    expect(parsed).toMatchObject({
      code: "insufficient_permissions",
      providerStatus: "403",
      providerCode: "INVALID_FIELD_NAME",
      requestId: "req-0",
    });
    expect(
      googleAdsApiError([failure([])], new Response(null, { status: 429 })),
    ).toMatchObject({ code: "rate_limited", retryable: true });
  });

  it("redacts all streamed credentials and selects safe request ID/header rather than raw metadata", async () => {
    const error = await request([
      failure(
        [
          {
            errorCode: { queryError: "INVALID_FIELD_NAME" },
            message:
              "Bearer syntheticBearer access_token=syntheticAccess refresh_token=syntheticRefresh client_secret=syntheticSecret cookie=syntheticCookie developer_token=syntheticDeveloper",
          },
        ],
        "Bearer syntheticRequest",
      ),
    ]).catch((value: unknown) => value);
    expect(error).toMatchObject({ requestId: "header-123" });
    const fields = JSON.stringify(googleAdsMcpErrorFields(error));
    for (const secret of [
      "syntheticBearer",
      "syntheticAccess",
      "syntheticRefresh",
      "syntheticSecret",
      "syntheticCookie",
      "syntheticDeveloper",
      "syntheticRequest",
    ])
      expect(fields).not.toContain(secret);
  });

  it("preserves streamed manager-account specialization and safe generic envelope fallback", async () => {
    const parsed = googleAdsApiError(
      [
        failure([
          {
            errorCode: { queryError: "REQUESTED_METRICS_FOR_MANAGER" },
            message: "Manager metrics unsupported",
          },
        ]),
      ],
      new Response(null, { status: 400 }),
    );
    expect(parsed).toMatchObject({
      code: "google_ads_manager_metrics_unsupported",
      providerCode: "REQUESTED_METRICS_FOR_MANAGER",
    });
    const fallback = googleAdsApiError(
      [
        {
          error: {
            status: "INVALID_ARGUMENT",
            message: "Bearer synthetic",
            details: [null, { "@type": "unrelated", errors: [] }],
          },
        },
      ],
      new Response(null, { status: 400 }),
    );
    expect(fallback?.errors).toEqual([
      { error_code: "INVALID_ARGUMENT", message: "Bearer [redacted]" },
    ]);
  });

  it("surfaces a single error with safe code and request ID", async () => {
    const error = await request(
      failure([
        {
          errorCode: { queryError: "INVALID_FIELD_NAME" },
          message: "Unknown field",
        },
      ]),
    ).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GoogleAdsApiError);
    expect(mcpFailureMessage(error)).toBe("Unknown field");
    expect(googleAdsMcpErrorFields(error)).toMatchObject({
      provider: "GOOGLE_ADS",
      error_code: "INVALID_FIELD_NAME",
      request_id: "req-123",
      errors: [{ error_code: "INVALID_FIELD_NAME", message: "Unknown field" }],
    });
  });

  it("preserves field path and multiple Google errors while redacting credentials", async () => {
    const error = await request(
      failure([
        {
          errorCode: { requestError: "REQUIRED_FIELD_MISSING" },
          message: "Missing field; Bearer abc123 access_token=top-secret",
          location: {
            fieldPathElements: [
              { fieldName: "operations", index: 0 },
              { fieldName: "create" },
              { fieldName: "name" },
            ],
          },
        },
        {
          errorCode: { fieldError: "INVALID_FIELD" },
          message: "Invalid field",
          location: { fieldPathElements: [{ fieldName: "query" }] },
        },
      ]),
    ).catch((value: unknown) => value);
    const fields = googleAdsMcpErrorFields(error);
    expect(fields).toMatchObject({
      field_path: "operations[0].create.name",
      errors: [
        {
          error_code: "REQUIRED_FIELD_MISSING",
          field_path: "operations[0].create.name",
        },
        { error_code: "INVALID_FIELD", field_path: "query" },
      ],
    });
    expect(JSON.stringify(fields)).not.toContain("abc123");
    expect(JSON.stringify(fields)).not.toContain("top-secret");
  });

  it("falls back to request-id header and preserves manager-account classification", async () => {
    const error = await request(
      failure(
        [
          {
            errorCode: { queryError: "REQUESTED_METRICS_FOR_MANAGER" },
            message: "Manager metrics are not available",
          },
        ],
        "",
      ),
    ).catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: "google_ads_manager_metrics_unsupported",
      requestId: "header-123",
    });
  });

  it("keeps network and non-Google failures generic", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Bearer secret")),
    );
    await expect(
      providerJson(
        "https://googleads.googleapis.com/v24/test",
        { method: "GET" },
        1000,
        googleAdsApiError,
      ),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      message: "Provider request failed.",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ error: { message: "Private upstream text" } }),
            { status: 400 },
          ),
        ),
    );
    await expect(
      providerJson("https://meta.example.test", { method: "GET" }, 1000),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(
      googleAdsMcpErrorFields(
        new ProviderError("provider_response_invalid", "generic"),
      ),
    ).toEqual({});
  });
});

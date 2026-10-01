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

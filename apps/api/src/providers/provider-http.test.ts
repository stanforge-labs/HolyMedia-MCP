import { afterEach, describe, expect, it, vi } from "vitest";
import { providerJson } from "./provider-http.js";

afterEach(() => vi.unstubAllGlobals());

describe("provider JSON errors", () => {
  it("recognizes Google Ads manager-account metrics errors in SearchStream arrays", async () => {
    const payload = [
      {
        error: {
          code: 400,
          message: "Request contains an invalid argument.",
          status: "INVALID_ARGUMENT",
          details: [
            {
              "@type":
                "type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure",
              errors: [
                {
                  errorCode: {
                    queryError: "REQUESTED_METRICS_FOR_MANAGER",
                  },
                  message: "Metrics cannot be requested for a manager account.",
                },
              ],
            },
          ],
        },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(payload), {
            status: 400,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    await expect(
      providerJson(
        "https://googleads.googleapis.com/v24/customers/1234567890/googleAds:searchStream",
        { method: "POST" },
        1000,
      ),
    ).rejects.toMatchObject({
      code: "google_ads_manager_metrics_unsupported",
      retryable: false,
      providerStatus: "400",
      providerCode: "REQUESTED_METRICS_FOR_MANAGER",
      message:
        "Google Ads campaign metrics are not available for manager accounts.",
    });
  });
});

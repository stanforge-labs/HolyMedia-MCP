import { describe, expect, it } from "vitest";
import {
  ProviderError,
  shouldMarkConnectionDegraded,
  toSafeProviderException,
} from "./provider.errors.js";

describe("provider error boundary", () => {
  it("does not expose provider error details", () => {
    const safe = toSafeProviderException(
      new ProviderError(
        "authorization_denied",
        "provider response contained a secret access token",
      ),
    );
    expect(safe.message).toBe("Провайдер отклонил авторизацию.");
    expect(safe.message).not.toContain("secret");
  });

  it("does not mark a healthy connection degraded for MCC-only metrics", () => {
    expect(
      shouldMarkConnectionDegraded(
        new ProviderError(
          "google_ads_manager_metrics_unsupported",
          "Metrics cannot be requested for manager accounts.",
          false,
          "400",
          "REQUESTED_METRICS_FOR_MANAGER",
        ),
      ),
    ).toBe(false);
    expect(
      shouldMarkConnectionDegraded(
        new ProviderError("authentication_failed", "auth failed"),
      ),
    ).toBe(true);
  });

  it("does not degrade all Google Ads customers for one denied customer", () => {
    expect(
      shouldMarkConnectionDegraded(
        new ProviderError(
          "insufficient_permissions",
          "Customer access denied.",
          false,
          "403",
          "PERMISSION_DENIED",
        ),
      ),
    ).toBe(false);
    expect(
      shouldMarkConnectionDegraded(
        new ProviderError("insufficient_permissions", "Missing OAuth scope."),
      ),
    ).toBe(true);
    expect(
      shouldMarkConnectionDegraded(
        new ProviderError(
          "insufficient_permissions",
          "Meta permission missing.",
          false,
          "400",
          "10",
        ),
      ),
    ).toBe(true);
  });
});

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
});

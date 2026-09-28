import { describe, expect, it } from "vitest";
import { ProviderError } from "../providers/provider.errors.js";
import { mcpFailureMessage } from "./mcp.controller.js";

describe("MCP provider error messages", () => {
  it("explains manager-account metric errors with the correct user action", () => {
    expect(
      mcpFailureMessage(
        new ProviderError(
          "google_ads_manager_metrics_unsupported",
          "safe internal message",
          false,
          "400",
          "REQUESTED_METRICS_FOR_MANAGER",
        ),
      ),
    ).toBe(
      "Управляющий аккаунт Google Ads не содержит метрик кампаний. Повторите отчёт для клиентского рекламного аккаунта внутри этого MCC.",
    );
  });
});

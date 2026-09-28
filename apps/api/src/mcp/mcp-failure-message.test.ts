import { describe, expect, it } from "vitest";
import { ProviderError } from "../providers/provider.errors.js";
import { mcpFailureMessage } from "./mcp.controller.js";

describe("MCP provider error messages", () => {
  it("does not call a denied Google Ads customer a Meta permission error", () => {
    expect(
      mcpFailureMessage(
        new ProviderError(
          "insufficient_permissions",
          "upstream detail not for clients",
          false,
          "403",
          "PERMISSION_DENIED",
        ),
      ),
    ).toBe(
      "Google Ads не разрешает доступ к этому клиентскому кабинету. Выберите другой кабинет или проверьте права доступа.",
    );
    expect(
      mcpFailureMessage(
        new ProviderError(
          "insufficient_permissions",
          "Meta permission missing",
        ),
      ),
    ).toBe("У подключения Meta недостаточно разрешений для этой операции.");
  });

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

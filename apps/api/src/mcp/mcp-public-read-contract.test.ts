import { describe, expect, it } from "vitest";
import {
  ForbiddenException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ProviderError } from "../providers/provider.errors.js";
import { publicTools } from "./mcp-public-tools.js";
import { McpService } from "./mcp.service.js";
import { publicReadFailure } from "./mcp-public-read-errors.js";
import { validatePublicReadArguments } from "./mcp-public-read-contract.js";

const account = { provider: "GOOGLE_ADS", account_id: "1234567890" };
const four = [
  "get_account_status",
  "list_campaigns",
  "run_connection_diagnostics",
  "get_status_summary",
];

describe("public MCP READ contract", () => {
  const listed = publicTools(McpService.prototype.tools.call({} as McpService));
  for (const name of four) {
    it(`${name} advertises and enforces explicit account fields`, () => {
      const schema = listed.find((tool) => tool.name === name)!.inputSchema;
      expect(schema).toMatchObject({
        type: "object",
        additionalProperties: false,
        required: ["provider", "account_id"],
      });
      expect(schema.properties).toMatchObject({
        provider: {
          type: "string",
          enum: expect.arrayContaining(["GOOGLE_ADS", "META_ADS"]),
        },
        account_id: { type: "string" },
      });
      expect(() => validatePublicReadArguments(name, account)).not.toThrow();
      expect(() =>
        validatePublicReadArguments(name, { account_id: account.account_id }),
      ).toThrow(/provider/);
      expect(() =>
        validatePublicReadArguments(name, {
          ...account,
          account_id: 1234567890,
        }),
      ).toThrow(/account_id/);
      expect(() =>
        validatePublicReadArguments(name, { ...account, provider: "google" }),
      ).toThrow(/provider/);
      expect(() =>
        validatePublicReadArguments(name, {
          ...account,
          workspace_id: "other",
        }),
      ).toThrow(/unsupported_field/);
    });
  }

  it("bounds canonical dates, page size and rejects guessed aliases", () => {
    const schema = listed.find(
      (tool) => tool.name === "list_campaigns",
    )!.inputSchema;
    expect(schema.properties).toMatchObject({
      start_date: { format: "date" },
      end_date: { format: "date" },
      limit: { minimum: 1, maximum: 500 },
    });
    const valid = {
      ...account,
      start_date: "2026-01-01",
      end_date: "2026-12-31",
      limit: 100,
    };
    expect(() =>
      validatePublicReadArguments("list_campaigns", valid),
    ).not.toThrow();
    for (const bad of [
      { ...account, startDate: "2026-01-01", endDate: "2026-01-31" },
      { ...account, start_date: "2026-01-01" },
      { ...account, start_date: "2026-02-30", end_date: "2026-03-01" },
      { ...account, start_date: "2025-01-01", end_date: "2026-12-31" },
      { ...account, limit: 501 },
      { ...account, limit: 1.5 },
    ])
      expect(() =>
        validatePublicReadArguments("list_campaigns", bad),
      ).toThrow();
    expect(() =>
      validatePublicReadArguments("get_basic_metrics", account),
    ).toThrow(/start_date/);
    expect(() =>
      validatePublicReadArguments("list_ad_accounts", {}),
    ).not.toThrow();
    expect(() =>
      validatePublicReadArguments("list_ad_accounts", {
        provider: "GOOGLE_ADS",
      }),
    ).not.toThrow();
    expect(() =>
      validatePublicReadArguments("compare_periods", account),
    ).toThrow(/current_start_date/);
    expect(() =>
      validatePublicReadArguments("get_search_console_report", { days: 366 }),
    ).toThrow(/days/);
    expect(() =>
      validatePublicReadArguments("list_search_console_properties", {}),
    ).not.toThrow();
    expect(() =>
      validatePublicReadArguments("get_flexible_insights", {
        ...account,
        since: "2026-01-01",
        until: "2026-01-31",
      }),
    ).not.toThrow();
    expect(() =>
      validatePublicReadArguments("get_flexible_insights", {
        ...account,
        since: "2026-01-01",
        date_preset: "last_7d",
      }),
    ).toThrow();
  });

  it("separates safe machine-readable failures without leaking upstream messages", () => {
    expect(
      publicReadFailure(
        new ForbiddenException(
          "Account is not available to this service token.",
        ),
      ).code,
    ).toBe("account_unavailable");
    expect(
      publicReadFailure(
        new ForbiddenException("Service token does not have read access."),
      ).code,
    ).toBe("permission_denied");
    for (const [providerCode, publicCode] of [
      ["token_expired", "provider_auth_expired"],
      ["rate_limited", "rate_limited"],
      ["provider_unavailable", "provider_unavailable"],
      ["insufficient_permissions", "permission_denied"],
    ] as const) {
      const failure = publicReadFailure(
        new ProviderError(providerCode, "SECRET upstream payload"),
      );
      expect(failure.code).toBe(publicCode);
      expect(JSON.stringify(failure)).not.toContain("SECRET");
    }
    expect(publicReadFailure(new Error("SECRET internal stack"))).toMatchObject(
      { code: "internal_error" },
    );
    expect(
      publicReadFailure(new InternalServerErrorException("SECRET")),
    ).toMatchObject({ code: "internal_error" });
    expect(
      publicReadFailure(new ServiceUnavailableException("SECRET")),
    ).toMatchObject({ code: "provider_unavailable" });
  });
});

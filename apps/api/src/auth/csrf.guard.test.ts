import { describe, expect, it } from "vitest";
import { CsrfGuard } from "./csrf.guard.js";

function context(request: Record<string, unknown>) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

describe("CsrfGuard", () => {
  const allowedOrigin =
    process.env.CORS_ORIGINS?.split(",")[0]?.trim() ?? "http://localhost:3000";

  it("allows safe methods", () => {
    const guard = new CsrfGuard();
    expect(
      guard.canActivate(context({ method: "GET", headers: {}, cookies: {} })),
    ).toBe(true);
  });

  it("rejects a state-changing request without a matching proof", () => {
    const guard = new CsrfGuard();
    expect(() =>
      guard.canActivate(
        context({
          method: "POST",
          headers: { origin: "http://localhost:3000" },
          cookies: { hm_v2_csrf: "cookie-token" },
        }),
      ),
    ).toThrow("CSRF validation failed.");
  });

  it("accepts the same CSRF token from cookie and header", () => {
    const guard = new CsrfGuard();
    expect(
      guard.canActivate(
        context({
          method: "POST",
          headers: {
            origin: allowedOrigin,
            "x-csrf-token": "same-token",
          },
          cookies: { hm_v2_csrf: "same-token" },
        }),
      ),
    ).toBe(true);
  });

  it("allows bearer-authenticated machine requests without browser CSRF cookies", () => {
    const guard = new CsrfGuard();
    expect(
      guard.canActivate(
        context({
          method: "POST",
          headers: { authorization: "Bearer hmst_test_token" },
          cookies: {},
        }),
      ),
    ).toBe(true);
  });

  it("allows unauthenticated MCP POSTs to reach their OAuth challenges", () => {
    const guard = new CsrfGuard();
    for (const url of ["/mcp", "/mcp/public"]) {
      expect(
        guard.canActivate(
          context({ method: "POST", url, headers: {}, cookies: {} }),
        ),
      ).toBe(true);
    }
  });

  it("requires browser CSRF proof for approval view and decision even with a bearer", () => {
    const guard = new CsrfGuard();
    for (const url of [
      "/api/v1/mcp/public/approval/view",
      "/api/v1/mcp/public/approval",
    ]) {
      expect(() =>
        guard.canActivate(
          context({
            method: "POST",
            url,
            headers: { authorization: "Bearer test" },
            cookies: {},
          }),
        ),
      ).toThrow("Browser approval requires a web session.");
    }
  });

  it("rejects an origin outside the configured allowlist", () => {
    const guard = new CsrfGuard();
    expect(() =>
      guard.canActivate(
        context({
          method: "POST",
          headers: {
            origin: "https://attacker.example",
            "x-csrf-token": "same-token",
          },
          cookies: { hm_v2_csrf: "same-token" },
        }),
      ),
    ).toThrow("CSRF validation failed.");
  });
});

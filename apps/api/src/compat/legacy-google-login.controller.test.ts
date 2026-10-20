import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleLoginFailure } from "../auth/google-login.service.js";
import { LegacyGoogleLoginController } from "./legacy-google-login.controller.js";

function setup(localReadonly = false) {
  vi.stubEnv("NODE_ENV", localReadonly ? "development" : "test");
  vi.stubEnv(
    "HOLYMEDIA_PUBLIC_BASE_URL",
    localReadonly ? "http://127.0.0.1:23300" : "https://mcp-test.holymedia.kz",
  );
  vi.stubEnv(
    "CORS_ORIGINS",
    localReadonly ? "http://127.0.0.1:23300" : "https://mcp-test.holymedia.kz",
  );
  if (localReadonly) {
    vi.stubEnv("QRS_TEST_LOCAL_READONLY_AUTH", "true");
    vi.stubEnv(
      "PROVIDER_GOOGLE_REDIRECT_URI",
      "http://127.0.0.1:24404/oauth/google/callback",
    );
  }
  vi.stubEnv("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", "8590146099");
  vi.stubEnv("QRS_TEST_RESTRICTED_AUTH", "true");
  const google = {
    stateMatchesCookie: vi.fn().mockReturnValue(true),
    consumeState: vi.fn().mockResolvedValue({ nextPath: "/auth?connected=1" }),
    exchangeCode: vi.fn().mockResolvedValue({
      email: "owner@example.test",
      name: "Owner",
    }),
  };
  const auth = {
    loginWithGoogle: vi.fn().mockResolvedValue({
      sessionToken: "test-session",
      onboardingRequired: false,
    }),
  };
  const cookies = { setSession: vi.fn() };
  const audit = { record: vi.fn() };
  const reply = { clearCookie: vi.fn() };
  const controller = new LegacyGoogleLoginController(
    google as never,
    auth as never,
    cookies as never,
    audit as never,
  );
  const callback = (error?: string) =>
    controller.callback(
      "code",
      "state",
      error,
      {
        requestId: "synthetic-request",
        cookies: { hm_v2_google_login_state: "state" },
      } as never,
      reply as never,
    );
  return { google, auth, cookies, audit, reply, callback };
}

afterEach(() => vi.unstubAllEnvs());

describe("restricted TEST Google callback failure categories", () => {
  it("separates provider cancellation from session mismatch", async () => {
    const setup1 = setup();
    expect(await setup1.callback("access_denied")).toEqual({
      url: "/auth?error=google_oauth",
      statusCode: 302,
    });
    expect(setup1.reply.clearCookie).toHaveBeenCalledOnce();
    expect(setup1.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { reason: "google_oauth" } }),
    );
    vi.unstubAllEnvs();

    const setup2 = setup();
    setup2.google.stateMatchesCookie.mockReturnValue(false);
    expect(await setup2.callback()).toEqual({
      url: "/auth?error=google_session",
      statusCode: 302,
    });
    expect(setup2.google.exchangeCode).not.toHaveBeenCalled();
    expect(setup2.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { reason: "state_cookie_mismatch" },
      }),
    );
  });

  it("separates consumed state from Google token or UserInfo failure", async () => {
    const setup1 = setup();
    setup1.google.consumeState.mockRejectedValue(
      new BadRequestException("expired"),
    );
    expect(await setup1.callback()).toEqual({
      url: "/auth?error=google_session",
      statusCode: 302,
    });
    expect(setup1.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { reason: "state_expired" } }),
    );
    vi.unstubAllEnvs();

    const setup2 = setup();
    setup2.google.exchangeCode.mockRejectedValue(
      new GoogleLoginFailure("token_exchange", "provider"),
    );
    expect(await setup2.callback()).toEqual({
      url: "/auth?error=google_provider",
      statusCode: 302,
    });
    expect(setup2.auth.loginWithGoogle).not.toHaveBeenCalled();
    expect(setup2.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { reason: "token_exchange" } }),
    );
  });

  it("identifies TEST access denial without creating a session", async () => {
    const { auth, cookies, audit, callback } = setup();
    auth.loginWithGoogle.mockRejectedValue(
      new UnauthorizedException("TEST access is not granted."),
    );
    expect(await callback()).toEqual({
      url: "/auth?error=google_access",
      statusCode: 302,
    });
    expect(cookies.setSession).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { reason: "test_access_denied" } }),
    );
  });

  it("preserves the successful restricted return path", async () => {
    const { cookies, callback } = setup();
    expect(await callback()).toEqual({
      url: "/auth?connected=1",
      statusCode: 302,
    });
    expect(cookies.setSession).toHaveBeenCalledOnce();
  });

  it("returns to the Web port after local TEST success", async () => {
    const { callback } = setup(true);
    expect(await callback()).toEqual({
      url: "http://127.0.0.1:23300/auth?connected=1",
      statusCode: 302,
    });
  });

  it("returns local TEST errors to the Web port", async () => {
    const { callback } = setup(true);
    expect(await callback("access_denied")).toEqual({
      url: "http://127.0.0.1:23300/auth?error=google_oauth",
      statusCode: 302,
    });
  });
});

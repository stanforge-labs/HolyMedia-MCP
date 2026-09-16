import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleLoginService } from "./google-login.service.js";

function databaseMock() {
  return {
    client: {
      googleLoginState: {
        create: vi.fn(),
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
    },
  };
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GoogleLoginService", () => {
  it("creates a V1-compatible authorization URL and consumes state once", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_ID", "login-client");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET", "login-secret");
    vi.stubEnv(
      "PROVIDER_GOOGLE_LOGIN_REDIRECT_URI",
      "https://mcp.example.test/auth/google/callback",
    );
    const database = databaseMock();
    const stateModel = database.client.googleLoginState;
    stateModel.findUnique.mockResolvedValue({
      id: "state-id",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      nextPath: "/dashboard",
    });
    stateModel.updateMany.mockResolvedValue({ count: 1 });
    const service = new GoogleLoginService(database as never);

    const started = await service.start();
    const url = new URL(started.authorizationUrl);
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://mcp.example.test/auth/google/callback",
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(service.stateMatchesCookie(started.state, started.state)).toBe(true);
    expect(await service.consumeState(started.state)).toEqual({
      nextPath: "/dashboard",
    });
    expect(stateModel.updateMany).toHaveBeenCalledOnce();
  });

  it("preserves only a validated OAuth transaction continuation", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_ID", "login-client");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET", "login-secret");
    const database = databaseMock();
    const service = new GoogleLoginService(database as never);
    const transaction = "11111111-1111-4111-8111-111111111111";

    await service.start(`/oauth/authorize/continue?transaction=${transaction}`);
    expect(database.client.googleLoginState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nextPath: `/oauth/authorize/continue?transaction=${transaction}`,
      }),
    });

    await service.start("https://attacker.example/redirect");
    expect(database.client.googleLoginState.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ nextPath: "/dashboard" }),
    });
  });

  it("preserves a validated dashboard deep link and rejects external paths", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_ID", "login-client");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET", "login-secret");
    const database = databaseMock();
    const service = new GoogleLoginService(database as never);

    await service.start("/dashboard/connections?oauth=success");
    expect(database.client.googleLoginState.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nextPath: "/dashboard/connections?oauth=success",
      }),
    });
    await service.start("https://attacker.example/dashboard/connections");
    expect(database.client.googleLoginState.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ nextPath: "/dashboard" }),
    });
  });

  it("exchanges the code and returns only a normalized verified profile", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_ID", "login-client");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET", "login-secret");
    vi.stubEnv(
      "PROVIDER_GOOGLE_LOGIN_REDIRECT_URI",
      "https://mcp.example.test/auth/google/callback",
    );
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: "access" }))
        .mockResolvedValueOnce(
          jsonResponse({
            email: " Client@Example.TEST ",
            email_verified: true,
            name: "Client Example",
            picture: "https://example.test/picture",
          }),
        ),
    );
    const service = new GoogleLoginService(databaseMock() as never);
    await expect(service.exchangeCode("code")).resolves.toEqual({
      email: "client@example.test",
      name: "Client Example",
    });
  });

  it("preserves localized frontend return URLs without changing OAuth callback or accepting EN technical paths", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_ID", "login-client");
    vi.stubEnv("PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET", "login-secret");
    const database = databaseMock();
    const service = new GoogleLoginService(database as never);
    const started = await service.start(
      "/en/dashboard/reports?period=30d#summary",
    );
    expect(database.client.googleLoginState.create).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        nextPath: "/en/dashboard/reports?period=30d#summary",
      }),
    });
    expect(
      new URL(started.authorizationUrl).searchParams.get("redirect_uri"),
    ).toBe(service.redirectUri());
    for (const path of [
      "//attacker.example/en/dashboard",
      "/en/oauth/authorize/continue",
      "/en/admin",
      "/en/dashboard/unknown",
    ]) {
      await service.start(path);
      expect(database.client.googleLoginState.create).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ nextPath: "/dashboard" }),
      });
    }
  });
});

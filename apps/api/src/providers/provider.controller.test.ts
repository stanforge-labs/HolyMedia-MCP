import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderController } from "./provider.controller.js";

const request = { ip: "127.0.0.1" } as never;
const validState = "s".repeat(48);

function setup(
  completeOAuthCallback = vi.fn(async () => ({ id: "connection-a" })),
) {
  const providers = { completeOAuthCallback };
  const reply = {
    code: vi.fn(() => reply),
    redirect: vi.fn((location: string) => location),
  };
  return {
    controller: new ProviderController(providers as never),
    providers,
    reply,
  };
}

describe("provider OAuth callback UX", () => {
  beforeEach(() =>
    vi.stubEnv("HOLYMEDIA_PUBLIC_BASE_URL", "http://127.0.0.1:23300"),
  );
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the validated state/code pair and returns to connections", async () => {
    const { controller, providers, reply } = setup();

    await controller.callback(
      "google",
      validState,
      "authorization-code",
      undefined as never,
      request,
      reply as never,
    );

    expect(providers.completeOAuthCallback).toHaveBeenCalledWith(
      "GOOGLE_ADS",
      { state: validState, code: "authorization-code" },
      request,
    );
    expect(reply.redirect).toHaveBeenCalledWith(
      "http://127.0.0.1:23300/dashboard/connections?oauth=success&provider=google",
    );
    expect(reply.code).toHaveBeenCalledWith(302);
  });

  it.each([
    ["meta", "META_ADS"],
    ["yandex", "YANDEX_DIRECT"],
    ["tiktok", "TIKTOK_ADS"],
    ["google_analytics", "GOOGLE_ANALYTICS"],
  ])(
    "returns %s OAuth callbacks to the matching connections card",
    async (pathProvider, provider) => {
      const { controller, providers, reply } = setup();

      await controller.callback(
        pathProvider,
        validState,
        "authorization-code",
        undefined as never,
        request,
        reply as never,
      );

      expect(providers.completeOAuthCallback).toHaveBeenCalledWith(
        provider,
        { state: validState, code: "authorization-code" },
        request,
      );
      expect(reply.redirect).toHaveBeenCalledWith(
        `http://127.0.0.1:23300/dashboard/connections?oauth=success&provider=${pathProvider}`,
      );
    },
  );

  it("returns a safe dashboard error when provider completion fails", async () => {
    const { controller, reply } = setup(
      vi.fn(async () => {
        throw new Error("provider response must stay private");
      }),
    );

    await controller.callback(
      "google",
      validState,
      "authorization-code",
      undefined as never,
      request,
      reply as never,
    );

    expect(reply.redirect).toHaveBeenCalledWith(
      "http://127.0.0.1:23300/dashboard/connections?oauth=error&provider=google&oauth_reason=oauth_failed",
    );
    expect(reply.code).toHaveBeenCalledWith(302);
  });

  it("returns an actionable safe error for malformed callback values", async () => {
    const { controller, reply } = setup();
    await controller.callback(
      "google",
      "short",
      "",
      undefined as never,
      request,
      reply as never,
    );
    expect(reply.redirect).toHaveBeenCalledWith(
      "http://127.0.0.1:23300/dashboard/connections?oauth=error&provider=google&oauth_reason=invalid_callback",
    );
  });

  it("accepts TikTok's auth_code callback parameter", async () => {
    const { controller, providers, reply } = setup();

    await controller.callback(
      "tiktok",
      validState,
      undefined,
      "tiktok-auth-code",
      request,
      reply as never,
    );

    expect(providers.completeOAuthCallback).toHaveBeenCalledWith(
      "TIKTOK_ADS",
      { state: validState, code: "tiktok-auth-code" },
      request,
    );
  });

  it("returns a safe reason when the provider denies authorization", async () => {
    const { controller, reply } = setup();

    await controller.callback(
      "meta",
      validState,
      undefined,
      undefined as never,
      request,
      reply as never,
      "access_denied",
    );

    expect(reply.redirect).toHaveBeenCalledWith(
      "http://127.0.0.1:23300/dashboard/connections?oauth=error&provider=meta&oauth_reason=authorization_denied",
    );
  });

  it("accepts TikTok's historical auth_code callback parameter", async () => {
    const { controller, providers, reply } = setup();

    await controller.callback(
      "tiktok",
      validState,
      "",
      "tiktok-authorization-code",
      request,
      reply as never,
    );

    expect(providers.completeOAuthCallback).toHaveBeenCalledWith(
      "TIKTOK_ADS",
      { state: validState, code: "tiktok-authorization-code" },
      request,
    );
    expect(reply.redirect).toHaveBeenCalledWith(
      "http://127.0.0.1:23300/dashboard/connections?oauth=success&provider=tiktok",
    );
  });

  it("forwards one connection-scoped batch selection", async () => {
    const setAccountsEnabled = vi.fn(async () => []);
    const controller = new ProviderController({ setAccountsEnabled } as never);
    const principal = { userId: "user-a", workspaceId: "workspace-a" } as never;

    await controller.selectAccounts(
      "workspace-a",
      "connection-a",
      { accountIds: ["account-a"] },
      principal,
      request,
    );

    expect(setAccountsEnabled).toHaveBeenCalledWith(
      "workspace-a",
      "connection-a",
      ["account-a"],
      principal,
      request,
    );
  });
});

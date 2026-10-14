import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";

const { info, warn } = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@holymedia/config", () => ({
  loadConfig: () => ({ qrsTestRestrictedAuth: true }),
}));
vi.mock("@holymedia/observability", () => ({
  createLogger: () => ({ info, warn }),
}));

import { LegacyMcpOAuthController } from "./legacy-mcp-oauth.controller.js";

function controller(
  registerPublicClient: (input: Record<string, unknown>) => unknown,
) {
  const instance = new LegacyMcpOAuthController(
    {} as never,
    { registerPublicClient } as never,
    {} as never,
  );
  const reply = { header: vi.fn() };
  const request = { requestId: "safe-request-id" };
  return { instance, reply, request };
}

describe("QRS DCR registration diagnostics", () => {
  it("logs only a safe rejection class for an invalid public redirect", async () => {
    warn.mockClear();
    const { instance, reply, request } = controller(async () => {
      throw new BadRequestException("OAuth client metadata is invalid.");
    });
    await expect(
      instance.register(
        request as never,
        reply as never,
        {
          redirect_uris: ["http://unsafe.example.test/callback?private=value"],
          grant_types: ["authorization_code"],
          response_types: ["code"],
        },
        "application/json",
      ),
    ).rejects.toThrow(BadRequestException);
    expect(warn).toHaveBeenCalledOnce();
    const logged = warn.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logged).toMatchObject({
      requestId: "safe-request-id",
      validationReason: "redirect_uri_unsafe",
      redirectUriCount: 1,
    });
    expect(JSON.stringify(logged)).not.toContain("private=value");
    expect(logged).not.toHaveProperty("redirectUris");
  });

  it("accepts a malformed body as a rejected empty registration, not a crash", async () => {
    warn.mockClear();
    const registerPublicClient = vi.fn(async () => {
      throw new BadRequestException("OAuth client metadata is invalid.");
    });
    const { instance, reply, request } = controller(registerPublicClient);
    await expect(
      instance.register(request as never, reply as never, null as never),
    ).rejects.toThrow(BadRequestException);
    expect(registerPublicClient).toHaveBeenCalledWith({});
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      validationReason: "redirect_uris_count_or_type",
    });
  });

  it("never logs the full redirect URI for a successful public client", async () => {
    info.mockClear();
    const { instance, reply, request } = controller(async () => ({
      client_id: "hm_public_diagnosticonly",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    }));
    await instance.register(
      request as never,
      reply as never,
      {
        redirect_uris: ["https://client.example.test/callback?private=value"],
        grant_types: ["authorization_code private-value"],
      },
      "application/json",
    );
    const logged = info.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(logged).toMatchObject({ redirectUriCount: 1 });
    expect(JSON.stringify(logged)).not.toContain("private=value");
    expect(JSON.stringify(logged)).not.toContain("private-value");
    expect(logged).not.toHaveProperty("redirectUris");
  });
});

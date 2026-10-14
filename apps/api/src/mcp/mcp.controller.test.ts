import { ForbiddenException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpController } from "./mcp.controller.js";
import { PreviewError } from "./mcp-preview.error.js";
import {
  GoogleAdsWriteError,
  googleWriteFailure,
} from "../providers/google-ads-write.js";

function controller(authenticate = vi.fn().mockResolvedValue(null)) {
  return new McpController(
    { tools: () => [], call: vi.fn() } as never,
    { authenticate } as never,
    { authenticate: vi.fn().mockResolvedValue(null) } as never,
    { consumeMcpRequest: vi.fn() } as never,
    { record: vi.fn() } as never,
    { call: vi.fn() } as never,
  );
}

function reply() {
  const value = {
    code: vi.fn(),
    header: vi.fn(),
    send: vi.fn(),
  };
  value.code.mockReturnValue(value);
  value.header.mockReturnValue(value);
  value.send.mockReturnValue(undefined);
  return value;
}

describe("MCP bearer authentication", () => {
  const previousBaseUrl = process.env.HOLYMEDIA_PUBLIC_BASE_URL;
  const previousRestricted = process.env.QRS_TEST_RESTRICTED_AUTH;
  const previousConfirmed = process.env.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED;
  const previousGoogle = process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED;
  const previousAllowlist = process.env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST;
  beforeEach(() => {
    process.env.HOLYMEDIA_PUBLIC_BASE_URL = "https://mcp.holymedia.kz";
    process.env.QRS_TEST_RESTRICTED_AUTH = "false";
    process.env.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED = "false";
  });
  afterEach(() => {
    if (previousBaseUrl === undefined)
      delete process.env.HOLYMEDIA_PUBLIC_BASE_URL;
    else process.env.HOLYMEDIA_PUBLIC_BASE_URL = previousBaseUrl;
    for (const [name, value] of [
      ["QRS_TEST_RESTRICTED_AUTH", previousRestricted],
      ["QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED", previousConfirmed],
      ["PROVIDER_GOOGLE_ADS_WRITE_ENABLED", previousGoogle],
      ["GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", previousAllowlist],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  it("Google batch has structured content and a concise summary; write failures preserve safe codes in Russian", async () => {
    const payload = {
      provider: "GOOGLE_ADS",
      operation_count: 1,
      summary: "Google Ads: 1 ключевое слово → PAUSED.",
      items: [{ before_status: "ENABLED", after_status: "PAUSED" }],
    };
    const call = vi.fn().mockResolvedValue(payload);
    const instance = new McpController(
      { call } as never,
      {
        authenticate: vi.fn().mockResolvedValue({
          kind: "service",
          scopes: ["adforge:mcp:read", "adforge:mcp:write"],
          workspaceId: "workspace",
          tokenId: "key",
          serviceIdentityId: "identity",
        }),
      } as never,
      { authenticate: vi.fn() } as never,
      { consumeMcpRequest: vi.fn() } as never,
      { record: vi.fn() } as never,
      { call: vi.fn() } as never,
    );
    const request = {
      headers: { authorization: "Bearer fixture-opaque" },
      body: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "pause_entities_preview", arguments: {} },
      },
    };
    const result = await instance.post(request as never, reply() as never);
    expect(result).toMatchObject({
      result: {
        structuredContent: payload,
        content: [
          { type: "text", text: JSON.stringify(payload) },
          { type: "text", text: payload.summary },
        ],
      },
    });
    const failure = googleWriteFailure("DEVELOPER_TOKEN_NOT_APPROVED");
    call.mockRejectedValueOnce(
      new GoogleAdsWriteError("google_ads_mutation_failed", failure.message, [
        failure,
      ]),
    );
    const rejected = await instance.post(request as never, reply() as never);
    expect(JSON.stringify(rejected)).toContain("DEVELOPER_TOKEN_NOT_APPROVED");
    expect(JSON.stringify(rejected)).toContain("Проверьте уровень доступа");
    expect(JSON.stringify(rejected)).not.toContain("fixture-opaque");
  });
  it("returns a typed local confirmation error without exposing internal details", async () => {
    const instance = new McpController(
      {
        call: vi
          .fn()
          .mockRejectedValue(
            new PreviewError(
              "confirmation_context_mismatch",
              "private diagnostic",
            ),
          ),
      } as never,
      {
        authenticate: vi.fn().mockResolvedValue({
          workspaceId: "workspace",
          tokenId: "token-id",
          serviceIdentityId: "identity-id",
        }),
      } as never,
      { authenticate: vi.fn() } as never,
      { consumeMcpRequest: vi.fn() } as never,
      { record: vi.fn() } as never,
      { call: vi.fn() } as never,
    );
    const result = await instance.post(
      {
        headers: { authorization: "Bearer test-opaque" },
        body: {
          id: 1,
          method: "tools/call",
          params: {
            name: "confirm_preview",
            arguments: { preview_token: "opaque-do-not-log" },
          },
        },
      } as never,
      reply() as never,
    );
    const text = JSON.stringify(result);
    expect(text).toContain("confirmation_context_mismatch");
    expect(text).not.toContain("рекламной платформе");
    expect(text).not.toContain("private diagnostic");
    expect(text).not.toContain("opaque-do-not-log");
  });
  it("accepts a case-insensitive Bearer scheme", async () => {
    const authenticate = vi
      .fn()
      .mockResolvedValue({ workspaceId: "workspace" });
    const response = reply();
    const result = await controller(authenticate).post(
      {
        headers: { authorization: "bearer hmst_valid" },
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      } as never,
      response as never,
    );

    expect(authenticate).toHaveBeenCalledWith("hmst_valid");
    expect(response.code).toHaveBeenCalledWith(200);
    expect(result).toMatchObject({ result: { protocolVersion: "2025-03-26" } });
  });

  it("returns an empty 202 acknowledgement for initialized notifications", async () => {
    const authenticate = vi
      .fn()
      .mockResolvedValue({ workspaceId: "workspace" });
    const response = reply();

    await controller(authenticate).post(
      {
        headers: { authorization: "Bearer hmst_valid" },
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      } as never,
      response as never,
    );

    expect(response.code).toHaveBeenCalledWith(202);
    expect(response.send).toHaveBeenCalledWith();
  });

  it("keeps the existing Codex service-token initialize, initialized, and tools/list flow", async () => {
    const authenticate = vi.fn().mockResolvedValue({
      workspaceId: "workspace",
      scopes: ["adforge:mcp:read"],
      accountIds: [],
    });
    const instance = controller(authenticate);

    const initialize = await instance.post(
      {
        headers: { authorization: "Bearer hmst_codex" },
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      } as never,
      reply() as never,
    );
    expect(initialize).toMatchObject({
      result: { protocolVersion: "2025-03-26" },
    });

    const notification = reply();
    await instance.post(
      {
        headers: { authorization: "Bearer hmst_codex" },
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      } as never,
      notification as never,
    );
    expect(notification.code).toHaveBeenCalledWith(202);

    const tools = await instance.post(
      {
        headers: { authorization: "Bearer hmst_codex" },
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      } as never,
      reply() as never,
    );
    expect(tools).toEqual({ jsonrpc: "2.0", id: 2, result: { tools: [] } });
    expect(authenticate).toHaveBeenCalledTimes(3);
  });

  it("rejects missing, malformed, and invalid service tokens", async () => {
    const missing = reply();
    await controller().post(
      { headers: {}, body: { method: "initialize" } } as never,
      missing as never,
    );
    expect(missing.code).toHaveBeenCalledWith(401);
    expect(missing.header).toHaveBeenCalledWith(
      "WWW-Authenticate",
      'Bearer resource_metadata="https://mcp.holymedia.kz/.well-known/oauth-protected-resource/mcp", scope="adforge:mcp:read"',
    );

    const malformed = reply();
    await controller().post(
      {
        headers: { authorization: "Bearer Bearer hmst_invalid" },
        body: { method: "initialize" },
      } as never,
      malformed as never,
    );
    expect(malformed.code).toHaveBeenCalledWith(401);

    const invalid = reply();
    await controller().post(
      {
        headers: { authorization: "Bearer hmst_invalid" },
        body: { method: "initialize" },
      } as never,
      invalid as never,
    );
    expect(invalid.code).toHaveBeenCalledWith(401);
  });

  it("requests explicit read/write consent only for the restricted TEST write profile", async () => {
    process.env.HOLYMEDIA_PUBLIC_BASE_URL = "https://mcp-test.holymedia.kz";
    process.env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST = "8590146099";
    process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED = "true";
    process.env.QRS_TEST_RESTRICTED_AUTH = "true";
    process.env.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED = "true";
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = "false";
    const instance = controller();
    const write = reply();
    await instance.post(
      {
        headers: {},
        query: { profile: "google_ads_write" },
        body: { method: "initialize" },
      } as never,
      write as never,
    );
    expect(write.header).toHaveBeenCalledWith(
      "WWW-Authenticate",
      'Bearer resource_metadata="https://mcp-test.holymedia.kz/.well-known/oauth-protected-resource/mcp", scope="adforge:mcp:read adforge:mcp:write"',
    );
    const plain = reply();
    await instance.post(
      { headers: {}, body: { method: "initialize" } } as never,
      plain as never,
    );
    expect(plain.header).toHaveBeenCalledWith(
      "WWW-Authenticate",
      'Bearer resource_metadata="https://mcp-test.holymedia.kz/.well-known/oauth-protected-resource/mcp", scope="adforge:mcp:read"',
    );
    const publicReply = reply();
    await instance.postPublic(
      {
        headers: {},
        query: { profile: "google_ads_write" },
        body: { method: "initialize" },
      } as never,
      publicReply as never,
    );
    expect(publicReply.header).toHaveBeenCalledWith(
      "WWW-Authenticate",
      'Bearer resource_metadata="https://mcp-test.holymedia.kz/.well-known/oauth-protected-resource/mcp/public", scope="adforge:mcp:read"',
    );
    process.env.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED = "false";
    const gated = reply();
    await controller().post(
      {
        headers: {},
        query: { profile: "google_ads_write" },
        body: { method: "initialize" },
      } as never,
      gated as never,
    );
    expect(gated.header).toHaveBeenCalledWith(
      "WWW-Authenticate",
      'Bearer resource_metadata="https://mcp-test.holymedia.kz/.well-known/oauth-protected-resource/mcp", scope="adforge:mcp:read"',
    );
  });

  it("uses local protected-resource challenges for legacy and public MCP", async () => {
    process.env.HOLYMEDIA_PUBLIC_BASE_URL = "https://local.example.test";
    const instance = controller();
    const legacy = reply();
    const publicReply = reply();
    await instance.get({ headers: {} } as never, legacy as never);
    await instance.getPublic({ headers: {} } as never, publicReply as never);
    for (const [response, suffix] of [
      [legacy, "mcp"],
      [publicReply, "mcp/public"],
    ] as const) {
      const challenge = response.header.mock.calls.find(
        ([name]) => name === "WWW-Authenticate",
      )?.[1];
      expect(challenge).toBe(
        `Bearer resource_metadata="https://local.example.test/.well-known/oauth-protected-resource/${suffix}", scope="adforge:mcp:read"`,
      );
      expect(challenge).not.toContain('"https://mcp.holymedia.kz');
    }
  });

  it("authenticates a GET transport probe before returning the optional SSE response", async () => {
    const authenticate = vi
      .fn()
      .mockResolvedValue({ workspaceId: "workspace" });

    await expect(
      controller(authenticate).get(
        {
          headers: { authorization: "Bearer hmst_valid" },
        } as never,
        reply() as never,
      ),
    ).rejects.toMatchObject({ status: 405 });
    expect(authenticate).toHaveBeenCalledWith("hmst_valid");
  });

  it("returns a safe actionable message when a preview account is unavailable", async () => {
    const authenticate = vi.fn().mockResolvedValue({
      workspaceId: "workspace",
      scopes: ["adforge:mcp:read"],
      accountIds: [],
    });
    const instance = new McpController(
      {
        tools: () => [],
        call: vi
          .fn()
          .mockRejectedValue(
            new ForbiddenException(
              "Account is not available to this service token.",
            ),
          ),
      } as never,
      { authenticate } as never,
      { authenticate: vi.fn().mockResolvedValue(null) } as never,
      { consumeMcpRequest: vi.fn() } as never,
      { record: vi.fn() } as never,
      { call: vi.fn() } as never,
    );

    const result = await instance.post(
      {
        headers: { authorization: "Bearer hmst_valid" },
        body: {
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "preview_change_campaign_name", arguments: {} },
        },
      } as never,
      reply() as never,
    );

    expect(result).toMatchObject({
      result: {
        isError: true,
        content: [
          {
            text: JSON.stringify({
              message:
                "Указанный рекламный кабинет недоступен этому ключу доступа.",
            }),
          },
        ],
      },
    });
  });
});

import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { McpController } from "./mcp.controller.js";
import { PreviewError } from "./mcp-preview.error.js";

function controller(authenticate = vi.fn().mockResolvedValue(null)) {
  return new McpController(
    { tools: () => [], call: vi.fn() } as never,
    { authenticate } as never,
    { authenticate: vi.fn().mockResolvedValue(null) } as never,
    { consumeMcpRequest: vi.fn() } as never,
    { record: vi.fn() } as never,
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

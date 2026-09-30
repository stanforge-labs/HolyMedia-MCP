import { describe, expect, it, vi } from "vitest";
import { McpController } from "./mcp.controller.js";
import { McpService } from "./mcp.service.js";

function reply() {
  const value = { code: vi.fn(), header: vi.fn(), send: vi.fn() };
  value.code.mockReturnValue(value);
  value.header.mockReturnValue(value);
  return value;
}

function request(method: string, name?: string) {
  return {
    id: "request-id",
    headers: { authorization: "Bearer hm_oauth_test" },
    body: {
      jsonrpc: "2.0",
      id: 1,
      method,
      ...(name ? { params: { name, arguments: {} } } : {}),
    },
  } as never;
}

describe("public MCP transport", () => {
  it("registers POST and GET at /mcp/public while keeping /mcp", () => {
    expect(Reflect.getMetadata("path", McpController.prototype.post)).toBe(
      "mcp",
    );
    expect(Reflect.getMetadata("path", McpController.prototype.get)).toBe(
      "mcp",
    );
    expect(
      Reflect.getMetadata("path", McpController.prototype.postPublic),
    ).toBe("mcp/public");
    expect(Reflect.getMetadata("path", McpController.prototype.getPublic)).toBe(
      "mcp/public",
    );
  });

  it("filters tools/list and tools/call server-side without changing legacy list", async () => {
    const legacyTools = McpService.prototype.tools.call({} as McpService);
    const read = vi.fn().mockResolvedValue({ ok: true });
    const write = vi.fn();
    const principal = {
      kind: "oauth",
      tokenId: "access-token-id",
      userId: "user-a",
      clientId: "client-a",
      grantId: "grant-a",
      workspaceId: "workspace-a",
      resource: "https://mcp.holymedia.kz/mcp/public",
      scopes: ["adforge:mcp:read"],
      accountIds: [],
    };
    const controller = new McpController(
      { tools: () => legacyTools, call: read } as never,
      { authenticate: vi.fn().mockResolvedValue(null) } as never,
      { authenticate: vi.fn().mockResolvedValue(principal) } as never,
      { consumeMcpRequest: vi.fn() } as never,
      { record: vi.fn() } as never,
      { call: write } as never,
    );
    const publicList = (await controller.postPublic(
      request("tools/list"),
      reply() as never,
    )) as {
      result: { tools: Array<{ name: string }> };
    };
    expect(publicList.result.tools).toHaveLength(42);
    const legacyList = (await controller.post(
      request("tools/list"),
      reply() as never,
    )) as { result: { tools: Array<{ name: string }> } };
    expect(legacyList.result.tools).toHaveLength(157);
    expect(
      publicList.result.tools.some((tool) => tool.name === "commit_preview"),
    ).toBe(false);
    expect(
      publicList.result.tools.some((tool) => tool.name === "confirm_preview"),
    ).toBe(false);
    const hidden = (await controller.postPublic(
      request("tools/call", "commit_preview"),
      reply() as never,
    )) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(hidden.result.isError).toBe(true);
    expect(JSON.parse(hidden.result.content[0]!.text).code).toBe(
      "public_operation_not_available",
    );
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    const hiddenConfirmation = (await controller.postPublic(
      request("tools/call", "confirm_preview"),
      reply() as never,
    )) as { result: { isError: boolean; content: Array<{ text: string }> } };
    expect(hiddenConfirmation.result.isError).toBe(true);
    expect(JSON.parse(hiddenConfirmation.result.content[0]!.text).code).toBe(
      "public_operation_not_available",
    );
    expect(write).not.toHaveBeenCalled();
    await controller.postPublic(
      request("tools/call", "list_connected_resources"),
      reply() as never,
    );
    expect(read).toHaveBeenCalledWith(
      principal,
      "list_connected_resources",
      {},
    );
    expect(write).not.toHaveBeenCalled();
  });

  it("does not accept a legacy service token on the public resource", async () => {
    const legacy = vi
      .fn()
      .mockResolvedValue({ kind: "service", workspaceId: "workspace-a" });
    const oauth = vi.fn().mockResolvedValue(null);
    const controller = new McpController(
      { tools: () => [], call: vi.fn() } as never,
      { authenticate: legacy } as never,
      { authenticate: oauth } as never,
      { consumeMcpRequest: vi.fn() } as never,
      { record: vi.fn() } as never,
      { call: vi.fn() } as never,
    );
    const response = reply();
    await controller.postPublic(request("initialize"), response as never);
    expect(legacy).not.toHaveBeenCalled();
    expect(oauth).toHaveBeenCalledWith(
      "hm_oauth_test",
      "https://mcp.holymedia.kz/mcp/public",
    );
    expect(response.code).toHaveBeenCalledWith(401);
    expect(response.header).toHaveBeenCalledWith(
      "WWW-Authenticate",
      expect.stringContaining("oauth-protected-resource/mcp/public"),
    );
  });

  it("shares initialize, notification and GET transport semantics", async () => {
    const principal = {
      kind: "oauth",
      tokenId: "access-token-id",
      userId: "user-a",
      clientId: "client-a",
      grantId: "grant-a",
      workspaceId: "workspace-a",
      scopes: ["adforge:mcp:read"],
      accountIds: [],
    };
    const controller = new McpController(
      { tools: () => [], call: vi.fn() } as never,
      { authenticate: vi.fn().mockResolvedValue(null) } as never,
      { authenticate: vi.fn().mockResolvedValue(principal) } as never,
      { consumeMcpRequest: vi.fn() } as never,
      { record: vi.fn() } as never,
      { call: vi.fn() } as never,
    );
    const initialized = (await controller.postPublic(
      request("initialize"),
      reply() as never,
    )) as {
      result: { protocolVersion: string; capabilities: { tools: object } };
    };
    expect(initialized.result.protocolVersion).toBe("2025-03-26");
    expect(initialized.result.capabilities.tools).toEqual({});
    const notificationReply = reply();
    await controller.postPublic(
      request("notifications/initialized"),
      notificationReply as never,
    );
    expect(notificationReply.code).toHaveBeenCalledWith(202);
    expect(notificationReply.send).toHaveBeenCalled();
    await expect(
      controller.getPublic(request("initialize"), reply() as never),
    ).rejects.toMatchObject({ status: 405 });
  });
});

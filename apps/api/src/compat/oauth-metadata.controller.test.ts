import { afterEach, describe, expect, it } from "vitest";
import { OAuthMetadataController } from "./oauth-metadata.controller.js";

describe("OAuth discovery metadata", () => {
  const previous = process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED;
  afterEach(() => {
    if (previous === undefined)
      delete process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED;
    else process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = previous;
  });

  it("publishes absolute protected resource documents, without write while gated off", () => {
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = "false";
    const controller = new OAuthMetadataController();
    expect(controller.protectedResource()).toEqual({
      resource: "https://mcp.holymedia.kz/mcp",
      authorization_servers: ["https://mcp.holymedia.kz"],
      scopes_supported: ["adforge:mcp:read"],
      bearer_methods_supported: ["header"],
    });
    expect(controller.protectedMcpResource()).toEqual(
      controller.protectedResource(),
    );
    expect(controller.protectedPublicMcpResource()).toEqual({
      resource: "https://mcp.holymedia.kz/mcp/public",
      authorization_servers: ["https://mcp.holymedia.kz"],
      scopes_supported: ["adforge:mcp:read"],
      bearer_methods_supported: ["header"],
    });
  });

  it("publishes matching public-client Authorization Code metadata", () => {
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = "false";
    const controller = new OAuthMetadataController();
    expect(controller.authorizationServer()).toMatchObject({
      issuer: "https://mcp.holymedia.kz",
      authorization_endpoint: "https://mcp.holymedia.kz/oauth/authorize",
      token_endpoint: "https://mcp.holymedia.kz/oauth/token",
      registration_endpoint: "https://mcp.holymedia.kz/oauth/register",
      revocation_endpoint: "https://mcp.holymedia.kz/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: expect.arrayContaining(["none"]),
      client_id_metadata_document_supported: true,
      scopes_supported: ["adforge:mcp:read"],
    });
  });

  it("advertises write only after the separate OAuth write-scope gate is enabled", () => {
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = "true";
    const controller = new OAuthMetadataController();
    expect(controller.protectedPublicMcpResource().scopes_supported).toEqual([
      "adforge:mcp:read",
      "adforge:mcp:write",
    ]);
    expect(controller.authorizationServer().scopes_supported).toEqual([
      "adforge:mcp:read",
      "adforge:mcp:write",
    ]);
    expect(controller.protectedResource().scopes_supported).toEqual([
      "adforge:mcp:read",
    ]);
  });
});

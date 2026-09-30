import { describe, expect, it } from "vitest";
import { OAuthMetadataController } from "./oauth-metadata.controller.js";

describe("OAuth discovery metadata", () => {
  const controller = new OAuthMetadataController();

  it("publishes an absolute protected resource document", () => {
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
      scopes_supported: ["adforge:mcp:read", "adforge:mcp:write"],
      bearer_methods_supported: ["header"],
    });
  });

  it("publishes matching public-client Authorization Code metadata", () => {
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
      scopes_supported: ["adforge:mcp:read", "adforge:mcp:write"],
    });
  });
});

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OAuthMetadataController } from "./oauth-metadata.controller.js";

describe("OAuth discovery metadata", () => {
  const previous = process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED;
  const previousBaseUrl = process.env.HOLYMEDIA_PUBLIC_BASE_URL;
  const previousGoogle = process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED;
  beforeEach(() => {
    process.env.HOLYMEDIA_PUBLIC_BASE_URL = "https://mcp.holymedia.kz";
    process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED = "false";
  });
  afterEach(() => {
    if (previous === undefined)
      delete process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED;
    else process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = previous;
    if (previousBaseUrl === undefined)
      delete process.env.HOLYMEDIA_PUBLIC_BASE_URL;
    else process.env.HOLYMEDIA_PUBLIC_BASE_URL = previousBaseUrl;
    if (previousGoogle === undefined)
      delete process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED;
    else process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED = previousGoogle;
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

  it("private Google gate advertises private write without broadening Public scopes", () => {
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = "false";
    process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED = "true";
    const controller = new OAuthMetadataController();
    expect(controller.protectedMcpResource().scopes_supported).toEqual([
      "adforge:mcp:read",
      "adforge:mcp:write",
    ]);
    expect(controller.protectedPublicMcpResource().scopes_supported).toEqual([
      "adforge:mcp:read",
    ]);
    expect(controller.authorizationServer().scopes_supported).toContain(
      "adforge:mcp:write",
    );
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

  it("publishes only local OAuth origins when configured for local", () => {
    process.env.HOLYMEDIA_PUBLIC_BASE_URL = "https://local.example.test";
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = "false";
    const controller = new OAuthMetadataController();
    const origin = "https://local.example.test";
    expect(controller.protectedResource()).toMatchObject({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
    });
    expect(controller.protectedMcpResource()).toEqual(
      controller.protectedResource(),
    );
    expect(controller.protectedPublicMcpResource()).toMatchObject({
      resource: `${origin}/mcp/public`,
      authorization_servers: [origin],
      scopes_supported: ["adforge:mcp:read"],
    });
    expect(controller.authorizationServer()).toMatchObject({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      revocation_endpoint: `${origin}/oauth/revoke`,
    });
    expect(
      JSON.stringify([
        controller.protectedResource(),
        controller.protectedPublicMcpResource(),
        controller.authorizationServer(),
      ]),
    ).not.toContain('"https://mcp.holymedia.kz');
  });
});

import { Controller, Get } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";

@Controller()
export class OAuthMetadataController {
  private readonly writeScopeEnabled = loadConfig().publicMcpWriteScopeEnabled;

  private publicScopes(): string[] {
    return this.writeScopeEnabled
      ? ["adforge:mcp:read", "adforge:mcp:write"]
      : ["adforge:mcp:read"];
  }

  @Get(".well-known/oauth-protected-resource")
  public protectedResource() {
    return {
      resource: "https://mcp.holymedia.kz/mcp",
      authorization_servers: ["https://mcp.holymedia.kz"],
      scopes_supported: ["adforge:mcp:read"],
      bearer_methods_supported: ["header"],
    };
  }

  @Get(".well-known/oauth-protected-resource/mcp")
  public protectedMcpResource() {
    return this.protectedResource();
  }

  @Get(".well-known/oauth-protected-resource/mcp/public")
  public protectedPublicMcpResource() {
    return {
      resource: "https://mcp.holymedia.kz/mcp/public",
      authorization_servers: ["https://mcp.holymedia.kz"],
      scopes_supported: this.publicScopes(),
      bearer_methods_supported: ["header"],
    };
  }

  @Get(".well-known/oauth-authorization-server")
  public authorizationServer() {
    return {
      issuer: "https://mcp.holymedia.kz",
      authorization_endpoint: "https://mcp.holymedia.kz/oauth/authorize",
      token_endpoint: "https://mcp.holymedia.kz/oauth/token",
      registration_endpoint: "https://mcp.holymedia.kz/oauth/register",
      revocation_endpoint: "https://mcp.holymedia.kz/oauth/revoke",
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: this.publicScopes(),
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_basic",
        "client_secret_post",
      ],
      client_id_metadata_document_supported: true,
    };
  }
}

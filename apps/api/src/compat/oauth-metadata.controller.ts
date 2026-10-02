import { Controller, Get } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import { oauthEndpoints } from "../mcp/oauth-endpoints.js";

@Controller()
export class OAuthMetadataController {
  private readonly writeScopeEnabled = loadConfig().publicMcpWriteScopeEnabled;
  private readonly endpoints = oauthEndpoints();

  private publicScopes(): string[] {
    return this.writeScopeEnabled
      ? ["adforge:mcp:read", "adforge:mcp:write"]
      : ["adforge:mcp:read"];
  }

  @Get(".well-known/oauth-protected-resource")
  public protectedResource() {
    return {
      resource: this.endpoints.legacyResource,
      authorization_servers: [this.endpoints.issuer],
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
      resource: this.endpoints.publicResource,
      authorization_servers: [this.endpoints.issuer],
      scopes_supported: this.publicScopes(),
      bearer_methods_supported: ["header"],
    };
  }

  @Get(".well-known/oauth-authorization-server")
  public authorizationServer() {
    return {
      issuer: this.endpoints.issuer,
      authorization_endpoint: this.endpoints.authorization,
      token_endpoint: this.endpoints.token,
      registration_endpoint: this.endpoints.registration,
      revocation_endpoint: this.endpoints.revocation,
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

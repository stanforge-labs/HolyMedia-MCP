import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import { oauthEndpoints } from "../mcp/oauth-endpoints.js";
import { oidcActiveKey, oidcJwks } from "../mcp/oidc-identity.js";

@Controller()
export class OAuthMetadataController {
  private readonly writeScopeEnabled = loadConfig().publicMcpWriteScopeEnabled;
  private readonly endpoints = oauthEndpoints();

  private publicScopes(): string[] {
    return this.writeScopeEnabled
      ? ["adforge:mcp:read", "adforge:mcp:write"]
      : ["adforge:mcp:read"];
  }

  private identityScopes(): string[] {
    return oidcActiveKey() ? ["openid", "email"] : [];
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
      scopes_supported: [...this.publicScopes(), ...this.identityScopes()],
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
      scopes_supported: [...this.publicScopes(), ...this.identityScopes()],
      token_endpoint_auth_methods_supported: [
        "none",
        "client_secret_basic",
        "client_secret_post",
      ],
      client_id_metadata_document_supported: true,
    };
  }

  @Get(".well-known/openid-configuration")
  public openidConfiguration() {
    if (!oidcActiveKey()) {
      throw new ServiceUnavailableException("OIDC is not configured.");
    }
    return {
      ...this.authorizationServer(),
      userinfo_endpoint: this.endpoints.userinfo,
      jwks_uri: this.endpoints.jwks,
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      claims_supported: ["sub", "email", "email_verified"],
    };
  }

  @Get(".well-known/jwks.json")
  public jwks() {
    return oidcJwks();
  }
}

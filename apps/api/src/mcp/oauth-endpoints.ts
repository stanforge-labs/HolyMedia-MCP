import { loadConfig } from "@holymedia/config";

/** Trusted, immutable externally visible OAuth endpoints for this process. */
export function oauthEndpoints(baseUrl = loadConfig().publicBaseUrl) {
  const issuer = baseUrl;
  return Object.freeze({
    issuer,
    legacyResource: `${issuer}/mcp`,
    publicResource: `${issuer}/mcp/public`,
    legacyResourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp`,
    publicResourceMetadata: `${issuer}/.well-known/oauth-protected-resource/mcp/public`,
    authorization: `${issuer}/oauth/authorize`,
    token: `${issuer}/oauth/token`,
    registration: `${issuer}/oauth/register`,
    revocation: `${issuer}/oauth/revoke`,
    authorizationContinue: `${issuer}/oauth/authorize/continue`,
    login: `${issuer}/auth`,
    consent: `${issuer}/connect/claude`,
  });
}

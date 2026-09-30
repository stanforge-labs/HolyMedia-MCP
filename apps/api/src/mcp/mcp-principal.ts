import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";

/** Stable authorization identity survives rotation of the short-lived access token. */
export type OAuthMcpPrincipal = {
  kind: "oauth";
  tokenId: string;
  workspaceId: string;
  userId: string;
  clientId: string;
  grantId: string;
  resource: string;
  scopes: string[];
  accountIds: string[];
  resourceAccessMode: "ALL_CONNECTED";
};

export type McpPrincipal = ServiceTokenPrincipal | OAuthMcpPrincipal;

import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthAuthorizationService } from "./oauth-authorization.service.js";
import { McpPreviewService } from "./mcp-preview.service.js";
import type { OAuthMcpPrincipal } from "./mcp-principal.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const connectionId = "00000000-0000-4000-8000-000000000002";
const grantId = "00000000-0000-4000-8000-000000000003";
const ownerId = "00000000-0000-4000-8000-000000000004";
const accountId = "00000000-0000-4000-8000-000000000005";
const scope = "adforge:mcp:read adforge:mcp:write";

function fixture() {
  for (const [key, value] of Object.entries({
    NODE_ENV: "development",
    QRS_TEST_RESTRICTED_AUTH: "true",
    QRS_TEST_LOCAL_WRITE_ENABLED: "true",
    QRS_TEST_LOCAL_READONLY_AUTH: "false",
    QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED: "false",
    QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED: "false",
    QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED: "false",
    QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED: "false",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
    HOLYMEDIA_PUBLIC_BASE_URL: "http://127.0.0.1:23300",
    CORS_ORIGINS: "http://127.0.0.1:23300",
    PROVIDER_GOOGLE_REDIRECT_URI:
      "http://127.0.0.1:24404/oauth/google/callback",
    PROVIDER_GOOGLE_LOGIN_REDIRECT_URI:
      "http://127.0.0.1:24404/auth/google/callback",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true",
    QRS_TEST_LOCAL_WRITE_WORKSPACE_ID: workspaceId,
    QRS_TEST_LOCAL_WRITE_CONNECTION_ID: connectionId,
    QRS_TEST_LOCAL_WRITE_OAUTH_GRANT_ID: grantId,
    QRS_TEST_LOCAL_WRITE_GRANT_NOT_BEFORE: "2026-10-23T00:00:00.000Z",
    QRS_TEST_GOOGLE_OWNER_BINDING_USER_ID: ownerId,
    QRS_TEST_GOOGLE_OWNER_BINDING_EMAIL: "owner@example.test",
  }))
    vi.stubEnv(key, value);
  const token = {
    createdAt: new Date("2026-10-23T00:01:00.000Z"),
    scope,
    client: { scope },
  };
  const client = {
    workspaceMembership: {
      findFirst: vi.fn().mockResolvedValue({ id: "membership" }),
    },
    oAuthRefreshToken: { findFirst: vi.fn().mockResolvedValue(token) },
    oAuthAccessToken: {
      findFirst: vi.fn().mockResolvedValue({ scope }),
    },
    providerAccount: {
      findFirst: vi.fn().mockResolvedValue({ connectionId, id: accountId }),
    },
    providerConnection: {
      findFirst: vi.fn().mockResolvedValue({
        connectedAt: new Date("2026-10-23T00:01:00.000Z"),
        credential: { id: "credential" },
        metadata: {
          grantedScopes: ["https://www.googleapis.com/auth/adwords"],
        },
      }),
    },
  };
  const database = { client };
  const oauth = new OAuthAuthorizationService(database as never, {} as never);
  const previews = new McpPreviewService(
    database as never,
    {} as never,
    {} as never,
    oauth,
  );
  const principal: OAuthMcpPrincipal = {
    kind: "oauth",
    tokenId: "access-token",
    userId: ownerId,
    workspaceId,
    clientId: "client",
    grantId,
    resource: "http://127.0.0.1:23300/mcp",
    scopes: scope.split(" "),
    accountIds: [],
    resourceAccessMode: "ALL_CONNECTED",
  };
  return { client, oauth, previews, principal };
}

afterEach(() => vi.unstubAllEnvs());

describe("local private MCP Google WRITE principal", () => {
  it("requires a fresh OWNER grant and exact account before preview", async () => {
    const { client, oauth, previews, principal } = fixture();
    await expect(oauth.assertGoogleWritePrincipal(principal)).resolves.toEqual({
      ownerUserId: ownerId,
    });
    await expect(
      (
        previews as unknown as {
          assertControlledPrincipal: (
            principal: OAuthMcpPrincipal,
            accountId: string,
          ) => Promise<unknown>;
        }
      ).assertControlledPrincipal(principal, accountId),
    ).resolves.toMatchObject({ ownerUserId: ownerId });
    expect(client.providerAccount.findFirst).toHaveBeenCalled();
    expect(client.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: "OWNER" }),
      }),
    );
  });

  it("rejects a foreign OWNER, stale grant family and revoked access", async () => {
    const { client, oauth, principal } = fixture();
    await expect(
      oauth.assertGoogleWritePrincipal({ ...principal, userId: "foreign" }),
    ).rejects.toThrow();
    client.oAuthRefreshToken.findFirst
      .mockResolvedValueOnce({
        createdAt: new Date("2026-10-23T00:01:00.000Z"),
        scope,
        client: { scope },
      })
      .mockResolvedValueOnce({ createdAt: new Date("2026-10-22T00:00:00Z") });
    await expect(oauth.assertGoogleWritePrincipal(principal)).rejects.toThrow();
    client.oAuthAccessToken.findFirst.mockResolvedValue(null);
    await expect(oauth.assertGoogleWritePrincipal(principal)).rejects.toThrow();
  });

  it("rejects service-token writes before any provider access", async () => {
    const { client, previews } = fixture();
    await expect(
      (
        previews as unknown as {
          assertControlledPrincipal: (
            principal: unknown,
            accountId: string,
          ) => Promise<unknown>;
        }
      ).assertControlledPrincipal(
        {
          kind: "service",
          tokenId: "service",
          workspaceId,
          serviceIdentityId: "identity",
          scopes: scope.split(" "),
          accountIds: [accountId],
        },
        accountId,
      ),
    ).rejects.toThrow();
    expect(client.providerAccount.findFirst).not.toHaveBeenCalled();
  });
});

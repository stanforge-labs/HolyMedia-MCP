import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import {
  hashServiceToken,
  ServiceTokenService,
} from "../service-tokens/service-token.service.js";
import { McpController } from "./mcp.controller.js";
import { OAuthAuthorizationService } from "./oauth-authorization.service.js";
import { oauthEndpoints } from "./oauth-endpoints.js";

const MCP_RESOURCE = oauthEndpoints().legacyResource;

const integrationEnabled =
  process.env.V2_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL);

function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function reply() {
  return {
    status: 0,
    code(status: number) {
      this.status = status;
      return this;
    },
    header() {
      return this;
    },
    send() {
      return undefined;
    },
  };
}

describe.skipIf(!integrationEnabled)("OAuth MCP backend integration", () => {
  const database = new DatabaseService();
  const oauth = new OAuthAuthorizationService(database, {
    resolve: async () => null,
  } as never);
  const serviceTokens = new ServiceTokenService(
    database,
    new AuditService(database),
  );
  const suffix = randomUUID();
  const verifier = "integration-verifier-".padEnd(64, "v");
  let userId = "";
  let workspaceId = "";
  const publicClientIds: string[] = [];
  let principal: HumanPrincipal;

  beforeAll(async () => {
    const user = await database.client.user.create({
      data: {
        email: `oauth-${suffix}@example.test`,
        name: "OAuth integration",
        passwordHash: "test",
      },
    });
    const workspace = await database.client.workspace.create({
      data: {
        name: "OAuth integration",
        slug: `oauth-${suffix}`,
        accessStatus: "ACTIVE",
        memberships: { create: { userId: user.id, role: "OWNER" } },
      },
    });
    userId = user.id;
    workspaceId = workspace.id;
    principal = { kind: "human", userId, sessionId: randomUUID() };
  });

  afterAll(async () => {
    if (publicClientIds.length > 0) {
      await database.client.oAuthPublicClient.deleteMany({
        where: { clientId: { in: publicClientIds } },
      });
    }
    if (workspaceId) {
      await database.client.workspace.deleteMany({
        where: { id: workspaceId },
      });
    }
    if (userId)
      await database.client.user.deleteMany({ where: { id: userId } });
    await database.onModuleDestroy();
  });

  it("runs public registration through PKCE exchange and both MCP bearer paths", async () => {
    const registered = await oauth.registerPublicClient({
      client_name: "Claude integration",
      redirect_uris: ["https://claude.example.test/oauth/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    publicClientIds.push(registered.client_id);

    const started = await oauth.beginAuthorization({
      client_id: registered.client_id,
      redirect_uri: "https://claude.example.test/oauth/callback",
      response_type: "code",
      state: "integration-state",
      scope: "adforge:mcp:read",
      resource: MCP_RESOURCE,
      code_challenge: challenge(verifier),
      code_challenge_method: "S256",
    });
    expect(started.url).toContain("/auth?oauth_transaction=");

    const continued = await oauth.continueAuthorization(
      started.transaction_id,
      principal,
    );
    expect(continued.url).toContain("/connect/claude?transaction=");
    await expect(
      oauth.authorizationContext(started.transaction_id, principal),
    ).resolves.toMatchObject({ selectedWorkspaceId: workspaceId });

    const consent = await oauth.decideAuthorization(
      started.transaction_id,
      true,
      principal,
    );
    const code = new URL(consent.url).searchParams.get("code");
    expect(code).toBeTruthy();

    const exchanged = await oauth.exchangeToken({
      grant_type: "authorization_code",
      client_id: registered.client_id,
      code,
      redirect_uri: "https://claude.example.test/oauth/callback",
      resource: MCP_RESOURCE,
      code_verifier: verifier,
    });
    expect(
      (await oauth.authenticate(exchanged.access_token))?.workspaceId,
    ).toBe(workspaceId);
    const refreshed = await oauth.exchangeToken({
      grant_type: "refresh_token",
      client_id: registered.client_id,
      refresh_token: exchanged.refresh_token,
      resource: MCP_RESOURCE,
    });
    expect(refreshed.refresh_token).not.toBe(exchanged.refresh_token);
    expect(
      (await oauth.authenticate(refreshed.access_token))?.workspaceId,
    ).toBe(workspaceId);

    const mcp = new McpController(
      { tools: () => [{ name: "list_ad_accounts" }] } as never,
      serviceTokens,
      oauth,
      { consumeMcpRequest: async () => undefined } as never,
      { record: async () => undefined } as never,
      { call: async () => undefined } as never,
    );
    const initialize = await mcp.post(
      {
        headers: { authorization: `Bearer ${refreshed.access_token}` },
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      } as never,
      reply() as never,
    );
    expect(initialize).toMatchObject({
      result: { protocolVersion: "2025-03-26" },
    });
    const initializedReply = reply();
    await mcp.post(
      {
        headers: { authorization: `Bearer ${refreshed.access_token}` },
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      } as never,
      initializedReply as never,
    );
    expect(initializedReply.status).toBe(202);
    const tools = await mcp.post(
      {
        headers: { authorization: `Bearer ${refreshed.access_token}` },
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      } as never,
      reply() as never,
    );
    expect(tools).toMatchObject({
      result: { tools: [{ name: "list_ad_accounts" }] },
    });

    await expect(
      oauth.revoke({
        token: refreshed.refresh_token,
        client_id: registered.client_id,
      }),
    ).resolves.toEqual({ revoked: true });
    expect(await oauth.authenticate(refreshed.access_token)).toBeNull();

    const rawServiceToken = `hmst_integration_${randomUUID()}`;
    const identity = await database.client.serviceIdentity.create({
      data: { workspaceId, createdById: userId, name: "Codex regression" },
    });
    await database.client.serviceToken.create({
      data: {
        serviceIdentityId: identity.id,
        tokenDigest: hashServiceToken(rawServiceToken),
        tokenPrefix: rawServiceToken.slice(0, 13),
        name: "Codex regression",
        scopes: ["adforge:mcp:read"],
        accountIds: [],
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const codex = await mcp.post(
      {
        headers: { authorization: `Bearer ${rawServiceToken}` },
        body: { jsonrpc: "2.0", id: 3, method: "initialize" },
      } as never,
      reply() as never,
    );
    expect(codex).toMatchObject({ result: { protocolVersion: "2025-03-26" } });
  });

  it("negotiates an unscoped DCR client for TEST write without upgrading an older READ client", async () => {
    const resource = "https://mcp-test.holymedia.kz/mcp";
    const redirect = "https://chatgpt.com/connector/oauth/integration";
    const writeScope = "adforge:mcp:read adforge:mcp:write";
    vi.stubEnv("HOLYMEDIA_PUBLIC_BASE_URL", "https://mcp-test.holymedia.kz");
    vi.stubEnv("QRS_TEST_RESTRICTED_AUTH", "true");
    vi.stubEnv("QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED", "false");
    vi.stubEnv("GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST", "8590146099");
    vi.stubEnv("PROVIDER_GOOGLE_ADS_WRITE_ENABLED", "true");
    vi.stubEnv("PUBLIC_MCP_WRITE_SCOPE_ENABLED", "false");
    vi.stubEnv("PUBLIC_MCP_CONTROLLED_WRITE_ENABLED", "false");
    try {
      const metadata = {
        client_name: "ChatGPT integration",
        redirect_uris: [redirect],
      };
      const oldOauth = new OAuthAuthorizationService(database, {
        resolve: async () => null,
      } as never);
      const oldClient = await oldOauth.registerPublicClient(metadata);
      publicClientIds.push(oldClient.client_id);
      expect(oldClient.scope).toBe("adforge:mcp:read");

      vi.stubEnv("QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED", "true");
      const qrsOauth = new OAuthAuthorizationService(database, {
        resolve: async () => null,
      } as never);
      const newClient = await qrsOauth.registerPublicClient(metadata);
      publicClientIds.push(newClient.client_id);
      expect(newClient.scope).toBe(writeScope);
      const input = {
        client_id: newClient.client_id,
        redirect_uri: redirect,
        response_type: "code",
        resource,
        scope: writeScope,
        code_challenge: challenge(verifier),
        code_challenge_method: "S256",
      };
      await expect(
        qrsOauth.beginAuthorization({
          ...input,
          client_id: oldClient.client_id,
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        qrsOauth.beginAuthorization({
          ...input,
          redirect_uri: "https://wrong.example.test/callback",
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        qrsOauth.beginAuthorization({
          ...input,
          resource: "https://mcp.holymedia.kz/mcp",
        }),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        qrsOauth.beginAuthorization({
          ...input,
          code_challenge_method: "plain",
        }),
      ).rejects.toMatchObject({ status: 400 });

      const started = await qrsOauth.beginAuthorization(input, principal);
      expect(started.statusCode).toBe(302);
      await qrsOauth.continueAuthorization(started.transaction_id, principal);
      await expect(
        qrsOauth.decideAuthorization(started.transaction_id, true, principal),
      ).rejects.toMatchObject({ status: 400 });
      const consent = await qrsOauth.decideAuthorization(
        started.transaction_id,
        true,
        principal,
        undefined,
        writeScope,
      );
      const tokens = await qrsOauth.exchangeToken({
        grant_type: "authorization_code",
        client_id: newClient.client_id,
        code: new URL(consent.url).searchParams.get("code"),
        redirect_uri: redirect,
        resource,
        code_verifier: verifier,
      });
      expect(tokens.scope).toBe(writeScope);
      expect(
        await qrsOauth.authenticate(
          tokens.access_token,
          "https://mcp.holymedia.kz/mcp",
        ),
      ).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { McpController } from "./mcp.controller.js";
import { OAuthAuthorizationService } from "./oauth-authorization.service.js";
import { oauthEndpoints } from "./oauth-endpoints.js";

const MCP_RESOURCE = oauthEndpoints("https://prod.example.test").legacyResource;
const MCP_PUBLIC_RESOURCE = oauthEndpoints(
  "https://prod.example.test",
).publicResource;

type Row = Record<string, unknown> & { id: string };

function pkce(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function whereMatches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, expected]) => {
    const actual = row[key];
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      const condition = expected as Record<string, unknown>;
      if ("gt" in condition)
        return actual instanceof Date && actual > condition.gt!;
      if ("not" in condition) return actual !== condition.not;
      return true;
    }
    return actual === expected;
  });
}

function fakeDatabase() {
  const publicClients: Row[] = [];
  const transactions: Row[] = [];
  const codes: Row[] = [];
  const accessTokens: Row[] = [];
  const refreshTokens: Row[] = [];
  const memberships: Row[] = [];
  const workspaces = new Map<
    string,
    { id: string; name: string; accessStatus: string }
  >();
  const users = new Map<string, { id: string; status: string }>();

  const client = {
    oAuthPublicClient: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          revokedAt: null,
          status: "active",
          ...data,
        };
        publicClients.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        publicClients.find((row) => whereMatches(row, where)) ?? null,
    },
    oAuthAuthorizationTransaction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          consumedAt: null,
          ...data,
        };
        transactions.push(row);
        return row;
      },
      findFirst: async ({
        where,
        include,
      }: {
        where: Record<string, unknown>;
        include?: unknown;
      }) => {
        const row = transactions.find((item) => whereMatches(item, where));
        if (!row || !include) return row ?? null;
        const registered = publicClients.find(
          (item) => item.id === row.clientId,
        )!;
        return {
          ...row,
          client: {
            clientName: registered.clientName,
            clientId: registered.clientId,
          },
        };
      },
      update: async ({
        where,
        data,
        include,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
        include?: unknown;
      }) => {
        const row = transactions.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        if (!include) return row;
        const registered = publicClients.find(
          (item) => item.id === row.clientId,
        )!;
        const workspace = workspaces.get(String(row.workspaceId))!;
        return {
          ...row,
          client: {
            clientName: registered.clientName,
            clientId: registered.clientId,
          },
          workspace: { id: workspace.id, name: workspace.name },
        };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = transactions.filter((row) => whereMatches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    oAuthAuthorizationCode: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          usedAt: null,
          ...data,
        };
        codes.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) =>
        codes.find((row) => whereMatches(row, where)) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = codes.filter((row) => whereMatches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    oAuthAccessToken: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          revokedAt: null,
          lastUsedAt: null,
          ...data,
        };
        accessTokens.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenDigest: string } }) => {
        const row = accessTokens.find(
          (item) => item.tokenDigest === where.tokenDigest,
        );
        if (!row) return null;
        const registered = publicClients.find(
          (item) => item.id === row.clientId,
        )!;
        return {
          ...row,
          client: {
            clientId: registered.clientId,
            status: registered.status,
            revokedAt: registered.revokedAt,
          },
          workspace: {
            accessStatus: workspaces.get(String(row.workspaceId))?.accessStatus,
          },
          user: { status: users.get(String(row.userId))?.status },
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Record<string, unknown>;
      }) => {
        const row = accessTokens.find((item) => item.id === where.id)!;
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = accessTokens.filter((row) => whereMatches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    oAuthRefreshToken: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = {
          id: randomUUID(),
          createdAt: new Date(),
          usedAt: null,
          revokedAt: null,
          ...data,
        };
        refreshTokens.push(row);
        return row;
      },
      findUnique: async ({ where }: { where: { tokenDigest: string } }) => {
        const row = refreshTokens.find(
          (item) => item.tokenDigest === where.tokenDigest,
        );
        if (!row) return null;
        const registered = publicClients.find(
          (item) => item.id === row.clientId,
        )!;
        return {
          ...row,
          client: {
            clientId: registered.clientId,
            status: registered.status,
            revokedAt: registered.revokedAt,
          },
          workspace: {
            accessStatus: workspaces.get(String(row.workspaceId))?.accessStatus,
          },
          user: { status: users.get(String(row.userId))?.status },
        };
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        const rows = refreshTokens.filter((row) => whereMatches(row, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
    },
    workspaceMembership: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return (
          memberships.find((row) => {
            if (where.userId && row.userId !== where.userId) return false;
            if (where.workspaceId && row.workspaceId !== where.workspaceId)
              return false;
            return (
              workspaces.get(String(row.workspaceId))?.accessStatus === "ACTIVE"
            );
          }) ?? null
        );
      },
      findUnique: async ({
        where,
      }: {
        where: { workspaceId_userId: { workspaceId: string; userId: string } };
      }) =>
        memberships.find(
          (row) =>
            row.workspaceId === where.workspaceId_userId.workspaceId &&
            row.userId === where.workspaceId_userId.userId,
        ) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        memberships
          .filter((row) => {
            if (where.userId && row.userId !== where.userId) return false;
            return (
              workspaces.get(String(row.workspaceId))?.accessStatus === "ACTIVE"
            );
          })
          .map((row) => ({
            role: row.role ?? "OWNER",
            workspace: workspaces.get(String(row.workspaceId)),
          })),
    },
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(client),
  };

  return {
    database: { client } as never,
    state: {
      publicClients,
      transactions,
      codes,
      accessTokens,
      refreshTokens,
      memberships,
      workspaces,
      users,
    },
  };
}

function reply() {
  const result = {
    status: 0,
    body: undefined as unknown,
    code(status: number) {
      this.status = status;
      return this;
    },
    header() {
      return this;
    },
    send(body?: unknown) {
      this.body = body;
      return body;
    },
  };
  return result;
}

async function fixture(clientScope = "adforge:mcp:read") {
  const { database, state } = fakeDatabase();
  const oauth = new OAuthAuthorizationService(database, {
    resolve: async () => null,
  } as never);
  const userId = randomUUID();
  const workspaceId = randomUUID();
  state.users.set(userId, { id: userId, status: "active" });
  state.workspaces.set(workspaceId, {
    id: workspaceId,
    name: "OAuth workspace",
    accessStatus: "ACTIVE",
  });
  state.memberships.push({
    id: randomUUID(),
    userId,
    workspaceId,
    createdAt: new Date(),
  });
  const registered = await oauth.registerPublicClient({
    client_name: "Claude test",
    redirect_uris: ["https://claude.example.test/callback"],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: clientScope,
  });
  const principal: HumanPrincipal = {
    kind: "human",
    userId,
    sessionId: randomUUID(),
  };
  const verifier = "v".repeat(64);
  return {
    oauth,
    database,
    state,
    principal,
    workspaceId,
    registered,
    verifier,
  };
}

it("discovers a previously unseen hosted CIMD client before authorization", async () => {
  const { database } = fakeDatabase();
  const clientId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
  const resolve = vi.fn().mockResolvedValue({
    id: randomUUID(),
    clientId,
    registrationSource: "cimd",
    status: "active",
    revokedAt: null,
  });
  const oauth = new OAuthAuthorizationService(database, { resolve } as never);

  await expect(oauth.isPublicClient(clientId)).resolves.toBe(true);
  expect(resolve).toHaveBeenCalledWith(clientId);
});

async function issueCode(context: Awaited<ReturnType<typeof fixture>>) {
  const started = await context.oauth.beginAuthorization({
    client_id: context.registered.client_id,
    redirect_uri: "https://claude.example.test/callback",
    response_type: "code",
    state: "state-123",
    scope: "adforge:mcp:read",
    resource: MCP_RESOURCE,
    code_challenge: pkce(context.verifier),
    code_challenge_method: "S256",
  });
  await context.oauth.continueAuthorization(
    started.transaction_id,
    context.principal,
  );
  const consent = await context.oauth.decideAuthorization(
    started.transaction_id,
    true,
    context.principal,
  );
  return {
    ...started,
    code: new URL(consent.url).searchParams.get("code")!,
  };
}

describe("OAuth authorization foundation", () => {
  const previousWriteScopeFlag = process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED;
  const previousBaseUrl = process.env.HOLYMEDIA_PUBLIC_BASE_URL;
  beforeEach(() => {
    process.env.HOLYMEDIA_PUBLIC_BASE_URL = "https://prod.example.test";
  });
  afterEach(() => {
    if (previousWriteScopeFlag === undefined)
      delete process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED;
    else process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = previousWriteScopeFlag;
    if (previousBaseUrl === undefined)
      delete process.env.HOLYMEDIA_PUBLIC_BASE_URL;
    else process.env.HOLYMEDIA_PUBLIC_BASE_URL = previousBaseUrl;
  });

  it("rejects public write authorization while the scope gate is off, even for a declared client", async () => {
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = "false";
    const context = await fixture("adforge:mcp:read adforge:mcp:write");
    await expect(
      context.oauth.beginAuthorization({
        client_id: context.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        resource: MCP_PUBLIC_RESOURCE,
        scope: "adforge:mcp:read adforge:mcp:write",
        code_challenge: pkce(context.verifier),
        code_challenge_method: "S256",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("requires separate public write consent and retains exactly granted scopes across refresh", async () => {
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = "true";
    const readClient = await fixture();
    await expect(
      readClient.oauth.beginAuthorization({
        client_id: readClient.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        resource: MCP_PUBLIC_RESOURCE,
        scope: "adforge:mcp:read adforge:mcp:write",
        code_challenge: pkce(readClient.verifier),
        code_challenge_method: "S256",
      }),
    ).rejects.toMatchObject({ status: 400 });
    const context = await fixture("adforge:mcp:read adforge:mcp:write");
    const input = {
      client_id: context.registered.client_id,
      redirect_uri: "https://claude.example.test/callback",
      response_type: "code",
      resource: MCP_PUBLIC_RESOURCE,
      code_challenge: pkce(context.verifier),
      code_challenge_method: "S256",
    };
    await expect(
      context.oauth.beginAuthorization({
        ...input,
        scope: "adforge:mcp:write",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      context.oauth.beginAuthorization({
        ...input,
        resource: MCP_RESOURCE,
        scope: "adforge:mcp:read adforge:mcp:write",
      }),
    ).rejects.toMatchObject({ status: 400 });

    const readOnly = await context.oauth.beginAuthorization({
      ...input,
      scope: "adforge:mcp:read",
    });
    await context.oauth.continueAuthorization(
      readOnly.transaction_id,
      context.principal,
    );
    const readConsent = await context.oauth.authorizationContext(
      readOnly.transaction_id,
      context.principal,
    );
    expect(readConsent.scope).toBe("adforge:mcp:read");
    const readRedirect = await context.oauth.decideAuthorization(
      readOnly.transaction_id,
      true,
      context.principal,
    );
    const readTokens = await context.oauth.exchangeToken({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: new URL(readRedirect.url).searchParams.get("code"),
      redirect_uri: input.redirect_uri,
      code_verifier: context.verifier,
      resource: MCP_PUBLIC_RESOURCE,
    });
    expect(readTokens.scope).toBe("adforge:mcp:read");
    const readRefresh = await context.oauth.exchangeToken({
      grant_type: "refresh_token",
      client_id: context.registered.client_id,
      refresh_token: readTokens.refresh_token,
      resource: MCP_PUBLIC_RESOURCE,
      scope: "adforge:mcp:read adforge:mcp:write",
    });
    expect(readRefresh.scope).toBe("adforge:mcp:read");
    expect(
      await context.oauth.authenticate(readRefresh.access_token, MCP_RESOURCE),
    ).toBeNull();

    const declinedWrite = await context.oauth.beginAuthorization({
      ...input,
      scope: "adforge:mcp:read adforge:mcp:write",
    });
    await context.oauth.continueAuthorization(
      declinedWrite.transaction_id,
      context.principal,
    );
    const readInstead = await context.oauth.decideAuthorization(
      declinedWrite.transaction_id,
      true,
      context.principal,
      undefined,
      "adforge:mcp:read",
    );
    const downgraded = await context.oauth.exchangeToken({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: new URL(readInstead.url).searchParams.get("code"),
      redirect_uri: input.redirect_uri,
      code_verifier: context.verifier,
      resource: MCP_PUBLIC_RESOURCE,
    });
    expect(downgraded.scope).toBe("adforge:mcp:read");

    const write = await context.oauth.beginAuthorization({
      ...input,
      scope: "adforge:mcp:read adforge:mcp:write",
    });
    await context.oauth.continueAuthorization(
      write.transaction_id,
      context.principal,
    );
    const writeConsent = await context.oauth.authorizationContext(
      write.transaction_id,
      context.principal,
    );
    expect(writeConsent.scope).toContain("adforge:mcp:write");
    await expect(
      context.oauth.decideAuthorization(
        write.transaction_id,
        true,
        context.principal,
      ),
    ).rejects.toMatchObject({ status: 400 });
    const writeRedirect = await context.oauth.decideAuthorization(
      write.transaction_id,
      true,
      context.principal,
      undefined,
      "adforge:mcp:read adforge:mcp:write",
    );
    const writeTokens = await context.oauth.exchangeToken({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: new URL(writeRedirect.url).searchParams.get("code"),
      redirect_uri: input.redirect_uri,
      code_verifier: context.verifier,
      resource: MCP_PUBLIC_RESOURCE,
    });
    const before = await context.oauth.authenticate(
      writeTokens.access_token,
      MCP_PUBLIC_RESOURCE,
    );
    expect(before).toMatchObject({
      kind: "oauth",
      scopes: ["adforge:mcp:read", "adforge:mcp:write"],
      userId: context.principal.userId,
    });
    const rotated = await context.oauth.exchangeToken({
      grant_type: "refresh_token",
      client_id: context.registered.client_id,
      refresh_token: writeTokens.refresh_token,
      resource: MCP_PUBLIC_RESOURCE,
    });
    const after = await context.oauth.authenticate(
      rotated.access_token,
      MCP_PUBLIC_RESOURCE,
    );
    expect(after?.grantId).toBe(before?.grantId);
    expect(after?.scopes).toEqual(before?.scopes);
  });
  it("registers a public native client with RFC 7591 response metadata", async () => {
    const { oauth } = await fixture();
    await expect(
      oauth.registerPublicClient({
        client_name: "Claude Desktop",
        redirect_uris: ["http://127.0.0.1:32123/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "native",
      }),
    ).resolves.toMatchObject({
      client_id: expect.stringMatching(/^hm_public_/),
      client_id_issued_at: expect.any(Number),
      redirect_uris: ["http://127.0.0.1:32123/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    });
  });

  it("persists an anonymous transaction and resumes it with the authenticated workspace", async () => {
    const context = await fixture();
    const started = await context.oauth.beginAuthorization({
      client_id: context.registered.client_id,
      redirect_uri: "https://claude.example.test/callback",
      response_type: "code",
      state: "opaque-state",
      resource: MCP_RESOURCE,
      code_challenge: pkce(context.verifier),
      code_challenge_method: "S256",
    });

    expect(started.url).toContain("/auth?oauth_transaction=");
    const stored = context.state.transactions[0]!;
    expect(stored).toMatchObject({
      state: "opaque-state",
      redirectUri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      userId: null,
      workspaceId: null,
    });

    const resumed = await context.oauth.continueAuthorization(
      started.transaction_id,
      context.principal,
    );
    expect(resumed).toMatchObject({
      url: expect.stringContaining("/connect/claude?transaction="),
      statusCode: 302,
    });
    await expect(
      context.oauth.authorizationContext(
        started.transaction_id,
        context.principal,
      ),
    ).resolves.toMatchObject({
      selectedWorkspaceId: context.workspaceId,
      workspaces: [{ id: context.workspaceId }],
    });
  });

  it("accepts ui_locales as a non-security authorization hint", async () => {
    const context = await fixture();
    await expect(
      context.oauth.beginAuthorization({
        client_id: context.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        scope: "adforge:mcp:read",
        resource: MCP_RESOURCE,
        code_challenge: pkce(context.verifier),
        code_challenge_method: "S256",
        ui_locales: "ru-RU",
      }),
    ).resolves.toMatchObject({ statusCode: 302 });
  });

  it("exchanges a one-time code with S256 PKCE and authenticates MCP", async () => {
    const context = await fixture();
    const issued = await issueCode(context);
    const token = await context.oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: issued.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: context.verifier,
    });
    expect(token.access_token).toMatch(/^hm_oauth_/);
    expect(context.state.accessTokens[0]!.tokenDigest).toBe(
      digest(token.access_token),
    );
    expect(await context.oauth.authenticate(token.access_token)).toMatchObject({
      workspaceId: context.workspaceId,
      scopes: ["adforge:mcp:read"],
    });

    const mcp = new McpController(
      { tools: () => [{ name: "list_ad_accounts" }] } as never,
      { authenticate: async () => null } as never,
      context.oauth,
      { consumeMcpRequest: async () => undefined } as never,
      { record: async () => undefined } as never,
      { call: async () => undefined } as never,
    );
    const initializedReply = reply();
    const initialize = await mcp.post(
      {
        headers: { authorization: `Bearer ${token.access_token}` },
        body: { jsonrpc: "2.0", id: 1, method: "initialize" },
      } as never,
      initializedReply as never,
    );
    expect(initialize).toMatchObject({
      result: { protocolVersion: "2025-03-26" },
    });

    const notificationReply = reply();
    await mcp.post(
      {
        headers: { authorization: `Bearer ${token.access_token}` },
        body: { jsonrpc: "2.0", method: "notifications/initialized" },
      } as never,
      notificationReply as never,
    );
    expect(notificationReply.status).toBe(202);

    const tools = await mcp.post(
      {
        headers: { authorization: `Bearer ${token.access_token}` },
        body: { jsonrpc: "2.0", id: 2, method: "tools/list" },
      } as never,
      reply() as never,
    );
    expect(tools).toMatchObject({
      result: { tools: [{ name: "list_ad_accounts" }] },
    });
  });

  it("rejects wrong PKCE, redirect mismatch, expired and reused codes", async () => {
    const wrongPkce = await fixture();
    const first = await issueCode(wrongPkce);
    await expect(
      wrongPkce.oauth.exchangeAuthorizationCode({
        grant_type: "authorization_code",
        client_id: wrongPkce.registered.client_id,
        code: first.code,
        redirect_uri: "https://claude.example.test/callback",
        resource: MCP_RESOURCE,
        code_verifier: "x".repeat(64),
      }),
    ).rejects.toMatchObject({ status: 401 });

    await expect(
      wrongPkce.oauth.exchangeAuthorizationCode({
        grant_type: "authorization_code",
        client_id: wrongPkce.registered.client_id,
        code: first.code,
        redirect_uri: "https://claude.example.test/other",
        resource: MCP_RESOURCE,
        code_verifier: wrongPkce.verifier,
      }),
    ).rejects.toMatchObject({ status: 401 });

    wrongPkce.state.codes[0]!.expiresAt = new Date(Date.now() - 1);
    await expect(
      wrongPkce.oauth.exchangeAuthorizationCode({
        grant_type: "authorization_code",
        client_id: wrongPkce.registered.client_id,
        code: first.code,
        redirect_uri: "https://claude.example.test/callback",
        resource: MCP_RESOURCE,
        code_verifier: wrongPkce.verifier,
      }),
    ).rejects.toMatchObject({ status: 401 });

    const reused = await fixture();
    const second = await issueCode(reused);
    const input = {
      grant_type: "authorization_code",
      client_id: reused.registered.client_id,
      code: second.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: reused.verifier,
    };
    await reused.oauth.exchangeAuthorizationCode(input);
    await expect(
      reused.oauth.exchangeAuthorizationCode(input),
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it("rotates refresh tokens and revokes the token family on replay", async () => {
    const context = await fixture();
    const issued = await issueCode(context);
    const first = await context.oauth.exchangeToken({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: issued.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: context.verifier,
    });
    const rotated = await context.oauth.exchangeToken({
      grant_type: "refresh_token",
      client_id: context.registered.client_id,
      refresh_token: first.refresh_token,
      resource: MCP_RESOURCE,
    });
    expect(rotated.refresh_token).not.toBe(first.refresh_token);
    expect(
      await context.oauth.authenticate(rotated.access_token),
    ).toMatchObject({ workspaceId: context.workspaceId });

    await expect(
      context.oauth.exchangeToken({
        grant_type: "refresh_token",
        client_id: context.registered.client_id,
        refresh_token: first.refresh_token,
        resource: MCP_RESOURCE,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(await context.oauth.authenticate(rotated.access_token)).toBeNull();
    expect(context.state.refreshTokens.every((token) => token.revokedAt)).toBe(
      true,
    );
  });

  it("revokes a refresh-token family without affecting provider data", async () => {
    const context = await fixture();
    const issued = await issueCode(context);
    const token = await context.oauth.exchangeToken({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: issued.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: context.verifier,
    });
    await context.oauth.revoke({
      token: token.refresh_token,
      client_id: context.registered.client_id,
    });
    expect(await context.oauth.authenticate(token.access_token)).toBeNull();
  });

  it("rejects expired transactions and foreign workspace binding", async () => {
    const context = await fixture();
    const started = await context.oauth.beginAuthorization({
      client_id: context.registered.client_id,
      redirect_uri: "https://claude.example.test/callback",
      response_type: "code",
      resource: MCP_RESOURCE,
      code_challenge: pkce(context.verifier),
      code_challenge_method: "S256",
    });
    context.state.transactions[0]!.expiresAt = new Date(Date.now() - 1);
    await expect(
      context.oauth.continueAuthorization(
        started.transaction_id,
        context.principal,
      ),
    ).rejects.toMatchObject({ status: 400 });

    const foreign = await fixture();
    const issued = await foreign.oauth.beginAuthorization({
      client_id: foreign.registered.client_id,
      redirect_uri: "https://claude.example.test/callback",
      response_type: "code",
      resource: MCP_RESOURCE,
      code_challenge: pkce(foreign.verifier),
      code_challenge_method: "S256",
    });
    await expect(
      foreign.oauth.continueAuthorization(
        issued.transaction_id,
        foreign.principal,
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("requires an explicit company choice for a multi-workspace user and binds the code server-side", async () => {
    const context = await fixture();
    const secondWorkspaceId = randomUUID();
    context.state.workspaces.set(secondWorkspaceId, {
      id: secondWorkspaceId,
      name: "Second workspace",
      accessStatus: "ACTIVE",
    });
    context.state.memberships.push({
      id: randomUUID(),
      userId: context.principal.userId,
      workspaceId: secondWorkspaceId,
      role: "ADMIN",
      createdAt: new Date(),
    });

    const started = await context.oauth.beginAuthorization(
      {
        client_id: context.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        state: "multi-workspace-state",
        resource: MCP_RESOURCE,
        code_challenge: pkce(context.verifier),
        code_challenge_method: "S256",
      },
      context.principal,
    );
    expect(context.state.transactions[0]!.workspaceId).toBeNull();

    await context.oauth.continueAuthorization(
      started.transaction_id,
      context.principal,
    );
    await expect(
      context.oauth.authorizationContext(
        started.transaction_id,
        context.principal,
      ),
    ).resolves.toMatchObject({
      selectedWorkspaceId: null,
      workspaces: expect.arrayContaining([
        expect.objectContaining({ id: context.workspaceId }),
        expect.objectContaining({ id: secondWorkspaceId }),
      ]),
    });

    const consent = await context.oauth.decideAuthorization(
      started.transaction_id,
      true,
      context.principal,
      secondWorkspaceId,
    );
    expect(new URL(consent.url).searchParams.get("state")).toBe(
      "multi-workspace-state",
    );
    expect(context.state.codes[0]!.workspaceId).toBe(secondWorkspaceId);
  });

  it("returns an OAuth access_denied redirect without issuing a code", async () => {
    const context = await fixture();
    const started = await context.oauth.beginAuthorization(
      {
        client_id: context.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        state: "deny-state",
        resource: MCP_RESOURCE,
        code_challenge: pkce(context.verifier),
        code_challenge_method: "S256",
      },
      context.principal,
    );
    const denied = await context.oauth.decideAuthorization(
      started.transaction_id,
      false,
      context.principal,
    );
    expect(denied.url).toContain("error=access_denied");
    expect(denied.url).toContain("state=deny-state");
    expect(context.state.codes).toHaveLength(0);
  });

  it("rejects invalid OAuth access tokens", async () => {
    const context = await fixture();
    expect(await context.oauth.authenticate("hm_oauth_invalid")).toBeNull();
  });

  it("invalidates an OAuth token when its user no longer belongs to the bound workspace", async () => {
    const context = await fixture();
    const issued = await issueCode(context);
    const token = await context.oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: issued.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: context.verifier,
    });
    context.state.memberships.splice(0);
    expect(await context.oauth.authenticate(token.access_token)).toBeNull();
  });

  it("revokes an OAuth access token without affecting other client credentials", async () => {
    const context = await fixture();
    const issued = await issueCode(context);
    const token = await context.oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      client_id: context.registered.client_id,
      code: issued.code,
      redirect_uri: "https://claude.example.test/callback",
      resource: MCP_RESOURCE,
      code_verifier: context.verifier,
    });
    await expect(
      context.oauth.revoke({
        token: token.access_token,
        client_id: context.registered.client_id,
      }),
    ).resolves.toEqual({ revoked: true });
    expect(await context.oauth.authenticate(token.access_token)).toBeNull();
  });

  it("isolates authorization codes, access tokens and refresh grants between production and local", async () => {
    const production = await fixture();
    const productionCode = await issueCode(production);
    const productionTokens = await production.oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      client_id: production.registered.client_id,
      code: productionCode.code,
      redirect_uri: "https://claude.example.test/callback",
      code_verifier: production.verifier,
    });
    expect(production.state.accessTokens.at(-1)?.resource).toBe(MCP_RESOURCE);
    expect(production.state.refreshTokens.at(-1)?.resource).toBe(MCP_RESOURCE);

    const pendingProductionCode = await issueCode(production);
    const pendingProductionTransaction =
      await production.oauth.beginAuthorization(
        {
          client_id: production.registered.client_id,
          redirect_uri: "https://claude.example.test/callback",
          response_type: "code",
          resource: MCP_RESOURCE,
          code_challenge: pkce(production.verifier),
          code_challenge_method: "S256",
        },
        production.principal,
      );
    process.env.HOLYMEDIA_PUBLIC_BASE_URL = "https://local.example.test";
    const local = new OAuthAuthorizationService(production.database, {
      resolve: async () => null,
    } as never);
    const localEndpoints = oauthEndpoints("https://local.example.test");
    await expect(
      local.continueAuthorization(
        pendingProductionTransaction.transaction_id,
        production.principal,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      local.authorizationContext(
        pendingProductionTransaction.transaction_id,
        production.principal,
      ),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      local.decideAuthorization(
        pendingProductionTransaction.transaction_id,
        true,
        production.principal,
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      production.oauth.beginAuthorization({
        client_id: production.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        resource: localEndpoints.legacyResource,
        code_challenge: pkce(production.verifier),
        code_challenge_method: "S256",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      local.beginAuthorization({
        client_id: production.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        resource: MCP_RESOURCE,
        code_challenge: pkce(production.verifier),
        code_challenge_method: "S256",
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      local.exchangeAuthorizationCode({
        grant_type: "authorization_code",
        client_id: production.registered.client_id,
        code: pendingProductionCode.code,
        redirect_uri: "https://claude.example.test/callback",
        code_verifier: production.verifier,
      }),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      local.exchangeRefreshToken({
        client_id: production.registered.client_id,
        refresh_token: productionTokens.refresh_token,
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(
      await local.authenticate(
        productionTokens.access_token,
        localEndpoints.legacyResource,
      ),
    ).toBeNull();
    expect(
      await local.authenticate(productionTokens.access_token, MCP_RESOURCE),
    ).toBeNull();

    const started = await local.beginAuthorization({
      client_id: production.registered.client_id,
      redirect_uri: "https://claude.example.test/callback",
      response_type: "code",
      resource: localEndpoints.publicResource,
      code_challenge: pkce(production.verifier),
      code_challenge_method: "S256",
    });
    expect(started.url).toBe(
      `${localEndpoints.login}?oauth_transaction=${started.transaction_id}`,
    );
    const alreadyLoggedIn = await local.beginAuthorization(
      {
        client_id: production.registered.client_id,
        redirect_uri: "https://claude.example.test/callback",
        response_type: "code",
        resource: localEndpoints.legacyResource,
        code_challenge: pkce(production.verifier),
        code_challenge_method: "S256",
      },
      production.principal,
    );
    expect(alreadyLoggedIn.url).toBe(
      `${localEndpoints.authorizationContinue}?transaction=${alreadyLoggedIn.transaction_id}`,
    );
    const continued = await local.continueAuthorization(
      started.transaction_id,
      production.principal,
    );
    expect(continued.url).toBe(
      `${localEndpoints.consent}?transaction=${started.transaction_id}`,
    );
    const stagedCode = await local.decideAuthorization(
      started.transaction_id,
      true,
      production.principal,
    );
    const stagedTokens = await local.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      client_id: production.registered.client_id,
      code: new URL(stagedCode.url).searchParams.get("code"),
      redirect_uri: "https://claude.example.test/callback",
      code_verifier: production.verifier,
      resource: localEndpoints.publicResource,
    });
    expect(production.state.accessTokens.at(-1)?.resource).toBe(
      localEndpoints.publicResource,
    );
    expect(
      await local.authenticate(
        stagedTokens.access_token,
        localEndpoints.publicResource,
      ),
    ).toMatchObject({ resource: localEndpoints.publicResource });
    expect(
      await production.oauth.authenticate(
        stagedTokens.access_token,
        MCP_PUBLIC_RESOURCE,
      ),
    ).toBeNull();
    await expect(
      production.oauth.exchangeRefreshToken({
        client_id: production.registered.client_id,
        refresh_token: stagedTokens.refresh_token,
      }),
    ).rejects.toMatchObject({ status: 401 });
    const rotated = await local.exchangeRefreshToken({
      client_id: production.registered.client_id,
      refresh_token: stagedTokens.refresh_token,
    });
    expect(rotated.access_token).toMatch(/^hm_oauth_/);
    expect(production.state.accessTokens.at(-1)?.resource).toBe(
      localEndpoints.publicResource,
    );
    expect(production.state.refreshTokens.at(-1)?.resource).toBe(
      localEndpoints.publicResource,
    );
  });
});

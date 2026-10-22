import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { extendedFixture } from "./google-extended-test.fixture.js";
import {
  human,
  customer,
  prefix,
  object,
  fixture,
} from "./google-write-test.fixture.js";
import { OAuthAuthorizationService } from "./oauth-authorization.service.js";
import type { OAuthMcpPrincipal } from "./mcp-principal.js";
import { McpController } from "./mcp.controller.js";

type Row = Record<string, unknown>;
function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, wanted]) => {
    if (key === "OR") return (wanted as Row[]).some((w) => matches(row, w));
    if (key === "AND") return (wanted as Row[]).every((w) => matches(row, w));
    const actual = row[key];
    if (wanted && typeof wanted === "object" && !Array.isArray(wanted)) {
      const condition = object(wanted);
      if (Array.isArray(condition.path)) {
        const selected = condition.path.reduce(
          (value, part) => object(value)[String(part)],
          actual,
        );
        return selected === condition.equals;
      }
      if ("gt" in condition)
        return actual instanceof Date && actual > (condition.gt as Date);
      if ("in" in condition)
        return (condition.in as unknown[]).includes(actual);
      if ("not" in condition) return actual !== condition.not;
      if ("equals" in condition)
        return JSON.stringify(actual) === JSON.stringify(condition.equals);
      if ("some" in condition)
        return (
          Array.isArray(actual) &&
          actual.some((v) => matches(object(v), object(condition.some)))
        );
      return !!actual && matches(object(actual), condition);
    }
    return actual === wanted;
  });
}
function setup(keywordMode = false) {
  const base = keywordMode
    ? fixture(false, { stage2: true, extended: true })
    : null;
  const f = base
    ? {
        ...base,
        counts: () => ({
          read: base.requests.filter((r) => r.url.includes("search")).length,
          validate_only: base.requests.filter(
            (r) => r.body.validateOnly === true,
          ).length,
          write: base.writes(),
        }),
      }
    : extendedFixture();
  vi.stubEnv("PUBLIC_MCP_WRITE_SCOPE_ENABLED", "false");
  vi.stubEnv("PUBLIC_MCP_CONTROLLED_WRITE_ENABLED", "false");
  const identity: OAuthMcpPrincipal = {
    kind: "oauth",
    tokenId: "oauth-access-1",
    userId: human.userId,
    clientId: "oauth-client-a",
    grantId: "oauth-family-a",
    workspaceId: "workspace-a",
    resource: "https://mcp.holymedia.kz/mcp",
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    accountIds: [],
    resourceAccessMode: "ALL_CONNECTED",
  };
  const state = {
    role: "ADMIN",
    workspaceStatus: "ACTIVE",
    userStatus: "active",
    clientStatus: "active",
    clientRevoked: false,
    grantRevoked: false,
    grantExpired: false,
    sessionActive: true,
    scope: identity.scopes.join(" "),
    clientScope: identity.scopes.join(" "),
    accessScope: identity.scopes.join(" "),
    accountEnabled: true,
    accessExpired: false,
    accessRevoked: false,
  };
  const accessIds = new Set([identity.tokenId]);
  const member = () => ({
    id: "membership-a",
    userId: identity.userId,
    workspaceId: identity.workspaceId,
    role: state.role,
    user: { status: state.userStatus },
    workspace: { accessStatus: state.workspaceStatus },
  });
  const client = () => ({
    status: state.clientStatus,
    revokedAt: state.clientRevoked ? new Date() : null,
    scope: state.clientScope,
  });
  const account = () => ({
    id: "11111111-1111-4111-8111-111111111111",
    provider: "GOOGLE_ADS",
    workspaceId: identity.workspaceId,
    connectionId: "connection-a",
    externalAccountId: customer,
    enabled: state.accountEnabled,
    connection: { workspaceId: identity.workspaceId, status: "CONNECTED" },
  });
  const db = f.db.client as typeof f.db.client & {
    workspaceMembership: { findFirst: unknown };
    oAuthRefreshToken: { findFirst: unknown };
    oAuthAccessToken: { findFirst: unknown };
    session: { findFirst: unknown };
  };
  db.workspaceMembership = {
    findFirst: vi.fn(async ({ where }: { where: Row }) =>
      matches(member(), where) ? member() : null,
    ),
  };
  db.oAuthRefreshToken = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const grant = {
        familyId: identity.grantId,
        userId: identity.userId,
        workspaceId: identity.workspaceId,
        clientId: identity.clientId,
        resource: identity.resource,
        usedAt: null,
        revokedAt: state.grantRevoked ? new Date() : null,
        expiresAt: state.grantExpired
          ? new Date(0)
          : new Date(Date.now() + 600000),
        scope: state.scope,
        client: client(),
        workspace: { accessStatus: state.workspaceStatus },
        user: { status: state.userStatus },
      };
      return matches(grant, where) ? grant : null;
    }),
  };
  db.oAuthAccessToken = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const access = {
        id: where.id,
        userId: identity.userId,
        workspaceId: identity.workspaceId,
        clientId: identity.clientId,
        resource: identity.resource,
        refreshFamilyId: identity.grantId,
        revokedAt: state.accessRevoked ? new Date() : null,
        expiresAt: state.accessExpired
          ? new Date(0)
          : new Date(Date.now() + 600000),
        scope: state.accessScope,
      };
      return accessIds.has(String(where.id)) && matches(access, where)
        ? access
        : null;
    }),
  };
  db.session = {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const row = {
        id: human.sessionId,
        userId: human.userId,
        revokedAt: state.sessionActive ? null : new Date(),
        expiresAt: new Date(Date.now() + 600000),
        user: { status: state.userStatus },
      };
      return matches(row, where) ? row : null;
    }),
  };
  Object.assign(db.providerAccount, {
    findFirst: vi.fn(async ({ where }: { where: Row }) =>
      matches(account(), where) ? account() : null,
    ),
  });
  const complete = (row: Row) => ({
    ...row,
    oauthUser: { status: state.userStatus, memberships: [member()] },
    oauthClient: client(),
    account: account(),
  });
  Object.assign(db.mcpPreview, {
    findFirst: vi.fn(async ({ where }: { where: Row }) => {
      const row = f.previewsRows.find((r) => matches(complete(r), where));
      return row ? structuredClone({ ...row, serviceToken: null }) : null;
    }),
  });
  const create = db.mcpPreview.create.getMockImplementation()!;
  db.mcpPreview.create.mockImplementation(async (args: { data: Row }) => {
    // This accurately enforces that a native OAuth access id is never a ServiceToken FK.
    if (
      args.data.serviceTokenId !== null ||
      args.data.principalType !== "OAUTH_USER"
    )
      throw new Error("invalid native OAuth FK identity");
    return create(args);
  });
  db.mcpPreview.updateMany.mockImplementation(
    async ({ where, data }: { where: Row; data: Row }) => {
      const row = f.previewsRows.find((r) => matches(complete(r), where));
      if (!row) return { count: 0 };
      Object.assign(row, structuredClone(data));
      return { count: 1 };
    },
  );
  const record = f.audit.record.getMockImplementation()!;
  f.audit.record.mockImplementation(async (input: Row) =>
    record({ success: true, ...input }),
  );
  db.auditEvent.findFirst.mockImplementation(
    async ({ where }: { where: Row }) =>
      f.events.find((e) => matches(e, where)) ?? null,
  );
  const oauth = new OAuthAuthorizationService(f.db as never, {} as never);
  Object.assign(f.previews, { oauth });
  const call = (name: string, args: Row, principal = identity) =>
    f.mcp
      .callGoogleWriteProfile(principal, name, {
        provider: "GOOGLE_ADS",
        account_id: customer,
        ...args,
      })
      .then(object);
  const preview = (principal = identity) =>
    call(
      "google_ads_ads_assets_preview",
      {
        action: "campaign_update",
        items: [{ campaign_id: "1", name: "Native OAuth TEST rename" }],
      },
      principal,
    );
  const commit = (p: Row, principal = identity) =>
    f.mcp
      .callGoogleWriteProfile(principal, "commit_preview", {
        preview_token: p.preview_token,
      })
      .then(object);
  const approve = (p: Row, actor = human) =>
    f.previews.decideGoogleApproval(
      actor,
      String(p.approval_url).split("#")[1]!,
      "approve",
    );
  return {
    ...f,
    identity,
    state,
    accessIds,
    oauth,
    preview,
    commit,
    approve,
    call,
  };
}
describe("Native private Google OAuth: stock controlled flow, mocked HTTP only", () => {
  it("native stable grant persists OAuth fields, rotates access token, approves/commits/rolls back with independent consent and human audit", async () => {
    const f = setup(),
      p = await f.preview();
    expect(f.previewsRows[0]).toMatchObject({
      principalType: "OAUTH_USER",
      serviceTokenId: null,
      oauthUserId: human.userId,
      oauthClientId: f.identity.clientId,
      oauthGrantId: f.identity.grantId,
    });
    expect(object(object(f.previewsRows[0]!.diff).authorization).resource).toBe(
      f.identity.resource,
    );
    expect(f.counts().write).toBe(0);
    await expect(f.commit(p)).rejects.toThrow();
    await f.approve(p);
    f.accessIds.delete(f.identity.tokenId);
    const rotated = { ...f.identity, tokenId: "oauth-access-2" };
    f.accessIds.add(rotated.tokenId);
    const r = await f.commit(p, rotated);
    expect(r.status).toBe("VERIFIED");
    expect(
      object(f.resources.get(`${prefix}/campaigns/1`)?.campaign).name,
    ).toBe("Native OAuth TEST rename");
    const inverse = object(
      await f.mcp.callGoogleWriteProfile(rotated, "preview_rollback_commit", {
        commit_id: r.commit_id,
      }),
    );
    await expect(f.commit(inverse, rotated)).rejects.toThrow();
    await f.approve(inverse);
    expect((await f.commit(inverse, rotated)).status).toBe("VERIFIED");
    expect(
      object(f.resources.get(`${prefix}/campaigns/1`)?.campaign).name,
    ).toBe("TEST PPC");
    expect(f.db.client.serviceToken.findFirst).not.toHaveBeenCalled();
    expect(
      f.events.filter((e) => e.eventType === "mcp_google_commit_result"),
    ).toHaveLength(2);
    expect(
      f.events
        .filter((e) => e.eventType === "mcp_google_commit_result")
        .every(
          (e) => e.actorType === "HUMAN" && e.actorUserId === human.userId,
        ),
    ).toBe(true);
    await expect(f.commit(p, rotated)).rejects.toThrow();
    expect(f.counts().write).toBe(2);
  });
  it.each([
    "userId",
    "clientId",
    "grantId",
    "workspaceId",
    "resource",
  ] as const)(
    "foreign %s cannot preview or commit another owner's approved record",
    async (field) => {
      const f = setup(),
        p = await f.preview();
      await f.approve(p);
      const foreign = { ...f.identity, [field]: "foreign" };
      await expect(f.commit(p, foreign)).rejects.toThrow();
      const n = f.counts().validate_only;
      await expect(f.preview(foreign)).rejects.toThrow();
      expect(f.counts().validate_only).toBe(n);
      expect(f.counts().write).toBe(0);
    },
  );
  it.each([
    "grantRevoked",
    "grantExpired",
    "clientRevoked",
    "accessExpired",
    "accessRevoked",
  ] as const)(
    "fresh %s after approval blocks before mutation",
    async (flag) => {
      const f = setup(),
        p = await f.preview();
      await f.approve(p);
      f.state[flag] = true;
      await expect(f.commit(p)).rejects.toThrow();
      expect(f.counts().write).toBe(0);
    },
  );
  it.each(["scope", "clientScope", "accessScope"] as const)(
    "fresh %s narrowing blocks commit and no new preview validation",
    async (flag) => {
      const f = setup(),
        p = await f.preview();
      await f.approve(p);
      f.state[flag] = "adforge:mcp:read";
      await expect(f.commit(p)).rejects.toThrow();
      await expect(f.preview()).rejects.toThrow();
      expect(f.counts().write).toBe(0);
      expect(f.counts().validate_only).toBe(1);
    },
  );
  it.each(["VIEWER", "missing"])(
    "workspace role %s rejects fresh approval and commit",
    async (role) => {
      const f = setup(),
        p = await f.preview();
      f.state.role = role;
      await expect(f.approve(p)).rejects.toThrow();
      await expect(f.commit(p)).rejects.toThrow();
      expect(f.counts().write).toBe(0);
    },
  );
  it("foreign browser actor and revoked approval session cannot authorize commit", async () => {
    const f = setup(),
      p = await f.preview();
    expect(await f.approve(p, { ...human, userId: "foreign" })).toBeNull();
    await f.approve(p);
    f.state.sessionActive = false;
    await expect(f.commit(p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it("persisted confirmation without durable human approval audit is insufficient", async () => {
    const f = setup(),
      p = await f.preview();
    await f.approve(p);
    const i = f.events.findIndex(
      (e) => e.eventType === "mcp_preview_web_approved",
    );
    f.events.splice(i, 1);
    await expect(f.commit(p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
  });
  it.each(["expired", "stale", "tamper"])(
    "%s approved payload rejects before Google mutation",
    async (which) => {
      const f = setup(),
        p = await f.preview();
      await f.approve(p);
      if (which === "expired") f.previewsRows[0]!.expiresAt = new Date(0);
      if (which === "stale")
        object(f.resources.get(`${prefix}/campaigns/1`)?.campaign).name =
          "External";
      if (which === "tamper")
        object(object(f.previewsRows[0]!.diff).authorization).resource =
          "https://mcp.holymedia.kz/mcp/public";
      await expect(f.commit(p)).rejects.toThrow();
      expect(f.counts().write).toBe(0);
    },
  );
  it("public-resource grant can never use private Google write, Public write flags remain false", async () => {
    const f = setup();
    expect(loadConfig().publicMcpWriteScopeEnabled).toBe(false);
    expect(loadConfig().publicMcpControlledWriteEnabled).toBe(false);
    await expect(
      f.preview({ ...f.identity, resource: `${f.identity.resource}/public` }),
    ).rejects.toThrow();
    expect(f.counts().validate_only).toBe(0);
    expect(f.counts().write).toBe(0);
  });
  it("controller retains native OAuth identity instead of synthetic ServiceToken principal", async () => {
    const f = setup();
    const controller = new McpController(
      {} as never,
      { authenticate: vi.fn(async () => null) } as never,
      { authenticate: vi.fn(async () => f.identity) } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const actual = await (
      controller as unknown as {
        authenticate(token: string, publicRoute: boolean): Promise<unknown>;
      }
    ).authenticate("not-a-secret-fixture", false);
    expect(actual).toEqual(f.identity);
    expect(actual).not.toHaveProperty("serviceIdentityId");
  });
  it("existing keyword status vertical slice uses the same native identity and inverse approval", async () => {
    const f = setup(true);
    const p = await f.call("update_entity_status_preview", {
      entity_type: "keyword",
      status: "PAUSED",
      items: [{ campaign_id: "1", ad_group_id: "10", criterion_id: "101" }],
    });
    await f.approve(p);
    const result = await f.commit(p);
    expect(result.status).toBe("VERIFIED");
    expect(
      object(
        f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion,
      ).status,
    ).toBe("PAUSED");
    const inv = object(
      await f.mcp.callGoogleWriteProfile(
        f.identity,
        "preview_rollback_commit",
        { commit_id: result.commit_id },
      ),
    );
    await f.approve(inv);
    expect((await f.commit(inv)).status).toBe("VERIFIED");
    expect(
      object(
        f.resources.get(`${prefix}/adGroupCriteria/10~101`)?.adGroupCriterion,
      ).status,
    ).toBe("ENABLED");
    expect(f.db.client.serviceToken.findFirst).not.toHaveBeenCalled();
    expect(f.counts().write).toBe(2);
  });
  it("concurrent native commits claim at most once", async () => {
    const f = setup(),
      p = await f.preview();
    await f.approve(p);
    const results = await Promise.allSettled([f.commit(p), f.commit(p)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(f.counts().write).toBe(1);
  });
  it("fresh grant revoked during claim blocks before provider mutation", async () => {
    const f = setup(),
      p = await f.preview();
    await f.approve(p);
    const update = f.db.client.mcpPreview.updateMany.getMockImplementation()!;
    f.db.client.mcpPreview.updateMany.mockImplementation(async (args) => {
      const result = await update(args);
      if (args.data.commitStatus === "CLAIMED") f.state.grantRevoked = true;
      return result;
    });
    await expect(f.commit(p)).rejects.toThrow();
    expect(f.counts().write).toBe(0);
    expect(f.previewsRows[0]!.consumedAt).toBeInstanceOf(Date);
  });
  it("native private Google grant cannot activate unrelated Meta controlled writes", async () => {
    const f = setup();
    await expect(
      f.mcp.call(f.identity, "preview_change_campaign_name", {
        provider: "META_ADS",
        account_id: "act_1",
        campaign_id: "1",
        new_name: "Forbidden",
      }),
    ).rejects.toThrow();
    expect(f.counts().write).toBe(0);
    expect(f.counts().validate_only).toBe(0);
  });
});

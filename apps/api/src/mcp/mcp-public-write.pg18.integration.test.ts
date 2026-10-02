import { createDatabase, closeDatabase } from "@holymedia/database";
import { describe, expect, it, vi } from "vitest";
import { McpPublicWriteService } from "./mcp-public-write.service.js";
import type { OAuthMcpPrincipal } from "./mcp-principal.js";

// Never run this against a non-disposable database by accident.
const localUrl = process.env.V2_PG18_TEST_DATABASE_URL;
const ciUrl = localUrl ? new URL(localUrl) : null;
const enabled =
  localUrl === "postgresql://postgres@127.0.0.1:55418/holymedia_pg18_test" ||
  (process.env.V2_PG18_REHEARSAL === "true" &&
    ciUrl?.hostname === "127.0.0.1" &&
    ciUrl.username === "holymedia" &&
    ciUrl.pathname === "/public_mcp_upgrade");

describe.skipIf(!enabled)(
  "PostgreSQL 18 disposable public preview lifecycle",
  () => {
    it("keeps legacy preview compatibility and atomically claims one browser-approved OAuth preview", async () => {
      const database = createDatabase(localUrl!);
      const suffix = Math.random().toString(36).slice(2);
      const principal: OAuthMcpPrincipal = {
        kind: "oauth",
        tokenId: `access-${suffix}`,
        userId: "",
        workspaceId: "",
        clientId: "",
        grantId: "a0000000-0000-4000-8000-00000000000a",
        resource: "https://mcp.holymedia.kz/mcp/public",
        scopes: ["adforge:mcp:read", "adforge:mcp:write"],
        accountIds: [],
        resourceAccessMode: "ALL_CONNECTED",
      };
      let clientId = "";
      let previewId = "";
      let workspaceId = "";
      let userId = "";
      try {
        const version = await database.client.$queryRaw<
          Array<{ version: string }>
        >`
        SELECT current_setting('server_version') AS version`;
        expect(version[0]?.version).toMatch(/^18\./);
        const user = await database.client.user.create({
          data: {
            email: `public-pg18-${suffix}@example.test`,
            name: "Public PG18 test",
            passwordHash: "ci-only",
          },
        });
        userId = user.id;
        principal.userId = userId;
        const workspace = await database.client.workspace.create({
          data: {
            name: "Public PG18 test",
            slug: `public-pg18-${suffix}`,
            accessStatus: "ACTIVE",
            memberships: { create: { userId, role: "OWNER" } },
          },
        });
        workspaceId = workspace.id;
        principal.workspaceId = workspaceId;
        const connection = await database.client.providerConnection.create({
          data: {
            workspaceId,
            provider: "META_ADS",
            status: "CONNECTED",
            createdBy: userId,
          },
        });
        const account = await database.client.providerAccount.create({
          data: {
            workspaceId,
            connectionId: connection.id,
            provider: "META_ADS",
            externalAccountId: "act_123",
            displayName: "Mock account",
            enabled: true,
          },
        });
        const identity = await database.client.serviceIdentity.create({
          data: { workspaceId, createdById: userId, name: "Legacy preview" },
        });
        const token = await database.client.serviceToken.create({
          data: {
            serviceIdentityId: identity.id,
            tokenDigest: `pg18-service-${suffix}`,
            tokenPrefix: "pg18-service",
            name: "Legacy preview",
            scopes: ["adforge:mcp:read"],
          },
        });
        const legacy = await database.client.mcpPreview.create({
          data: {
            workspaceId,
            serviceTokenId: token.id,
            provider: "META_ADS",
            accountId: account.id,
            externalObjectId: "123456789",
            operation: "META_CAMPAIGN_PAUSE",
            payload: { status: "PAUSED" },
            diff: { before: "ACTIVE", requested: "PAUSED" },
            previewTokenDigest: `pg18-legacy-${suffix}`,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
        expect(legacy).toMatchObject({
          principalType: "SERVICE_TOKEN",
          oauthUserId: null,
          approvalTokenDigest: null,
        });

        await database.client.workspaceMembership.upsert({
          where: {
            workspaceId_userId: {
              workspaceId: principal.workspaceId,
              userId: principal.userId,
            },
          },
          create: {
            workspaceId: principal.workspaceId,
            userId: principal.userId,
            role: "OWNER",
          },
          update: {},
        });
        const client = await database.client.oAuthPublicClient.create({
          data: {
            clientId: `hm_public_pg18_${suffix}`,
            clientName: "PG18 test client",
            redirectUris: ["https://client.example.test/callback"],
            scope: "adforge:mcp:read adforge:mcp:write",
          },
        });
        clientId = client.id;
        principal.clientId = client.id;
        await database.client.oAuthRefreshToken.create({
          data: {
            tokenDigest: `pg18-refresh-${suffix}`,
            tokenPrefix: "pg18-refresh",
            familyId: principal.grantId,
            clientId,
            workspaceId: principal.workspaceId,
            userId: principal.userId,
            scope: "adforge:mcp:read adforge:mcp:write",
            resource: principal.resource,
            expiresAt: new Date(Date.now() + 3_600_000),
          },
        });
        const state = {
          id: "123456789",
          accountId: "act_123",
          name: "PG18 campaign",
          status: "ACTIVE",
        };
        const mutate = vi.fn(async () => {
          state.status = "PAUSED";
          return { providerAccepted: true };
        });
        const service = new McpPublicWriteService(
          { client: database.client } as never,
          { record: vi.fn(async () => undefined) } as never,
          {
            metaPermissions: vi.fn(async () => ({
              granted: ["ads_management"],
            })),
            readMetaControlledCampaign: vi.fn(async () => ({ ...state })),
            mutateCampaign: mutate,
          } as never,
        );
        const created = (await service.call(
          principal,
          "preview_pause_campaign",
          {
            account_id: "act_123",
            campaign_id: "123456789",
          },
        )) as Record<string, unknown>;
        const rawToken = created.preview_token as string;
        const nonce = new URL(created.approval_url as string).searchParams.get(
          "approval",
        )!;
        const persisted = await database.client.mcpPreview.findFirstOrThrow({
          where: { principalType: "OAUTH_USER", oauthClientId: clientId },
        });
        previewId = persisted.id;
        expect(persisted.serviceTokenId).toBeNull();
        expect(persisted.approvalTokenDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(
          (
            await service.approvalView(
              {
                kind: "human",
                userId: principal.userId,
                sessionId: "b0000000-0000-4000-8000-00000000000b",
              },
              nonce,
            )
          ).approved,
        ).toBe(false);
        await service.decideApproval(
          {
            kind: "human",
            userId: principal.userId,
            sessionId: "b0000000-0000-4000-8000-00000000000b",
          },
          nonce,
          "approve",
        );
        const calls = await Promise.allSettled([
          service.call(principal, "commit_confirmed_preview", {
            preview_token: rawToken,
          }),
          service.call(principal, "commit_confirmed_preview", {
            preview_token: rawToken,
          }),
        ]);
        expect(
          calls.filter((item) => item.status === "fulfilled"),
        ).toHaveLength(1);
        expect(mutate).toHaveBeenCalledTimes(1);
        const completed = await database.client.mcpPreview.findUniqueOrThrow({
          where: { id: previewId },
        });
        expect(completed.commitStatus).toBe("VERIFIED");
        expect(completed.approvedByUserId).toBe(principal.userId);
        expect(completed.consumedAt).not.toBeNull();

        const columns = await database.client.$queryRaw<
          Array<{ column_name: string; is_nullable: string }>
        >`
        SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'mcp_previews' AND column_name IN
          ('service_token_id', 'approval_token_digest', 'oauth_user_id')`;
        expect(columns).toEqual(
          expect.arrayContaining([
            { column_name: "service_token_id", is_nullable: "YES" },
            { column_name: "approval_token_digest", is_nullable: "YES" },
            { column_name: "oauth_user_id", is_nullable: "YES" },
          ]),
        );
        const constraints = await database.client.$queryRaw<
          Array<{ conname: string }>
        >`
        SELECT conname FROM pg_constraint WHERE conrelid = 'mcp_previews'::regclass`;
        const names = constraints.map((item) => item.conname);
        expect(names).toEqual(
          expect.arrayContaining([
            "mcp_previews_principal_check",
            "mcp_previews_service_token_id_fkey",
            "mcp_previews_oauth_user_id_fkey",
            "mcp_previews_oauth_client_id_fkey",
          ]),
        );
        const indexes = await database.client.$queryRaw<
          Array<{ indexname: string }>
        >`
        SELECT indexname FROM pg_indexes WHERE tablename = 'mcp_previews'`;
        expect(indexes.map((item) => item.indexname)).toContain(
          "mcp_previews_approval_token_digest_key",
        );
      } finally {
        if (previewId)
          await database.client.mcpPreview.deleteMany({
            where: { id: previewId },
          });
        if (clientId)
          await database.client.oAuthPublicClient.deleteMany({
            where: { id: clientId },
          });
        if (workspaceId)
          await database.client.workspace.deleteMany({
            where: { id: workspaceId },
          });
        if (userId)
          await database.client.user.deleteMany({ where: { id: userId } });
        await closeDatabase(database);
      }
    });
  },
);

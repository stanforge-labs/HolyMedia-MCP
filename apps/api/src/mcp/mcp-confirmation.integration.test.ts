import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DatabaseService } from "../infrastructure/database.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ServiceTokenService } from "../service-tokens/service-token.service.js";
import { McpPreviewService } from "./mcp-preview.service.js";
import { McpService } from "./mcp.service.js";
import { SECOND_META_APP_REVIEW as policy } from "./meta-app-review-write.policy.js";

const enabled =
  process.env.V2_INTEGRATION_TESTS === "true" &&
  Boolean(process.env.DATABASE_URL);

describe.skipIf(!enabled)(
  "MCP confirmation with real PostgreSQL JSONB and newly created keys",
  () => {
    const database = new DatabaseService();
    const audit = new AuditService(database);
    const tokens = new ServiceTokenService(database, audit);
    const suffix = randomUUID();
    let workspaceId = "";
    let userId = "";
    let accountId = "";

    beforeAll(async () => {
      vi.stubEnv("V2_META_APP_REVIEW_SECOND_RENAME_ENABLED", "true");
      vi.stubEnv("V2_PREVIEW_ONLY", "true");
      vi.stubEnv("V2_CONFIRMED_WRITE_ENABLED", "false");
      const user = await database.client.user.create({
        data: {
          email: `confirmation-${suffix}@example.test`,
          name: "Confirmation test",
          passwordHash: "test",
          status: "active",
        },
      });
      userId = user.id;
      const workspace = await database.client.workspace.create({
        data: {
          name: "Confirmation integration",
          slug: `confirmation-${suffix}`,
          accessStatus: "ACTIVE",
          memberships: { create: { userId, role: "OWNER" } },
        },
      });
      workspaceId = workspace.id;
      const connection = await database.client.providerConnection.create({
        data: {
          workspaceId,
          provider: "META_ADS",
          createdBy: userId,
          status: "CONNECTED",
        },
      });
      const account = await database.client.providerAccount.create({
        data: {
          workspaceId,
          provider: "META_ADS",
          connectionId: connection.id,
          externalAccountId: policy.accountId,
          displayName: "Fake upstream account",
          enabled: true,
        },
      });
      accountId = account.id;
    });

    afterAll(async () => {
      if (workspaceId)
        await database.client.workspace.delete({ where: { id: workspaceId } });
      if (userId)
        await database.client.user.deleteMany({ where: { id: userId } });
      await database.onModuleDestroy();
      vi.unstubAllEnvs();
    });

    it("normal key creation -> authenticated principal -> MCP preview -> concurrent local confirmation -> commit", async () => {
      const human = { kind: "human" as const, userId, sessionId: randomUUID() };
      const request = { headers: {}, ip: "127.0.0.1" };
      const key = await tokens.create(
        workspaceId,
        {
          name: "New controlled key",
          scopes: ["adforge:mcp:read", "adforge:mcp:write"],
        },
        human,
        request,
      );
      const principal = (await tokens.authenticate(key.token))!;
      expect(principal.accountIds).toEqual([accountId]);
      const state = {
        id: policy.campaignId,
        accountId: policy.accountId,
        name: "Live source C",
        status: "PAUSED",
        effectiveStatus: "PAUSED",
        objective: "OUTCOME_AWARENESS",
        dailyBudget: null,
        lifetimeBudget: null,
        buyingType: "AUCTION",
        startTime: null,
        stopTime: null,
      };
      const providers = {
        readMetaControlledCampaign: vi.fn(async () => ({ ...state })),
        mutateCampaign: vi.fn(async (_w, _c, _a, _id, _op, payload) => {
          state.name = payload.new_name;
          return { result: { providerAccepted: true } };
        }),
      };
      const previews = new McpPreviewService(
        database,
        audit,
        providers as never,
      );
      const mcp = new McpService(
        database,
        providers as never,
        {} as never,
        previews,
        {} as never,
        {} as never,
      );
      const preview = (await mcp.call(
        principal,
        "preview_change_campaign_name",
        {
          provider: "META_ADS",
          account_id: policy.accountId,
          campaign_id: policy.campaignId,
          new_name: "Safe new name D",
        },
      )) as { preview_token: string; preview_id: string };
      const otherKey = await tokens.create(
        workspaceId,
        {
          name: "Other key",
          scopes: ["adforge:mcp:read", "adforge:mcp:write"],
        },
        human,
        request,
      );
      await expect(
        mcp.call(
          (await tokens.authenticate(otherKey.token))!,
          "confirm_preview",
          { preview_token: preview.preview_token },
        ),
      ).rejects.toMatchObject({ code: "preview_not_found" });
      await expect(
        mcp.call(principal, "confirm_preview", {
          preview_token: preview.preview_token,
          provider: "META_ADS",
        }),
      ).rejects.toMatchObject({ code: "invalid_confirmation_arguments" });
      const results = await Promise.all([
        mcp.call(principal, "confirm_preview", {
          preview_token: preview.preview_token,
        }),
        mcp.call(principal, "confirm_preview", {
          preview_token: preview.preview_token,
        }),
      ]);
      for (const result of results)
        expect(result).toMatchObject({ status: "confirmed" });
      expect(providers.readMetaControlledCampaign).toHaveBeenCalledTimes(1);
      expect(providers.mutateCampaign).not.toHaveBeenCalled();
      const row = await database.client.mcpPreview.findFirstOrThrow({
        where: { workspaceId, serviceTokenId: principal.tokenId },
      });
      expect(row.confirmedAt).not.toBeNull();
      expect(row.consumedAt).toBeNull();
      expect(
        await database.client.auditEvent.count({
          where: { targetId: row.id, eventType: "mcp_preview_confirmed" },
        }),
      ).toBe(1);
      await expect(
        mcp.call(principal, "commit_meta_confirmed_write", {
          preview_token: preview.preview_token,
        }),
      ).resolves.toMatchObject({
        status: "committed",
        reread: { name: "Safe new name D", status: "PAUSED" },
      });
      expect(providers.mutateCampaign).toHaveBeenCalledTimes(1);
      await expect(
        mcp.call(principal, "confirm_preview", {
          preview_token: preview.preview_token,
        }),
      ).rejects.toMatchObject({ code: "preview_already_consumed" });
    });
  },
);

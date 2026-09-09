import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpPreviewService } from "./mcp-preview.service.js";
import { McpService } from "./mcp.service.js";
import { SECOND_META_APP_REVIEW as policy } from "./meta-app-review-write.policy.js";
afterEach(() => vi.unstubAllEnvs());
type Row = {
  id: string;
  workspaceId: string;
  serviceTokenId: string;
  provider: string;
  accountId: string;
  externalObjectId: string;
  operation: string;
  payload: Record<string, unknown>;
  diff: Record<string, unknown>;
  previewTokenDigest: string;
  expiresAt: Date;
  confirmedAt: Date | null;
  consumedAt: Date | null;
};
function fixture() {
  vi.stubEnv("V2_META_APP_REVIEW_SECOND_RENAME_ENABLED", "true");
  vi.stubEnv("V2_PREVIEW_ONLY", "true");
  vi.stubEnv("V2_CONFIRMED_WRITE_ENABLED", "false");
  const accountId = randomUUID();
  const principal = {
    kind: "service" as const,
    workspaceId: String(randomUUID()),
    tokenId: String(randomUUID()),
    serviceIdentityId: randomUUID(),
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    accountIds: [accountId] as string[],
  };
  const account = {
    id: accountId,
    connectionId: String(randomUUID()),
    workspaceId: principal.workspaceId,
    externalAccountId: policy.accountId,
    provider: "META_ADS",
  };
  const state = {
    id: policy.campaignId,
    accountId: policy.accountId,
    name: "Current reviewer name C",
    status: "PAUSED",
    effectiveStatus: "PAUSED",
    objective: "OUTCOME_AWARENESS",
    dailyBudget: null,
    lifetimeBudget: null,
    buyingType: "AUCTION",
    startTime: null,
    stopTime: null,
  };
  const rows: Row[] = [];
  const audit = { record: vi.fn(async () => undefined) };
  const providers = {
    readMetaControlledCampaign: vi.fn(async () => ({ ...state })),
    mutateCampaign: vi.fn(async (_w, _c, _a, _id, _op, payload) => {
      state.name = payload.new_name;
      return { result: { providerAccepted: true } };
    }),
  };
  const tokenLookup = vi.fn(async () => ({
    tokenPrefix: "hmst_redacted",
    scopes: [...principal.scopes],
    accountIds: [accountId],
  }));
  const database = {
    client: {
      serviceToken: { findFirst: tokenLookup },
      providerAccount: {
        findFirst: vi.fn(async ({ where }) =>
          where.workspaceId === account.workspaceId &&
          (!where.id || where.id.in.includes(accountId)) &&
          where.OR.some(
            (item: { id?: string; externalAccountId?: string }) =>
              item.id === account.id ||
              item.externalAccountId === account.externalAccountId,
          )
            ? account
            : null,
        ),
      },
      mcpPreview: {
        create: vi.fn(
          async ({
            data,
          }: {
            data: Omit<Row, "id" | "confirmedAt" | "consumedAt">;
          }) => {
            const row: Row = {
              ...data,
              id: randomUUID(),
              confirmedAt: null,
              consumedAt: null,
            };
            rows.push(row);
            return row;
          },
        ),
        findFirst: vi.fn(
          async ({ where }) =>
            rows.find(
              (row) =>
                row.workspaceId === where.workspaceId &&
                row.serviceTokenId === where.serviceTokenId &&
                row.previewTokenDigest === where.previewTokenDigest &&
                (!where.accountId ||
                  where.accountId.in.includes(row.accountId)),
            ) ?? null,
        ),
        update: vi.fn(async ({ where, data }) =>
          Object.assign(
            rows.find((row) => row.id === where.id)!,
            data,
          ),
        ),
        updateMany: vi.fn(async ({ where, data }) => {
          const row = rows.find(
            (row) =>
              row.id === where.id &&
              row.consumedAt === null &&
              (where.confirmedAt !== null || row.confirmedAt === null) &&
              (!where.expiresAt || row.expiresAt > where.expiresAt.gt),
          );
          if (!row) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        }),
      },
    },
  };
  const service = new McpPreviewService(
    database as never,
    audit as never,
    providers as never,
  );
  const input = {
    provider: "META_ADS" as const,
    accountId,
    objectId: String(policy.campaignId),
    operation: "change_name",
    payload: { new_name: " Reviewer new name D " },
  };
  const preview = () => service.create(principal, input);
  return {
    principal,
    account,
    state,
    rows,
    audit,
    providers,
    tokenLookup,
    database,
    service,
    input,
    preview,
  };
}
describe("reproducible controlled Meta rename", () => {
  it("passes the opaque token through the published sequential MCP contract without provider calls in confirm", async () => {
    const f = fixture();
    const mcp = new McpService(
      f.database as never,
      f.providers as never,
      {} as never,
      f.service,
      {} as never,
      {} as never,
    );
    const schema = mcp
      .tools()
      .find((tool) => tool.name === "confirm_preview")!.inputSchema;
    expect(schema).toMatchObject({
      additionalProperties: false,
      required: ["preview_token"],
      properties: {
        preview_token: {
          type: "string",
          pattern: "^hmpp_[A-Za-z0-9_-]{20,120}$",
        },
      },
    });
    const result = (await mcp.call(
      f.principal,
      "preview_change_campaign_name",
      {
        provider: "META_ADS",
        account_id: policy.accountId,
        campaign_id: policy.campaignId,
        new_name: "New safe reviewer name",
      },
    )) as { preview_token: string };
    expect(result.preview_token).toMatch(/^hmpp_[A-Za-z0-9_-]{20,120}$/);
    f.providers.readMetaControlledCampaign.mockRejectedValue(
      new Error("Provider unavailable"),
    );
    await expect(
      mcp.call(f.principal, "confirm_preview", {
        preview_token: result.preview_token,
        provider: "META_ADS",
      }),
    ).rejects.toMatchObject({ code: "invalid_confirmation_arguments" });
    await expect(
      mcp.call(f.principal, "confirm_preview", {
        preview_token: result.preview_token,
      }),
    ).resolves.toMatchObject({ status: "confirmed" });
    expect(f.providers.readMetaControlledCampaign).toHaveBeenCalledTimes(1);
    expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
  });
  it("confirms concurrently once and remains successful if ancillary audit fails", async () => {
    const f = fixture();
    const p = await f.preview();
    f.audit.record.mockClear();
    f.audit.record.mockRejectedValue(new Error("Audit unavailable"));
    const results = await Promise.all([
      f.service.confirm(f.principal, p.preview_token),
      f.service.confirm(f.principal, p.preview_token),
    ]);
    expect(results.map((r) => r.status)).toEqual(["confirmed", "confirmed"]);
    expect(f.audit.record).toHaveBeenCalledTimes(1);
    expect(f.rows[0]!.confirmedAt).not.toBeNull();
    expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
  });
  it("cannot confirm a preview consumed between lookup and conditional update", async () => {
    const f = fixture();
    const p = await f.preview();
    f.database.client.mcpPreview.updateMany.mockImplementationOnce(async () => {
      f.rows[0]!.consumedAt = new Date();
      return { count: 0 };
    });
    await expect(
      f.service.confirm(f.principal, p.preview_token),
    ).rejects.toMatchObject({ code: "preview_already_consumed" });
    expect(f.rows[0]!.confirmedAt).toBeNull();
    expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
  });
  it.each([
    "expired",
    "malformed",
    "consumed",
    "read-only",
    "foreign-workspace",
  ])("returns a local error for %s confirmation", async (kind) => {
    const f = fixture();
    const p = await f.preview();
    if (kind === "expired") f.rows[0]!.expiresAt = new Date(0);
    if (kind === "consumed") f.rows[0]!.consumedAt = new Date();
    if (kind === "read-only") f.principal.scopes = ["adforge:mcp:read"];
    if (kind === "foreign-workspace") f.principal.workspaceId = randomUUID();
    await expect(
      f.service.confirm(
        f.principal,
        kind === "malformed" ? f.rows[0]!.id : p.preview_token,
      ),
    ).rejects.toMatchObject({ code: expect.any(String) });
    expect(f.providers.readMetaControlledCampaign).toHaveBeenCalledTimes(1);
    expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
  });
  it("fresh token/workspace/connection IDs work with safe names and globals OFF", async () => {
    for (let i = 0; i < 2; i++) {
      const f = fixture();
      const p = await f.preview();
      expect(p.diff).toMatchObject({
        before: "Current reviewer name C",
        after: "Reviewer new name D",
        field: "name",
      });
      expect(p.confirmed_write_available).toBe(true);
      await f.service.confirm(f.principal, p.preview_token);
      await expect(
        f.service.commit(f.principal, p.preview_token),
      ).resolves.toMatchObject({
        status: "committed",
        reread: { name: "Reviewer new name D", status: "PAUSED" },
        previous_name: "Current reviewer name C",
        provider_write_result: { providerAccepted: true },
      });
      expect(f.providers.mutateCampaign).toHaveBeenCalledExactlyOnceWith(
        f.principal.workspaceId,
        f.account.connectionId,
        f.account.id,
        policy.campaignId,
        "change_name",
        { new_name: "Reviewer new name D" },
      );
      expect(f.providers.readMetaControlledCampaign).toHaveBeenCalledTimes(3);
      await expect(
        f.service.commit(f.principal, p.preview_token),
      ).rejects.toThrow();
      expect(f.providers.mutateCampaign).toHaveBeenCalledTimes(1);
    }
  });
  it.each([
    "read-only",
    "revoked",
    "foreign-workspace",
    "account-restricted",
    "ACTIVE",
    "unchanged",
  ])("blocks %s", async (kind) => {
    const f = fixture();
    if (kind === "read-only") f.principal.scopes = ["adforge:mcp:read"];
    if (kind === "revoked") f.tokenLookup.mockResolvedValue(null as never);
    if (kind === "foreign-workspace") f.principal.workspaceId = randomUUID();
    if (kind === "account-restricted") f.principal.accountIds = [randomUUID()];
    if (kind === "ACTIVE") f.state.status = "ACTIVE";
    if (kind === "unchanged") f.input.payload.new_name = f.state.name;
    await expect(f.preview()).rejects.toThrow();
    expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
  });
  it.each([
    "name",
    "status",
    "connection",
    "target",
    "expired",
    "missing-snapshot",
    "new-token",
    "new-workspace",
    "no-confirmation",
  ])("blocks changed %s at commit", async (kind) => {
    const f = fixture();
    const p = await f.preview();
    if (kind !== "no-confirmation")
      await f.service.confirm(f.principal, p.preview_token);
    if (kind === "name") f.state.name = "Concurrent edit";
    if (kind === "status") f.state.status = "ACTIVE";
    if (kind === "connection") f.account.connectionId = randomUUID();
    if (kind === "target") f.rows[0]!.payload.new_name = "Unconfirmed target";
    if (kind === "expired") f.rows[0]!.expiresAt = new Date(0);
    if (kind === "missing-snapshot") f.rows[0]!.diff = {};
    if (kind === "new-token") f.principal.tokenId = randomUUID();
    if (kind === "new-workspace") f.principal.workspaceId = randomUUID();
    await expect(
      f.service.commit(f.principal, p.preview_token),
    ).rejects.toThrow();
    expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
  });
  it.each([
    "update_campaign",
    "pause",
    "change_budget",
    "update_targeting",
    "configure_schedule",
    "update_adset",
    "update_ad",
    "create_creative",
  ])("generic %s cannot write", async (operation) => {
    const f = fixture();
    const p = await f.service.create(f.principal, {
      ...f.input,
      operation,
      payload: { new_name: "D", daily_budget: 2 },
    });
    f.rows[0]!.confirmedAt = new Date();
    await expect(
      f.service.commit(f.principal, p.preview_token),
    ).resolves.toMatchObject({ status: "blocked" });
    expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
  });
  it("rejects confirmation for a different token and modified target", async () => {
    const f = fixture();
    const p = await f.preview();
    await expect(
      f.service.confirm(
        { ...f.principal, tokenId: randomUUID() },
        p.preview_token,
      ),
    ).rejects.toThrow();
    f.rows[0]!.payload.new_name = "Changed";
    await expect(
      f.service.confirm(f.principal, p.preview_token),
    ).rejects.toThrow();
  });
  it.each(["wrong-account", "wrong-campaign", "extra-field"])(
    "blocks %s mutation",
    async (kind) => {
      const f = fixture();
      if (kind === "wrong-account")
        f.account.externalAccountId = "act_other" as typeof policy.accountId;
      if (kind === "wrong-campaign") f.input.objectId = "other";
      const p = await f.service.create(f.principal, {
        ...f.input,
        payload:
          kind === "extra-field"
            ? { new_name: "D", status: "ACTIVE" }
            : f.input.payload,
      });
      f.rows[0]!.confirmedAt = new Date();
      await expect(
        f.service.commit(f.principal, p.preview_token),
      ).resolves.toMatchObject({ status: "blocked" });
      expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
    },
  );
  it("requires active identity, user and membership in the database boundary", async () => {
    const f = fixture();
    await f.preview();
    expect(f.tokenLookup).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: f.principal.tokenId,
          revokedAt: null,
          serviceIdentity: expect.objectContaining({
            workspaceId: f.principal.workspaceId,
            revokedAt: null,
            workspace: { accessStatus: "ACTIVE" },
            createdBy: {
              status: "active",
              memberships: { some: { workspaceId: f.principal.workspaceId } },
            },
          }),
        }),
      }),
    );
  });
});

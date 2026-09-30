import { afterEach, describe, expect, it, vi } from "vitest";
import type { OAuthMcpPrincipal } from "./mcp-principal.js";
import { McpPublicWriteService } from "./mcp-public-write.service.js";

const previousFlag = process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED;
afterEach(() => {
  if (previousFlag === undefined)
    delete process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED;
  else process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED = previousFlag;
});

const principal: OAuthMcpPrincipal = {
  kind: "oauth",
  tokenId: "access-token-a",
  workspaceId: "workspace-a",
  userId: "user-a",
  clientId: "client-a",
  grantId: "grant-a",
  resource: "https://mcp.holymedia.kz/mcp/public",
  scopes: ["adforge:mcp:read", "adforge:mcp:write"],
  accountIds: [],
  resourceAccessMode: "ALL_CONNECTED",
};

type Row = Record<string, unknown> & {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
  consumedAt: Date | null;
};

function fixture(enabled = false, initialStatus = "ACTIVE") {
  process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED = String(enabled);
  let row: Row | null = null;
  const state = {
    id: "123456789",
    accountId: "act_123",
    name: "Original",
    status: initialStatus,
  };
  const auditEvents: Array<Record<string, unknown>> = [];
  const account = {
    id: "11111111-1111-4111-8111-111111111111",
    connectionId: "connection-a",
    externalAccountId: "act_123",
    provider: "META_ADS",
    enabled: true,
  };
  const db = {
    client: {
      providerAccount: {
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            if (
              where.workspaceId !== principal.workspaceId ||
              where.provider !== "META_ADS"
            )
              return null;
            const candidates = where.OR as Array<Record<string, string>>;
            return candidates.some(
              (item) =>
                item.id === account.id ||
                item.externalAccountId === account.externalAccountId,
            )
              ? account
              : null;
          },
        ),
      },
      mcpPreview: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          row = {
            id: "preview-a",
            createdAt: new Date(),
            confirmedAt: null,
            consumedAt: null,
            ...data,
          } as Row;
          return row;
        }),
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            if (!row) return null;
            return Object.entries(where).every(
              ([key, value]) => row![key] === value,
            )
              ? row
              : null;
          },
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            if (!row || row.id !== where.id || row.consumedAt !== null)
              return { count: 0 };
            if (where.confirmedAt === null && row.confirmedAt)
              return { count: 0 };
            if (
              where.confirmedAt !== null &&
              typeof where.confirmedAt === "object" &&
              !row.confirmedAt
            )
              return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          },
        ),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          Object.assign(row!, data);
          return row;
        }),
      },
    },
  };
  const providers = {
    metaPermissions: vi.fn(async () => ({
      granted: ["ads_management"],
      missing: [] as string[],
    })),
    readMetaControlledCampaign: vi.fn(async () => ({ ...state })),
    mutateCampaign: vi.fn(
      async (
        _workspaceId: string,
        _connectionId: string,
        _accountId: string,
        _campaignId: string,
        operation: string,
        payload: Record<string, unknown>,
      ) => {
        if (operation === "change_name") state.name = String(payload.new_name);
        else state.status = operation === "pause" ? "PAUSED" : "ACTIVE";
        return {
          result: { externalObjectId: state.id, providerAccepted: true },
          reread: { ...state },
        };
      },
    ),
  };
  const audit = {
    record: vi.fn(async (input: Record<string, unknown>) => {
      auditEvents.push(input);
    }),
  };
  const service = new McpPublicWriteService(
    db as never,
    audit as never,
    providers as never,
  );
  return {
    service,
    db,
    providers,
    auditEvents,
    state,
    account,
    get row() {
      return row!;
    },
  };
}

async function preview(
  test: ReturnType<typeof fixture>,
  tool = "preview_change_campaign_name",
  args: Record<string, unknown> = {
    account_id: "act_123",
    campaign_id: "123456789",
    new_name: "Updated",
  },
) {
  return test.service.call(principal, tool, args) as Promise<
    Record<string, unknown>
  >;
}

describe("public Meta controlled writes (mock provider only)", () => {
  it("stores an OAuth grant-bound live snapshot and requested change, without provider write", async () => {
    const test = fixture();
    const result = await preview(test);
    expect(result).toMatchObject({
      status: "preview",
      operation: "META_CAMPAIGN_RENAME",
      before: { name: "Original", status: "ACTIVE" },
      requested: { name: "Updated" },
      commit_status: "PREVIEWED",
      provider_write_enabled: false,
    });
    expect(test.row).toMatchObject({
      principalType: "OAUTH_USER",
      oauthUserId: "user-a",
      oauthClientId: "client-a",
      oauthGrantId: "grant-a",
      workspaceId: "workspace-a",
      connectionId: "connection-a",
      accountId: "11111111-1111-4111-8111-111111111111",
      externalObjectId: "123456789",
      beforeState: { name: "Original", status: "ACTIVE" },
      requestedState: { name: "Updated" },
    });
    expect(test.row.snapshotDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(test.row.serviceTokenId).toBeUndefined();
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
    expect(test.auditEvents[0]).toMatchObject({
      eventType: "mcp_public_preview_created",
      actorUserId: "user-a",
      workspaceId: "workspace-a",
    });
  });

  it("requires write scope at preview, confirm and commit", async () => {
    const test = fixture(true);
    const result = await preview(test);
    const token = result.preview_token as string;
    const readOnly = { ...principal, scopes: ["adforge:mcp:read"] };
    for (const [tool, args] of [
      [
        "preview_pause_campaign",
        { account_id: "act_123", campaign_id: "123456789" },
      ],
      ["confirm_preview", { preview_token: token }],
      ["commit_confirmed_preview", { preview_token: token }],
    ] as const) {
      await expect(
        test.service.call(readOnly, tool, args),
      ).rejects.toMatchObject({ code: "write_scope_required" });
    }
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("enforces user, workspace, OAuth client and grant ownership after token rotation", async () => {
    const test = fixture();
    const token = (await preview(test)).preview_token as string;
    for (const override of [
      { userId: "user-b" },
      { workspaceId: "workspace-b" },
      { clientId: "client-b" },
      { grantId: "grant-b" },
    ]) {
      await expect(
        test.service.call({ ...principal, ...override }, "confirm_preview", {
          preview_token: token,
        }),
      ).rejects.toMatchObject({ code: "preview_not_found" });
    }
    const confirmed = (await test.service.call(
      { ...principal, tokenId: "new-access-token-after-refresh" },
      "confirm_preview",
      { preview_token: token },
    )) as Record<string, unknown>;
    expect(confirmed.status).toBe("confirmed");
    expect(
      (
        (await test.service.call(principal, "confirm_preview", {
          preview_token: token,
        })) as Record<string, unknown>
      ).confirmed_at,
    ).toBe(confirmed.confirmed_at);
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("enforces expiry, confirmation and provider permission before mutation", async () => {
    const test = fixture(true);
    const token = (await preview(test)).preview_token as string;
    await expect(
      test.service.call(principal, "commit_confirmed_preview", {
        preview_token: token,
      }),
    ).rejects.toMatchObject({ code: "preview_not_confirmed" });
    test.row.expiresAt = new Date(Date.now() - 1);
    await expect(
      test.service.call(principal, "confirm_preview", { preview_token: token }),
    ).rejects.toMatchObject({ code: "preview_expired" });
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("enforces active account, campaign ownership and ads_management", async () => {
    const test = fixture(true);
    test.providers.metaPermissions.mockResolvedValueOnce({
      granted: [],
      missing: ["ads_management"],
    });
    await expect(preview(test)).rejects.toThrow("ads_management");
    expect(test.db.client.mcpPreview.create).not.toHaveBeenCalled();

    test.providers.readMetaControlledCampaign.mockResolvedValueOnce({
      ...test.state,
      accountId: "act_other",
    });
    await expect(preview(test)).rejects.toThrow("Campaign/account mismatch");
    expect(test.db.client.mcpPreview.create).not.toHaveBeenCalled();

    await expect(
      preview(test, "preview_pause_campaign", {
        account_id: "act_other",
        campaign_id: "123456789",
      }),
    ).rejects.toThrow("Meta account is not available");
    test.db.client.providerAccount.findFirst.mockResolvedValueOnce(null);
    await expect(preview(test)).rejects.toThrow(
      "Meta account is not available",
    );
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("rejects provider substitution, extra mutation fields and token parameter swapping", async () => {
    const test = fixture(true);
    await expect(
      preview(test, "preview_change_campaign_name", {
        account_id: "act_123",
        campaign_id: "123456789",
        new_name: "Updated",
        provider: "GOOGLE_ADS",
      }),
    ).rejects.toMatchObject({ code: "public_operation_not_available" });
    const token = (await preview(test)).preview_token as string;
    await expect(
      test.service.call(principal, "confirm_preview", {
        preview_token: token,
        new_name: "Swap",
      }),
    ).rejects.toMatchObject({ code: "invalid_confirmation_arguments" });
    await expect(
      test.service.call(principal, "commit_confirmed_preview", {
        preview_token: token,
        campaign_id: "other",
      }),
    ).rejects.toMatchObject({ code: "invalid_confirmation_arguments" });
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("keeps provider mutation blocked by the public flag even after confirmation", async () => {
    const test = fixture(false);
    const token = (await preview(test)).preview_token as string;
    await test.service.call(principal, "confirm_preview", {
      preview_token: token,
    });
    await expect(
      test.service.call(principal, "commit_confirmed_preview", {
        preview_token: token,
      }),
    ).rejects.toMatchObject({ code: "public_write_disabled" });
    expect(test.row.consumedAt).toBeNull();
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("rejects stale snapshot without sending a provider mutation", async () => {
    const test = fixture(true);
    const token = (await preview(test)).preview_token as string;
    await test.service.call(principal, "confirm_preview", {
      preview_token: token,
    });
    test.state.name = "Changed elsewhere";
    await expect(
      test.service.call(principal, "commit_confirmed_preview", {
        preview_token: token,
      }),
    ).rejects.toMatchObject({ code: "preview_stale" });
    expect(test.row.commitStatus).toBe("PREVIEW_STALE");
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it.each([
    [
      "preview_change_campaign_name",
      "ACTIVE",
      { account_id: "act_123", campaign_id: "123456789", new_name: "Updated" },
      "change_name",
      { new_name: "Updated" },
      "META_CAMPAIGN_RENAME",
    ],
    [
      "preview_pause_campaign",
      "ACTIVE",
      { account_id: "act_123", campaign_id: "123456789" },
      "pause",
      {},
      "META_CAMPAIGN_PAUSE",
    ],
    [
      "preview_resume_campaign",
      "PAUSED",
      { account_id: "act_123", campaign_id: "123456789" },
      "resume",
      {},
      "META_CAMPAIGN_RESUME",
    ],
  ] as const)(
    "commits %s with only its minimal payload and direct verification",
    async (tool, initial, args, adapterOperation, payload, operation) => {
      const test = fixture(true, initial);
      const token = (await preview(test, tool, args)).preview_token as string;
      await test.service.call(principal, "confirm_preview", {
        preview_token: token,
      });
      const result = (await test.service.call(
        principal,
        "commit_confirmed_preview",
        { preview_token: token },
      )) as Record<string, unknown>;
      expect(result).toMatchObject({
        status: "VERIFIED",
        verified: true,
        operation,
      });
      expect(test.providers.mutateCampaign).toHaveBeenCalledTimes(1);
      expect(test.providers.mutateCampaign).toHaveBeenCalledWith(
        "workspace-a",
        "connection-a",
        "11111111-1111-4111-8111-111111111111",
        "123456789",
        adapterOperation,
        payload,
      );
      expect(test.providers.readMetaControlledCampaign).toHaveBeenCalledTimes(
        3,
      );
      expect(test.row).toMatchObject({
        commitStatus: "VERIFIED",
        providerResult: expect.any(Object),
        verificationRead: expect.any(Object),
      });
      await expect(
        test.service.call(principal, "commit_confirmed_preview", {
          preview_token: token,
        }),
      ).rejects.toMatchObject({ code: "preview_already_consumed" });
      expect(test.providers.mutateCampaign).toHaveBeenCalledTimes(1);
    },
  );

  it("verifies a lost provider response by read-back, without a retry", async () => {
    const test = fixture(true);
    test.providers.mutateCampaign.mockImplementationOnce(async () => {
      test.state.name = "Updated";
      throw new Error("network response lost");
    });
    const token = (await preview(test)).preview_token as string;
    await test.service.call(principal, "confirm_preview", {
      preview_token: token,
    });
    const result = (await test.service.call(
      principal,
      "commit_confirmed_preview",
      { preview_token: token },
    )) as Record<string, unknown>;
    expect(result.status).toBe("VERIFIED");
    expect(test.providers.mutateCampaign).toHaveBeenCalledTimes(1);
  });

  it("does not call an unverified response VERIFIED", async () => {
    const test = fixture(true);
    test.providers.mutateCampaign.mockResolvedValueOnce({
      result: { externalObjectId: "123456789", providerAccepted: true },
      reread: null as never,
    });
    const token = (await preview(test)).preview_token as string;
    await test.service.call(principal, "confirm_preview", {
      preview_token: token,
    });
    await expect(
      test.service.call(principal, "commit_confirmed_preview", {
        preview_token: token,
      }),
    ).rejects.toMatchObject({ code: "verification_mismatch" });
    expect(test.row.commitStatus).toBe("NOT_VERIFIED");
  });

  it("returns a typed uncertain outcome if read-back cannot determine the result", async () => {
    const test = fixture(true);
    test.providers.mutateCampaign.mockRejectedValueOnce(
      new Error("connection reset"),
    );
    const token = (await preview(test)).preview_token as string;
    await test.service.call(principal, "confirm_preview", {
      preview_token: token,
    });
    test.providers.readMetaControlledCampaign.mockImplementationOnce(
      async () => ({ ...test.state }),
    );
    test.providers.readMetaControlledCampaign.mockRejectedValueOnce(
      new Error("read-back unavailable"),
    );
    await expect(
      test.service.call(principal, "commit_confirmed_preview", {
        preview_token: token,
      }),
    ).rejects.toMatchObject({ code: "provider_outcome_uncertain" });
    expect(test.row.commitStatus).toBe("UNCERTAIN_OUTCOME");
    expect(test.providers.mutateCampaign).toHaveBeenCalledTimes(1);
  });
});

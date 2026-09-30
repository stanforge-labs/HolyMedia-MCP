import { afterEach, describe, expect, it, vi } from "vitest";
import type { HumanPrincipal } from "../auth/auth.types.js";
import type { OAuthMcpPrincipal } from "./mcp-principal.js";
import { McpPublicWriteService } from "./mcp-public-write.service.js";

const oldCommitFlag = process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED;
const oldScopeFlag = process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED;
afterEach(() => {
  if (oldCommitFlag === undefined)
    delete process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED;
  else process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED = oldCommitFlag;
  if (oldScopeFlag === undefined)
    delete process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED;
  else process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = oldScopeFlag;
});

const principal: OAuthMcpPrincipal = {
  kind: "oauth",
  tokenId: "access-a",
  workspaceId: "workspace-a",
  userId: "user-a",
  clientId: "client-a",
  grantId: "grant-a",
  resource: "https://mcp.holymedia.kz/mcp/public",
  scopes: ["adforge:mcp:read", "adforge:mcp:write"],
  accountIds: [],
  resourceAccessMode: "ALL_CONNECTED",
};
const human: HumanPrincipal = {
  kind: "human",
  userId: "user-a",
  sessionId: "session-a",
};

type Row = Record<string, unknown> & {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  confirmedAt: Date | null;
  approvedByUserId: string | null;
  approvalSessionId: string | null;
  cancelledAt: Date | null;
  consumedAt: Date | null;
};

function matches(row: Row, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => {
    const actual = row[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const condition = value as Record<string, unknown>;
      if ("gt" in condition)
        return actual instanceof Date && actual > (condition.gt as Date);
      if ("not" in condition) return actual !== condition.not;
    }
    return actual === value;
  });
}

function fixture(commitEnabled = false, initialStatus = "ACTIVE") {
  process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED = "true";
  process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED = String(commitEnabled);
  let row: Row | null = null;
  let grantActive = true;
  let memberActive = true;
  const state = {
    id: "123456789",
    accountId: "act_123",
    name: "Original",
    status: initialStatus,
  };
  const account = {
    id: "11111111-1111-4111-8111-111111111111",
    connectionId: "connection-a",
    workspaceId: "workspace-a",
    externalAccountId: "act_123",
    displayName: "Ad account",
    provider: "META_ADS",
    enabled: true,
  };
  const auditEvents: Array<Record<string, unknown>> = [];
  const db = {
    client: {
      providerAccount: {
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) => {
            if (
              where.workspaceId !== account.workspaceId ||
              where.provider !== "META_ADS"
            )
              return null;
            if (where.id)
              return where.id === account.id &&
                where.connectionId === account.connectionId
                ? account
                : null;
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
      workspaceMembership: {
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            memberActive &&
            where.userId === human.userId &&
            where.workspaceId === principal.workspaceId
              ? { id: "membership-a" }
              : null,
        ),
      },
      oAuthRefreshToken: {
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            grantActive &&
            where.familyId === principal.grantId &&
            where.userId === principal.userId &&
            where.workspaceId === principal.workspaceId &&
            where.clientId === principal.clientId &&
            where.resource === principal.resource
              ? { scope: "adforge:mcp:read adforge:mcp:write" }
              : null,
        ),
      },
      mcpPreview: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          row = {
            id: "preview-a",
            createdAt: new Date(),
            confirmedAt: null,
            approvedByUserId: null,
            approvalSessionId: null,
            cancelledAt: null,
            consumedAt: null,
            ...data,
          } as Row;
          return row;
        }),
        findFirst: vi.fn(
          async ({ where }: { where: Record<string, unknown> }) =>
            row && matches(row, where) ? row : null,
        ),
        updateMany: vi.fn(
          async ({
            where,
            data,
          }: {
            where: Record<string, unknown>;
            data: Record<string, unknown>;
          }) => {
            if (!row || !matches(row, where)) return { count: 0 };
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
        return { result: { providerAccepted: true } };
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
    setGrantActive(value: boolean) {
      grantActive = value;
    },
    setMemberActive(value: boolean) {
      memberActive = value;
    },
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
function nonce(result: Record<string, unknown>): string {
  return new URL(result.approval_url as string).searchParams.get("approval")!;
}
async function approve(
  test: ReturnType<typeof fixture>,
  result: Record<string, unknown>,
) {
  return test.service.decideApproval(human, nonce(result), "approve");
}
async function commit(
  test: ReturnType<typeof fixture>,
  result: Record<string, unknown>,
) {
  return test.service.call(principal, "commit_confirmed_preview", {
    preview_token: result.preview_token,
  }) as Promise<Record<string, unknown>>;
}

describe("public Meta controlled writes (mock provider only)", () => {
  it("creates separate high-entropy digests and an approval URL without provider mutation", async () => {
    const test = fixture();
    const result = await preview(test);
    expect(result).toMatchObject({
      status: "preview",
      operation: "META_CAMPAIGN_RENAME",
      before: { name: "Original", status: "ACTIVE" },
      requested: { name: "Updated" },
      provider_mutation_sent: false,
    });
    expect(result.approval_url).toMatch(
      /^https?:\/\/.+\/mcp\/approve\?approval=hmap_/,
    );
    expect(result.preview_token).toMatch(/^hmpp_/);
    expect(test.row).toMatchObject({
      principalType: "OAUTH_USER",
      oauthUserId: "user-a",
      oauthClientId: "client-a",
      oauthGrantId: "grant-a",
      workspaceId: "workspace-a",
      connectionId: "connection-a",
      accountId: test.account.id,
      beforeState: { name: "Original", status: "ACTIVE" },
      requestedState: { name: "Updated" },
      confirmedAt: null,
    });
    expect(test.row.previewTokenDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(test.row.approvalTokenDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(test.row.previewTokenDigest).not.toBe(test.row.approvalTokenDigest);
    expect(JSON.stringify(test.row)).not.toContain(nonce(result));
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("removes MCP confirmation and requires write scope", async () => {
    const test = fixture(true);
    const result = await preview(test);
    await expect(
      test.service.call(principal, "confirm_preview", {
        preview_token: result.preview_token,
      }),
    ).rejects.toMatchObject({ code: "public_operation_not_available" });
    const readOnly = { ...principal, scopes: ["adforge:mcp:read"] };
    await expect(
      test.service.call(readOnly, "preview_pause_campaign", {
        account_id: "act_123",
        campaign_id: "123456789",
      }),
    ).rejects.toMatchObject({ code: "write_scope_required" });
    await approve(test, result);
    await expect(
      test.service.call(readOnly, "commit_confirmed_preview", {
        preview_token: result.preview_token,
      }),
    ).rejects.toMatchObject({ code: "write_scope_required" });
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("requires matching human, workspace, OAuth grant and resource; GET is display-only", async () => {
    const test = fixture(true);
    const result = await preview(test);
    const token = nonce(result);
    expect(await test.service.approvalView(human, token)).toMatchObject({
      campaign: "Original",
      before: "Original",
      after: "Updated",
      approved: false,
    });
    expect(test.row.confirmedAt).toBeNull();
    await expect(
      test.service.approvalView({ ...human, userId: "user-b" }, token),
    ).rejects.toMatchObject({ code: "approval_not_found" });
    test.row.workspaceId = "workspace-b";
    await expect(test.service.approvalView(human, token)).rejects.toMatchObject(
      {
        code: "approval_not_found",
      },
    );
    test.row.workspaceId = "workspace-a";
    test.setMemberActive(false);
    await expect(test.service.approvalView(human, token)).rejects.toMatchObject(
      { code: "approval_not_found" },
    );
    test.setMemberActive(true);
    test.setGrantActive(false);
    await expect(
      test.service.decideApproval(human, token, "approve"),
    ).rejects.toMatchObject({ code: "approval_not_found" });
    test.setGrantActive(true);
    await expect(
      test.service.approvalView(human, `hmap_${"x".repeat(43)}`),
    ).rejects.toMatchObject({ code: "approval_not_found" });
    await expect(commit(test, result)).rejects.toMatchObject({
      code: "preview_not_confirmed",
    });
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("binds approval to web session and denies token or parameter swapping", async () => {
    const test = fixture(true);
    const result = await preview(test);
    await expect(
      test.service.decideApproval(
        human,
        result.preview_token as string,
        "approve",
      ),
    ).rejects.toMatchObject({ code: "approval_not_found" });
    await approve(test, result);
    expect(test.row).toMatchObject({
      approvedByUserId: human.userId,
      approvalSessionId: human.sessionId,
      commitStatus: "CONFIRMED",
    });
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
    await expect(
      test.service.decideApproval(human, nonce(result), "approve"),
    ).rejects.toMatchObject({ code: "preview_already_confirmed" });
    await expect(
      test.service.call(principal, "commit_confirmed_preview", {
        preview_token: result.preview_token,
        new_name: "Swap",
      }),
    ).rejects.toMatchObject({ code: "invalid_confirmation_arguments" });
  });

  it("denies forged preview token, expiry, cancellation and old MCP confirmation rows", async () => {
    const test = fixture(true);
    const result = await preview(test);
    await expect(
      test.service.call(principal, "commit_confirmed_preview", {
        preview_token: `hmpp_${"x".repeat(43)}`,
      }),
    ).rejects.toMatchObject({ code: "preview_not_found" });
    test.row.confirmedAt = new Date();
    await expect(commit(test, result)).rejects.toMatchObject({
      code: "preview_not_confirmed",
    });
    test.row.confirmedAt = null;
    await test.service.decideApproval(human, nonce(result), "cancel");
    expect(test.row.commitStatus).toBe("CANCELLED");
    await expect(commit(test, result)).rejects.toMatchObject({
      code: "preview_cancelled",
    });
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
    const second = await preview(test);
    test.row.expiresAt = new Date(Date.now() - 1);
    await expect(
      test.service.decideApproval(human, nonce(second), "approve"),
    ).rejects.toMatchObject({ code: "preview_expired" });
  });

  it("keeps provider commit blocked by the independent flag after web approval", async () => {
    const test = fixture(false);
    const result = await preview(test);
    await approve(test, result);
    await expect(commit(test, result)).rejects.toMatchObject({
      code: "public_write_disabled",
    });
    expect(test.row.consumedAt).toBeNull();
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("enforces active account, campaign identity and ads_management", async () => {
    const test = fixture(true);
    test.providers.metaPermissions.mockResolvedValueOnce({
      granted: [],
      missing: ["ads_management"],
    });
    await expect(preview(test)).rejects.toThrow("ads_management");
    test.providers.readMetaControlledCampaign.mockResolvedValueOnce({
      ...test.state,
      accountId: "act_other",
    });
    await expect(preview(test)).rejects.toThrow("Campaign/account mismatch");
    await expect(
      preview(test, "preview_pause_campaign", {
        account_id: "act_other",
        campaign_id: "123456789",
      }),
    ).rejects.toThrow("Meta account is not available");
    expect(test.providers.mutateCampaign).not.toHaveBeenCalled();
  });

  it("rejects extra preview mutation fields", async () => {
    const test = fixture(true);
    await expect(
      preview(test, "preview_change_campaign_name", {
        account_id: "act_123",
        campaign_id: "123456789",
        new_name: "Updated",
        provider: "GOOGLE_ADS",
      }),
    ).rejects.toMatchObject({ code: "public_operation_not_available" });
  });

  it.each([
    [
      "preview_change_campaign_name",
      "ACTIVE",
      { account_id: "act_123", campaign_id: "123456789", new_name: "Updated" },
      "status",
      "name",
    ],
    [
      "preview_pause_campaign",
      "ACTIVE",
      { account_id: "act_123", campaign_id: "123456789" },
      "name",
      "status",
    ],
    [
      "preview_resume_campaign",
      "PAUSED",
      { account_id: "act_123", campaign_id: "123456789" },
      "name",
      "status",
    ],
  ] as const)(
    "uses operation-specific snapshot for %s",
    async (tool, initial, args, irrelevant, relevant) => {
      const ok = fixture(true, initial);
      const result = await preview(ok, tool, args);
      await approve(ok, result);
      if (irrelevant === "name") ok.state.name = "Renamed elsewhere";
      else ok.state.status = "PAUSED";
      await commit(ok, result);
      expect(ok.providers.mutateCampaign).toHaveBeenCalledTimes(1);

      const stale = fixture(true, initial);
      const next = await preview(stale, tool, args);
      await approve(stale, next);
      if (relevant === "name") stale.state.name = "Renamed elsewhere";
      else stale.state.status = initial === "ACTIVE" ? "PAUSED" : "ACTIVE";
      await expect(commit(stale, next)).rejects.toMatchObject({
        code: "preview_stale",
      });
      expect(stale.row.commitStatus).toBe("PREVIEW_STALE");
      expect(stale.providers.mutateCampaign).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "preview_change_campaign_name",
      "ACTIVE",
      { account_id: "act_123", campaign_id: "123456789", new_name: "Updated" },
      "change_name",
      { new_name: "Updated" },
    ],
    [
      "preview_pause_campaign",
      "ACTIVE",
      { account_id: "act_123", campaign_id: "123456789" },
      "pause",
      {},
    ],
    [
      "preview_resume_campaign",
      "PAUSED",
      { account_id: "act_123", campaign_id: "123456789" },
      "resume",
      {},
    ],
  ] as const)(
    "commits %s with minimal payload and direct verification",
    async (tool, initial, args, adapterOperation, payload) => {
      const test = fixture(true, initial);
      const result = await preview(test, tool, args);
      await approve(test, result);
      expect(await commit(test, result)).toMatchObject({
        status: "VERIFIED",
        verified: true,
      });
      expect(test.providers.mutateCampaign).toHaveBeenCalledExactlyOnceWith(
        "workspace-a",
        "connection-a",
        test.account.id,
        "123456789",
        adapterOperation,
        payload,
      );
      expect(test.providers.readMetaControlledCampaign).toHaveBeenCalledTimes(
        3,
      );
      await expect(commit(test, result)).rejects.toMatchObject({
        code: "preview_already_consumed",
      });
    },
  );

  it("atomically claims parallel commits and mutates at most once", async () => {
    const test = fixture(true);
    const result = await preview(test);
    await approve(test, result);
    const outcomes = await Promise.allSettled([
      commit(test, result),
      commit(test, result),
    ]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(test.providers.mutateCampaign).toHaveBeenCalledTimes(1);
  });

  it("does not retry provider failure before mutation", async () => {
    const test = fixture(true);
    const result = await preview(test);
    await approve(test, result);
    test.providers.mutateCampaign.mockRejectedValueOnce(
      new Error("provider rejected request"),
    );
    await expect(commit(test, result)).rejects.toMatchObject({
      code: "verification_mismatch",
    });
    expect(test.row.commitStatus).toBe("NOT_VERIFIED");
    await expect(commit(test, result)).rejects.toMatchObject({
      code: "preview_already_consumed",
    });
    expect(test.providers.mutateCampaign).toHaveBeenCalledTimes(1);
  });

  it("verifies a lost response by read-back without retry", async () => {
    const test = fixture(true);
    const result = await preview(test);
    await approve(test, result);
    test.providers.mutateCampaign.mockImplementationOnce(async () => {
      test.state.name = "Updated";
      throw new Error("response lost");
    });
    expect(await commit(test, result)).toMatchObject({ status: "VERIFIED" });
    expect(test.providers.mutateCampaign).toHaveBeenCalledTimes(1);
  });

  it("keeps uncertain state after successful mutation and failed read-back", async () => {
    const test = fixture(true);
    const result = await preview(test);
    await approve(test, result);
    test.providers.readMetaControlledCampaign.mockResolvedValueOnce({
      ...test.state,
    });
    test.providers.readMetaControlledCampaign.mockRejectedValueOnce(
      new Error("read failed"),
    );
    await expect(commit(test, result)).rejects.toMatchObject({
      code: "provider_outcome_uncertain",
    });
    expect(test.row.commitStatus).toBe("UNCERTAIN_OUTCOME");
    expect(test.providers.mutateCampaign).toHaveBeenCalledTimes(1);
    expect(
      test.auditEvents.some(
        (event) => event.eventType === "mcp_public_commit_finalized",
      ),
    ).toBe(true);
  });

  it("never verifies a mismatched successful provider response", async () => {
    const test = fixture(true);
    const result = await preview(test);
    await approve(test, result);
    test.providers.mutateCampaign.mockResolvedValueOnce({
      result: { providerAccepted: true },
    });
    await expect(commit(test, result)).rejects.toMatchObject({
      code: "verification_mismatch",
    });
    expect(test.row.commitStatus).toBe("NOT_VERIFIED");
  });
});

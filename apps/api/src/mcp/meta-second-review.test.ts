import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { McpPreviewService } from "./mcp-preview.service.js";
import {
  evaluateMetaAppReviewRenamePolicy,
  SECOND_META_APP_REVIEW as policy,
} from "./meta-app-review-write.policy.js";

afterEach(() => vi.unstubAllEnvs());

function fixture(status = "PAUSED", newName = " Video name ") {
  vi.stubEnv("V2_META_APP_REVIEW_SECOND_RENAME_ENABLED", "true");
  vi.stubEnv("V2_PREVIEW_ONLY", "true");
  vi.stubEnv("V2_CONFIRMED_WRITE_ENABLED", "false");
  const principal = {
    kind: "service" as const,
    workspaceId: String(policy.workspaceId),
    tokenId: "ppc-token",
    serviceIdentityId: "ppc-identity",
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    accountIds: ["account-id"],
  };
  const preview = {
    id: "preview-id",
    provider: "META_ADS",
    operation: "change_name",
    externalObjectId: policy.campaignId,
    accountId: "account-id",
    payload: { new_name: newName },
    expiresAt: new Date(Date.now() + 60000),
    confirmedAt: new Date(),
    consumedAt: null,
  };
  const account = {
    id: "account-id",
    connectionId: "connection-id",
    provider: "META_ADS",
    externalAccountId: policy.accountId,
  };
  const before = {
    id: policy.campaignId,
    accountId: policy.accountId,
    name: "New Awareness Campaign",
    status,
    effectiveStatus: status,
    objective: "OUTCOME_AWARENESS",
    dailyBudget: null,
    lifetimeBudget: null,
    buyingType: "AUCTION",
    startTime: null,
    stopTime: null,
  };
  const audit = { record: vi.fn(async () => undefined) };
  const providers = {
    readMetaControlledCampaign: vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValue({ ...before, name: newName.trim() }),
    mutateCampaign: vi.fn(async () => ({ result: { providerAccepted: true } })),
  };
  const database = {
    client: {
      providerAccount: {
        findFirst: vi.fn(async ({ where }) =>
          where.workspaceId === policy.workspaceId &&
          where.id?.in.includes(account.id)
            ? account
            : null,
        ),
      },
      mcpPreview: {
        findFirst: vi.fn(async ({ where }) =>
          where.workspaceId === policy.workspaceId &&
          where.accountId?.in.includes(account.id)
            ? preview
            : null,
        ),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
    },
  };
  const service = new McpPreviewService(
    database as never,
    audit as never,
    providers as never,
  );
  return { principal, preview, account, audit, providers, service };
}

describe("second controlled Meta campaign", () => {
  it("commits only the trimmed name with global writes OFF and verifies invariants", async () => {
    const f = fixture();
    await expect(
      f.service.commit(f.principal, "hmpp_abcdefghijklmnopqrstuvwx"),
    ).resolves.toMatchObject({
      status: "committed",
      reread: { name: "Video name", status: "PAUSED" },
    });
    expect(f.providers.mutateCampaign).toHaveBeenCalledExactlyOnceWith(
      policy.workspaceId,
      "connection-id",
      "account-id",
      policy.campaignId,
      "change_name",
      { new_name: "Video name" },
    );
    expect(f.providers.readMetaControlledCampaign).toHaveBeenCalledTimes(2);
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "meta_app_review_rename_completed",
        metadata: expect.objectContaining({
          serviceTokenId: "ppc-token",
          postWriteVerified: true,
          invariantChangedFields: "",
        }),
      }),
    );
  });
  it.each(["read-only", "foreign-workspace", "foreign-account"])(
    "denies %s before provider mutation",
    async (kind) => {
      const f = fixture();
      if (kind === "read-only") f.principal.scopes = ["adforge:mcp:read"];
      if (kind === "foreign-workspace") f.principal.workspaceId = "foreign";
      if (kind === "foreign-account") f.principal.accountIds = ["foreign"];
      await expect(
        f.service.commit(f.principal, "hmpp_abcdefghijklmnopqrstuvwx"),
      ).rejects.toThrow();
      expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
    },
  );
  it("blocks ACTIVE with an audit record", async () => {
    const f = fixture("ACTIVE");
    await expect(
      f.service.commit(f.principal, "hmpp_abcdefghijklmnopqrstuvwx"),
    ).resolves.toMatchObject({ status: "blocked" });
    expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
    expect(f.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "meta_app_review_rename_blocked",
        success: false,
      }),
    );
  });
  it("reports already applied without no-op mutation", async () => {
    const f = fixture("PAUSED", "New Awareness Campaign");
    await expect(
      f.service.commit(f.principal, "hmpp_abcdefghijklmnopqrstuvwx"),
    ).resolves.toMatchObject({ status: "already_applied" });
    expect(f.providers.mutateCampaign).not.toHaveBeenCalled();
  });
  it.each([
    { operation: "pause" },
    { externalObjectId: "wrong" },
    { payload: { new_name: "name", status: "PAUSED" } },
    { payload: { budget: 5 } },
    { payload: { new_name: " " } },
    { payload: { new_name: "x".repeat(256) } },
  ])("blocks invalid input %j", (change) => {
    const f = fixture();
    expect(
      evaluateMetaAppReviewRenamePolicy(
        loadConfig(),
        { ...f.preview, ...change },
        f.account,
        policy.workspaceId,
      ).kind,
    ).not.toBe("allowed");
  });
  it("requires exact workspace/account and can be disabled independently", () => {
    const f = fixture();
    const config = loadConfig();
    expect(
      evaluateMetaAppReviewRenamePolicy(config, f.preview, f.account, "foreign")
        .kind,
    ).toBe("blocked");
    expect(
      evaluateMetaAppReviewRenamePolicy(
        config,
        f.preview,
        { externalAccountId: "wrong" },
        policy.workspaceId,
      ).kind,
    ).not.toBe("allowed");
    expect(
      evaluateMetaAppReviewRenamePolicy(
        { ...config, metaAppReviewSecondRenameEnabled: false },
        f.preview,
        f.account,
        policy.workspaceId,
      ).kind,
    ).not.toBe("allowed");
  });
});

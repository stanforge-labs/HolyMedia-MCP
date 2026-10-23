import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { GoogleAdsAdapter } from "./adapters/google.ads.js";
import { GoogleAdsWriteError } from "./google-ads-write.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import {
  assertLocalGoogleWriteContext,
  assertLocalStage4Action,
  assertLocalWriteKernel,
  localWriteRequestAllowed,
} from "./google-ads-local-write-profile.js";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const connectionId = "00000000-0000-4000-8000-000000000002";
const grantId = "00000000-0000-4000-8000-000000000003";
const ownerId = "00000000-0000-4000-8000-000000000004";
const accountId = "00000000-0000-4000-8000-000000000005";
const after = "2026-10-23T00:00:00.000Z";
afterEach(() => vi.unstubAllGlobals());

function fixture() {
  const config = loadConfig({
    NODE_ENV: "development",
    QRS_TEST_RESTRICTED_AUTH: "true",
    QRS_TEST_LOCAL_WRITE_ENABLED: "true",
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
    QRS_TEST_LOCAL_WRITE_GRANT_NOT_BEFORE: after,
    QRS_TEST_GOOGLE_OWNER_BINDING_USER_ID: ownerId,
    QRS_TEST_GOOGLE_OWNER_BINDING_EMAIL: "owner@example.test",
  });
  const client = {
    workspaceMembership: {
      findFirst: vi.fn().mockResolvedValue({ id: "owner-membership" }),
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
    providerAccount: {
      findFirst: vi.fn().mockResolvedValue({ id: accountId }),
    },
    oAuthRefreshToken: {
      findFirst: vi.fn().mockResolvedValue({
        createdAt: new Date("2026-10-23T00:01:00.000Z"),
        scope: "adforge:mcp:read adforge:mcp:write",
      }),
    },
  };
  return { config, client, database: { client } as unknown as DatabaseService };
}

describe("localhost Google WRITE runtime boundary", () => {
  it("refuses activation on a VPS or Windows host", () => {
    const { config } = fixture();
    expect(() => assertLocalWriteKernel(config, "6.8.0-generic")).toThrow(
      "WSL2",
    );
    expect(() => assertLocalWriteKernel(config, "10.0.26100")).toThrow("WSL2");
    expect(() =>
      assertLocalWriteKernel(config, "5.15.167.4-microsoft-standard-WSL2"),
    ).not.toThrow();
  });
  it("accepts only the two loopback HTTP hosts and exact Web Origin", () => {
    const { config } = fixture();
    expect(
      localWriteRequestAllowed(
        config,
        "/mcp",
        "127.0.0.1:24404",
        "http://127.0.0.1:23300",
      ),
    ).toBe(true);
    expect(
      localWriteRequestAllowed(
        config,
        "/oauth/google/callback",
        "127.0.0.1:24404",
        undefined,
      ),
    ).toBe(true);
    for (const host of ["localhost:24404", "mcp.holymedia.kz", undefined])
      expect(localWriteRequestAllowed(config, "/mcp", host, undefined)).toBe(
        false,
      );
    expect(
      localWriteRequestAllowed(
        config,
        "/mcp/public/approval",
        "127.0.0.1:24404",
        "https://mcp.holymedia.kz",
      ),
    ).toBe(false);
  });
  it("requires one active OWNER, fresh grants, one connection and one TEST customer", async () => {
    const { config, client, database } = fixture();
    await expect(
      assertLocalGoogleWriteContext(
        config,
        database,
        workspaceId,
        connectionId,
        accountId,
      ),
    ).resolves.toBeUndefined();
    expect(client.workspaceMembership.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: "OWNER",
          user: { status: "active", email: "owner@example.test" },
        }),
      }),
    );
    expect(client.providerAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          provider: "GOOGLE_ADS",
          externalAccountId: "8590146099",
          enabled: true,
        }),
      }),
    );
    expect(client.oAuthRefreshToken.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ familyId: grantId, revokedAt: null }),
      }),
    );
  });

  it("rejects foreign workspace/connection before database or provider access", async () => {
    const { config, client, database } = fixture();
    await expect(
      assertLocalGoogleWriteContext(
        config,
        database,
        "00000000-0000-4000-8000-000000000099",
        connectionId,
        accountId,
      ),
    ).rejects.toThrow("binding");
    await expect(
      assertLocalGoogleWriteContext(
        config,
        database,
        workspaceId,
        "00000000-0000-4000-8000-000000000099",
        accountId,
      ),
    ).rejects.toThrow("binding");
    expect(client.workspaceMembership.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    ["OWNER removed", "workspaceMembership"],
    ["connection revoked", "providerConnection"],
    ["account disabled", "providerAccount"],
    ["grant revoked", "oAuthRefreshToken"],
  ] as const)("rejects %s", async (_reason, key) => {
    const { config, client, database } = fixture();
    client[key].findFirst.mockResolvedValue(null);
    await expect(
      assertLocalGoogleWriteContext(
        config,
        database,
        workspaceId,
        connectionId,
        accountId,
      ),
    ).rejects.toThrow("binding");
  });

  it("rejects a stale provider connection, wrong scope and old MCP grant", async () => {
    for (const change of ["stale", "scope", "grant"] as const) {
      const { config, client, database } = fixture();
      if (change === "stale")
        client.providerConnection.findFirst.mockResolvedValue({
          connectedAt: new Date(after),
          credential: { id: "credential" },
          metadata: {
            grantedScopes: ["https://www.googleapis.com/auth/adwords"],
          },
        });
      if (change === "scope")
        client.providerConnection.findFirst.mockResolvedValue({
          connectedAt: new Date("2026-10-23T00:01:00.000Z"),
          credential: { id: "credential" },
          metadata: { grantedScopes: [] },
        });
      if (change === "grant")
        client.oAuthRefreshToken.findFirst.mockResolvedValue({
          createdAt: new Date(after),
          scope: "adforge:mcp:read adforge:mcp:write",
        });
      await expect(
        assertLocalGoogleWriteContext(
          config,
          database,
          workspaceId,
          connectionId,
          accountId,
        ),
      ).rejects.toThrow("binding");
    }
  });

  it("rejects rotation of an old grant family even with a fresh active token", async () => {
    const { config, client, database } = fixture();
    client.oAuthRefreshToken.findFirst
      .mockResolvedValueOnce({
        createdAt: new Date("2026-10-23T00:01:00.000Z"),
        scope: "adforge:mcp:read adforge:mcp:write",
      })
      .mockResolvedValueOnce({
        createdAt: new Date("2026-10-22T00:00:00.000Z"),
      });
    await expect(
      assertLocalGoogleWriteContext(
        config,
        database,
        workspaceId,
        connectionId,
        accountId,
      ),
    ).rejects.toThrow("binding");
  });

  it("keeps PMax and ConversionAction behind their separate OFF gates", () => {
    const { config } = fixture();
    expect(() =>
      assertLocalStage4Action(config, { action: "shared_set_update" }),
    ).not.toThrow();
    for (const action of [
      "pmax_create",
      "asset_group_update",
      "conversion_action_create",
    ])
      expect(() => assertLocalStage4Action(config, { action })).toThrow(
        "binding",
      );
  });

  it("rechecks the binding immediately before validate_only and commit without provider traffic on revoke", async () => {
    const { config } = fixture();
    const adapter = new GoogleAdsAdapter(config);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const assertWriteAllowed = vi.fn(async () => {
      throw new GoogleAdsWriteError(
        "google_local_write_binding_denied",
        "revoked",
      );
    });
    const context = {
      accountId: "8590146099",
      credentials: {
        accessToken: "synthetic-token",
        scopes: ["https://www.googleapis.com/auth/adwords"],
      },
      assertWriteAllowed,
    };
    const rows = [
      {
        campaign_id: "1",
        ad_group_id: "10",
        criterion_id: "1",
        resource_name: "customers/8590146099/adGroupCriteria/10~1",
        status: "PAUSED" as const,
      },
    ];
    await expect(
      adapter.validateKeywordStatuses(context, rows),
    ).rejects.toThrow("revoked");
    await expect(adapter.commitKeywordStatuses(context, rows)).rejects.toThrow(
      "revoked",
    );
    await expect(
      adapter.validateKeywordStatuses(
        { accountId: context.accountId, credentials: context.credentials },
        rows,
      ),
    ).rejects.toThrow("binding");
    expect(assertWriteAllowed).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  hashServiceToken,
  ServiceTokenService,
} from "./service-token.service.js";

describe("service token security primitives", () => {
  it("a new controlled key snapshots selected account IDs through normal create", async () => {
    const tokenCreate = vi.fn(async ({ data }) => ({
      ...data,
      id: "new-token",
      createdAt: new Date(),
      revokedAt: null,
      lastUsedAt: null,
    }));
    const selected = vi.fn(async () => [{ id: "new-connection-account" }]);
    const count = vi.fn(async () => 1);
    const tx = {
      serviceIdentity: { create: vi.fn(async () => ({ id: "new-identity" })) },
      serviceToken: { create: tokenCreate },
    };
    const service = new ServiceTokenService(
      {
        client: {
          providerAccount: { findMany: selected, count },
          $transaction: async (run: (client: typeof tx) => Promise<unknown>) =>
            run(tx),
        },
      } as never,
      { record: vi.fn() } as never,
    );
    const result = await service.create(
      "new-workspace",
      { name: "Reviewer key", scopes: ["adforge:mcp:write"] },
      { userId: "reviewer" } as never,
      {} as never,
    );
    expect(result.accountIds).toEqual(["new-connection-account"]);
    expect(result.scopes).toEqual(["adforge:mcp:read", "adforge:mcp:write"]);
    expect(tokenCreate).toHaveBeenCalledOnce();
    expect(selected).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "new-workspace",
          enabled: true,
        }),
      }),
    );
  });
  it("controlled key creation fails closed when no account is selected", async () => {
    const service = new ServiceTokenService(
      {
        client: { providerAccount: { findMany: vi.fn(async () => []) } },
      } as never,
      {} as never,
    );
    await expect(
      service.create(
        "workspace",
        { name: "key", scopes: ["adforge:mcp:write"] },
        {} as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
  it("stores only a digest and never exposes the raw token", () => {
    const raw = "hmst_example-secret-value";
    const digest = hashServiceToken(raw);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(raw);
    expect(hashServiceToken(raw)).toBe(digest);
    expect(hashServiceToken(`${raw}-changed`)).not.toBe(digest);
  });

  it("lists only keys that have not been deleted", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new ServiceTokenService(
      { client: { serviceToken: { findMany } } } as never,
      { record: vi.fn() } as never,
    );

    await service.list("workspace-1");

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          revokedAt: null,
          serviceIdentity: { workspaceId: "workspace-1" },
        },
      }),
    );
  });

  it("does not delete a key that was already deleted", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new ServiceTokenService(
      { client: { serviceToken: { findFirst } } } as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.revoke(
        "workspace-1",
        "token-1",
        { userId: "user-1" } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: "token-1",
        revokedAt: null,
        serviceIdentity: { workspaceId: "workspace-1" },
      },
    });
  });

  it("allows write scope only for one explicitly restricted account", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "token-1",
      tokenPrefix: "hmst_safe",
      name: "PPC controlled write",
      scopes: ["adforge:mcp:read", "adforge:mcp:write"],
      accountIds: ["meta-account-1"],
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: null,
      revokedAt: null,
      lastUsedAt: null,
    });
    const audit = { record: vi.fn() };
    const service = new ServiceTokenService(
      {
        client: {
          serviceToken: {
            findFirst: vi.fn().mockResolvedValue({
              id: "token-1",
              accountIds: ["meta-account-1"],
              serviceIdentity: { id: "identity-1" },
            }),
            update,
          },
        },
      } as never,
      audit as never,
    );

    await expect(
      service.updateScopes(
        "workspace-1",
        "token-1",
        { scopes: ["adforge:mcp:write"] },
        { userId: "admin-1" } as never,
        {} as never,
      ),
    ).resolves.toMatchObject({
      scopes: ["adforge:mcp:read", "adforge:mcp:write"],
      accountIds: ["meta-account-1"],
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "token-1" },
      data: { scopes: ["adforge:mcp:read", "adforge:mcp:write"] },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "service_token_scopes_updated",
        workspaceId: "workspace-1",
        targetId: "token-1",
      }),
    );
  });

  it("refuses write scope for an unrestricted credential", async () => {
    const update = vi.fn();
    const service = new ServiceTokenService(
      {
        client: {
          serviceToken: {
            findFirst: vi.fn().mockResolvedValue({
              id: "token-1",
              accountIds: [],
              serviceIdentity: { id: "identity-1" },
            }),
            update,
          },
        },
      } as never,
      { record: vi.fn() } as never,
    );

    await expect(
      service.updateScopes(
        "workspace-1",
        "token-1",
        { scopes: ["adforge:mcp:read", "adforge:mcp:write"] },
        { userId: "admin-1" } as never,
        {} as never,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(update).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { ProviderService } from "./provider.service.js";

describe("Search Console property isolation", () => {
  it("blocks provider OAuth and credential-backed reads for a demo workspace", async () => {
    const database = {
      client: {
        workspace: {
          findUnique: vi.fn(async () => ({
            reviewerDemo: true,
            accessStatus: "ACTIVE",
          })),
        },
      },
    };
    const adapter = vi.fn();
    const service = new ProviderService(
      database as never,
      {} as never,
      { get: adapter } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(
      service.startOAuth(
        "demo-workspace",
        "GOOGLE_ADS",
        {
          kind: "human",
          userId: "reviewer",
          sessionId: "session",
        },
        { ip: "127.0.0.1" } as never,
      ),
    ).rejects.toThrow("unavailable in the reviewer demo workspace");
    await expect(
      service.searchConsoleReport("demo-workspace", "sc-domain:demo.invalid"),
    ).rejects.toThrow("unavailable in the reviewer demo workspace");
    expect(adapter).not.toHaveBeenCalled();
  });

  it("does not enumerate workspace properties or refresh OAuth for an unknown property", async () => {
    const findMany = vi.fn(async () => [
      {
        displayName: "Private client property",
        externalAccountId: "sc-domain:private.example",
        metadata: {},
        status: "ACTIVE",
      },
    ]);
    const refresh = vi.fn();
    const database = {
      client: {
        workspace: { findUnique: vi.fn(async () => ({ reviewerDemo: false })) },
        providerAccount: { findMany },
      },
    };
    const coordinator = { withLock: refresh };
    const service = new ProviderService(
      database as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      coordinator as never,
      {} as never,
      {} as never,
      {} as never,
    );
    Reflect.set(
      service,
      "connectionReadCredentials",
      vi.fn(async () => ({
        connection: { id: "connection-a" },
        adapter: { querySearchAnalytics: vi.fn() },
        credentials: {},
      })),
    );
    const response = await service.searchConsoleReport(
      "workspace-a",
      "sc-domain:unknown.example",
    );
    expect(response).toEqual({
      status: "property_not_found",
      provider: "google_search_console",
      message: "Выбранная property не найдена в подключении Search Console.",
    });
    expect(JSON.stringify(response)).not.toContain("private.example");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "workspace-a",
          connectionId: "connection-a",
        }),
      }),
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "./provider.errors.js";
import { ProviderService } from "./provider.service.js";

function serviceWithTransaction(tx: Record<string, unknown>) {
  return new ProviderService(
    {
      client: {
        $transaction: async (run: (client: typeof tx) => Promise<unknown>) =>
          run(tx),
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe("Google Analytics discovery lifecycle", () => {
  it("marks the connection CONNECTED only after GA4 properties persist", async () => {
    const update = vi.fn(async () => undefined);
    const tx = {
      providerAccount: { upsert: vi.fn(async () => undefined) },
      providerConnection: {
        findUnique: vi.fn(async () => ({ metadata: { scopes: [] } })),
        update,
      },
    };
    const service = serviceWithTransaction(tx);

    await (
      service as never as {
        persistAccounts: (...args: unknown[]) => Promise<unknown>;
      }
    ).persistAccounts(
      "workspace",
      "connection",
      "GOOGLE_ANALYTICS",
      {} as never,
      {
        discoverAccounts: async () => [
          {
            externalAccountId: "398966907",
            displayName: "GA4 property",
          },
        ],
      },
    );

    expect(tx.providerAccount.upsert).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "CONNECTED",
          lastErrorCode: null,
        }),
      }),
    );
  });

  it("leaves a persisted GA4 credential recoverable when discovery fails", async () => {
    const update = vi.fn(async () => undefined);
    const tx = {
      providerConnection: {
        findFirst: vi.fn(async () => ({ metadata: { scopes: [] } })),
        update,
      },
    };
    const service = serviceWithTransaction(tx);

    await (
      service as never as {
        markGoogleAnalyticsDiscoveryFailure: (
          ...args: unknown[]
        ) => Promise<void>;
      }
    ).markGoogleAnalyticsDiscoveryFailure(
      "workspace",
      "connection",
      new ProviderError("provider_unavailable", "discovery failed", true),
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "DEGRADED",
          lastErrorCode: "provider_unavailable",
        }),
      }),
    );
  });
});

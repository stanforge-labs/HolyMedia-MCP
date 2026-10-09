import { describe, expect, it, vi } from "vitest";
import { McpService } from "./mcp.service.js";
import { GoogleAdsAdapter } from "../providers/adapters/google.ads.js";
import type { ProviderReadContext } from "../providers/provider.types.js";

const account = "8590146099";
const principal = {
  kind: "service",
  workspaceId: "workspace",
  accountIds: ["local"],
  scopes: ["adforge:mcp:read"],
};
describe("P244 stock Google READ dispatcher and adapter; no external calls", () => {
  it("MCP profile passes only the DB-owned identity and typed options to existing provider READ flow", async () => {
    const read = vi.fn(async () => ({
      provider: "GOOGLE_ADS",
      landing_reachability: "NOT_CHECKED",
      real_write_call_count: 0,
    }));
    const db = {
      client: {
        providerAccount: {
          findFirst: vi.fn(async () => ({
            id: "local",
            connectionId: "connection",
            provider: "GOOGLE_ADS",
            externalAccountId: account,
          })),
        },
      },
    };
    const service = new McpService(
      db as never,
      { googleTrackingAudit: read } as never,
      null!,
      null!,
      null!,
      null!,
    );
    const result = await service.callGoogleWriteProfile(
      principal as never,
      "audit_links_and_utms",
      {
        provider: "GOOGLE_ADS",
        account_id: account,
        campaign_ids: ["11"],
        limit: 20,
      },
    );
    expect(read).toHaveBeenCalledWith(
      "workspace",
      "connection",
      "local",
      "audit",
      { campaign_ids: ["11"], limit: 20 },
    );
    expect(result).toMatchObject({
      real_write_call_count: 0,
      landing_reachability: "NOT_CHECKED",
    });
    expect(
      service.googleWriteTools().find((t) => t.name === "audit_links_and_utms")
        ?.annotations,
    ).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    read.mockClear();
    await expect(
      service.callGoogleWriteProfile(principal as never, "get_tracking_specs", {
        provider: "GOOGLE_ADS",
        account_id: account,
        arbitrary_google_request: {},
      }),
    ).rejects.toMatchObject({ writeCode: "google_client_arguments_invalid" });
    expect(read).not.toHaveBeenCalled();
    db.client.providerAccount.findFirst.mockResolvedValueOnce({
      id: "foreign",
      connectionId: "other",
      provider: "GOOGLE_ADS",
      externalAccountId: account,
    });
    await expect(
      service.callGoogleWriteProfile(principal as never, "get_tracking_specs", {
        provider: "GOOGLE_ADS",
        account_id: account,
      }),
    ).rejects.toThrow("Account is not available");
    expect(read).not.toHaveBeenCalled();
  });
  it("adapter uses only existing account/login READ transport with write gates OFF", async () => {
    const adapter = new GoogleAdsAdapter();
    const search = vi
      .spyOn(
        adapter as unknown as {
          searchStream: (
            ...args: unknown[]
          ) => Promise<Record<string, unknown>[]>;
        },
        "searchStream",
      )
      .mockImplementation(async (...args) =>
        String(args[3]).includes("FROM customer")
          ? [
              {
                customer: {
                  id: account,
                  resourceName: `customers/${account}`,
                  autoTaggingEnabled: true,
                },
              },
            ]
          : [],
      );
    const context = {
      accountId: account,
      loginCustomerId: "4378327049",
      credentials: {
        accessToken: "mock-only",
        scopes: ["https://www.googleapis.com/auth/adwords"],
      },
    } as ProviderReadContext;
    const report = await adapter.trackingAudit(context, "specs", {
      campaign_ids: ["11"],
    });
    expect(report.provider).toBe("GOOGLE_ADS");
    expect(report.real_write_call_count).toBe(0);
    expect(report.complete).toBe(false); // requested campaign is unavailable, not a fabricated result
    expect(search).toHaveBeenCalledTimes(2);
    for (const call of search.mock.calls) {
      expect(call.slice(1, 3)).toEqual([account, "4378327049"]);
      expect(call[3]).toMatch(/^SELECT /);
    }
  });
});

import { describe, it, expect, vi } from "vitest";
import { MetaAssetAuthorizationService } from "./meta-asset-authorization.service.js";
import type { DatabaseService } from "../infrastructure/database.service.js";
import type { ProviderService } from "../providers/provider.service.js";
import type { ServiceTokenPrincipal } from "../service-tokens/service-token.service.js";
function fixture() {
  const accounts = [
    {
      id: "a",
      workspaceId: "wa",
      connectionId: "ca",
      externalAccountId: "act_11",
      enabled: true,
    },
    {
      id: "a2",
      workspaceId: "wa",
      connectionId: "ca",
      externalAccountId: "act_12",
      enabled: true,
    },
    {
      id: "b",
      workspaceId: "wb",
      connectionId: "cb",
      externalAccountId: "act_22",
      enabled: true,
    },
  ];
  const findMany = vi.fn(
    async ({
      where,
    }: {
      where: { workspaceId: string; id?: { in: string[] } };
    }) =>
      accounts.filter(
        (a) =>
          a.workspaceId === where.workspaceId &&
          (!where.id || where.id.in.includes(a.id)),
      ),
  );
  const providers = {
    readHealth: vi.fn(async () => ({ status: "healthy" })),
    metaPages: vi.fn(async (w: string, c: string) => {
      expect(c).toBe(w === "wa" ? "ca" : "cb");
      return [
        {
          id: w === "wa" ? "101" : "202",
          name: w,
          provenance: { realData: true },
        },
      ];
    }),
    metaBusinesses: vi.fn(async (w: string) => [
      { id: w === "wa" ? "301" : "302", name: w },
    ]),
    metaBusinessPages: vi.fn(async () => [{ id: "101" }, { id: "202" }]),
    metaBusinessAdAccounts: vi.fn(async () => [
      { externalAccountId: "act_11" },
      { externalAccountId: "act_12" },
      { externalAccountId: "act_22" },
    ]),
    metaPagePosts: vi.fn(async () => ({
      items: [{ id: "101_1" }],
      nextCursor: "next",
      truncated: true,
    })),
    metaInstagram: vi.fn(),
  };
  const service = new MetaAssetAuthorizationService(
    { client: { providerAccount: { findMany } } } as unknown as DatabaseService,
    providers as unknown as ProviderService,
  );
  const principal = (w = "wa"): ServiceTokenPrincipal => ({
    kind: "service",
    workspaceId: w,
    tokenId: `token-${w}`,
    serviceIdentityId: `identity-${w}`,
    scopes: ["adforge:mcp:read"],
    accountIds: [w === "wa" ? "a" : "b"],
  });
  return { service, providers, principal, findMany };
}
describe("Meta asset authorization without hardcoded tenants or external assets", () => {
  it("shares discovery with get_connected_assets without unrelated metrics calls", async () => {
    const f = fixture();
    const result = await f.service.discover(f.principal(), {});
    expect(result).toMatchObject({
      pages: [{ id: "101" }],
      businesses: [{ id: "301" }],
      health: { status: "healthy" },
      truncated: false,
    });
    expect(f.providers.metaPages).toHaveBeenCalledWith("wa", "ca");
  });
  it("lists different current credential pages and businesses for A and B without account_id", async () => {
    const f = fixture();
    for (const w of ["wa", "wb"]) {
      expect(
        await f.service.call(f.principal(w), "list_meta_pages", {}),
      ).toMatchObject({
        items: [{ id: w === "wa" ? "101" : "202" }],
        truncated: false,
      });
      expect(
        await f.service.call(f.principal(w), "list_meta_businesses", {}),
      ).toMatchObject({
        items: [{ id: w === "wa" ? "301" : "302" }],
        truncated: false,
      });
    }
  });
  it.each([
    ["get_meta_page", "page_id", "101", "202"],
    ["get_meta_business", "business_id", "301", "302"],
  ])("allows own and blocks foreign %s", async (tool, field, own, foreign) => {
    const f = fixture();
    expect(
      await f.service.call(f.principal(), tool, { [field]: own }),
    ).toMatchObject({ id: own });
    await expect(
      f.service.call(f.principal(), tool, { [field]: foreign }),
    ).rejects.toMatchObject({ code: "meta_asset_not_accessible" });
    await expect(
      f.service.call(f.principal("wb"), tool, { [field]: own }),
    ).rejects.toMatchObject({ code: "meta_asset_not_accessible" });
  });
  it("does not turn business access into ad-account access", async () => {
    const f = fixture();
    expect(
      await f.service.call(f.principal(), "list_business_ad_accounts", {
        business_id: "301",
      }),
    ).toEqual([{ externalAccountId: "act_11" }]);
    expect(
      await f.service.call(f.principal(), "list_business_pages", {
        business_id: "301",
      }),
    ).toEqual([{ id: "101" }]);
  });
  it("blocks foreign connection selector even when known externally", async () => {
    const f = fixture();
    await expect(
      f.service.call(f.principal(), "list_meta_pages", {
        account_id: "act_22",
      }),
    ).rejects.toMatchObject({ code: "meta_connection_required" });
    expect(f.providers.metaPages).not.toHaveBeenCalled();
  });
  it("authorizes page before posts and passes only bounded cursor parameters", async () => {
    const f = fixture();
    await expect(
      f.service.call(f.principal(), "list_page_posts", { page_id: "202" }),
    ).rejects.toMatchObject({ code: "meta_asset_not_accessible" });
    expect(f.providers.metaPagePosts).not.toHaveBeenCalled();
    expect(
      await f.service.call(f.principal(), "list_page_posts", {
        page_id: "101",
        cursor: "abc",
        limit: 10,
      }),
    ).toMatchObject({ nextCursor: "next" });
    expect(f.providers.metaPagePosts).toHaveBeenCalledWith(
      "wa",
      "ca",
      "101",
      10,
      "abc",
    );
  });
  it("checks tenant, enabled selection and connection state in the database", async () => {
    const f = fixture();
    await f.service.call(f.principal(), "list_meta_pages", {});
    expect(f.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workspaceId: "wa",
          enabled: true,
          id: { in: ["a"] },
          connection: {
            workspaceId: "wa",
            status: { in: ["CONNECTED", "DEGRADED"] },
          },
        }),
      }),
    );
  });
});

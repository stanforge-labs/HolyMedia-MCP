import { describe, expect, it, vi } from "vitest";
import { McpService } from "./mcp.service.js";

function serviceWithAccounts(accounts: Array<Record<string, unknown>>) {
  const database = {
    client: {
      providerAccount: {
        findMany: async ({
          where,
        }: { where?: { workspaceId?: string; id?: { in: string[] } } } = {}) =>
          accounts.filter(
            (a) =>
              (!where?.workspaceId || a.workspaceId === where.workspaceId) &&
              (!where?.id || where.id.in.includes(String(a.id))),
          ),
        findFirst: async ({ where }: { where: Record<string, unknown> }) => {
          const or = where.OR as Array<Record<string, string>>;
          return accounts.find(
            (account) =>
              account.workspaceId === where.workspaceId &&
              account.provider === where.provider &&
              account.enabled === true &&
              or.some(
                (condition) =>
                  account.id === condition.id ||
                  account.externalAccountId === condition.externalAccountId,
              ),
          );
        },
      },
    },
  } as never;
  const providers = {
    listProviders: () => [{ id: "GOOGLE_ADS", displayName: "Google Ads" }],
    readMetrics: async (
      _workspaceId: string,
      _connectionId: string,
      _accountId: string,
      dates: { startDate: string; endDate: string },
    ) =>
      dates.startDate === "2026-01-08"
        ? {
            spend: { amount: "150", currency: "USD" },
            impressions: 1500,
            clicks: 120,
            ctr: 0.08,
            cpc: { amount: "1.25", currency: "USD" },
            cpm: { amount: "100", currency: "USD" },
            conversions: 12,
            conversionValue: null,
            costPerConversion: { amount: "12.5", currency: "USD" },
          }
        : {
            spend: { amount: "100", currency: "USD" },
            impressions: 1000,
            clicks: 100,
            ctr: 0.1,
            cpc: { amount: "1", currency: "USD" },
            cpm: { amount: "100", currency: "USD" },
            conversions: 10,
            conversionValue: null,
            costPerConversion: { amount: "10", currency: "USD" },
          },
    googleAnalyticsGetProperty: vi.fn(async () => ({
      name: "properties/987654",
      displayName: "GA4 property",
      timeZone: "Asia/Almaty",
      currencyCode: "KZT",
    })),
    googleAnalyticsRunReport: vi.fn(async () => ({
      rowCount: 1,
      rows: [{ dimensionValues: [], metricValues: [{ value: "42" }] }],
      propertyQuota: { tokensPerDay: { remaining: 1_234 } },
    })),
    googleAnalyticsRunRealtime: vi.fn(async () => ({ rowCount: 0, rows: [] })),
    googleAnalyticsCheckCompatibility: vi.fn(async () => ({
      dimensionCompatibilities: [],
      metricCompatibilities: [],
    })),
    googleAnalyticsGoogleAdsLinks: vi.fn(async () => []),
    googleAnalyticsCustomDefinitions: vi.fn(async () => ({
      customDimensions: [],
      customMetrics: [],
    })),
    searchConsoleReport: vi.fn(
      async (_workspaceId: string, siteUrl: string) => ({
        siteUrl,
        rows: [],
      }),
    ),
  } as never;
  const reports = {
    performance: vi.fn(async (_workspaceId: string, input: unknown) => ({
      reportType: "performance",
      input,
    })),
  } as never;
  const previews = {
    create: async () => ({ status: "preview" }),
    confirm: async () => ({ status: "confirmed" }),
    commit: async () => ({ status: "blocked" }),
  } as never;
  const siteAnalysis = { analyze: async () => ({ status: 200 }) } as never;
  const billing = {
    currentSubscription: async () => null,
    usage: async () => [],
    entitlements: async () => [],
    requireFeature: async () => undefined,
  } as never;
  return new McpService(
    database,
    providers,
    reports,
    previews,
    siteAnalysis,
    billing,
  );
}

describe("MCP V1-compatible policy", () => {
  const account = {
    id: "internal-account-a",
    workspaceId: "workspace-a",
    provider: "GOOGLE_ADS",
    externalAccountId: "1234567890",
    displayName: "Allowed account",
    currency: "USD",
    timezone: "UTC",
    status: "ACTIVE",
    enabled: true,
    connectionId: "connection-a",
  };
  const ga4Account = {
    id: "internal-ga4-property",
    workspaceId: "workspace-a",
    provider: "GOOGLE_ANALYTICS",
    externalAccountId: "987654",
    displayName: "GA4 property",
    currency: "KZT",
    timezone: "Asia/Almaty",
    status: "ACTIVE",
    enabled: true,
    connectionId: "connection-ga4",
  };
  const metaAccount = {
    ...account,
    id: "internal-meta-account",
    provider: "META_ADS",
    externalAccountId: "act_123456789",
    connectionId: "connection-meta",
  };

  it("exposes a stable read tool surface", () => {
    const service = serviceWithAccounts([account]);
    expect(service.tools()).toHaveLength(156);
    expect(service.tools().map((tool) => tool.name)).toContain(
      "get_basic_metrics",
    );
    expect(service.tools().map((tool) => tool.name)).not.toContain(
      "commit_change",
    );
    expect(
      service
        .tools()
        .find((tool) => tool.name === "google_analytics_run_report")
        ?.inputSchema,
    ).toMatchObject({ additionalProperties: false });
  });

  it("exposes every exact V1 tool name", () => {
    const service = serviceWithAccounts([account]);
    const names = service.tools().map((tool) => tool.name);
    expect(names).toContain("collect_report_skill");
    expect(names).toContain("commit_meta_app_review_preview");
    expect(names).toContain("get_meta_page");
    expect(names).toContain("update_targeting_preview");
  });

  it.each([
    "list_meta_businesses",
    "get_meta_business",
    "list_business_ad_accounts",
    "list_business_pages",
    "list_meta_pages",
    "get_meta_page",
    "list_page_posts",
    "get_page_post",
    "get_page_post_engagement",
    "get_page_instagram_account",
  ])(
    "blocks Meta asset tool %s when no account is authorized for the key",
    async (tool) => {
      const service = serviceWithAccounts([metaAccount]);
      await expect(
        service.call(
          {
            kind: "service",
            workspaceId: "workspace-a",
            tokenId: "token-a",
            serviceIdentityId: "identity-a",
            scopes: ["adforge:mcp:read"],
            accountIds: ["foreign-internal-account"],
          },
          tool,
          {
            provider: "meta_ads",
            account_id: metaAccount.externalAccountId,
            business_id: "business-1",
            page_id: "page-1",
            post_id: "post-1",
          },
        ),
      ).rejects.toThrow(
        "Выберите доступный кабинет текущего подключения Meta.",
      );
    },
  );

  it("blocks Search Console connection-wide reads for an account-restricted token", async () => {
    const gscAccount = {
      ...account,
      id: "internal-gsc-property",
      provider: "GOOGLE_SEARCH_CONSOLE",
      externalAccountId: "https://example.com/",
      connectionId: "connection-gsc",
    };
    const service = serviceWithAccounts([gscAccount]);
    const principal = {
      kind: "service" as const,
      workspaceId: "workspace-a",
      tokenId: "token-a",
      serviceIdentityId: "identity-a",
      scopes: ["adforge:mcp:read"],
      accountIds: [gscAccount.id],
    };

    await expect(
      service.call(principal, "list_search_console_properties", {}),
    ).rejects.toThrow(
      "Connection-wide assets are not available to an account-restricted service token.",
    );
    await expect(
      service.call(principal, "get_search_console_report", {
        site_url: "https://foreign.example/",
      }),
    ).rejects.toThrow("Account is not available to this service token.");
  });

  it("allows the exact Search Console property assigned to a restricted token", async () => {
    const gscAccount = {
      ...account,
      id: "internal-gsc-property",
      provider: "GOOGLE_SEARCH_CONSOLE",
      externalAccountId: "https://example.com/",
      connectionId: "connection-gsc",
    };
    const service = serviceWithAccounts([gscAccount]);

    await expect(
      service.call(
        {
          kind: "service",
          workspaceId: "workspace-a",
          tokenId: "token-a",
          serviceIdentityId: "identity-a",
          scopes: ["adforge:mcp:read"],
          accountIds: [gscAccount.id],
        },
        "get_search_console_report",
        { site_url: gscAccount.externalAccountId },
      ),
    ).resolves.toMatchObject({ siteUrl: gscAccount.externalAccountId });
  });

  it("exposes the client-facing report skill in the operator catalog", async () => {
    const service = serviceWithAccounts([account]);
    const result = (await service.call(
      {
        kind: "service",
        tokenId: "token",
        serviceIdentityId: "identity",
        workspaceId: "workspace-a",
        scopes: ["adforge:mcp:read"],
        accountIds: [],
      },
      "list_operator_skills",
      {},
    )) as {
      items: Array<{ id: string; mcp_tool: string; read_only: boolean }>;
    };
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "collect_report",
          mcp_tool: "collect_report_skill",
          read_only: true,
        }),
        expect.objectContaining({
          id: "ga4_traffic_diagnosis",
          mcp_tool: "google_analytics_traffic_overview",
          read_only: true,
        }),
      ]),
    );
  });

  it("rejects secrets in compatibility preview payloads", async () => {
    const service = serviceWithAccounts([account]);
    await expect(
      service.call(
        {
          kind: "service",
          tokenId: "token",
          serviceIdentityId: "identity",
          workspaceId: "workspace-a",
          scopes: ["adforge:mcp:read"],
          accountIds: [],
        },
        "create_campaign_from_brief",
        {
          provider: "google_ads",
          account_id: "1234567890",
          refresh_token: "must-not-be-stored",
        },
      ),
    ).rejects.toThrow("must not contain credentials");
  });

  it("does not allow an account outside a service-token restriction", async () => {
    const service = serviceWithAccounts([account]);
    await expect(
      service.call(
        {
          kind: "service",
          tokenId: "token",
          serviceIdentityId: "identity",
          workspaceId: "workspace-a",
          scopes: ["adforge:mcp:read"],
          accountIds: ["different-account"],
        },
        "get_account_summary",
        { provider: "google_ads", account_id: "1234567890" },
      ),
    ).rejects.toThrow("Account is not available to this service token.");
  });

  it("accepts numeric external account ids without treating them as UUIDs", async () => {
    const service = serviceWithAccounts([account]);
    const result = await service.call(
      {
        kind: "service",
        tokenId: "token",
        serviceIdentityId: "identity",
        workspaceId: "workspace-a",
        scopes: ["adforge:mcp:read"],
        accountIds: [],
      },
      "get_account_status",
      { provider: "google_ads", account_id: "1234567890" },
    );
    expect(result).toMatchObject({ account_id: "1234567890" });
  });

  it("uses only an enabled GA4 property in the caller workspace for reports", async () => {
    const service = serviceWithAccounts([account, ga4Account]);
    const result = (await service.call(
      {
        kind: "service",
        tokenId: "token",
        serviceIdentityId: "identity",
        workspaceId: "workspace-a",
        scopes: ["adforge:mcp:read"],
        accountIds: [],
      },
      "google_analytics_traffic_overview",
      {
        property_id: "987654",
        start_date: "2026-08-01",
        end_date: "2026-08-31",
      },
    )) as { property: { property_id: string }; rows: unknown[] };
    expect(result.property.property_id).toBe("987654");
    expect(result.rows).toHaveLength(1);
  });

  it("does not expose a GA4 property outside a service-token restriction", async () => {
    const service = serviceWithAccounts([account, ga4Account]);
    await expect(
      service.call(
        {
          kind: "service",
          tokenId: "token",
          serviceIdentityId: "identity",
          workspaceId: "workspace-a",
          scopes: ["adforge:mcp:read"],
          accountIds: ["internal-account-a"],
        },
        "google_analytics_get_property",
        { property_id: "987654" },
      ),
    ).rejects.toThrow("Account is not available to this service token.");
  });

  it("compares two periods using the provider read adapter", async () => {
    const service = serviceWithAccounts([account]);
    const result = (await service.call(
      {
        kind: "service",
        tokenId: "token",
        serviceIdentityId: "identity",
        workspaceId: "workspace-a",
        scopes: ["adforge:mcp:read"],
        accountIds: [],
      },
      "compare_periods",
      {
        provider: "google_ads",
        account_id: "1234567890",
        current_start_date: "2026-01-08",
        current_end_date: "2026-01-14",
        previous_start_date: "2026-01-01",
        previous_end_date: "2026-01-07",
      },
    )) as { changes: { spend: { absolute: number; percent: number } } };
    expect(result.changes.spend.absolute).toBe(50);
    expect(result.changes.spend.percent).toBe(50);
  });

  it("adds an equal previous period to the collect report skill", async () => {
    const service = serviceWithAccounts([account]);
    const result = (await service.call(
      {
        kind: "service",
        tokenId: "token",
        serviceIdentityId: "identity",
        workspaceId: "workspace-a",
        scopes: ["adforge:mcp:read"],
        accountIds: [],
      },
      "collect_report_skill",
      {
        provider: "google_ads",
        account_id: "1234567890",
        start_date: "2026-01-08",
        end_date: "2026-01-14",
      },
    )) as {
      input: {
        previousStartDate: string;
        previousEndDate: string;
      };
    };
    expect(result.input.previousStartDate).toBe("2026-01-01");
    expect(result.input.previousEndDate).toBe("2026-01-07");
  });
});

import { describe, expect, it, vi } from "vitest";
import { McpService } from "./mcp.service.js";

function serviceWithAccounts(
  accounts: Array<Record<string, unknown>>,
  providerOverrides: Record<string, unknown> = {},
  previewOverrides: Record<string, unknown> = {},
) {
  const database = {
    client: {
      providerAccount: {
        findMany: async ({
          where,
        }: {
          where?: {
            workspaceId?: string;
            id?: { in: string[] };
            provider?: string | { in: string[] };
          };
        } = {}) =>
          accounts.filter(
            (a) =>
              (!where?.workspaceId || a.workspaceId === where.workspaceId) &&
              (!where?.id || where.id.in.includes(String(a.id))) &&
              (!where?.provider ||
                (typeof where.provider === "string"
                  ? a.provider === where.provider
                  : where.provider.in.includes(String(a.provider)))),
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
    readCampaigns: vi.fn(async () => ({ items: [] })),
    metaInsights: vi.fn(async () => ({ data: [{ campaign_id: "meta-1" }] })),
    metaPermissions: vi.fn(async () => ({
      requested: ["ads_read"],
      granted: ["ads_read"],
      missing: [],
      declined: [],
      status: "CONNECTED",
    })),
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
    ...providerOverrides,
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
    ...previewOverrides,
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

function principal() {
  return {
    kind: "service" as const,
    tokenId: "token",
    serviceIdentityId: "identity",
    workspaceId: "workspace-a",
    scopes: ["adforge:mcp:read"],
    accountIds: [],
  };
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
    expect(service.tools()).toHaveLength(171); // Existing 170 + gated Stage 2 preview; generic budget reused.
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

  it("registers a Google-only keyword read tool and preserves write=false", async () => {
    const readGoogleKeywords = vi.fn(async () => ({ items: [] }));
    const service = serviceWithAccounts([account, metaAccount], {
      readGoogleKeywords,
      listProviders: () => [
        { id: "GOOGLE_ADS", read: true, write: false },
        { id: "META_ADS", read: true, write: true },
      ],
    });
    const schema = service
      .tools()
      .find((tool) => tool.name === "google_ads_list_keywords")?.inputSchema;
    expect(schema).toMatchObject({
      required: ["account_id"],
      additionalProperties: false,
    });
    expect(
      await service.call(principal(), "get_provider_capabilities", {
        provider: "GOOGLE_ADS",
      }),
    ).toMatchObject({ write: false });
    expect(
      await service.call(principal(), "list_supported_objects", {
        provider: "GOOGLE_ADS",
      }),
    ).toMatchObject({
      items: [
        "account",
        "campaign",
        "metrics",
        "keyword",
        "ad_group",
        "search_term",
        "negative_keyword",
        "shared_negative_list",
      ],
    });
    expect(
      await service.call(principal(), "list_supported_objects", {
        provider: "META_ADS",
      }),
    ).toMatchObject({ items: ["account", "campaign", "metrics"] });
    await service.call(principal(), "google_ads_list_keywords", {
      account_id: account.externalAccountId,
      since: "2026-03-01",
      until: "2026-09-28",
      campaign_ids: ["123"],
      ad_group_ids: ["456"],
      statuses: ["PAUSED"],
      min_cost: 1,
      limit: 25,
    });
    expect(readGoogleKeywords).toHaveBeenCalledWith(
      "workspace-a",
      "connection-a",
      "internal-account-a",
      {
        campaignIds: ["123"],
        adGroupIds: ["456"],
        statuses: ["PAUSED"],
        range: { startDate: "2026-03-01", endDate: "2026-09-28" },
        minCost: 1,
        limit: 25,
      },
    );
    await expect(
      service.call(principal(), "google_ads_list_keywords", {
        provider: "META_ADS",
        account_id: account.externalAccountId,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.call(principal(), "google_ads_list_keywords", {
        account_id: "bad",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.call(principal(), "google_ads_list_keywords", {
        account_id: account.externalAccountId,
        statuses: ["UNKNOWN"],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.call(principal(), "google_ads_list_keywords", {
        account_id: account.externalAccountId,
        since: "",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("registers read-only negative inventory and conflict tools with scoped inputs", async () => {
    const readGoogleNegatives = vi.fn(async () => ({
      account_id: "9458996580",
      next_cursor: null,
    }));
    const readGoogleNegativeConflicts = vi.fn(async () => ({
      account_id: "9458996580",
      conflicts: [],
    }));
    const service = serviceWithAccounts([account, metaAccount], {
      readGoogleNegatives,
      readGoogleNegativeConflicts,
      listProviders: () => [
        { id: "GOOGLE_ADS", read: true, write: false },
        { id: "META_ADS", read: true, write: true },
      ],
    });
    expect(
      service.tools().find((tool) => tool.name === "google_ads_list_negatives")
        ?.inputSchema,
    ).toMatchObject({ required: ["account_id"], additionalProperties: false });
    expect(
      service
        .tools()
        .find((tool) => tool.name === "google_ads_check_negative_conflicts")
        ?.inputSchema,
    ).toMatchObject({
      required: ["account_id", "campaign_ids", "negatives"],
      additionalProperties: false,
    });
    await service.call(principal(), "google_ads_list_negatives", {
      account_id: account.externalAccountId,
      campaign_ids: ["123"],
      levels: ["shared_list"],
      limit: 25,
    });
    expect(readGoogleNegatives).toHaveBeenCalledWith(
      "workspace-a",
      "connection-a",
      "internal-account-a",
      { campaignIds: ["123"], levels: ["shared_list"], limit: 25 },
    );
    await service.call(principal(), "google_ads_check_negative_conflicts", {
      account_id: account.externalAccountId,
      campaign_ids: ["123"],
      negatives: [{ text: "приват", match_type: "BROAD" }],
      limit: 25,
    });
    expect(readGoogleNegativeConflicts).toHaveBeenCalledWith(
      "workspace-a",
      "connection-a",
      "internal-account-a",
      {
        campaignIds: ["123"],
        negatives: [{ text: "приват", match_type: "BROAD" }],
        limit: 25,
      },
    );
    expect(
      await service.call(principal(), "get_provider_capabilities", {
        provider: "GOOGLE_ADS",
      }),
    ).toMatchObject({ write: false });
    expect(
      await service.call(principal(), "list_supported_objects", {
        provider: "GOOGLE_ADS",
      }),
    ).toMatchObject({
      items: expect.arrayContaining([
        "negative_keyword",
        "shared_negative_list",
      ]),
    });
    expect(
      await service.call(principal(), "list_supported_objects", {
        provider: "META_ADS",
      }),
    ).toMatchObject({ items: ["account", "campaign", "metrics"] });
    for (const args of [
      { account_id: "bad" },
      { account_id: account.externalAccountId, campaign_ids: ["not-an-id"] },
      { account_id: account.externalAccountId, cursor: "" },
    ])
      await expect(
        service.call(principal(), "google_ads_list_negatives", args),
      ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.call(principal(), "google_ads_check_negative_conflicts", {
        account_id: account.externalAccountId,
        negatives: [{ text: "x" }],
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.call(principal(), "google_ads_list_negatives", {
        provider: "META_ADS",
        account_id: account.externalAccountId,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("registers a Search-only, date-required search-term read tool without changing Meta capabilities", async () => {
    const readGoogleSearchTerms = vi.fn(async () => ({
      items: [],
      metadata: { pmaxSupported: false },
    }));
    const service = serviceWithAccounts([account, metaAccount], {
      readGoogleSearchTerms,
      listProviders: () => [
        { id: "GOOGLE_ADS", read: true, write: false },
        { id: "META_ADS", read: true, write: true },
      ],
    });
    const schema = service
      .tools()
      .find((tool) => tool.name === "google_ads_search_terms")?.inputSchema;
    expect(schema).toMatchObject({
      required: ["account_id", "since", "until"],
      additionalProperties: false,
    });
    expect(
      await service.call(principal(), "list_supported_objects", {
        provider: "GOOGLE_ADS",
      }),
    ).toMatchObject({
      items: [
        "account",
        "campaign",
        "metrics",
        "keyword",
        "ad_group",
        "search_term",
        "negative_keyword",
        "shared_negative_list",
      ],
    });
    expect(
      await service.call(principal(), "list_supported_objects", {
        provider: "META_ADS",
      }),
    ).toMatchObject({ items: ["account", "campaign", "metrics"] });
    expect(
      await service.call(principal(), "get_provider_capabilities", {
        provider: "GOOGLE_ADS",
      }),
    ).toMatchObject({ write: false });
    await service.call(principal(), "google_ads_search_terms", {
      account_id: account.externalAccountId,
      since: "2026-03-01",
      until: "2026-09-28",
      campaign_ids: ["123"],
      min_cost: 1,
      contains: "приват",
      only_not_added: true,
      limit: 25,
      format: "json",
    });
    expect(readGoogleSearchTerms).toHaveBeenCalledWith(
      "workspace-a",
      "connection-a",
      "internal-account-a",
      {
        range: { startDate: "2026-03-01", endDate: "2026-09-28" },
        campaignIds: ["123"],
        minCost: 1,
        contains: "приват",
        onlyNotAdded: true,
        limit: 25,
      },
    );
    for (const invalid of [
      { until: "2026-09-28" },
      { since: "2026-03-01" },
      { since: "2026-02-30", until: "2026-09-28" },
      { since: "2026-10-01", until: "2026-09-28" },
    ])
      await expect(
        service.call(principal(), "google_ads_search_terms", {
          account_id: account.externalAccountId,
          ...invalid,
        }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      service.call(principal(), "google_ads_search_terms", {
        account_id: account.externalAccountId,
        since: "2026-03-01",
        until: "2026-09-28",
        format: "csv",
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
      message: expect.stringContaining("CSV file delivery"),
    });
    expect(readGoogleSearchTerms).toHaveBeenCalledTimes(1);
    await expect(
      service.call(principal(), "google_ads_search_terms", {
        provider: "META_ADS",
        account_id: account.externalAccountId,
        since: "2026-03-01",
        until: "2026-09-28",
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
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

  it("returns one Google campaign insight row per campaign and honors explicit dates", async () => {
    const readCampaigns = vi.fn(async (..._args: unknown[]) => ({
      items: [
        {
          id: "123",
          name: "Search",
          status: "ENABLED",
          budget: { amount: "5", currency: "USD" },
          budgetDetails: {
            resourceName: "customers/1234567890/campaignBudgets/9",
            explicitlyShared: false,
            period: "DAILY",
          },
          metrics: {
            spend: { amount: "1015.6", currency: "USD" },
            impressions: 1000,
            clicks: 100,
            ctr: 10,
            cpc: { amount: "10.156", currency: "USD" },
            conversions: 20,
            costPerConversion: { amount: "50.78", currency: "USD" },
            conversionValue: "2000",
          },
        },
      ],
    }));
    const service = serviceWithAccounts([account], { readCampaigns });
    const result = (await service.call(principal(), "get_flexible_insights", {
      provider: "google_ads",
      account_id: "1234567890",
      level: "campaign",
      since: "2026-08-30",
      until: "2026-09-28",
    })) as { items: Array<Record<string, unknown>> };
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      campaignId: "123",
      name: "Search",
      status: "ENABLED",
      currency: "USD",
      spend: { amount: "1015.6", currency: "USD" },
      budgetDetails: { period: "DAILY" },
    });
    expect(readCampaigns.mock.calls[0]?.[3]).toEqual({
      startDate: "2026-08-30",
      endDate: "2026-09-28",
    });
  });

  it("keeps Google account insights aggregate and supports date_preset", async () => {
    const readMetrics = vi.fn(async (..._args: unknown[]) => ({
      spend: { amount: "100", currency: "USD" },
    }));
    const service = serviceWithAccounts([account], { readMetrics });
    const result = await service.call(principal(), "get_flexible_insights", {
      provider: "google_ads",
      account_id: "1234567890",
      level: "account",
      date_preset: "last_30d",
    });
    expect(result).toEqual({ spend: { amount: "100", currency: "USD" } });
    const dates = readMetrics.mock.calls[0]?.[3] as {
      startDate: string;
      endDate: string;
    };
    expect(
      (Date.parse(dates.endDate) - Date.parse(dates.startDate)) / 86_400_000,
    ).toBe(29);
    await expect(
      service.call(principal(), "get_flexible_insights", {
        provider: "google_ads",
        account_id: "1234567890",
        level: "account",
        since: "2026-08-30",
        until: "2026-09-28",
        date_preset: "last_30d",
      }),
    ).rejects.toThrow("either since/until or date_preset");
  });

  it("passes Google status to the read adapter without changing Meta list semantics", async () => {
    const readCampaigns = vi.fn(async (..._args: unknown[]) => ({ items: [] }));
    const service = serviceWithAccounts([account, metaAccount], {
      readCampaigns,
    });
    await service.call(principal(), "list_campaigns", {
      provider: "google_ads",
      account_id: "1234567890",
      status: "ENABLED",
    });
    await service.call(principal(), "list_campaigns", {
      provider: "meta_ads",
      account_id: metaAccount.externalAccountId,
      status: "ENABLED",
    });
    expect(readCampaigns.mock.calls[0]?.[6]).toEqual(["ENABLED"]);
    expect(readCampaigns.mock.calls[1]?.[6]).toBeUndefined();
  });

  it("audits all 501 Google campaigns without silently dropping the second page", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({
      id: String(index + 1),
    }));
    const readCampaigns = vi.fn(async (...args: unknown[]) =>
      args[5] === "page-two"
        ? { items: rows.slice(500) }
        : { items: rows.slice(0, 500), nextCursor: "page-two" },
    );
    const service = serviceWithAccounts([account], {
      readCampaigns,
      readHealth: vi.fn(async () => ({ status: "healthy" })),
    });
    const result = (await service.call(principal(), "audit_account", {
      provider: "google_ads",
      account_id: account.externalAccountId,
    })) as { campaigns: Array<{ id: string }> };
    expect(result.campaigns).toHaveLength(501);
    expect(result.campaigns[500]?.id).toBe("501");
    expect(readCampaigns).toHaveBeenCalledTimes(2);
    expect(readCampaigns.mock.calls[1]?.[5]).toBe("page-two");
  });

  it("returns a typed audit error instead of a partial result at the safety cap", async () => {
    let page = 0;
    const readCampaigns = vi.fn(async () => ({
      items: [{ id: String(++page) }],
      nextCursor: `page-${page}`,
    }));
    const service = serviceWithAccounts([account], {
      readCampaigns,
      readHealth: vi.fn(async () => ({ status: "healthy" })),
    });
    await expect(
      service.call(principal(), "audit_account", {
        provider: "google_ads",
        account_id: account.externalAccountId,
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(readCampaigns).toHaveBeenCalledTimes(20);
  });

  it("uses a direct Google campaign lookup beyond the first 500 and keeps Meta unchanged", async () => {
    const readGoogleCampaign = vi.fn(async (...args: unknown[]) =>
      args[3] === "501" ? { id: "501", name: "Target" } : null,
    );
    const readCampaigns = vi.fn(async () => ({
      items: [{ id: "meta-1", name: "Meta" }],
    }));
    const metaEntity = vi.fn(async () => ({ id: "meta-1", name: "Meta" }));
    const service = serviceWithAccounts([account, metaAccount], {
      readGoogleCampaign,
      readCampaigns,
      metaEntity,
    });
    expect(
      await service.call(principal(), "get_campaign", {
        provider: "google_ads",
        account_id: account.externalAccountId,
        campaign_id: "501",
      }),
    ).toMatchObject({ id: "501" });
    expect(
      await service.call(principal(), "get_campaign", {
        provider: "google_ads",
        account_id: account.externalAccountId,
        campaign_id: "999",
      }),
    ).toBeNull();
    expect(readCampaigns).not.toHaveBeenCalled();
    expect(
      await service.call(principal(), "get_campaign", {
        provider: "meta_ads",
        account_id: metaAccount.externalAccountId,
        campaign_id: "meta-1",
      }),
    ).toMatchObject({ id: "meta-1" });
    expect(metaEntity).toHaveBeenCalledTimes(1);
    expect(readCampaigns).not.toHaveBeenCalled();
  });

  it("rejects unsupported Google previews before shared preview storage", async () => {
    const create = vi.fn();
    const service = serviceWithAccounts([account], {}, { create });
    for (const tool of [
      "update_entity_status_preview",
      "pause_entities_preview",
      "preview_pause_campaign",
    ]) {
      await expect(
        service.call(principal(), tool, {
          provider: "google_ads",
          account_id: "1234567890",
          entity_type: "keyword",
          entity_ids: ["test"],
          status: "PAUSED",
        }),
      ).rejects.toMatchObject({ code: "not_supported_for_google_ads" });
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("leaves Meta compatibility preview routing unchanged", async () => {
    const create = vi.fn(async () => ({ status: "preview" }));
    const service = serviceWithAccounts([metaAccount], {}, { create });
    await expect(
      service.call(principal(), "update_entity_status_preview", {
        provider: "meta_ads",
        account_id: metaAccount.externalAccountId,
        entity_type: "campaign",
        campaign_id: "123",
        status: "PAUSED",
      }),
    ).resolves.toEqual({ status: "preview" });
    expect(create).toHaveBeenCalledWith(
      principal(),
      expect.objectContaining({
        provider: "META_ADS",
        accountId: metaAccount.externalAccountId,
        objectId: "123",
      }),
    );
  });

  it("preserves Meta flexible insights routing", async () => {
    const metaInsights = vi.fn(async () => ({
      data: [{ campaign_id: "meta-1" }],
    }));
    const service = serviceWithAccounts([metaAccount], { metaInsights });
    await expect(
      service.call(principal(), "get_flexible_insights", {
        provider: "meta_ads",
        account_id: metaAccount.externalAccountId,
        level: "campaign",
        date_preset: "last_30d",
      }),
    ).resolves.toEqual({ data: [{ campaign_id: "meta-1" }] });
    expect(metaInsights).toHaveBeenCalledTimes(1);
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

  it("groups selected workspace resources without mixing GA4 into ad accounts", async () => {
    const service = serviceWithAccounts([account, ga4Account, metaAccount]);
    const principal = {
      kind: "service" as const,
      tokenId: "token",
      serviceIdentityId: "identity",
      workspaceId: "workspace-a",
      scopes: ["adforge:mcp:read"],
      accountIds: [],
      resourceAccessMode: "ALL_CONNECTED" as const,
    };

    await expect(
      service.call(principal, "list_ad_accounts", {}),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "GOOGLE_ADS" }),
        expect.objectContaining({ provider: "META_ADS" }),
      ]),
    );
    const result = (await service.call(
      principal,
      "list_connected_resources",
      {},
    )) as { advertising_accounts: unknown[]; analytics_properties: unknown[] };
    expect(result.advertising_accounts).toHaveLength(2);
    expect(result.analytics_properties).toEqual([
      expect.objectContaining({
        provider: "GOOGLE_ANALYTICS",
        account_id: "987654",
      }),
    ]);
  });

  it("reads Meta OAuth permissions from the workspace connection without an account argument", async () => {
    const service = serviceWithAccounts([]);
    const principal = {
      kind: "service" as const,
      tokenId: "token",
      serviceIdentityId: "identity",
      workspaceId: "workspace-a",
      scopes: ["adforge:mcp:read"],
      accountIds: [],
      resourceAccessMode: "ALL_CONNECTED" as const,
    };

    await expect(
      service.call(principal, "get_meta_oauth_permissions", {}),
    ).resolves.toMatchObject({
      granted: ["ads_read"],
      status: "CONNECTED",
    });
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

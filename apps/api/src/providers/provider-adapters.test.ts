import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "@holymedia/config";
import { GoogleAdsAdapter } from "./adapters/google.ads.js";
import { MetaAdsAdapter } from "./adapters/meta.ads.js";
import { TikTokAdsAdapter } from "./adapters/tiktok.ads.js";
import { YandexDirectAdapter } from "./adapters/yandex.direct.js";
import { GoogleSearchConsoleAdapter } from "./adapters/google.search-console.js";
import { GoogleAnalyticsAdapter } from "./adapters/google.analytics.js";
import {
  googleAccessibleCustomersFixture,
  googleCampaignFixture,
  googleCustomerHierarchyFixture,
  googleManagerClientsFixture,
} from "./fixtures/google-ads.fixture.js";
import {
  metaAdAccountsFixture,
  metaPagesFixture,
  metaPostsFixture,
} from "./fixtures/meta-ads.fixture.js";

const config = loadConfig({
  NODE_ENV: "test",
  PROVIDER_GOOGLE_CLIENT_ID: "google-client",
  PROVIDER_GOOGLE_CLIENT_SECRET: "google-secret",
  PROVIDER_GOOGLE_REDIRECT_URI: "https://v2.example.test/oauth/google/callback",
  PROVIDER_GOOGLE_DEVELOPER_TOKEN: "developer-token",
  PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: "1234567890",
  PROVIDER_META_CLIENT_ID: "meta-client",
  PROVIDER_META_CLIENT_SECRET: "meta-secret",
  PROVIDER_META_REDIRECT_URI: "https://v2.example.test/oauth/meta/callback",
  PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_ID: "search-console-client",
  PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: "search-console-secret",
  PROVIDER_GOOGLE_SEARCH_CONSOLE_REDIRECT_URI:
    "https://v2.example.test/oauth/google-search-console/callback",
  PROVIDER_GOOGLE_ANALYTICS_CLIENT_ID: "analytics-client",
  PROVIDER_GOOGLE_ANALYTICS_CLIENT_SECRET: "analytics-secret",
  PROVIDER_GOOGLE_ANALYTICS_REDIRECT_URI:
    "https://v2.example.test/oauth/google-analytics/callback",
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Google Ads v2 adapter", () => {
  it("builds OAuth URL with the adwords scope and discovers manager clients", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(googleAccessibleCustomersFixture))
      .mockResolvedValueOnce(jsonResponse(googleCustomerHierarchyFixture))
      .mockResolvedValueOnce(jsonResponse(googleManagerClientsFixture));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleAdsAdapter(config);
    const url = new URL(
      adapter.authorizationUrl({
        state: "state",
        redirectUri: config.providerGoogleRedirectUri!,
      }),
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/adwords",
    );
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
    const accounts = await adapter.discoverAccounts({
      accessToken: "access",
      scopes: ["https://www.googleapis.com/auth/adwords"],
    });
    expect(accounts.map((account) => account.externalAccountId)).toEqual([
      "1234567890",
      "2345678901",
    ]);
    expect(accounts[1]?.currency).toBe("KZT");
    expect(accounts[1]?.metadata).toMatchObject({
      managerCustomerId: "1234567890",
      loginCustomerId: "1234567890",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("normalizes campaign budgets from micros and keeps read responses source-backed", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(googleCampaignFixture))
      .mockResolvedValueOnce(jsonResponse(googleCustomerHierarchyFixture));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleAdsAdapter(config);
    const result = await adapter.listCampaigns(
      {
        credentials: {
          accessToken: "access",
          scopes: ["https://www.googleapis.com/auth/adwords"],
        },
        accountId: "1234567890",
      },
      { startDate: "2026-01-01", endDate: "2026-01-07" },
    );
    expect(result.items[0]?.budget).toEqual({ amount: "2.5", currency: "USD" });
    expect(result.items[0]?.budgetDetails).toEqual({
      resourceName: "customers/1234567890/campaignBudgets/500",
      explicitlyShared: false,
      period: "DAILY",
    });
    expect(result.items[0]?.metrics).toMatchObject({
      spend: { amount: "1.25", currency: "USD" },
      cpc: { amount: "0.025", currency: "USD" },
      costPerConversion: { amount: "0.625", currency: "USD" },
      conversionValue: "300",
    });
    expect(result.items[0]?.provenance).toMatchObject({
      provider: "GOOGLE_ADS",
      realData: true,
      dataStatus: "live",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toContain(
      "/customers/1234567890/googleAds:searchStream",
    );
    expect(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ).not.toContain("campaign_budget.currency_code");
    const campaignQuery = String(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body,
    );
    expect(campaignQuery).toContain("campaign.status != 'REMOVED'");
    expect(campaignQuery).toContain("campaign_budget.period");
    expect(campaignQuery).toContain("campaign_budget.explicitly_shared");
    expect(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    ).toContain("customer.currency_code");
    const headers = (fetchMock.mock.calls[0]?.[1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer access");
    expect(headers["login-customer-id"]).toBe("1234567890");
    expect(headers).not.toHaveProperty("developer-token");
  });

  it("works without a developer token and normalizes account metrics once", async () => {
    const withoutToken = loadConfig({
      NODE_ENV: "test",
      PROVIDER_GOOGLE_CLIENT_ID: "client",
      PROVIDER_GOOGLE_CLIENT_SECRET: "secret",
      PROVIDER_GOOGLE_REDIRECT_URI: "https://example.test/oauth",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse([
          {
            results: [
              {
                metrics: {
                  costMicros: "5184189430",
                  impressions: "1000",
                  clicks: "100",
                  conversions: 570.971158,
                  conversionsValue: 6200,
                },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse(googleCustomerHierarchyFixture));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleAdsAdapter(withoutToken);
    expect(adapter.definition.status).toBe("available");
    const metrics = await adapter.getMetrics(
      {
        credentials: { accessToken: "access", scopes: [] },
        accountId: "1234567890",
      },
      { startDate: "2026-08-30", endDate: "2026-09-28" },
    );
    expect(metrics.spend).toEqual({ amount: "5184.18943", currency: "USD" });
    expect(metrics.costPerConversion?.amount).toBe("9.079599");
    expect(metrics.conversionValue).toBe("6200");
    expect(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).headers,
    ).not.toHaveProperty("developer-token");
  });

  it("normalizes the PPC campaign cost-per-conversion example exactly once", async () => {
    const ppcCampaign = [
      {
        results: [
          {
            campaign: {
              id: "22623539698",
              name: "PPC reference",
              status: "ENABLED",
            },
            campaignBudget: {
              amountMicros: "5000000",
              period: "DAILY",
              explicitlyShared: false,
            },
            metrics: {
              costMicros: "5184189430",
              impressions: "10000",
              clicks: "1000",
              averageCpc: "5184189.43",
              conversions: 570.971158,
              costPerConversion: "9079599.481275",
              conversionsValue: 6000,
            },
          },
        ],
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ppcCampaign))
      .mockResolvedValueOnce(jsonResponse(googleCustomerHierarchyFixture));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GoogleAdsAdapter(config).listCampaigns(
      {
        credentials: { accessToken: "access", scopes: [] },
        accountId: "1234567890",
      },
      { startDate: "2026-08-30", endDate: "2026-09-28" },
    );
    expect(result.items[0]?.metrics).toMatchObject({
      spend: { amount: "5184.18943", currency: "USD" },
      costPerConversion: { amount: "9.079599", currency: "USD" },
      cpc: { amount: "5.184189", currency: "USD" },
    });
    expect(result.items[0]?.budget).toEqual({ amount: "5", currency: "USD" });
    expect(result.items[0]?.budgetDetails?.period).toBe("DAILY");
  });

  it("reuses customer.currency_code persisted in account context without a per-campaign request", async () => {
    const rows = [
      {
        results: [
          {
            campaign: { id: "1", name: "A", status: "ENABLED" },
            campaignBudget: { amountMicros: "1000000" },
          },
          {
            campaign: { id: "2", name: "B", status: "ENABLED" },
            campaignBudget: { amountMicros: "2000000" },
          },
        ],
      },
    ];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(rows));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GoogleAdsAdapter(config).listCampaigns({
      credentials: { accessToken: "access", scopes: [] },
      accountId: "1234567890",
      currency: "KZT",
    });
    expect(result.items.map((item) => item.budget?.currency)).toEqual([
      "KZT",
      "KZT",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("filters statuses in GAQL before cursor pagination", async () => {
    const filtered = [
      {
        results: [
          { campaign: { id: "1", name: "One", status: "ENABLED" } },
          { campaign: { id: "2", name: "Two", status: "ENABLED" } },
          { campaign: { id: "3", name: "Three", status: "ENABLED" } },
        ],
      },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(filtered))
      .mockResolvedValueOnce(jsonResponse(googleCustomerHierarchyFixture))
      .mockResolvedValueOnce(jsonResponse(filtered))
      .mockResolvedValueOnce(jsonResponse(googleCustomerHierarchyFixture));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleAdsAdapter(config);
    const context = {
      credentials: { accessToken: "access", scopes: [] },
      accountId: "1234567890",
    };
    const first = await adapter.listCampaigns(
      context,
      undefined,
      2,
      undefined,
      ["ENABLED"],
    );
    const second = await adapter.listCampaigns(
      context,
      undefined,
      2,
      first.nextCursor,
      ["ENABLED"],
    );
    expect(first.items.map((item) => item.id)).toEqual(["1", "2"]);
    expect(first.nextCursor).toBe("2");
    expect(second.items.map((item) => item.id)).toEqual(["3"]);
    expect(second.nextCursor).toBeUndefined();
    for (const call of [fetchMock.mock.calls[0], fetchMock.mock.calls[2]])
      expect(String((call?.[1] as RequestInit).body)).toContain(
        "campaign.status = 'ENABLED'",
      );
  });

  it("accepts multiple safe statuses and rejects malformed cursor/status", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(googleCampaignFixture))
      .mockResolvedValueOnce(jsonResponse(googleCustomerHierarchyFixture));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleAdsAdapter(config);
    const context = {
      credentials: { accessToken: "access", scopes: [] },
      accountId: "1234567890",
    };
    await adapter.listCampaigns(context, undefined, 100, undefined, [
      "ENABLED",
      "PAUSED",
    ]);
    expect(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    ).toContain("campaign.status IN ('ENABLED', 'PAUSED')");
    await expect(
      adapter.listCampaigns(context, undefined, 100, "NaN", ["ENABLED"]),
    ).rejects.toMatchObject({ code: "provider_response_invalid" });
    await expect(
      adapter.listCampaigns(context, undefined, 100, undefined, [
        "ENABLED'; DROP TABLE",
      ]),
    ).rejects.toMatchObject({ code: "provider_response_invalid" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps an OAuth refresh rejection safe and diagnosable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: "invalid_grant",
            error_description: "The token has expired or was revoked.",
          },
          400,
        ),
      ),
    );
    const adapter = new GoogleAdsAdapter(config);

    await expect(
      adapter.refreshCredentials({
        accessToken: "access",
        refreshToken: "refresh",
        scopes: ["https://www.googleapis.com/auth/adwords"],
      }),
    ).rejects.toMatchObject({
      code: "refresh_failed",
      providerStatus: "400",
      providerCode: "invalid_grant",
    });
  });

  it("reads keyword inventory, metric batch and duplicates without mutation or per-keyword currency reads", async () => {
    const resourceName = "customers/1234567890/adGroupCriteria/10~5";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              campaign: { id: "1", name: "Search", status: "ENABLED" },
              adGroup: { id: "10", name: "Group", status: "ENABLED" },
              adGroupCriterion: {
                resourceName,
                criterionId: "5",
                keyword: { text: "[clinic]", matchType: "EXACT" },
                status: "ENABLED",
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          {
            results: [
              {
                adGroupCriterion: { resourceName },
                metrics: { costMicros: "1000000", conversions: "0" },
              },
            ],
          },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GoogleAdsAdapter(config).listKeywords(
      {
        credentials: { accessToken: "access", scopes: [] },
        accountId: "1234567890",
        currency: "USD",
      },
      { range: { startDate: "2026-03-01", endDate: "2026-09-28" }, limit: 100 },
    );
    expect(result.items[0]).toMatchObject({
      resource_name: resourceName,
      cost: 1,
      currency: "USD",
      cost_per_conversion: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining("/v24/customers/1234567890/googleAds:search"),
      expect.stringContaining(
        "/v24/customers/1234567890/googleAds:searchStream",
      ),
      expect.stringContaining("/v24/customers/1234567890/googleAds:search"),
    ]);
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => (init as RequestInit).method === "POST",
      ),
    ).toBe(true);
    expect(
      fetchMock.mock.calls.every(
        ([, init]) =>
          !(
            "developer-token" in
            ((init as RequestInit).headers as Record<string, string>)
          ),
      ),
    ).toBe(true);
  });

  it("keeps structured Google errors on the keyword read path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              details: [
                {
                  "@type":
                    "type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure",
                  requestId: "keyword-req-1",
                  errors: [
                    {
                      errorCode: { queryError: "INVALID_FIELD_NAME" },
                      message: "Invalid field",
                      location: { fieldPathElements: [{ fieldName: "query" }] },
                    },
                  ],
                },
              ],
            },
          },
          400,
        ),
      ),
    );
    await expect(
      new GoogleAdsAdapter(config).listKeywords(
        {
          credentials: { accessToken: "access", scopes: [] },
          accountId: "1234567890",
          currency: "USD",
        },
        {
          range: { startDate: "2026-03-01", endDate: "2026-09-28" },
          limit: 100,
        },
      ),
    ).rejects.toMatchObject({
      requestId: "keyword-req-1",
      errors: [
        {
          error_code: "INVALID_FIELD_NAME",
          field_path: "query",
          message: "Invalid field",
        },
      ],
    });
  });

  it("routes Stage 5 inventory and conflict checks through read-only Google Search", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ results: [{
        campaign: { id: "1", name: "Search" },
        campaignCriterion: { resourceName: "customers/1234567890/campaignCriteria/1~5",
          criterionId: "5", keyword: { text: "clinic", matchType: "BROAD" }, status: "ENABLED" },
      }] }))
      .mockResolvedValueOnce(jsonResponse({ results: [{
        campaign: { id: "1", name: "Search", status: "ENABLED" },
        adGroup: { id: "2", name: "Group", status: "ENABLED" },
        adGroupCriterion: { resourceName: "customers/1234567890/adGroupCriteria/2~6",
          criterionId: "6", keyword: { text: "[private clinic]", matchType: "EXACT" },
          status: "ENABLED", negative: false },
      }] }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleAdsAdapter(config);
    const context = {
      credentials: { accessToken: "access", scopes: [] },
      accountId: "1234567890", currency: "USD",
    };
    const inventory = await adapter.listNegatives(context, { levels: ["campaign"], limit: 100 });
    expect(inventory.campaign.campaigns[0]?.negatives[0]?.text).toBe("clinic");
    const conflicts = await adapter.checkNegativeConflicts(context, {
      campaignIds: ["1"], negatives: [{ text: "private", match_type: "BROAD" }], limit: 100,
    });
    expect(conflicts.conflicts[0]?.keyword.text).toBe("[private clinic]");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls) {
      expect(String(url)).toContain("/v24/customers/1234567890/googleAds:search");
      expect((init as RequestInit).method).toBe("POST");
      expect(String((init as RequestInit).body)).not.toContain("mutate");
    }
  });

  it("reads a search-term page in one Google Search request with keyword attribution and no write", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        results: [
          {
            searchTermView: {
              searchTerm: "приват клиника алматы",
              status: "NONE",
            },
            segments: {
              keyword: {
                info: { text: "проктолог алматы", matchType: "BROAD" },
              },
              searchTermMatchType: "BROAD",
            },
            campaign: { id: "1", name: "Search" },
            adGroup: { id: "2", name: "Group" },
            metrics: {
              impressions: "10",
              clicks: "2",
              costMicros: "2500000",
              conversions: "1",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GoogleAdsAdapter(config).listSearchTerms(
      {
        credentials: { accessToken: "access", scopes: [] },
        accountId: "1234567890",
        currency: "USD",
      },
      { range: { startDate: "2026-03-01", endDate: "2026-09-28" }, limit: 100 },
    );
    expect(result.items[0]).toMatchObject({
      search_term: "приват клиника алматы",
      triggered_keyword: "проктолог алматы",
      triggered_keyword_match_type: "BROAD",
      cost: 2.5,
      currency: "USD",
      cost_per_conversion: 2.5,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "/v24/customers/1234567890/googleAds:search",
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(request.method).toBe("POST");
    expect(String(request.body)).toContain("FROM search_term_view");
    expect(String(request.body)).not.toContain("mutate");
  });

  it("preserves structured Google Ads errors on the search-term read path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 400,
              status: "INVALID_ARGUMENT",
              details: [
                {
                  "@type":
                    "type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure",
                  requestId: "terms-req-1",
                  errors: [
                    {
                      errorCode: { queryError: "INVALID_FIELD_NAME" },
                      message: "Invalid field",
                      location: { fieldPathElements: [{ fieldName: "query" }] },
                    },
                  ],
                },
              ],
            },
          },
          400,
        ),
      ),
    );
    await expect(
      new GoogleAdsAdapter(config).listSearchTerms(
        {
          credentials: { accessToken: "access", scopes: [] },
          accountId: "1234567890",
          currency: "USD",
        },
        {
          range: { startDate: "2026-03-01", endDate: "2026-09-28" },
          limit: 100,
        },
      ),
    ).rejects.toMatchObject({
      requestId: "terms-req-1",
      errors: [{ error_code: "INVALID_FIELD_NAME", field_path: "query" }],
    });
  });
});

describe("Google Analytics GA4 adapter", () => {
  it("uses a separate readonly OAuth scope and discovers GA4 properties", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          accountSummaries: [
            {
              displayName: "HolyMedia",
              propertySummaries: [
                { property: "properties/123456", displayName: "Main GA4" },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          displayName: "Main GA4",
          timeZone: "Asia/Almaty",
          currencyCode: "KZT",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleAnalyticsAdapter(config);
    const url = new URL(
      adapter.authorizationUrl({
        state: "state",
        redirectUri: config.providerGoogleAnalyticsRedirectUri!,
      }),
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/analytics.readonly",
    );
    expect(url.searchParams.get("scope")).not.toContain("analytics.edit");
    expect(url.searchParams.get("scope")).not.toContain("adwords");
    await expect(
      adapter.discoverAccounts({
        accessToken: "access",
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      }),
    ).resolves.toMatchObject([
      {
        externalAccountId: "123456",
        displayName: "Main GA4",
        timezone: "Asia/Almaty",
        currency: "KZT",
        metadata: { accountName: "HolyMedia", resourceType: "ga4_property" },
      },
    ]);
  });

  it("runs a bounded Data API report against a GA4 property only", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        rowCount: 1,
        rows: [{ metricValues: [{ value: "42" }] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleAnalyticsAdapter(config);
    await adapter.runReport(
      {
        accessToken: "access",
        scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
      },
      "123456",
      {
        dateRanges: [{ startDate: "2026-08-01", endDate: "2026-08-30" }],
        metrics: ["sessions"],
        limit: 5_000,
      },
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(
      "analyticsdata.googleapis.com/v1beta/properties/123456:runReport",
    );
    expect(String(init.body)).toContain('"limit":1000');
    expect(String(init.body)).not.toContain("analytics.edit");
  });
});

describe("Meta Ads v2 adapter", () => {
  it("does not mix a date preset into campaign discovery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: [
          {
            id: "campaign-1",
            name: "Campaign",
            status: "PAUSED",
            effective_status: "PAUSED",
            objective: "OUTCOME_TRAFFIC",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new MetaAdsAdapter(config);
    await adapter.listCampaigns(
      {
        credentials: { accessToken: "user-token", scopes: ["ads_read"] },
        accountId: "act_1",
      },
      { startDate: "2026-08-15", endDate: "2026-08-21" },
    );
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).searchParams.has("date_preset")).toBe(false);
  });

  it("executes only an explicit campaign mutation with ads_management", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new MetaAdsAdapter(config);
    await adapter.mutateCampaign(
      {
        credentials: {
          accessToken: "user-token",
          scopes: ["ads_read", "ads_management"],
        },
        accountId: "act_1",
      },
      {
        objectId: "120251174838720324",
        operation: "change_name",
        payload: { new_name: "Review test" },
      },
    );
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain("user-token");
    expect(String(init.body)).toContain("name=Review+test");
    expect(String(init.body)).toContain("access_token=user-token");
    expect(String(init.body)).not.toContain("status=");
  });

  it("reads an exact campaign directly from Meta for controlled verification", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        id: "120251139085310324",
        account_id: "1423247033195473",
        name: "hm_saqta_traffic_inst",
        status: "PAUSED",
        effective_status: "PAUSED",
        objective: "OUTCOME_TRAFFIC",
        buying_type: "AUCTION",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new MetaAdsAdapter(config);
    await expect(
      adapter.readControlledCampaign(
        {
          credentials: { accessToken: "user-token", scopes: ["ads_read"] },
          accountId: "act_1423247033195473",
        },
        "120251139085310324",
      ),
    ).resolves.toMatchObject({
      accountId: "act_1423247033195473",
      name: "hm_saqta_traffic_inst",
      status: "PAUSED",
    });
  });

  it("rejects mutation without ads_management", async () => {
    const adapter = new MetaAdsAdapter(config);
    await expect(
      adapter.mutateCampaign(
        {
          credentials: { accessToken: "token", scopes: ["ads_read"] },
          accountId: "act_1",
        },
        { objectId: "campaign-1", operation: "pause", payload: {} },
      ),
    ).rejects.toThrow("ads_management");
  });

  it("discovers ad accounts and follows Page to Instagram through the Page edge", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(metaAdAccountsFixture))
      .mockResolvedValueOnce(jsonResponse(metaPagesFixture))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "110901223663187", access_token: "page-token" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(metaPostsFixture))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: "110901223663187", access_token: "page-token" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: "110901223663187",
          name: "Личное страхование",
          instagram_business_account: {
            id: "17841479968382405",
            username: "saqta_market.kz",
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new MetaAdsAdapter(config);
    const credentials = {
      accessToken: "user-token",
      scopes: [
        "ads_read",
        "business_management",
        "pages_show_list",
        "pages_read_engagement",
      ],
    };
    const accounts = await adapter.discoverAccounts(credentials);
    expect(accounts[0]?.externalAccountId).toBe("act_1423247033195473");
    const pages = await adapter.listPages(credentials);
    expect(pages[0]?.linkedInstagram).toEqual({
      id: "17841479968382405",
      username: "saqta_market.kz",
    });
    const posts = await adapter.listPagePosts(credentials, "110901223663187");
    expect(posts.items).toHaveLength(1);
    const instagram = await adapter.getPageInstagramAccount(
      credentials,
      "110901223663187",
    );
    expect(instagram.linkedInstagram?.username).toBe("saqta_market.kz");
    expect(posts.provenance.sourceApi).toContain("published_posts");
  });
});

describe("V1 partner OAuth adapters", () => {
  it("keeps Yandex Direct callback and client discovery contract", async () => {
    const partnerConfig = loadConfig({
      NODE_ENV: "test",
      PROVIDER_YANDEX_CLIENT_ID: "yandex-client",
      PROVIDER_YANDEX_CLIENT_SECRET: "yandex-secret",
      PROVIDER_YANDEX_REDIRECT_URI:
        "https://mcp.example.test/oauth/yandex/callback",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "yandex-access",
          refresh_token: "yandex-refresh",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          result: {
            Clients: [
              {
                Login: "123456",
                ClientInfo: "Yandex client",
                Currency: "RUB",
                Archived: "NO",
              },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new YandexDirectAdapter(partnerConfig);
    const url = new URL(
      adapter.authorizationUrl({
        state: "state",
        redirectUri: partnerConfig.providerYandexRedirectUri!,
      }),
    );
    expect(url.hostname).toBe("oauth.yandex.ru");
    expect(url.pathname).toBe("/authorize");
    const credentials = await adapter.exchangeCode({
      code: "code",
      redirectUri: partnerConfig.providerYandexRedirectUri!,
    });
    const accounts = await adapter.discoverAccounts(credentials);
    expect(accounts[0]).toMatchObject({
      externalAccountId: "123456",
      currency: "RUB",
      status: "active",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps TikTok advertiser discovery read-only and does not expose app secret", async () => {
    const partnerConfig = loadConfig({
      NODE_ENV: "test",
      PROVIDER_TIKTOK_CLIENT_ID: "tiktok-client",
      PROVIDER_TIKTOK_CLIENT_SECRET: "tiktok-secret",
      PROVIDER_TIKTOK_REDIRECT_URI:
        "https://mcp.example.test/oauth/tiktok/callback",
      PROVIDER_TIKTOK_TOKEN_URI:
        "https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            access_token: "tiktok-access",
            refresh_token: "tiktok-refresh",
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            advertiser_ids: [
              { advertiser_id: "adv-1", advertiser_name: "TikTok client" },
            ],
          },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new TikTokAdsAdapter(partnerConfig);
    const credentials = await adapter.exchangeCode({
      code: "code",
      redirectUri: partnerConfig.providerTikTokRedirectUri!,
    });
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(tokenUrl).toContain("/tt_user/oauth2/token/");
    expect(JSON.parse(String(tokenInit.body))).toMatchObject({
      client_id: "tiktok-client",
      client_secret: "tiktok-secret",
      grant_type: "authorization_code",
      auth_code: "code",
      redirect_uri: "https://mcp.example.test/oauth/tiktok/callback",
    });
    expect(credentials).not.toHaveProperty("clientSecret");
    const accounts = await adapter.discoverAccounts(credentials);
    expect(accounts).toEqual([
      expect.objectContaining({
        externalAccountId: "adv-1",
        displayName: "TikTok client",
      }),
    ]);
  });

  it("maps a TikTok HTTP-200 error payload to a safe provider error", async () => {
    const partnerConfig = loadConfig({
      NODE_ENV: "test",
      PROVIDER_TIKTOK_CLIENT_ID: "tiktok-client",
      PROVIDER_TIKTOK_CLIENT_SECRET: "tiktok-secret",
      PROVIDER_TIKTOK_REDIRECT_URI:
        "https://mcp.example.test/oauth/tiktok/callback",
    });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ code: 40100, message: "permission denied" }),
        ),
    );
    const adapter = new TikTokAdsAdapter(partnerConfig);
    await expect(
      adapter.exchangeCode({
        code: "code",
        redirectUri: partnerConfig.providerTikTokRedirectUri!,
      }),
    ).rejects.toMatchObject({
      code: "insufficient_permissions",
      providerCode: "40100",
    });
  });
});

describe("Google Search Console v2 adapter", () => {
  it("preserves the V1 callback, discovers properties, and reads analytics", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          siteEntry: [
            {
              siteUrl: "https://holymedia.kz/",
              permissionLevel: "siteOwner",
            },
            {
              siteUrl: "sc-domain:holymedia.kz",
              permissionLevel: "siteFullUser",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          rows: [
            {
              keys: ["holy media"],
              clicks: 12,
              impressions: 240,
              ctr: 0.05,
              position: 3.2,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          sitemap: [{ path: "https://holymedia.kz/sitemap.xml" }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new GoogleSearchConsoleAdapter(config);
    const url = new URL(
      adapter.authorizationUrl({
        state: "state",
        redirectUri: config.providerGoogleSearchConsoleRedirectUri!,
      }),
    );
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/webmasters.readonly",
    );
    const credentials = { accessToken: "search-access", scopes: [] };
    const properties = await adapter.discoverAccounts(credentials);
    expect(properties[0]).toMatchObject({
      externalAccountId: "https://holymedia.kz/",
      displayName: "https://holymedia.kz/",
    });
    const rows = await adapter.querySearchAnalytics(
      credentials,
      "https://holymedia.kz/",
      "2026-01-01",
      "2026-01-07",
      ["query"],
      25,
    );
    expect(rows[0]?.clicks).toBe(12);
    const sitemaps = await adapter.listSitemaps(
      credentials,
      "https://holymedia.kz/",
    );
    expect(sitemaps[0]?.path).toContain("sitemap.xml");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

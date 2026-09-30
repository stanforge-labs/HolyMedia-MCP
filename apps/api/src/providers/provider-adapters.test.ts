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
      .mockResolvedValue(jsonResponse(googleCampaignFixture));
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

  it.each([
    ["change_name", { new_name: "Public name", status: "IGNORED" }, { name: "Public name" }],
    ["pause", { name: "IGNORED" }, { status: "PAUSED" }],
    ["resume", { name: "IGNORED" }, { status: "ACTIVE" }],
  ] as const)("sends only the %s business field to Meta", async (operation, payload, expected) => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true }));
    vi.stubGlobal("fetch", fetchMock);
    await new MetaAdsAdapter(config).mutateCampaign(
      {
        credentials: { accessToken: "fake-user-token", scopes: ["ads_read", "ads_management"] },
        accountId: "act_1",
      },
      { objectId: "120251174838720324", operation, payload },
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = new URLSearchParams(String(init.body));
    body.delete("access_token");
    expect(Object.fromEntries(body)).toEqual(expected);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

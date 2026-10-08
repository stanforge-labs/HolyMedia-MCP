import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./index.js";

describe("v2 configuration", () => {
  it("defaults Google writes OFF and normalizes a separate deny-by-default account allowlist", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(config.providerGoogleAdsWriteEnabled).toBe(false);
    expect(config.providerGoogleAdsStage2WriteEnabled).toBe(false);
    expect(config.googleAdsWriteAccountAllowlist).toEqual([]);
    expect(
      loadConfig({
        NODE_ENV: "test",
        PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "false",
        GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST:
          "123-456-7890,1234567890, 9999999999",
      }),
    ).toMatchObject({
      providerGoogleAdsWriteEnabled: false,
      googleAdsWriteAccountAllowlist: ["1234567890", "9999999999"],
    });
    expect(() =>
      loadConfig({
        NODE_ENV: "test",
        GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "act_123",
      }),
    ).toThrow(/GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST/);
  });
  it("canonicalizes public origins and rejects issuer-confusing URLs", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        HOLYMEDIA_PUBLIC_BASE_URL: "https://local.example.test/",
      }).publicBaseUrl,
    ).toBe("https://local.example.test");
    for (const value of [
      "https://example.test/path",
      "https://example.test/?x=1",
      "https://example.test/#part",
      "https://user:pass@example.test/",
      "http://example.test/",
    ]) {
      expect(() =>
        loadConfig({ NODE_ENV: "test", HOLYMEDIA_PUBLIC_BASE_URL: value }),
      ).toThrow(/HOLYMEDIA_PUBLIC_BASE_URL/);
    }
    expect(() =>
      loadConfig({
        NODE_ENV: "staging",
        HOLYMEDIA_PUBLIC_BASE_URL: "http://localhost:3000",
      }),
    ).toThrow(/HOLYMEDIA_PUBLIC_BASE_URL/);
    expect(
      loadConfig({
        NODE_ENV: "test",
        HOLYMEDIA_PUBLIC_BASE_URL: "http://localhost:3000",
      }).publicBaseUrl,
    ).toBe("http://localhost:3000");
  });
  it("keeps owner admin access disabled until an environment secret is supplied", () => {
    const base = {
      NODE_ENV: "test" as const,
      DATABASE_URL:
        "postgresql://holymedia:change-me@localhost:5433/holymedia_v2",
      REDIS_URL: "redis://localhost:6380",
      CORS_ORIGINS: "http://localhost:3000",
      SESSION_HASH_SECRET: "test-session-hash-secret-01234567890123456789",
    };
    expect(loadConfig(base).adminEnabled).toBe(false);
    const configured = loadConfig({
      ...base,
      HOLYMEDIA_ADMIN_PASSWORD: randomUUID(),
    });
    expect(configured.adminEnabled).toBe(true);
    expect(configured.adminLogin).toBe("Admin");
  });

  it("parses the string false as boolean false", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      V2_CONFIG_STRICT: "false",
      DATABASE_URL:
        "postgresql://holymedia:change-me@localhost:5433/holymedia_v2",
      REDIS_URL: "redis://localhost:6380",
      CORS_ORIGINS: "http://localhost:3000",
      SESSION_HASH_SECRET: "test-session-hash-secret-01234567890123456789",
    });

    expect(config.configStrict).toBe(false);
    expect(config.environment).toBe("test");
    expect(config.siteAuditProductEnabled).toBe(false);
  });

  it("keeps Site Audit creation disabled unless explicitly enabled", () => {
    expect(loadConfig({ NODE_ENV: "test" }).siteAuditProductEnabled).toBe(
      false,
    );
    expect(
      loadConfig({
        NODE_ENV: "test",
        SITE_AUDIT_PRODUCT_ENABLED: "true",
      }).siteAuditProductEnabled,
    ).toBe(true);
  });

  it("keeps Telegram support delivery disabled until both protected values exist", () => {
    const base = {
      NODE_ENV: "test" as const,
      DATABASE_URL:
        "postgresql://holymedia:change-me@localhost:5433/holymedia_v2",
      REDIS_URL: "redis://localhost:6380",
      CORS_ORIGINS: "https://mcp.holymedia.kz",
      SESSION_HASH_SECRET: "test-session-hash-secret-01234567890123456789",
    };
    expect(
      loadConfig({
        ...base,
        TELEGRAM_SUPPORT_BOT_TOKEN: "",
        TELEGRAM_SUPPORT_CHAT_ID: "",
      }).telegramSupportBotToken,
    ).toBeUndefined();
    expect(
      loadConfig({
        ...base,
        HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp.holymedia.kz/",
        TELEGRAM_SUPPORT_BOT_TOKEN: "test-telegram-token-000000",
        TELEGRAM_SUPPORT_CHAT_ID: "-1001234567890",
      }),
    ).toMatchObject({
      publicBaseUrl: "https://mcp.holymedia.kz",
      telegramSupportChatId: "-1001234567890",
    });
  });

  it("parses confirmed-write allowlists without enabling writes", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      V2_PREVIEW_ONLY: "true",
      V2_CONFIRMED_WRITE_ENABLED: "false",
      V2_WRITE_ACCOUNT_ALLOWLIST: "act_1, act_2",
      V2_WRITE_OBJECT_ALLOWLIST: "campaign-1",
      V2_WRITE_OPERATION_ALLOWLIST: "change_name",
    });
    expect(config.previewOnly).toBe(true);
    expect(config.confirmedWriteEnabled).toBe(false);
    expect(config.writeAccountAllowlist).toEqual(["act_1", "act_2"]);
    expect(config.writeObjectAllowlist).toEqual(["campaign-1"]);
    expect(config.writeOperationAllowlist).toEqual(["change_name"]);
    expect(config.publicMcpControlledWriteEnabled).toBe(false);
    expect(config.publicMcpWriteScopeEnabled).toBe(false);
  });

  it("requires an independent explicit flag for public controlled writes", () => {
    expect(
      loadConfig({ NODE_ENV: "test" }).publicMcpControlledWriteEnabled,
    ).toBe(false);
    expect(
      loadConfig({
        NODE_ENV: "test",
        PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "true",
      }).publicMcpControlledWriteEnabled,
    ).toBe(true);
  });

  it("requires a separate explicit flag before OAuth may grant public write scope", () => {
    expect(loadConfig({ NODE_ENV: "test" }).publicMcpWriteScopeEnabled).toBe(
      false,
    );
    expect(
      loadConfig({ NODE_ENV: "test", PUBLIC_MCP_WRITE_SCOPE_ENABLED: "true" })
        .publicMcpWriteScopeEnabled,
    ).toBe(true);
    expect(
      loadConfig({
        NODE_ENV: "test",
        PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "true",
      }).publicMcpWriteScopeEnabled,
    ).toBe(false);
  });

  it("keeps the Meta App Review rename policy disabled unless explicitly configured", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      V2_META_APP_REVIEW_RENAME_ENABLED: "true",
      V2_META_APP_REVIEW_RENAME_ACCOUNT_ID: "act_1423247033195473",
      V2_META_APP_REVIEW_RENAME_CAMPAIGN_ID: "120251139085310324",
      V2_META_APP_REVIEW_RENAME_EXPECTED_NAME: "hm_saqta_traffic_inst",
      V2_META_APP_REVIEW_RENAME_TARGET_NAME: "hm_saqta_traffic_inst_rename",
    });
    expect(config).toMatchObject({
      metaAppReviewRenameEnabled: true,
      metaAppReviewRenameAccountId: "act_1423247033195473",
      metaAppReviewRenameCampaignId: "120251139085310324",
      metaAppReviewRenameTargetName: "hm_saqta_traffic_inst_rename",
    });
  });

  it("enforces strict configuration for production-like environments", () => {
    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        V2_CONFIG_STRICT: "false",
        DATABASE_URL:
          "postgresql://holymedia:change-me@localhost:5433/holymedia_v2",
        REDIS_URL: "redis://localhost:6380",
        CORS_ORIGINS: "https://example.com",
        SESSION_HASH_SECRET: "test-session-hash-secret-01234567890123456789",
      }),
    ).toThrow(/Production-like v2 configuration/);
  });

  it("maps existing V1 provider env names without changing callback paths", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      V2_CONFIG_STRICT: "false",
      DATABASE_URL:
        "postgresql://holymedia:change-me@localhost:5433/holymedia_v2",
      REDIS_URL: "redis://localhost:6380",
      CORS_ORIGINS: "https://mcp.holymedia.kz",
      SESSION_HASH_SECRET: "test-session-hash-secret-01234567890123456789",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_GOOGLE_OAUTH_CLIENT_ID: "google-client",
      AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN: "developer-token",
      AD_MCP_GOOGLE_OAUTH_REDIRECT_PATH: "/oauth/google/callback",
      AD_MCP_META_OAUTH_APP_ID: "meta-app",
      AD_MCP_META_OAUTH_APP_SECRET: "meta-secret",
      AD_MCP_META_OAUTH_REDIRECT_PATH: "/oauth/meta/callback",
    });

    expect(config.providerGoogleClientId).toBe("google-client");
    expect(config.providerGoogleRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/google/callback",
    );
    expect(config.providerMetaClientId).toBe("meta-app");
    expect(config.providerMetaRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/meta/callback",
    );
  });

  it("maps V1 Yandex and TikTok configuration without changing callback paths", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_TIKTOK_OAUTH_APP_ID: "tiktok-app",
      AD_MCP_TIKTOK_OAUTH_APP_SECRET: "tiktok-secret",
      AD_MCP_TIKTOK_OAUTH_REDIRECT_PATH: "/oauth/tiktok/callback",
      AD_MCP_YANDEX_OAUTH_CLIENT_ID: "yandex-client",
      AD_MCP_YANDEX_OAUTH_CLIENT_SECRET: "yandex-secret",
      AD_MCP_YANDEX_OAUTH_REDIRECT_PATH: "/oauth/yandex/callback",
    });

    expect(config.providerTikTokClientId).toBe("tiktok-app");
    expect(config.providerTikTokRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/tiktok/callback",
    );
    expect(config.providerYandexClientId).toBe("yandex-client");
    expect(config.providerYandexRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/yandex/callback",
    );
  });

  it("maps the existing Search Console callback without creating a new OAuth contract", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_GOOGLE_OAUTH_CLIENT_ID: "google-client",
      AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      AD_MCP_GOOGLE_SEARCH_CONSOLE_SCOPES:
        "https://www.googleapis.com/auth/webmasters.readonly",
      AD_MCP_GOOGLE_SEARCH_CONSOLE_REDIRECT_PATH:
        "/oauth/google-search-console/callback",
    });

    expect(config.providerGoogleSearchConsoleClientId).toBe("google-client");
    expect(config.providerGoogleSearchConsoleRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/google-search-console/callback",
    );
    expect(config.providerGoogleSearchConsoleScopes).toContain(
      "webmasters.readonly",
    );
  });

  it("keeps GA4 OAuth credentials and callback logically separate from Google Ads", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_GOOGLE_OAUTH_CLIENT_ID: "google-client",
      AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET: "google-secret",
      AD_MCP_GOOGLE_OAUTH_REDIRECT_PATH: "/oauth/google/callback",
      AD_MCP_GOOGLE_ANALYTICS_REDIRECT_PATH: "/oauth/google-analytics/callback",
    });

    expect(config.providerGoogleClientId).toBe("google-client");
    expect(config.providerGoogleRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/google/callback",
    );
    expect(config.providerGoogleAnalyticsClientId).toBe("google-client");
    expect(config.providerGoogleAnalyticsRedirectUri).toBe(
      "https://mcp.holymedia.kz/oauth/google-analytics/callback",
    );
    expect(config.providerGoogleAnalyticsRedirectUri).not.toBe(
      config.providerGoogleRedirectUri,
    );
  });

  it("maps the legacy Google Login client and callback", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_GOOGLE_LOGIN_CLIENT_ID: "login-client",
      AD_MCP_GOOGLE_LOGIN_CLIENT_SECRET: "login-secret",
      AD_MCP_GOOGLE_LOGIN_REDIRECT_PATH: "/auth/google/callback",
    });

    expect(config.providerGoogleLoginClientId).toBe("login-client");
    expect(config.providerGoogleLoginClientSecret).toBe("login-secret");
    expect(config.providerGoogleLoginRedirectUri).toBe(
      "https://mcp.holymedia.kz/auth/google/callback",
    );
  });

  it("keeps the historical Google Login callback when the V1 path is implicit", () => {
    const config = loadConfig({
      NODE_ENV: "test",
      AD_MCP_PUBLIC_BASE_URL: "https://mcp.holymedia.kz",
      AD_MCP_GOOGLE_LOGIN_CLIENT_ID: "login-client",
      AD_MCP_GOOGLE_LOGIN_CLIENT_SECRET: "login-secret",
    });

    expect(config.providerGoogleLoginRedirectUri).toBe(
      "https://mcp.holymedia.kz/auth/google/callback",
    );
  });
});

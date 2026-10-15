import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { loadConfig } from "./index.js";

describe("v2 configuration", () => {
  it("defaults Google writes OFF and normalizes a separate deny-by-default account allowlist", () => {
    const config = loadConfig({ NODE_ENV: "test" });
    expect(config.providerGoogleAdsWriteEnabled).toBe(false);
    expect(config.providerGoogleAdsStage2WriteEnabled).toBe(false);
    expect(config.providerGoogleAdsStage3WriteEnabled).toBe(false);
    expect(config.providerGoogleAdsStage4WriteEnabled).toBe(false);
    expect(config.qrsTestGoogleConfirmedWriteEnabled).toBe(false);
    expect(config.qrsTestCloneConfirmedWriteEnabled).toBe(false);
    expect(config.qrsTestCloneSourceCampaignId).toBeUndefined();
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
  it("keeps explicit TEST OWNER Google binding disabled and fail-closed outside the exact TEST runtime", () => {
    const userId = randomUUID();
    const binding = {
      NODE_ENV: "test",
      HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp-test.holymedia.kz",
      GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
      QRS_TEST_RESTRICTED_AUTH: "true",
      QRS_TEST_GOOGLE_OWNER_BINDING_EMAIL: "google-owner@example.test",
      QRS_TEST_GOOGLE_OWNER_BINDING_USER_ID: userId,
    };
    expect(loadConfig({ NODE_ENV: "test" })).toMatchObject({
      qrsTestGoogleOwnerBindingEmail: undefined,
      qrsTestGoogleOwnerBindingUserId: undefined,
    });
    expect(loadConfig(binding)).toMatchObject({
      qrsTestGoogleOwnerBindingEmail: "google-owner@example.test",
      qrsTestGoogleOwnerBindingUserId: userId,
    });
    for (const invalid of [
      { QRS_TEST_GOOGLE_OWNER_BINDING_USER_ID: undefined },
      { QRS_TEST_RESTRICTED_AUTH: "false" },
      { HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp.holymedia.kz" },
      { GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "4378327049" },
      { QRS_TEST_GOOGLE_OWNER_BINDING_EMAIL: "Google-Owner@example.test" },
      { QRS_TEST_GOOGLE_OWNER_BINDING_USER_ID: "not-a-uuid" },
    ]) {
      expect(() => loadConfig({ ...binding, ...invalid })).toThrow(
        /TEST Google OWNER binding|Restricted TEST MCP/,
      );
    }
  });
  it("rejects restricted TEST startup without the exact read boundary even before OWNER binding", () => {
    for (const invalid of [
      { GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "" },
      { GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099,4378327049" },
      { HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp.holymedia.kz" },
    ])
      expect(() =>
        loadConfig({
          NODE_ENV: "test",
          QRS_TEST_RESTRICTED_AUTH: "true",
          HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp-test.holymedia.kz",
          GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
          ...invalid,
        }),
      ).toThrow(/Restricted TEST MCP/);
  });
  it("enables a dedicated Q/R/S Google commit gate only with exact TEST isolation and generic writes OFF", () => {
    const isolated = {
      NODE_ENV: "test",
      HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp-test.holymedia.kz",
      QRS_TEST_RESTRICTED_AUTH: "true",
      QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED: "true",
      PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
      GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
      V2_PREVIEW_ONLY: "true",
      V2_CONFIRMED_WRITE_ENABLED: "false",
      PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
      PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
    };
    expect(loadConfig(isolated)).toMatchObject({
      qrsTestRestrictedAuth: true,
      qrsTestGoogleConfirmedWriteEnabled: true,
      providerGoogleAdsWriteEnabled: true,
      previewOnly: true,
      confirmedWriteEnabled: false,
      publicMcpWriteScopeEnabled: false,
      publicMcpControlledWriteEnabled: false,
      googleAdsWriteAccountAllowlist: ["8590146099"],
    });
    for (const unsafe of [
      { QRS_TEST_RESTRICTED_AUTH: "false" },
      { HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp.holymedia.kz" },
      { GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "4378327049" },
      { PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "false" },
      { V2_PREVIEW_ONLY: "false" },
      { V2_CONFIRMED_WRITE_ENABLED: "true" },
      { PUBLIC_MCP_WRITE_SCOPE_ENABLED: "true" },
      { PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "true" },
      { PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "true" },
      { PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true" },
      { PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true" },
    ])
      expect(() => loadConfig({ ...isolated, ...unsafe })).toThrow(
        /Q\/R\/S Google confirmed write|Restricted TEST MCP/,
      );
  });
  it("binds the separate Clone commit gate to one TEST source and rejects every broader write surface", () => {
    const isolated = {
      NODE_ENV: "test",
      HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp-test.holymedia.kz",
      QRS_TEST_RESTRICTED_AUTH: "true",
      QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED: "true",
      QRS_TEST_CLONE_SOURCE_CAMPAIGN_ID: "24341802696",
      PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
      GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
      V2_PREVIEW_ONLY: "true",
      V2_CONFIRMED_WRITE_ENABLED: "false",
    };
    expect(loadConfig(isolated)).toMatchObject({
      qrsTestCloneConfirmedWriteEnabled: true,
      qrsTestCloneSourceCampaignId: "24341802696",
      qrsTestGoogleConfirmedWriteEnabled: false,
      previewOnly: true,
      confirmedWriteEnabled: false,
      googleAdsWriteAccountAllowlist: ["8590146099"],
    });
    for (const unsafe of [
      { QRS_TEST_CLONE_SOURCE_CAMPAIGN_ID: undefined },
      { QRS_TEST_CLONE_SOURCE_CAMPAIGN_ID: "not-an-id" },
      { QRS_TEST_RESTRICTED_AUTH: "false" },
      { QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED: "true" },
      { HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp.holymedia.kz" },
      { GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "4378327049" },
      { PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "false" },
      { V2_PREVIEW_ONLY: "false" },
      { V2_CONFIRMED_WRITE_ENABLED: "true" },
      { PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "true" },
      { PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true" },
      { PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true" },
      { PUBLIC_MCP_WRITE_SCOPE_ENABLED: "true" },
      { PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "true" },
    ])
      expect(() => loadConfig({ ...isolated, ...unsafe })).toThrow(
        /TEST Clone confirmed write|Restricted TEST MCP|Q\/R\/S Google confirmed write|QRS_TEST_CLONE_SOURCE_CAMPAIGN_ID/,
      );
  });
  it("keeps PMax TEST profiles default-OFF and rejects generic, Public, production or unbound profiles", () => {
    expect(
      loadConfig({ NODE_ENV: "test" }).qrsTestPmaxConfirmedWriteEnabled,
    ).toBe(false);
    const isolated = {
      NODE_ENV: "test",
      HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp-test.holymedia.kz",
      QRS_TEST_RESTRICTED_AUTH: "true",
      QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED: "true",
      QRS_TEST_PMAX_ALLOWED_ACTIONS: "pmax_create,asset_group_update",
      QRS_TEST_PMAX_CAMPAIGN_NAME: "HM HolyPilot PAUSED fixture",
      QRS_TEST_PMAX_PARENT_CAMPAIGN_ID: "24364218182",
      PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
      GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
      V2_PREVIEW_ONLY: "true",
      V2_CONFIRMED_WRITE_ENABLED: "false",
      PROVIDER_GOOGLE_API_VERSION: "v24",
    };
    expect(loadConfig(isolated)).toMatchObject({
      qrsTestPmaxConfirmedWriteEnabled: true,
      qrsTestPmaxAllowedActions: ["pmax_create", "asset_group_update"],
      confirmedWriteEnabled: false,
      providerGoogleAdsStage4WriteEnabled: false,
    });
    const theme = {
      ...isolated,
      QRS_TEST_PMAX_ALLOWED_ACTIONS: "pmax_search_theme_add,pmax_signal_remove",
      QRS_TEST_PMAX_PARENT_ASSET_GROUP_ID: "204741020281",
      QRS_TEST_PMAX_SEARCH_THEME: "personal AI marketer",
    };
    expect(loadConfig(theme).qrsTestPmaxAllowedActions).toEqual([
      "pmax_search_theme_add",
      "pmax_signal_remove",
    ]);
    expect(() =>
      loadConfig({ ...theme, QRS_TEST_PMAX_PARENT_ASSET_GROUP_ID: undefined }),
    ).toThrow();
    expect(() =>
      loadConfig({ ...theme, QRS_TEST_PMAX_SEARCH_THEME: undefined }),
    ).toThrow();
    for (const unsafe of [
      { HOLYMEDIA_PUBLIC_BASE_URL: "https://mcp.holymedia.kz" },
      { QRS_TEST_RESTRICTED_AUTH: "false" },
      { QRS_TEST_PMAX_ALLOWED_ACTIONS: "pmax_negative_add" },
      { QRS_TEST_PMAX_ALLOWED_ACTIONS: "pmax_create,pmax_create" },
      { QRS_TEST_PMAX_CAMPAIGN_NAME: undefined },
      { QRS_TEST_PMAX_PARENT_CAMPAIGN_ID: undefined },
      { GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "4378327049" },
      { PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "false" },
      { V2_PREVIEW_ONLY: "false" },
      { V2_CONFIRMED_WRITE_ENABLED: "true" },
      { PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "true" },
      { PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true" },
      { PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true" },
      { PUBLIC_MCP_WRITE_SCOPE_ENABLED: "true" },
      { PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "true" },
      { QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED: "true" },
      { QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED: "true" },
    ])
      expect(() => loadConfig({ ...isolated, ...unsafe })).toThrow();
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

import { z } from "zod";

const environmentSchema = z.enum([
  "development",
  "test",
  "staging",
  "production",
]);

const booleanFromEnv = z.preprocess(
  (value) =>
    typeof value === "string" ? value.trim().toLowerCase() === "true" : value,
  z.boolean(),
);

const rawConfigSchema = z.object({
  NODE_ENV: environmentSchema.default("development"),
  V2_CONFIG_STRICT: booleanFromEnv.default(false),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .url()
    .default("postgresql://holymedia:change-me@localhost:5433/holymedia_v2"),
  REDIS_URL: z.string().url().default("redis://localhost:6380"),
  CORS_ORIGINS: z.string().default("http://localhost:3000"),
  SESSION_HASH_SECRET: z.string().default("dev-session-hash-secret-change-me"),
  PROVIDER_CREDENTIAL_ENCRYPTION_KEYS: z.string().optional(),
  PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION: z.coerce
    .number()
    .int()
    .min(1)
    .default(1),
  PROVIDER_GOOGLE_CLIENT_ID: z.string().optional(),
  PROVIDER_GOOGLE_CLIENT_SECRET: z.string().optional(),
  PROVIDER_GOOGLE_REDIRECT_URI: z.string().url().optional(),
  // Deprecated after Google Ads API developer-token sunset. Accepted for
  // backward-compatible env loading, but the V2 REST adapter never sends it.
  PROVIDER_GOOGLE_DEVELOPER_TOKEN: z.string().optional(),
  PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: z
    .string()
    .regex(/^\d{10}$/)
    .optional(),
  PROVIDER_GOOGLE_API_VERSION: z
    .string()
    .regex(/^v?\d+$/)
    .default("v24"),
  PROVIDER_GOOGLE_ADS_WRITE_ENABLED: booleanFromEnv.default(false),
  PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: booleanFromEnv.default(false),
  PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: booleanFromEnv.default(false),
  PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: booleanFromEnv.default(false),
  GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: z.string().default(""),
  PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_ID: z.string().optional(),
  PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET: z.string().optional(),
  PROVIDER_GOOGLE_SEARCH_CONSOLE_REDIRECT_URI: z.string().url().optional(),
  PROVIDER_GOOGLE_SEARCH_CONSOLE_SCOPES: z
    .string()
    .default("https://www.googleapis.com/auth/webmasters.readonly"),
  // GA4 deliberately owns a separate provider credential and callback. The
  // OAuth client itself may be shared with Google Ads only when this explicit
  // configuration points at that same client in protected environment storage.
  PROVIDER_GOOGLE_ANALYTICS_CLIENT_ID: z.string().optional(),
  PROVIDER_GOOGLE_ANALYTICS_CLIENT_SECRET: z.string().optional(),
  PROVIDER_GOOGLE_ANALYTICS_REDIRECT_URI: z.string().url().optional(),
  PROVIDER_GOOGLE_LOGIN_CLIENT_ID: z.string().optional(),
  PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET: z.string().optional(),
  PROVIDER_GOOGLE_LOGIN_REDIRECT_URI: z.string().url().optional(),
  PROVIDER_GOOGLE_LOGIN_SCOPES: z.string().default("openid email profile"),
  QRS_TEST_RESTRICTED_AUTH: booleanFromEnv.default(false),
  QRS_TEST_LOCAL_READONLY_AUTH: booleanFromEnv.default(false),
  QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED: booleanFromEnv.default(false),
  QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED: booleanFromEnv.default(false),
  QRS_TEST_CLONE_SOURCE_CAMPAIGN_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED: booleanFromEnv.default(false),
  QRS_TEST_PMAX_ALLOWED_ACTIONS: z.string().default(""),
  QRS_TEST_PMAX_CAMPAIGN_NAME: z.string().min(1).max(255).optional(),
  QRS_TEST_PMAX_GROUP_NAME: z.string().min(1).max(128).optional(),
  QRS_TEST_PMAX_FINAL_URL: z.literal("https://mcp.holymedia.kz/").optional(),
  QRS_TEST_PMAX_CONVERSION_ACTION_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_GEO_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_LANGUAGE_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_PARENT_CAMPAIGN_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_PARENT_ASSET_GROUP_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_SEARCH_THEME: z.string().min(1).max(80).optional(),
  QRS_TEST_PMAX_NEGATIVE_TEXT: z.string().min(1).max(80).optional(),
  QRS_TEST_PMAX_AUDIENCE_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_BRAND_SHARED_SET_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_ASSET_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_CRITERION_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_PMAX_ASSET_FIELD_TYPE: z
    .enum([
      "HEADLINE",
      "LONG_HEADLINE",
      "DESCRIPTION",
      "MARKETING_IMAGE",
      "SQUARE_MARKETING_IMAGE",
      "LOGO",
      "BUSINESS_NAME",
    ])
    .optional(),
  QRS_TEST_PMAX_REPLACEMENT_TEXT: z.string().min(1).max(90).optional(),
  QRS_TEST_PMAX_REPLACEMENT_ASSET_ID: z
    .string()
    .regex(/^[1-9][0-9]{0,19}$/)
    .optional(),
  QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED:
    booleanFromEnv.default(false),
  QRS_TEST_CONVERSION_ACTION_NAME: z.string().min(1).max(100).optional(),
  QRS_TEST_GOOGLE_OWNER_BINDING_EMAIL: z.string().optional(),
  QRS_TEST_GOOGLE_OWNER_BINDING_USER_ID: z.string().optional(),
  PROVIDER_META_CLIENT_ID: z.string().optional(),
  PROVIDER_META_CLIENT_SECRET: z.string().optional(),
  PROVIDER_META_REDIRECT_URI: z.string().url().optional(),
  PROVIDER_META_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .default("v20.0"),
  PROVIDER_META_ADS_MANAGEMENT_OAUTH_ENABLED: booleanFromEnv.default(false),
  V2_PREVIEW_ONLY: booleanFromEnv.default(true),
  V2_CONFIRMED_WRITE_ENABLED: booleanFromEnv.default(false),
  PUBLIC_MCP_WRITE_SCOPE_ENABLED: booleanFromEnv.default(false),
  PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: booleanFromEnv.default(false),
  V2_WRITE_ACCOUNT_ALLOWLIST: z.string().default(""),
  V2_WRITE_OBJECT_ALLOWLIST: z.string().default(""),
  V2_WRITE_OPERATION_ALLOWLIST: z.string().default(""),
  // Deliberately narrower than the legacy confirmed-write allowlists. This is
  // an opt-in, one-resource policy used solely for a Meta App Review demo.
  V2_META_APP_REVIEW_RENAME_ENABLED: booleanFromEnv.default(false),
  V2_META_APP_REVIEW_SECOND_RENAME_ENABLED: booleanFromEnv.default(false),
  V2_META_APP_REVIEW_RENAME_ACCOUNT_ID: z.string().default(""),
  V2_META_APP_REVIEW_RENAME_CAMPAIGN_ID: z.string().default(""),
  V2_META_APP_REVIEW_RENAME_EXPECTED_NAME: z.string().default(""),
  V2_META_APP_REVIEW_RENAME_TARGET_NAME: z.string().default(""),
  SITE_AUDIT_PRODUCT_ENABLED: booleanFromEnv.default(false),
  PROVIDER_TIKTOK_CLIENT_ID: z.string().optional(),
  PROVIDER_TIKTOK_CLIENT_SECRET: z.string().optional(),
  PROVIDER_TIKTOK_REDIRECT_URI: z.string().url().optional(),
  PROVIDER_TIKTOK_AUTH_URI: z
    .string()
    .url()
    .default("https://ads.tiktok.com/marketing_api/auth"),
  PROVIDER_TIKTOK_TOKEN_URI: z
    .string()
    .url()
    .default(
      "https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/token/",
    ),
  PROVIDER_TIKTOK_ADVERTISER_URI: z
    .string()
    .url()
    .default(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/advertiser/get/",
    ),
  PROVIDER_TIKTOK_SCOPES: z.string().default(""),
  PROVIDER_TIKTOK_ADVERTISER_ID: z.string().optional(),
  PROVIDER_YANDEX_CLIENT_ID: z.string().optional(),
  PROVIDER_YANDEX_CLIENT_SECRET: z.string().optional(),
  PROVIDER_YANDEX_REDIRECT_URI: z.string().url().optional(),
  PROVIDER_YANDEX_AUTH_URI: z
    .string()
    .url()
    .default("https://oauth.yandex.ru/authorize"),
  PROVIDER_YANDEX_TOKEN_URI: z
    .string()
    .url()
    .default("https://oauth.yandex.ru/token"),
  PROVIDER_YANDEX_CLIENTS_URI: z
    .string()
    .url()
    .default("https://api.direct.yandex.com/json/v5/clients"),
  PROVIDER_YANDEX_SCOPE: z.string().default("direct:api"),
  PROVIDER_YANDEX_LOGIN: z.string().optional(),
  PROVIDER_YANDEX_CLIENT_LOGIN: z.string().optional(),
  PROVIDER_HTTP_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1000)
    .max(120000)
    .default(20000),
  COOKIE_DOMAIN: z.string().optional(),
  HOLYMEDIA_ADMIN_ENABLED: booleanFromEnv.default(true),
  HOLYMEDIA_ADMIN_PASSWORD: z.string().min(16).max(256).optional(),
  HOLYMEDIA_ADMIN_SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24)
    .default(8),
  HOLYMEDIA_PUBLIC_BASE_URL: z.string().url().optional(),
  TELEGRAM_SUPPORT_BOT_TOKEN: z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? undefined : value),
    z.string().min(20).optional(),
  ),
  TELEGRAM_SUPPORT_CHAT_ID: z.preprocess(
    (value) => (typeof value === "string" && !value.trim() ? undefined : value),
    z.string().min(1).max(64).optional(),
  ),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  EMAIL_TOKEN_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(60),
  ARGON2_MEMORY_KIB: z.coerce
    .number()
    .int()
    .min(8192)
    .max(262144)
    .default(19456),
  ARGON2_TIME_COST: z.coerce.number().int().min(2).max(10).default(2),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(4).default(1),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
});

export type AppEnvironment = z.infer<typeof environmentSchema>;

export type AppConfig = {
  environment: AppEnvironment;
  configStrict: boolean;
  apiPort: number;
  webPort: number;
  databaseUrl: string;
  redisUrl: string;
  corsOrigins: string[];
  sessionHashSecret: string;
  providerCredentialEncryptionKeys: string | undefined;
  providerCredentialCurrentKeyVersion: number;
  providerGoogleClientId: string | undefined;
  providerGoogleClientSecret: string | undefined;
  providerGoogleRedirectUri: string | undefined;
  providerGoogleDeveloperToken: string | undefined;
  providerGoogleLoginCustomerId: string | undefined;
  providerGoogleApiVersion: string;
  providerGoogleAdsWriteEnabled: boolean;
  providerGoogleAdsStage2WriteEnabled: boolean;
  providerGoogleAdsStage3WriteEnabled: boolean;
  providerGoogleAdsStage4WriteEnabled: boolean;
  googleAdsWriteAccountAllowlist: string[];
  providerGoogleSearchConsoleClientId: string | undefined;
  providerGoogleSearchConsoleClientSecret: string | undefined;
  providerGoogleSearchConsoleRedirectUri: string | undefined;
  providerGoogleSearchConsoleScopes: string;
  providerGoogleAnalyticsClientId: string | undefined;
  providerGoogleAnalyticsClientSecret: string | undefined;
  providerGoogleAnalyticsRedirectUri: string | undefined;
  providerGoogleLoginClientId: string | undefined;
  providerGoogleLoginClientSecret: string | undefined;
  providerGoogleLoginRedirectUri: string | undefined;
  providerGoogleLoginScopes: string;
  qrsTestRestrictedAuth: boolean;
  qrsTestLocalReadonlyAuth: boolean;
  qrsTestGoogleConfirmedWriteEnabled: boolean;
  qrsTestCloneConfirmedWriteEnabled: boolean;
  qrsTestCloneSourceCampaignId: string | undefined;
  qrsTestPmaxConfirmedWriteEnabled: boolean;
  qrsTestPmaxAllowedActions: string[];
  qrsTestPmaxCampaignName: string | undefined;
  qrsTestPmaxGroupName: string | undefined;
  qrsTestPmaxFinalUrl: "https://mcp.holymedia.kz/" | undefined;
  qrsTestPmaxConversionActionId: string | undefined;
  qrsTestPmaxGeoId: string | undefined;
  qrsTestPmaxLanguageId: string | undefined;
  qrsTestPmaxParentCampaignId: string | undefined;
  qrsTestPmaxParentAssetGroupId: string | undefined;
  qrsTestPmaxSearchTheme: string | undefined;
  qrsTestPmaxNegativeText: string | undefined;
  qrsTestPmaxAudienceId: string | undefined;
  qrsTestPmaxBrandSharedSetId: string | undefined;
  qrsTestPmaxAssetId: string | undefined;
  qrsTestPmaxCriterionId: string | undefined;
  qrsTestPmaxAssetFieldType:
    | "HEADLINE"
    | "LONG_HEADLINE"
    | "DESCRIPTION"
    | "MARKETING_IMAGE"
    | "SQUARE_MARKETING_IMAGE"
    | "LOGO"
    | "BUSINESS_NAME"
    | undefined;
  qrsTestPmaxReplacementText: string | undefined;
  qrsTestPmaxReplacementAssetId: string | undefined;
  qrsTestConversionActionConfirmedWriteEnabled: boolean;
  qrsTestConversionActionName: string | undefined;
  qrsTestGoogleOwnerBindingEmail: string | undefined;
  qrsTestGoogleOwnerBindingUserId: string | undefined;
  providerMetaClientId: string | undefined;
  providerMetaClientSecret: string | undefined;
  providerMetaRedirectUri: string | undefined;
  providerMetaApiVersion: string;
  providerMetaAdsManagementOauthEnabled: boolean;
  previewOnly: boolean;
  confirmedWriteEnabled: boolean;
  publicMcpWriteScopeEnabled: boolean;
  publicMcpControlledWriteEnabled: boolean;
  writeAccountAllowlist: string[];
  writeObjectAllowlist: string[];
  writeOperationAllowlist: string[];
  metaAppReviewRenameEnabled: boolean;
  metaAppReviewSecondRenameEnabled: boolean;
  metaAppReviewRenameAccountId: string;
  metaAppReviewRenameCampaignId: string;
  metaAppReviewRenameExpectedName: string;
  metaAppReviewRenameTargetName: string;
  siteAuditProductEnabled: boolean;
  providerTikTokClientId: string | undefined;
  providerTikTokClientSecret: string | undefined;
  providerTikTokRedirectUri: string | undefined;
  providerTikTokAuthUri: string;
  providerTikTokTokenUri: string;
  providerTikTokAdvertiserUri: string;
  providerTikTokScopes: string;
  providerTikTokAdvertiserId: string | undefined;
  providerYandexClientId: string | undefined;
  providerYandexClientSecret: string | undefined;
  providerYandexRedirectUri: string | undefined;
  providerYandexAuthUri: string;
  providerYandexTokenUri: string;
  providerYandexClientsUri: string;
  providerYandexScope: string;
  providerYandexLogin: string | undefined;
  providerYandexClientLogin: string | undefined;
  providerHttpTimeoutMs: number;
  cookieDomain: string | undefined;
  adminEnabled: boolean;
  adminLogin: string;
  adminPassword: string | undefined;
  adminSessionTtlHours: number;
  publicBaseUrl: string;
  telegramSupportBotToken: string | undefined;
  telegramSupportChatId: string | undefined;
  sessionTtlDays: number;
  emailTokenTtlMinutes: number;
  argon2MemoryKib: number;
  argon2TimeCost: number;
  argon2Parallelism: number;
  logLevel: z.infer<typeof rawConfigSchema.shape.LOG_LEVEL>;
};

function nonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function withV1ProviderAliases(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const value = { ...source };
  const baseUrl = nonEmpty(value.AD_MCP_PUBLIC_BASE_URL)?.replace(/\/$/, "");
  const callback = (pathName: string | undefined) =>
    baseUrl && nonEmpty(pathName) ? `${baseUrl}${pathName}` : undefined;

  value.PROVIDER_GOOGLE_CLIENT_ID ??= nonEmpty(
    value.AD_MCP_GOOGLE_OAUTH_CLIENT_ID,
  );
  value.PROVIDER_GOOGLE_CLIENT_SECRET ??= nonEmpty(
    value.AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET,
  );
  value.PROVIDER_GOOGLE_DEVELOPER_TOKEN ??= nonEmpty(
    value.AD_MCP_GOOGLE_ADS_DEVELOPER_TOKEN,
  );
  value.PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID ??= nonEmpty(
    value.AD_MCP_GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  );
  value.PROVIDER_GOOGLE_API_VERSION ??= nonEmpty(
    value.AD_MCP_GOOGLE_ADS_API_VERSION,
  );
  value.PROVIDER_GOOGLE_REDIRECT_URI ??= callback(
    value.AD_MCP_GOOGLE_OAUTH_REDIRECT_PATH,
  );
  value.PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_ID ??= nonEmpty(
    value.AD_MCP_GOOGLE_OAUTH_CLIENT_ID,
  );
  value.PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET ??= nonEmpty(
    value.AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET,
  );
  value.PROVIDER_GOOGLE_SEARCH_CONSOLE_REDIRECT_URI ??= callback(
    value.AD_MCP_GOOGLE_SEARCH_CONSOLE_REDIRECT_PATH,
  );
  value.PROVIDER_GOOGLE_SEARCH_CONSOLE_SCOPES ??= nonEmpty(
    value.AD_MCP_GOOGLE_SEARCH_CONSOLE_SCOPES,
  );
  value.PROVIDER_GOOGLE_ANALYTICS_CLIENT_ID ??= nonEmpty(
    value.AD_MCP_GOOGLE_OAUTH_CLIENT_ID,
  );
  value.PROVIDER_GOOGLE_ANALYTICS_CLIENT_SECRET ??= nonEmpty(
    value.AD_MCP_GOOGLE_OAUTH_CLIENT_SECRET,
  );
  value.PROVIDER_GOOGLE_ANALYTICS_REDIRECT_URI ??= callback(
    value.AD_MCP_GOOGLE_ANALYTICS_REDIRECT_PATH,
  );
  value.PROVIDER_GOOGLE_LOGIN_CLIENT_ID ??= nonEmpty(
    value.AD_MCP_GOOGLE_LOGIN_CLIENT_ID,
  );
  value.PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET ??= nonEmpty(
    value.AD_MCP_GOOGLE_LOGIN_CLIENT_SECRET,
  );
  value.PROVIDER_GOOGLE_LOGIN_REDIRECT_URI ??= callback(
    value.AD_MCP_GOOGLE_LOGIN_REDIRECT_PATH ?? "/auth/google/callback",
  );
  value.PROVIDER_GOOGLE_LOGIN_SCOPES ??= nonEmpty(
    value.AD_MCP_GOOGLE_LOGIN_SCOPES,
  );

  value.PROVIDER_META_CLIENT_ID ??= nonEmpty(value.AD_MCP_META_OAUTH_APP_ID);
  value.PROVIDER_META_CLIENT_SECRET ??= nonEmpty(
    value.AD_MCP_META_OAUTH_APP_SECRET,
  );
  value.PROVIDER_META_API_VERSION ??= nonEmpty(
    value.AD_MCP_META_OAUTH_API_VERSION,
  );
  value.PROVIDER_META_ADS_MANAGEMENT_OAUTH_ENABLED ??=
    value.AD_MCP_META_ADS_MANAGEMENT_OAUTH_ENABLED;
  value.V2_PREVIEW_ONLY ??= value.AD_MCP_PREVIEW_ONLY;
  value.V2_CONFIRMED_WRITE_ENABLED ??=
    value.AD_MCP_META_CONFIRMED_WRITE_ENABLED;
  value.PROVIDER_META_REDIRECT_URI ??= callback(
    value.AD_MCP_META_OAUTH_REDIRECT_PATH,
  );
  value.PROVIDER_TIKTOK_CLIENT_ID ??= nonEmpty(
    value.AD_MCP_TIKTOK_OAUTH_APP_ID,
  );
  value.PROVIDER_TIKTOK_CLIENT_SECRET ??= nonEmpty(
    value.AD_MCP_TIKTOK_OAUTH_APP_SECRET,
  );
  value.PROVIDER_TIKTOK_REDIRECT_URI ??= callback(
    value.AD_MCP_TIKTOK_OAUTH_REDIRECT_PATH,
  );
  value.PROVIDER_TIKTOK_AUTH_URI ??= nonEmpty(
    value.AD_MCP_TIKTOK_OAUTH_AUTH_URL,
  );
  value.PROVIDER_TIKTOK_TOKEN_URI ??= nonEmpty(
    value.AD_MCP_TIKTOK_OAUTH_TOKEN_URL,
  );
  value.PROVIDER_TIKTOK_ADVERTISER_URI ??= nonEmpty(
    value.AD_MCP_TIKTOK_OAUTH_ADVERTISER_GET_URL,
  );
  value.PROVIDER_TIKTOK_SCOPES ??= value.AD_MCP_TIKTOK_OAUTH_SCOPES;
  value.PROVIDER_TIKTOK_ADVERTISER_ID ??= nonEmpty(
    value.AD_MCP_TIKTOK_OAUTH_ADVERTISER_ID,
  );
  value.PROVIDER_YANDEX_CLIENT_ID ??= nonEmpty(
    value.AD_MCP_YANDEX_OAUTH_CLIENT_ID,
  );
  value.PROVIDER_YANDEX_CLIENT_SECRET ??= nonEmpty(
    value.AD_MCP_YANDEX_OAUTH_CLIENT_SECRET,
  );
  value.PROVIDER_YANDEX_REDIRECT_URI ??= callback(
    value.AD_MCP_YANDEX_OAUTH_REDIRECT_PATH,
  );
  value.PROVIDER_YANDEX_AUTH_URI ??= nonEmpty(
    value.AD_MCP_YANDEX_OAUTH_AUTHORIZE_URL,
  );
  value.PROVIDER_YANDEX_TOKEN_URI ??= nonEmpty(
    value.AD_MCP_YANDEX_OAUTH_TOKEN_URL,
  );
  value.PROVIDER_YANDEX_CLIENTS_URI ??= nonEmpty(
    value.AD_MCP_YANDEX_DIRECT_CLIENTS_URL,
  );
  value.PROVIDER_YANDEX_SCOPE ??= nonEmpty(value.AD_MCP_YANDEX_OAUTH_SCOPE);
  value.PROVIDER_YANDEX_LOGIN ??= nonEmpty(value.AD_MCP_YANDEX_DIRECT_LOGIN);
  value.PROVIDER_YANDEX_CLIENT_LOGIN ??= nonEmpty(
    value.AD_MCP_YANDEX_DIRECT_CLIENT_LOGIN,
  );
  return value;
}

function canonicalPublicBaseUrl(
  value: string,
  environment: "development" | "test" | "staging" | "production",
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("HOLYMEDIA_PUBLIC_BASE_URL must be an absolute URL.");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        local &&
        (environment === "development" || environment === "test") &&
        url.protocol === "http:"
      ))
  ) {
    throw new Error(
      "HOLYMEDIA_PUBLIC_BASE_URL must be a canonical HTTPS origin (localhost HTTP is for development/test only).",
    );
  }
  return url.origin;
}

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = rawConfigSchema.safeParse(withV1ProviderAliases(source));
  if (!parsed.success) {
    throw new Error(
      `Invalid v2 configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }

  const value = parsed.data;
  const configStrict =
    value.V2_CONFIG_STRICT || value.NODE_ENV === "production";
  if (
    configStrict &&
    (value.DATABASE_URL.includes("change-me") ||
      value.REDIS_URL.includes("localhost") ||
      value.SESSION_HASH_SECRET.includes("change-me") ||
      value.SESSION_HASH_SECRET.length < 32 ||
      !value.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS)
  ) {
    throw new Error(
      "Production-like v2 configuration requires explicit database, Redis, session and provider credential settings.",
    );
  }

  const corsOrigins = value.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (corsOrigins.length === 0) {
    throw new Error("CORS_ORIGINS must contain at least one origin.");
  }

  const publicBaseUrl = canonicalPublicBaseUrl(
    value.HOLYMEDIA_PUBLIC_BASE_URL ?? corsOrigins[0]!,
    value.NODE_ENV,
  );
  const googleAdsWriteAccountAllowlist = [
    ...new Set(
      value.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST.split(",")
        .map((v) => v.trim().replace(/-/g, ""))
        .filter(Boolean),
    ),
  ];
  if (googleAdsWriteAccountAllowlist.some((v) => !/^\d{10}$/.test(v)))
    throw new Error(
      "GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST must contain Google customer IDs.",
    );

  // Q/R/S is a single-account TEST environment. Its write allowlist alone is
  // not a read boundary; reject unsafe startup configuration before MCP runs.
  const localRestrictedReadOnly = value.QRS_TEST_LOCAL_READONLY_AUTH;
  if (
    localRestrictedReadOnly &&
    (value.NODE_ENV !== "development" ||
      !value.QRS_TEST_RESTRICTED_AUTH ||
      publicBaseUrl !== "http://127.0.0.1:23300" ||
      corsOrigins.length !== 1 ||
      corsOrigins[0] !== "http://127.0.0.1:23300" ||
      value.PROVIDER_GOOGLE_REDIRECT_URI !==
        "http://127.0.0.1:24404/oauth/google/callback" ||
      value.PROVIDER_GOOGLE_ADS_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED ||
      value.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED ||
      value.QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED ||
      value.QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED ||
      value.QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED ||
      !value.V2_PREVIEW_ONLY ||
      value.V2_CONFIRMED_WRITE_ENABLED ||
      value.PUBLIC_MCP_WRITE_SCOPE_ENABLED ||
      value.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED)
  )
    throw new Error(
      "Local restricted TEST requires loopback and all writes OFF.",
    );
  if (
    value.QRS_TEST_RESTRICTED_AUTH &&
    ((!localRestrictedReadOnly &&
      publicBaseUrl !== "https://mcp-test.holymedia.kz") ||
      googleAdsWriteAccountAllowlist.length !== 1 ||
      googleAdsWriteAccountAllowlist[0] !== "8590146099")
  )
    throw new Error(
      "Restricted TEST MCP requires the exact TEST origin and account.",
    );

  // This dedicated Google commit gate must never activate the V2 generic,
  // Public MCP, or later-stage write surfaces. The base Google gate alone is
  // insufficient for this deliberately separate Q/R/S acceptance runtime.
  if (
    value.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED &&
    (!value.QRS_TEST_RESTRICTED_AUTH ||
      !value.PROVIDER_GOOGLE_ADS_WRITE_ENABLED ||
      !value.V2_PREVIEW_ONLY ||
      value.V2_CONFIRMED_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED ||
      value.PUBLIC_MCP_WRITE_SCOPE_ENABLED ||
      value.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED ||
      publicBaseUrl !== "https://mcp-test.holymedia.kz" ||
      googleAdsWriteAccountAllowlist.length !== 1 ||
      googleAdsWriteAccountAllowlist[0] !== "8590146099")
  )
    throw new Error(
      "Q/R/S Google confirmed write requires isolated TEST-only guards.",
    );

  // Clone acceptance is a separate, mutually exclusive TEST commit profile.
  // Its source must be explicitly bound; neither generic V2 nor keyword writes
  // may be enabled as an accidental side effect of this one-off permission.
  if (
    value.QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED &&
    (!value.QRS_TEST_RESTRICTED_AUTH ||
      !value.QRS_TEST_CLONE_SOURCE_CAMPAIGN_ID ||
      value.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED ||
      !value.PROVIDER_GOOGLE_ADS_WRITE_ENABLED ||
      !value.V2_PREVIEW_ONLY ||
      value.V2_CONFIRMED_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED ||
      value.PUBLIC_MCP_WRITE_SCOPE_ENABLED ||
      value.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED ||
      publicBaseUrl !== "https://mcp-test.holymedia.kz" ||
      googleAdsWriteAccountAllowlist.length !== 1 ||
      googleAdsWriteAccountAllowlist[0] !== "8590146099")
  )
    throw new Error(
      "TEST Clone confirmed write requires one source and isolated TEST-only guards.",
    );

  const qrsPmaxActions = value.QRS_TEST_PMAX_ALLOWED_ACTIONS.split(",")
    .map((action) => action.trim())
    .filter(Boolean);
  if (
    value.QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED &&
    (!value.QRS_TEST_RESTRICTED_AUTH ||
      value.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED ||
      value.QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED ||
      value.QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED ||
      !value.PROVIDER_GOOGLE_ADS_WRITE_ENABLED ||
      !value.V2_PREVIEW_ONLY ||
      value.V2_CONFIRMED_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED ||
      value.PUBLIC_MCP_WRITE_SCOPE_ENABLED ||
      value.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED ||
      publicBaseUrl !== "https://mcp-test.holymedia.kz" ||
      googleAdsWriteAccountAllowlist.length !== 1 ||
      googleAdsWriteAccountAllowlist[0] !== "8590146099" ||
      !qrsPmaxActions.length ||
      new Set(qrsPmaxActions).size !== qrsPmaxActions.length ||
      qrsPmaxActions.some(
        (action) =>
          ![
            "pmax_create",
            "asset_group_update",
            "pmax_search_theme_add",
            "pmax_signal_remove",
            "pmax_negative_add",
            "pmax_brand_exclude",
            "pmax_audience_signal_add",
            "pmax_asset_attach",
            "pmax_asset_detach",
            "pmax_asset_replace",
            "pmax_campaign_asset_detach",
            "pmax_campaign_asset_replace",
            "pmax_negative_remove",
            "pmax_brand_remove",
            "pmax_asset_group_create",
          ].includes(action),
      ) ||
      (qrsPmaxActions.includes("pmax_create") &&
        (!value.QRS_TEST_PMAX_CAMPAIGN_NAME?.trim() ||
          !value.QRS_TEST_PMAX_FINAL_URL ||
          !value.QRS_TEST_PMAX_CONVERSION_ACTION_ID ||
          !value.QRS_TEST_PMAX_GEO_ID ||
          !value.QRS_TEST_PMAX_LANGUAGE_ID)) ||
      (qrsPmaxActions.includes("pmax_asset_group_create") &&
        (!value.QRS_TEST_PMAX_GROUP_NAME?.trim() ||
          !value.QRS_TEST_PMAX_FINAL_URL)) ||
      (qrsPmaxActions.some((action) => action !== "pmax_create") &&
        !value.QRS_TEST_PMAX_PARENT_CAMPAIGN_ID) ||
      (qrsPmaxActions.some((action) =>
        [
          "asset_group_update",
          "pmax_search_theme_add",
          "pmax_signal_remove",
          "pmax_audience_signal_add",
          "pmax_asset_attach",
          "pmax_asset_detach",
          "pmax_asset_replace",
        ].includes(action),
      ) &&
        !value.QRS_TEST_PMAX_PARENT_ASSET_GROUP_ID) ||
      (qrsPmaxActions.some((action) =>
        ["pmax_search_theme_add"].includes(action),
      ) &&
        !value.QRS_TEST_PMAX_SEARCH_THEME?.trim()) ||
      (qrsPmaxActions.includes("pmax_signal_remove") &&
        Boolean(value.QRS_TEST_PMAX_SEARCH_THEME?.trim()) ===
          Boolean(value.QRS_TEST_PMAX_AUDIENCE_ID)) ||
      (qrsPmaxActions.some((action) =>
        ["pmax_negative_add", "pmax_negative_remove"].includes(action),
      ) &&
        !value.QRS_TEST_PMAX_NEGATIVE_TEXT?.trim()) ||
      (qrsPmaxActions.includes("pmax_audience_signal_add") &&
        !value.QRS_TEST_PMAX_AUDIENCE_ID) ||
      (qrsPmaxActions.some((action) =>
        ["pmax_brand_exclude", "pmax_brand_remove"].includes(action),
      ) &&
        !value.QRS_TEST_PMAX_BRAND_SHARED_SET_ID) ||
      (qrsPmaxActions.some((action) =>
        [
          "pmax_asset_attach",
          "pmax_asset_detach",
          "pmax_asset_replace",
          "pmax_campaign_asset_detach",
          "pmax_campaign_asset_replace",
        ].includes(action),
      ) &&
        !value.QRS_TEST_PMAX_ASSET_ID) ||
      (qrsPmaxActions.some((action) =>
        ["pmax_negative_remove", "pmax_brand_remove"].includes(action),
      ) &&
        !value.QRS_TEST_PMAX_CRITERION_ID) ||
      (qrsPmaxActions.some((action) =>
        [
          "pmax_asset_attach",
          "pmax_asset_detach",
          "pmax_asset_replace",
          "pmax_campaign_asset_detach",
          "pmax_campaign_asset_replace",
        ].includes(action),
      ) &&
        !value.QRS_TEST_PMAX_ASSET_FIELD_TYPE) ||
      (qrsPmaxActions.some((action) =>
        ["pmax_asset_replace", "pmax_campaign_asset_replace"].includes(action),
      ) &&
        !value.QRS_TEST_PMAX_REPLACEMENT_TEXT &&
        !value.QRS_TEST_PMAX_REPLACEMENT_ASSET_ID))
  )
    throw new Error(
      "TEST PMax confirmed write requires exact isolated profiles and parent binding.",
    );

  if (
    value.QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED &&
    (!value.QRS_TEST_RESTRICTED_AUTH ||
      value.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED ||
      value.QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED ||
      value.QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED ||
      !value.PROVIDER_GOOGLE_ADS_WRITE_ENABLED ||
      !value.V2_PREVIEW_ONLY ||
      value.V2_CONFIRMED_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED ||
      value.PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED ||
      value.PUBLIC_MCP_WRITE_SCOPE_ENABLED ||
      value.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED ||
      publicBaseUrl !== "https://mcp-test.holymedia.kz" ||
      value.PROVIDER_GOOGLE_API_VERSION.replace(/^v/, "") !== "24" ||
      googleAdsWriteAccountAllowlist.length !== 1 ||
      googleAdsWriteAccountAllowlist[0] !== "8590146099" ||
      !/^HM_MCP_TEST_SIGNUP_[A-Z0-9_]{8,60}$/.test(
        value.QRS_TEST_CONVERSION_ACTION_NAME ?? "",
      ))
  )
    throw new Error(
      "TEST ConversionAction write requires one frozen first-party SIGNUP profile and isolated TEST-only guards.",
    );

  const bindingEmail = value.QRS_TEST_GOOGLE_OWNER_BINDING_EMAIL?.trim();
  const bindingUserId = value.QRS_TEST_GOOGLE_OWNER_BINDING_USER_ID?.trim();
  if (Boolean(bindingEmail) !== Boolean(bindingUserId))
    throw new Error("TEST Google OWNER binding requires both identity fields.");
  if (bindingEmail) {
    if (
      !value.QRS_TEST_RESTRICTED_AUTH ||
      (!localRestrictedReadOnly &&
        publicBaseUrl !== "https://mcp-test.holymedia.kz") ||
      googleAdsWriteAccountAllowlist.length !== 1 ||
      googleAdsWriteAccountAllowlist[0] !== "8590146099" ||
      bindingEmail !== bindingEmail.toLowerCase() ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bindingEmail) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        bindingUserId!,
      )
    )
      throw new Error(
        "TEST Google OWNER binding is not valid for this runtime.",
      );
  }

  return {
    environment: value.NODE_ENV,
    configStrict,
    apiPort: value.API_PORT,
    webPort: value.WEB_PORT,
    databaseUrl: value.DATABASE_URL,
    redisUrl: value.REDIS_URL,
    corsOrigins,
    sessionHashSecret: value.SESSION_HASH_SECRET,
    providerCredentialEncryptionKeys: value.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS,
    providerCredentialCurrentKeyVersion:
      value.PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION,
    providerGoogleClientId: value.PROVIDER_GOOGLE_CLIENT_ID,
    providerGoogleClientSecret: value.PROVIDER_GOOGLE_CLIENT_SECRET,
    providerGoogleRedirectUri: value.PROVIDER_GOOGLE_REDIRECT_URI,
    providerGoogleDeveloperToken: value.PROVIDER_GOOGLE_DEVELOPER_TOKEN,
    providerGoogleLoginCustomerId: value.PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID,
    providerGoogleApiVersion: value.PROVIDER_GOOGLE_API_VERSION,
    providerGoogleAdsWriteEnabled: value.PROVIDER_GOOGLE_ADS_WRITE_ENABLED,
    providerGoogleAdsStage2WriteEnabled:
      value.PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED,
    providerGoogleAdsStage3WriteEnabled:
      value.PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED,
    providerGoogleAdsStage4WriteEnabled:
      value.PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED,
    googleAdsWriteAccountAllowlist,
    providerGoogleSearchConsoleClientId:
      value.PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_ID,
    providerGoogleSearchConsoleClientSecret:
      value.PROVIDER_GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET,
    providerGoogleSearchConsoleRedirectUri:
      value.PROVIDER_GOOGLE_SEARCH_CONSOLE_REDIRECT_URI,
    providerGoogleSearchConsoleScopes:
      value.PROVIDER_GOOGLE_SEARCH_CONSOLE_SCOPES,
    providerGoogleAnalyticsClientId: value.PROVIDER_GOOGLE_ANALYTICS_CLIENT_ID,
    providerGoogleAnalyticsClientSecret:
      value.PROVIDER_GOOGLE_ANALYTICS_CLIENT_SECRET,
    providerGoogleAnalyticsRedirectUri:
      value.PROVIDER_GOOGLE_ANALYTICS_REDIRECT_URI,
    providerGoogleLoginClientId: value.PROVIDER_GOOGLE_LOGIN_CLIENT_ID,
    providerGoogleLoginClientSecret: value.PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET,
    providerGoogleLoginRedirectUri: value.PROVIDER_GOOGLE_LOGIN_REDIRECT_URI,
    providerGoogleLoginScopes: value.PROVIDER_GOOGLE_LOGIN_SCOPES,
    qrsTestRestrictedAuth: value.QRS_TEST_RESTRICTED_AUTH,
    qrsTestLocalReadonlyAuth: localRestrictedReadOnly,
    qrsTestGoogleConfirmedWriteEnabled:
      value.QRS_TEST_GOOGLE_CONFIRMED_WRITE_ENABLED,
    qrsTestCloneConfirmedWriteEnabled:
      value.QRS_TEST_CLONE_CONFIRMED_WRITE_ENABLED,
    qrsTestCloneSourceCampaignId: value.QRS_TEST_CLONE_SOURCE_CAMPAIGN_ID,
    qrsTestPmaxConfirmedWriteEnabled:
      value.QRS_TEST_PMAX_CONFIRMED_WRITE_ENABLED,
    qrsTestPmaxAllowedActions: qrsPmaxActions,
    qrsTestPmaxCampaignName: value.QRS_TEST_PMAX_CAMPAIGN_NAME,
    qrsTestPmaxGroupName: value.QRS_TEST_PMAX_GROUP_NAME,
    qrsTestPmaxFinalUrl: value.QRS_TEST_PMAX_FINAL_URL,
    qrsTestPmaxConversionActionId: value.QRS_TEST_PMAX_CONVERSION_ACTION_ID,
    qrsTestPmaxGeoId: value.QRS_TEST_PMAX_GEO_ID,
    qrsTestPmaxLanguageId: value.QRS_TEST_PMAX_LANGUAGE_ID,
    qrsTestPmaxParentCampaignId: value.QRS_TEST_PMAX_PARENT_CAMPAIGN_ID,
    qrsTestPmaxParentAssetGroupId: value.QRS_TEST_PMAX_PARENT_ASSET_GROUP_ID,
    qrsTestPmaxSearchTheme: value.QRS_TEST_PMAX_SEARCH_THEME,
    qrsTestPmaxNegativeText: value.QRS_TEST_PMAX_NEGATIVE_TEXT,
    qrsTestPmaxAudienceId: value.QRS_TEST_PMAX_AUDIENCE_ID,
    qrsTestPmaxBrandSharedSetId: value.QRS_TEST_PMAX_BRAND_SHARED_SET_ID,
    qrsTestPmaxAssetId: value.QRS_TEST_PMAX_ASSET_ID,
    qrsTestPmaxCriterionId: value.QRS_TEST_PMAX_CRITERION_ID,
    qrsTestPmaxAssetFieldType: value.QRS_TEST_PMAX_ASSET_FIELD_TYPE,
    qrsTestPmaxReplacementText: value.QRS_TEST_PMAX_REPLACEMENT_TEXT,
    qrsTestPmaxReplacementAssetId: value.QRS_TEST_PMAX_REPLACEMENT_ASSET_ID,
    qrsTestConversionActionConfirmedWriteEnabled:
      value.QRS_TEST_CONVERSION_ACTION_CONFIRMED_WRITE_ENABLED,
    qrsTestConversionActionName: value.QRS_TEST_CONVERSION_ACTION_NAME,
    qrsTestGoogleOwnerBindingEmail: bindingEmail,
    qrsTestGoogleOwnerBindingUserId: bindingUserId,
    providerMetaClientId: value.PROVIDER_META_CLIENT_ID,
    providerMetaClientSecret: value.PROVIDER_META_CLIENT_SECRET,
    providerMetaRedirectUri: value.PROVIDER_META_REDIRECT_URI,
    providerMetaApiVersion: value.PROVIDER_META_API_VERSION,
    providerMetaAdsManagementOauthEnabled:
      value.PROVIDER_META_ADS_MANAGEMENT_OAUTH_ENABLED,
    previewOnly: value.V2_PREVIEW_ONLY,
    confirmedWriteEnabled: value.V2_CONFIRMED_WRITE_ENABLED,
    publicMcpWriteScopeEnabled: value.PUBLIC_MCP_WRITE_SCOPE_ENABLED,
    publicMcpControlledWriteEnabled: value.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED,
    writeAccountAllowlist: value.V2_WRITE_ACCOUNT_ALLOWLIST.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    writeObjectAllowlist: value.V2_WRITE_OBJECT_ALLOWLIST.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    writeOperationAllowlist: value.V2_WRITE_OPERATION_ALLOWLIST.split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    metaAppReviewRenameEnabled: value.V2_META_APP_REVIEW_RENAME_ENABLED,
    metaAppReviewSecondRenameEnabled:
      value.V2_META_APP_REVIEW_SECOND_RENAME_ENABLED,
    metaAppReviewRenameAccountId:
      value.V2_META_APP_REVIEW_RENAME_ACCOUNT_ID.trim(),
    metaAppReviewRenameCampaignId:
      value.V2_META_APP_REVIEW_RENAME_CAMPAIGN_ID.trim(),
    metaAppReviewRenameExpectedName:
      value.V2_META_APP_REVIEW_RENAME_EXPECTED_NAME.trim(),
    metaAppReviewRenameTargetName:
      value.V2_META_APP_REVIEW_RENAME_TARGET_NAME.trim(),
    siteAuditProductEnabled: value.SITE_AUDIT_PRODUCT_ENABLED,
    providerTikTokClientId: value.PROVIDER_TIKTOK_CLIENT_ID,
    providerTikTokClientSecret: value.PROVIDER_TIKTOK_CLIENT_SECRET,
    providerTikTokRedirectUri: value.PROVIDER_TIKTOK_REDIRECT_URI,
    providerTikTokAuthUri: value.PROVIDER_TIKTOK_AUTH_URI,
    providerTikTokTokenUri: value.PROVIDER_TIKTOK_TOKEN_URI,
    providerTikTokAdvertiserUri: value.PROVIDER_TIKTOK_ADVERTISER_URI,
    providerTikTokScopes: value.PROVIDER_TIKTOK_SCOPES,
    providerTikTokAdvertiserId: value.PROVIDER_TIKTOK_ADVERTISER_ID,
    providerYandexClientId: value.PROVIDER_YANDEX_CLIENT_ID,
    providerYandexClientSecret: value.PROVIDER_YANDEX_CLIENT_SECRET,
    providerYandexRedirectUri: value.PROVIDER_YANDEX_REDIRECT_URI,
    providerYandexAuthUri: value.PROVIDER_YANDEX_AUTH_URI,
    providerYandexTokenUri: value.PROVIDER_YANDEX_TOKEN_URI,
    providerYandexClientsUri: value.PROVIDER_YANDEX_CLIENTS_URI,
    providerYandexScope: value.PROVIDER_YANDEX_SCOPE,
    providerYandexLogin: value.PROVIDER_YANDEX_LOGIN,
    providerYandexClientLogin: value.PROVIDER_YANDEX_CLIENT_LOGIN,
    providerHttpTimeoutMs: value.PROVIDER_HTTP_TIMEOUT_MS,
    cookieDomain: value.COOKIE_DOMAIN,
    adminEnabled:
      value.HOLYMEDIA_ADMIN_ENABLED && Boolean(value.HOLYMEDIA_ADMIN_PASSWORD),
    // This identity is deliberately not configurable. Customer and workspace
    // roles must never become alternate system-admin logins.
    adminLogin: "Admin",
    adminPassword: value.HOLYMEDIA_ADMIN_PASSWORD,
    adminSessionTtlHours: value.HOLYMEDIA_ADMIN_SESSION_TTL_HOURS,
    publicBaseUrl,
    telegramSupportBotToken: nonEmpty(value.TELEGRAM_SUPPORT_BOT_TOKEN),
    telegramSupportChatId: nonEmpty(value.TELEGRAM_SUPPORT_CHAT_ID),
    sessionTtlDays: value.SESSION_TTL_DAYS,
    emailTokenTtlMinutes: value.EMAIL_TOKEN_TTL_MINUTES,
    argon2MemoryKib: value.ARGON2_MEMORY_KIB,
    argon2TimeCost: value.ARGON2_TIME_COST,
    argon2Parallelism: value.ARGON2_PARALLELISM,
    logLevel: value.LOG_LEVEL,
  };
}

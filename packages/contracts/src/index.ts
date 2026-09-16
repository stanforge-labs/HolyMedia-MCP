export type ServiceStatus = "ok" | "degraded" | "not_ready";

export type HealthResponse = {
  status: "ok";
  service: string;
  version: string;
};

export type ReadinessResponse = {
  status: ServiceStatus;
  service: string;
  version: string;
  dependencies: Record<string, { status: ServiceStatus; latencyMs?: number }>;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
};

export type ProviderId =
  | "GOOGLE_ADS"
  | "GOOGLE_ANALYTICS"
  | "META_ADS"
  | "GOOGLE_SEARCH_CONSOLE"
  | "YANDEX_DIRECT"
  | "TIKTOK_ADS"
  | "TEST_PROVIDER";

export type ProviderConnectionStatus =
  | "PENDING"
  | "CONNECTED"
  | "DEGRADED"
  | "REAUTH_REQUIRED"
  | "REVOKED"
  | "DISCONNECTED"
  | "ERROR";

export type ServiceTokenResourceAccessMode =
  "ALL_CONNECTED" | "STATIC_ALLOWLIST";

export type ProviderDefinition = {
  id: ProviderId;
  displayName: string;
  oauth: boolean;
  pkce: boolean;
  accountDiscovery: boolean;
  refresh: boolean;
  read: boolean;
  write: boolean;
  status: "available" | "configuration_required" | "test_only";
  scopes: string[];
};

export type ProviderAccountView = {
  id: string;
  provider: ProviderId;
  externalAccountId: string;
  displayName: string;
  /** Parent platform account where a provider exposes one. */
  accountName?: string | null;
  currency: string | null;
  timezone: string | null;
  status: string | null;
  enabled: boolean;
  discoveredAt: string;
  lastSeenAt: string;
};

export type ProviderConnectionView = {
  id: string;
  workspaceId: string;
  provider: ProviderId;
  status: ProviderConnectionStatus;
  displayName: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  lastDiscoveryAt?: string | null;
  lastDiscoveryError?: string | null;
  propertyCount?: number | null;
  credentialVersion: number;
  requestedScopes: string[];
  grantedScopes: string[];
  missingScopes: string[];
  accounts: ProviderAccountView[];
};

export type ProviderDateRange = {
  startDate: string;
  endDate: string;
  timezone?: string | null;
};

export type ProviderProvenance = {
  provider: ProviderId;
  sourceApi: string;
  realData: boolean;
  dataStatus: "live" | "empty" | "partial" | "additional_permission_required";
  fetchedAt: string;
  cacheAgeSeconds?: number;
};

export type ProviderMoney = {
  amount: string;
  currency: string | null;
};

export type ProviderMetricSummary = {
  spend: ProviderMoney | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  cpc: ProviderMoney | null;
  cpm: ProviderMoney | null;
  conversions: number | null;
  conversionValue: string | null;
  costPerConversion: ProviderMoney | null;
};

export type ProviderAccountSummary = ProviderAccountView & {
  metrics?: ProviderMetricSummary;
  provenance: ProviderProvenance;
};

export type ProviderCampaign = {
  id: string;
  name: string;
  status: string | null;
  objective: string | null;
  budget: ProviderMoney | null;
  metrics?: ProviderMetricSummary;
  metadata?: Record<string, string | number | boolean | null>;
  provenance: ProviderProvenance;
};

export type ProviderHealthView = {
  credentialsValid: boolean;
  providerReachable: boolean;
  scopesSufficient: boolean;
  accountReachable: boolean;
  selectedAccountValid: boolean;
  status: "healthy" | "degraded" | "reauth_required";
  missingScopes: string[];
  provenance: ProviderProvenance;
};

export * from "./tariffs.js";
export * from "./member-titles.js";

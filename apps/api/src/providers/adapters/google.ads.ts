import { loadConfig, type AppConfig } from "@holymedia/config";
import type {
  ProviderAccountSummary,
  ProviderCampaign,
  ProviderDateRange,
  ProviderDefinition,
  ProviderHealthView,
  ProviderMetricSummary,
} from "@holymedia/contracts";
import { ProviderError } from "../provider.errors.js";
import { providerJson } from "../provider-http.js";
import { googleAdsApiError } from "../google-ads.error.js";
import { keywordOptions, listGoogleKeywords } from "../google-ads-keywords.js";
import {
  metricsFromRaw,
  money,
  numberValue,
  provenance,
  sumMetrics,
  validateDateRange,
} from "../provider-normalization.js";
import type {
  NormalizedProviderAccount,
  OAuthExchangeContext,
  OAuthStartContext,
  ProviderCredentialPayload,
  ProviderOAuthAdapter,
  ProviderReadAdapter,
  ProviderReadContext,
  GoogleKeywordOptions,
} from "../provider.types.js";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/adwords";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

export const googleAdsDefinition = (
  configured: boolean,
): ProviderDefinition => ({
  id: "GOOGLE_ADS",
  displayName: "Google Ads",
  oauth: true,
  pkce: false,
  accountDiscovery: true,
  refresh: true,
  read: configured,
  write: false,
  status: configured ? "available" : "configuration_required",
  scopes: [GOOGLE_SCOPE],
});

export class GoogleAdsAdapter
  implements ProviderOAuthAdapter, ProviderReadAdapter
{
  public readonly definition: ProviderDefinition;
  private readonly config: AppConfig;

  public constructor(config: AppConfig = loadConfig()) {
    this.config = config;
    this.definition = googleAdsDefinition(
      Boolean(
        config.providerGoogleClientId &&
        config.providerGoogleClientSecret &&
        config.providerGoogleRedirectUri,
      ),
    );
  }

  public authorizationUrl(context: OAuthStartContext): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set(
      "client_id",
      this.required(this.config.providerGoogleClientId),
    );
    url.searchParams.set("redirect_uri", context.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GOOGLE_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("state", context.state);
    return url.toString();
  }

  public async exchangeCode(
    context: OAuthExchangeContext,
  ): Promise<ProviderCredentialPayload> {
    const body = new URLSearchParams({
      client_id: this.required(this.config.providerGoogleClientId),
      client_secret: this.required(this.config.providerGoogleClientSecret),
      code: context.code,
      redirect_uri: context.redirectUri,
      grant_type: "authorization_code",
    });
    const response = await providerJson<Record<string, unknown>>(
      GOOGLE_OAUTH_TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      this.config.providerHttpTimeoutMs,
    );
    return this.credentialsFromToken(response);
  }

  public async refreshCredentials(
    credentials: ProviderCredentialPayload,
  ): Promise<ProviderCredentialPayload> {
    if (!credentials.refreshToken)
      throw new ProviderError(
        "refresh_failed",
        "Google refresh token is unavailable.",
      );
    const body = new URLSearchParams({
      client_id: this.required(this.config.providerGoogleClientId),
      client_secret: this.required(this.config.providerGoogleClientSecret),
      refresh_token: credentials.refreshToken,
      grant_type: "refresh_token",
    });
    try {
      const response = await providerJson<Record<string, unknown>>(
        GOOGLE_OAUTH_TOKEN_URL,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        },
        this.config.providerHttpTimeoutMs,
      );
      return {
        ...credentials,
        ...this.credentialsFromToken(response),
        refreshToken: credentials.refreshToken,
      };
    } catch (error) {
      throw new ProviderError(
        "refresh_failed",
        "Google authorization refresh failed.",
        false,
        error instanceof ProviderError ? error.providerStatus : undefined,
        error instanceof ProviderError ? error.providerCode : undefined,
      );
    }
  }

  public async discoverAccounts(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]> {
    const accessible = await this.accessibleCustomers(credentials.accessToken);
    const accounts: NormalizedProviderAccount[] = [];
    for (const customerId of accessible) {
      const direct = await this.customerRows(
        credentials,
        customerId,
        this.configuredLoginCustomerId(credentials),
      );
      accounts.push(...direct);
      let clients: Array<Record<string, unknown>> = [];
      try {
        clients = await this.customerClientRows(credentials, customerId);
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          [
            "authentication_failed",
            "insufficient_permissions",
            "provider_unavailable",
          ].includes(error.code)
        )
          throw error;
      }
      for (const client of clients) {
        const id = String(client.customerId ?? "");
        if (!id) continue;
        const hierarchyMetadata = {
          googleAdsType: client.manager ? "manager" : "customer",
          googleAdsLevel: numberValue(client.level),
          managerCustomerId: customerId,
          loginCustomerId:
            this.config.providerGoogleLoginCustomerId ?? customerId,
        };
        const existing = accounts.find((item) => item.externalAccountId === id);
        if (existing) {
          existing.metadata = {
            ...(existing.metadata ?? {}),
            ...hierarchyMetadata,
          };
          continue;
        }
        accounts.push({
          externalAccountId: id,
          displayName: String(client.descriptiveName || `Google Ads ${id}`),
          ...(stringOrUndefined(client.currencyCode)
            ? { currency: stringOrUndefined(client.currencyCode)! }
            : {}),
          ...(stringOrUndefined(client.timeZone)
            ? { timezone: stringOrUndefined(client.timeZone)! }
            : {}),
          status: normalizeGoogleStatus(client.status),
          metadata: hierarchyMetadata,
        });
      }
    }
    return dedupeAccounts(accounts);
  }

  public async getAccountSummary(
    context: ProviderReadContext,
    range?: ProviderDateRange,
  ): Promise<ProviderAccountSummary> {
    const customerId = assertCustomerId(context.accountId);
    const account = (
      await this.customerRows(
        context.credentials,
        customerId,
        this.contextLoginCustomerId(context),
      )
    )[0];
    if (!account)
      throw new ProviderError(
        "invalid_account",
        "Google Ads account was not found.",
      );
    const metrics = range
      ? await this.getMetrics(context, validateDateRange(range))
      : undefined;
    return {
      id: "",
      provider: "GOOGLE_ADS",
      externalAccountId: account.externalAccountId,
      displayName: account.displayName,
      currency: account.currency ?? null,
      timezone: account.timezone ?? null,
      status: account.status ?? null,
      enabled: true,
      discoveredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      ...(metrics ? { metrics } : {}),
      provenance: provenance("GOOGLE_ADS", "Google Ads API customer"),
    };
  }

  public async listCampaigns(
    context: ProviderReadContext,
    range?: ProviderDateRange,
    limit = 100,
    cursor?: string,
    statuses?: readonly string[],
  ) {
    const customerId = assertCustomerId(context.accountId);
    const safeLimit = Math.max(1, Math.min(limit, 500));
    const offset = campaignCursorOffset(cursor);
    const loginCustomerId = this.contextLoginCustomerId(context);
    const statusFilter = campaignStatusFilter(statuses);
    const dates = range ? validateDateRange(range) : undefined;
    const filters = [
      statusFilter,
      ...(dates
        ? [`segments.date BETWEEN '${dates.startDate}' AND '${dates.endDate}'`]
        : []),
    ];
    const [rows, customer] = await Promise.all([
      this.searchStream(
        context.credentials.accessToken,
        customerId,
        loginCustomerId,
        `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, campaign_budget.resource_name, campaign_budget.explicitly_shared, campaign_budget.period${dates ? ", metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion" : ""} FROM campaign WHERE ${filters.join(" AND ")} ORDER BY campaign.id`,
      ),
      context.currency
        ? Promise.resolve([])
        : this.customerRows(context.credentials, customerId, loginCustomerId),
    ]);
    const currency = context.currency ?? customer[0]?.currency ?? null;
    const items = rows.slice(offset, offset + safeLimit).map((row) => {
      const campaign = object(row.campaign);
      const budget = object(row.campaignBudget);
      const metrics = object(row.metrics);
      return {
        id: String(campaign.id || ""),
        name: String(campaign.name || ""),
        status: stringOrNull(campaign.status),
        objective: stringOrNull(campaign.advertisingChannelType),
        budget: money(microsToAmount(budget.amountMicros), currency),
        budgetDetails: {
          resourceName: stringOrNull(budget.resourceName),
          explicitlyShared:
            typeof budget.explicitlyShared === "boolean"
              ? budget.explicitlyShared
              : null,
          period: stringOrNull(budget.period),
        },
        ...(range
          ? {
              metrics: googleMetricsFromRaw(metrics, currency),
            }
          : {}),
        metadata: { source: "Google Ads API" },
        provenance: provenance("GOOGLE_ADS", "Google Ads API campaign"),
      } satisfies ProviderCampaign;
    });
    return {
      items,
      ...(offset + items.length < rows.length
        ? { nextCursor: String(offset + items.length) }
        : {}),
    };
  }

  public async getMetrics(
    context: ProviderReadContext,
    range: ProviderDateRange,
    campaignId?: string,
  ): Promise<ProviderMetricSummary> {
    const normalized = validateDateRange(range);
    const customerId = assertCustomerId(context.accountId);
    const filter = campaignId
      ? `campaign.id = ${assertCustomerId(campaignId)} AND `
      : "";
    const resource = campaignId ? "campaign" : "customer";
    const entity = campaignId ? "campaign.id, " : "";
    const rows = await this.searchStream(
      context.credentials.accessToken,
      customerId,
      this.contextLoginCustomerId(context),
      `SELECT ${entity}segments.date, metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion FROM ${resource} WHERE ${filter}segments.date BETWEEN '${normalized.startDate}' AND '${normalized.endDate}'`,
    );
    const currency =
      context.currency ??
      (
        await this.customerRows(
          context.credentials,
          customerId,
          this.contextLoginCustomerId(context),
        )
      )[0]?.currency ??
      null;
    return sumMetrics(
      rows.map((row) => {
        const raw = object(row.metrics);
        return {
          raw: { ...raw, conversionValue: raw.conversionsValue },
          spend: microsToAmount(raw.costMicros),
        };
      }),
      currency,
    );
  }

  public async listKeywords(
    context: ProviderReadContext,
    options: GoogleKeywordOptions,
  ) {
    const customerId = assertCustomerId(context.accountId);
    const validated = keywordOptions(options);
    const loginCustomerId = this.contextLoginCustomerId(context);
    const currency =
      context.currency ??
      (
        await this.customerRows(
          context.credentials,
          customerId,
          loginCustomerId,
        )
      )[0]?.currency ??
      null;
    return listGoogleKeywords(
      customerId,
      validated,
      currency,
      (query, token) =>
        this.searchPage(
          context.credentials.accessToken,
          customerId,
          loginCustomerId,
          query,
          token,
        ),
      (query) =>
        this.searchStream(
          context.credentials.accessToken,
          customerId,
          loginCustomerId,
          query,
        ),
    );
  }

  public async health(
    context: ProviderReadContext,
  ): Promise<ProviderHealthView> {
    const required = this.definition.scopes;
    const missingScopes = required.filter(
      (scope) => !context.credentials.scopes.includes(scope),
    );
    try {
      await this.getAccountSummary(context);
      return {
        credentialsValid: true,
        providerReachable: true,
        scopesSufficient: missingScopes.length === 0,
        accountReachable: true,
        selectedAccountValid: true,
        status: missingScopes.length ? "degraded" : "healthy",
        missingScopes,
        provenance: provenance("GOOGLE_ADS", "Google Ads API health"),
      };
    } catch (error) {
      const status =
        error instanceof ProviderError &&
        [
          "authentication_failed",
          "refresh_failed",
          "connection_revoked",
        ].includes(error.code)
          ? "reauth_required"
          : "degraded";
      return {
        credentialsValid: status !== "reauth_required",
        providerReachable: true,
        scopesSufficient: missingScopes.length === 0,
        accountReachable: false,
        selectedAccountValid: false,
        status,
        missingScopes,
        provenance: provenance(
          "GOOGLE_ADS",
          "Google Ads API health",
          "partial",
        ),
      };
    }
  }

  private async accessibleCustomers(accessToken: string): Promise<string[]> {
    const data = await providerJson<{ resourceNames?: unknown }>(
      `${this.apiBase()}/customers:listAccessibleCustomers`,
      { method: "GET", headers: this.headers(accessToken) },
      this.config.providerHttpTimeoutMs,
      googleAdsApiError,
    );
    const names = Array.isArray(data.resourceNames) ? data.resourceNames : [];
    return names
      .map((name) => String(name).split("/").pop() || "")
      .filter((id) => /^\d{10}$/.test(id));
  }

  private async customerClientRows(
    credentials: ProviderCredentialPayload,
    managerId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await this.searchStream(
      credentials.accessToken,
      managerId,
      this.configuredLoginCustomerId(credentials),
      `SELECT customer_client.client_customer, customer_client.descriptive_name, customer_client.id, customer_client.manager, customer_client.level, customer_client.status, customer_client.currency_code, customer_client.time_zone FROM customer_client WHERE customer_client.level <= 1`,
    );
    return rows.map((row) => {
      const client = object(row.customerClient);
      return {
        customerId: String(
          client.id ||
            String(client.clientCustomer || "")
              .split("/")
              .pop() ||
            "",
        ),
        ...client,
      } as Record<string, unknown>;
    });
  }

  private async customerRows(
    credentials: ProviderCredentialPayload,
    customerId: string,
    loginCustomerId?: string,
  ) {
    const rows = await this.searchStream(
      credentials.accessToken,
      customerId,
      loginCustomerId,
      "SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.status FROM customer",
    );
    return rows.map((row) => {
      const customer = object(row.customer);
      const id = String(customer.id || customerId);
      return {
        externalAccountId: id,
        displayName: String(customer.descriptiveName || `Google Ads ${id}`),
        ...(stringOrUndefined(customer.currencyCode)
          ? { currency: stringOrUndefined(customer.currencyCode)! }
          : {}),
        ...(stringOrUndefined(customer.timeZone)
          ? { timezone: stringOrUndefined(customer.timeZone)! }
          : {}),
        status: normalizeGoogleStatus(customer.status),
        metadata: { googleAdsType: "customer" },
        provenance: provenance("GOOGLE_ADS", "Google Ads API customer"),
      } satisfies NormalizedProviderAccount & {
        provenance: ReturnType<typeof provenance>;
      };
    });
  }

  private async searchStream(
    accessToken: string,
    customerId: string,
    loginCustomerId: string | undefined,
    query: string,
  ): Promise<Record<string, unknown>[]> {
    const data = await providerJson<unknown>(
      `${this.apiBase()}/customers/${assertCustomerId(customerId)}/googleAds:searchStream`,
      {
        method: "POST",
        headers: {
          ...this.headers(accessToken, loginCustomerId),
          "content-type": "application/json",
        },
        body: JSON.stringify({ query }),
      },
      this.config.providerHttpTimeoutMs,
      googleAdsApiError,
    );
    if (!Array.isArray(data))
      throw new ProviderError(
        "provider_response_invalid",
        "Google Ads response was invalid.",
      );
    const rows: Record<string, unknown>[] = [];
    for (const batch of data) {
      const values =
        batch && typeof batch === "object"
          ? (batch as Record<string, unknown>).results
          : null;
      if (Array.isArray(values))
        rows.push(
          ...values.filter((row): row is Record<string, unknown> =>
            Boolean(row && typeof row === "object"),
          ),
        );
    }
    return rows;
  }

  private async searchPage(
    accessToken: string,
    customerId: string,
    loginCustomerId: string | undefined,
    query: string,
    pageToken?: string,
  ): Promise<{ results: Record<string, unknown>[]; nextPageToken?: string }> {
    const data = await providerJson<Record<string, unknown>>(
      `${this.apiBase()}/customers/${assertCustomerId(customerId)}/googleAds:search`,
      {
        method: "POST",
        headers: {
          ...this.headers(accessToken, loginCustomerId),
          "content-type": "application/json",
        },
        body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
      },
      this.config.providerHttpTimeoutMs,
      googleAdsApiError,
    );
    if (data.results !== undefined && !Array.isArray(data.results))
      throw new ProviderError(
        "provider_response_invalid",
        "Google Ads search response was invalid.",
      );
    return {
      results: (data.results ?? []).filter(
        (row): row is Record<string, unknown> =>
          Boolean(row && typeof row === "object" && !Array.isArray(row)),
      ),
      ...(typeof data.nextPageToken === "string" && data.nextPageToken
        ? { nextPageToken: data.nextPageToken }
        : {}),
    };
  }

  private headers(
    accessToken: string,
    loginCustomerId?: string,
  ): Record<string, string> {
    return {
      authorization: `Bearer ${accessToken}`,
      ...(loginCustomerId
        ? { "login-customer-id": assertCustomerId(loginCustomerId) }
        : {}),
    };
  }

  private apiBase(): string {
    return `https://googleads.googleapis.com/${this.config.providerGoogleApiVersion.replace(/^v?/, "v")}`;
  }
  private configuredLoginCustomerId(
    credentials: ProviderCredentialPayload,
  ): string | undefined {
    const value =
      credentials.providerMetadata?.loginCustomerId ??
      this.config.providerGoogleLoginCustomerId;
    return value ? assertCustomerId(String(value)) : undefined;
  }

  private contextLoginCustomerId(
    context: ProviderReadContext,
  ): string | undefined {
    return context.loginCustomerId
      ? assertCustomerId(context.loginCustomerId)
      : this.configuredLoginCustomerId(context.credentials);
  }
  private required(value: string | undefined): string {
    if (!value)
      throw new ProviderError(
        "provider_not_configured",
        "Google Ads provider is not configured.",
      );
    return value;
  }
  private credentialsFromToken(
    response: Record<string, unknown>,
  ): ProviderCredentialPayload {
    const token = String(response.access_token || "");
    if (!token)
      throw new ProviderError(
        "authentication_failed",
        "Google OAuth did not return an access token.",
      );
    const expiresIn = numberValue(response.expires_in);
    return {
      accessToken: token,
      ...(response.refresh_token
        ? { refreshToken: String(response.refresh_token) }
        : {}),
      ...(expiresIn
        ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
        : {}),
      tokenType: String(response.token_type || "Bearer"),
      scopes: String(response.scope || GOOGLE_SCOPE)
        .split(/\s+/)
        .filter(Boolean),
      ...(this.config.providerGoogleLoginCustomerId
        ? {
            providerMetadata: {
              loginCustomerId: this.config.providerGoogleLoginCustomerId,
            },
          }
        : {}),
    };
  }
}

function assertCustomerId(value: string): string {
  const normalized = value.replace(/-/g, "").trim();
  if (!/^\d{10}$/.test(normalized))
    throw new ProviderError(
      "invalid_account",
      "Google customer ID is invalid.",
    );
  return normalized;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}
function stringOrNull(value: unknown): string | null {
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}
function stringOrUndefined(value: unknown): string | undefined {
  const v = stringOrNull(value);
  return v ?? undefined;
}
function microsToAmount(value: unknown): number | null {
  const n = numberValue(value);
  return n === null ? null : n / 1_000_000;
}
function googleMetricsFromRaw(
  raw: Record<string, unknown>,
  currency: string | null,
) {
  return metricsFromRaw(
    {
      ...raw,
      cpc: microsToAmount(raw.averageCpc),
      costPerConversion: microsToAmount(raw.costPerConversion),
      conversionValue: raw.conversionsValue,
    },
    currency,
    microsToAmount(raw.costMicros),
  );
}
function campaignStatusFilter(statuses?: readonly string[]): string {
  if (!statuses?.length) return "campaign.status != 'REMOVED'";
  const normalized = [
    ...new Set(statuses.map((status) => status.toUpperCase())),
  ];
  if (
    normalized.some(
      (status) => !["ENABLED", "PAUSED", "REMOVED"].includes(status),
    )
  )
    throw new ProviderError(
      "provider_response_invalid",
      "Invalid Google campaign status.",
    );
  return normalized.length === 1
    ? `campaign.status = '${normalized[0]}'`
    : `campaign.status IN (${normalized.map((status) => `'${status}'`).join(", ")})`;
}
function campaignCursorOffset(cursor?: string): number {
  if (!cursor) return 0;
  if (!/^(0|[1-9]\d*)$/.test(cursor))
    throw new ProviderError(
      "provider_response_invalid",
      "Invalid Google campaign cursor.",
    );
  const offset = Number(cursor);
  if (!Number.isSafeInteger(offset))
    throw new ProviderError(
      "provider_response_invalid",
      "Invalid Google campaign cursor.",
    );
  return offset;
}
function normalizeGoogleStatus(value: unknown): string {
  const status = String(value || "UNKNOWN").toUpperCase();
  return status === "ENABLED"
    ? "active"
    : status === "REMOVED"
      ? "disabled"
      : status.toLowerCase();
}
function dedupeAccounts(
  accounts: NormalizedProviderAccount[],
): NormalizedProviderAccount[] {
  return [
    ...new Map(
      accounts.map((account) => [account.externalAccountId, account]),
    ).values(),
  ];
}

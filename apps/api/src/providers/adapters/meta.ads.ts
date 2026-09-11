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
import type { MetaInsightsRequest } from "../meta-insights.parameters.js";
import {
  assertExternalId,
  encodeJson,
  providerJson,
} from "../provider-http.js";
import {
  numberValue,
  provenance,
  sumMetrics,
  validateDateRange,
} from "../provider-normalization.js";
import type {
  MetaBusiness,
  MetaControlledCampaignReadAdapter,
  MetaControlledCampaignState,
  MetaPage,
  NormalizedProviderAccount,
  OAuthExchangeContext,
  OAuthStartContext,
  ProviderCredentialPayload,
  ProviderMutationAdapter,
  ProviderOAuthAdapter,
  ProviderCampaignMutation,
  ProviderReadAdapter,
  ProviderReadContext,
} from "../provider.types.js";

const CORE_SCOPES = [
  "ads_read",
  "business_management",
  "pages_show_list",
  "pages_read_engagement",
];

export const metaAdsDefinition = (
  config: AppConfig,
  configured: boolean,
): ProviderDefinition => ({
  id: "META_ADS",
  displayName: "Meta Ads",
  oauth: true,
  pkce: false,
  accountDiscovery: true,
  refresh: true,
  read: configured,
  write: configured && config.providerMetaAdsManagementOauthEnabled,
  status: configured ? "available" : "configuration_required",
  scopes: [
    ...CORE_SCOPES,
    ...(config.providerMetaAdsManagementOauthEnabled ? ["ads_management"] : []),
  ],
});

type MetaResponse = Record<string, unknown>;

export class MetaAdsAdapter
  implements
    ProviderOAuthAdapter,
    ProviderReadAdapter,
    ProviderMutationAdapter,
    MetaControlledCampaignReadAdapter
{
  public readonly definition: ProviderDefinition;
  private readonly config: AppConfig;

  public constructor(config: AppConfig = loadConfig()) {
    this.config = config;
    this.definition = metaAdsDefinition(
      config,
      Boolean(
        config.providerMetaClientId &&
        config.providerMetaClientSecret &&
        config.providerMetaRedirectUri,
      ),
    );
  }

  public authorizationUrl(context: OAuthStartContext): string {
    const url = new URL(
      `https://www.facebook.com/${this.config.providerMetaApiVersion}/dialog/oauth`,
    );
    url.searchParams.set(
      "client_id",
      this.required(this.config.providerMetaClientId),
    );
    url.searchParams.set("redirect_uri", context.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.definition.scopes.join(","));
    url.searchParams.set("state", context.state);
    return url.toString();
  }

  public async exchangeCode(
    context: OAuthExchangeContext,
  ): Promise<ProviderCredentialPayload> {
    const url = this.graphUrl("oauth/access_token", {
      client_id: this.required(this.config.providerMetaClientId),
      client_secret: this.required(this.config.providerMetaClientSecret),
      redirect_uri: context.redirectUri,
      code: context.code,
    });
    const response = await this.get(url);
    const token = String(response.access_token || "");
    if (!token)
      throw new ProviderError(
        "authentication_failed",
        "Meta OAuth did not return an access token.",
      );
    const identity = await this.get(
      this.graphUrl("me", { fields: "id,name", access_token: token }),
    );
    const permissions = await this.permissionPayload(token);
    const expiresIn = numberValue(response.expires_in);
    return {
      accessToken: token,
      ...(expiresIn
        ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
        : {}),
      tokenType: String(response.token_type || "Bearer"),
      scopes: permissions.granted,
      externalSubjectId: String(identity.id || ""),
      displayName: String(identity.name || "Meta connection"),
      providerMetadata: {
        requestedScopes: this.definition.scopes.join(","),
        declinedScopes: permissions.declined.join(","),
      },
    };
  }

  public async refreshCredentials(
    credentials: ProviderCredentialPayload,
  ): Promise<ProviderCredentialPayload> {
    const url = this.graphUrl("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: this.required(this.config.providerMetaClientId),
      client_secret: this.required(this.config.providerMetaClientSecret),
      fb_exchange_token: credentials.accessToken,
    });
    const response = await this.get(url);
    const token = String(response.access_token || "");
    if (!token)
      throw new ProviderError(
        "refresh_failed",
        "Meta authorization refresh failed.",
      );
    const expiresIn = numberValue(response.expires_in);
    return {
      ...credentials,
      accessToken: token,
      ...(expiresIn
        ? { expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() }
        : {}),
    };
  }

  public async discoverAccounts(
    credentials: ProviderCredentialPayload,
  ): Promise<NormalizedProviderAccount[]> {
    const response = await this.listEdge(
      "me/adaccounts",
      { fields: "id,name,currency,timezone_name,account_status" },
      credentials.accessToken,
      500,
    );
    return response
      .map((row) => ({
        externalAccountId: String(row.id || ""),
        displayName: String(row.name || `Meta Ads ${row.id || ""}`),
        ...(optionalString(row.currency)
          ? { currency: optionalString(row.currency)! }
          : {}),
        ...(optionalString(row.timezoneName ?? row.timezone_name)
          ? { timezone: optionalString(row.timezoneName ?? row.timezone_name)! }
          : {}),
        status: metaAccountStatus(row.accountStatus ?? row.account_status),
        metadata: {
          source: "Meta Graph API",
          accountId: String(row.accountId || row.id || ""),
        },
      }))
      .filter((row) => row.externalAccountId.length > 0);
  }

  public async getAccountSummary(
    context: ProviderReadContext,
    range?: ProviderDateRange,
  ): Promise<ProviderAccountSummary> {
    const accountId = metaAccountPath(context.accountId);
    const account = await this.get(
      this.graphUrl(accountId, {
        fields: "id,name,currency,timezone_name,account_status",
        access_token: context.credentials.accessToken,
      }),
    );
    const currency = optionalString(account.currency);
    const base = {
      externalAccountId: String(account.id || context.accountId),
      displayName: String(account.name || context.accountId),
      currency,
      timezone: optionalString(account.timezoneName ?? account.timezone_name),
      status: metaAccountStatus(
        account.accountStatus ?? account.account_status,
      ),
    };
    const metrics = range ? await this.getMetrics(context, range) : undefined;
    return {
      id: "",
      provider: "META_ADS",
      ...base,
      enabled: true,
      discoveredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
      ...(metrics ? { metrics } : {}),
      provenance: provenance("META_ADS", "Meta Graph API ad account"),
    };
  }

  public async listCampaigns(
    context: ProviderReadContext,
    range?: ProviderDateRange,
    limit = 100,
    cursor?: string,
  ) {
    const accountId = metaAccountPath(context.accountId);
    const result = await this.edgePage(
      `${accountId}/campaigns`,
      {
        fields:
          "id,name,status,effective_status,objective,daily_budget,lifetime_budget",
      },
      context.credentials.accessToken,
      Math.min(Math.max(limit, 1), 500),
      cursor,
    );
    const items = result.items.map(
      (row) =>
        ({
          id: String(row.id || ""),
          name: String(row.name || ""),
          status: optionalString(
            row.effectiveStatus || row.effective_status || row.status,
          ),
          objective: optionalString(row.objective),
          budget: metaBudget(
            row,
            context.currency ?? optionalString(row.currency),
          ),
          metadata: {
            source: "Meta Graph API",
            configuredStatus: optionalString(row.configuredStatus),
          },
          provenance: provenance("META_ADS", "Meta Graph API campaign"),
        }) satisfies ProviderCampaign,
    );
    return {
      ...result,
      items,
    };
  }

  public async getMetrics(
    context: ProviderReadContext,
    range: ProviderDateRange,
    campaignId?: string,
  ): Promise<ProviderMetricSummary> {
    const normalized = validateDateRange(range);
    const accountId = metaAccountPath(context.accountId);
    const params: Record<string, string> = {
      fields: "spend,impressions,clicks,ctr,cpc,cpm,actions",
      time_range: encodeJson({
        since: normalized.startDate,
        until: normalized.endDate,
      }),
      access_token: context.credentials.accessToken,
    };
    if (campaignId) {
      params.level = "campaign";
      params.filtering = encodeJson([
        {
          field: "campaign.id",
          operator: "EQUAL",
          value: assertExternalId(campaignId, "campaign id"),
        },
      ]);
    }
    const rows = await this.listEdge(
      `${accountId}/insights`,
      params,
      context.credentials.accessToken,
      500,
    );
    const normalizedRows = rows.map((row) => ({
      raw: { ...row, conversions: metaConversions(row.actions) },
      spend: row.spend,
    }));
    return sumMetrics(normalizedRows, context.currency ?? null);
  }

  public async flexibleInsights(
    context: ProviderReadContext,
    request: MetaInsightsRequest,
  ) {
    const fields = [
      ...new Set([
        "account_currency",
        "date_start",
        "date_stop",
        ...(request.level !== "account"
          ? ["campaign_id", "campaign_name"]
          : []),
        ...(["adset", "ad"].includes(request.level)
          ? ["adset_id", "adset_name"]
          : []),
        ...(request.level === "ad" ? ["ad_id", "ad_name"] : []),
        ...request.metrics.map((m) =>
          ["conversions", "results"].includes(m) ? "actions" : m,
        ),
      ]),
    ];
    const params: Record<string, string> = {
      fields: fields.join(","),
      level: request.level,
      time_range: encodeJson({
        since: request.range.startDate,
        until: request.range.endDate,
      }),
    };
    if (request.breakdowns.length)
      params.breakdowns = request.breakdowns.join(",");
    if (request.campaignId)
      params.filtering = encodeJson([
        {
          field: "campaign.id",
          operator: "EQUAL",
          value: assertExternalId(request.campaignId, "campaign id"),
        },
      ]);
    const unsupportedMetrics: Array<{
      metric: string;
      reason: string;
      upstream_code: string;
    }> = [];
    const page = await this.edgePage(
      `${metaAccountPath(context.accountId)}/insights`,
      params,
      context.credentials.accessToken,
      request.limit,
      request.cursor,
    ).catch(async (error: unknown) => {
      // Only a deterministic invalid-field/combination response permits a read-only
      // retry without this known optional metric. Never mask auth or rate limits.
      if (
        !(error instanceof ProviderError) ||
        error.providerCode !== "100" ||
        !request.metrics.includes("purchase_roas") ||
        request.metrics.length < 2
      )
        throw error;
      const supported = await this.edgePage(
        `${metaAccountPath(context.accountId)}/insights`,
        {
          ...params,
          fields: fields.filter((f) => f !== "purchase_roas").join(","),
        },
        context.credentials.accessToken,
        request.limit,
        request.cursor,
      );
      unsupportedMetrics.push({
        metric: "purchase_roas",
        reason:
          "meta_rejected_metric_combination; other requested metrics fetched in a separate valid request",
        upstream_code: "100",
      });
      return supported;
    });
    const effectiveMetrics = request.metrics.filter(
      (m) => !unsupportedMetrics.some((u) => u.metric === m),
    );
    const items = page.items.map((row) => {
      const result: Record<string, unknown> = {
        currency: row.account_currency ?? context.currency ?? null,
        date_start: row.date_start ?? null,
        date_stop: row.date_stop ?? null,
      };
      for (const field of fields.filter((f) => !request.metrics.includes(f)))
        if (row[field] !== undefined) result[field] = row[field];
      for (const metric of effectiveMetrics) {
        if (["conversions", "results"].includes(metric)) {
          result[metric] = metaConversions(row.actions);
          continue;
        }
        if (
          [
            "actions",
            "action_values",
            "cost_per_action_type",
            "purchase_roas",
          ].includes(metric)
        ) {
          result[metric] = Array.isArray(row[metric])
            ? (row[metric] as MetaResponse[]).map((a) => ({
                action_type: String(a.action_type ?? ""),
                value: numberValue(a.value),
              }))
            : [];
        } else result[metric] = numberValue(row[metric]);
      }
      for (const field of request.breakdowns)
        result[field] = row[field] ?? null;
      return result;
    });
    return {
      ...page,
      items,
      period: request.range,
      level: request.level,
      requested_metrics: request.metrics,
      returned_metrics: effectiveMetrics.filter((m) =>
        page.items.some((row) =>
          Object.hasOwn(
            row,
            ["conversions", "results"].includes(m) ? "actions" : m,
          ),
        ),
      ),
      unsupported_metrics: unsupportedMetrics,
      unavailable_metrics: effectiveMetrics
        .filter(
          (m) =>
            !page.items.some((row) =>
              Object.hasOwn(
                row,
                ["conversions", "results"].includes(m) ? "actions" : m,
              ),
            ),
        )
        .map((metric) => ({
          metric,
          reason:
            "not_returned_by_meta_for_this_response; not a zero or proof of unsupported capability",
        })),
      breakdowns: request.breakdowns,
      provenance: provenance(
        "META_ADS",
        "Meta Graph API Insights",
        items.length ? "live" : "empty",
      ),
    };
  }

  public async readEntity(
    context: ProviderReadContext,
    kind: "campaign" | "adset" | "ad",
    id?: string,
    limit = 100,
    cursor?: string,
  ) {
    const fields =
      kind === "campaign"
        ? "id,account_id,name,status,effective_status,objective,daily_budget,lifetime_budget"
        : kind === "adset"
          ? "id,account_id,campaign_id,name,status,effective_status,daily_budget,lifetime_budget,start_time,end_time"
          : "id,account_id,campaign_id,adset_id,name,status,effective_status";
    if (id) {
      const row = await this.get(
        this.graphUrl(assertExternalId(id, "object id"), {
          fields,
          access_token: context.credentials.accessToken,
        }),
      );
      if (
        String(row.id) !== id ||
        metaAccountPath(String(row.account_id ?? "")) !==
          metaAccountPath(context.accountId)
      )
        throw new ProviderError(
          "invalid_account",
          "Object does not belong to selected account.",
        );
      return {
        ...row,
        provenance: provenance("META_ADS", `Meta Graph API ${kind}`),
      };
    }
    const page = await this.edgePage(
      `${metaAccountPath(context.accountId)}/${kind === "campaign" ? "campaigns" : kind === "adset" ? "adsets" : "ads"}`,
      { fields },
      context.credentials.accessToken,
      limit,
      cursor,
    );
    return {
      ...page,
      provenance: provenance("META_ADS", `Meta Graph API ${kind}`),
    };
  }

  public async detailedReport(
    context: ProviderReadContext,
    request: MetaInsightsRequest,
  ) {
    const insights = await this.flexibleInsights(context, {
      ...request,
      level: "campaign",
    });
    const items = [];
    // Bound provider concurrency; a 100-row report must not burst 100 requests.
    for (let offset = 0; offset < insights.items.length; offset += 5) {
      items.push(
        ...(await Promise.all(
          insights.items.slice(offset, offset + 5).map(async (metrics) => {
            const id = assertExternalId(
              String(metrics.campaign_id ?? ""),
              "campaign id",
            );
            const campaign = await this.get(
              this.graphUrl(id, {
                fields: "id,name,status,account_id",
                access_token: context.credentials.accessToken,
              }),
            );
            if (
              metaAccountPath(String(campaign.account_id ?? "")) !==
              metaAccountPath(context.accountId)
            )
              throw new ProviderError(
                "invalid_account",
                "Campaign does not belong to selected account.",
              );
            return {
              id,
              name: String(campaign.name ?? metrics.campaign_name ?? ""),
              status: optionalString(campaign.status),
              metrics,
            };
          }),
        )),
      );
    }
    return {
      ...insights,
      items,
      report_type: "campaign_performance",
      coverage: "campaigns_with_insights_in_requested_period",
    };
  }

  private async edgePage(
    path: string,
    params: Record<string, string>,
    token: string,
    limit: number,
    cursor?: string,
  ) {
    const bounded = Math.min(Math.max(limit, 1), 100);
    const response = await this.get(
      this.graphUrl(path, {
        ...params,
        access_token: token,
        limit: String(bounded),
        ...(cursor ? { after: cursor } : {}),
      }),
    );
    const items = Array.isArray(response.data)
      ? response.data.filter(
          (r): r is MetaResponse => !!r && typeof r === "object",
        )
      : [];
    const paging =
      response.paging && typeof response.paging === "object"
        ? (response.paging as MetaResponse)
        : {};
    const cursors =
      paging.cursors && typeof paging.cursors === "object"
        ? (paging.cursors as MetaResponse)
        : {};
    const next = typeof paging.next === "string" && !!paging.next;
    const after =
      typeof cursors.after === "string" &&
      /^[A-Za-z0-9_=-]{1,2048}$/.test(cursors.after)
        ? cursors.after
        : undefined;
    return {
      items: items.slice(0, bounded),
      ...(next && after ? { nextCursor: after } : {}),
      truncated: !!next || items.length > bounded,
    };
  }

  public async health(
    context: ProviderReadContext,
  ): Promise<ProviderHealthView> {
    let missingScopes = this.definition.scopes.filter(
      (scope) => !context.credentials.scopes.includes(scope),
    );
    try {
      await this.get(
        this.graphUrl(metaAccountPath(context.accountId), {
          fields: "id",
          access_token: context.credentials.accessToken,
        }),
      );
      const permissions = await this.permissionPayload(
        context.credentials.accessToken,
      );
      missingScopes = this.definition.scopes.filter(
        (scope) => !permissions.granted.includes(scope),
      );
      return {
        credentialsValid: true,
        providerReachable: true,
        scopesSufficient: missingScopes.length === 0,
        accountReachable: true,
        selectedAccountValid: true,
        status: missingScopes.length ? "degraded" : "healthy",
        missingScopes,
        provenance: provenance("META_ADS", "Meta Graph API health"),
      };
    } catch (error) {
      const status =
        error instanceof ProviderError &&
        [
          "authentication_failed",
          "connection_revoked",
          "refresh_failed",
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
        provenance: provenance("META_ADS", "Meta Graph API health", "partial"),
      };
    }
  }

  public async mutateCampaign(
    context: ProviderReadContext,
    mutation: ProviderCampaignMutation,
  ): Promise<{ externalObjectId: string; providerAccepted: boolean }> {
    if (!context.credentials.scopes.includes("ads_management"))
      throw new ProviderError(
        "insufficient_permissions",
        "Meta ads_management permission is required.",
      );
    const objectId = assertExternalId(mutation.objectId, "campaign id");
    const body = new URLSearchParams({
      access_token: context.credentials.accessToken,
    });
    if (mutation.operation === "change_name") {
      const name = String(mutation.payload.new_name ?? "").trim();
      if (!name || name.length > 255)
        throw new ProviderError(
          "provider_response_invalid",
          "Campaign name is invalid.",
        );
      body.set("name", name);
    } else {
      body.set("status", mutation.operation === "pause" ? "PAUSED" : "ACTIVE");
    }
    const response = await providerJson<MetaResponse>(
      this.graphUrl(objectId, {}),
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
      },
      this.config.providerHttpTimeoutMs,
    );
    if (response.success !== true)
      throw new ProviderError(
        "provider_response_invalid",
        "Meta did not confirm the campaign rename.",
      );
    return { externalObjectId: objectId, providerAccepted: true };
  }

  public async readControlledCampaign(
    context: ProviderReadContext,
    campaignId: string,
  ): Promise<MetaControlledCampaignState> {
    const id = assertExternalId(campaignId, "campaign id");
    const row = await this.get(
      this.graphUrl(id, {
        fields:
          "id,account_id,name,status,effective_status,objective,daily_budget,lifetime_budget,buying_type,start_time,stop_time",
        access_token: context.credentials.accessToken,
      }),
    );
    const accountId = metaAccountPath(
      String(row.account_id ?? row.accountId ?? ""),
    );
    if (
      id !== String(row.id ?? "") ||
      accountId !== metaAccountPath(context.accountId)
    )
      throw new ProviderError(
        "invalid_account",
        "Campaign does not belong to the selected Meta ad account.",
      );
    const name = String(row.name ?? "").trim();
    const status = String(row.status ?? "").trim();
    if (!name || !status)
      throw new ProviderError(
        "provider_response_invalid",
        "Meta did not return the campaign state required for verification.",
      );
    return {
      id,
      accountId,
      name,
      status,
      effectiveStatus: optionalString(
        row.effective_status ?? row.effectiveStatus,
      ),
      objective: optionalString(row.objective),
      dailyBudget: optionalString(row.daily_budget ?? row.dailyBudget),
      lifetimeBudget: optionalString(row.lifetime_budget ?? row.lifetimeBudget),
      buyingType: optionalString(row.buying_type ?? row.buyingType),
      startTime: optionalString(row.start_time ?? row.startTime),
      stopTime: optionalString(row.stop_time ?? row.stopTime),
    };
  }

  public async listBusinesses(
    credentials: ProviderCredentialPayload,
  ): Promise<MetaBusiness[]> {
    const rows = await this.listEdge(
      "me/businesses",
      { fields: "id,name,verification_status" },
      credentials.accessToken,
      500,
    );
    return rows
      .map((row) => ({
        id: String(row.id || ""),
        name: optionalString(row.name),
        verificationStatus: optionalString(
          row.verificationStatus ?? row.verification_status,
        ),
        provenance: provenance("META_ADS", "Meta Graph API /me/businesses"),
      }))
      .filter((row) => row.id);
  }

  public async getPermissions(
    credentials: ProviderCredentialPayload,
  ): Promise<{ granted: string[]; declined: string[] }> {
    return this.permissionPayload(credentials.accessToken);
  }

  public async listPages(
    credentials: ProviderCredentialPayload,
  ): Promise<MetaPage[]> {
    const rows = await this.listEdge(
      "me/accounts",
      { fields: "id,name,category,instagram_business_account{id,username}" },
      credentials.accessToken,
      500,
    );
    return rows
      .map((row) => ({
        id: String(row.id || ""),
        name: optionalString(row.name),
        category: optionalString(row.category),
        linkedInstagram: instagramValue(
          row.instagramBusinessAccount || row.instagram_business_account,
        ),
        provenance: provenance("META_ADS", "Meta Graph API /me/accounts"),
      }))
      .filter((row) => row.id);
  }

  public async listBusinessAdAccounts(
    credentials: ProviderCredentialPayload,
    businessId: string,
  ): Promise<NormalizedProviderAccount[]> {
    const id = assertExternalId(businessId, "business id");
    const rows = (
      await Promise.all(
        ["owned_ad_accounts", "client_ad_accounts"].map((edge) =>
          this.listEdge(
            `${id}/${edge}`,
            {
              fields:
                "id,account_id,name,currency,timezone_name,account_status",
            },
            credentials.accessToken,
            500,
          ),
        ),
      )
    ).flat();
    return [...new Map(rows.map((row) => [String(row.id || ""), row])).values()]
      .filter((row) => row.id)
      .map((row) => ({
        externalAccountId: String(row.id),
        displayName: String(row.name || row.id),
        ...(optionalString(row.currency)
          ? { currency: optionalString(row.currency)! }
          : {}),
        ...(optionalString(row.timezoneName ?? row.timezone_name)
          ? { timezone: optionalString(row.timezoneName ?? row.timezone_name)! }
          : {}),
        status: metaAccountStatus(row.accountStatus ?? row.account_status),
        metadata: { source: "Meta Graph API Business asset" },
      }));
  }

  public async listBusinessPages(
    credentials: ProviderCredentialPayload,
    businessId: string,
  ): Promise<MetaPage[]> {
    const id = assertExternalId(businessId, "business id");
    const rows = (
      await Promise.all(
        ["owned_pages", "client_pages"].map((edge) =>
          this.listEdge(
            `${id}/${edge}`,
            {
              fields:
                "id,name,category,instagram_business_account{id,username}",
            },
            credentials.accessToken,
            500,
          ),
        ),
      )
    ).flat();
    return [...new Map(rows.map((row) => [String(row.id || ""), row])).values()]
      .filter((row) => row.id)
      .map((row) => ({
        id: String(row.id),
        name: optionalString(row.name),
        category: optionalString(row.category),
        linkedInstagram: instagramValue(
          row.instagramBusinessAccount || row.instagram_business_account,
        ),
        provenance: provenance(
          "META_ADS",
          "Meta Graph API Business Page asset",
        ),
      }));
  }

  public async getPagePost(
    credentials: ProviderCredentialPayload,
    pageId: string,
    postId: string,
    engagement = false,
  ) {
    if (
      !/^\d{1,40}$/.test(pageId) ||
      !new RegExp(`^${pageId}_[0-9]{1,40}$`).test(postId)
    )
      throw new ProviderError(
        "invalid_account",
        "Post does not belong to selected Page.",
      );
    const token = await this.pageAccessToken(credentials.accessToken, pageId);
    const row = await this.get(
      this.graphUrl(postId, {
        fields: engagement
          ? "id,shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)"
          : "id,message,story,created_time,permalink_url,shares",
        access_token: token,
      }),
    );
    if (row.id !== postId)
      throw new ProviderError("invalid_account", "Unexpected Page post.");
    return {
      ...row,
      provenance: provenance("META_ADS", "Meta Graph API Page post"),
    };
  }

  public async listPagePosts(
    credentials: ProviderCredentialPayload,
    pageId: string,
    limit = 25,
    cursor?: string,
  ) {
    const token = await this.pageAccessToken(credentials.accessToken, pageId);
    const edge = `${assertExternalId(pageId, "page id")}/published_posts`;
    const fieldVariants = [
      "id,message,story,created_time,permalink_url,full_picture,attachments{description,title,type,url},shares,reactions.limit(0).summary(true),comments.limit(0).summary(true)",
      "id,message,story,created_time,permalink_url,full_picture,attachments{description,title,type,url},shares,reactions.limit(0).summary(true)",
      "id,message,story,created_time,permalink_url,full_picture,attachments{description,title,type,url},shares",
    ];
    let rows: MetaResponse[] = [];
    let nextCursor: string | undefined;
    let truncated = false;
    for (const [index, fields] of fieldVariants.entries()) {
      try {
        const page = await this.edgePage(
          edge,
          { fields },
          token,
          limit,
          cursor,
        );
        rows = page.items;
        nextCursor = page.nextCursor;
        truncated = page.truncated;
        break;
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          !["provider_response_invalid", "insufficient_permissions"].includes(
            error.code,
          ) ||
          index === fieldVariants.length - 1
        ) {
          throw error;
        }
      }
    }
    return {
      items: rows,
      ...(nextCursor ? { nextCursor } : {}),
      truncated,
      provenance: provenance(
        "META_ADS",
        "Meta Graph API Page published_posts",
        rows.length ? "live" : "empty",
      ),
    };
  }

  public async getPageInstagramAccount(
    credentials: ProviderCredentialPayload,
    pageId: string,
  ): Promise<MetaPage> {
    const token = await this.pageAccessToken(credentials.accessToken, pageId);
    const row = await this.get(
      this.graphUrl(assertExternalId(pageId, "page id"), {
        fields: "id,name,instagram_business_account{id,username}",
        access_token: token,
      }),
    );
    const linkedInstagram = instagramValue(
      row.instagramBusinessAccount || row.instagram_business_account,
    );
    return {
      id: String(row.id || pageId),
      name: optionalString(row.name),
      linkedInstagram,
      provenance: provenance(
        "META_ADS",
        "Meta Graph API Page instagram_business_account",
        linkedInstagram ? "live" : "empty",
      ),
    };
  }

  private async pageAccessToken(
    userToken: string,
    pageId: string,
  ): Promise<string> {
    const rows = await this.listEdge(
      "me/accounts",
      { fields: "id,access_token" },
      userToken,
      500,
    );
    const page = rows.find((row) => String(row.id || "") === pageId);
    const token = String(page?.accessToken || page?.access_token || "");
    if (!token)
      throw new ProviderError(
        "insufficient_permissions",
        "Meta did not provide a Page access token.",
      );
    return token;
  }

  private async permissionPayload(
    token: string,
  ): Promise<{ granted: string[]; declined: string[] }> {
    const rows = await this.listEdge(
      "me/permissions",
      { fields: "permission,status" },
      token,
      200,
    );
    const granted = rows
      .filter((row) => row.status === "granted")
      .map((row) => String(row.permission || ""))
      .filter(Boolean);
    const declined = rows
      .filter((row) => row.status !== "granted")
      .map((row) => String(row.permission || ""))
      .filter(Boolean);
    return { granted: [...new Set(granted)], declined: [...new Set(declined)] };
  }

  private async listEdge(
    path: string,
    params: Record<string, string>,
    token: string,
    limit: number,
  ): Promise<MetaResponse[]> {
    const rows: MetaResponse[] = [];
    let url = this.graphUrl(path, {
      ...params,
      access_token: token,
      limit: String(Math.min(Math.max(limit, 1), 100)),
    });
    for (let page = 0; page < 10 && rows.length < limit; page += 1) {
      const payload = await this.get(url);
      const data = Array.isArray(payload.data) ? payload.data : [];
      rows.push(
        ...data.filter((row): row is MetaResponse =>
          Boolean(row && typeof row === "object"),
        ),
      );
      const next =
        payload.paging && typeof payload.paging === "object"
          ? String((payload.paging as Record<string, unknown>).next || "")
          : "";
      if (!next || !next.startsWith("https://graph.facebook.com/")) break;
      url = next;
    }
    return rows.slice(0, limit);
  }

  private async get(url: string): Promise<MetaResponse> {
    const parsed = new URL(url);
    const accessToken = parsed.searchParams.get("access_token");
    parsed.searchParams.delete("access_token");
    return providerJson<MetaResponse>(
      parsed.toString(),
      {
        method: "GET",
        headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      },
      this.config.providerHttpTimeoutMs,
    );
  }

  private graphUrl(path: string, params: Record<string, string>): string {
    const normalized = path.replace(/^\/+/, "");
    return `https://graph.facebook.com/${this.config.providerMetaApiVersion}/${normalized}?${new URLSearchParams(params).toString()}`;
  }

  private required(value: string | undefined): string {
    if (!value)
      throw new ProviderError(
        "provider_not_configured",
        "Meta provider is not configured.",
      );
    return value;
  }
}

function metaAccountPath(value: string): string {
  const normalized = value.replace(/^act_/, "");
  if (!/^\d{1,30}$/.test(normalized))
    throw new ProviderError(
      "invalid_account",
      "Meta ad account ID is invalid.",
    );
  return `act_${normalized}`;
}
function optionalString(value: unknown): string | null {
  return value === undefined || value === null || value === ""
    ? null
    : String(value);
}
function metaAccountStatus(value: unknown): string {
  const status = String(value ?? "unknown");
  return status === "1"
    ? "active"
    : status === "2"
      ? "disabled"
      : status.toLowerCase();
}
function metaBudget(row: MetaResponse, currency: string | null) {
  const daily = numberValue(row.dailyBudget ?? row.daily_budget);
  const lifetime = numberValue(row.lifetimeBudget ?? row.lifetime_budget);
  const amount = daily ?? lifetime;
  return amount === null
    ? null
    : { amount: (amount / 100).toFixed(2), currency };
}
function instagramValue(
  value: unknown,
): { id: string; username: string | null } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as MetaResponse;
  const id = String(row.id || "");
  return id ? { id, username: optionalString(row.username) } : null;
}
function metaConversions(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set([
    "lead",
    "offsite_conversion",
    "purchase",
    "complete_registration",
  ]);
  let total = 0;
  let found = false;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as MetaResponse;
    if (!allowed.has(String(row.actionType || row.action_type || ""))) continue;
    const count = numberValue(row.value);
    if (count !== null) {
      total += count;
      found = true;
    }
  }
  return found ? total : null;
}

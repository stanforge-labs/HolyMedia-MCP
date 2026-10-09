import { createHash } from "node:crypto";
import {
  assertExtendedGate,
  assertExtendedPlan,
  rereadExtendedChecks,
  verifyExtendedMutation,
  extendedProviderOperation,
  decodeExtendedMutation,
  type ExtendedPlan,
} from "../google-ads-extended-plan.js";
import { buildStage2AdvancedPlan } from "../google-ads-stage2-advanced.js";
import {
  buildStage3Plan,
  searchStage3Audiences,
} from "../google-ads-stage3.js";
import { buildStage4Plan } from "../google-ads-stage4.js";
import {
  getGoogleTrackingSpecs,
  auditGoogleLinksAndUtms,
} from "../google-ads-tracking-audit.js";
import {
  assertStage2Gate,
  assertStage2Plan,
  buildStage2Plan,
  rereadStage2Checks,
  verifyStage2Mutation,
  type Stage2Plan,
} from "../google-ads-stage2.js";
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
import { googleAdsApiError, GoogleAdsApiError } from "../google-ads.error.js";
import {
  buildStage0Plan,
  buildResumePlan,
  buildPausePlan,
  buildClonePlan,
  rereadStage0Checks,
  stage0ProviderOperations,
  decodeStage0Mutation,
  verifyStage0Mutation,
  launchChecklist,
  row as stage0Row,
  type Stage0Plan,
} from "../google-ads-stage0.js";
import {
  buildStage1Plan,
  rereadStage1Checks,
  providerOperation,
  decodeStage1Mutation,
  verifyStage1Mutation,
  type Stage1Plan,
  type Stage1MutationResult,
} from "../google-ads-stage1.js";
import {
  assertGoogleWriteAccount,
  keywordBatch,
  googleMutationResults,
  GoogleAdsWriteError,
  writeFailureFromError,
  googleWriteFailure,
  type GoogleKeywordIdentity,
  type GoogleKeywordSnapshot,
  type GoogleKeywordMutation,
  type GoogleKeywordWriteAdapter,
} from "../google-ads-write.js";
import {
  decodeGoogleCursor,
  encodeGoogleCursor,
} from "../google-ads-cursor.js";
import { keywordOptions, listGoogleKeywords } from "../google-ads-keywords.js";
import {
  checkGoogleNegativeConflicts,
  listGoogleNegatives,
} from "../google-ads-negatives.js";
import {
  listGoogleSearchTerms,
  searchTermOptions,
} from "../google-ads-search-terms.js";
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
  GoogleNegativeConflictOptions,
  GoogleNegativeOptions,
  GoogleSearchTermOptions,
} from "../provider.types.js";

const GOOGLE_SCOPE = "https://www.googleapis.com/auth/adwords";
const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CAMPAIGN_FIELDS =
  "campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, campaign_budget.resource_name, campaign_budget.explicitly_shared, campaign_budget.period";
const CAMPAIGN_METRIC_FIELDS =
  ", metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion";

export const googleAdsDefinition = (
  configured: boolean,
  googleAdsWriteEnabled = false,
): ProviderDefinition => ({
  id: "GOOGLE_ADS",
  displayName: "Google Ads",
  oauth: true,
  pkce: false,
  accountDiscovery: true,
  refresh: true,
  read: configured,
  write: configured && googleAdsWriteEnabled,
  status: configured ? "available" : "configuration_required",
  scopes: [GOOGLE_SCOPE],
});

export class GoogleAdsAdapter
  implements
    ProviderOAuthAdapter,
    ProviderReadAdapter,
    GoogleKeywordWriteAdapter
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
      config.providerGoogleAdsWriteEnabled,
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
    const loginCustomerId = this.contextLoginCustomerId(context);
    const statusFilter = campaignStatusFilter(statuses);
    const dates = range ? validateDateRange(range) : undefined;
    const cursorContext = createHash("sha256")
      .update(
        JSON.stringify({
          customerId,
          dates: dates ?? null,
          statusFilter,
          limit: safeLimit,
        }),
      )
      .digest("hex");
    const lastId = campaignCursorId(
      cursor,
      cursorContext,
      this.config.sessionHashSecret,
    );
    const filters = [
      statusFilter,
      ...(lastId ? [`campaign.id > ${lastId}`] : []),
      ...(dates
        ? [`segments.date BETWEEN '${dates.startDate}' AND '${dates.endDate}'`]
        : []),
    ];
    const [rows, customer] = await Promise.all([
      this.searchStream(
        context.credentials.accessToken,
        customerId,
        loginCustomerId,
        `SELECT ${CAMPAIGN_FIELDS}${dates ? CAMPAIGN_METRIC_FIELDS : ""} FROM campaign WHERE ${filters.join(" AND ")} ORDER BY campaign.id LIMIT ${safeLimit + 1}`,
      ),
      context.currency
        ? Promise.resolve([])
        : this.customerRows(context.credentials, customerId, loginCustomerId),
    ]);
    const currency = context.currency ?? customer[0]?.currency ?? null;
    const items = rows
      .slice(0, safeLimit)
      .map((row) => googleCampaignFromRow(row, currency, Boolean(dates)));
    const finalId = items.at(-1)?.id;
    return {
      items,
      ...(rows.length > safeLimit && finalId
        ? {
            nextCursor: encodeGoogleCursor(
              { id: finalId },
              cursorContext,
              this.config.sessionHashSecret,
              "campaigns",
            ),
          }
        : {}),
    };
  }

  public async getCampaign(
    context: ProviderReadContext,
    campaignId: string,
    range?: ProviderDateRange,
  ): Promise<ProviderCampaign | null> {
    const customerId = assertCustomerId(context.accountId);
    const id = assertCampaignId(campaignId);
    const loginCustomerId = this.contextLoginCustomerId(context);
    const [rows, customer] = await Promise.all([
      this.searchStream(
        context.credentials.accessToken,
        customerId,
        loginCustomerId,
        `SELECT ${CAMPAIGN_FIELDS} FROM campaign WHERE campaign.id = ${id} AND campaign.status != 'REMOVED' LIMIT 1`,
      ),
      context.currency
        ? Promise.resolve([])
        : this.customerRows(context.credentials, customerId, loginCustomerId),
    ]);
    const row = rows.find(
      (value) => String(object(value.campaign).id ?? "") === id,
    );
    if (!row) return null;
    const currency = context.currency ?? customer[0]?.currency ?? null;
    const campaign = googleCampaignFromRow(row, currency, false);
    if (range)
      campaign.metrics = await this.getMetrics(
        context,
        validateDateRange(range),
        id,
      );
    return campaign;
  }

  public async getMetrics(
    context: ProviderReadContext,
    range: ProviderDateRange,
    campaignId?: string,
  ): Promise<ProviderMetricSummary> {
    const normalized = validateDateRange(range);
    const customerId = assertCustomerId(context.accountId);
    const filter = campaignId
      ? `campaign.id = ${assertCampaignId(campaignId)} AND `
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

  public async readKeywordStates(
    context: ProviderReadContext,
    items: GoogleKeywordIdentity[],
  ): Promise<GoogleKeywordSnapshot[]> {
    const account = assertCustomerId(context.accountId);
    const selected = keywordBatch(account, items);
    const rows = await this.searchStream(
      context.credentials.accessToken,
      account,
      this.contextLoginCustomerId(context),
      `SELECT campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.type FROM ad_group_criterion WHERE ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE AND ad_group_criterion.resource_name IN (${selected.map((x) => `'${x.resource_name}'`).join(", ")})`,
    );
    return selected.map((item) => {
      const matches = rows.filter(
        (row) =>
          object(row.adGroupCriterion).resourceName === item.resource_name,
      );
      const row = matches[0],
        criterion = object(row?.adGroupCriterion),
        campaign = object(row?.campaign),
        group = object(row?.adGroup),
        keyword = object(criterion.keyword);
      if (
        matches.length !== 1 ||
        String(campaign.id) !== item.campaign_id ||
        String(group.id) !== item.ad_group_id ||
        String(criterion.criterionId) !== item.criterion_id ||
        // ProtoJSON may omit a default false; GAQL also excludes negatives.
        (criterion.negative !== undefined && criterion.negative !== false) ||
        criterion.type !== "KEYWORD" ||
        !["ENABLED", "PAUSED"].includes(String(criterion.status)) ||
        campaign.status === "REMOVED" ||
        group.status === "REMOVED" ||
        typeof keyword.text !== "string" ||
        !["BROAD", "PHRASE", "EXACT"].includes(String(keyword.matchType))
      )
        throw new GoogleAdsWriteError(
          "google_keyword_unavailable",
          "Ключевое слово не найдено, удалено или не соответствует кампании/группе. Создайте новый preview.",
        );
      return {
        ...item,
        account_id: account,
        campaign_name: String(campaign.name ?? ""),
        campaign_status: String(campaign.status ?? ""),
        ad_group_name: String(group.name ?? ""),
        ad_group_status: String(group.status ?? ""),
        keyword: keyword.text,
        match_type: String(keyword.matchType),
        status: criterion.status as "ENABLED" | "PAUSED",
      };
    });
  }
  private stage1Reader(context: ProviderReadContext) {
    return (query: string) =>
      this.searchStream(
        context.credentials.accessToken,
        context.accountId,
        this.contextLoginCustomerId(context),
        query,
      );
  }
  private async suggestGeo(
    context: ProviderReadContext,
    name: string,
    country?: string,
  ) {
    const response = await providerJson<unknown>(
      `${this.apiBase()}/geoTargetConstants:suggest`,
      {
        method: "POST",
        headers: {
          ...this.headers(
            context.credentials.accessToken,
            this.contextLoginCustomerId(context),
          ),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          locale: "ru",
          ...(country ? { countryCode: country } : {}),
          locationNames: { names: [name] },
        }),
      },
      this.config.providerHttpTimeoutMs,
      googleAdsApiError,
    );
    const suggestions = stage0Row(response).geoTargetConstantSuggestions;
    if (!Array.isArray(suggestions) || suggestions.length > 100)
      throw new GoogleAdsWriteError(
        "google_geo_invalid",
        "Google geo suggestions недоступны или слишком многочисленны.",
      );
    return suggestions.map(stage0Row);
  }
  public stage0(
    context: ProviderReadContext,
    action:
      | "build"
      | "clone"
      | "resume"
      | "pause"
      | "read"
      | "validate"
      | "commit"
      | "verify"
      | "checklist",
    input: unknown,
    results: Parameters<typeof verifyStage0Mutation>[1] = [],
  ): Promise<unknown> {
    if (action !== "checklist")
      assertGoogleWriteAccount(this.config, context.accountId);
    const read = this.stage1Reader(context),
      plan = input as Stage0Plan;
    if (action === "clone")
      return buildClonePlan(
        context.accountId,
        input,
        read,
        (brief) => this.stage0(context, "build", brief) as Promise<Stage0Plan>,
      );
    if (action === "build")
      return buildStage0Plan(context.accountId, input, read, (name, country) =>
        this.suggestGeo(context, name, country),
      );
    if (action === "resume")
      return buildResumePlan(context.accountId, input, read);
    if (action === "pause")
      return buildPausePlan(context.accountId, input, read);
    if (action === "checklist")
      return launchChecklist(
        context.accountId,
        String(stage0Row(input).campaign_id),
        read,
      );
    if (action === "read") return rereadStage0Checks(plan, read);
    if (action === "verify") return verifyStage0Mutation(plan, results, read);
    return this.mutateStage0(context, plan, action === "validate");
  }
  private async mutateStage0(
    context: ProviderReadContext,
    plan: Stage0Plan,
    validateOnly: boolean,
  ) {
    assertGoogleWriteAccount(this.config, context.accountId);
    if (
      plan.account_id !== context.accountId.replaceAll("-", "") ||
      !plan.operations.length ||
      plan.operations.length > 500
    )
      throw new GoogleAdsWriteError(
        "google_plan_invalid",
        "Неверный атомарный campaign plan.",
      );
    if (!context.credentials.scopes.includes(GOOGLE_SCOPE))
      throw new GoogleAdsWriteError(
        "google_scope_required",
        "Требуется Google OAuth adwords.",
      );
    if (
      !validateOnly &&
      (this.config.previewOnly || !this.config.confirmedWriteEnabled)
    )
      throw new GoogleAdsWriteError(
        "confirmed_write_disabled",
        "Подтверждённая запись выключена.",
      );
    try {
      const response = await providerJson<unknown>(
        `${this.apiBase()}/customers/${assertCustomerId(context.accountId)}/googleAds:mutate`,
        {
          method: "POST",
          headers: {
            ...this.headers(
              context.credentials.accessToken,
              this.contextLoginCustomerId(context),
            ),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            mutateOperations: stage0ProviderOperations(plan),
            validateOnly,
            partialFailure: false,
          }),
        },
        this.config.providerHttpTimeoutMs,
        googleAdsApiError,
      );
      return decodeStage0Mutation(response, plan, validateOnly);
    } catch (error) {
      const failure =
        !validateOnly &&
        (!(error instanceof GoogleAdsApiError) ||
          Number(error.providerStatus) >= 500)
          ? googleWriteFailure("OUTCOME_UNCERTAIN")
          : writeFailureFromError(error);
      if (error instanceof GoogleAdsApiError)
        failure.google_details = error.errors.slice(0, 50).map((e) => ({
          google_code: e.error_code,
          message: e.message,
          ...(e.field_path ? { field_path: e.field_path } : {}),
        }));
      return plan.operations.map(() => ({
        success: false,
        resource_name: null,
        error: failure,
      }));
    }
  }
  public buildStage1(context: ProviderReadContext, intent: unknown) {
    assertGoogleWriteAccount(this.config, context.accountId);
    return buildStage1Plan(
      context.accountId,
      intent,
      this.stage1Reader(context),
    );
  }
  public async trackingAudit(
    context: ProviderReadContext,
    action: "specs" | "audit",
    options: unknown,
  ) {
    const read = this.stage1Reader(context);
    return action === "specs"
      ? getGoogleTrackingSpecs(context.accountId, options, read)
      : auditGoogleLinksAndUtms(context.accountId, options, read);
  }
  public async stage2(
    context: ProviderReadContext,
    action: "build" | "read" | "validate" | "commit" | "verify",
    input: unknown,
    results: Parameters<typeof verifyStage2Mutation>[1] = [],
  ) {
    assertStage2Gate(this.config, context.accountId);
    if (!context.credentials.scopes.includes(GOOGLE_SCOPE))
      throw new GoogleAdsWriteError(
        "google_scope_required",
        "Требуется Google OAuth adwords.",
      );
    const read = this.stage1Reader(context);
    if (action === "build")
      return buildStage2Plan(context.accountId, input, read);
    const plan = input as Stage2Plan;
    assertStage2Plan(plan, context.accountId);
    if (action === "read") return rereadStage2Checks(plan, read);
    if (action === "verify") return verifyStage2Mutation(plan, results, read);
    const validateOnly = action === "validate";
    if (
      !validateOnly &&
      (this.config.previewOnly || !this.config.confirmedWriteEnabled)
    )
      throw new GoogleAdsWriteError(
        "confirmed_write_disabled",
        "Подтверждённая запись выключена.",
      );
    // One request per resource service, partial failure retained within each group.
    // Never repeat a group after an uncertain result or continue dependent writes.
    const output: Parameters<typeof verifyStage2Mutation>[1] = Array.from(
      { length: plan.operations.length },
      () => ({
        success: false,
        resource_name: null,
        error: googleWriteFailure("OUTCOME_UNCERTAIN"),
      }),
    );
    for (const kind of new Set(plan.operations.map((o) => o.kind))) {
      const entries = plan.operations
        .map((operation, index) => ({ operation, index }))
        .filter((x) => x.operation.kind === kind);
      try {
        const response = await providerJson<unknown>(
          `${this.apiBase()}/customers/${assertCustomerId(context.accountId)}/${kind}:mutate`,
          {
            method: "POST",
            headers: {
              ...this.headers(
                context.credentials.accessToken,
                this.contextLoginCustomerId(context),
              ),
              "content-type": "application/json",
            },
            body: JSON.stringify({
              operations: entries.map((x) => ({
                update: x.operation.fields,
                updateMask: x.operation.update_mask,
              })),
              validateOnly,
              partialFailure: true,
            }),
          },
          this.config.providerHttpTimeoutMs,
          googleAdsApiError,
        );
        const decoded = decodeStage1Mutation(
          response,
          {
            account_id: plan.account_id,
            operations: entries.map((x) => x.operation),
          },
          validateOnly,
        );
        entries.forEach((entry, i) => {
          output[entry.index] = decoded[i]!;
        });
      } catch (error) {
        const failure =
          !validateOnly &&
          (!(error instanceof GoogleAdsApiError) ||
            Number(error.providerStatus) >= 500)
            ? googleWriteFailure("OUTCOME_UNCERTAIN")
            : writeFailureFromError(error);
        entries.forEach((entry) => {
          output[entry.index] = {
            success: false,
            resource_name: entry.operation.resource_name,
            error: failure,
          };
        });
        break;
      }
    }
    return output;
  }
  public async extended(
    context: ProviderReadContext,
    version: 3 | 4 | 5,
    action:
      "build" | "read" | "validate" | "commit" | "verify" | "audience_search",
    input: unknown,
    results: Stage1MutationResult[] = [],
  ) {
    if (!context.credentials.scopes.includes(GOOGLE_SCOPE))
      throw new GoogleAdsWriteError(
        "google_scope_required",
        "Требуется Google OAuth adwords.",
      );
    if (action === "audience_search") {
      if (version !== 3)
        throw new GoogleAdsWriteError(
          "google_extended_action_invalid",
          "Audience search относится к Stage 3.",
        );
      const searchInput = Object.fromEntries(
        Object.entries(stage0Row(input)).filter(([key]) => key !== "action"),
      );
      return searchStage3Audiences(
        context.accountId,
        searchInput,
        this.stage1Reader(context),
      );
    }
    assertExtendedGate(this.config, context.accountId, version);
    const read = this.stage1Reader(context);
    if (action === "build")
      return version === 3
        ? buildStage3Plan(context.accountId, input, read, (name, country) =>
            this.suggestGeo(context, name, country),
          )
        : version === 4
          ? buildStage4Plan(context.accountId, input, read)
          : buildStage2AdvancedPlan(context.accountId, input, read);
    const plan = input as ExtendedPlan;
    assertExtendedPlan(plan, context.accountId);
    if (plan.version !== version)
      throw new GoogleAdsWriteError(
        "google_extended_plan_invalid",
        "Stage/version mismatch.",
      );
    if (action === "read") return rereadExtendedChecks(plan, read);
    if (action === "verify") return verifyExtendedMutation(plan, results, read);
    const validateOnly = action === "validate";
    if (
      !validateOnly &&
      (this.config.previewOnly || !this.config.confirmedWriteEnabled)
    )
      throw new GoogleAdsWriteError(
        "confirmed_write_disabled",
        "Подтверждённая запись выключена.",
      );
    const custom = plan.operations.every((o) => o.kind === "customAudiences");
    try {
      const response = await providerJson<unknown>(
        `${this.apiBase()}/customers/${assertCustomerId(context.accountId)}/${custom ? "customAudiences" : "googleAds"}:mutate`,
        {
          method: "POST",
          headers: {
            ...this.headers(
              context.credentials.accessToken,
              this.contextLoginCustomerId(context),
            ),
            "content-type": "application/json",
          },
          body: JSON.stringify(
            custom
              ? {
                  operations: plan.operations.map((o) =>
                    o.method === "remove"
                      ? { remove: o.resource_name }
                      : {
                          [o.method]: o.fields,
                          ...(o.method === "update"
                            ? { updateMask: o.update_mask }
                            : {}),
                        },
                  ),
                  validateOnly,
                }
              : {
                  mutateOperations: plan.operations.map(
                    extendedProviderOperation,
                  ),
                  partialFailure: !plan.atomic,
                  validateOnly,
                },
          ),
        },
        this.config.providerHttpTimeoutMs,
        googleAdsApiError,
      );
      return decodeExtendedMutation(response, plan, validateOnly, custom);
    } catch (e) {
      const failure =
        !validateOnly &&
        (!(e instanceof GoogleAdsApiError) || Number(e.providerStatus) >= 500)
          ? googleWriteFailure("OUTCOME_UNCERTAIN")
          : writeFailureFromError(e);
      if (e instanceof GoogleAdsApiError)
        failure.google_details = e.errors.map((d) => ({
          google_code: d.error_code,
          message: d.message,
          ...(d.field_path ? { field_path: d.field_path } : {}),
        }));
      return plan.operations.map((o) => ({
        success: false,
        resource_name: o.resource_name,
        error: failure,
      }));
    }
  }
  public readStage1(context: ProviderReadContext, plan: Stage1Plan) {
    assertGoogleWriteAccount(this.config, context.accountId);
    return rereadStage1Checks(plan, this.stage1Reader(context));
  }
  public verifyStage1(
    context: ProviderReadContext,
    plan: Stage1Plan,
    results: Parameters<typeof verifyStage1Mutation>[1],
  ) {
    return verifyStage1Mutation(plan, results, this.stage1Reader(context));
  }
  public async mutateStage1(
    context: ProviderReadContext,
    plan: Stage1Plan,
    validateOnly: boolean,
  ) {
    assertGoogleWriteAccount(this.config, context.accountId);
    if (
      context.accountId.replace(/-/g, "") !== plan.account_id ||
      !plan.operations.length ||
      plan.operations.length > 500 ||
      new Set(plan.operations.map((x) => x.kind)).size !== 1
    )
      throw new GoogleAdsWriteError(
        "google_plan_invalid",
        "Некорректный типизированный Google mutation batch.",
      );
    if (!context.credentials.scopes.includes(GOOGLE_SCOPE))
      throw new GoogleAdsWriteError(
        "google_scope_required",
        "Требуется Google OAuth-разрешение adwords.",
      );
    if (
      !validateOnly &&
      (this.config.previewOnly || !this.config.confirmedWriteEnabled)
    )
      throw new GoogleAdsWriteError(
        "confirmed_write_disabled",
        "Подтверждённая запись выключена на сервере.",
      );
    try {
      const response = await providerJson<unknown>(
        `${this.apiBase()}/customers/${assertCustomerId(context.accountId)}/${plan.operations[0]!.kind}:mutate`,
        {
          method: "POST",
          headers: {
            ...this.headers(
              context.credentials.accessToken,
              this.contextLoginCustomerId(context),
            ),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            operations: plan.operations.map(providerOperation),
            validateOnly,
            partialFailure: true,
          }),
        },
        this.config.providerHttpTimeoutMs,
        googleAdsApiError,
      );
      if (!response || typeof response !== "object" || Array.isArray(response))
        throw new Error("Invalid response");
      return decodeStage1Mutation(response, plan, validateOnly);
    } catch (error) {
      const failure = writeFailureFromError(error);
      throw new GoogleAdsWriteError(
        "google_stage1_mutation_failed",
        failure.message,
        [failure],
      );
    }
  }
  public validateKeywordStatuses(
    context: ProviderReadContext,
    items: GoogleKeywordMutation[],
  ) {
    return this.keywordMutation(context, items, true);
  }
  public commitKeywordStatuses(
    context: ProviderReadContext,
    items: GoogleKeywordMutation[],
  ) {
    if (this.config.previewOnly || !this.config.confirmedWriteEnabled)
      throw new GoogleAdsWriteError(
        "confirmed_write_disabled",
        "Подтверждённая запись выключена на сервере.",
      );
    return this.keywordMutation(context, items, false);
  }
  private async keywordMutation(
    context: ProviderReadContext,
    items: GoogleKeywordMutation[],
    validateOnly: boolean,
  ) {
    assertGoogleWriteAccount(this.config, context.accountId);
    if (!context.credentials.scopes.includes(GOOGLE_SCOPE))
      throw new GoogleAdsWriteError(
        "google_scope_required",
        "Подключению Google Ads необходимо OAuth-разрешение adwords.",
      );
    const identities = keywordBatch(
      context.accountId,
      items.map(
        ({ campaign_id, ad_group_id, criterion_id, resource_name }) => ({
          campaign_id,
          ad_group_id,
          criterion_id,
          resource_name,
        }),
      ),
    );
    if (
      items.some(
        (x) =>
          !["ENABLED", "PAUSED"].includes(x.status) ||
          Object.keys(x).some(
            (k) =>
              ![
                "campaign_id",
                "ad_group_id",
                "criterion_id",
                "resource_name",
                "status",
              ].includes(k),
          ),
      )
    )
      throw new GoogleAdsWriteError(
        "google_keyword_status_invalid",
        "Разрешены только ENABLED и PAUSED, без других mutation-полей.",
      );
    try {
      const result = await providerJson<unknown>(
        `${this.apiBase()}/customers/${assertCustomerId(context.accountId)}/adGroupCriteria:mutate`,
        {
          method: "POST",
          headers: {
            ...this.headers(
              context.credentials.accessToken,
              this.contextLoginCustomerId(context),
            ),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            operations: identities.map((x, i) => ({
              update: {
                resourceName: x.resource_name,
                status: items[i]!.status,
              },
              updateMask: "status",
            })),
            validateOnly,
            partialFailure: true,
          }),
        },
        this.config.providerHttpTimeoutMs,
        googleAdsApiError,
      );
      if (!result || typeof result !== "object" || Array.isArray(result))
        throw new GoogleAdsWriteError(
          "google_response_invalid",
          "Google Ads вернул некорректный ответ.",
        );
      return googleMutationResults(result, items, validateOnly);
    } catch (error) {
      if (error instanceof GoogleAdsWriteError) throw error;
      const failure = writeFailureFromError(error);
      throw new GoogleAdsWriteError(
        "google_ads_mutation_failed",
        failure.message,
        [failure],
      );
    }
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
      this.config.sessionHashSecret,
    );
  }

  public async listNegatives(
    context: ProviderReadContext,
    options: GoogleNegativeOptions,
  ) {
    const customerId = assertCustomerId(context.accountId);
    const loginCustomerId = this.contextLoginCustomerId(context);
    return listGoogleNegatives(
      customerId,
      options,
      (query, token) =>
        this.searchPage(
          context.credentials.accessToken,
          customerId,
          loginCustomerId,
          query,
          token,
        ),
      this.config.sessionHashSecret,
    );
  }

  public async checkNegativeConflicts(
    context: ProviderReadContext,
    options: GoogleNegativeConflictOptions,
  ) {
    const customerId = assertCustomerId(context.accountId);
    const loginCustomerId = this.contextLoginCustomerId(context);
    return checkGoogleNegativeConflicts(
      customerId,
      options,
      (query, token) =>
        this.searchPage(
          context.credentials.accessToken,
          customerId,
          loginCustomerId,
          query,
          token,
        ),
      this.config.sessionHashSecret,
    );
  }

  public async listSearchTerms(
    context: ProviderReadContext,
    options: GoogleSearchTermOptions,
  ) {
    const customerId = assertCustomerId(context.accountId);
    const validated = searchTermOptions(options);
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
    return listGoogleSearchTerms(
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
      this.config.sessionHashSecret,
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
function googleCampaignFromRow(
  row: Record<string, unknown>,
  currency: string | null,
  includeMetrics: boolean,
): ProviderCampaign {
  const campaign = object(row.campaign);
  const budget = object(row.campaignBudget);
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
    ...(includeMetrics
      ? { metrics: googleMetricsFromRaw(object(row.metrics), currency) }
      : {}),
    metadata: { source: "Google Ads API" },
    provenance: provenance("GOOGLE_ADS", "Google Ads API campaign"),
  };
}
function assertCampaignId(value: string): string {
  if (!/^\d{1,20}$/.test(value))
    throw new ProviderError("invalid_request", "Invalid Google campaign ID.");
  return value;
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
function campaignCursorId(
  cursor: string | undefined,
  context: string,
  secret: string,
): string | undefined {
  if (!cursor) return undefined;
  try {
    const payload = decodeGoogleCursor(cursor, context, secret, "campaigns");
    if (typeof payload.id !== "string" || !/^\d{1,20}$/.test(payload.id))
      throw Error();
    return payload.id;
  } catch {
    throw new ProviderError(
      "invalid_request",
      "Invalid Google campaign cursor.",
    );
  }
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

import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type {
  ProviderAccountView,
  ProviderConnectionView,
  ProviderDateRange,
  ProviderDefinition,
  ProviderId,
} from "@holymedia/contracts";
import type { Prisma } from "@holymedia/database";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { AuditService } from "../audit/audit.service.js";
import { SessionService } from "../auth/session.service.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { BillingService } from "../billing/billing.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisRateLimitService } from "../infrastructure/redis-rate-limit.service.js";
import { hashIp } from "../infrastructure/security.utils.js";
import { CredentialVaultService } from "./credential-vault.service.js";
import { OAuthStateService } from "./oauth-state.service.js";
import { ProviderError, toSafeProviderException } from "./provider.errors.js";
import { ProviderRefreshCoordinator } from "./refresh-coordinator.service.js";
import { ProviderRegistry } from "./provider.registry.js";
import { ProviderMetricsService } from "./provider.metrics.js";
import { MetaAdsAdapter } from "./adapters/meta.ads.js";
import type { MetaInsightsRequest } from "./meta-insights.parameters.js";
import { metaReadError } from "./meta-read.error.js";
import { createLogger, type Logger } from "@holymedia/observability";
import type {
  MetaReadAdapter,
  MetaControlledCampaignState,
  NormalizedProviderAccount,
  ProviderCredentialPayload,
  GoogleAnalyticsReadAdapter,
  GoogleAnalyticsReportRequest,
  ProviderScopeMetadata,
  SearchConsoleReadAdapter,
  SearchConsoleQueryRow,
} from "./provider.types.js";
import {
  isProviderMutationAdapter,
  isProviderReadAdapter,
  isMetaControlledCampaignReadAdapter,
} from "./provider.types.js";

@Injectable()
export class ProviderService {
  private readonly config: AppConfig = loadConfig();
  private readonly logger: Logger = createLogger("holymedia-mcp-v2-provider");

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ProviderRegistry) private readonly registry: ProviderRegistry,
    @Inject(OAuthStateService) private readonly states: OAuthStateService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(CredentialVaultService)
    private readonly vault: CredentialVaultService,
    @Inject(ProviderRefreshCoordinator)
    private readonly refreshCoordinator: ProviderRefreshCoordinator,
    @Inject(RedisRateLimitService)
    private readonly limits: RedisRateLimitService,
    @Inject(ProviderMetricsService)
    private readonly metrics: ProviderMetricsService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  public listProviders(): ProviderDefinition[] {
    return this.registry.list();
  }

  public async listConnections(
    workspaceId: string,
  ): Promise<ProviderConnectionView[]> {
    const connections = await this.database.client.providerConnection.findMany({
      where: { workspaceId },
      include: { accounts: { orderBy: { displayName: "asc" } } },
      orderBy: { createdAt: "asc" },
    });
    return connections.map((connection) => this.toView(connection));
  }

  public async getConnection(
    workspaceId: string,
    connectionId: string,
  ): Promise<ProviderConnectionView> {
    const connection = await this.database.client.providerConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: { accounts: { orderBy: { displayName: "asc" } } },
    });
    if (!connection)
      throw new NotFoundException("Provider connection not found.");
    return this.toView(connection);
  }

  public async startOAuth(
    workspaceId: string,
    provider: ProviderId,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<{ authorizationUrl: string; provider: ProviderId }> {
    const entry = this.registry.get(provider);
    if (!entry.adapter)
      throw toSafeProviderException(
        new ProviderError(
          "provider_not_configured",
          "Provider OAuth is not configured.",
        ),
      );
    await this.limits.consume(
      `v2:rl:oauth-start:ip:${hashIp(request.ip, this.config.sessionHashSecret) ?? "unknown"}`,
      10,
      900,
    );
    const pendingStates = await this.database.client.oAuthState.count({
      where: {
        userId: principal.userId,
        workspaceId,
        provider: provider as never,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (pendingStates >= 10)
      throw toSafeProviderException(
        new ProviderError("rate_limited", "Too many pending OAuth attempts."),
      );
    const existing = await this.database.client.providerConnection.findUnique({
      where: {
        workspaceId_provider: { workspaceId, provider: provider as never },
      },
      select: { id: true },
    });
    const state = await this.states.create({
      principal,
      workspaceId,
      provider,
      sessionId: principal.sessionId,
      usePkce: entry.definition.pkce,
      ...(existing ? { connectionId: existing.id } : {}),
    });
    const authorizationUrl = entry.adapter.authorizationUrl({
      state: state.state,
      redirectUri: this.redirectUri(provider),
      ...(state.authorizationState.codeChallenge
        ? {
            codeChallenge: state.authorizationState.codeChallenge,
            codeChallengeMethod: "S256" as const,
          }
        : {}),
    });
    await this.record(
      "oauth_started",
      request,
      principal,
      workspaceId,
      provider,
    );
    return { authorizationUrl, provider };
  }

  public async completeOAuth(
    provider: ProviderId,
    input: { state: string; code: string },
    principal: HumanPrincipal,
    request: RequestWithAuth,
    workspaceId?: string,
  ): Promise<ProviderConnectionView> {
    return this.completeOAuthForState(
      provider,
      input,
      request,
      principal,
      workspaceId,
    );
  }

  public async completeOAuthCallback(
    provider: ProviderId,
    input: { state: string; code: string },
    request: RequestWithAuth,
  ): Promise<ProviderConnectionView> {
    return this.completeOAuthForState(provider, input, request);
  }

  private async completeOAuthForState(
    provider: ProviderId,
    input: { state: string; code: string },
    request: RequestWithAuth,
    principal?: HumanPrincipal,
    workspaceId?: string,
  ): Promise<ProviderConnectionView> {
    const entry = this.registry.get(provider);
    if (!entry.adapter)
      throw toSafeProviderException(
        new ProviderError(
          "provider_not_configured",
          "Provider OAuth is not configured.",
        ),
      );
    await this.limits.consume(
      `v2:rl:oauth-callback:ip:${hashIp(request.ip, this.config.sessionHashSecret) ?? "unknown"}`,
      30,
      900,
    );
    let callbackPrincipal = principal;
    let callbackWorkspaceId = workspaceId;
    try {
      const startedAt = Date.now();
      const state = await this.states.consume({
        state: input.state,
        expected: {
          ...(principal ? { principal } : {}),
          provider,
          ...(workspaceId ? { workspaceId } : {}),
        },
      });
      callbackWorkspaceId = state.workspaceId;
      if (!callbackPrincipal) {
        const session = await this.sessions.validateById(
          state.sessionId,
          state.userId,
        );
        if (!session)
          throw new ProviderError(
            "invalid_oauth_state",
            "OAuth state is invalid or expired.",
          );
        callbackPrincipal = {
          kind: "human",
          userId: session.userId,
          sessionId: session.id,
        };
      }
      const credentials = await entry.adapter.exchangeCode({
        code: input.code,
        redirectUri: this.redirectUri(provider),
        ...(state.codeVerifier ? { codeVerifier: state.codeVerifier } : {}),
      });
      const scopeMetadata = this.scopeMetadata(
        entry.definition.scopes,
        credentials.scopes,
      );
      const encrypted = this.vault.encrypt(credentials);
      let isReconnect = false;
      const connection = await this.database.client.$transaction(async (tx) => {
        const current = await tx.providerConnection.findUnique({
          where: {
            workspaceId_provider: {
              workspaceId: state.workspaceId,
              provider: provider as never,
            },
          },
          select: { id: true, credentialVersion: true },
        });
        isReconnect = Boolean(current);
        const saved = await tx.providerConnection.upsert({
          where: {
            workspaceId_provider: {
              workspaceId: state.workspaceId,
              provider: provider as never,
            },
          },
          create: {
            workspaceId: state.workspaceId,
            provider: provider as never,
            status: "CONNECTED",
            ...(credentials.externalSubjectId
              ? { externalSubjectId: credentials.externalSubjectId }
              : {}),
            ...(credentials.displayName
              ? { displayName: credentials.displayName }
              : {}),
            createdBy: state.userId,
            connectedAt: new Date(),
            lastSuccessAt: new Date(),
            credentialVersion: 1,
            metadata: scopeMetadata,
          },
          update: {
            status: "CONNECTED",
            ...(credentials.externalSubjectId
              ? { externalSubjectId: credentials.externalSubjectId }
              : { externalSubjectId: null }),
            ...(credentials.displayName
              ? { displayName: credentials.displayName }
              : { displayName: null }),
            disconnectedAt: null,
            lastErrorAt: null,
            lastErrorCode: null,
            connectedAt: new Date(),
            lastSuccessAt: new Date(),
            credentialVersion: (current?.credentialVersion ?? 0) + 1,
            metadata: scopeMetadata,
          },
        });
        await tx.providerCredential.upsert({
          where: { connectionId: saved.id },
          create: {
            connectionId: saved.id,
            encryptedPayload: encrypted.ciphertext,
            encryptionVersion: encrypted.encryptionVersion,
          },
          update: {
            encryptedPayload: encrypted.ciphertext,
            encryptionVersion: encrypted.encryptionVersion,
          },
        });
        return saved;
      });
      await this.persistAccounts(
        state.workspaceId,
        connection.id,
        provider,
        credentials,
        entry.adapter,
      );
      await this.record(
        "oauth_completed",
        request,
        callbackPrincipal,
        state.workspaceId,
        provider,
        connection.id,
      );
      if (isReconnect) {
        await this.record(
          "connection_reconnected",
          request,
          callbackPrincipal,
          state.workspaceId,
          provider,
          connection.id,
        );
      }
      this.metrics.record("oauth_success", provider, Date.now() - startedAt);
      return this.getConnection(state.workspaceId, connection.id);
    } catch (error) {
      this.metrics.record("oauth_failure", provider);
      if (callbackPrincipal)
        await this.record(
          "oauth_failed",
          request,
          callbackPrincipal,
          callbackWorkspaceId,
          provider,
          undefined,
          error,
        );
      throw toSafeProviderException(error);
    }
  }

  public async disconnect(
    workspaceId: string,
    connectionId: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<{ success: true }> {
    const connection = await this.connectionForDisconnect(
      workspaceId,
      connectionId,
    );
    if (connection.status === "DISCONNECTED" || connection.status === "REVOKED")
      return { success: true };
    if (connection.credential) {
      try {
        const credentials = this.vault.decrypt<ProviderCredentialPayload>(
          connection.credential.encryptedPayload,
          connection.credential.encryptionVersion,
        );
        const adapter = this.registry.get(
          connection.provider as ProviderId,
        ).adapter;
        if (adapter?.revokeCredentials)
          await adapter.revokeCredentials(credentials);
      } catch {
        // Local disconnect remains successful even if provider revocation is unavailable.
      }
    }
    await this.database.client.$transaction(async (tx) => {
      await tx.providerCredential.deleteMany({ where: { connectionId } });
      await tx.providerConnection.update({
        where: { id: connectionId },
        data: { status: "DISCONNECTED", disconnectedAt: new Date() },
      });
    });
    await this.record(
      "connection_disconnected",
      request,
      principal,
      workspaceId,
      connection.provider as ProviderId,
      connectionId,
    );
    return { success: true };
  }

  public async refresh(
    workspaceId: string,
    connectionId: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<ProviderConnectionView> {
    return this.refreshCoordinator.withLock(connectionId, async () => {
      const connection = await this.connectionWithCredential(
        workspaceId,
        connectionId,
      );
      if (!connection.credential)
        throw new ProviderError(
          "token_expired",
          "Provider authorization is required.",
        );
      const current = this.vault.decrypt<ProviderCredentialPayload>(
        connection.credential.encryptedPayload,
        connection.credential.encryptionVersion,
      );
      if (
        current.expiresAt &&
        new Date(current.expiresAt).getTime() > Date.now() + 30_000
      ) {
        return this.toView(
          await this.connectionWithAccounts(workspaceId, connectionId),
        );
      }
      const adapter = this.registry.adapter(connection.provider as ProviderId);
      if (!adapter.refreshCredentials)
        throw new ProviderError(
          "refresh_failed",
          "Provider refresh is not supported.",
        );
      try {
        const startedAt = Date.now();
        const refreshed = await adapter.refreshCredentials(current);
        const encrypted = this.vault.encrypt(refreshed);
        await this.database.client.$transaction(async (tx) => {
          await tx.providerCredential.update({
            where: { connectionId },
            data: {
              encryptedPayload: encrypted.ciphertext,
              encryptionVersion: encrypted.encryptionVersion,
            },
          });
          await tx.providerConnection.update({
            where: { id: connectionId },
            data: {
              status: "CONNECTED",
              lastSuccessAt: new Date(),
              lastErrorAt: null,
              lastErrorCode: null,
            },
          });
        });
        await this.record(
          "credentials_refreshed",
          request,
          principal,
          workspaceId,
          connection.provider as ProviderId,
          connectionId,
        );
        this.metrics.record(
          "token_refresh_success",
          connection.provider as ProviderId,
          Date.now() - startedAt,
        );
        return this.toView(
          await this.connectionWithAccounts(workspaceId, connectionId),
        );
      } catch (error) {
        this.metrics.record(
          "token_refresh_failure",
          connection.provider as ProviderId,
        );
        await this.database.client.providerConnection.update({
          where: { id: connectionId },
          data: {
            status: "REAUTH_REQUIRED",
            lastErrorAt: new Date(),
            lastErrorCode: [
              error instanceof ProviderError ? error.code : "refresh_failed",
              error instanceof ProviderError ? error.providerCode : undefined,
            ]
              .filter(Boolean)
              .join(":"),
          },
        });
        throw toSafeProviderException(error);
      }
    });
  }

  public async discover(
    workspaceId: string,
    connectionId: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<ProviderAccountView[]> {
    await this.limits.consume(
      `v2:rl:account-discovery:workspace:${workspaceId}`,
      10,
      900,
    );
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    try {
      // Discovery is also a provider read. Refresh an expired access token before
      // asking the provider for accounts, exactly as metrics/read operations do.
      const fresh = await this.refreshCoordinator.withLock(
        context.connection.id,
        () => this.refreshForRead(context),
      );
      const startedAt = Date.now();
      await this.persistAccounts(
        workspaceId,
        connectionId,
        fresh.connection.provider as ProviderId,
        fresh.credentials,
        fresh.adapter,
      );
      await this.record(
        "accounts_discovered",
        request,
        principal,
        workspaceId,
        fresh.connection.provider as ProviderId,
        connectionId,
      );
      this.metrics.record(
        "account_discovery_success",
        fresh.connection.provider as ProviderId,
        Date.now() - startedAt,
      );
      const current = await this.connectionWithAccounts(
        workspaceId,
        connectionId,
      );
      return current.accounts.map((account) => this.accountView(account));
    } catch (error) {
      this.metrics.record(
        "account_discovery_failure",
        context.connection.provider as ProviderId,
      );
      await this.database.client.providerConnection.update({
        where: { id: connectionId },
        data: {
          status: "DEGRADED",
          lastErrorAt: new Date(),
          lastErrorCode:
            error instanceof ProviderError
              ? error.code
              : "provider_response_invalid",
        },
      });
      throw toSafeProviderException(error);
    }
  }

  public async setAccountEnabled(
    workspaceId: string,
    accountId: string,
    enabled: boolean,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<ProviderAccountView> {
    const updated = await this.billing.setProviderAccountEnabled(
      workspaceId,
      accountId,
      enabled,
    );
    if (!updated) throw new NotFoundException("Provider account not found.");
    const account =
      await this.database.client.providerAccount.findUniqueOrThrow({
        where: { id: accountId },
      });
    await this.record(
      enabled ? "provider_account_enabled" : "provider_account_disabled",
      request,
      principal,
      workspaceId,
      account.provider as ProviderId,
      accountId,
    );
    return this.accountView(account);
  }

  public async setAccountsEnabled(
    workspaceId: string,
    connectionId: string,
    accountIds: string[],
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<ProviderAccountView[]> {
    const result = await this.billing.setProviderAccountsEnabled(
      workspaceId,
      connectionId,
      accountIds,
    );
    const connection = await this.connectionWithAccounts(
      workspaceId,
      connectionId,
    );
    const changed = new Set(result.changedAccountIds);
    for (const account of connection.accounts) {
      if (!changed.has(account.id)) continue;
      await this.record(
        account.enabled
          ? "provider_account_enabled"
          : "provider_account_disabled",
        request,
        principal,
        workspaceId,
        account.provider as ProviderId,
        account.id,
      );
    }
    return connection.accounts.map((account) => this.accountView(account));
  }

  public async readAccountSummary(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    range?: ProviderDateRange,
  ) {
    return this.withReadFailure(
      workspaceId,
      connectionId,
      "account_summary",
      async () => {
        const context = await this.readContext(
          workspaceId,
          connectionId,
          accountId,
        );
        return context.adapter.getAccountSummary(context.read, range);
      },
    );
  }

  public async readCampaigns(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    range: ProviderDateRange | undefined,
    limit?: number,
    cursor?: string,
  ) {
    return this.withReadFailure(
      workspaceId,
      connectionId,
      "campaigns",
      async () => {
        const context = await this.readContext(
          workspaceId,
          connectionId,
          accountId,
        );
        return context.adapter.listCampaigns(
          context.read,
          range,
          limit,
          cursor,
        );
      },
    );
  }

  public async readMetrics(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    range: ProviderDateRange,
    campaignId?: string,
  ) {
    return this.withReadFailure(
      workspaceId,
      connectionId,
      "metrics",
      async () => {
        const context = await this.readContext(
          workspaceId,
          connectionId,
          accountId,
        );
        return context.adapter.getMetrics(context.read, range, campaignId);
      },
    );
  }

  public async readHealth(
    workspaceId: string,
    connectionId: string,
    accountId: string,
  ) {
    const context = await this.readContext(
      workspaceId,
      connectionId,
      accountId,
    );
    return context.adapter.health(context.read);
  }

  /** GA4 reads are intentionally separate from the ads-shaped read adapter. */
  public async googleAnalyticsGetProperty(
    workspaceId: string,
    connectionId: string,
    accountId: string,
  ) {
    return this.withReadFailure(
      workspaceId,
      connectionId,
      "ga4_property",
      async () => {
        const context = await this.googleAnalyticsContext(
          workspaceId,
          connectionId,
          accountId,
        );
        return context.adapter.getProperty(
          context.credentials,
          context.account.externalAccountId,
        );
      },
    );
  }

  public async googleAnalyticsRunReport(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    request: GoogleAnalyticsReportRequest,
  ) {
    return this.withReadFailure(
      workspaceId,
      connectionId,
      "ga4_report",
      async () => {
        const context = await this.googleAnalyticsContext(
          workspaceId,
          connectionId,
          accountId,
        );
        return context.adapter.runReport(
          context.credentials,
          context.account.externalAccountId,
          request,
        );
      },
    );
  }

  public async googleAnalyticsRunRealtime(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    dimensions: string[],
    metrics: string[],
    limit?: number,
  ) {
    return this.withReadFailure(
      workspaceId,
      connectionId,
      "ga4_realtime",
      async () => {
        const context = await this.googleAnalyticsContext(
          workspaceId,
          connectionId,
          accountId,
        );
        return context.adapter.runRealtimeReport(
          context.credentials,
          context.account.externalAccountId,
          dimensions,
          metrics,
          limit,
        );
      },
    );
  }

  public async googleAnalyticsCheckCompatibility(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    dimensions: string[],
    metrics: string[],
  ) {
    return this.withReadFailure(
      workspaceId,
      connectionId,
      "ga4_compatibility",
      async () => {
        const context = await this.googleAnalyticsContext(
          workspaceId,
          connectionId,
          accountId,
        );
        return context.adapter.checkCompatibility(
          context.credentials,
          context.account.externalAccountId,
          dimensions,
          metrics,
        );
      },
    );
  }

  public async googleAnalyticsGoogleAdsLinks(
    workspaceId: string,
    connectionId: string,
    accountId: string,
  ) {
    return this.withReadFailure(
      workspaceId,
      connectionId,
      "ga4_google_ads_links",
      async () => {
        const context = await this.googleAnalyticsContext(
          workspaceId,
          connectionId,
          accountId,
        );
        return context.adapter.listGoogleAdsLinks(
          context.credentials,
          context.account.externalAccountId,
        );
      },
    );
  }

  public async googleAnalyticsCustomDefinitions(
    workspaceId: string,
    connectionId: string,
    accountId: string,
  ) {
    return this.withReadFailure(
      workspaceId,
      connectionId,
      "ga4_custom_definitions",
      async () => {
        const context = await this.googleAnalyticsContext(
          workspaceId,
          connectionId,
          accountId,
        );
        return context.adapter.listCustomDimensionsMetrics(
          context.credentials,
          context.account.externalAccountId,
        );
      },
    );
  }

  private async withReadFailure<T>(
    workspaceId: string,
    connectionId: string,
    operation: string,
    read: () => Promise<T>,
  ): Promise<T> {
    try {
      return await read();
    } catch (error) {
      const code =
        error instanceof ProviderError
          ? error.code
          : "provider_response_invalid";
      await this.database.client.providerConnection.updateMany({
        where: { id: connectionId, workspaceId },
        data: {
          status: "DEGRADED",
          lastErrorAt: new Date(),
          lastErrorCode: [
            code,
            error instanceof ProviderError ? error.providerCode : undefined,
          ]
            .filter(Boolean)
            .join(":")
            .slice(0, 120),
        },
      });
      this.logger.warn(
        {
          operation,
          providerErrorCode: code,
          providerStatus:
            error instanceof ProviderError ? error.providerStatus : undefined,
          providerCode:
            error instanceof ProviderError ? error.providerCode : undefined,
          retryable: error instanceof ProviderError ? error.retryable : false,
        },
        "provider read failed",
      );
      throw error;
    }
  }

  public async mutateCampaign(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    objectId: string,
    operation: "change_name" | "pause" | "resume",
    payload: Record<string, unknown>,
  ) {
    const context = await this.readContext(
      workspaceId,
      connectionId,
      accountId,
    );
    if (!isProviderMutationAdapter(context.adapter))
      throw new ProviderError(
        "provider_not_configured",
        "Provider mutations are not configured.",
      );
    const result = await context.adapter.mutateCampaign(context.read, {
      objectId,
      operation,
      payload,
    });
    const reread = await context.adapter.listCampaigns(
      context.read,
      undefined,
      500,
    );
    return {
      result,
      reread: reread.items.find((campaign) => campaign.id === objectId) ?? null,
    };
  }

  public async readMetaControlledCampaign(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    campaignId: string,
  ): Promise<MetaControlledCampaignState> {
    const context = await this.readContext(
      workspaceId,
      connectionId,
      accountId,
    );
    if (!isMetaControlledCampaignReadAdapter(context.adapter))
      throw new ProviderError(
        "provider_not_configured",
        "Direct Meta campaign verification is not configured.",
      );
    return context.adapter.readControlledCampaign(context.read, campaignId);
  }

  public async metaBusinesses(workspaceId: string, connectionId: string) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    const adapter = context.adapter as unknown as MetaReadAdapter;
    if (typeof adapter.listBusinesses !== "function")
      throw new ProviderError(
        "provider_not_configured",
        "Meta Business read is not configured.",
      );
    return adapter.listBusinesses(context.credentials);
  }

  public async metaEntity(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    kind: "campaign" | "adset" | "ad",
    id?: string,
    limit = 100,
    cursor?: string,
  ) {
    try {
      const context = await this.readContext(
        workspaceId,
        connectionId,
        accountId,
      );
      if (!(context.adapter instanceof MetaAdsAdapter))
        throw new ProviderError("invalid_account", "Meta account required.");
      return await context.adapter.readEntity(
        context.read,
        kind,
        id,
        limit,
        cursor,
      );
    } catch (error) {
      throw metaReadError(error, "read_entity");
    }
  }

  public async metaInsights(
    workspaceId: string,
    connectionId: string,
    accountId: string,
    request: MetaInsightsRequest,
    detailed = false,
  ) {
    try {
      const context = await this.readContext(
        workspaceId,
        connectionId,
        accountId,
      );
      if (!(context.adapter instanceof MetaAdsAdapter))
        throw new ProviderError(
          "provider_not_configured",
          "Meta Insights is not configured.",
        );
      return detailed
        ? await context.adapter.detailedReport(context.read, request)
        : await context.adapter.flexibleInsights(context.read, request);
    } catch (error) {
      throw metaReadError(
        error,
        detailed ? "get_meta_ads_detailed_report" : "get_flexible_insights",
      );
    }
  }

  public async metaPermissions(workspaceId: string, connectionId: string) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    const adapter = context.adapter as unknown as MetaReadAdapter;
    const permissions = await adapter.getPermissions(context.credentials);
    const requested = this.registry.get("META_ADS").definition.scopes;
    const missing = requested.filter(
      (scope) => !permissions.granted.includes(scope),
    );
    const metadata = {
      ...((context.connection.metadata as Record<string, unknown> | null) ??
        {}),
      requestedScopes: requested,
      grantedScopes: permissions.granted,
      missingScopes: missing,
    };
    const encrypted = this.vault.encrypt({
      ...context.credentials,
      scopes: permissions.granted,
    });
    await this.database.client.providerConnection.update({
      where: { id: context.connection.id },
      data: {
        metadata,
        credential: {
          update: {
            encryptedPayload: encrypted.ciphertext,
            encryptionVersion: encrypted.encryptionVersion,
          },
        },
      },
    });
    return {
      requested,
      granted: permissions.granted,
      missing,
      declined: permissions.declined,
    };
  }

  public async metaPages(workspaceId: string, connectionId: string) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    const adapter = context.adapter as unknown as MetaReadAdapter;
    if (typeof adapter.listPages !== "function")
      throw new ProviderError(
        "provider_not_configured",
        "Meta Page read is not configured.",
      );
    return adapter.listPages(context.credentials);
  }

  public async metaBusinessAdAccounts(
    workspaceId: string,
    connectionId: string,
    businessId: string,
  ) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    const adapter = context.adapter as unknown as MetaReadAdapter;
    if (typeof adapter.listBusinessAdAccounts !== "function")
      throw new ProviderError(
        "provider_not_configured",
        "Meta Business read is not configured.",
      );
    return adapter.listBusinessAdAccounts(context.credentials, businessId);
  }

  public async metaBusinessPages(
    workspaceId: string,
    connectionId: string,
    businessId: string,
  ) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    const adapter = context.adapter as unknown as MetaReadAdapter;
    if (typeof adapter.listBusinessPages !== "function")
      throw new ProviderError(
        "provider_not_configured",
        "Meta Business read is not configured.",
      );
    return adapter.listBusinessPages(context.credentials, businessId);
  }

  public async metaPagePost(
    workspaceId: string,
    connectionId: string,
    pageId: string,
    postId: string,
    engagement = false,
  ) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    if (!(context.adapter instanceof MetaAdsAdapter))
      throw new ProviderError("invalid_account", "Meta connection required.");
    return context.adapter.getPagePost(
      context.credentials,
      pageId,
      postId,
      engagement,
    );
  }

  public async metaPagePosts(
    workspaceId: string,
    connectionId: string,
    pageId: string,
    limit?: number,
    cursor?: string,
  ) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    const adapter = context.adapter as unknown as MetaReadAdapter;
    if (typeof adapter.listPagePosts !== "function")
      throw new ProviderError(
        "provider_not_configured",
        "Meta Page read is not configured.",
      );
    return adapter.listPagePosts(context.credentials, pageId, limit, cursor);
  }

  public async metaInstagram(
    workspaceId: string,
    connectionId: string,
    pageId: string,
  ) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    const adapter = context.adapter as unknown as MetaReadAdapter;
    if (typeof adapter.getPageInstagramAccount !== "function")
      throw new ProviderError(
        "provider_not_configured",
        "Meta Instagram read is not configured.",
      );
    return adapter.getPageInstagramAccount(context.credentials, pageId);
  }

  /** V1-compatible SEO report backed by the encrypted Search Console connection. */
  public async searchConsoleReport(
    workspaceId: string,
    siteUrl = "__all",
    days = 28,
  ) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      "",
      "GOOGLE_SEARCH_CONSOLE",
    );
    const adapter = context.adapter as unknown as SearchConsoleReadAdapter;
    if (typeof adapter.querySearchAnalytics !== "function")
      throw new ProviderError(
        "provider_not_configured",
        "Google Search Console read is not configured.",
      );

    const fresh = await this.refreshCoordinator.withLock(
      context.connection.id,
      () => this.refreshForRead(context),
    );
    const accounts = await this.database.client.providerAccount.findMany({
      where: {
        workspaceId,
        connectionId: context.connection.id,
        provider: "GOOGLE_SEARCH_CONSOLE",
      },
      orderBy: { displayName: "asc" },
    });
    const properties = accounts.map((account) => ({
      name: account.displayName,
      account_id: account.externalAccountId,
      site_url: account.externalAccountId,
      permission_level:
        stringMetadata(account.metadata, "permissionLevel") ?? "",
      property_type:
        stringMetadata(account.metadata, "propertyType") ??
        (account.externalAccountId.startsWith("sc-domain:")
          ? "domain"
          : "url_prefix"),
      status: account.status ?? "connected",
    }));
    if (!properties.length) {
      return {
        status: "not_connected",
        provider: "google_search_console",
        properties: [],
        message: "Подключите Google Search Console, чтобы увидеть SEO-отчеты.",
      };
    }
    const selected =
      siteUrl && siteUrl !== "__all"
        ? properties.filter((property) => property.site_url === siteUrl)
        : properties;
    if (!selected.length) {
      return {
        status: "property_not_found",
        provider: "google_search_console",
        properties,
        message: "Выбранная property не найдена в подключении Search Console.",
      };
    }

    const cleanDays = Math.max(7, Math.min(Math.trunc(days) || 28, 90));
    const endDate = new Date();
    endDate.setUTCDate(endDate.getUTCDate() - 3);
    const startDate = new Date(endDate);
    startDate.setUTCDate(startDate.getUTCDate() - cleanDays + 1);
    const previousEnd = new Date(startDate);
    previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
    const previousStart = new Date(previousEnd);
    previousStart.setUTCDate(previousStart.getUTCDate() - cleanDays + 1);
    const range = (value: Date) => value.toISOString().slice(0, 10);
    const selectedProperties = selected.map((property) => property.site_url);
    const queryMany = async (
      from: Date,
      to: Date,
      dimensions: string[],
      rowLimit: number,
    ) => {
      const rows: SearchConsoleQueryRow[] = [];
      for (const property of selectedProperties) {
        rows.push(
          ...(await adapter.querySearchAnalytics(
            fresh.credentials,
            property,
            range(from),
            range(to),
            dimensions,
            rowLimit,
          )),
        );
      }
      return dimensions.length
        ? mergeRows(rows, dimensions[0] ?? "dimension")
        : [totals(rows)];
    };

    const summary = await queryMany(startDate, endDate, [], 1);
    const previousSummary = await queryMany(previousStart, previousEnd, [], 1);
    const topQueries = await queryMany(startDate, endDate, ["query"], 25);
    const topPages = await queryMany(startDate, endDate, ["page"], 25);
    const trend = await queryMany(startDate, endDate, ["date"], cleanDays);
    const sitemaps = (
      await Promise.all(
        selectedProperties.map((property) =>
          adapter.listSitemaps(fresh.credentials, property),
        ),
      )
    ).flat();
    const current = totals(summary);
    const previous = totals(previousSummary);
    const fetchedAt = new Date().toISOString();
    return {
      status: "ok",
      provider: "google_search_console",
      source_api: "Google Search Console Search Analytics API",
      real_data: true,
      data_status: "live",
      fetched_at: fetchedAt,
      date_range: {
        start_date: range(startDate),
        end_date: range(endDate),
        days: cleanDays,
      },
      previous_date_range: {
        start_date: range(previousStart),
        end_date: range(previousEnd),
        days: cleanDays,
      },
      properties,
      property_summaries: selected.map((property) => ({
        ...property,
        metrics: current,
        source_api: "Google Search Console Search Analytics API",
        real_data: true,
        data_status: "live",
        fetched_at: fetchedAt,
      })),
      selected_property:
        selected.length === 1
          ? selected[0]
          : {
              name: "Все ресурсы Search Console",
              account_id: "__all",
              site_url: "__all",
              property_type: "aggregate",
              status: "connected",
            },
      metrics: current,
      previous_metrics: previous,
      deltas: metricDeltas(current, previous),
      top_queries: rows(topQueries),
      top_pages: rows(topPages),
      trend: rows(trend),
      opportunities: [],
      insights: [],
      sitemaps,
    };
  }

  private async readContext(
    workspaceId: string,
    connectionId: string,
    accountId: string,
  ) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    const fresh = await this.refreshForRead(context);
    const account = await this.database.client.providerAccount.findFirst({
      where: { id: accountId, connectionId, workspaceId, enabled: true },
    });
    if (!account)
      throw new NotFoundException("Selected provider account not found.");
    if (!isProviderReadAdapter(fresh.adapter))
      throw new ProviderError(
        "provider_not_configured",
        "Provider read is not configured.",
      );
    const loginCustomerId = stringMetadata(account.metadata, "loginCustomerId");
    return {
      ...fresh,
      account,
      adapter: fresh.adapter,
      read: {
        credentials: fresh.credentials,
        accountId: account.externalAccountId,
        ...(account.currency ? { currency: account.currency } : {}),
        ...(loginCustomerId ? { loginCustomerId } : {}),
      },
    };
  }

  private async googleAnalyticsContext(
    workspaceId: string,
    connectionId: string,
    accountId: string,
  ) {
    const context = await this.connectionReadCredentials(
      workspaceId,
      connectionId,
    );
    if (context.connection.provider !== "GOOGLE_ANALYTICS")
      throw new ProviderError(
        "invalid_account",
        "Google Analytics property belongs to another provider.",
      );
    const fresh = await this.refreshForRead(context);
    const account = await this.database.client.providerAccount.findFirst({
      where: {
        id: accountId,
        connectionId,
        workspaceId,
        provider: "GOOGLE_ANALYTICS" as never,
        enabled: true,
      },
    });
    if (!account)
      throw new NotFoundException(
        "Selected Google Analytics property was not found.",
      );
    const adapter = fresh.adapter as unknown as GoogleAnalyticsReadAdapter;
    if (typeof adapter.runReport !== "function")
      throw new ProviderError(
        "provider_not_configured",
        "Google Analytics read is not configured.",
      );
    return { ...fresh, account, adapter };
  }

  private async connectionReadCredentials(
    workspaceId: string,
    connectionId: string,
    provider?: ProviderId,
  ) {
    const connection = connectionId
      ? await this.connectionWithCredential(workspaceId, connectionId)
      : await this.database.client.providerConnection.findFirst({
          where: { workspaceId, provider: provider as never },
          include: { credential: true },
        });
    if (!connection) {
      throw new NotFoundException("Provider connection not found.");
    }
    if (!connection.credential)
      throw new ProviderError(
        "authentication_failed",
        "Provider authorization is required.",
      );
    const credentials = this.vault.decrypt<ProviderCredentialPayload>(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    const adapter = this.registry.adapter(connection.provider as ProviderId);
    return { connection, credentials, adapter };
  }

  private async refreshForRead<
    TAdapter extends {
      refreshCredentials?: (
        credentials: ProviderCredentialPayload,
      ) => Promise<ProviderCredentialPayload>;
    },
  >(context: {
    connection: { id: string; provider: ProviderId };
    credentials: ProviderCredentialPayload;
    adapter: TAdapter;
  }) {
    if (
      !context.credentials.expiresAt ||
      new Date(context.credentials.expiresAt).getTime() > Date.now() + 30_000 ||
      !context.adapter.refreshCredentials
    )
      return context;
    const credentials = await context.adapter.refreshCredentials(
      context.credentials,
    );
    const encrypted = this.vault.encrypt(credentials);
    await this.database.client.providerCredential.update({
      where: { connectionId: context.connection.id },
      data: {
        encryptedPayload: encrypted.ciphertext,
        encryptionVersion: encrypted.encryptionVersion,
      },
    });
    return { ...context, credentials };
  }

  private async persistAccounts(
    workspaceId: string,
    connectionId: string,
    provider: ProviderId,
    credentials: ProviderCredentialPayload,
    adapter: {
      discoverAccounts: (
        credentials: ProviderCredentialPayload,
      ) => Promise<NormalizedProviderAccount[]>;
    },
  ) {
    const accounts = await adapter.discoverAccounts(credentials);
    await this.database.client.$transaction(async (tx) => {
      for (const account of accounts) {
        await tx.providerAccount.upsert({
          where: {
            workspaceId_provider_externalAccountId: {
              workspaceId,
              provider: provider as never,
              externalAccountId: account.externalAccountId,
            },
          },
          create: {
            connectionId,
            workspaceId,
            provider: provider as never,
            externalAccountId: account.externalAccountId,
            displayName: account.displayName,
            ...(account.currency ? { currency: account.currency } : {}),
            ...(account.timezone ? { timezone: account.timezone } : {}),
            ...(account.status ? { status: account.status } : {}),
            ...(account.metadata ? { metadata: account.metadata } : {}),
          },
          update: {
            connectionId,
            displayName: account.displayName,
            ...(account.currency ? { currency: account.currency } : {}),
            ...(account.timezone ? { timezone: account.timezone } : {}),
            ...(account.status ? { status: account.status } : {}),
            ...(account.metadata ? { metadata: account.metadata } : {}),
            lastSeenAt: new Date(),
          },
        });
      }
      await tx.providerConnection.update({
        where: { id: connectionId },
        data: {
          status: "CONNECTED",
          lastSuccessAt: new Date(),
          lastErrorAt: null,
          lastErrorCode: null,
        },
      });
    });
    return accounts;
  }

  private async connectionWithCredential(
    workspaceId: string,
    connectionId: string,
  ) {
    const connection = await this.database.client.providerConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: { credential: true },
    });
    if (!connection)
      throw new NotFoundException("Provider connection not found.");
    if (
      connection.status === "DISCONNECTED" ||
      connection.status === "REVOKED"
    ) {
      throw new ForbiddenException("Provider connection is disconnected.");
    }
    return connection;
  }

  private async connectionForDisconnect(
    workspaceId: string,
    connectionId: string,
  ) {
    const connection = await this.database.client.providerConnection.findFirst({
      where: { id: connectionId, workspaceId },
      include: { credential: true },
    });
    if (!connection)
      throw new NotFoundException("Provider connection not found.");
    return connection;
  }

  private connectionWithAccounts(workspaceId: string, connectionId: string) {
    return this.database.client.providerConnection.findFirstOrThrow({
      where: { id: connectionId, workspaceId },
      include: { accounts: { orderBy: { displayName: "asc" } } },
    });
  }

  private toView(
    connection: Prisma.ProviderConnectionGetPayload<{
      include: { accounts: { orderBy: { displayName: "asc" } } };
    }>,
  ): ProviderConnectionView {
    const scopes = this.scopeMetadataFromJson(connection.metadata);
    return {
      id: connection.id,
      workspaceId: connection.workspaceId,
      provider: connection.provider as ProviderId,
      status: connection.status,
      displayName: connection.displayName,
      connectedAt: toIso(connection.connectedAt),
      disconnectedAt: toIso(connection.disconnectedAt),
      lastSuccessAt: toIso(connection.lastSuccessAt),
      lastErrorCode: connection.lastErrorCode,
      credentialVersion: connection.credentialVersion,
      ...scopes,
      accounts: (connection.accounts ?? []).map((account) =>
        this.accountView(account),
      ),
    };
  }

  private accountView(
    account: Prisma.ProviderAccountGetPayload<object>,
  ): ProviderAccountView {
    return {
      id: account.id,
      provider: account.provider as ProviderId,
      externalAccountId: account.externalAccountId,
      displayName: account.displayName,
      accountName: stringMetadata(account.metadata, "accountName") ?? null,
      currency: account.currency,
      timezone: account.timezone,
      status: account.status,
      enabled: account.enabled,
      discoveredAt: account.discoveredAt.toISOString(),
      lastSeenAt: account.lastSeenAt.toISOString(),
    };
  }

  private scopeMetadata(
    requestedScopes: string[],
    grantedScopes: string[],
  ): ProviderScopeMetadata {
    return {
      requestedScopes,
      grantedScopes,
      missingScopes: requestedScopes.filter(
        (scope) => !grantedScopes.includes(scope),
      ),
    };
  }

  private scopeMetadataFromJson(metadata: unknown): ProviderScopeMetadata {
    const value = metadata as Partial<ProviderScopeMetadata> | null;
    return {
      requestedScopes: Array.isArray(value?.requestedScopes)
        ? value.requestedScopes.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      grantedScopes: Array.isArray(value?.grantedScopes)
        ? value.grantedScopes.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      missingScopes: Array.isArray(value?.missingScopes)
        ? value.missingScopes.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
    };
  }

  private redirectUri(provider: ProviderId): string {
    if (provider === "GOOGLE_ADS" && this.config.providerGoogleRedirectUri)
      return this.config.providerGoogleRedirectUri;
    if (
      provider === "GOOGLE_SEARCH_CONSOLE" &&
      this.config.providerGoogleSearchConsoleRedirectUri
    )
      return this.config.providerGoogleSearchConsoleRedirectUri;
    if (
      provider === "GOOGLE_ANALYTICS" &&
      this.config.providerGoogleAnalyticsRedirectUri
    )
      return this.config.providerGoogleAnalyticsRedirectUri;
    if (provider === "META_ADS" && this.config.providerMetaRedirectUri)
      return this.config.providerMetaRedirectUri;
    if (provider === "TIKTOK_ADS" && this.config.providerTikTokRedirectUri)
      return this.config.providerTikTokRedirectUri;
    if (provider === "YANDEX_DIRECT" && this.config.providerYandexRedirectUri)
      return this.config.providerYandexRedirectUri;
    return `http://localhost:${this.config.apiPort}/api/v1/oauth/${provider}/callback`;
  }

  private async record(
    eventType: string,
    request: RequestWithAuth,
    principal: HumanPrincipal,
    workspaceId?: string,
    provider?: ProviderId,
    targetId?: string,
    error?: unknown,
  ) {
    await this.audit.record({
      eventType,
      actorUserId: principal.userId,
      ...(workspaceId ? { workspaceId } : {}),
      ...(provider
        ? { targetType: "provider", targetId: targetId ?? provider }
        : {}),
      ...(request.requestId ? { requestId: request.requestId } : {}),
      ...(error
        ? {
            success: false,
            metadata: {
              code:
                error instanceof ProviderError ? error.code : "provider_error",
            },
          }
        : {}),
    });
  }
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function stringMetadata(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

type SearchConsoleTotals = {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

function totals(rows: SearchConsoleQueryRow[]): SearchConsoleTotals {
  let clicks = 0;
  let impressions = 0;
  let positionWeight = 0;
  for (const row of rows) {
    const rowClicks = Number(row.clicks ?? 0);
    const rowImpressions = Number(row.impressions ?? 0);
    const rowPosition = Number(row.position ?? 0);
    clicks += Number.isFinite(rowClicks) ? rowClicks : 0;
    impressions += Number.isFinite(rowImpressions) ? rowImpressions : 0;
    positionWeight +=
      (Number.isFinite(rowPosition) ? rowPosition : 0) *
      (Number.isFinite(rowImpressions) ? rowImpressions : 0);
  }
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : 0,
    position: impressions ? positionWeight / impressions : 0,
  };
}

function mergeRows(rows: SearchConsoleQueryRow[], dimension: string) {
  const grouped = new Map<string, SearchConsoleQueryRow>();
  for (const row of rows) {
    const key = String(row.keys?.[0] ?? "");
    const current = grouped.get(key) ?? { keys: [key] };
    const clicks = Number(current.clicks ?? 0) + Number(row.clicks ?? 0);
    const impressions =
      Number(current.impressions ?? 0) + Number(row.impressions ?? 0);
    const weightedPosition =
      Number(current.position ?? 0) * Number(current.impressions ?? 0) +
      Number(row.position ?? 0) * Number(row.impressions ?? 0);
    grouped.set(key, {
      keys: [key],
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : 0,
      position: impressions ? weightedPosition / impressions : 0,
    });
  }
  return [...grouped.values()]
    .sort((left, right) => Number(right.clicks ?? 0) - Number(left.clicks ?? 0))
    .map((row) => ({ ...row, dimension }));
}

function metricDeltas(
  current: SearchConsoleTotals,
  previous: SearchConsoleTotals,
) {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => {
      const oldValue = previous[key as keyof SearchConsoleTotals] ?? 0;
      return [
        key,
        {
          absolute: value - oldValue,
          percent: oldValue ? ((value - oldValue) / oldValue) * 100 : null,
        },
      ];
    }),
  );
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.map((row) => (row && typeof row === "object" ? row : {}))
    : [];
}

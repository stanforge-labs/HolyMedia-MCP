/* eslint-disable @typescript-eslint/consistent-type-imports */
import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { ProviderId } from "@holymedia/contracts";
import type { FastifyReply } from "fastify";
import { loadConfig } from "@holymedia/config";
import {
  CurrentPrincipal,
  RequirePermissions,
} from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { WorkspaceAuthorizationGuard } from "../auth/workspace-authorization.guard.js";
import {
  AccountSelectionBatchDto,
  AccountSelectionDto,
  ProviderDateRangeDto,
} from "./provider.dto.js";
import { ProviderService } from "./provider.service.js";
import { isProviderId } from "./provider.types.js";

@Controller()
export class ProviderController {
  public constructor(
    @Inject(ProviderService) private readonly providers: ProviderService,
  ) {}

  @Get("providers")
  public listProviders() {
    return this.providers.listProviders();
  }

  @Get("workspaces/:id/connections")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.read")
  public listConnections(@Param("id") id: string) {
    return this.providers.listConnections(id);
  }

  @Post("workspaces/:id/connections/:provider/oauth/start")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.manage")
  public startOAuth(
    @Param("id") id: string,
    @Param("provider") provider: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.startOAuth(
      id,
      this.provider(provider),
      principal,
      request,
    );
  }

  @Get("oauth/:provider/callback")
  public async callback(
    @Param("provider") provider: string,
    @Query("state") state: string,
    @Query("code") code: string | undefined,
    @Query("auth_code") authCode: string | undefined,
    @Req() request: RequestWithAuth,
    @Res() reply: FastifyReply,
    @Query("error") oauthError?: string,
  ) {
    const providerId = this.provider(provider);
    // TikTok's established callback contract uses auth_code, while the other
    // OAuth providers use code. Keep both public callback shapes compatible.
    const authorizationCode =
      providerId === "TIKTOK_ADS" ? authCode || code : code;
    const redirect = (outcome: "success" | "error", reason?: string) => {
      const path = `/dashboard/connections?oauth=${outcome}&provider=${encodeURIComponent(provider)}${reason ? `&oauth_reason=${encodeURIComponent(reason)}` : ""}`;
      const config = loadConfig();
      return reply
        .code(302)
        .redirect(
          config.qrsTestLocalReadonlyAuth
            ? new URL(path, config.publicBaseUrl).toString()
            : path,
        );
    };
    if (oauthError)
      return redirect(
        "error",
        oauthError === "access_denied"
          ? "authorization_denied"
          : "oauth_denied",
      );
    if (
      typeof state !== "string" ||
      state.length < 32 ||
      state.length > 256 ||
      typeof authorizationCode !== "string" ||
      authorizationCode.length < 1 ||
      authorizationCode.length > 512
    )
      return redirect("error", "invalid_callback");
    try {
      await this.providers.completeOAuthCallback(
        providerId,
        { state, code: authorizationCode },
        request,
      );
      return redirect("success");
    } catch (error) {
      return redirect("error", oauthFailureReason(error));
    }
  }

  @Get("workspaces/:id/connections/:connectionId")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.read")
  public getConnection(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.providers.getConnection(id, connectionId);
  }

  @Delete("workspaces/:id/connections/:connectionId")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.manage")
  public disconnect(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.disconnect(id, connectionId, principal, request);
  }

  @Post("workspaces/:id/connections/:connectionId/refresh")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("connections.manage")
  public refresh(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.refresh(id, connectionId, principal, request);
  }

  @Get("workspaces/:id/connections/:connectionId/accounts")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public accounts(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.providers
      .getConnection(id, connectionId)
      .then((connection) => connection.accounts);
  }

  @Post("workspaces/:id/connections/:connectionId/accounts/discover")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.manage")
  public discover(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.discover(id, connectionId, principal, request);
  }

  @Patch("workspaces/:id/connections/:connectionId/accounts")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.manage")
  public selectAccounts(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Body() input: AccountSelectionBatchDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.setAccountsEnabled(
      id,
      connectionId,
      input.accountIds,
      principal,
      request,
    );
  }

  @Patch("workspaces/:id/provider-accounts/:accountId")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.manage")
  public selectAccount(
    @Param("id") id: string,
    @Param("accountId") accountId: string,
    @Body() input: AccountSelectionDto,
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
  ) {
    return this.providers.setAccountEnabled(
      id,
      accountId,
      input.enabled,
      principal,
      request,
    );
  }

  @Get("workspaces/:id/connections/:connectionId/accounts/:accountId/summary")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public accountSummary(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("accountId") accountId: string,
    @Query() query: ProviderDateRangeDto,
  ) {
    const range =
      query.startDate && query.endDate
        ? { startDate: query.startDate, endDate: query.endDate }
        : undefined;
    return this.providers.readAccountSummary(
      id,
      connectionId,
      accountId,
      range,
    );
  }

  @Get("workspaces/:id/connections/:connectionId/accounts/:accountId/campaigns")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public campaigns(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("accountId") accountId: string,
    @Query() query: ProviderDateRangeDto,
  ) {
    const range =
      query.startDate && query.endDate
        ? { startDate: query.startDate, endDate: query.endDate }
        : undefined;
    return this.providers.readCampaigns(
      id,
      connectionId,
      accountId,
      range,
      query.limit,
      query.cursor,
    );
  }

  @Get("workspaces/:id/connections/:connectionId/accounts/:accountId/metrics")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metrics(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("accountId") accountId: string,
    @Query() query: ProviderDateRangeDto,
  ) {
    if (!query.startDate || !query.endDate)
      throw new BadRequestException("startDate and endDate are required.");
    return this.providers.readMetrics(
      id,
      connectionId,
      accountId,
      { startDate: query.startDate, endDate: query.endDate },
      query.campaignId,
    );
  }

  @Get("workspaces/:id/connections/:connectionId/accounts/:accountId/health")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public health(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("accountId") accountId: string,
  ) {
    return this.providers.readHealth(id, connectionId, accountId);
  }

  @Get("workspaces/:id/connections/:connectionId/meta/businesses")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaBusinesses(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.providers.metaBusinesses(id, connectionId);
  }

  @Get("workspaces/:id/connections/:connectionId/meta/pages")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaPages(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
  ) {
    return this.providers.metaPages(id, connectionId);
  }

  @Get(
    "workspaces/:id/connections/:connectionId/meta/businesses/:businessId/ad-accounts",
  )
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaBusinessAdAccounts(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("businessId") businessId: string,
  ) {
    return this.providers.metaBusinessAdAccounts(id, connectionId, businessId);
  }

  @Get(
    "workspaces/:id/connections/:connectionId/meta/businesses/:businessId/pages",
  )
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaBusinessPages(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("businessId") businessId: string,
  ) {
    return this.providers.metaBusinessPages(id, connectionId, businessId);
  }

  @Get("workspaces/:id/connections/:connectionId/meta/pages/:pageId/posts")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaPagePosts(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("pageId") pageId: string,
    @Query() query: ProviderDateRangeDto,
  ) {
    return this.providers.metaPagePosts(id, connectionId, pageId, query.limit);
  }

  @Get("workspaces/:id/connections/:connectionId/meta/pages/:pageId/instagram")
  @UseGuards(AuthenticationGuard, WorkspaceAuthorizationGuard)
  @RequirePermissions("provider_accounts.read")
  public metaInstagram(
    @Param("id") id: string,
    @Param("connectionId") connectionId: string,
    @Param("pageId") pageId: string,
  ) {
    return this.providers.metaInstagram(id, connectionId, pageId);
  }

  private provider(value: string): ProviderId {
    const aliases: Record<string, ProviderId> = {
      google: "GOOGLE_ADS",
      google_ads: "GOOGLE_ADS",
      google_analytics: "GOOGLE_ANALYTICS",
      "google-analytics": "GOOGLE_ANALYTICS",
      meta: "META_ADS",
      meta_ads: "META_ADS",
      yandex: "YANDEX_DIRECT",
      yandex_direct: "YANDEX_DIRECT",
      tiktok: "TIKTOK_ADS",
      tiktok_ads: "TIKTOK_ADS",
      "google-search-console": "GOOGLE_SEARCH_CONSOLE",
      google_search_console: "GOOGLE_SEARCH_CONSOLE",
    };
    const normalized = aliases[value] ?? value;
    if (!isProviderId(normalized))
      throw new BadRequestException("Unsupported provider.");
    return normalized;
  }
}

function oauthFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("разреш") || message.includes("permission"))
    return "insufficient_permissions";
  if (message.includes("не настро") || message.includes("not configured"))
    return "provider_not_configured";
  if (message.includes("авторизац") || message.includes("authentication"))
    return "authentication_failed";
  if (message.includes("недейств") || message.includes("state"))
    return "invalid_oauth_state";
  if (message.includes("лимит") || message.includes("rate"))
    return "rate_limited";
  return "oauth_failed";
}

import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { createLogger } from "@holymedia/observability";
import type { FastifyReply } from "fastify";
import { CurrentPrincipal } from "../auth/auth.decorators.js";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { CsrfGuard } from "../auth/csrf.guard.js";
import { SessionService } from "../auth/session.service.js";
import { McpOAuthClientService } from "../mcp/mcp-oauth-client.service.js";
import { OAuthAuthorizationService } from "../mcp/oauth-authorization.service.js";

@Controller()
export class LegacyMcpOAuthController {
  private readonly logger = createLogger("holymedia-mcp-v2-oauth");
  public constructor(
    @Inject(McpOAuthClientService)
    private readonly clients: McpOAuthClientService,
    @Inject(OAuthAuthorizationService)
    private readonly oauth: OAuthAuthorizationService,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  @Get("api/mcp-oauth-client")
  @UseGuards(AuthenticationGuard)
  public summary(@CurrentPrincipal() principal: HumanPrincipal) {
    return this.clients.summary(principal);
  }

  @Post("api/mcp-oauth-client/create")
  @UseGuards(AuthenticationGuard, CsrfGuard)
  public create(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Req() request: RequestWithAuth,
    @Body() body: Record<string, unknown>,
  ) {
    const name =
      typeof body.client_name === "string" ? body.client_name : undefined;
    return this.clients.create(principal, request, name);
  }

  @Get("oauth/authorize")
  @Redirect()
  public async authorize(
    @Req() request: RequestWithAuth,
    @Query() query: Record<string, unknown>,
  ) {
    const clientId = typeof query.client_id === "string" ? query.client_id : "";
    const principal = await this.optionalPrincipal(request);
    if (await this.oauth.isPublicClient(clientId)) {
      return this.oauth.beginAuthorization(query, principal ?? undefined);
    }
    if (!principal) throw new UnauthorizedException("Authentication required.");
    return this.clients.authorize(query, principal);
  }

  @Post("oauth/register")
  @HttpCode(HttpStatus.CREATED)
  public async register(
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Body() body: Record<string, unknown>,
    @Headers("content-type") contentType?: string,
    @Headers("user-agent") userAgent?: string,
  ) {
    try {
      const result = await this.oauth.registerPublicClient(body);
      this.logger.info(
        {
          requestId: request.requestId,
          contentType: contentType?.split(";", 1)[0] ?? null,
          userAgent: userAgent?.slice(0, 160) ?? null,
          redirectUris: Array.isArray(body.redirect_uris)
            ? body.redirect_uris.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          grantTypes: Array.isArray(body.grant_types)
            ? body.grant_types.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          responseTypes: Array.isArray(body.response_types)
            ? body.response_types.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          tokenEndpointAuthMethod:
            typeof body.token_endpoint_auth_method === "string"
              ? body.token_endpoint_auth_method
              : "none",
          applicationType:
            typeof body.application_type === "string"
              ? body.application_type
              : null,
          clientId: result.client_id.slice(0, 18),
        },
        "OAuth public client registered",
      );
      reply.header("cache-control", "no-store");
      reply.header("pragma", "no-cache");
      return result;
    } catch (error) {
      this.logger.warn(
        {
          requestId: request.requestId,
          contentType: contentType?.split(";", 1)[0] ?? null,
          userAgent: userAgent?.slice(0, 160) ?? null,
          redirectUriCount: Array.isArray(body.redirect_uris)
            ? body.redirect_uris.length
            : 0,
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
        },
        "OAuth public client registration rejected",
      );
      throw error;
    }
  }

  @Get("oauth/authorize/continue")
  @UseGuards(AuthenticationGuard)
  @Redirect()
  public continueAuthorization(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query("transaction") transactionId: string,
    @Query("workspace_id") workspaceId?: string,
  ) {
    return this.oauth.continueAuthorization(
      transactionId,
      principal,
      workspaceId,
    );
  }

  @Get("oauth/authorize/transaction")
  @UseGuards(AuthenticationGuard)
  public authorizationContext(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Query("transaction") transactionId: string,
  ) {
    return this.oauth.authorizationContext(transactionId, principal);
  }

  @Post("oauth/authorize/consent")
  @UseGuards(AuthenticationGuard, CsrfGuard)
  public async consent(
    @CurrentPrincipal() principal: HumanPrincipal,
    @Body() body: Record<string, unknown>,
  ) {
    const transactionId =
      typeof body.transaction_id === "string" ? body.transaction_id : "";
    const workspaceId =
      typeof body.workspace_id === "string" ? body.workspace_id : undefined;
    if (body.decision !== "allow" && body.decision !== "deny") {
      throw new BadRequestException("OAuth consent decision is invalid.");
    }
    const result = await this.oauth.decideAuthorization(
      transactionId,
      body.decision === "allow",
      principal,
      workspaceId,
      typeof body.approved_scope === "string" ? body.approved_scope : undefined,
    );
    return { redirect_url: result.url };
  }

  @Post("oauth/token")
  public async token(
    @Body() body: Record<string, unknown>,
    @Headers("authorization") authorization?: string,
  ) {
    const clientId = typeof body.client_id === "string" ? body.client_id : "";
    if (await this.oauth.isPublicClient(clientId)) {
      return this.oauth.exchangeToken(body);
    }
    return this.clients.token(body, authorization);
  }

  @Post("oauth/revoke")
  public revoke(@Body() body: Record<string, unknown>) {
    return this.oauth.revoke(body);
  }

  private async optionalPrincipal(
    request: RequestWithAuth,
  ): Promise<HumanPrincipal | null> {
    const token = this.sessions.extractToken(request);
    const session = token ? await this.sessions.validate(token) : null;
    return session
      ? { kind: "human", userId: session.userId, sessionId: session.id }
      : null;
  }
}

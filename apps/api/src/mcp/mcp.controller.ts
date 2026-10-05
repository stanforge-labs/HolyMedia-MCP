import {
  Controller,
  Get,
  HttpException,
  Inject,
  MethodNotAllowedException,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { McpService } from "./mcp.service.js";
import { ServiceTokenService } from "../service-tokens/service-token.service.js";
import { BillingService } from "../billing/billing.service.js";
import { AuditService } from "../audit/audit.service.js";
import { ProviderError } from "../providers/provider.errors.js";
import { GoogleAdsApiError } from "../providers/google-ads.error.js";
import { loadConfig } from "@holymedia/config";
import { createLogger } from "@holymedia/observability";
import { PreviewError } from "./mcp-preview.error.js";
import { MetaReadError } from "../providers/meta-read.error.js";
import { OAuthAuthorizationService } from "./oauth-authorization.service.js";
import { oauthEndpoints } from "./oauth-endpoints.js";
import { McpPublicWriteService } from "./mcp-public-write.service.js";
import {
  isPublicReadTool,
  isPublicTool,
  isPublicToolAvailable,
  publicTools,
} from "./mcp-public-tools.js";

type McpRequest = FastifyRequest & { body?: unknown };
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

@Controller()
export class McpController {
  private readonly logger = createLogger("holymedia-mcp-v2-mcp");
  private readonly endpoints = oauthEndpoints();
  private readonly publicWriteScopeEnabled =
    loadConfig().publicMcpWriteScopeEnabled;

  public constructor(
    @Inject(McpService) private readonly mcp: McpService,
    @Inject(ServiceTokenService) private readonly tokens: ServiceTokenService,
    @Inject(OAuthAuthorizationService)
    private readonly oauthTokens: OAuthAuthorizationService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(McpPublicWriteService)
    private readonly publicWrites: McpPublicWriteService,
  ) {}

  @Get("mcp")
  public async get(
    @Req() request: McpRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.handleGet(request, reply, false);
  }

  @Get("mcp/public")
  public async getPublic(
    @Req() request: McpRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.handleGet(request, reply, true);
  }

  private async handleGet(
    request: McpRequest,
    reply: FastifyReply,
    publicRoute: boolean,
  ) {
    const rawAuthorization = request.headers.authorization;
    const authorization = Array.isArray(rawAuthorization)
      ? rawAuthorization[0]
      : rawAuthorization;
    const token = bearerToken(authorization);
    const principal = token
      ? await this.authenticate(token, publicRoute)
      : null;
    if (!principal) {
      this.logger.warn(
        { authReason: "missing_invalid_revoked_or_expired_service_token" },
        "MCP authorization rejected",
      );
      return mcpUnauthorized(reply, publicRoute, this.endpoints);
    }

    // Server-to-client SSE is optional in Streamable HTTP. A valid MCP client
    // continues with JSON-RPC POST requests after this explicit response.
    throw new MethodNotAllowedException(
      "This MCP endpoint does not provide an SSE stream.",
    );
  }

  @Post("mcp")
  public async post(
    @Req() request: McpRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.handlePost(request, reply, false);
  }

  @Post("mcp/public")
  public async postPublic(
    @Req() request: McpRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.handlePost(request, reply, true);
  }

  private async handlePost(
    request: McpRequest,
    reply: FastifyReply,
    publicRoute: boolean,
  ) {
    const rawAuthorization = request.headers.authorization;
    const authorization = Array.isArray(rawAuthorization)
      ? rawAuthorization[0]
      : rawAuthorization;
    const token = bearerToken(authorization);
    if (!token) {
      this.logger.warn(
        { authReason: "missing_or_malformed_bearer" },
        "MCP authorization rejected",
      );
      return mcpUnauthorized(reply, publicRoute, this.endpoints);
    }
    const principal = token
      ? await this.authenticate(token, publicRoute)
      : null;
    if (!principal) {
      this.logger.warn(
        { authReason: "invalid_revoked_or_expired_service_token" },
        "MCP authorization rejected",
      );
      return mcpUnauthorized(reply, publicRoute, this.endpoints);
    }

    const input = (request.body ?? {}) as JsonRpcRequest;
    const id = input.id ?? null;
    if (input.method === "notifications/initialized") {
      // Streamable HTTP notifications must not produce a JSON-RPC body. Codex
      // closes the transport when it receives Nest's default 201 JSON response.
      return reply.code(202).send();
    }

    // Nest defaults POST handlers to 201. MCP request/response messages must
    // instead be acknowledged with a normal 200 response.
    reply.code(200);
    this.logger.info(
      {
        mcpMethod:
          typeof input.method === "string"
            ? input.method.slice(0, 120)
            : "unknown",
        requestId: request.id,
      },
      "MCP request authenticated",
    );

    if (input.method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "holymedia-mcp-v2", version: "0.1.0" },
        },
      };
    }
    if (input.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          tools: publicRoute
            ? publicTools(this.mcp.tools(), this.publicWriteScopeEnabled)
            : this.mcp.tools(),
        },
      };
    }
    if (input.method === "tools/call") {
      const params = input.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      try {
        if (
          publicRoute &&
          !isPublicToolAvailable(name, this.publicWriteScopeEnabled)
        )
          throw new PreviewError("public_operation_not_available");
        await this.billing.consumeMcpRequest(principal.workspaceId);
        let result: unknown;
        if (publicRoute && !isPublicReadTool(name)) {
          if (principal.kind !== "oauth")
            throw new PreviewError("write_scope_required");
          result = await this.publicWrites.call(
            principal,
            name,
            params.arguments,
          );
        } else {
          result = await this.mcp.call(principal, name, params.arguments);
        }
        await Promise.allSettled([
          this.audit.record({
            eventType: "mcp_tool_executed",
            actorType: principal.kind === "oauth" ? "HUMAN" : "SERVICE",
            ...(principal.kind === "oauth"
              ? { actorUserId: principal.userId }
              : {}),
            workspaceId: principal.workspaceId,
            targetType: "mcp_tool",
            targetId: name.slice(0, 255),
            requestId: request.id,
            metadata: { tool: name.slice(0, 120) },
          }),
        ]);
        return {
          jsonrpc: "2.0",
          id,
          result: { content: [{ type: "text", text: JSON.stringify(result) }] },
        };
      } catch (error) {
        if (publicRoute && isPublicTool(name) && !isPublicReadTool(name)) {
          await Promise.allSettled([
            this.audit.record({
              eventType: "mcp_public_write_rejected",
              actorType: principal.kind === "oauth" ? "HUMAN" : "SERVICE",
              ...(principal.kind === "oauth"
                ? { actorUserId: principal.userId }
                : {}),
              workspaceId: principal.workspaceId,
              targetType: "mcp_tool",
              targetId: name.slice(0, 160),
              requestId: request.id,
              success: false,
              metadata: {
                tool: name.slice(0, 120),
                reason:
                  error instanceof PreviewError
                    ? error.code
                    : error instanceof HttpException
                      ? "policy_denied"
                      : "provider_or_internal_error",
              },
            }),
          ]);
        }
        this.logger.warn(
          {
            tool: name.slice(0, 120),
            errorType:
              error && typeof error === "object" && "constructor" in error
                ? error.constructor?.name
                : "unknown",
            httpStatus:
              error instanceof HttpException ? error.getStatus() : undefined,
            errorCode:
              error instanceof PreviewError || error instanceof MetaReadError
                ? error.code
                : undefined,
            ...(error instanceof MetaReadError
              ? {
                  provider: error.provider,
                  operation: error.operation,
                  upstreamCode: error.upstream_code,
                  upstreamSubcode: error.upstream_subcode,
                  upstreamHttpStatus: error.httpStatus,
                  retryable: error.retryable,
                  ...error.context,
                }
              : {}),
            workspaceId: principal.workspaceId,
            ...(principal.kind === "service"
              ? {
                  serviceTokenId: principal.tokenId,
                  serviceIdentityId: principal.serviceIdentityId,
                }
              : {
                  oauthClientId: principal.clientId,
                  oauthGrantId: principal.grantId,
                }),
            requestId: request.id,
            // Names only, never argument values or opaque tokens.
            argumentKeys:
              params.arguments && typeof params.arguments === "object"
                ? Object.keys(params.arguments)
                    .slice(0, 20)
                    .map((key) =>
                      [
                        "preview_token",
                        "previewToken",
                        "provider",
                        "account_id",
                        "accountId",
                        "campaign_id",
                        "campaignId",
                        "new_name",
                        "name",
                        "preview_id",
                        "confirmed",
                        "confirmation",
                      ].includes(key)
                        ? key
                        : "<other-field>",
                    )
                : [],
          },
          "MCP tool execution failed",
        );
        const message = mcpFailureMessage(error);
        return {
          jsonrpc: "2.0",
          id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  message,
                  ...(error instanceof MetaReadError
                    ? error.publicResult()
                    : {}),
                  ...(error instanceof PreviewError
                    ? { code: error.code }
                    : {}),
                  ...googleAdsMcpErrorFields(error),
                  ...(error instanceof ProviderError &&
                  error.code === "invalid_request"
                    ? { code: error.code, provider: "GOOGLE_ADS" }
                    : {}),
                  ...(error instanceof ProviderError &&
                  error.code === "not_supported_for_google_ads"
                    ? { code: error.code, provider: "GOOGLE_ADS" }
                    : {}),
                  ...(error instanceof ProviderError &&
                  error.code === "google_ads_manager_metrics_unsupported"
                    ? {
                        code: error.code,
                        provider: "GOOGLE_ADS",
                        operation: name,
                        retryable: false,
                        user_action: "select_client_account",
                        upstream_code: error.providerCode,
                      }
                    : {}),
                }),
              },
            ],
          },
        };
      }
    }
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found." },
    };
  }

  private async authenticate(token: string, publicRoute: boolean) {
    if (publicRoute)
      return this.oauthTokens.authenticate(
        token,
        this.endpoints.publicResource,
      );
    const service = await this.tokens.authenticate(token);
    if (service) return service;
    const oauth = await this.oauthTokens.authenticate(token);
    // Preserve the existing /mcp principal shape and behavior. The new OAuth
    // identity is used only on /mcp/public and never enables legacy writes.
    return oauth
      ? {
          kind: "service" as const,
          tokenId: oauth.tokenId,
          serviceIdentityId: `oauth:${oauth.clientId}:${oauth.userId}`,
          workspaceId: oauth.workspaceId,
          scopes: oauth.scopes,
          accountIds: oauth.accountIds,
        }
      : null;
  }
}

export function mcpFailureMessage(error: unknown): string {
  if (error instanceof PreviewError) return error.publicMessage;
  if (error instanceof GoogleAdsApiError) return error.message;
  if (error instanceof ProviderError && error.code === "invalid_request")
    return error.message;
  if (
    error instanceof ProviderError &&
    error.code === "not_supported_for_google_ads"
  )
    return "Эта операция предварительного изменения пока не поддерживается для Google Ads.";
  if (
    error instanceof ProviderError &&
    error.code === "insufficient_permissions"
  )
    return error.providerCode === "PERMISSION_DENIED"
      ? "Google Ads не разрешает доступ к этому клиентскому кабинету. Выберите другой кабинет или проверьте права доступа."
      : "У подключения Meta недостаточно разрешений для этой операции.";
  if (
    error instanceof ProviderError &&
    error.code === "google_ads_manager_metrics_unsupported"
  )
    return "Управляющий аккаунт Google Ads не содержит метрик кампаний. Повторите отчёт для клиентского рекламного аккаунта внутри этого MCC.";
  if (error instanceof HttpException) {
    const message = error.message;
    if (message === "Account is not available to this service token.")
      return "Указанный рекламный кабинет недоступен этому ключу доступа.";
    if (message === "Service token does not have read access.")
      return "У ключа доступа нет разрешения на чтение данных.";
    if (message === "Write scope is required for commit.")
      return "Для подтверждённого изменения требуется ключ с правом записи.";
    if (message === "new_name is required.")
      return "Укажите новое название кампании.";
    if (message === "Preview token is invalid.")
      return "Подтверждение изменения устарело или недействительно.";
  }
  return error instanceof ProviderError
    ? "Запрос к рекламной платформе не выполнен."
    : "Не удалось выполнить запрос HolyMedia. Попробуйте ещё раз.";
}

export function googleAdsMcpErrorFields(error: unknown) {
  if (!(error instanceof GoogleAdsApiError)) return {};
  return {
    provider: "GOOGLE_ADS" as const,
    error_code: error.errors[0]?.error_code,
    ...(error.errors[0]?.field_path
      ? { field_path: error.errors[0].field_path }
      : {}),
    ...(error.requestId ? { request_id: error.requestId } : {}),
    errors: error.errors,
  };
}

function mcpUnauthorized(
  reply: FastifyReply,
  publicRoute: boolean,
  endpoints: ReturnType<typeof oauthEndpoints>,
) {
  return reply
    .code(401)
    .header(
      "WWW-Authenticate",
      publicRoute
        ? `Bearer resource_metadata="${endpoints.publicResourceMetadata}", scope="adforge:mcp:read"`
        : `Bearer resource_metadata="${endpoints.legacyResourceMetadata}", scope="adforge:mcp:read"`,
    )
    .send({ statusCode: 401, message: "MCP authorization required." });
}

function bearerToken(authorization: string | undefined): string {
  // RFC 7235 authentication schemes are case-insensitive. This also rejects
  // malformed values such as "Bearer Bearer <token>" without logging a secret.
  const match = /^\s*Bearer\s+([^\s]+)\s*$/i.exec(authorization ?? "");
  return match?.[1] ?? "";
}

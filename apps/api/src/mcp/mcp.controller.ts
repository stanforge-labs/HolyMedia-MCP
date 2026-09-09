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
import { createLogger } from "@holymedia/observability";
import { PreviewError } from "./mcp-preview.error.js";
import { OAuthAuthorizationService } from "./oauth-authorization.service.js";

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

  public constructor(
    @Inject(McpService) private readonly mcp: McpService,
    @Inject(ServiceTokenService) private readonly tokens: ServiceTokenService,
    @Inject(OAuthAuthorizationService)
    private readonly oauthTokens: OAuthAuthorizationService,
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("mcp")
  public async get(
    @Req() request: McpRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const rawAuthorization = request.headers.authorization;
    const authorization = Array.isArray(rawAuthorization)
      ? rawAuthorization[0]
      : rawAuthorization;
    const token = bearerToken(authorization);
    const principal = token ? await this.authenticate(token) : null;
    if (!principal) {
      this.logger.warn(
        { authReason: "missing_invalid_revoked_or_expired_service_token" },
        "MCP authorization rejected",
      );
      return mcpUnauthorized(reply);
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
      return mcpUnauthorized(reply);
    }
    const principal = token ? await this.authenticate(token) : null;
    if (!principal) {
      this.logger.warn(
        { authReason: "invalid_revoked_or_expired_service_token" },
        "MCP authorization rejected",
      );
      return mcpUnauthorized(reply);
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
      return { jsonrpc: "2.0", id, result: { tools: this.mcp.tools() } };
    }
    if (input.method === "tools/call") {
      const params = input.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      try {
        await this.billing.consumeMcpRequest(principal.workspaceId);
        const result = await this.mcp.call(principal, name, params.arguments);
        await Promise.allSettled([
          this.audit.record({
            eventType: "mcp_tool_executed",
            actorType: "SERVICE",
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
        this.logger.warn(
          {
            tool: name.slice(0, 120),
            errorType:
              error && typeof error === "object" && "constructor" in error
                ? error.constructor?.name
                : "unknown",
            httpStatus:
              error instanceof HttpException ? error.getStatus() : undefined,
            errorCode: error instanceof PreviewError ? error.code : undefined,
            workspaceId: principal.workspaceId,
            serviceTokenId: principal.tokenId,
            serviceIdentityId: principal.serviceIdentityId,
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
                  ...(error instanceof PreviewError
                    ? { code: error.code }
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

  private async authenticate(token: string) {
    return (
      (await this.tokens.authenticate(token)) ??
      (await this.oauthTokens.authenticate(token))
    );
  }
}

function mcpFailureMessage(error: unknown): string {
  if (error instanceof PreviewError) return error.publicMessage;
  if (
    error instanceof ProviderError &&
    error.code === "insufficient_permissions"
  )
    return "У подключения Meta недостаточно разрешений для этой операции.";
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

function mcpUnauthorized(reply: FastifyReply) {
  return reply
    .code(401)
    .header(
      "WWW-Authenticate",
      'Bearer resource_metadata="https://mcp.holymedia.kz/.well-known/oauth-protected-resource/mcp", scope="adforge:mcp:read"',
    )
    .send({ statusCode: 401, message: "MCP authorization required." });
}

function bearerToken(authorization: string | undefined): string {
  // RFC 7235 authentication schemes are case-insensitive. This also rejects
  // malformed values such as "Bearer Bearer <token>" without logging a secret.
  const match = /^\s*Bearer\s+([^\s]+)\s*$/i.exec(authorization ?? "");
  return match?.[1] ?? "";
}

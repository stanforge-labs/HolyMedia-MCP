import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditService } from "./audit/audit.service.js";
import { OAuthMetadataController } from "./compat/oauth-metadata.controller.js";
import { LegacyMcpOAuthController } from "./compat/legacy-mcp-oauth.controller.js";
import { SessionService } from "./auth/session.service.js";
import { AuthenticationGuard } from "./auth/authentication.guard.js";
import { CsrfGuard } from "./auth/csrf.guard.js";
import { configureApiRouting } from "./configure-api-routing.js";
import { BillingService } from "./billing/billing.service.js";
import { McpController } from "./mcp/mcp.controller.js";
import { McpPublicWriteService } from "./mcp/mcp-public-write.service.js";
import { McpService } from "./mcp/mcp.service.js";
import { OAuthAuthorizationService } from "./mcp/oauth-authorization.service.js";
import { McpOAuthClientService } from "./mcp/mcp-oauth-client.service.js";
import { ServiceTokenService } from "./service-tokens/service-token.service.js";

@Module({
  controllers: [
    McpController,
    OAuthMetadataController,
    LegacyMcpOAuthController,
  ],
  providers: [
    { provide: McpService, useValue: { tools: () => [], call: vi.fn() } },
    { provide: ServiceTokenService, useValue: { authenticate: vi.fn() } },
    {
      provide: OAuthAuthorizationService,
      useValue: {
        authenticate: vi.fn(),
        isPublicClient: vi.fn(async () => true),
        beginAuthorization: vi.fn(async () => ({
          url: "https://mcp.holymedia.kz/auth?oauth_transaction=test",
          statusCode: 302,
        })),
        exchangeToken: vi.fn(async () => ({
          token_type: "Bearer",
          access_token: "test",
        })),
      },
    },
    { provide: McpOAuthClientService, useValue: {} },
    { provide: SessionService, useValue: { extractToken: vi.fn(() => null) } },
    AuthenticationGuard,
    CsrfGuard,
    { provide: BillingService, useValue: { consumeMcpRequest: vi.fn() } },
    { provide: AuditService, useValue: { record: vi.fn() } },
    { provide: McpPublicWriteService, useValue: { call: vi.fn() } },
  ],
})
class HttpRouteTestModule {}

describe("production-prefix HTTP routing", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      HttpRouteTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    configureApiRouting(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("serves public MCP at root, not under api/v1", async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const root = await fastify.inject({
      method: "POST",
      url: "/mcp/public",
      headers: { "content-type": "application/json" },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
    });
    expect(root.statusCode).toBe(401);
    expect(root.headers["www-authenticate"]).toContain(
      "/.well-known/oauth-protected-resource/mcp/public",
    );
    const prefixed = await fastify.inject({
      method: "POST",
      url: "/api/v1/mcp/public",
      headers: { "content-type": "application/json" },
      payload: { jsonrpc: "2.0", id: 1, method: "initialize" },
    });
    expect(prefixed.statusCode).toBe(404);
    const legacy = await fastify.inject({ method: "GET", url: "/mcp" });
    expect(legacy.statusCode).toBe(401);
  });

  it("serves exact root public protected-resource and authorization metadata", async () => {
    const fastify = app.getHttpAdapter().getInstance();
    const resource = await fastify.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource/mcp/public",
    });
    expect(resource.statusCode).toBe(200);
    expect(resource.json()).toMatchObject({
      resource: "https://mcp.holymedia.kz/mcp/public",
      authorization_servers: ["https://mcp.holymedia.kz"],
    });
    expect(
      (
        await fastify.inject({
          method: "GET",
          url: "/api/v1/.well-known/oauth-protected-resource/mcp/public",
        })
      ).statusCode,
    ).toBe(404);
    const auth = await fastify.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
    });
    expect(auth.statusCode).toBe(200);
    expect(auth.json()).toMatchObject({
      authorization_endpoint: "https://mcp.holymedia.kz/oauth/authorize",
      token_endpoint: "https://mcp.holymedia.kz/oauth/token",
    });
    const authorize = await fastify.inject({
      method: "GET",
      url: "/oauth/authorize?client_id=public-test",
    });
    expect(authorize.statusCode).toBe(302);
    expect(authorize.headers.location).toContain("/auth?oauth_transaction=");
    expect(
      (
        await fastify.inject({
          method: "GET",
          url: "/api/v1/oauth/authorize?client_id=public-test",
        })
      ).statusCode,
    ).toBe(404);
    const token = await fastify.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/json" },
      payload: { client_id: "public-test", grant_type: "authorization_code" },
    });
    expect(token.statusCode).toBe(201);
    expect(token.json().token_type).toBe("Bearer");
  });
});

import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuditService } from "../audit/audit.service.js";
import { CsrfGuard } from "../auth/csrf.guard.js";
import { BillingService } from "../billing/billing.service.js";
import { configureApiRouting } from "../configure-api-routing.js";
import { ServiceTokenService } from "../service-tokens/service-token.service.js";
import { McpController } from "./mcp.controller.js";
import { McpPublicWriteService } from "./mcp-public-write.service.js";
import { McpService } from "./mcp.service.js";
import { OAuthAuthorizationService } from "./oauth-authorization.service.js";

const localOrigin = "https://local.example.test";
const tools = McpService.prototype.tools.call({} as McpService);
const publicWriteCall = vi.fn();

@Module({
  controllers: [McpController],
  providers: [
    CsrfGuard,
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: McpService, useValue: { tools: () => tools, call: vi.fn() } },
    {
      provide: ServiceTokenService,
      useValue: {
        authenticate: async (token: string) =>
          token === "legacy-read"
            ? {
                kind: "service",
                tokenId: "service-token-id",
                serviceIdentityId: "service-identity-id",
                workspaceId: "workspace-id",
                scopes: ["adforge:mcp:read"],
                accountIds: [],
              }
            : null,
      },
    },
    {
      provide: OAuthAuthorizationService,
      useValue: {
        authenticate: async (token: string, resource?: string) =>
          token === "local-read" && resource === `${localOrigin}/mcp/public`
            ? {
                kind: "oauth",
                tokenId: "oauth-token-id",
                userId: "user-id",
                clientId: "client-id",
                grantId: "grant-id",
                workspaceId: "workspace-id",
                resource,
                scopes: ["adforge:mcp:read"],
                accountIds: [],
              }
            : null,
      },
    },
    { provide: BillingService, useValue: { consumeMcpRequest: vi.fn() } },
    { provide: AuditService, useValue: { record: vi.fn() } },
    { provide: McpPublicWriteService, useValue: { call: publicWriteCall } },
  ],
})
class LocalMcpBoundaryModule {}

describe("local MCP HTTP tool boundary", () => {
  let app: NestFastifyApplication;
  const previousBaseUrl = process.env.HOLYMEDIA_PUBLIC_BASE_URL;

  beforeAll(async () => {
    process.env.HOLYMEDIA_PUBLIC_BASE_URL = localOrigin;
    app = await NestFactory.create<NestFastifyApplication>(
      LocalMcpBoundaryModule,
      new FastifyAdapter(),
      { logger: false },
    );
    configureApiRouting(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    if (previousBaseUrl === undefined)
      delete process.env.HOLYMEDIA_PUBLIC_BASE_URL;
    else process.env.HOLYMEDIA_PUBLIC_BASE_URL = previousBaseUrl;
  });

  async function request(path: string, token: string | null, method: string) {
    return app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url: path,
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        payload: { jsonrpc: "2.0", id: 1, method },
      });
  }

  it("keeps legacy and public initialization separate", async () => {
    const legacy = await request("/mcp", "legacy-read", "initialize");
    expect(legacy.statusCode).toBe(200);
    expect(legacy.json().result.protocolVersion).toBe("2025-03-26");

    const anonymous = await request("/mcp/public", null, "initialize");
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.headers["www-authenticate"]).toContain(
      `${localOrigin}/.well-known/oauth-protected-resource/mcp/public`,
    );
    expect(
      (await request("/mcp/public", "legacy-read", "initialize")).statusCode,
    ).toBe(401);

    const publicRead = await request("/mcp/public", "local-read", "initialize");
    expect(publicRead.statusCode).toBe(200);
    expect(publicRead.json().result.protocolVersion).toBe("2025-03-26");
  });

  it("lists current Google reads on both routes without exposing public legacy writes", async () => {
    const legacy = await request("/mcp", "legacy-read", "tools/list");
    const publicRead = await request("/mcp/public", "local-read", "tools/list");
    expect(legacy.statusCode).toBe(200);
    expect(publicRead.statusCode).toBe(200);
    const expectedGoogleReads = [
      "google_ads_list_keywords",
      "google_ads_search_terms",
      "google_ads_list_negatives",
      "google_ads_check_negative_conflicts",
    ];
    for (const response of [legacy, publicRead]) {
      const names = response
        .json()
        .result.tools.map((tool: { name: string }) => tool.name);
      expect(names).toEqual(expect.arrayContaining(expectedGoogleReads));
    }
    const publicNames = publicRead
      .json()
      .result.tools.map((tool: { name: string }) => tool.name);
    expect(publicNames).not.toContain("confirm_preview");
    expect(publicNames).not.toContain("commit_preview");
    expect(publicWriteCall).not.toHaveBeenCalled();
  });
});

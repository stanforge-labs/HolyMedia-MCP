import "reflect-metadata";
import { Module } from "@nestjs/common";
import { APP_GUARD, NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import cookie from "@fastify/cookie";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthenticationGuard } from "../auth/authentication.guard.js";
import { CsrfGuard } from "../auth/csrf.guard.js";
import { SessionService } from "../auth/session.service.js";
import { configureApiRouting } from "../configure-api-routing.js";
import { McpPublicApprovalController } from "./mcp-public-approval.controller.js";
import { McpPublicWriteService } from "./mcp-public-write.service.js";

const view = vi.fn(async () => ({
  provider: "Meta Ads",
  account: "Account",
  campaign: "Campaign",
  operation: "META_CAMPAIGN_PAUSE",
  field: "status",
  before: "ACTIVE",
  after: "PAUSED",
  approved: false,
  expires_at: new Date(Date.now() + 60_000).toISOString(),
}));
const decide = vi.fn(async (_principal, _nonce, decision: string) => ({
  status: decision === "approve" ? "approved" : "cancelled",
}));

@Module({
  controllers: [McpPublicApprovalController],
  providers: [
    AuthenticationGuard,
    CsrfGuard,
    {
      provide: SessionService,
      useValue: {
        extractToken: (request: { cookies?: Record<string, string> }) =>
          request.cookies?.hm_v2_session,
        validate: async (token: string) =>
          token === "valid-session"
            ? { id: "session-a", userId: "user-a" }
            : null,
      },
    },
    {
      provide: McpPublicWriteService,
      useValue: { approvalView: view, decideApproval: decide },
    },
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
class ApprovalHttpTestModule {}

describe("browser approval HTTP boundary", () => {
  let app: NestFastifyApplication;
  const token = `hmap_${"a".repeat(43)}`;
  const url = "/api/v1/mcp/public/approval";
  const cookies = "hm_v2_session=valid-session; hm_v2_csrf=csrf-test";

  beforeAll(async () => {
    app = await NestFactory.create<NestFastifyApplication>(
      ApprovalHttpTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.register(cookie);
    configureApiRouting(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("never accepts a nonce in GET query and keeps view display-only", async () => {
    const fastify = app.getHttpAdapter().getInstance();
    decide.mockClear();
    const legacyGet = await fastify.inject({
      method: "GET",
      url: `${url}?approval=${token}`,
      headers: { cookie: cookies },
    });
    expect(legacyGet.statusCode).toBe(404);
    const anonymous = await fastify.inject({
      method: "POST",
      url: `${url}/view`,
      payload: { approval_nonce: token },
    });
    expect([401, 403]).toContain(anonymous.statusCode);
    const result = await fastify.inject({
      method: "POST",
      url: `${url}/view`,
      headers: { cookie: cookies, "x-csrf-token": "csrf-test" },
      payload: { approval_nonce: token },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ before: "ACTIVE", after: "PAUSED" });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["referrer-policy"]).toBe("no-referrer");
    expect(view).toHaveBeenCalledWith(
      { kind: "human", userId: "user-a", sessionId: "session-a" },
      token,
    );
    expect(decide).not.toHaveBeenCalled();
  });

  it("denies bearer-only, missing session, missing CSRF and wrong CSRF", async () => {
    const fastify = app.getHttpAdapter().getInstance();
    decide.mockClear();
    const payload = { approval_nonce: token, decision: "approve" };
    for (const headers of [
      { authorization: "Bearer oauth-access" },
      { "x-csrf-token": "csrf-test" },
      { cookie: cookies },
      { cookie: cookies, "x-csrf-token": "wrong" },
      {
        cookie: cookies,
        "x-csrf-token": "csrf-test",
        origin: "https://evil.example",
      },
    ]) {
      for (const path of [url, `${url}/view`]) {
        const result = await fastify.inject({
          method: "POST",
          url: path,
          headers,
          payload,
        });
        expect([401, 403]).toContain(result.statusCode);
      }
    }
    expect(decide).not.toHaveBeenCalled();
  });

  it("accepts only session plus CSRF on POST", async () => {
    const result = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url,
        headers: { cookie: cookies, "x-csrf-token": "csrf-test" },
        payload: { approval_nonce: token, decision: "approve" },
      });
    expect(result.statusCode).toBe(201);
    expect(result.json()).toEqual({ status: "approved" });
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["referrer-policy"]).toBe("no-referrer");
    expect(decide).toHaveBeenCalledWith(
      { kind: "human", userId: "user-a", sessionId: "session-a" },
      token,
      "approve",
    );
  });

  it("requires the same session and CSRF for explicit cancellation", async () => {
    const result = await app
      .getHttpAdapter()
      .getInstance()
      .inject({
        method: "POST",
        url,
        headers: { cookie: cookies, "x-csrf-token": "csrf-test" },
        payload: { approval_nonce: token, decision: "cancel" },
      });
    expect(result.statusCode).toBe(201);
    expect(result.json()).toEqual({ status: "cancelled" });
    expect(decide).toHaveBeenCalledWith(
      { kind: "human", userId: "user-a", sessionId: "session-a" },
      token,
      "cancel",
    );
  });
});

import { RequestMethod } from "@nestjs/common";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

/** Shared by the production bootstrap and the HTTP route regression test. */
export function configureApiRouting(app: NestFastifyApplication): void {
  app.setGlobalPrefix("api/v1", {
    exclude: [
      { path: "health", method: RequestMethod.GET },
      { path: "ready", method: RequestMethod.GET },
      { path: "mcp", method: RequestMethod.GET },
      { path: "mcp", method: RequestMethod.POST },
      { path: "mcp/public", method: RequestMethod.GET },
      { path: "mcp/public", method: RequestMethod.POST },
      { path: "api/auth", method: RequestMethod.ALL },
      { path: "api/auth/(.*)", method: RequestMethod.ALL },
      { path: "api/me", method: RequestMethod.ALL },
      { path: "api/me/(.*)", method: RequestMethod.ALL },
      { path: "api/mcp-token", method: RequestMethod.ALL },
      { path: "api/mcp-token/(.*)", method: RequestMethod.ALL },
      { path: "api/mcp-oauth-client", method: RequestMethod.ALL },
      { path: "api/mcp-oauth-client/(.*)", method: RequestMethod.ALL },
      { path: "api/hosted", method: RequestMethod.ALL },
      { path: "api/hosted/(.*)", method: RequestMethod.ALL },
      { path: "api/meta/skills", method: RequestMethod.ALL },
      { path: "api/meta/skills/(.*)", method: RequestMethod.ALL },
      { path: "api/site", method: RequestMethod.ALL },
      { path: "api/site/(.*)", method: RequestMethod.ALL },
      { path: "api/seo", method: RequestMethod.ALL },
      { path: "api/seo/(.*)", method: RequestMethod.ALL },
      { path: "oauth/authorize", method: RequestMethod.GET },
      { path: "oauth/authorize/continue", method: RequestMethod.GET },
      { path: "oauth/authorize/transaction", method: RequestMethod.GET },
      { path: "oauth/authorize/consent", method: RequestMethod.POST },
      { path: "oauth/register", method: RequestMethod.POST },
      { path: "oauth/revoke", method: RequestMethod.POST },
      { path: "oauth/token", method: RequestMethod.POST },
      { path: "auth/google/start", method: RequestMethod.GET },
      { path: "auth/google/callback", method: RequestMethod.GET },
      {
        path: ".well-known/oauth-protected-resource",
        method: RequestMethod.GET,
      },
      {
        path: ".well-known/oauth-protected-resource/mcp",
        method: RequestMethod.GET,
      },
      {
        path: ".well-known/oauth-protected-resource/mcp/public",
        method: RequestMethod.GET,
      },
      {
        path: ".well-known/oauth-authorization-server",
        method: RequestMethod.GET,
      },
      { path: "api/profile", method: RequestMethod.ALL },
      { path: "api/profile/(.*)", method: RequestMethod.ALL },
      { path: "api/connection-requests", method: RequestMethod.ALL },
      { path: "api/connection-requests/(.*)", method: RequestMethod.ALL },
      { path: "api/diagnostics", method: RequestMethod.ALL },
      { path: "api/diagnostics/(.*)", method: RequestMethod.ALL },
      { path: "api/beta/capabilities", method: RequestMethod.ALL },
      // Existing V1 OAuth callbacks must remain root-relative after cutover.
      { path: "oauth/:provider/callback", method: RequestMethod.GET },
    ],
  });
}

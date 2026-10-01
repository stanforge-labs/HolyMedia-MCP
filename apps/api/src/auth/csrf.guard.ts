import { timingSafeEqual } from "node:crypto";
import { ForbiddenException, Injectable } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import type { RequestWithAuth } from "./auth.types.js";
import { CSRF_COOKIE } from "./auth.types.js";

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly origins = loadConfig().corsOrigins;

  public canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    if (
      ["GET", "HEAD", "OPTIONS"].includes(
        String(request.headers[":method"] ?? ""),
      )
    )
      return true;
    const method = String(
      (request as unknown as { method?: string }).method ?? "GET",
    ).toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

    // OAuth token exchange and public dynamic registration are machine-to-
    // machine endpoints. They do not use browser session cookies; their
    // protections are redirect URI binding, one-time codes and PKCE.
    const url = String((request as unknown as { url?: string }).url ?? "");
    const requestPath = url.split("?")[0];
    const browserApproval =
      method === "POST" &&
      [
        "/api/v1/mcp/public/approval",
        "/api/v1/mcp/public/approval/view",
      ].includes(requestPath ?? "");
    if (
      method === "POST" &&
      (requestPath === "/mcp" ||
        ["/oauth/token", "/oauth/register", "/oauth/revoke"].some((path) =>
          requestPath?.endsWith(path),
        ))
    ) {
      return true;
    }

    // Bearer-authenticated machine clients do not send browser cookies, so a
    // cookie CSRF proof would reject MCP and other server-to-server calls.
    // Their protection is the bearer token itself, CORS for browser callers,
    // and the endpoint's server-side authorization checks.
    const authorization = this.header(request, "authorization");
    if (browserApproval && authorization)
      throw new ForbiddenException("Browser approval requires a web session.");
    if (
      !browserApproval &&
      authorization &&
      /^Bearer\s+\S+$/i.test(authorization)
    )
      return true;

    const origin = this.header(request, "origin");
    if (origin && !this.origins.includes(origin)) {
      throw new ForbiddenException("CSRF validation failed.");
    }
    const cookieToken = request.cookies?.[CSRF_COOKIE];
    const headerToken = this.header(request, "x-csrf-token");
    if (!cookieToken || !headerToken || !sameToken(cookieToken, headerToken)) {
      throw new ForbiddenException("CSRF validation failed.");
    }
    return true;
  }

  private header(request: RequestWithAuth, name: string): string | undefined {
    const value = request.headers[name];
    return Array.isArray(value) ? value[0] : value;
  }
}

function sameToken(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

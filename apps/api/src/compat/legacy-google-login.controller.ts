import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  Query,
  Redirect,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { loadConfig } from "@holymedia/config";
import type { FastifyReply } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { AuthService } from "../auth/auth.service.js";
import {
  GOOGLE_LOGIN_STATE_COOKIE,
  GoogleLoginFailure,
  GoogleLoginService,
} from "../auth/google-login.service.js";
import { cookieReply, CookieService } from "../auth/cookie.service.js";
import type { RequestWithAuth } from "../auth/auth.types.js";

/** V1 Google Login paths retained for the in-place V2 cutover. */
@Controller("auth/google")
export class LegacyGoogleLoginController {
  private readonly config = loadConfig();

  public constructor(
    @Inject(GoogleLoginService) private readonly google: GoogleLoginService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CookieService) private readonly cookies: CookieService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get("start")
  @Redirect()
  public async start(
    @Query("oauth_transaction") oauthTransaction: string | undefined,
    @Query("next") next: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.google.start(
      oauthTransaction
        ? `/oauth/authorize/continue?transaction=${encodeURIComponent(oauthTransaction)}`
        : next,
    );
    cookieReply(reply).setCookie(GOOGLE_LOGIN_STATE_COOKIE, result.state, {
      ...this.cookieOptions(),
      httpOnly: true,
      maxAge: this.google.stateTtlSeconds(),
    });
    return { url: result.authorizationUrl, statusCode: 302 };
  }

  @Get("callback")
  @Redirect()
  public async callback(
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") error: string | undefined,
    @Req() request: RequestWithAuth,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (error || !code || !state) {
      if (this.config.qrsTestRestrictedAuth)
        return this.loginErrorRedirect("google_oauth", request, reply);
      throw new BadRequestException("Google Login was not completed.");
    }
    if (
      !this.google.stateMatchesCookie(
        state,
        request.cookies?.[GOOGLE_LOGIN_STATE_COOKIE],
      )
    ) {
      if (this.config.qrsTestRestrictedAuth)
        return this.loginErrorRedirect("state_cookie_mismatch", request, reply);
      throw new BadRequestException("Google Login session is invalid.");
    }
    let stateResult: Awaited<ReturnType<GoogleLoginService["consumeState"]>>;
    try {
      stateResult = await this.google.consumeState(state);
    } catch (caught) {
      if (
        this.config.qrsTestRestrictedAuth &&
        caught instanceof BadRequestException
      )
        return this.loginErrorRedirect("state_expired", request, reply);
      throw caught;
    }
    let profile: Awaited<ReturnType<GoogleLoginService["exchangeCode"]>>;
    try {
      profile = await this.google.exchangeCode(code);
    } catch (caught) {
      if (
        this.config.qrsTestRestrictedAuth &&
        caught instanceof BadRequestException
      )
        return this.loginErrorRedirect(
          caught instanceof GoogleLoginFailure ? caught.stage : "userinfo",
          request,
          reply,
        );
      throw caught;
    }
    let result: Awaited<ReturnType<AuthService["loginWithGoogle"]>>;
    try {
      result = await this.auth.loginWithGoogle(profile, request);
    } catch (caught) {
      if (
        this.config.qrsTestRestrictedAuth &&
        caught instanceof UnauthorizedException
      )
        return this.loginErrorRedirect("test_access_denied", request, reply);
      throw caught;
    }
    this.cookies.setSession(reply, result.sessionToken);
    cookieReply(reply).clearCookie(
      GOOGLE_LOGIN_STATE_COOKIE,
      this.cookieOptions(),
    );
    return {
      url: this.returnUrl(
        result.onboardingRequired ? "/onboarding" : stateResult.nextPath,
      ),
      statusCode: 302,
    };
  }

  private async loginErrorRedirect(
    reason: string,
    request: RequestWithAuth,
    reply: FastifyReply,
  ) {
    await this.audit.record({
      eventType: "google_login_callback_failure",
      success: false,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: { reason },
    });
    cookieReply(reply).clearCookie(
      GOOGLE_LOGIN_STATE_COOKIE,
      this.cookieOptions(),
    );
    const userFacingError =
      reason === "state_cookie_mismatch" || reason === "state_expired"
        ? "google_session"
        : reason === "test_access_denied"
          ? "google_access"
          : reason === "google_oauth"
            ? "google_oauth"
            : "google_provider";
    return {
      url: this.returnUrl(`/auth?error=${userFacingError}`),
      statusCode: 302,
    };
  }

  private returnUrl(path: string): string {
    // Local TEST splits Web and API across two loopback ports. Relative
    // callback redirects would otherwise land on the API's nonexistent /auth.
    return this.config.qrsTestLocalReadonlyAuth
      ? new URL(path, this.config.publicBaseUrl).toString()
      : path;
  }

  private cookieOptions() {
    return {
      path: "/",
      secure:
        this.config.environment !== "development" &&
        this.config.environment !== "test",
      sameSite: "lax" as const,
      ...(this.config.cookieDomain ? { domain: this.config.cookieDomain } : {}),
    };
  }
}

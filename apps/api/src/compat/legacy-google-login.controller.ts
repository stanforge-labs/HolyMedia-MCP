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
import { AuthService } from "../auth/auth.service.js";
import {
  GOOGLE_LOGIN_STATE_COOKIE,
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
      if (this.config.qrsTestRestrictedAuth) return this.loginErrorRedirect();
      throw new BadRequestException("Google Login was not completed.");
    }
    if (
      !this.google.stateMatchesCookie(
        state,
        request.cookies?.[GOOGLE_LOGIN_STATE_COOKIE],
      )
    ) {
      if (this.config.qrsTestRestrictedAuth) return this.loginErrorRedirect();
      throw new BadRequestException("Google Login session is invalid.");
    }
    let stateResult: Awaited<ReturnType<GoogleLoginService["consumeState"]>>;
    let result: Awaited<ReturnType<AuthService["loginWithGoogle"]>>;
    try {
      stateResult = await this.google.consumeState(state);
      const profile = await this.google.exchangeCode(code);
      result = await this.auth.loginWithGoogle(profile, request);
    } catch (caught) {
      if (
        this.config.qrsTestRestrictedAuth &&
        (caught instanceof BadRequestException ||
          caught instanceof UnauthorizedException)
      ) {
        return this.loginErrorRedirect();
      }
      throw caught;
    }
    this.cookies.setSession(reply, result.sessionToken);
    cookieReply(reply).clearCookie(
      GOOGLE_LOGIN_STATE_COOKIE,
      this.cookieOptions(),
    );
    return {
      url: result.onboardingRequired ? "/onboarding" : stateResult.nextPath,
      statusCode: 302,
    };
  }

  private loginErrorRedirect() {
    return { url: "/auth?error=google_login", statusCode: 302 };
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

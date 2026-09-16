import { timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { DatabaseService } from "../infrastructure/database.service.js";
import {
  createOpaqueToken,
  digestToken,
} from "../infrastructure/security.utils.js";

export const GOOGLE_LOGIN_STATE_COOKIE = "hm_v2_google_login_state";

export type GoogleLoginProfile = {
  email: string;
  name: string;
};

export type GoogleLoginStart = {
  authorizationUrl: string;
  state: string;
};

@Injectable()
export class GoogleLoginService {
  private readonly config: AppConfig = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  public configured(): boolean {
    return Boolean(
      this.config.providerGoogleLoginClientId &&
      this.config.providerGoogleLoginClientSecret,
    );
  }

  public stateTtlSeconds(): number {
    return 900;
  }

  public async start(nextPath = "/dashboard"): Promise<GoogleLoginStart> {
    if (!this.configured()) {
      throw new ServiceUnavailableException("Google Login is not configured.");
    }

    const state = createOpaqueToken();
    const safeNextPath = normalizeNextPath(nextPath);
    await this.database.client.googleLoginState.create({
      data: {
        stateDigest: digestToken(state, this.config.sessionHashSecret),
        nextPath: safeNextPath,
        expiresAt: new Date(Date.now() + this.stateTtlSeconds() * 1000),
      },
    });

    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", this.config.providerGoogleLoginClientId!);
    url.searchParams.set("redirect_uri", this.redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set(
      "scope",
      this.config.providerGoogleLoginScopes || "openid email profile",
    );
    url.searchParams.set("state", state);
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
    return { authorizationUrl: url.toString(), state };
  }

  public async consumeState(state: string): Promise<{ nextPath: string }> {
    const normalized = state.trim();
    if (!normalized || normalized.length > 512) {
      throw new BadRequestException("Google Login session is invalid.");
    }
    const record = await this.database.client.googleLoginState.findUnique({
      where: {
        stateDigest: digestToken(normalized, this.config.sessionHashSecret),
      },
      select: { id: true, expiresAt: true, consumedAt: true, nextPath: true },
    });
    if (!record || record.consumedAt || record.expiresAt <= new Date()) {
      throw new BadRequestException(
        "Google Login session is invalid or expired.",
      );
    }
    const consumed = await this.database.client.googleLoginState.updateMany({
      where: {
        id: record.id,
        consumedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new BadRequestException(
        "Google Login session is invalid or expired.",
      );
    }
    return { nextPath: normalizeNextPath(record.nextPath) };
  }

  public async exchangeCode(code: string): Promise<GoogleLoginProfile> {
    if (!this.configured()) {
      throw new ServiceUnavailableException("Google Login is not configured.");
    }
    const normalizedCode = code.trim();
    if (!normalizedCode || normalizedCode.length > 4096) {
      throw new BadRequestException(
        "Google did not return an authorization code.",
      );
    }
    let tokenPayload: Record<string, unknown>;
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.config.providerGoogleLoginClientId!,
          client_secret: this.config.providerGoogleLoginClientSecret!,
          code: normalizedCode,
          grant_type: "authorization_code",
          redirect_uri: this.redirectUri(),
        }),
        signal: AbortSignal.timeout(this.config.providerHttpTimeoutMs),
      });
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object") {
        throw new Error("token_exchange_failed");
      }
      tokenPayload = payload as Record<string, unknown>;
    } catch {
      throw new BadRequestException(
        "Google authorization could not be completed.",
      );
    }

    const accessToken =
      typeof tokenPayload.access_token === "string"
        ? tokenPayload.access_token.trim()
        : "";
    if (!accessToken || accessToken.length > 4096) {
      throw new BadRequestException(
        "Google authorization could not be completed.",
      );
    }

    try {
      const response = await fetch(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(this.config.providerHttpTimeoutMs),
        },
      );
      const payload: unknown = await response.json();
      if (!response.ok || !payload || typeof payload !== "object") {
        throw new Error("userinfo_failed");
      }
      const profile = payload as Record<string, unknown>;
      const email =
        typeof profile.email === "string"
          ? profile.email.trim().toLowerCase()
          : "";
      const name = typeof profile.name === "string" ? profile.name.trim() : "";
      if (!email.includes("@") || profile.email_verified === false) {
        throw new Error("invalid_profile");
      }
      return { email, name: name || email };
    } catch {
      throw new BadRequestException(
        "Google account profile could not be read.",
      );
    }
  }

  public stateMatchesCookie(
    state: string,
    cookieState: string | undefined,
  ): boolean {
    if (!cookieState || state.length !== cookieState.length) return false;
    return timingSafeEqual(Buffer.from(state), Buffer.from(cookieState));
  }

  public redirectUri(): string {
    return (
      this.config.providerGoogleLoginRedirectUri ??
      `http://localhost:${this.config.apiPort}/auth/google/callback`
    );
  }
}

function normalizeNextPath(value: string): string {
  try {
    const dashboard = new URL(value, "https://mcp.holymedia.kz");
    if (
      dashboard.origin === "https://mcp.holymedia.kz" &&
      /^\/(?:en\/)?dashboard(?:\/(?:overview|connections|ai-client|reports|tariffs|profile|analysis))?$/.test(
        dashboard.pathname,
      )
    ) {
      return `${dashboard.pathname}${dashboard.search}${dashboard.hash}`;
    }
  } catch {
    // Continue with the non-dashboard continuation check below.
  }
  try {
    const url = new URL(value, "https://mcp.holymedia.kz");
    const transaction = url.searchParams.get("transaction") ?? "";
    if (
      url.origin === "https://mcp.holymedia.kz" &&
      url.pathname === "/oauth/authorize/continue" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        transaction,
      )
    ) {
      return `${url.pathname}?transaction=${encodeURIComponent(transaction)}`;
    }
  } catch {
    // Fall through to the safe default.
  }
  return "/dashboard";
}

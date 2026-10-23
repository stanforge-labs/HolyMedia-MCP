import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { loadConfig, type AppConfig } from "@holymedia/config";
import { AuditService } from "../audit/audit.service.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import { RedisRateLimitService } from "../infrastructure/redis-rate-limit.service.js";
import {
  createOpaqueToken,
  createSlug,
  digestToken,
  hashIp,
  normalizeEmail,
} from "../infrastructure/security.utils.js";
import { EmailService } from "./email.service.js";
import type {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  SignupDto,
  VerifyEmailDto,
} from "./auth.dto.js";
import type { HumanPrincipal, RequestWithAuth } from "./auth.types.js";
import { PasswordService } from "./password.service.js";
import { SessionService } from "./session.service.js";
import type { GoogleLoginProfile } from "./google-login.service.js";

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
};

export type AuthResult = {
  user: PublicUser;
  sessionToken: string;
  sessionId: string;
  workspace?: {
    id: string;
    name: string;
    slug: string;
    accessStatus: "PENDING" | "ACTIVE" | "SUSPENDED";
  };
  onboardingRequired?: boolean;
};

const GENERIC_RESET_MESSAGE =
  "Если аккаунт существует, инструкции отправлены на электронную почту.";

@Injectable()
export class AuthService {
  private readonly config: AppConfig = loadConfig();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(EmailService) private readonly emails: EmailService,
    @Inject(RedisRateLimitService)
    private readonly limits: RedisRateLimitService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  public async signup(
    input: SignupDto,
    request: RequestWithAuth,
  ): Promise<AuthResult> {
    if (input.password !== input.confirmPassword) {
      throw new BadRequestException("Passwords do not match.");
    }
    const email = normalizeEmail(input.email);
    await this.limit("signup", request, email, 5, 900);
    const passwordHash = await this.passwords.hash(input.password);
    const existing = await this.database.client.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existing) {
      await this.record({
        eventType: "signup",
        success: false,
        request,
        metadata: { reason: "duplicate_email" },
      });
      throw new ConflictException(
        "Unable to create account with these details.",
      );
    }

    const result = await this.database.client.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, name: input.name.trim(), passwordHash },
      });
      const workspace = await tx.workspace.create({
        data: {
          name: `${input.name.trim()} workspace`,
          slug: `${createSlug(input.name)}-${createOpaqueToken().slice(0, 8)}`,
        },
      });
      await tx.workspaceMembership.create({
        data: { userId: user.id, workspaceId: workspace.id, role: "OWNER" },
      });
      return { user, workspace };
    });

    const verificationToken = createOpaqueToken();
    await this.database.client.emailVerification.create({
      data: {
        userId: result.user.id,
        tokenDigest: digestToken(
          verificationToken,
          this.config.sessionHashSecret,
        ),
        expiresAt: this.expiresInMinutes(),
      },
    });
    await this.emails.sendVerification(email, verificationToken);
    const session = await this.sessions.create(result.user.id, request);
    await this.record({
      eventType: "signup",
      request,
      actorUserId: result.user.id,
      workspaceId: result.workspace.id,
    });
    return {
      user: this.publicUser(result.user),
      sessionToken: session.token,
      sessionId: session.session.id,
      workspace: {
        id: result.workspace.id,
        name: result.workspace.name,
        slug: result.workspace.slug,
        accessStatus: result.workspace.accessStatus,
      },
      onboardingRequired: true,
    };
  }

  public async login(
    input: LoginDto,
    request: RequestWithAuth,
  ): Promise<AuthResult> {
    const email = normalizeEmail(input.email);
    await this.limit("login", request, email, 10, 300);
    const user = await this.database.client.user.findUnique({
      where: { email },
    });
    if (
      !user ||
      user.status !== "active" ||
      !(await this.passwords.verify(user.passwordHash, input.password))
    ) {
      await this.record({
        eventType: "login_failure",
        success: false,
        request,
        metadata: { reason: "invalid_credentials" },
      });
      throw new UnauthorizedException("Invalid email or password.");
    }
    if (this.passwords.needsRehash(user.passwordHash)) {
      await this.database.client.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(input.password) },
      });
    }
    const session = await this.sessions.create(user.id, request);
    await this.record({
      eventType: "login_success",
      request,
      actorUserId: user.id,
    });
    const membership = await this.database.client.workspaceMembership.findFirst(
      {
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: {
          workspace: {
            select: {
              id: true,
              name: true,
              slug: true,
              accessStatus: true,
              onboardingCompletedAt: true,
            },
          },
        },
      },
    );
    return {
      user: this.publicUser(user),
      sessionToken: session.token,
      sessionId: session.session.id,
      ...(membership ? { workspace: membership.workspace } : {}),
      ...(membership?.workspace.accessStatus === "PENDING" &&
      !membership.workspace.onboardingCompletedAt
        ? { onboardingRequired: true }
        : {}),
    };
  }

  public async loginWithGoogle(
    profile: GoogleLoginProfile,
    request: RequestWithAuth,
  ): Promise<AuthResult> {
    const email = normalizeEmail(profile.email);
    const name = profile.name.trim() || email;
    let user = await this.database.client.user.findUnique({
      where: { email },
    });

    if (!user) {
      const passwordHash = await this.passwords.hash(createOpaqueToken());
      const result = await this.database.client.$transaction(async (tx) => {
        const createdUser = await tx.user.create({
          data: {
            email,
            name,
            passwordHash,
            emailVerifiedAt: new Date(),
            emailVerifiedSource: "google_verified",
          },
        });
        const workspace = await tx.workspace.create({
          data: {
            name: `${name} workspace`,
            slug: `${createSlug(name)}-${createOpaqueToken().slice(0, 8)}`,
          },
        });
        await tx.workspaceMembership.create({
          data: {
            userId: createdUser.id,
            workspaceId: workspace.id,
            role: "OWNER",
          },
        });
        return { user: createdUser, workspace };
      });
      user = result.user;
    } else if (user.status !== "active") {
      throw new UnauthorizedException("Account is not active.");
    } else if (!user.emailVerifiedAt || !user.emailVerifiedSource) {
      user = await this.database.client.user.update({
        where: { id: user.id },
        data: {
          emailVerifiedAt: new Date(),
          emailVerifiedSource: "google_verified",
        },
      });
    }

    const session = await this.sessions.create(user.id, request);
    const membership = await this.database.client.workspaceMembership.findFirst(
      {
        where: { userId: user.id },
        orderBy: { createdAt: "asc" },
        select: {
          workspace: {
            select: {
              id: true,
              name: true,
              slug: true,
              accessStatus: true,
              onboardingCompletedAt: true,
            },
          },
        },
      },
    );
    await this.record({
      eventType: "login_success",
      request,
      actorUserId: user.id,
      metadata: { method: "google" },
    });
    return {
      user: this.publicUser(user),
      sessionToken: session.token,
      sessionId: session.session.id,
      ...(membership ? { workspace: membership.workspace } : {}),
      ...(membership?.workspace.accessStatus === "PENDING" &&
      !membership.workspace.onboardingCompletedAt
        ? { onboardingRequired: true }
        : {}),
    };
  }

  public async forgotPassword(
    input: ForgotPasswordDto,
    request: RequestWithAuth,
  ): Promise<{ message: string }> {
    const email = normalizeEmail(input.email);
    await this.limit("forgot_password", request, email, 5, 900);
    const user = await this.database.client.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (user) {
      const token = createOpaqueToken();
      await this.database.client.passwordReset.create({
        data: {
          userId: user.id,
          tokenDigest: digestToken(token, this.config.sessionHashSecret),
          expiresAt: this.expiresInMinutes(),
        },
      });
      await this.emails.sendPasswordReset(user.email, token);
      await this.record({
        eventType: "password_reset_requested",
        request,
        actorUserId: user.id,
      });
    } else {
      await this.record({
        eventType: "password_reset_requested",
        success: true,
        request,
        metadata: { account: "not_found" },
      });
    }
    return { message: GENERIC_RESET_MESSAGE };
  }

  public async resetPassword(
    input: ResetPasswordDto,
    request: RequestWithAuth,
  ): Promise<{ success: true }> {
    const reset = await this.database.client.passwordReset.findUnique({
      where: {
        tokenDigest: digestToken(input.token, this.config.sessionHashSecret),
      },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date())
      throw new BadRequestException("Reset link is invalid or expired.");
    const passwordHash = await this.passwords.hash(input.password);
    await this.database.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: reset.userId },
        data: { passwordHash },
      });
      await tx.passwordReset.update({
        where: { id: reset.id },
        data: { usedAt: new Date() },
      });
      await tx.session.updateMany({
        where: { userId: reset.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
    await this.record({
      eventType: "password_changed",
      request,
      actorUserId: reset.userId,
    });
    return { success: true };
  }

  public async verifyEmail(
    input: VerifyEmailDto,
    request: RequestWithAuth,
  ): Promise<{ verified: true }> {
    const verification =
      await this.database.client.emailVerification.findUnique({
        where: {
          tokenDigest: digestToken(input.token, this.config.sessionHashSecret),
        },
      });
    if (
      !verification ||
      verification.usedAt ||
      verification.expiresAt <= new Date()
    )
      throw new BadRequestException("Verification link is invalid or expired.");
    await this.database.client.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: verification.userId },
        data: {
          emailVerifiedAt: new Date(),
          emailVerifiedSource: "email_link",
        },
      });
      await tx.emailVerification.update({
        where: { id: verification.id },
        data: { usedAt: new Date() },
      });
    });
    await this.record({
      eventType: "email_verified",
      request,
      actorUserId: verification.userId,
    });
    return { verified: true };
  }

  public async changePassword(
    input: ChangePasswordDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<AuthResult> {
    const user = await this.database.client.user.findUnique({
      where: { id: principal.userId },
    });
    if (
      !user ||
      !(await this.passwords.verify(user.passwordHash, input.currentPassword))
    )
      throw new UnauthorizedException("Current password is incorrect.");
    await this.database.client.user.update({
      where: { id: user.id },
      data: { passwordHash: await this.passwords.hash(input.newPassword) },
    });
    await this.sessions.revokeAll(user.id);
    const session = await this.sessions.create(user.id, request);
    await this.record({
      eventType: "password_changed",
      request,
      actorUserId: user.id,
    });
    return {
      user: this.publicUser(user),
      sessionToken: session.token,
      sessionId: session.session.id,
    };
  }

  public async currentUser(principal: HumanPrincipal): Promise<PublicUser> {
    const user = await this.database.client.user.findUnique({
      where: { id: principal.userId },
    });
    if (!user) throw new UnauthorizedException("Authentication required.");
    return this.publicUser(user);
  }

  public async updateProfile(
    principal: HumanPrincipal,
    name: string,
    request: RequestWithAuth,
  ): Promise<PublicUser> {
    const normalizedName = name.trim();
    const user = await this.database.client.user.update({
      where: { id: principal.userId },
      data: { name: normalizedName },
    });
    await this.record({
      eventType: "profile_updated",
      request,
      actorUserId: principal.userId,
    });
    return this.publicUser(user);
  }

  public async currentAvatar(
    principal: HumanPrincipal,
  ): Promise<{ dataUrl: string | null }> {
    const user = await this.database.client.user.findUnique({
      where: { id: principal.userId },
      select: { avatarData: true, avatarMimeType: true },
    });
    if (!user) throw new UnauthorizedException("Authentication required.");
    if (!user.avatarData || !user.avatarMimeType) return { dataUrl: null };
    return {
      dataUrl: `data:${user.avatarMimeType};base64,${Buffer.from(user.avatarData).toString("base64")}`,
    };
  }

  public async updateAvatar(
    principal: HumanPrincipal,
    input: { data: Buffer; mimeType: string },
    request: RequestWithAuth,
  ): Promise<{ dataUrl: string }> {
    await this.database.client.user.update({
      where: { id: principal.userId },
      data: {
        avatarData: Uint8Array.from(input.data),
        avatarMimeType: input.mimeType,
      },
    });
    await this.record({
      eventType: "profile_avatar_updated",
      request,
      actorUserId: principal.userId,
    });
    return {
      dataUrl: `data:${input.mimeType};base64,${input.data.toString("base64")}`,
    };
  }

  public async logout(
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<void> {
    await this.sessions.revoke(principal.sessionId);
    await this.record({
      eventType: "logout",
      request,
      actorUserId: principal.userId,
    });
  }

  public async logoutAll(
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ): Promise<void> {
    await this.sessions.revokeAll(principal.userId);
    await this.record({
      eventType: "logout_all",
      request,
      actorUserId: principal.userId,
    });
  }

  private publicUser(user: {
    id: string;
    email: string;
    name: string;
    emailVerifiedAt: Date | null;
  }): PublicUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      emailVerified: Boolean(user.emailVerifiedAt),
    };
  }

  private expiresInMinutes(): Date {
    return new Date(Date.now() + this.config.emailTokenTtlMinutes * 60_000);
  }

  private async limit(
    category: string,
    request: RequestWithAuth,
    email: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const ipKey =
      hashIp(request.ip, this.config.sessionHashSecret) ?? "unknown";
    const accountKey =
      hashIp(email, this.config.sessionHashSecret) ?? "unknown";
    await this.limits.consume(
      `v2:rl:${category}:ip:${ipKey}`,
      limit,
      windowSeconds,
    );
    await this.limits.consume(
      `v2:rl:${category}:account:${accountKey}`,
      limit,
      windowSeconds,
    );
  }

  private async record(input: {
    eventType: string;
    success?: boolean;
    request: RequestWithAuth;
    actorUserId?: string;
    workspaceId?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }): Promise<void> {
    await this.audit.record({
      eventType: input.eventType,
      ...(input.success === undefined ? {} : { success: input.success }),
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}),
      ...(input.request.requestId
        ? { requestId: input.request.requestId }
        : {}),
      ...(input.metadata ? { metadata: input.metadata } : {}),
    });
  }
}

import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { HumanPrincipal } from "../auth/auth.types.js";
import { loadConfig } from "@holymedia/config";
import { DatabaseService } from "../infrastructure/database.service.js";
import type { OAuthMcpPrincipal } from "./mcp-principal.js";
import {
  OAuthClientMetadataService,
  registrationMetadata,
} from "./oauth-client-metadata.service.js";
import { oauthEndpoints } from "./oauth-endpoints.js";
import {
  oidcActiveKey,
  signIdToken,
  verifiedEmailClaim,
} from "./oidc-identity.js";

export const MCP_READ_SCOPE = "adforge:mcp:read";
export const MCP_WRITE_SCOPE = "adforge:mcp:write";

const TRANSACTION_TTL_MS = 10 * 60_000;
const CODE_TTL_MS = 3 * 60_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

export type OAuthAuthorizationContextView = {
  transactionId: string;
  client: { id: string; name: string };
  scope: string;
  resource: string;
  workspaces: Array<{ id: string; name: string; role: string }>;
  selectedWorkspaceId: string | null;
  expiresAt: string;
};

@Injectable()
export class OAuthAuthorizationService {
  private readonly writeScopeEnabled = loadConfig().publicMcpWriteScopeEnabled;
  private readonly endpoints = oauthEndpoints();

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(OAuthClientMetadataService)
    private readonly clientMetadata: OAuthClientMetadataService,
  ) {}

  public async registerPublicClient(input: Record<string, unknown>) {
    const metadata = registrationMetadata(input);
    const clientId = `hm_public_${randomBytes(24).toString("base64url")}`;
    const client = await this.database.client.oAuthPublicClient.create({
      data: {
        clientId,
        clientName: metadata.client_name,
        redirectUris: metadata.redirect_uris,
        scope: metadata.scope,
        tokenEndpointAuthMethod: "none",
        applicationType: metadata.application_type,
        registrationSource: "dcr",
      },
    });
    return {
      client_id: client.clientId,
      client_name: client.clientName,
      redirect_uris: metadata.redirect_uris,
      grant_types: metadata.grant_types,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: metadata.application_type,
      scope: client.scope,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    };
  }

  public async isPublicClient(clientId: string): Promise<boolean> {
    if (!clientId) return false;
    return Boolean(await this.publicClient(clientId));
  }

  public async beginAuthorization(
    input: Record<string, unknown>,
    principal?: HumanPrincipal,
  ) {
    const clientId = required(input.client_id, "client_id");
    const redirectUri = required(input.redirect_uri, "redirect_uri");
    const responseType = required(input.response_type, "response_type");
    const codeChallenge = required(input.code_challenge, "code_challenge");
    const method = required(
      input.code_challenge_method,
      "code_challenge_method",
    );
    const resource =
      stringValue(input.resource) || this.endpoints.legacyResource;
    if (responseType !== "code") {
      throw new BadRequestException("Only response_type=code is supported.");
    }
    if (method !== "S256" || !validPkceChallenge(codeChallenge)) {
      throw new BadRequestException("A valid S256 PKCE challenge is required.");
    }
    if (!this.isCurrentResource(resource)) {
      throw new BadRequestException("OAuth resource is invalid.");
    }
    const client = await this.publicClient(clientId);
    if (!client || !jsonStrings(client.redirectUris).includes(redirectUri)) {
      throw new BadRequestException("OAuth client or redirect URI is invalid.");
    }
    const scope = normalizeScope(
      stringValue(input.scope),
      resource,
      this.endpoints.publicResource,
    );
    if (scope.split(" ").includes("openid") && !oidcActiveKey()) {
      throw new BadRequestException("OIDC is not configured.");
    }
    const nonce = stringValue(input.nonce);
    if (nonce && (!scope.split(" ").includes("openid") || nonce.length > 255)) {
      throw new BadRequestException("OAuth nonce is invalid.");
    }
    this.assertWriteScopeEnabled(scope);
    const clientScopes = new Set(client.scope.split(/\s+/).filter(Boolean));
    if (scope.split(" ").some((item) => !clientScopes.has(item))) {
      throw new BadRequestException(
        "OAuth client has not declared the requested scope.",
      );
    }
    const availableWorkspaces = principal
      ? await this.workspacesForUser(principal.userId)
      : [];
    const workspaceId =
      availableWorkspaces.length === 1 ? availableWorkspaces[0]!.id : null;
    const transaction =
      await this.database.client.oAuthAuthorizationTransaction.create({
        data: {
          clientId: client.id,
          redirectUri,
          state: stringValue(input.state) || null,
          nonce: nonce || null,
          scope,
          resource,
          codeChallenge,
          codeChallengeMethod: "S256",
          userId: principal?.userId ?? null,
          workspaceId,
          expiresAt: new Date(Date.now() + TRANSACTION_TTL_MS),
        },
      });

    const target = principal
      ? `${this.endpoints.authorizationContinue}?transaction=${encodeURIComponent(transaction.id)}`
      : `${this.endpoints.login}?oauth_transaction=${encodeURIComponent(transaction.id)}`;
    return { url: target, statusCode: 302, transaction_id: transaction.id };
  }

  public async continueAuthorization(
    transactionId: string,
    principal: HumanPrincipal,
    workspaceId?: string,
  ) {
    const transaction = await this.activeTransaction(transactionId);
    if (transaction.userId && transaction.userId !== principal.userId) {
      throw new UnauthorizedException("OAuth transaction is not available.");
    }
    const workspaces = await this.workspacesForUser(principal.userId);
    if (workspaces.length === 0) {
      throw new BadRequestException("Workspace is not available.");
    }
    const selectedWorkspaceId =
      workspaceId ||
      transaction.workspaceId ||
      (workspaces.length === 1 ? workspaces[0]!.id : null);
    if (selectedWorkspaceId) {
      await this.requireWorkspaceMembership(
        principal.userId,
        selectedWorkspaceId,
      );
    }
    await this.database.client.oAuthAuthorizationTransaction.update({
      where: { id: transaction.id },
      data: { userId: principal.userId, workspaceId: selectedWorkspaceId },
    });
    return {
      url: `${this.endpoints.consent}?transaction=${encodeURIComponent(transaction.id)}`,
      statusCode: 302,
    };
  }

  public async authorizationContext(
    transactionId: string,
    principal: HumanPrincipal,
  ): Promise<OAuthAuthorizationContextView> {
    const transaction =
      await this.database.client.oAuthAuthorizationTransaction.findFirst({
        where: {
          id: transactionId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        include: {
          client: { select: { clientId: true, clientName: true } },
        },
      });
    if (
      !transaction ||
      !this.isCurrentResource(transaction.resource) ||
      transaction.userId !== principal.userId
    ) {
      throw new UnauthorizedException("OAuth transaction is not available.");
    }
    const workspaces = await this.workspacesForUser(principal.userId);
    if (workspaces.length === 0) {
      throw new BadRequestException("Workspace is not available.");
    }
    const selectedWorkspaceId =
      transaction.workspaceId &&
      workspaces.some((workspace) => workspace.id === transaction.workspaceId)
        ? transaction.workspaceId
        : workspaces.length === 1
          ? workspaces[0]!.id
          : null;
    if (selectedWorkspaceId !== transaction.workspaceId) {
      await this.database.client.oAuthAuthorizationTransaction.update({
        where: { id: transaction.id },
        data: { workspaceId: selectedWorkspaceId },
      });
    }
    return {
      transactionId: transaction.id,
      client: {
        id: transaction.client.clientId,
        name: transaction.client.clientName,
      },
      scope: transaction.scope,
      resource: transaction.resource,
      workspaces,
      selectedWorkspaceId,
      expiresAt: transaction.expiresAt.toISOString(),
    };
  }

  public async decideAuthorization(
    transactionId: string,
    allow: boolean,
    principal: HumanPrincipal,
    workspaceId?: string,
    approvedScope?: string,
  ) {
    const transaction = await this.activeTransaction(transactionId);
    const grantedScope = allow
      ? this.approvedScope(transaction.scope, approvedScope)
      : transaction.scope;
    if (allow) this.assertWriteScopeEnabled(grantedScope);
    if (transaction.userId && transaction.userId !== principal.userId) {
      throw new UnauthorizedException("OAuth transaction is not available.");
    }
    const target = new URL(transaction.redirectUri);
    if (!allow) {
      const availableWorkspaces = await this.workspacesForUser(
        principal.userId,
      );
      const selectedWorkspaceId =
        workspaceId ||
        transaction.workspaceId ||
        (availableWorkspaces.length === 1 ? availableWorkspaces[0]!.id : null);
      if (selectedWorkspaceId) {
        await this.requireWorkspaceMembership(
          principal.userId,
          selectedWorkspaceId,
        );
      }
      const denied =
        await this.database.client.oAuthAuthorizationTransaction.updateMany({
          where: {
            id: transaction.id,
            consumedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: {
            consumedAt: new Date(),
            userId: principal.userId,
            workspaceId: selectedWorkspaceId,
          },
        });
      if (denied.count !== 1) {
        throw new BadRequestException(
          "OAuth transaction is invalid or expired.",
        );
      }
      target.searchParams.set("error", "access_denied");
      if (transaction.state)
        target.searchParams.set("state", transaction.state);
      return { url: target.toString(), statusCode: 302 };
    }

    const selectedWorkspaceId =
      workspaceId ||
      transaction.workspaceId ||
      (await this.singleWorkspaceId(principal.userId));
    await this.requireWorkspaceMembership(
      principal.userId,
      selectedWorkspaceId,
    );

    const rawCode = `hm_code_${randomBytes(32).toString("base64url")}`;
    await this.database.client.$transaction(async (database) => {
      const consumed = await database.oAuthAuthorizationTransaction.updateMany({
        where: {
          id: transaction.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: {
          consumedAt: new Date(),
          userId: principal.userId,
          workspaceId: selectedWorkspaceId,
        },
      });
      if (consumed.count !== 1) {
        throw new BadRequestException(
          "OAuth transaction is invalid or expired.",
        );
      }
      await database.oAuthAuthorizationCode.create({
        data: {
          codeDigest: digest(rawCode),
          clientId: transaction.clientId,
          workspaceId: selectedWorkspaceId,
          userId: principal.userId,
          redirectUri: transaction.redirectUri,
          nonce: transaction.nonce,
          scope: grantedScope,
          resource: transaction.resource,
          codeChallenge: transaction.codeChallenge,
          codeChallengeMethod: transaction.codeChallengeMethod,
          expiresAt: new Date(Date.now() + CODE_TTL_MS),
        },
      });
    });
    target.searchParams.set("code", rawCode);
    if (transaction.state) target.searchParams.set("state", transaction.state);
    return { url: target.toString(), statusCode: 302 };
  }

  public async exchangeAuthorizationCode(input: Record<string, unknown>) {
    if (required(input.grant_type, "grant_type") !== "authorization_code") {
      throw new BadRequestException("Unsupported OAuth grant type.");
    }
    const clientId = required(input.client_id, "client_id");
    const rawCode = required(input.code, "code");
    const redirectUri = required(input.redirect_uri, "redirect_uri");
    const verifier = required(input.code_verifier, "code_verifier");
    const requestedResource = stringValue(input.resource);
    if (
      !validPkceVerifier(verifier) ||
      (requestedResource &&
        requestedResource !== this.endpoints.legacyResource &&
        requestedResource !== this.endpoints.publicResource)
    ) {
      throw new UnauthorizedException("OAuth authorization code is invalid.");
    }
    const client = await this.publicClient(clientId);
    const code = client
      ? await this.database.client.oAuthAuthorizationCode.findFirst({
          where: { codeDigest: digest(rawCode), clientId: client.id },
        })
      : null;
    if (
      !client ||
      client.tokenEndpointAuthMethod !== "none" ||
      !code ||
      code.usedAt ||
      code.expiresAt <= new Date() ||
      code.redirectUri !== redirectUri ||
      !this.isCurrentResource(code.resource) ||
      (requestedResource && code.resource !== requestedResource) ||
      !pkceMatches(verifier, code.codeChallenge)
    ) {
      throw new UnauthorizedException("OAuth authorization code is invalid.");
    }
    this.assertWriteScopeEnabled(code.scope);
    // Consent is not enough if access was removed before the code is redeemed.
    const currentUser = await this.database.client.user.findUnique({
      where: { id: code.userId },
      select: { status: true },
    });
    if (currentUser?.status !== "active") {
      throw new UnauthorizedException("OAuth authorization code is invalid.");
    }
    try {
      await this.requireWorkspaceMembership(code.userId, code.workspaceId);
    } catch {
      throw new UnauthorizedException("OAuth authorization code is invalid.");
    }

    const familyId = randomUUID();
    const rawToken = `hm_oauth_${randomBytes(32).toString("base64url")}`;
    const rawRefreshToken = `hm_refresh_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    const idToken = code.scope.split(" ").includes("openid")
      ? await this.idTokenFor({
          userId: code.userId,
          clientId,
          scope: code.scope,
          nonce: code.nonce,
        })
      : null;
    await this.database.client.$transaction(async (database) => {
      const consumed = await database.oAuthAuthorizationCode.updateMany({
        where: { id: code.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      if (consumed.count !== 1) {
        throw new UnauthorizedException("OAuth authorization code is invalid.");
      }
      await database.oAuthAccessToken.create({
        data: {
          tokenDigest: digest(rawToken),
          tokenPrefix: rawToken.slice(0, 20),
          clientId: client.id,
          workspaceId: code.workspaceId,
          userId: code.userId,
          scope: code.scope,
          resource: code.resource,
          refreshFamilyId: familyId,
          expiresAt,
        },
      });
      await database.oAuthRefreshToken.create({
        data: {
          tokenDigest: digest(rawRefreshToken),
          tokenPrefix: rawRefreshToken.slice(0, 20),
          familyId,
          clientId: client.id,
          workspaceId: code.workspaceId,
          userId: code.userId,
          scope: code.scope,
          resource: code.resource,
          expiresAt: refreshExpiresAt,
        },
      });
    });
    return {
      access_token: rawToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      scope: code.scope,
      refresh_token: rawRefreshToken,
      ...(idToken ? { id_token: idToken } : {}),
    };
  }

  public async userinfo(rawToken: string) {
    const principal = await this.authenticate(
      rawToken,
      this.endpoints.publicResource,
    );
    if (!principal || !principal.scopes.includes("openid")) {
      throw new UnauthorizedException("OIDC access token is invalid.");
    }
    const user = await this.database.client.user.findUnique({
      where: { id: principal.userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        emailVerifiedSource: true,
      },
    });
    if (!user) throw new UnauthorizedException("OIDC user is unavailable.");
    return {
      sub: user.id,
      ...(principal.scopes.includes("email")
        ? { email: user.email, email_verified: verifiedEmailClaim(user) }
        : {}),
    };
  }

  private async idTokenFor(input: {
    userId: string;
    clientId: string;
    scope: string;
    nonce?: string | null;
  }): Promise<string> {
    const user = await this.database.client.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        emailVerifiedSource: true,
      },
    });
    if (!user) throw new UnauthorizedException("OIDC user is unavailable.");
    return signIdToken({
      issuer: this.endpoints.issuer,
      subject: user.id,
      audience: input.clientId,
      ...(input.nonce ? { nonce: input.nonce } : {}),
      ...(input.scope.split(" ").includes("email")
        ? { email: user.email, emailVerified: verifiedEmailClaim(user) }
        : {}),
    });
  }

  public async exchangeToken(input: Record<string, unknown>) {
    const grantType = required(input.grant_type, "grant_type");
    if (grantType === "authorization_code") {
      return this.exchangeAuthorizationCode(input);
    }
    if (grantType === "refresh_token") return this.exchangeRefreshToken(input);
    throw new BadRequestException("Unsupported OAuth grant type.");
  }

  public async exchangeRefreshToken(input: Record<string, unknown>) {
    const clientId = required(input.client_id, "client_id");
    const rawRefreshToken = required(input.refresh_token, "refresh_token");
    const requestedResource = stringValue(input.resource);
    if (
      requestedResource &&
      requestedResource !== this.endpoints.legacyResource &&
      requestedResource !== this.endpoints.publicResource
    ) {
      throw new UnauthorizedException("OAuth refresh token is invalid.");
    }
    const client = await this.publicClient(clientId);
    const refresh = client
      ? await this.database.client.oAuthRefreshToken.findUnique({
          where: { tokenDigest: digest(rawRefreshToken) },
          include: {
            client: { select: { status: true, revokedAt: true } },
            workspace: { select: { accessStatus: true } },
            user: { select: { status: true } },
          },
        })
      : null;
    if (
      !client ||
      client.tokenEndpointAuthMethod !== "none" ||
      !refresh ||
      refresh.clientId !== client.id ||
      !this.isCurrentResource(refresh.resource) ||
      (requestedResource && refresh.resource !== requestedResource)
    ) {
      throw new UnauthorizedException("OAuth refresh token is invalid.");
    }
    this.assertWriteScopeEnabled(refresh.scope);
    if (
      refresh.usedAt ||
      refresh.revokedAt ||
      refresh.expiresAt <= new Date()
    ) {
      if (refresh.usedAt) await this.revokeRefreshFamily(refresh.familyId);
      throw new UnauthorizedException("OAuth refresh token is invalid.");
    }
    if (
      refresh.client.status !== "active" ||
      refresh.client.revokedAt ||
      refresh.workspace.accessStatus !== "ACTIVE" ||
      refresh.user.status !== "active"
    ) {
      await this.revokeRefreshFamily(refresh.familyId);
      throw new UnauthorizedException("OAuth refresh token is invalid.");
    }
    try {
      await this.requireWorkspaceMembership(
        refresh.userId,
        refresh.workspaceId,
      );
    } catch {
      await this.revokeRefreshFamily(refresh.familyId);
      throw new UnauthorizedException("OAuth refresh token is invalid.");
    }

    const rawToken = `hm_oauth_${randomBytes(32).toString("base64url")}`;
    const rotatedRefresh = `hm_refresh_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
    try {
      await this.database.client.$transaction(async (database) => {
        const consumed = await database.oAuthRefreshToken.updateMany({
          where: {
            id: refresh.id,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          data: { usedAt: new Date() },
        });
        if (consumed.count !== 1) {
          throw new UnauthorizedException("OAuth refresh token is invalid.");
        }
        await database.oAuthAccessToken.create({
          data: {
            tokenDigest: digest(rawToken),
            tokenPrefix: rawToken.slice(0, 20),
            clientId: refresh.clientId,
            workspaceId: refresh.workspaceId,
            userId: refresh.userId,
            scope: refresh.scope,
            resource: refresh.resource,
            refreshFamilyId: refresh.familyId,
            expiresAt,
          },
        });
        await database.oAuthRefreshToken.create({
          data: {
            tokenDigest: digest(rotatedRefresh),
            tokenPrefix: rotatedRefresh.slice(0, 20),
            familyId: refresh.familyId,
            clientId: refresh.clientId,
            workspaceId: refresh.workspaceId,
            userId: refresh.userId,
            scope: refresh.scope,
            resource: refresh.resource,
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
          },
        });
      });
    } catch (error) {
      await this.revokeRefreshFamily(refresh.familyId);
      throw error;
    }
    return {
      access_token: rawToken,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
      scope: refresh.scope,
      refresh_token: rotatedRefresh,
    };
  }

  public async authenticate(
    rawToken: string,
    resource: string = this.endpoints.legacyResource,
  ): Promise<OAuthMcpPrincipal | null> {
    if (!this.isCurrentResource(resource)) return null;
    if (!rawToken.startsWith("hm_oauth_")) return null;
    const token = await this.database.client.oAuthAccessToken.findUnique({
      where: { tokenDigest: digest(rawToken) },
      include: {
        client: { select: { status: true, revokedAt: true } },
        workspace: { select: { accessStatus: true } },
        user: { select: { status: true } },
      },
    });
    if (
      !token ||
      token.revokedAt ||
      token.expiresAt <= new Date() ||
      token.resource !== resource ||
      (resource === this.endpoints.publicResource && !token.refreshFamilyId) ||
      token.client.status !== "active" ||
      token.client.revokedAt ||
      token.workspace.accessStatus !== "ACTIVE" ||
      token.user.status !== "active"
    ) {
      return null;
    }
    const membership =
      await this.database.client.workspaceMembership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: token.workspaceId,
            userId: token.userId,
          },
        },
        select: { id: true },
      });
    if (!membership) return null;
    await this.database.client.oAuthAccessToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      kind: "oauth",
      tokenId: token.id,
      workspaceId: token.workspaceId,
      userId: token.userId,
      clientId: token.clientId,
      grantId: token.refreshFamilyId ?? token.id,
      resource: token.resource,
      scopes: token.scope.split(/\s+/).filter(Boolean),
      accountIds: [],
      resourceAccessMode: "ALL_CONNECTED",
    };
  }

  public async revoke(input: Record<string, unknown>) {
    const rawToken = required(input.token, "token");
    const clientId = stringValue(input.client_id);
    const token = await this.database.client.oAuthAccessToken.findUnique({
      where: { tokenDigest: digest(rawToken) },
      include: { client: { select: { clientId: true } } },
    });
    if (token && (!clientId || token.client.clientId === clientId)) {
      await this.database.client.oAuthAccessToken.updateMany({
        where: { id: token.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return { revoked: true as const };
    }
    const refresh = await this.database.client.oAuthRefreshToken.findUnique({
      where: { tokenDigest: digest(rawToken) },
      include: { client: { select: { clientId: true } } },
    });
    if (refresh && (!clientId || refresh.client.clientId === clientId)) {
      await this.revokeRefreshFamily(refresh.familyId);
    }
    return { revoked: true as const };
  }

  private async revokeRefreshFamily(familyId: string): Promise<void> {
    const now = new Date();
    await this.database.client.$transaction(async (database) => {
      await database.oAuthRefreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: now },
      });
      await database.oAuthAccessToken.updateMany({
        where: { refreshFamilyId: familyId, revokedAt: null },
        data: { revokedAt: now },
      });
    });
  }

  private async publicClient(clientId: string) {
    const existing = await this.database.client.oAuthPublicClient.findFirst({
      where: { clientId, status: "active", revokedAt: null },
    });
    if (!existing) return this.clientMetadata.resolve(clientId);
    if (existing.registrationSource !== "cimd") return existing;
    return this.clientMetadata.resolve(clientId);
  }

  private assertWriteScopeEnabled(scope: string): void {
    if (scope.split(/\s+/).includes(MCP_WRITE_SCOPE) && !this.writeScopeEnabled)
      throw new BadRequestException("OAuth write scope is not available.");
  }

  private approvedScope(requested: string, approved?: string): string {
    const requestedScopes = new Set(requested.split(" "));
    const identity = ["openid", "email"].filter((scope) =>
      requestedScopes.has(scope),
    );
    const readOnly = [MCP_READ_SCOPE, ...identity].join(" ");
    const readWrite = [MCP_READ_SCOPE, MCP_WRITE_SCOPE, ...identity].join(" ");
    if (
      !requestedScopes.has(MCP_WRITE_SCOPE) &&
      (!approved || approved === readOnly)
    )
      return readOnly;
    if (requestedScopes.has(MCP_WRITE_SCOPE)) {
      if (approved === readOnly) return readOnly;
      if (approved === readWrite) return readWrite;
    }
    throw new BadRequestException("Explicit OAuth scope consent is required.");
  }

  private isCurrentResource(resource: string): boolean {
    return (
      resource === this.endpoints.legacyResource ||
      resource === this.endpoints.publicResource
    );
  }

  private async activeTransaction(transactionId: string) {
    const transaction =
      await this.database.client.oAuthAuthorizationTransaction.findFirst({
        where: {
          id: transactionId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
      });
    if (!transaction || !this.isCurrentResource(transaction.resource)) {
      throw new BadRequestException("OAuth transaction is invalid or expired.");
    }
    return transaction;
  }

  private async singleWorkspaceId(userId: string): Promise<string> {
    const workspaces = await this.workspacesForUser(userId);
    if (workspaces.length !== 1) {
      throw new BadRequestException("Workspace is not available.");
    }
    return workspaces[0]!.id;
  }

  private async workspacesForUser(userId: string) {
    const memberships = await this.database.client.workspaceMembership.findMany(
      {
        where: { userId, workspace: { accessStatus: "ACTIVE" } },
        orderBy: { createdAt: "asc" },
        select: {
          role: true,
          workspace: { select: { id: true, name: true } },
        },
      },
    );
    return memberships.map((membership) => ({
      id: membership.workspace.id,
      name: membership.workspace.name,
      role: String(membership.role),
    }));
  }

  private async requireWorkspaceMembership(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const membership = await this.database.client.workspaceMembership.findFirst(
      {
        where: {
          userId,
          workspaceId,
          workspace: { accessStatus: "ACTIVE" },
        },
        select: { id: true },
      },
    );
    if (!membership) {
      throw new UnauthorizedException("Workspace access denied.");
    }
  }
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function required(value: unknown, name: string): string {
  const result = stringValue(value);
  if (!result) throw new BadRequestException(`OAuth ${name} is required.`);
  return result;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeScope(
  value: string,
  resource: string,
  publicResource: string,
): string {
  if (!value || value === "adforge:mcp" || value === MCP_READ_SCOPE) {
    return MCP_READ_SCOPE;
  }
  const scopes = new Set(value.split(/\s+/).filter(Boolean));
  if (resource === publicResource && scopes.has(MCP_READ_SCOPE)) {
    const allowed = new Set([
      MCP_READ_SCOPE,
      MCP_WRITE_SCOPE,
      "openid",
      "email",
    ]);
    if (
      [...scopes].every((scope) => allowed.has(scope)) &&
      (!scopes.has("email") || scopes.has("openid"))
    ) {
      return [MCP_READ_SCOPE, MCP_WRITE_SCOPE, "openid", "email"]
        .filter((scope) => scopes.has(scope))
        .join(" ");
    }
  }
  throw new BadRequestException(
    "OAuth scope is invalid for this MCP resource.",
  );
}

function validPkceChallenge(value: string): boolean {
  return /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function validPkceVerifier(value: string): boolean {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function pkceMatches(verifier: string, challenge: string): boolean {
  return (
    createHash("sha256").update(verifier, "utf8").digest("base64url") ===
    challenge
  );
}

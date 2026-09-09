import { createHash, randomBytes } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuditService } from "../audit/audit.service.js";
import type { HumanPrincipal, RequestWithAuth } from "../auth/auth.types.js";
import { DatabaseService } from "../infrastructure/database.service.js";
import type {
  CreateServiceTokenDto,
  RotateServiceTokenDto,
  UpdateServiceTokenDto,
  UpdateServiceTokenScopesDto,
} from "./service-token.dto.js";

const READ_SCOPE = "adforge:mcp:read";
const WRITE_SCOPE = "adforge:mcp:write";

export type ServiceTokenPrincipal = {
  kind: "service";
  tokenId: string;
  serviceIdentityId: string;
  workspaceId: string;
  scopes: string[];
  accountIds: string[];
};

export function hashServiceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  const values = [
    ...new Set(
      (scopes ?? [READ_SCOPE])
        .map((scope) =>
          scope.trim() === "adforge:mcp" ? READ_SCOPE : scope.trim(),
        )
        .filter(Boolean),
    ),
  ];
  if (
    values.length === 0 ||
    values.some((scope) => ![READ_SCOPE, WRITE_SCOPE].includes(scope))
  ) {
    throw new BadRequestException("Unsupported service token scope.");
  }
  if (values.includes(WRITE_SCOPE) && !values.includes(READ_SCOPE)) {
    values.unshift(READ_SCOPE);
  }
  return values;
}

function jsonStrings(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

@Injectable()
export class ServiceTokenService {
  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  public async create(
    workspaceId: string,
    input: CreateServiceTokenDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ) {
    const scopes = normalizeScopes(input.scopes);
    const controlled = scopes.includes(WRITE_SCOPE);
    const selected =
      controlled && !input.accountIds?.length
        ? await this.database.client.providerAccount.findMany({
            where: {
              workspaceId,
              enabled: true,
              connection: {
                workspaceId,
                status: { in: ["CONNECTED", "DEGRADED"] },
              },
            },
            select: { id: true },
          })
        : [];
    const accountIds = [
      ...new Set(
        input.accountIds?.length
          ? input.accountIds
          : selected.map((account) => account.id),
      ),
    ];
    if (controlled && !accountIds.length)
      throw new BadRequestException(
        "Select a connected account before creating a controlled-write key.",
      );
    if (accountIds.length > 0) {
      const count = await this.database.client.providerAccount.count({
        where: {
          workspaceId,
          id: { in: accountIds },
          ...(controlled
            ? {
                enabled: true,
                connection: {
                  workspaceId,
                  status: { in: ["CONNECTED", "DEGRADED"] },
                },
              }
            : {}),
        },
      });
      if (count !== accountIds.length) {
        throw new BadRequestException(
          "Account restriction is outside the workspace.",
        );
      }
    }

    const rawToken = `hmst_${randomBytes(32).toString("base64url")}`;
    const now = new Date();
    const expirationDays = input.expiresInDays ?? 90;
    const expiresAt = new Date(now.getTime() + expirationDays * 86_400_000);
    const created = await this.database.client.$transaction(async (tx) => {
      const identity = await tx.serviceIdentity.create({
        data: {
          workspaceId,
          createdById: principal.userId,
          name: `HolyMedia MCP: ${input.name}`,
        },
      });
      const token = await tx.serviceToken.create({
        data: {
          serviceIdentityId: identity.id,
          tokenDigest: hashServiceToken(rawToken),
          tokenPrefix: rawToken.slice(0, 13),
          name: input.name.trim(),
          scopes,
          ...(accountIds.length ? { accountIds } : {}),
          expiresAt,
        },
      });
      return { identity, token };
    });
    await this.audit.record({
      eventType: "service_token_created",
      actorUserId: principal.userId,
      workspaceId,
      targetType: "service_token",
      targetId: created.token.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: {
        scopes: scopes.join(","),
        restrictedAccounts: accountIds.length,
      },
    });
    return {
      ...this.toView(created.token, created.identity.id),
      token: rawToken,
    };
  }

  public async list(workspaceId: string) {
    const tokens = await this.database.client.serviceToken.findMany({
      // Revoked keys remain in the audit trail, but no longer clutter the
      // customer's active-key list.
      where: { revokedAt: null, serviceIdentity: { workspaceId } },
      include: { serviceIdentity: { select: { id: true } } },
      orderBy: { createdAt: "desc" },
    });
    return tokens.map((token) => this.toView(token, token.serviceIdentity.id));
  }

  public async revoke(
    workspaceId: string,
    tokenId: string,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ) {
    const token = await this.database.client.serviceToken.findFirst({
      where: { id: tokenId, revokedAt: null, serviceIdentity: { workspaceId } },
    });
    if (!token) throw new NotFoundException("Service token not found.");
    await this.database.client.serviceToken.update({
      where: { id: token.id },
      data: { revokedAt: new Date() },
    });
    await this.audit.record({
      eventType: "service_token_revoked",
      actorUserId: principal.userId,
      workspaceId,
      targetType: "service_token",
      targetId: token.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });
    return { success: true as const };
  }

  public async updateName(
    workspaceId: string,
    tokenId: string,
    input: UpdateServiceTokenDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ) {
    const token = await this.database.client.serviceToken.findFirst({
      where: { id: tokenId, serviceIdentity: { workspaceId } },
      include: { serviceIdentity: { select: { id: true } } },
    });
    if (!token) throw new NotFoundException("Service token not found.");

    const renamed = await this.database.client.serviceToken.update({
      where: { id: token.id },
      data: { name: input.name.trim() },
    });
    await this.audit.record({
      eventType: "service_token_renamed",
      actorUserId: principal.userId,
      workspaceId,
      targetType: "service_token",
      targetId: token.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
    });
    return this.toView(renamed, token.serviceIdentity.id);
  }

  public async rotate(
    workspaceId: string,
    tokenId: string,
    input: RotateServiceTokenDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ) {
    const rawToken = `hmst_${randomBytes(32).toString("base64url")}`;
    const now = new Date();
    const expirationDays = input.expiresInDays ?? 90;
    const expiresAt = new Date(now.getTime() + expirationDays * 86_400_000);
    const rotated = await this.database.client.$transaction(async (tx) => {
      const current = await tx.serviceToken.findFirst({
        where: {
          id: tokenId,
          revokedAt: null,
          serviceIdentity: { workspaceId },
        },
        include: { serviceIdentity: { select: { id: true } } },
      });
      if (!current) throw new NotFoundException("Service token not found.");
      await tx.serviceToken.update({
        where: { id: current.id },
        data: { revokedAt: now },
      });
      const replacement = await tx.serviceToken.create({
        data: {
          serviceIdentityId: current.serviceIdentityId,
          tokenDigest: hashServiceToken(rawToken),
          tokenPrefix: rawToken.slice(0, 13),
          name: current.name,
          scopes: current.scopes ?? [READ_SCOPE],
          accountIds: current.accountIds ?? [],
          expiresAt,
        },
      });
      return { replacement, serviceIdentityId: current.serviceIdentity.id };
    });
    await this.audit.record({
      eventType: "service_token_rotated",
      actorUserId: principal.userId,
      workspaceId,
      targetType: "service_token",
      targetId: rotated.replacement.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: { replacedTokenId: tokenId },
    });
    return {
      ...this.toView(rotated.replacement, rotated.serviceIdentityId),
      token: rawToken,
    };
  }

  public async updateScopes(
    workspaceId: string,
    tokenId: string,
    input: UpdateServiceTokenScopesDto,
    principal: HumanPrincipal,
    request: RequestWithAuth,
  ) {
    const token = await this.database.client.serviceToken.findFirst({
      where: {
        id: tokenId,
        revokedAt: null,
        serviceIdentity: { workspaceId },
      },
      include: { serviceIdentity: { select: { id: true } } },
    });
    if (!token) throw new NotFoundException("Service token not found.");

    const scopes = normalizeScopes(input.scopes);
    const accountIds = jsonStrings(token.accountIds);
    if (scopes.includes(WRITE_SCOPE) && accountIds.length !== 1) {
      throw new BadRequestException(
        "Write scope requires a service token restricted to exactly one account.",
      );
    }
    const updated = await this.database.client.serviceToken.update({
      where: { id: token.id },
      data: { scopes },
    });
    await this.audit.record({
      eventType: "service_token_scopes_updated",
      actorUserId: principal.userId,
      workspaceId,
      targetType: "service_token",
      targetId: updated.id,
      ...(request.requestId ? { requestId: request.requestId } : {}),
      metadata: {
        scopes: scopes.join(","),
        restrictedAccounts: accountIds.length,
      },
    });
    return this.toView(updated, token.serviceIdentity.id);
  }

  public async authenticate(
    rawToken: string,
  ): Promise<ServiceTokenPrincipal | null> {
    const token = await this.database.client.serviceToken.findUnique({
      where: { tokenDigest: hashServiceToken(rawToken) },
      include: {
        serviceIdentity: {
          select: {
            id: true,
            workspaceId: true,
            revokedAt: true,
            workspace: { select: { accessStatus: true } },
          },
        },
      },
    });
    if (
      !token ||
      token.revokedAt ||
      token.serviceIdentity.revokedAt ||
      !token.serviceIdentity.workspaceId
    ) {
      return null;
    }
    if (token.serviceIdentity.workspace?.accessStatus !== "ACTIVE") return null;
    if (token.expiresAt && token.expiresAt <= new Date()) return null;
    await this.database.client.serviceToken.update({
      where: { id: token.id },
      data: { lastUsedAt: new Date() },
    });
    return {
      kind: "service",
      tokenId: token.id,
      serviceIdentityId: token.serviceIdentity.id,
      workspaceId: token.serviceIdentity.workspaceId,
      scopes: jsonStrings(token.scopes),
      accountIds: jsonStrings(token.accountIds),
    };
  }

  private toView(
    token: {
      id: string;
      tokenPrefix: string;
      name: string;
      scopes: unknown;
      accountIds: unknown;
      createdAt: Date;
      expiresAt: Date | null;
      revokedAt: Date | null;
      lastUsedAt: Date | null;
    },
    serviceIdentityId: string,
  ) {
    return {
      id: token.id,
      serviceIdentityId,
      name: token.name,
      tokenPrefix: token.tokenPrefix,
      scopes: jsonStrings(token.scopes),
      accountIds: jsonStrings(token.accountIds),
      createdAt: token.createdAt.toISOString(),
      expiresAt: token.expiresAt?.toISOString() ?? null,
      revokedAt: token.revokedAt?.toISOString() ?? null,
      lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    };
  }
}

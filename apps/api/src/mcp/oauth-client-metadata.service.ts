import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { createLogger } from "@holymedia/observability";
import { safeGet } from "@holymedia/site-audit";
import { DatabaseService } from "../infrastructure/database.service.js";

const MAX_METADATA_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 4_000;
const MIN_CACHE_SECONDS = 300;
const MAX_CACHE_SECONDS = 86_400;
const MAX_REDIRECTS = 3;

type ClientMetadata = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  application_type: "web" | "native";
  scope: string;
};

class OAuthClientMetadataValidationError extends BadRequestException {
  public constructor(public readonly validationReason: string) {
    super("OAuth client metadata is invalid.");
  }
}

@Injectable()
export class OAuthClientMetadataService {
  private readonly logger = createLogger("holymedia-mcp-v2-oauth-cimd");

  public constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  public async resolve(clientId: string) {
    if (!isClientMetadataUrl(clientId)) return null;
    const existing = await this.database.client.oAuthPublicClient.findFirst({
      where: { clientId, status: "active", revokedAt: null },
    });
    if (
      existing?.registrationSource === "cimd" &&
      existing.metadataExpiresAt &&
      existing.metadataExpiresAt > new Date()
    ) {
      return existing;
    }

    const fetched = await this.fetch(clientId, existing?.metadataEtag ?? null);
    if (fetched.notModified && existing) {
      return this.database.client.oAuthPublicClient.update({
        where: { id: existing.id },
        data: {
          metadataFetchedAt: new Date(),
          metadataExpiresAt: fetched.expiresAt,
        },
      });
    }
    let metadata: ClientMetadata;
    try {
      metadata = parseClientMetadata(clientId, fetched.body);
    } catch (error) {
      this.logger.warn(
        {
          clientId,
          finalUrl: fetched.finalUrl,
          status: fetched.status,
          contentType: fetched.contentType,
          documentBytes: fetched.documentBytes,
          validationStage: "document_schema",
          validationReason:
            error instanceof OAuthClientMetadataValidationError
              ? error.validationReason
              : "unexpected_validation_error",
          errorType:
            error instanceof Error ? error.constructor.name : "unknown",
        },
        "OAuth CIMD rejected",
      );
      throw error;
    }
    this.logger.info(
      {
        clientId,
        finalUrl: fetched.finalUrl,
        status: fetched.status,
        contentType: fetched.contentType,
        documentBytes: fetched.documentBytes,
        clientName: metadata.client_name,
        redirectUris: metadata.redirect_uris,
        grantTypes: metadata.grant_types,
        responseTypes: metadata.response_types,
        tokenEndpointAuthMethod: metadata.token_endpoint_auth_method,
      },
      "OAuth CIMD resolved",
    );
    return this.database.client.oAuthPublicClient.upsert({
      where: { clientId },
      create: {
        clientId,
        clientName: metadata.client_name,
        redirectUris: metadata.redirect_uris,
        scope: metadata.scope,
        tokenEndpointAuthMethod: metadata.token_endpoint_auth_method,
        applicationType: metadata.application_type,
        registrationSource: "cimd",
        metadataEtag: fetched.etag,
        metadataFetchedAt: new Date(),
        metadataExpiresAt: fetched.expiresAt,
      },
      update: {
        clientName: metadata.client_name,
        redirectUris: metadata.redirect_uris,
        scope: metadata.scope,
        tokenEndpointAuthMethod: metadata.token_endpoint_auth_method,
        applicationType: metadata.application_type,
        registrationSource: "cimd",
        metadataEtag: fetched.etag,
        metadataFetchedAt: new Date(),
        metadataExpiresAt: fetched.expiresAt,
        revokedAt: null,
        status: "active",
      },
    });
  }

  private async fetch(
    clientId: string,
    etag: string | null,
  ): Promise<{
    body: unknown;
    etag: string | null;
    expiresAt: Date;
    notModified: boolean;
    finalUrl: string;
    status: number;
    contentType: string;
    documentBytes: number;
  }> {
    let response: Awaited<ReturnType<typeof safeGet>>;
    try {
      response = await safeGet(clientId, {
        accept: "application/json",
        maxBytes: MAX_METADATA_BYTES,
        maxRedirects: MAX_REDIRECTS,
        timeoutMs: FETCH_TIMEOUT_MS,
        requireHttps: true,
        ...(etag ? { ifNoneMatch: etag } : {}),
        userAgent: "HolyMediaMCP-OAuthMetadata/1.0",
      });
    } catch {
      this.logger.warn(
        { clientId, validationStage: "fetch_or_ssrf" },
        "OAuth CIMD unavailable",
      );
      throw new BadRequestException("OAuth client metadata is unavailable.");
    }
    const expiresAt = metadataExpiry(header(response.headers, "cache-control"));
    if (response.statusCode === 304 && etag) {
      return {
        body: null,
        etag,
        expiresAt,
        notModified: true,
        finalUrl: response.url,
        status: response.statusCode,
        contentType: header(response.headers, "content-type") ?? "",
        documentBytes: 0,
      };
    }
    const contentType = header(response.headers, "content-type") ?? "";
    if (
      response.statusCode < 200 ||
      response.statusCode >= 300 ||
      !/application\/(?:[\w.-]+\+)?json\b/i.test(contentType)
    ) {
      throw new BadRequestException("OAuth client metadata is invalid.");
    }
    const document = parseLimitedJson(response.body);
    return {
      body: document,
      etag: header(response.headers, "etag"),
      expiresAt,
      notModified: false,
      finalUrl: response.url,
      status: response.statusCode,
      contentType,
      documentBytes: response.body.byteLength,
    };
  }
}

export function isClientMetadataUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      url.pathname !== "/" &&
      !url.pathname
        .split("/")
        .some((segment) => segment === "." || segment === "..") &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function parseClientMetadata(
  clientId: string,
  value: unknown,
): ClientMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OAuthClientMetadataValidationError("document_not_object");
  }
  const input = value as Record<string, unknown>;
  if (input.client_id !== clientId) {
    throw new OAuthClientMetadataValidationError("client_id_mismatch");
  }
  const redirectUris = strings(input.redirect_uris);
  const grants = strings(input.grant_types);
  const responses = strings(input.response_types);
  const authentication = compatiblePublicAuthMethod(input);
  const applicationType =
    string(input.application_type) || inferApplicationType(redirectUris);
  if (!string(input.client_name))
    throw new OAuthClientMetadataValidationError("client_name_missing");
  if (redirectUris.length === 0 || redirectUris.length > 10)
    throw new OAuthClientMetadataValidationError("redirect_uris_invalid");
  if (grants.length > 0 && !grants.includes("authorization_code"))
    throw new OAuthClientMetadataValidationError(
      "authorization_code_not_supported",
    );
  if (
    (responses.length > 0 && !responses.includes("code")) ||
    !responses.every((type) => type === "code")
  )
    throw new OAuthClientMetadataValidationError("response_types_invalid");
  if (authentication !== "none")
    throw new OAuthClientMetadataValidationError(
      "public_token_auth_not_supported",
    );
  if (applicationType !== "web" && applicationType !== "native")
    throw new OAuthClientMetadataValidationError("application_type_invalid");
  if (redirectUris.some((uri) => !validRedirectUri(uri, applicationType)))
    throw new OAuthClientMetadataValidationError("redirect_uri_unsafe");
  return {
    client_id: clientId,
    client_name: string(input.client_name).slice(0, 160),
    redirect_uris: redirectUris,
    grant_types: normalizedGrantTypes(grants),
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: applicationType,
    scope: normalizeScope(string(input.scope)),
  };
}

export function registrationMetadata(
  input: Record<string, unknown>,
): Omit<ClientMetadata, "client_id"> {
  const redirectUris = strings(input.redirect_uris);
  const applicationType =
    string(input.application_type) || inferApplicationType(redirectUris);
  const grants = strings(input.grant_types);
  const responses = strings(input.response_types);
  const authentication = string(input.token_endpoint_auth_method) || "none";
  if (
    redirectUris.length === 0 ||
    redirectUris.length > 10 ||
    (grants.length > 0 && !grants.includes("authorization_code")) ||
    (responses.length > 0 && !responses.every((type) => type === "code")) ||
    authentication !== "none" ||
    (applicationType !== "web" && applicationType !== "native") ||
    redirectUris.some((uri) => !validRedirectUri(uri, applicationType))
  ) {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
  return {
    client_name: string(input.client_name).slice(0, 160) || "Public MCP client",
    redirect_uris: redirectUris,
    grant_types: normalizedGrantTypes(grants),
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    application_type: applicationType,
    scope: normalizeScope(string(input.scope)),
  };
}

function compatiblePublicAuthMethod(input: Record<string, unknown>): "none" {
  const capabilities = strings(input.token_endpoint_auth_methods_supported);
  const legacyPreference = string(input.token_endpoint_auth_method);
  if (capabilities.length > 0) {
    if (capabilities.includes("none")) return "none";
    throw new OAuthClientMetadataValidationError(
      "token_auth_methods_no_supported_intersection",
    );
  }
  if (!legacyPreference || legacyPreference === "none") return "none";
  throw new OAuthClientMetadataValidationError("token_auth_method_not_public");
}

function normalizedGrantTypes(grants: string[]): string[] {
  return grants.includes("refresh_token")
    ? ["authorization_code", "refresh_token"]
    : ["authorization_code"];
}

function string(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter(Boolean),
        ),
      ]
    : [];
}

function inferApplicationType(redirectUris: string[]): "web" | "native" {
  return redirectUris.some(isLoopbackRedirect) ? "native" : "web";
}

function validRedirectUri(value: string, applicationType: string): boolean {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === "https:") return true;
    return applicationType === "native" && isLoopbackRedirect(value);
  } catch {
    return false;
  }
}

function isLoopbackRedirect(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      Boolean(url.port) &&
      ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

function normalizeScope(value: string): string {
  if (!value || value === "adforge:mcp" || value === "adforge:mcp:read") {
    return "adforge:mcp:read";
  }
  const scopes = new Set(value.split(/\s+/).filter(Boolean));
  if (
    scopes.size === 2 &&
    scopes.has("adforge:mcp:read") &&
    scopes.has("adforge:mcp:write")
  ) {
    return "adforge:mcp:read adforge:mcp:write";
  }
  throw new BadRequestException("OAuth client scope is invalid.");
}

function metadataExpiry(cacheControl: string | null): Date {
  const maxAge = /max-age=(\d+)/i.exec(cacheControl ?? "")?.[1];
  const seconds = Math.max(
    MIN_CACHE_SECONDS,
    Math.min(MAX_CACHE_SECONDS, maxAge ? Number(maxAge) : MIN_CACHE_SECONDS),
  );
  return new Date(Date.now() + seconds * 1_000);
}

function parseLimitedJson(body: Buffer): unknown {
  if (body.byteLength > MAX_METADATA_BYTES)
    throw new BadRequestException("OAuth client metadata is invalid.");
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new BadRequestException("OAuth client metadata is invalid.");
  }
}

function header(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | null {
  const value = headers[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

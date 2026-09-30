import { describe, expect, it, vi } from "vitest";
import {
  OAuthClientMetadataService,
  isClientMetadataUrl,
  parseClientMetadata,
  registrationMetadata,
} from "./oauth-client-metadata.service.js";

const safeGetMock = vi.hoisted(() => vi.fn());

vi.mock("@holymedia/site-audit", () => ({ safeGet: safeGetMock }));

describe("OAuth client metadata documents", () => {
  const clientId = "https://client.example.test/.well-known/oauth-client.json";

  it("accepts an HTTPS CIMD public client with exact identity and PKCE-compatible metadata", () => {
    expect(
      parseClientMetadata(clientId, {
        client_id: clientId,
        client_name: "Anthropic Claude",
        redirect_uris: ["https://claude.example.test/oauth/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "web",
        scope: "adforge:mcp:read",
      }),
    ).toMatchObject({
      client_id: clientId,
      token_endpoint_auth_method: "none",
      application_type: "web",
    });
  });

  it("accepts Anthropic's hosted CIMD capabilities while selecting the supported code flow", () => {
    const anthropicClientId =
      "https://claude.ai/oauth/mcp-oauth-client-metadata";
    expect(
      parseClientMetadata(anthropicClientId, {
        client_id: anthropicClientId,
        client_name: "Claude",
        client_uri: "https://claude.ai",
        redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
        grant_types: [
          "authorization_code",
          "refresh_token",
          "urn:ietf:params:oauth:grant-type:jwt-bearer",
        ],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    ).toMatchObject({
      client_id: anthropicClientId,
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "adforge:mcp:read",
    });
  });

  it("accepts ChatGPT CIMD capabilities by selecting the public none method", () => {
    const chatGptClientId =
      "https://chatgpt.com/oauth/4CPt0xAKQRoU/client.json";
    expect(
      parseClientMetadata(chatGptClientId, {
        client_id: chatGptClientId,
        client_name: "ChatGPT",
        client_uri: "https://chatgpt.com/",
        redirect_uris: ["https://chatgpt.com/connector/oauth/4CPt0xAKQRoU"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
        token_endpoint_auth_signing_alg: "RS256",
      }),
    ).toMatchObject({
      client_id: chatGptClientId,
      redirect_uris: ["https://chatgpt.com/connector/oauth/4CPt0xAKQRoU"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "adforge:mcp:read",
    });
  });

  it("rejects CIMD metadata without a supported token authentication intersection", () => {
    expect(() =>
      parseClientMetadata(clientId, {
        client_id: clientId,
        client_name: "Confidential only",
        redirect_uris: ["https://client.example.test/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "private_key_jwt",
        token_endpoint_auth_methods_supported: ["private_key_jwt"],
      }),
    ).toThrow("OAuth client metadata is invalid.");
  });

  it("rejects mismatched identity, private client IDs, confidential metadata, and unsafe redirects", () => {
    expect(isClientMetadataUrl("https://client.example.test/")).toBe(false);
    expect(
      isClientMetadataUrl("http://client.example.test/metadata.json"),
    ).toBe(false);
    expect(() =>
      parseClientMetadata(clientId, {
        client_id: "https://other.example.test/metadata.json",
        client_name: "Claude",
        redirect_uris: ["https://claude.example.test/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
      }),
    ).toThrow("OAuth client metadata is invalid.");
    expect(() =>
      parseClientMetadata(clientId, {
        client_id: clientId,
        client_name: "Claude",
        redirect_uris: ["http://169.254.169.254/callback"],
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      }),
    ).toThrow("OAuth client metadata is invalid.");
  });

  it("supports RFC 7591 public desktop registrations with a loopback callback", () => {
    expect(
      registrationMetadata({
        client_name: "Claude Desktop",
        redirect_uris: ["http://127.0.0.1:45678/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        application_type: "native",
      }),
    ).toMatchObject({
      application_type: "native",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  it("records write as an explicitly declared client capability, never as a default", () => {
    const base = {
      client_name: "Public MCP client",
      redirect_uris: ["https://client.example.test/callback"],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
    expect(registrationMetadata(base).scope).toBe("adforge:mcp:read");
    expect(registrationMetadata({
      ...base,
      scope: "adforge:mcp:read adforge:mcp:write",
    }).scope).toBe("adforge:mcp:read adforge:mcp:write");
    expect(() => registrationMetadata({ ...base, scope: "adforge:mcp:write" }))
      .toThrow();
  });
});

describe("OAuth client metadata network boundary", () => {
  it("uses the shared DNS-pinned HTTPS-only fetcher", async () => {
    const clientId = "https://client.example.test/.well-known/client.json";
    safeGetMock.mockResolvedValueOnce({
      url: clientId,
      statusCode: 200,
      headers: { "content-type": "application/json", etag: '"v1"' },
      body: Buffer.from(
        JSON.stringify({
          client_id: clientId,
          client_name: "Public client",
          redirect_uris: ["https://client.example.test/callback"],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        }),
      ),
    });
    const upsert = vi.fn().mockResolvedValue({ id: "client-1" });
    const service = new OAuthClientMetadataService({
      client: {
        oAuthPublicClient: {
          findFirst: vi.fn().mockResolvedValue(null),
          upsert,
        },
      },
    } as never);

    await service.resolve(clientId);

    expect(safeGetMock).toHaveBeenCalledWith(
      clientId,
      expect.objectContaining({
        requireHttps: true,
        maxBytes: 64 * 1024,
        maxRedirects: 3,
      }),
    );
    expect(upsert).toHaveBeenCalledOnce();
  });
});

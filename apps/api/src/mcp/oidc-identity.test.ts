import { createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OAuthMetadataController } from "../compat/oauth-metadata.controller.js";
import { oidcJwks, signIdToken, verifiedEmailClaim } from "./oidc-identity.js";

function key(kid: string) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    kid,
    privateKeyPemBase64: Buffer.from(
      privateKey.export({ type: "pkcs8", format: "pem" }),
    ).toString("base64"),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("OpenID Connect identity", () => {
  it("does not advertise OIDC without operator signing keys", () => {
    vi.stubEnv("HOLYMEDIA_OIDC_SIGNING_KEYS_JSON", undefined);
    vi.stubEnv("HOLYMEDIA_OIDC_ACTIVE_KID", undefined);
    const metadata = new OAuthMetadataController();
    expect(metadata.authorizationServer().scopes_supported).not.toContain(
      "openid",
    );
    expect(() => metadata.openidConfiguration()).toThrow();
  });

  it("issues an RS256 ID token with exact issuer, client audience and nonce", () => {
    const previous = key("previous8");
    const current = key("current88");
    vi.stubEnv(
      "HOLYMEDIA_OIDC_SIGNING_KEYS_JSON",
      JSON.stringify([previous, current]),
    );
    vi.stubEnv("HOLYMEDIA_OIDC_ACTIVE_KID", current.kid);
    vi.stubEnv("HOLYMEDIA_PUBLIC_BASE_URL", "https://oidc.example.test");
    const metadata = new OAuthMetadataController();
    expect(metadata.openidConfiguration()).toMatchObject({
      issuer: "https://oidc.example.test",
      userinfo_endpoint: "https://oidc.example.test/oauth/userinfo",
      jwks_uri: "https://oidc.example.test/.well-known/jwks.json",
      id_token_signing_alg_values_supported: ["RS256"],
    });
    expect(metadata.authorizationServer().scopes_supported).toEqual(
      expect.arrayContaining(["openid", "email"]),
    );
    const jwks = oidcJwks();
    expect(jwks.keys.map((item) => item.kid)).toEqual([
      previous.kid,
      current.kid,
    ]);
    const token = signIdToken({
      issuer: "https://oidc.example.test",
      subject: "user-123",
      audience: "https://client.example.test/client.json",
      nonce: "nonce-123",
      email: "reviewer@example.test",
      emailVerified: true,
    });
    const [header, payload, signature] = token.split(".");
    expect(
      JSON.parse(Buffer.from(header!, "base64url").toString()),
    ).toMatchObject({
      alg: "RS256",
      kid: current.kid,
    });
    expect(
      JSON.parse(Buffer.from(payload!, "base64url").toString()),
    ).toMatchObject({
      iss: "https://oidc.example.test",
      aud: "https://client.example.test/client.json",
      sub: "user-123",
      nonce: "nonce-123",
      email_verified: true,
    });
    expect(
      createVerify("RSA-SHA256")
        .update(`${header}.${payload}`)
        .end()
        .verify(
          Buffer.from(current.privateKeyPemBase64, "base64"),
          Buffer.from(signature!, "base64url"),
        ),
    ).toBe(true);
  });

  it("reports verified email only with a recorded verification source", () => {
    expect(
      verifiedEmailClaim({
        emailVerifiedAt: new Date(),
        emailVerifiedSource: null,
      }),
    ).toBe(false);
    expect(
      verifiedEmailClaim({
        emailVerifiedAt: null,
        emailVerifiedSource: "google_verified",
      }),
    ).toBe(false);
    for (const source of ["email_link", "google_verified"]) {
      expect(
        verifiedEmailClaim({
          emailVerifiedAt: new Date(),
          emailVerifiedSource: source,
        }),
      ).toBe(true);
    }
  });
});

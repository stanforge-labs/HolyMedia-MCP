import {
  createPrivateKey,
  createPublicKey,
  createSign,
  type KeyObject,
} from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { ServiceUnavailableException } from "@nestjs/common";

type SigningKey = { kid: string; privateKey: KeyObject; publicKey: KeyObject };

/** Keys are operator supplied, never generated at process startup or committed. */
function signingKeys(): SigningKey[] {
  const keyFile = process.env.HOLYMEDIA_OIDC_SIGNING_KEYS_FILE;
  const inlineKeys = process.env.HOLYMEDIA_OIDC_SIGNING_KEYS_JSON;
  if (keyFile && inlineKeys) {
    throw new ServiceUnavailableException("OIDC signing keys are invalid.");
  }
  let encoded = inlineKeys;
  if (keyFile) {
    try {
      if (!isAbsolute(keyFile)) throw new Error("relative_path");
      const metadata = statSync(keyFile);
      if (
        !metadata.isFile() ||
        metadata.size > 65_536 ||
        (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
      ) {
        throw new Error("invalid_file");
      }
      encoded = readFileSync(keyFile, "utf8");
    } catch {
      throw new ServiceUnavailableException("OIDC signing keys are invalid.");
    }
  }
  if (!encoded) return [];
  let rows: unknown;
  try {
    rows = JSON.parse(encoded);
  } catch {
    throw new ServiceUnavailableException("OIDC signing keys are invalid.");
  }
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 3) {
    throw new ServiceUnavailableException("OIDC signing keys are invalid.");
  }
  const seen = new Set<string>();
  return rows.map((row: unknown) => {
    if (!row || typeof row !== "object") {
      throw new ServiceUnavailableException("OIDC signing keys are invalid.");
    }
    const value = row as Record<string, unknown>;
    const kid = value.kid;
    const keyBase64 = value.privateKeyPemBase64;
    if (
      typeof kid !== "string" ||
      !/^[A-Za-z0-9_-]{8,64}$/.test(kid) ||
      seen.has(kid) ||
      typeof keyBase64 !== "string" ||
      keyBase64.length > 16_384
    ) {
      throw new ServiceUnavailableException("OIDC signing keys are invalid.");
    }
    seen.add(kid);
    try {
      const privateKey = createPrivateKey(
        Buffer.from(keyBase64, "base64").toString("utf8"),
      );
      if (
        privateKey.asymmetricKeyType !== "rsa" ||
        (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048
      ) {
        throw new Error("unsupported_key");
      }
      return { kid, privateKey, publicKey: createPublicKey(privateKey) };
    } catch {
      throw new ServiceUnavailableException("OIDC signing keys are invalid.");
    }
  });
}

export function oidcActiveKey(): SigningKey | null {
  const keys = signingKeys();
  if (keys.length === 0) return null;
  const activeKid = process.env.HOLYMEDIA_OIDC_ACTIVE_KID;
  const active = keys.find((key) => key.kid === activeKid);
  if (!active)
    throw new ServiceUnavailableException("OIDC active key is unavailable.");
  return active;
}

/** Fail startup when an operator opted into OIDC but its key is unusable. */
export function assertOidcStartupReady(): void {
  if (
    process.env.HOLYMEDIA_OIDC_SIGNING_KEYS_FILE ||
    process.env.HOLYMEDIA_OIDC_SIGNING_KEYS_JSON ||
    process.env.HOLYMEDIA_OIDC_ACTIVE_KID
  ) {
    if (!oidcActiveKey())
      throw new ServiceUnavailableException("OIDC is not configured.");
  }
}

export function oidcJwks() {
  if (!oidcActiveKey())
    throw new ServiceUnavailableException("OIDC is not configured.");
  return {
    keys: signingKeys().map(({ kid, publicKey }) => ({
      ...publicKey.export({ format: "jwk" }),
      kid,
      alg: "RS256",
      use: "sig",
    })),
  };
}

export function verifiedEmailClaim(user: {
  emailVerifiedAt: Date | null;
  emailVerifiedSource: string | null;
}): boolean {
  return (
    Boolean(user.emailVerifiedAt) &&
    (user.emailVerifiedSource === "email_link" ||
      user.emailVerifiedSource === "google_verified")
  );
}

export function signIdToken(input: {
  issuer: string;
  subject: string;
  audience: string;
  nonce?: string | null;
  email?: string;
  emailVerified?: boolean;
}): string {
  const key = oidcActiveKey();
  if (!key) throw new ServiceUnavailableException("OIDC is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.kid }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: input.issuer,
      sub: input.subject,
      aud: input.audience,
      iat: now,
      exp: now + 3600,
      ...(input.nonce ? { nonce: input.nonce } : {}),
      ...(input.email
        ? { email: input.email, email_verified: input.emailVerified === true }
        : {}),
    }),
  ).toString("base64url");
  const message = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(message)
    .end()
    .sign(key.privateKey)
    .toString("base64url");
  return `${message}.${signature}`;
}

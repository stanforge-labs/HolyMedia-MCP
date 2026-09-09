import { afterEach, describe, expect, it } from "vitest";
import { CredentialVaultService } from "./credential-vault.service.js";

const keyOne = Buffer.alloc(32, 1).toString("base64");
const keyTwo = Buffer.alloc(32, 2).toString("base64");
const original = {
  NODE_ENV: process.env.NODE_ENV,
  V2_CONFIG_STRICT: process.env.V2_CONFIG_STRICT,
  PROVIDER_CREDENTIAL_ENCRYPTION_KEYS:
    process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS,
  PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION:
    process.env.PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION,
};

afterEach(() => {
  process.env.NODE_ENV = original.NODE_ENV;
  process.env.V2_CONFIG_STRICT = original.V2_CONFIG_STRICT;
  process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS =
    original.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS;
  process.env.PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION =
    original.PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION;
});

describe("CredentialVaultService", () => {
  it("uses authenticated encryption and supports key rotation", () => {
    process.env.NODE_ENV = "test";
    process.env.V2_CONFIG_STRICT = "false";
    process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS = `1:${keyOne}`;
    process.env.PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION = "1";
    const oldVault = new CredentialVaultService();
    const oldEncrypted = oldVault.encrypt({ accessToken: "opaque-token" });

    process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS = `1:${keyOne},2:${keyTwo}`;
    process.env.PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION = "2";
    const rotatedVault = new CredentialVaultService();
    expect(rotatedVault.decrypt(oldEncrypted.ciphertext, 1)).toEqual({
      accessToken: "opaque-token",
    });
    const reencrypted = rotatedVault.reencrypt(
      oldEncrypted.ciphertext,
      oldEncrypted.encryptionVersion,
    );
    expect(reencrypted.encryptionVersion).toBe(2);
    expect(rotatedVault.decrypt(reencrypted.ciphertext, 2)).toEqual({
      accessToken: "opaque-token",
    });
    expect(reencrypted.ciphertext).not.toContain("opaque-token");
  });

  it("rejects tampered ciphertext", () => {
    process.env.NODE_ENV = "test";
    process.env.V2_CONFIG_STRICT = "false";
    process.env.PROVIDER_CREDENTIAL_ENCRYPTION_KEYS = `1:${keyOne}`;
    process.env.PROVIDER_CREDENTIAL_CURRENT_KEY_VERSION = "1";
    const vault = new CredentialVaultService();
    const encrypted = vault.encrypt({ accessToken: "opaque-token" });
    const parts = encrypted.ciphertext.split(".");
    const data = Buffer.from(parts[3]!, "base64url");
    data[0] = data[0]! ^ 1;
    parts[3] = data.toString("base64url");
    const tampered = parts.join(".");
    expect(() => vault.decrypt(tampered, 1)).toThrow(
      "Unsupported state or unable to authenticate data",
    );
  });
});

import test from "node:test";
import assert from "node:assert/strict";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { readFileSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { Script } from "node:vm";
import { stripTypeScriptTypes } from "node:module";
import process from "node:process";
const { structuredClone } = globalThis;
import {
  sealAcceptanceContext,
  openAcceptanceContext,
  readAcceptanceContext,
} from "./context-vault.mjs";

// Execute the actual existing stock vault class; only DI/decorator/config wiring
// is replaced by a synthetic key ring. No encryption implementation is copied.
function realStockVault() {
  const source = readFileSync(
    new URL(
      "../../../apps/api/src/providers/credential-vault.service.ts",
      import.meta.url,
    ),
    "utf8",
  )
    .replace(/^import .*;\r?\n/gm, "")
    .replace(/@Injectable\(\)\r?\n/, "")
    .replace(
      "export class CredentialVaultService",
      "class CredentialVaultService",
    );
  const code =
    stripTypeScriptTypes(source, { mode: "strip" }) +
    "\nCredentialVaultService;";
  const Class = new Script(code).runInNewContext({
    createCipheriv,
    createDecipheriv,
    randomBytes,
    Buffer,
    JSON,
    loadConfig: () => ({
      providerCredentialEncryptionKeys:
        "1:" + Buffer.alloc(32, 9).toString("base64"),
      providerCredentialCurrentKeyVersion: 1,
    }),
  });
  return new Class();
}
const payload = () => ({
  service_token: "synthetic-opaque-service",
  key_id: "16224a43-2389-4062-9ffb-766a9abaf1d3",
  fingerprint: "a".repeat(64),
  expires_at: "2026-10-10T00:00:00.000Z",
  preview: {
    preview_id: "16224a43-2389-4062-9ffb-766a9abaf1d3",
    preview_token: "synthetic-opaque-preview",
    approval_url: "http://localhost:4402/mcp/approve#synthetic",
    status: "preview",
    provider: "GOOGLE_ADS",
    account_id: "8590146099",
    operation_count: 1,
    provider_validation: "passed",
    expires_at: "2026-10-09T12:00:00.000Z",
    items: [
      { before: { cpcBidMicros: "100000" }, after: { cpcBidMicros: "110000" } },
    ],
  },
});
test("real stock AES-GCM vault roundtrip and public redaction, unique nonce", () => {
  const vault = realStockVault(),
    p = payload(),
    first = sealAcceptanceContext(vault, p),
    second = sealAcceptanceContext(vault, p);
  assert.deepEqual(openAcceptanceContext(vault, first), p);
  assert.notEqual(first.ciphertext, second.ciphertext);
  const encoded = JSON.stringify(first);
  for (const value of [
    p.service_token,
    p.preview.preview_token,
    p.preview.approval_url,
  ])
    assert.equal(encoded.includes(value), false);
  assert.equal(first.public.preview.approval_url, undefined);
  assert.equal(first.public.preview.items, undefined);
  assert.equal(first.public.key_id, p.key_id);
});
test("thin encrypted fixture context and full encrypted inverse context supported", () => {
  const vault = realStockVault();
  for (const p of [
    {
      service_token: "synthetic",
      preview: { preview_id: payload().preview.preview_id },
    },
    { ...payload(), original_commit_id: "hmc_" + "a".repeat(43) },
  ])
    assert.deepEqual(
      openAcceptanceContext(vault, sealAcceptanceContext(vault, p)),
      p,
    );
});
test("ciphertext/version/purpose/public tampering rejects with redacted errors", () => {
  const vault = realStockVault(),
    sealed = sealAcceptanceContext(vault, payload());
  for (const alter of [
    (e) => (e.version = 2),
    (e) => (e.purpose = "OTHER"),
    (e) => (e.encryptionVersion = 2),
    (e) =>
      (e.public.preview.preview_id = "00000000-0000-0000-0000-000000000000"),
    (e) => (e.public.approval_url = "synthetic"),
    (e) => {
      const parts = e.ciphertext.split(".");
      parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
      e.ciphertext = parts.join(".");
    },
    (e) => (e.extra = true),
  ]) {
    const e = structuredClone(sealed);
    alter(e);
    assert.throws(
      () => openAcceptanceContext(vault, e),
      (error) => /^stage234_context_[a-z_]+$/.test(error.message),
    );
  }
});
test("closed payload, size bounds and public-field secret spoofing rejected", () => {
  const vault = realStockVault();
  for (const alter of [
    (p) => (p.raw_request = {}),
    (p) => (p.service_token = ""),
    (p) => (p.preview.preview_token = 1),
    (p) => (p.preview.preview_id = "foreign"),
    (p) => (p.preview.status = p.service_token),
    (p) => (p.fingerprint = "not-hash"),
    (p) => (p.preview.items = ["A".repeat(128 * 1024)]),
  ]) {
    const p = payload();
    alter(p);
    assert.throws(() => sealAcceptanceContext(vault, p));
  }
});
test("wrapper errors never expose vault errors, plaintext or ciphertext", () => {
  const vault = realStockVault(),
    envelope = sealAcceptanceContext(vault, payload());
  assert.throws(
    () =>
      openAcceptanceContext(
        {
          decrypt: () => {
            throw Error(envelope.ciphertext);
          },
        },
        envelope,
      ),
    { message: "stage234_context_decryption_failed" },
  );
  assert.throws(
    () =>
      sealAcceptanceContext(
        {
          encrypt: () => {
            throw Error(payload().service_token);
          },
        },
        payload(),
      ),
    { message: "stage234_context_encryption_failed" },
  );
});
test("strict private file read, encrypted roundtrip, old expired plaintext opt-in only", async () => {
  const root = mkdtempSync(join(tmpdir(), "hm-context-")),
    file = join(root, "context.json"),
    vault = realStockVault();
  writeFileSync(file, JSON.stringify(sealAcceptanceContext(vault, payload())), {
    mode: 0o600,
  });
  chmodSync(file, 0o600);
  // Acceptance runs on Linux. Windows ACL-backed files cannot prove POSIX600;
  // fail closed there, rather than silently weakening the runtime contract.
  if (process.platform === "win32") {
    await assert.rejects(
      readAcceptanceContext(file, { vault }),
      /protected_file_invalid/,
    );
    return;
  }
  assert.deepEqual(await readAcceptanceContext(file, { vault }), payload());
  writeFileSync(file, '{"service_token":"synthetic-broken-json');
  await assert.rejects(readAcceptanceContext(file, { vault }), {
    message: "stage234_context_file_json_invalid",
  });
  const old = payload();
  old.preview.expires_at = "2000-01-01T00:00:00.000Z";
  writeFileSync(file, JSON.stringify(old));
  await assert.rejects(
    readAcceptanceContext(file, { vault }),
    /live_plaintext_forbidden/,
  );
  assert.deepEqual(
    await readAcceptanceContext(file, { vault, allowLegacyExpired: true }),
    old,
  );
  old.preview.expires_at = "2999-01-01T00:00:00.000Z";
  writeFileSync(file, JSON.stringify(old));
  await assert.rejects(
    readAcceptanceContext(file, { vault, allowLegacyExpired: true }),
    /live_plaintext_forbidden/,
  );
  chmodSync(file, 0o644);
  await assert.rejects(
    readAcceptanceContext(file, { vault }),
    /protected_file_invalid/,
  );
});

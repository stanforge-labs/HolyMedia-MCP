// Uses the stock disposable credential vault. No parallel encryption/key store.
import {
  constants,
  lstatSync,
  openSync,
  fstatSync,
  readFileSync,
  closeSync,
} from "node:fs";
import { Buffer } from "node:buffer";
const purpose = "STAGE234_ACCEPTANCE_CONTEXT",
  maxBytes = 256 * 1024;
const fail = (code) => {
  throw new Error(code);
};
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const plain = (value) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
function checkPayload(payload) {
  const allowed = [
    "service_token",
    "preview",
    "original_commit_id",
    "key_id",
    "fingerprint",
    "expires_at",
  ];
  if (
    !plain(payload) ||
    Object.keys(payload).some((k) => !allowed.includes(k)) ||
    typeof payload.service_token !== "string" ||
    !payload.service_token ||
    payload.service_token.length > 2048 ||
    !plain(payload.preview) ||
    !/^[a-f0-9-]{36}$/.test(payload.preview.preview_id ?? "")
  )
    fail("stage234_context_payload_invalid");
  if (
    payload.preview.preview_token !== undefined &&
    (typeof payload.preview.preview_token !== "string" ||
      !payload.preview.preview_token ||
      payload.preview.preview_token.length > 2048)
  )
    fail("stage234_context_preview_token_invalid");
  if (
    payload.original_commit_id !== undefined &&
    !/^hmc_[A-Za-z0-9_-]{43}$/.test(payload.original_commit_id)
  )
    fail("stage234_context_original_commit_invalid");
  if (payload.key_id !== undefined && !/^[a-f0-9-]{36}$/.test(payload.key_id))
    fail("stage234_context_key_identity_invalid");
  if (
    payload.fingerprint !== undefined &&
    !/^[a-f0-9]{64}$/.test(payload.fingerprint)
  )
    fail("stage234_context_fingerprint_invalid");
  if (
    payload.expires_at !== undefined &&
    !Number.isFinite(Date.parse(payload.expires_at))
  )
    fail("stage234_context_key_expiry_invalid");
  let encoded;
  try {
    encoded = JSON.stringify(payload);
  } catch {
    fail("stage234_context_payload_invalid");
  }
  if (Buffer.byteLength(encoded, "utf8") > 128 * 1024)
    fail("stage234_context_payload_too_large");
}
function publicHints(payload) {
  const preview = {};
  const valid = {
    preview_id: (v) => /^[a-f0-9-]{36}$/.test(v),
    status: (v) =>
      ["preview", "confirmed", "expired", "consumed", "cancelled"].includes(v),
    provider: (v) => v === "GOOGLE_ADS",
    account_id: (v) => v === "8590146099",
    expires_at: (v) =>
      typeof v === "string" && v.length <= 40 && Number.isFinite(Date.parse(v)),
    operation_count: (v) => Number.isInteger(v) && v >= 1 && v <= 500,
    provider_validation: (v) => ["passed", "failed"].includes(v),
  };
  for (const key of Object.keys(valid)) {
    const value = payload.preview[key];
    if (value !== undefined) {
      if (!valid[key](value)) fail("stage234_context_public_hint_invalid");
      preview[key] = value;
    }
  }
  const hints = { preview };
  for (const key of ["key_id", "fingerprint", "expires_at"])
    if (payload[key] !== undefined) hints[key] = payload[key];
  return hints;
}
function assertEnvelope(envelope) {
  if (
    !plain(envelope) ||
    canonical(Object.keys(envelope).sort()) !==
      canonical([
        "ciphertext",
        "encryptionVersion",
        "public",
        "purpose",
        "version",
      ]) ||
    envelope.version !== 1 ||
    envelope.purpose !== purpose ||
    !Number.isInteger(envelope.encryptionVersion) ||
    envelope.encryptionVersion < 1 ||
    typeof envelope.ciphertext !== "string" ||
    envelope.ciphertext.length > maxBytes ||
    !/^hm1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]+$/.test(
      envelope.ciphertext,
    ) ||
    !plain(envelope.public)
  )
    fail("stage234_context_envelope_invalid");
}
export function sealAcceptanceContext(vault, payload) {
  checkPayload(payload);
  const hints = publicHints(payload);
  let encrypted;
  try {
    encrypted = vault.encrypt({ version: 1, purpose, payload, public: hints });
  } catch {
    fail("stage234_context_encryption_failed");
  }
  const envelope = {
    version: 1,
    purpose,
    ciphertext: encrypted.ciphertext,
    encryptionVersion: encrypted.encryptionVersion,
    public: hints,
  };
  assertEnvelope(envelope);
  return envelope;
}
export function openAcceptanceContext(vault, envelope) {
  assertEnvelope(envelope);
  let decoded;
  try {
    decoded = vault.decrypt(envelope.ciphertext, envelope.encryptionVersion);
  } catch {
    fail("stage234_context_decryption_failed");
  }
  if (
    !plain(decoded) ||
    decoded.version !== 1 ||
    decoded.purpose !== purpose ||
    canonical(Object.keys(decoded).sort()) !==
      canonical(["payload", "public", "purpose", "version"])
  )
    fail("stage234_context_decrypted_contract_invalid");
  checkPayload(decoded.payload);
  if (
    canonical(decoded.public) !== canonical(publicHints(decoded.payload)) ||
    canonical(envelope.public) !== canonical(decoded.public)
  )
    fail("stage234_context_public_metadata_tampered");
  return decoded.payload;
}
/** Legacy plaintext is NEVER emitted; only explicit expired historical reads. */
export async function readAcceptanceContext(
  file,
  { vault, allowLegacyExpired = false, now = Date.now() } = {},
) {
  const first = lstatSync(file);
  if (
    !first.isFile() ||
    first.isSymbolicLink() ||
    (first.mode & 0o777) !== 0o600 ||
    first.size > maxBytes
  )
    fail("stage234_context_protected_file_invalid");
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  let value;
  try {
    const current = fstatSync(fd);
    if (
      !current.isFile() ||
      (current.mode & 0o777) !== 0o600 ||
      current.size > maxBytes ||
      current.ino !== first.ino ||
      current.dev !== first.dev
    )
      fail("stage234_context_protected_file_changed");
    try {
      value = JSON.parse(readFileSync(fd, "utf8"));
    } catch {
      fail("stage234_context_file_json_invalid");
    }
  } finally {
    closeSync(fd);
  }
  if (!plain(value)) fail("stage234_context_file_json_invalid");
  if (
    value.version !== undefined ||
    value.ciphertext !== undefined ||
    value.purpose !== undefined
  ) {
    if (!vault) {
      const { CredentialVaultService } =
        await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
      vault = new CredentialVaultService();
    }
    return openAcceptanceContext(vault, value);
  }
  checkPayload(value);
  const expiry = Date.parse(value.preview.expires_at);
  if (allowLegacyExpired !== true || !Number.isFinite(expiry) || expiry >= now)
    fail("stage234_context_live_plaintext_forbidden");
  return value;
}

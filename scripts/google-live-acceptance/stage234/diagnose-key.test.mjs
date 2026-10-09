import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

test("key diagnosis only reads protected disposable DB identity/lifetime, never renews authority or calls provider", () => {
  const source = readFileSync(
    new URL("./diagnose-key.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /url\.hostname !== "postgres"/);
  assert.match(source, /url\.pathname !== "\/google_acceptance"/);
  assert.match(source, /stat\.isSymbolicLink\(\)/);
  assert.match(source, /stat\.mode & 0o077/);
  assert.match(source, /mcpPreview\.findUnique\(/);
  assert.match(source, /serviceToken\.findUnique\(/);
  assert.doesNotMatch(
    source,
    /fetch\(|ProviderService|GoogleAdsAdapter|CredentialVaultService/,
  );
  assert.doesNotMatch(
    source,
    /db\.client\.[A-Za-z]+\.(create|update|delete|upsert|executeRaw)/,
  );
  assert.doesNotMatch(
    source,
    /JSON\.stringify\((context|key|config|preview)\)/,
  );
  assert.doesNotMatch(source, /access_token|refresh_token|client_secret/);
});

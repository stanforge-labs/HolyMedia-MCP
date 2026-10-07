import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
test("C rerun cannot execute the old blocked harness or overwrite its records", () => {
  const source = readFileSync(
    new URL("./run-acceptance-c-rerun.py", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /'acceptance-c-rerun-guard.mjs','acceptance-c-rerun.mjs'/,
  );
  assert.match(source, /'\/acceptance\/acceptance-c-rerun.mjs'/);
  assert.doesNotMatch(source, /'acceptance-c.mjs'/);
  assert.match(source, /mcp-preview.service.js:ro/);
  assert.match(source, /runtime_product_module_sha256/);
  assert.match(source, /acceptance-c-rerun-evidence.json/);
});
test("temporary human-approval process cannot reach external providers", async () => {
  const original = globalThis.fetch;
  try {
    await import("./approval-runtime-guard.mjs");
    for (const target of [
      "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:mutate",
      "https://oauth2.googleapis.com/token",
      "https://googleads.googleapis.com/v24/customers/4378327049/googleAds:searchStream",
    ]) {
      await assert.rejects(
        fetch(target, { method: "POST" }),
        /approval_runtime_external_transport_blocked/,
      );
    }
  } finally {
    globalThis.fetch = original;
  }
});

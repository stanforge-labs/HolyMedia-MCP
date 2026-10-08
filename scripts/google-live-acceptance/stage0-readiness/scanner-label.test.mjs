import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { hasForbiddenValue } from "../../v2-secret-scan-policy.mjs";

const forbidden =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-proj-[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{20,}|EA[A-Za-z0-9_-]{30,}/;
test("diagnostic plan label is scanner-safe without adding an exemption", () => {
  const file =
    "scripts/google-live-acceptance/stage0-readiness/stage0-v4-readiness.mjs";
  const source = readFileSync(
    new URL("./stage0-v4-readiness.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("PLAN_PREPARED_NOT_VALIDATED"));
  assert.equal(hasForbiddenValue(file, source, forbidden), false);
  const token = "EA" + "x".repeat(32);
  assert.equal(hasForbiddenValue(file, source + "\n" + token, forbidden), true);
});

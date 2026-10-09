import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hasForbiddenValue } from "../../v2-secret-scan-policy.mjs";
const pattern =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-proj-[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{20,}|EA[A-Za-z0-9_-]{30,}/;
test("checkpoint labels are scanner-safe without exempting new evidence or real credentials", () => {
  const path =
    "artifacts/google-full-scope/final-acceptance-continuation-20261009.json";
  const content = readFileSync(
    new URL("../../../" + path, import.meta.url),
    "utf8",
  );
  assert.equal(hasForbiddenValue(path, content, pattern), false);
  for (const parts of [
    ["FRESH", "READ", "ORIGINAL", "CPC100000", "AND", "UNCHANGED", "FIXTURE"],
    ["BLOCKED", "REAL", "MEDIA", "AND", "GOAL", "PREREQUISITES"],
  ])
    assert.equal(
      hasForbiddenValue(
        path,
        JSON.stringify({ semantic_label: parts.join("_") }),
        pattern,
      ),
      true,
    );
  assert.equal(
    hasForbiddenValue(path, content + "\n" + "EA" + "a".repeat(40), pattern),
    true,
  );
});

test("L closeout checkpoint stays scan-safe and has no credential exemption", () => {
  const path =
    "artifacts/google-full-scope/L-closeout-I-readiness-checkpoint-20261010.json";
  const content = readFileSync(
    new URL("../../../" + path, import.meta.url),
    "utf8",
  );
  assert.equal(hasForbiddenValue(path, content, pattern), false);
  const unsafeLabel = [
    "BLOCKED",
    "REAL",
    "CLIENT",
    "AND",
    "PRIVATE",
    "NATIVE",
    "TRANSPORT",
    "NOT",
    "CONNECTED",
  ].join("_");
  assert.equal(
    hasForbiddenValue(path, JSON.stringify({ Q_R: unsafeLabel }), pattern),
    true,
  );
  assert.equal(
    hasForbiddenValue(path, content + "\n" + "EA" + "a".repeat(40), pattern),
    true,
  );
});

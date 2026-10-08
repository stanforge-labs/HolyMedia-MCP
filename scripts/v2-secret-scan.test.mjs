import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import {
  hasForbiddenValue,
  matchesReviewedFinding,
} from "./v2-secret-scan-policy.mjs";

const pattern =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|sk-proj-[A-Za-z0-9_-]{20,}|GOCSPX-[A-Za-z0-9_-]{20,}|EA[A-Za-z0-9_-]{30,}/;
const status = "CREATE_PASS_" + "WAITING_FOR_MEMBERS_APPROVAL";
const hit = "EATE_PASS_" + "WAITING_FOR_MEMBERS_APPROVAL";
const content = JSON.stringify({ acceptance: { E: { status } } });
const pin = Object.freeze({
  file: "test-evidence.json",
  value: hit,
  status,
  sha256: createHash("sha256").update(content).digest("hex"),
});

test("review requires exact file, complete content hash, match and JSON status", () => {
  assert.equal(matchesReviewedFinding(pin.file, content, hit, pin), true);
  assert.equal(matchesReviewedFinding("other.json", content, hit, pin), false);
  assert.equal(
    matchesReviewedFinding(pin.file, content + "\n", hit, pin),
    false,
  );
  assert.equal(matchesReviewedFinding(pin.file, content, "other", pin), false);
  assert.equal(
    matchesReviewedFinding(pin.file, "invalid JSON", hit, pin),
    false,
  );
  assert.equal(
    matchesReviewedFinding(pin.file, content, hit, { ...pin, status: "other" }),
    false,
  );
});

test("production scanner does not accept arbitrary test review pins", () => {
  assert.equal(hasForbiddenValue(pin.file, content, pattern), true);
  assert.equal(
    hasForbiddenValue("ordinary.json", "ordinary safe text", pattern),
    false,
  );
});

test("all credential families and multiple matches retain detection", () => {
  const samples = [
    "EA" + "x".repeat(40),
    "sk-proj-" + "x".repeat(25),
    "GOCSPX-" + "x".repeat(25),
    "-----BEGIN " + "PRIVATE KEY-----",
    "-----BEGIN " + "RSA PRIVATE KEY-----",
    "-----BEGIN " + "EC PRIVATE KEY-----",
    "-----BEGIN " + "OPENSSH PRIVATE KEY-----",
  ];
  for (const value of samples) {
    assert.equal(hasForbiddenValue("sample.json", value, pattern), true);
    assert.equal(hasForbiddenValue(pin.file, content + value, pattern), true);
  }
  assert.equal(hasForbiddenValue(pin.file, samples.join("\n"), pattern), true);
});

const historical =
  "artifacts/google-live-acceptance/stage1-completion-checkpoint-20261008-e-created-members-awaiting-approval.json";
test(
  "local immutable historical enum is allowed, any added secret remains blocked",
  { skip: !existsSync(historical) },
  () => {
    const original = readFileSync(historical, "utf8");
    assert.equal(hasForbiddenValue(historical, original, pattern), false);
    assert.equal(hasForbiddenValue("other.json", original, pattern), true);
    assert.equal(hasForbiddenValue(historical, original + "\n", pattern), true);
    assert.equal(
      hasForbiddenValue(historical, original + "EA" + "x".repeat(40), pattern),
      true,
    );
    const withSecret = JSON.stringify({
      ...JSON.parse(original),
      unexpected: "sk-proj-" + "x".repeat(25),
    });
    assert.equal(hasForbiddenValue(historical, withSecret, pattern), true);
  },
);

test("existing forbidden paths and credential families were not narrowed", () => {
  const source = readFileSync(
    new URL("./v2-secret-scan.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("connections\\.json"));
  assert.ok(source.includes(".*\\.backup|.*\\.bak|.*\\.log"));
  assert.ok(source.includes("EA[A-Za-z0-9_-]{30,}"));
  assert.ok(
    source.includes("hasForbiddenValue(file, content, forbiddenValue)"),
  );
});

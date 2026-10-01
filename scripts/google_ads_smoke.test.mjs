import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { check, moneyAmount, withinTwoPercent } from "./google_ads_smoke.mjs";

test("numeric tolerance and money parsing", () => {
  assert.equal(withinTwoPercent(9.08, 9.08), true);
  assert.equal(withinTwoPercent(9.2, 9.08), true);
  assert.equal(withinTwoPercent(9.3, 9.08), false);
  assert.equal(moneyAmount({ amount: "1015.602162" }), 1015.602162);
  assert.equal(Number.isNaN(moneyAmount(null)), true);
});

test("live mode refuses before any MCP call", () => {
  const path = fileURLToPath(
    new URL("./google_ads_smoke.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [path], {
    env: {
      ...process.env,
      GOOGLE_ADS_WRITE_MODE: "live",
      GOOGLE_ADS_SMOKE_MCP_URL: "https://example.invalid/mcp",
      GOOGLE_ADS_SMOKE_BEARER_TOKEN: "test-only",
    },
    encoding: "utf8",
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /SMOKE REFUSED/);
  assert.doesNotMatch(result.stdout, /EXPECTED/);
});

test("check emits EXPECTED, ACTUAL and PASS/FAIL", () => {
  const messages = [];
  const original = console.log;
  console.log = (message) => messages.push(message);
  try {
    assert.equal(check("case", "expected", "actual", true), true);
    assert.equal(check("case", "expected", "actual", false), false);
  } finally {
    console.log = original;
  }
  assert.match(messages[0], /EXPECTED: expected.*ACTUAL: actual.*PASS/s);
  assert.match(messages[1], /EXPECTED: expected.*ACTUAL: actual.*FAIL/s);
});

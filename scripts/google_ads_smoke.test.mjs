import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  check,
  isReferenceExactKeyword,
  moneyAmount,
  visitNegativePages,
  withinTwoPercent,
} from "./google_ads_smoke.mjs";

test("exact keyword reference accepts Google text plus separate match type", () => {
  assert.equal(
    isReferenceExactKeyword({ text: "приват клиника", match_type: "EXACT" }),
    true,
  );
  assert.equal(
    isReferenceExactKeyword({
      text: "  ПРИВАТ   КЛИНИКА ",
      match_type: "EXACT",
    }),
    true,
  );
  assert.equal(
    isReferenceExactKeyword({ text: "приват клиника", match_type: "BROAD" }),
    false,
  );
  assert.equal(
    isReferenceExactKeyword({
      text: "приват клиника алматы",
      match_type: "EXACT",
    }),
    false,
  );
});

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

test("negative smoke visitor follows cursor with read tool only", async () => {
  const calls = [];
  const seen = [];
  await visitNegativePages(
    async (name, args) => {
      calls.push([name, args]);
      return {
        campaign: { campaigns: [] },
        ad_group: { campaigns: [] },
        shared_list: { lists: [] },
        next_cursor: args.cursor ? null : "page-two",
      };
    },
    "9458996580",
    (data) => seen.push(data),
    ["123"],
  );
  assert.equal(seen.length, 2);
  assert.deepEqual(
    calls.map(([name]) => name),
    ["google_ads_list_negatives", "google_ads_list_negatives"],
  );
  assert.deepEqual(calls[1][1], {
    account_id: "9458996580",
    campaign_ids: ["123"],
    limit: 500,
    cursor: "page-two",
  });
});

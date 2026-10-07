import { test } from "node:test";
import assert from "node:assert/strict";
globalThis.fetch = async () => {
  throw new Error("no_network_in_test");
};
const { permitted, input, denialProven } =
  await import("./acceptance-p-guard.mjs");
const req = (name, args) => ({
  method: "POST",
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  }),
});
test("MCP refusal need not fabricate account_not_found; no transport and no preview creation are mandatory", () => {
  assert.equal(denialProven(true, false, false), true);
  assert.equal(denialProven(false, false, false), false);
  assert.equal(denialProven(true, true, false), false);
  assert.equal(denialProven(true, false, true), false);
});
test("only exact local denial probe is allowed; every provider endpoint and actual commit blocked", () => {
  assert.equal(permitted("http://127.0.0.1:4000/ready"), true);
  assert.equal(
    permitted(
      "http://127.0.0.1:4000/mcp",
      req("pause_entities_preview", input),
    ),
    true,
  );
  assert.equal(
    permitted("http://127.0.0.1:4000/mcp", req("commit_preview", {})),
    false,
  );
  for (const url of [
    "https://googleads.googleapis.com/v24/customers/8590146099/adGroupCriteria:mutate",
    "https://googleads.googleapis.com/v24/customers/4378327049/googleAds:searchStream",
    "https://oauth2.googleapis.com/token",
  ])
    assert.equal(permitted(url, { method: "POST" }), false);
});

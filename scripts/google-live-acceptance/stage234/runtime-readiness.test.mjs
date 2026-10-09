import test from "node:test";
import assert from "node:assert/strict";
import {
  diagnosticRequest,
  readinessOnlyFetch,
} from "./runtime-readiness-guard.mjs";
test("commit-enabled readiness diagnostics allow authenticated DB-only MCP but block every preview, approval and mutation", async () => {
  for (const name of [
    "commit_preview",
    "preview_rollback_commit",
    "google_ads_bid_budget_preview",
  ])
    assert.throws(
      () =>
        diagnosticRequest("http://127.0.0.1:4000/mcp", {
          method: "POST",
          body: JSON.stringify({
            jsonrpc: "2.0",
            method: "tools/call",
            params: { name, arguments: {} },
          }),
        }),
      /non_read/,
    );
  for (const url of [
    "https://googleads.googleapis.com/v24/customers/8590146099/adGroups:mutate",
    "https://oauth2.googleapis.com/token",
    "http://127.0.0.1:4001/mcp/approve",
  ])
    assert.throws(() => diagnosticRequest(url), /external/);
  assert.equal(
    diagnosticRequest("http://127.0.0.1:4000/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
    }),
    "tools",
  );
  let calls = 0;
  const fetch = readinessOnlyFetch(async () => {
    calls++;
    return true;
  });
  assert.throws(
    () =>
      fetch("http://127.0.0.1:4000/mcp", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            name: "get_account_status",
            arguments: { provider: "GOOGLE_ADS", account_id: "4378327049" },
          },
        }),
      }),
    /non_read/,
  );
  assert.equal(calls, 0);
});

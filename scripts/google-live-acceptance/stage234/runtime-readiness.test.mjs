import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  diagnosticRequest,
  readinessOnlyFetch,
  assertReadinessKey,
} from "./runtime-readiness-guard.mjs";
function renewedProof() {
  const now = Date.parse("2026-10-11T17:00:00Z");
  const context = {
    key_id: "d800a22e-64a1-4cd2-94bb-cfc85008f4fc",
    service_token: "test-only-proof-not-a-service-key",
    expires_at: new Date(now + 3600000).toISOString(),
  };
  const key = {
    id: context.key_id,
    tokenDigest: createHash("sha256")
      .update(context.service_token)
      .digest("hex"),
    expiresAt: new Date(context.expires_at),
    resourceAccessMode: "STATIC_ALLOWLIST",
    accountIds: ["internal-test-account"],
    scopes: ["adforge:mcp:write", "adforge:mcp:read"],
    serviceIdentity: {
      createdById: "test-owner",
      workspaceId: "test-workspace",
    },
  };
  const account = {
    id: "internal-test-account",
    externalAccountId: "8590146099",
    provider: "GOOGLE_ADS",
    enabled: true,
    workspaceId: "test-workspace",
  };
  return { context, key, account, now };
}
test("readiness accepts only exact renewed vault/DB TEST proof, not a pinned historical key", () => {
  const p = renewedProof();
  assert.doesNotThrow(() =>
    assertReadinessKey(p.context, p.key, p.account, p.now),
  );
  const source = readFileSync(
    new URL("./runtime-readiness-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(source.includes("assertReadinessKey(context, key, account)"));
  assert.ok(!source.includes("34cd413a-8aff-4677-9439-abf2a9fb473a"));
});
for (const [label, change] of [
  [
    "wrong vault identity",
    (p) => {
      p.context.key_id = "00000000-0000-0000-0000-000000000000";
    },
  ],
  [
    "token mismatch",
    (p) => {
      p.context.service_token += "x";
    },
  ],
  [
    "expiry mismatch",
    (p) => {
      p.context.expires_at = new Date(p.now + 1).toISOString();
    },
  ],
  [
    "expired",
    (p) => {
      p.key.expiresAt = new Date(p.now);
      p.context.expires_at = p.key.expiresAt.toISOString();
    },
  ],
  [
    "scope expansion",
    (p) => {
      p.key.scopes.push("admin");
    },
  ],
  [
    "extra account",
    (p) => {
      p.key.accountIds.push("other");
    },
  ],
  [
    "MCC target",
    (p) => {
      p.account.externalAccountId = "4378327049";
    },
  ],
  [
    "foreign workspace",
    (p) => {
      p.account.workspaceId = "other";
    },
  ],
  [
    "revoked identity",
    (p) => {
      p.key.serviceIdentity.revokedAt = new Date(p.now);
    },
  ],
])
  test(`renewed readiness rejects ${label} before any request`, () => {
    const p = renewedProof();
    change(p);
    assert.throws(
      () => assertReadinessKey(p.context, p.key, p.account, p.now),
      /key_invalid/,
    );
  });
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

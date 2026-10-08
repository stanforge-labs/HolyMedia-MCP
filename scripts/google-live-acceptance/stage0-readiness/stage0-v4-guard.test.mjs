import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  makeBrief,
  invalidBrief,
  hierarchyQuery,
} from "./stage0-v4-contract.mjs";
const root = mkdtempSync(join(tmpdir(), "stage0-readiness-"));
process.env.ACCEPTANCE_STATE_DIR = root;
globalThis.fetch = async () => {
  throw Error("no_real_network");
};
const { validateRequest, prefix } = await import("./stage0-v4-guard.mjs"),
  brief = makeBrief("20261008T170000Z"),
  invalid = invalidBrief(brief),
  save = (suffix, value) =>
    writeFileSync(join(root, prefix + suffix + ".json"), JSON.stringify(value));
save("-inputs", { brief, invalid });
const req = (b) => ({
    method: "POST",
    headers: { "login-customer-id": "4378327049" },
    body: JSON.stringify(b),
  }),
  rpc = (name, arguments_) =>
    req({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name, arguments: arguments_ },
    }),
  endpoint =
    "https://googleads.googleapis.com/v24/customers/8590146099/googleAds:mutate";
test("T fixture2groups10keywords2RSA4sitelinks+UTM, Uexact31text, ordinarymoney", () => {
  assert.equal(brief.ad_groups.length, 2);
  assert.equal(brief.ad_groups.flatMap((g) => g.keywords).length, 10);
  assert.equal(brief.ad_groups.flatMap((g) => g.rsa).length, 2);
  assert.equal(brief.assets.sitelinks.length, 4);
  assert.equal(invalid.ad_groups[0].rsa[0].headlines[0].text.length, 31);
  assert.equal(brief.daily_budget.amount, "2");
  assert.throws(() => makeBrief("20261008T170000.123Z"));
});
test("prepare permits only exact U and V, no createpreview/commit/approval", () => {
  process.env.ACCEPTANCE_STAGE0_MODE = "prepare";
  const api = "http://127.0.0.1:4000/mcp";
  assert.equal(
    validateRequest(api, rpc("create_campaign_from_brief", invalid)),
    "invalid_rsa",
  );
  assert.equal(
    validateRequest(
      api,
      rpc("get_launch_checklist", {
        provider: "GOOGLE_ADS",
        account_id: "8590146099",
        campaign_id: "24324170853",
      }),
    ),
    "checklist",
  );
  for (const [n, a] of [
    ["create_campaign_from_brief", brief],
    ["commit_preview", {}],
    ["confirm_preview", {}],
    [
      "get_launch_checklist",
      {
        provider: "GOOGLE_ADS",
        account_id: "9999999999",
        campaign_id: "24324170853",
      },
    ],
  ])
    assert.throws(() => validateRequest(api, rpc(n, a)));
  assert.throws(() => validateRequest(endpoint, req({ validateOnly: false })));
});
const ops = [
    {
      campaignOperation: {
        create: {
          resourceName: "customers/8590146099/campaigns/-2",
          status: "PAUSED",
        },
      },
    },
  ],
  body = { mutateOperations: ops, validateOnly: true, partialFailure: false };
save("-prepared-plan", { provider_operations: ops });
const proof = {
  customer_id: "8590146099",
  test_account: true,
  hierarchy: true,
  verified_at: new Date().toISOString(),
};
save("-preview-test-proof", proof);
Object.assign(process.env, {
  V2_PREVIEW_ONLY: "true",
  V2_CONFIRMED_WRITE_ENABLED: "false",
  PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
  GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
  PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
  PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
});
test("atomic validation only exactprepared ops; actualmutation andotheraccounts denied", () => {
  process.env.ACCEPTANCE_STAGE0_MODE = "preview";
  assert.equal(validateRequest(endpoint, req(body)), "validate_only");
  for (const d of [
    { validateOnly: false },
    { partialFailure: true },
    { mutateOperations: [] },
    { mutateOperations: [{ ...ops[0], extra: {} }] },
  ])
    assert.throws(() => validateRequest(endpoint, req({ ...body, ...d })));
  for (const id of ["4378327049", "9999999999"])
    assert.throws(() =>
      validateRequest(endpoint.replace("8590146099", id), req(body)),
    );
});
test("proof andallowlist cannotbypass", () => {
  for (const d of [
    { test_account: false },
    { hierarchy: false },
    { customer_id: "4378327049" },
    { verified_at: new Date(0).toISOString() },
  ]) {
    save("-preview-test-proof", { ...proof, ...d });
    assert.throws(() => validateRequest(endpoint, req(body)));
  }
  save("-preview-test-proof", proof);
  process.env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST = "8590146099,4378327049";
  assert.throws(() => validateRequest(endpoint, req(body)));
});
test("only filtered TESTclient hierarchy viaMCC; foreignqueries andarbitraryroute denied", () => {
  const base =
    "https://googleads.googleapis.com/v24/customers/4378327049/googleAds:searchStream";
  assert.equal(
    validateRequest(base, req({ query: hierarchyQuery })),
    "read_mcc",
  );
  assert.throws(() =>
    validateRequest(base, req({ query: "SELECT customer.id FROM customer" })),
  );
  assert.throws(() =>
    validateRequest(
      base.replace("4378327049", "9999999999"),
      req({ query: hierarchyQuery }),
    ),
  );
  assert.throws(() => validateRequest("https://evil.example/", req({})));
});
test("parent preserveshistory/fullfixture and Udeniesbeforeprovider; noMCPcommit", () => {
  const s = readFileSync(
    new URL("./stage0-v4-readiness.mjs", import.meta.url),
    "utf8",
  );
  for (const a of [
    "stage0_U_validation_invariant_failed",
    "stage0_V_missing_goal_not_detected",
    "stage0_historical_database_changed",
    "stage0_fixture_changed",
    "stage0_T_created_during_preview",
    "F_RESTORE_NEW_PASS",
  ])
    assert.ok(s.includes(a), a);
  assert.ok(!s.includes("mcp('commit_preview'"));
});

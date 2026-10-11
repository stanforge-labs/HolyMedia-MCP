import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import {
  restoreJTool,
  assertRestoreJPlan,
  classifyRestoreJ,
} from "./geo-restore-guard.mjs";
import {
  J_QUERIES,
  target,
  sourceHead,
  imageDigest,
} from "./geo-preview-guard.mjs";
const { tsImport } = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
)("tsx/esm/api");
import { restoreFixture } from "./geo-restore-fixture.mjs";
test("J stock restore plan removes only two actual origin IDs, preserves city and PAUSED parent, explicit irreversible warning", async () => {
  const { origin, plan, reads } = await restoreFixture(),
    payload = assertRestoreJPlan(plan, origin);
  assert.equal(payload.validateOnly, true);
  assert.equal(payload.partialFailure, true);
  assert.equal(payload.mutateOperations.length, 2);
  assert.ok(
    plan.items.every((i) => i.warnings.some((w) => w.includes("необратимо"))),
  );
  assert.equal(new Set(reads).size, 4);
  assert.ok(
    plan.operations.every((o) => !o.resource_name.endsWith("~9235214")),
  );
  for (const change of [
    (p) =>
      (p.operations[0].resource_name = p.operations[0].resource_name.replace(
        "~11",
        "~9235214",
      )),
    (p) => (p.operations[0].fields = { status: "PAUSED" }),
    (p) => (p.operations[1].before.proximity.radius = 3),
    (p) => (p.items[0].ad_group_id = target.group),
    (p) => (p.irreversible = false),
    (p) => p.checks.pop(),
  ]) {
    const p = structuredClone(plan);
    change(p);
    assert.throws(() => assertRestoreJPlan(p, origin));
  }
});
test("J restoration refuses missing origin journal, foreign ownership, wrong actual criterion, or duplicated/resource substitution", async () => {
  const { origin } = await restoreFixture();
  for (const change of [
    (o) => (o.journal.result = "UNVERIFIED"),
    (o) => (o.test_customer_id = target.mcc),
    (o) => (o.created_criteria[0].criterion_id = "9235214"),
    (o) => (o.created_criteria[0].provider_state.negative = false),
    (o) => (o.created_criteria[1].provider_state.proximity.radius = 3),
    (o) => (o.commit.items[0].operations[0].success = false),
  ]) {
    const o = structuredClone(origin);
    change(o);
    assert.throws(() => restoreJTool(o));
  }
});
test("J restore transport preview and validate_only only; no commit/self approval/real remove/foreign payload", async () => {
  const state = await restoreFixture(),
    payload = assertRestoreJPlan(state.plan, state.origin),
    url = `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:mutate`,
    req = (b) => ({
      method: "POST",
      headers: { "login-customer-id": target.mcc },
      body: JSON.stringify(b),
    }),
    rpc = {
      jsonrpc: "2.0",
      id: "stage234-J-restore-preview",
      method: "tools/call",
      params: restoreJTool(state.origin),
    };
  assert.equal(classifyRestoreJ(url, req(payload), state), "validate_only");
  assert.equal(
    classifyRestoreJ("http://127.0.0.1:4000/mcp", req(rpc), state),
    "mcp_preview",
  );
  for (const [u, b] of [
    [url, { ...payload, validateOnly: false }],
    [url.replace(target.customer, target.mcc), payload],
    [
      "http://127.0.0.1:4000/mcp",
      {
        ...rpc,
        params: {
          name: "commit_preview",
          arguments: { preview_token: "MOCK" },
        },
      },
    ],
    ["http://127.0.0.1:4001/api/v1/mcp/public/approval", {}],
  ])
    assert.throws(() => classifyRestoreJ(u, req(b), state));
});
test("J restore prechecks finish before JIT; no auto approval/commit/retry or fake IDs in runner", () => {
  const s = readFileSync(
    new URL("./geo-restore-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(s.indexOf("stock_api_ready") < s.indexOf("J_RESTORE_JIT_PREVIEW"));
  assert.ok(
    s.indexOf("STAGE234_J_RESTORE_PREPARE_ONLY") < s.indexOf("stock_api_ready"),
  );
  assert.doesNotMatch(s, /name:\s*"commit_preview"/);
  assert.ok(s.includes("stage234_j_restore_fixture_changed_before_preview"));
  assert.ok(s.includes("stage234_j_restore_pending_before_preview"));
});

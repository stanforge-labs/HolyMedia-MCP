import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { restoreFixture } from "./geo-restore-fixture.mjs";
import {
  assertRestoreJApproval,
  classifyRestoreJCommit,
  removedGeoQueries,
} from "./geo-restore-commit-guard.mjs";
import { assertRestoredJ } from "./geo-restore-verification.mjs";
import { target, digest, assertRestoreJPlan } from "./geo-restore-guard.mjs";
async function approved() {
  const f = await restoreFixture(),
    now = Date.now(),
    future = new Date(now + 600000).toISOString(),
    id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const context = {
    preview: { preview_id: id, preview_token: "synthetic-preview" },
    service_token: "synthetic-service",
    key_id: "key",
    expires_at: future,
  };
  const account = {
    id: "account",
    workspaceId: "workspace",
    connectionId: "connection",
    provider: "GOOGLE_ADS",
    externalAccountId: target.customer,
    enabled: true,
  };
  const key = {
    id: "key",
    expiresAt: future,
    tokenDigest: digest(context.service_token),
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    accountIds: [account.id],
    resourceAccessMode: "STATIC_ALLOWLIST",
    serviceIdentity: { workspaceId: "workspace", createdById: "human" },
  };
  const stored = {
    id,
    workspaceId: "workspace",
    principalType: "SERVICE_TOKEN",
    serviceTokenId: "key",
    accountId: "account",
    connectionId: "connection",
    provider: "GOOGLE_ADS",
    previewTokenDigest: digest(context.preview.preview_token),
    confirmedAt: new Date(now - 1000).toISOString(),
    approvalSessionId: "session",
    approvedByUserId: "human",
    commitStatus: "CONFIRMED",
    expiresAt: future,
    operation: "GOOGLE_STAGE3_TARGETING",
    diff: { provider_validation: "passed" },
    snapshotDigest: digest(f.plan),
    requestedState: f.plan,
    beforeState: f.plan.checks,
  };
  const session = {
      id: "session",
      userId: "human",
      expiresAt: future,
      user: { status: "active" },
    },
    approval = {
      eventType: "mcp_preview_web_approved",
      targetId: id,
      workspaceId: "workspace",
      actorType: "HUMAN",
      actorUserId: "human",
      success: true,
      createdAt: new Date(now - 500).toISOString(),
    };
  const env = {
    ...f.env,
    V2_PREVIEW_ONLY: "false",
    V2_CONFIRMED_WRITE_ENABLED: "true",
    STAGE234_EXPLICIT_COMMIT_AUTHORIZED: "true",
    STAGE234_HARNESS_HEAD: "b".repeat(40),
    STAGE234_EXPECTED_I_PREVIEW: id,
    API_PORT: "4000",
    STAGE234_GUARD_PRELOAD: "0",
    STAGE234_I_GUARD_PRELOAD: "0",
    STAGE234_L_GUARD_PRELOAD: "0",
    STAGE234_L_COMMIT_GUARD_PRELOAD: "0",
  };
  return {
    ...f,
    context,
    account,
    key,
    stored,
    session,
    approval,
    env,
    now,
    id,
  };
}
test("J restore persisted approval rejects expired, consumed, attempted, foreign, tampered and missing audit", async () => {
  const f = await approved();
  assertRestoreJApproval(f, f.id, f.origin, f.now);
  for (const change of [
    (x) => (x.stored.confirmedAt = null),
    (x) => (x.session.revokedAt = new Date().toISOString()),
    (x) => (x.approval.success = false),
    (x) => (x.stored.expiresAt = new Date(x.now - 1).toISOString()),
    (x) => (x.stored.consumedAt = new Date().toISOString()),
    (x) => (x.stored.commitAttemptedAt = new Date().toISOString()),
    (x) => (x.account.externalAccountId = target.mcc),
    (x) => (x.stored.requestedState.operations[0].resource_name += "0"),
  ]) {
    const x = structuredClone(f);
    change(x);
    assert.throws(() => assertRestoreJApproval(x, x.id, x.origin, x.now));
  }
});
test("J restore transport only two approved removes; no validation, self approval or other account", async () => {
  const f = await approved(),
    state = {
      ...f,
      authority: assertRestoreJApproval(f, f.id, f.origin, f.now),
    },
    url =
      "https://googleads.googleapis.com/v24/customers/" +
      target.customer +
      "/googleAds:mutate",
    body = { ...assertRestoreJPlan(f.plan, f.origin), validateOnly: false },
    req = (b) => ({
      method: "POST",
      headers: { "login-customer-id": target.mcc },
      body: JSON.stringify(b),
    });
  assert.equal(classifyRestoreJCommit(url, req(body), state), "write");
  assert.equal(
    classifyRestoreJCommit(
      "http://127.0.0.1:4000/mcp",
      req({
        jsonrpc: "2.0",
        id: "stage234-J-restore-commit",
        method: "tools/call",
        params: {
          name: "commit_preview",
          arguments: { preview_token: f.context.preview.preview_token },
        },
      }),
      state,
    ),
    "mcp_commit",
  );
  for (const [u, b] of [
    [url, { ...body, validateOnly: true }],
    [url.replace(target.customer, target.mcc), body],
    [url, { ...body, partialFailure: false }],
    [url, { ...body, mutateOperations: body.mutateOperations.slice(0, 1) }],
    ["http://127.0.0.1:4001/api/v1/mcp/public/approval", {}],
  ])
    assert.throws(() => classifyRestoreJCommit(u, req(b), state));
  for (const q of removedGeoQueries(f.origin))
    assert.equal(
      classifyRestoreJCommit(
        url.replace("googleAds:mutate", "googleAds:searchStream"),
        req({ query: q }),
        state,
      ),
      "read",
    );
});
test("J restore exact acknowledgement and absent/REMOVED prove original snapshot; partials and neighbors fail", async () => {
  const f = await approved(),
    created = f.origin.created_criteria,
    city = f.plan.checks
      .find((c) => c.query.includes("location.geo_target_constant"))
      .rows.find((r) => r.campaignCriterion.resourceName.endsWith("~9235214")),
    before = {
      campaignCriteria: [
        city,
        ...created.map((c) => ({ campaignCriterion: c.provider_state })),
      ],
      parent: "PAUSED",
    },
    after = { campaignCriteria: [city], parent: "PAUSED" },
    origin = {
      ...f.origin,
      provider_state_before: after,
      provider_state_after: before,
    },
    result = {
      status: "VERIFIED",
      account_id: target.customer,
      operation_count: 2,
      atomic: false,
      partial_failure: true,
      irreversible: true,
      commit_id: "hmc_" + "a".repeat(43),
      items: created.map((c, i) => ({
        operations: [
          {
            operation: i,
            success: true,
            error: null,
            resource_name: c.resource_name,
            actual: null,
          },
        ],
      })),
    },
    args = [before, after, result, [[], []], f.plan, origin];
  assert.equal(assertRestoredJ(...args).length, 2);
  const withRemoved = structuredClone(args);
  withRemoved[3][1] = [
    { campaignCriterion: { ...created[1].provider_state, status: "REMOVED" } },
  ];
  assert.equal(assertRestoredJ(...withRemoved).length, 2);
  for (const change of [
    (a) => (a[2].items[1].operations[0].success = false),
    (a) => a[2].items.pop(),
    (a) => (a[3][0] = null),
    (a) => (a[3][0] = [{ campaignCriterion: created[0].provider_state }]),
    (a) => (a[1].parent = "ENABLED"),
    (a) => (a[1].campaignCriteria[0].campaignCriterion.negative = true),
    (a) => (a[2].items[0].operations[0].resource_name += "0"),
  ]) {
    const a = structuredClone(args);
    change(a);
    assert.throws(() => assertRestoredJ(...a));
  }
});
test("J restore runner stock stale checks, single commit and startup before commit", () => {
  const s = readFileSync(
    new URL("./geo-restore-commit-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(s.indexOf("stock_api_ready") < s.indexOf("immutable_commit_once"));
  assert.ok(s.includes("stage234_j_restore_commit_frozen_check_stale"));
  assert.equal((s.match(/name: "commit_preview"/g) ?? []).length, 1);
  assert.ok(s.includes("assertJJournal"));
});

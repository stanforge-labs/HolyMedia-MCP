import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
const { structuredClone } = globalThis;
import {
  assertCommitRuntime,
  assertStoredN,
  assertRestoreOrigin,
  assertCommitProof,
  validateCommitRequest,
  claimCommitOperation,
  target,
  digest,
  commitPayload,
  rollbackPayload,
  installCommitGuard,
} from "./restore-guard.mjs";
import { queries } from "./live-guard.mjs";
const now = Date.now(),
  future = new Date(now + 60000).toISOString();
const env = {
  STAGE234_EXPECTED_ORIGINAL_COMMIT: "hmc_" + "a".repeat(43),
  PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
  PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "true",
  PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
  PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "false",
  GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.customer,
  PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: target.mcc,
  PROVIDER_GOOGLE_API_VERSION: "v24",
  V2_PREVIEW_ONLY: "false",
  V2_CONFIRMED_WRITE_ENABLED: "true",
  PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
  PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  STAGE234_EXPLICIT_COMMIT_AUTHORIZED: "true",
  API_PORT: "4000",
  STAGE234_GUARD_PRELOAD: "0",
  STAGE234_SOURCE_HEAD: "a".repeat(40),
  STAGE234_HARNESS_HEAD: "b".repeat(40),
  STAGE234_IMAGE_DIGEST: "sha256:" + "c".repeat(64),
};
const fixture = () => {
  const context = {
    preview: {
      preview_id: "16224a43-2389-4062-9ffb-766a9abaf1d3",
      preview_token: "synthetic-mcp-opaque",
    },
    service_token: "synthetic-service-opaque",
    original_commit_id: env.STAGE234_EXPECTED_ORIGINAL_COMMIT,
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
    tokenDigest: digest(context.service_token),
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    accountIds: [account.id],
    resourceAccessMode: "STATIC_ALLOWLIST",
    serviceIdentity: { workspaceId: account.workspaceId, createdById: "human" },
  };
  const before = {
    resourceName: target.groupResource,
    status: "PAUSED",
    cpcBidMicros: "110000",
  };
  const plan = {
    version: 2,
    account_id: target.customer,
    operations: [
      {
        kind: "adGroups",
        method: "update",
        resource_name: target.groupResource,
        update_mask: "cpc_bid_micros",
        fields: commitPayload.operations[0].update,
        before,
        expected: { ...before, cpcBidMicros: "100000" },
      },
    ],
    items: [{}],
  };
  const stored = {
    id: context.preview.preview_id,
    principalType: "SERVICE_TOKEN",
    serviceTokenId: key.id,
    workspaceId: account.workspaceId,
    provider: "GOOGLE_ADS",
    accountId: account.id,
    connectionId: account.connectionId,
    operation: "GOOGLE_STAGE2_BID_BUDGET_UPDATE",
    requestedState: plan,
    snapshotDigest: digest(plan),
    previewTokenDigest: digest(context.preview.preview_token),
    confirmedAt: new Date(now - 1000),
    expiresAt: future,
    approvedByUserId: "human",
    approvalSessionId: "session",
    commitStatus: "CONFIRMED",
    diff: { provider_validation: "passed" },
  };
  const session = {
    id: "session",
    userId: "human",
    expiresAt: future,
    user: { status: "active" },
  };
  const approval = {
    targetId: stored.id,
    workspaceId: account.workspaceId,
    actorUserId: "human",
    actorType: "HUMAN",
    eventType: "mcp_preview_web_approved",
    success: true,
    createdAt: new Date(now - 500),
  };
  const proof = {
    customer_id: target.customer,
    mcc_id: target.mcc,
    test_account: true,
    hierarchy: true,
    currency: "USD",
    group_resource: target.groupResource,
    group_cpc_micros: "110000",
    fixture_paused: true,
    fixture_sha256: "d".repeat(64),
    source_head: env.STAGE234_SOURCE_HEAD,
    verified_at: new Date(now).toISOString(),
  };
  return { context, account, key, stored, session, approval, proof };
};
const request = (body) => ({
  method: "POST",
  headers: { "login-customer-id": target.mcc },
  body: JSON.stringify(body),
});
const endpoint = `https://googleads.googleapis.com/v24/customers/${target.customer}/adGroups:mutate`;
const check = (body, overrides = {}) => {
  const f = fixture(),
    authority = assertStoredN(f, now);
  return validateCommitRequest(endpoint, request(body), {
    env,
    context: f.context,
    proof: f.proof,
    authority,
    now,
    ...overrides,
  });
};

test("inverse exact persisted human proof and CPC110000 to100000 only", () => {
  const f = fixture();
  assert.equal(
    f.stored.requestedState.operations[0].before.cpcBidMicros,
    "110000",
  );
  assert.equal(commitPayload.operations[0].update.cpcBidMicros, "100000");
  assert.equal(assertStoredN(f, now).approval_persisted, true);
  assert.equal(check(commitPayload), "write");
  for (const change of [
    (x) => (x.stored.confirmedAt = null),
    (x) => (x.session.revokedAt = new Date()),
    (x) => (x.approval.success = false),
    (x) => (x.stored.expiresAt = new Date(now)),
    (x) => (x.stored.consumedAt = new Date()),
    (x) => (x.stored.commitAttemptedAt = new Date()),
    (x) => (x.account.externalAccountId = target.mcc),
    (x) => (x.stored.snapshotDigest = "bad"),
  ]) {
    const y = fixture();
    change(y);
    assert.throws(() => assertStoredN(y, now));
  }
});
test("origin must be owned VERIFIED consumed one-field original commit with same reread", () => {
  const f = fixture();
  f.context.preview.rollback_of = env.STAGE234_EXPECTED_ORIGINAL_COMMIT;
  const op = {
    kind: "adGroups",
    method: "update",
    resource_name: target.groupResource,
    update_mask: "cpc_bid_micros",
    fields: { resourceName: target.groupResource, cpcBidMicros: "110000" },
    before: { cpcBidMicros: "100000" },
    expected: { cpcBidMicros: "110000" },
  };
  const original = {
    id: "original",
    consumedAt: new Date(),
    commitStatus: "VERIFIED",
    accountId: f.stored.accountId,
    workspaceId: f.stored.workspaceId,
    connectionId: f.stored.connectionId,
    serviceTokenId: f.stored.serviceTokenId,
    operation: "GOOGLE_STAGE2_BID_BUDGET_UPDATE",
    requestedState: { operations: [op] },
    verificationRead: [f.stored.requestedState.operations[0].before],
  };
  original.snapshotDigest = digest(original.requestedState);
  const event = {
    eventType: "mcp_google_commit_result",
    success: true,
    targetId: original.id,
    workspaceId: f.stored.workspaceId,
    metadata: { commitId: env.STAGE234_EXPECTED_ORIGINAL_COMMIT },
  };
  const x = { context: f.context, stored: f.stored, original, event };
  assert.doesNotThrow(() =>
    assertRestoreOrigin(x, env.STAGE234_EXPECTED_ORIGINAL_COMMIT),
  );
  for (const change of [
    (y) => (y.original.consumedAt = null),
    (y) => (y.original.commitStatus = "UNVERIFIED"),
    (y) => (y.original.accountId = "foreign"),
    (y) => (y.event.metadata.commitId = "wrong"),
    (y) => (y.context.preview.rollback_of = "wrong"),
    (y) => (y.original.verificationRead[0] = { cpcBidMicros: "wrong" }),
  ]) {
    const y = structuredClone(x);
    change(y);
    assert.throws(() =>
      assertRestoreOrigin(y, env.STAGE234_EXPECTED_ORIGINAL_COMMIT),
    );
  }
});
test("restore cannot validate again, target MCC, widen payload, use stale or replay claim", () => {
  assert.throws(() => check({ ...commitPayload, validateOnly: true }));
  const wrong = structuredClone(commitPayload);
  wrong.operations[0].update.cpcBidMicros = "110000";
  assert.throws(() => check(wrong));
  const f = fixture();
  assert.throws(() =>
    check(commitPayload, {
      proof: { ...f.proof, verified_at: new Date(now - 300001).toISOString() },
    }),
  );
  assert.throws(() =>
    validateCommitRequest(
      endpoint.replace(target.customer, target.mcc),
      request(commitPayload),
      {
        env,
        context: f.context,
        proof: f.proof,
        authority: assertStoredN(f, now),
        now,
      },
    ),
  );
  const directory = mkdtempSync(join(tmpdir(), "hm-inverse-"));
  claimCommitOperation(directory, "write");
  assert.throws(
    () => claimCommitOperation(directory, "write"),
    /already_attempted/,
  );
});
test("restore runner only calls stock immutable commit and never creates approval, preview or raw provider mutation", () => {
  const s = readFileSync(
    new URL("./restore-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.match(s, /commit_preview/);
  assert.doesNotMatch(s, /preview_rollback_commit|\.mutate\(/);
  assert.ok(
    s.indexOf("await waitLocalReady") <
      s.indexOf('stage = "immutable_commit_once"'),
  );
});

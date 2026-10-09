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
  assertCommitProof,
  validateCommitRequest,
  claimCommitOperation,
  target,
  digest,
  commitPayload,
  rollbackPayload,
  installCommitGuard,
} from "./commit-guard.mjs";
import { queries } from "./live-guard.mjs";
const now = Date.now(),
  future = new Date(now + 60000).toISOString();
const env = {
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
    cpcBidMicros: "100000",
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
        expected: { ...before, cpcBidMicros: "110000" },
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
    group_cpc_micros: "100000",
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
test("N exact persisted HUMAN approval, immutable snapshot, sole CPC mutation", () => {
  const f = fixture();
  assert.equal(assertStoredN(f, now).approval_persisted, true);
  assert.equal(check(commitPayload), "write");
});
test("unauthorized flags and widened allowlist reject before transport", () => {
  assertCommitRuntime(env);
  for (const [key, value] of Object.entries({
    STAGE234_EXPLICIT_COMMIT_AUTHORIZED: "false",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "true",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: `${target.customer},${target.mcc}`,
    STAGE234_HARNESS_HEAD: "latest",
  }))
    assert.throws(() =>
      check(commitPayload, { env: { ...env, [key]: value } }),
    );
});
test("unapproved/expired/consumed/attempted/session/audit/foreign owner fail", () => {
  for (const change of [
    (f) => (f.stored.confirmedAt = null),
    (f) => (f.stored.expiresAt = new Date(now - 1)),
    (f) => (f.stored.consumedAt = new Date()),
    (f) => (f.stored.commitAttemptedAt = new Date()),
    (f) => (f.stored.cancelledAt = new Date()),
    (f) => (f.session.revokedAt = new Date()),
    (f) => (f.session.user.status = "disabled"),
    (f) => (f.session.userId = "foreign"),
    (f) => (f.approval.success = false),
    (f) => (f.approval.actorType = "SERVICE"),
    (f) => (f.approval.targetId = "foreign"),
    (f) => (f.approval.createdAt = new Date(now - 2000)),
    (f) => (f.account.externalAccountId = target.mcc),
    (f) => f.key.accountIds.push("foreign"),
    (f) => (f.key.serviceIdentity.workspaceId = "foreign"),
    (f) => (f.key.serviceIdentity.createdById = "foreign"),
    (f) => (f.key.scopes = ["adforge:mcp:read"]),
    (f) => (f.context.preview.preview_token = "foreign"),
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() => assertStoredN(f, now));
  }
});
test("plan digest and exact fields/mask/before prevent immutable tampering", () => {
  for (const change of [
    (p) => (p.operations[0].fields.cpcBidMicros = "110001"),
    (p) => (p.operations[0].update_mask += ",status"),
    (p) => (p.operations[0].fields.status = "ENABLED"),
    (p) => (p.operations[0].before.cpcBidMicros = "100001"),
    (p) => (p.operations[0].kind = "adGroupCriteria"),
    (p) => (p.account_id = target.mcc),
    (p) => p.operations.push(p.operations[0]),
  ]) {
    const f = fixture();
    f.stored.requestedState = structuredClone(f.stored.requestedState);
    change(f.stored.requestedState);
    // Even recomputing a corrupted digest cannot widen the fixed semantic contract.
    f.stored.snapshotDigest = digest(f.stored.requestedState);
    assert.throws(() => assertStoredN(f, now));
  }
});
test("fresh TRUE TEST/MCC proof required, stale bid blocks before mutation", () => {
  const f = fixture();
  assertCommitProof(f.proof, env, "100000", now);
  for (const replacement of [
    { test_account: false },
    { hierarchy: false },
    { customer_id: target.mcc },
    { group_cpc_micros: "110000" },
    { fixture_paused: false },
    { currency: "KZT" },
    { verified_at: new Date(now - 300001).toISOString() },
    { source_head: "b".repeat(40) },
  ])
    assert.throws(() =>
      check(commitPayload, { proof: { ...f.proof, ...replacement } }),
    );
  assert.throws(() => check(commitPayload, { authority: undefined }));
});
test("only fixed 110000 commit or 100000 validation; raw, mask and amount changes blocked", () => {
  for (const body of [
    { ...commitPayload, validateOnly: true },
    { ...commitPayload, partialFailure: false },
    {
      ...commitPayload,
      operations: [...commitPayload.operations, ...commitPayload.operations],
    },
    { ...commitPayload, responseContentType: "RESOURCE_NAME" },
    {
      ...commitPayload,
      operations: [
        {
          update: {
            resourceName: target.groupResource,
            cpcBidMicros: "100000",
          },
          updateMask: "cpc_bid_micros",
        },
      ],
    },
    { ...commitPayload, operations: [{ remove: target.groupResource }] },
  ])
    assert.throws(() => check(body));
  assert.throws(() => check(rollbackPayload));
  const f = fixture(),
    authority = {
      ...assertStoredN(f, now),
      phase: "rollback",
      commit_id: "hmc_" + "a".repeat(43),
    },
    proof = { ...f.proof, group_cpc_micros: "110000" };
  assert.equal(check(rollbackPayload, { authority, proof }), "validate_only");
  assert.throws(() =>
    check({ ...rollbackPayload, validateOnly: false }, { authority, proof }),
  );
});
test("foreign/MCC/wrong API/raw endpoint never reaches transport", () => {
  const f = fixture(),
    options = {
      env,
      proof: f.proof,
      authority: assertStoredN(f, now),
      context: f.context,
      now,
    };
  for (const url of [
    endpoint.replace(target.customer, target.mcc),
    endpoint.replace(target.customer, "1111111111"),
    endpoint.replace("adGroups", "googleAds"),
    endpoint.replace("v24", "v23"),
    endpoint + "?token=hidden",
    endpoint.replace("https:", "http:"),
  ])
    assert.throws(() =>
      validateCommitRequest(url, request(commitPayload), options),
    );
  assert.throws(() =>
    validateCommitRequest(
      endpoint,
      {
        ...request(commitPayload),
        headers: { "login-customer-id": "1111111111" },
      },
      options,
    ),
  );
});
test("exclusive durable claims deny second commit and second validation before transport", () => {
  const root = mkdtempSync(join(tmpdir(), "hm-n-commit-"));
  for (const kind of [
    "mcp_commit",
    "write",
    "mcp_rollback_preview",
    "validate_only",
  ]) {
    claimCommitOperation(root, kind);
    assert.throws(
      () => claimCommitOperation(root, kind),
      /already_attempted_no_retry/,
    );
  }
  assert.throws(() => claimCommitOperation(root, "approval"));
});
test("mock transport counts one authorized write and one inverse validation, never another mutation", async () => {
  const f = fixture(),
    root = mkdtempSync(join(tmpdir(), "hm-n-flow-"));
  let authority = assertStoredN(f, now),
    proof = f.proof;
  const counts = { write: 0, validate_only: 0 };
  const transport = async (body) => {
    const kind = validateCommitRequest(endpoint, request(body), {
      env,
      authority,
      proof,
      context: f.context,
      now,
    });
    claimCommitOperation(root, kind);
    counts[kind]++;
    return { mocked: true, status: 200 };
  };
  await assert.rejects(
    transport({
      ...commitPayload,
      operations: [{ remove: target.groupResource }],
    }),
  );
  assert.deepEqual(counts, { write: 0, validate_only: 0 });
  await transport(commitPayload);
  await assert.rejects(transport(commitPayload), /already_attempted_no_retry/);
  authority = {
    ...authority,
    phase: "rollback",
    commit_id: "hmc_" + "a".repeat(43),
  };
  proof = { ...proof, group_cpc_micros: "110000" };
  await transport(rollbackPayload);
  await assert.rejects(
    transport(rollbackPayload),
    /already_attempted_no_retry/,
  );
  await assert.rejects(transport({ ...rollbackPayload, validateOnly: false }));
  assert.deepEqual(counts, { write: 1, validate_only: 1 });
});
test("HTTP only exact opaque commit and current-commit rollback, no self approval", () => {
  const f = fixture(),
    authority = assertStoredN(f, now),
    options = { env, proof: f.proof, authority, context: f.context, now };
  const rpc = {
    jsonrpc: "2.0",
    id: "stage234-N-commit",
    method: "tools/call",
    params: {
      name: "commit_preview",
      arguments: { preview_token: f.context.preview.preview_token },
    },
  };
  assert.equal(
    validateCommitRequest("http://127.0.0.1:4000/mcp", request(rpc), options),
    "mcp_commit",
  );
  for (const name of [
    "confirm_preview",
    "google_ads_bid_budget_preview",
    "create_campaign_from_brief",
    "preview_rollback_commit",
  ])
    assert.throws(() =>
      validateCommitRequest(
        "http://127.0.0.1:4000/mcp",
        request({ ...rpc, params: { ...rpc.params, name } }),
        options,
      ),
    );
  assert.throws(() =>
    validateCommitRequest(
      "http://127.0.0.1:4000/mcp",
      request({
        ...rpc,
        params: {
          ...rpc.params,
          arguments: { ...rpc.params.arguments, status: "ENABLED" },
        },
      }),
      options,
    ),
  );
});
test("read queries remain fixed and no account discovery is added", () => {
  const f = fixture(),
    options = {
      env,
      proof: f.proof,
      authority: undefined,
      context: f.context,
      now,
    };
  for (const key of [
    "customer",
    "group",
    "campaign",
    "currency",
    "currencyUnit",
    "fixtureCampaigns",
    "fixtureGroups",
    "fixtureAds",
  ])
    assert.equal(
      validateCommitRequest(
        `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:searchStream`,
        request({ query: queries[key] }),
        options,
      ),
      "read",
    );
  assert.throws(() =>
    validateCommitRequest(
      `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:searchStream`,
      request({ query: "SELECT campaign.id FROM campaign" }),
      options,
    ),
  );
});
test("runner uses stock exact-image MCP/main, never approval or raw adapter writes", () => {
  const source = readFileSync(
    new URL("./commit-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /\/workspace\/apps\/api\/dist\/main\.js/);
  assert.match(source, /mcp\(\s*"commit_preview"/);
  assert.match(source, /mcp\(\s*"preview_rollback_commit"/);
  assert.doesNotMatch(
    source,
    /(?:adapter\.(?:mutate|stage2)|confirm_preview|decideGoogleApproval|\.approve\()/,
  );
  assert.match(source, /flag: "wx"/);
  assert.match(source, /stage234_commit_provider_snapshot_stale/);
  assert.match(source, /const fetch = .*globalThis\.fetch/);
});
test("preload plus direct guard installation is idempotent, changed source identity is rejected", () => {
  const native = globalThis.fetch,
    previous = globalThis.__holyMediaNCommitGuard;
  delete globalThis.__holyMediaNCommitGuard;
  try {
    const runtime = {
      ...env,
      STAGE234_RUN_DIR: "/acceptance-state/stage234-mock",
    };
    installCommitGuard({
      env: runtime,
      nativeFetch: async () => {
        throw Error("mock transport must not run");
      },
    });
    const guarded = globalThis.fetch;
    installCommitGuard({ env: runtime });
    assert.equal(globalThis.fetch, guarded);
    assert.throws(
      () =>
        installCommitGuard({
          env: { ...runtime, STAGE234_SOURCE_HEAD: "f".repeat(40) },
        }),
      /identity_changed/,
    );
  } finally {
    globalThis.fetch = native;
    if (previous) globalThis.__holyMediaNCommitGuard = previous;
    else delete globalThis.__holyMediaNCommitGuard;
  }
});

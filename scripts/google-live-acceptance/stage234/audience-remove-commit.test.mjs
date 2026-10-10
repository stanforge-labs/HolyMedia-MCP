import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  assertRemoveApproval,
  classifyRemoveCommit,
} from "./audience-remove-commit-guard.mjs";
import {
  assertRemovedAudience,
  assertRemoveJournal,
} from "./audience-remove-commit-runner.mjs";
import {
  restoreTool,
  removeQueries,
  sourceHead,
  imageDigest,
  target,
  digest,
  canonical,
} from "./audience-remove-guard.mjs";
const now = Date.now(),
  id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  future = new Date(now + 600000).toISOString();
const fixture = () => {
  const origin = {
    result: "I_ADD_VERIFIED_REMOVE_PENDING",
    source_head: sourceHead,
    image_digest: imageDigest,
    journal: { result: "VERIFIED" },
    real_provider_write_call_count: 0,
    commit_id: "hmc_" + "a".repeat(43),
    created_audience: {
      criterion_id: "51668099935",
      resource_name: `customers/${target.customer}/adGroupCriteria/${target.group}~51668099935`,
      audience_resource: `customers/${target.customer}/userInterests/90100`,
      status: "ENABLED",
      mode: "OBSERVATION",
    },
  };
  const criterion = {
    resourceName: origin.created_audience.resource_name,
    adGroup: target.groupResource,
    status: "ENABLED",
    type: "USER_INTEREST",
    negative: false,
    userInterest: {
      userInterestCategory: origin.created_audience.audience_resource,
    },
  };
  const plan = {
    version: 3,
    account_id: target.customer,
    atomic: false,
    irreversible: true,
    items: [{}],
    intent: restoreTool(origin).arguments,
    checks: removeQueries.slice(1).map((query) => ({ query, rows: [] })),
    operations: [
      {
        kind: "adGroupCriteria",
        method: "remove",
        resource_name: criterion.resourceName,
        fields: {},
        before: criterion,
      },
    ],
  };
  const context = {
    preview: { preview_id: id, preview_token: "synthetic-preview-opaque" },
    service_token: "synthetic-service-opaque",
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
    expiresAt: new Date(future),
    tokenDigest: digest(context.service_token),
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    accountIds: [account.id],
    resourceAccessMode: "STATIC_ALLOWLIST",
    serviceIdentity: { workspaceId: account.workspaceId, createdById: "human" },
  };
  const stored = {
    id,
    principalType: "SERVICE_TOKEN",
    serviceTokenId: key.id,
    workspaceId: account.workspaceId,
    provider: "GOOGLE_ADS",
    accountId: account.id,
    connectionId: account.connectionId,
    operation: "GOOGLE_STAGE3_TARGETING",
    requestedState: plan,
    beforeState: plan.checks,
    snapshotDigest: digest(plan),
    previewTokenDigest: digest(context.preview.preview_token),
    confirmedAt: new Date(now - 1000),
    expiresAt: new Date(future),
    approvedByUserId: "human",
    approvalSessionId: "session",
    commitStatus: "CONFIRMED",
    diff: { provider_validation: "passed" },
  };
  const session = {
    id: "session",
    userId: "human",
    expiresAt: new Date(future),
    user: { status: "active" },
  };
  const approval = {
    targetId: id,
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
    source_head: sourceHead,
    verified_at: new Date(now).toISOString(),
  };
  const env = {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "true",
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
    STAGE234_I_GUARD_PRELOAD: "0",
    STAGE234_L_GUARD_PRELOAD: "0",
    STAGE234_L_COMMIT_GUARD_PRELOAD: "0",
    STAGE234_SOURCE_HEAD: sourceHead,
    STAGE234_IMAGE_DIGEST: imageDigest,
    STAGE234_HARNESS_HEAD: "b".repeat(40),
    STAGE234_EXPECTED_I_PREVIEW: id,
  };
  return structuredClone({
    origin,
    criterion,
    plan,
    context,
    account,
    key,
    stored,
    session,
    approval,
    proof,
    env,
    now,
  });
};
test("remove requires exact persisted human approval/session/owner/key/immutable plan, millisecond TTL", () => {
  const f = fixture();
  assert.equal(
    assertRemoveApproval(f, id, f.origin, now).phase,
    "remove_commit",
  );
  for (const edit of [
    (f) => (f.stored.confirmedAt = null),
    (f) => (f.approval.success = false),
    (f) => (f.session.revokedAt = new Date()),
    (f) => (f.session.expiresAt = new Date(now)),
    (f) => (f.key.expiresAt = new Date(now)),
    (f) => (f.stored.expiresAt = new Date(now)),
    (f) => (f.stored.consumedAt = new Date()),
    (f) => (f.stored.commitAttemptedAt = new Date()),
    (f) => (f.stored.requestedState.operations[0].resource_name = "foreign"),
    (f) => (f.account.externalAccountId = target.mcc),
    (f) => f.key.scopes.push("admin"),
    (f) => (f.context.preview.preview_token = "other"),
    (f) => (f.stored.beforeState = []),
  ]) {
    const f = fixture();
    edit(f);
    assert.throws(() => assertRemoveApproval(f, id, f.origin, now));
  }
});
test("only exact immutable removal mutation and commit token; no revalidation/approval/foreign target", () => {
  const f = fixture(),
    authority = assertRemoveApproval(f, id, f.origin, now),
    options = { ...f, authority };
  const url = `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:mutate`,
    body = {
      mutateOperations: [
        { adGroupCriterionOperation: { remove: f.criterion.resourceName } },
      ],
      partialFailure: true,
      validateOnly: false,
    },
    init = {
      method: "POST",
      headers: { "login-customer-id": target.mcc },
      body: JSON.stringify(body),
    };
  assert.equal(classifyRemoveCommit(url, init, options), "write");
  for (const b of [
    { ...body, validateOnly: true },
    { ...body, partialFailure: false },
    { ...body, mutateOperations: [] },
    {
      ...body,
      mutateOperations: [
        {
          adGroupCriterionOperation: {
            remove: `customers/${target.customer}/adGroupCriteria/${target.group}~11743561`,
          },
        },
      ],
    },
  ])
    assert.throws(() =>
      classifyRemoveCommit(url, { ...init, body: JSON.stringify(b) }, options),
    );
  assert.throws(() =>
    classifyRemoveCommit(
      url.replace(target.customer, target.mcc),
      init,
      options,
    ),
  );
  assert.throws(() =>
    classifyRemoveCommit(url, init, { ...options, authority: null }),
  );
  const rpc = {
    jsonrpc: "2.0",
    id: "stage234-I-remove-commit",
    method: "tools/call",
    params: {
      name: "commit_preview",
      arguments: { preview_token: f.context.preview.preview_token },
    },
  };
  assert.equal(
    classifyRemoveCommit(
      "http://127.0.0.1:4000/mcp",
      { method: "POST", body: JSON.stringify(rpc) },
      options,
    ),
    "mcp_commit",
  );
  rpc.params.name = "google_ads_targeting_preview";
  assert.throws(() =>
    classifyRemoveCommit(
      "http://127.0.0.1:4000/mcp",
      { method: "POST", body: JSON.stringify(rpc) },
      options,
    ),
  );
});
const poststate = () => {
  const f = fixture(),
    before = {
      groupAudiences: [
        { adGroupCriterion: f.criterion },
        {
          adGroupCriterion: {
            resourceName: "unchanged-keyword",
            status: "ENABLED",
          },
        },
      ],
      group: [
        {
          adGroup: {
            resourceName: target.groupResource,
            status: "PAUSED",
            targetingSetting: {
              targetRestrictions: [
                { targetingDimension: "AUDIENCE", bidOnly: true },
              ],
            },
          },
        },
      ],
      ads: [{ status: "PAUSED" }],
    };
  const after = structuredClone(before);
  after.groupAudiences.shift();
  const removed = [{ adGroupCriterion: { ...f.criterion, status: "REMOVED" } }];
  const result = {
    status: "VERIFIED",
    preview_id: id,
    commit_id: "hmc_" + "c".repeat(43),
    account_id: target.customer,
    operation_count: 1,
    atomic: false,
    partial_failure: true,
    irreversible: true,
    items: [
      {
        operations: [
          {
            operation: 0,
            success: true,
            error: null,
            resource_name: f.criterion.resourceName,
            actual: null,
          },
        ],
      },
    ],
  };
  return { ...f, before, after, removed, result };
};
test("provider removal proof requires REMOVED, preserves every neighbor and OBSERVATION", () => {
  const f = poststate();
  assert.equal(
    assertRemovedAudience(f.before, f.after, f.result, f.removed, f.origin)
      .status,
    "REMOVED",
  );
  for (const edit of [
    (f) => (f.removed = []),
    (f) => (f.removed[0].adGroupCriterion.status = "ENABLED"),
    (f) =>
      (f.after.group[0].adGroup.targetingSetting.targetRestrictions[0].bidOnly = false),
    (f) => (f.after.ads[0].status = "ENABLED"),
    (f) => (f.after.groupAudiences[0].adGroupCriterion.status = "PAUSED"),
  ]) {
    const f = poststate();
    edit(f);
    assert.throws(() =>
      assertRemovedAudience(f.before, f.after, f.result, f.removed, f.origin),
    );
  }
});
test("remove audit separates attempted and terminal; actual null is valid removed post-state", () => {
  const f = poststate(),
    original = f.stored,
    stored = { ...original, consumedAt: new Date(), commitStatus: "VERIFIED" };
  const meta = {
    provider: "GOOGLE_ADS",
    accountId: target.customer,
    campaignId: target.campaign,
    adGroupId: target.group,
    previewId: id,
    commitId: f.result.commit_id,
    operation: "targeting",
    providerOperation: 0,
    googleErrorCode: null,
    objectId: f.criterion.resourceName,
    before: "before",
    after: "after",
    actual: canonical(null),
  };
  const events = ["attempted", "success"].map((result, i) => ({
    eventType: "mcp_google_stage1_operation",
    success: true,
    targetId: id,
    workspaceId: original.workspaceId,
    createdAt: new Date(now + i),
    metadata: { ...meta, result },
  }));
  events.push({
    eventType: "mcp_google_commit_result",
    success: true,
    targetId: id,
    workspaceId: original.workspaceId,
    createdAt: new Date(now + 3),
    metadata: {
      ...meta,
      operation: "GOOGLE_STAGE3_TARGETING",
      result: "VERIFIED",
    },
  });
  assert.equal(
    assertRemoveJournal({ stored, original, result: f.result, events })
      .terminal_success_operations,
    1,
  );
  events.push(events[1]);
  assert.throws(() =>
    assertRemoveJournal({ stored, original, result: f.result, events }),
  );
});
test("remove runner cannot create previews or approve, and supervisor has retained once latch", () => {
  const text = readFileSync(
    new URL("./audience-remove-commit-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(!text.includes("google_ads_targeting_preview"));
  assert.ok(!text.includes("/mcp/approve"));
  assert.ok(
    text.indexOf("bound = await approve();") <
      text.indexOf('stage = "immutable_commit_once"'),
  );
  const py = readFileSync(
    new URL("./run-audience-remove-commit.py", import.meta.url),
    "utf8",
  );
  assert.ok(py.includes("i-remove-commit-launch.claim"));
  assert.ok(py.includes("os.O_EXCL"));
  assert.ok(!py.includes("docker stop"));
});

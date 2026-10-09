import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { URL } from "node:url";
import { timestampMillis } from "./timestamp.mjs";
import {
  assertApprovedI,
  validateCommitRequest,
  expectedTool,
  target,
  digest,
  claim,
} from "./audience-commit-guard.mjs";
import {
  assertPreparedI,
  sourceHead,
  imageDigest,
} from "./audience-preview-guard.mjs";
import {
  assertCreatedAudience,
  makeIRestoreRequest,
} from "./audience-commit-runner.mjs";
const { structuredClone } = globalThis;
const now = Date.now(),
  future = new Date(now + 600000).toISOString(),
  id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
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
const fixture = () => {
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
    expiresAt: future,
    tokenDigest: digest(context.service_token),
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    accountIds: [account.id],
    resourceAccessMode: "STATIC_ALLOWLIST",
    serviceIdentity: { workspaceId: account.workspaceId, createdById: "human" },
  };
  const plan = {
    version: 3,
    account_id: target.customer,
    intent: { items: expectedTool.arguments.items },
    atomic: true,
    irreversible: false,
    items: [{}],
    checks: [],
    operations: [
      {
        kind: "adGroups",
        method: "update",
        resource_name: target.groupResource,
        update_mask: "targeting_setting.target_restriction_operations",
        before: { resourceName: target.groupResource, status: "PAUSED" },
        fields: {
          resourceName: target.groupResource,
          targetingSetting: {
            targetRestrictionOperations: [
              {
                operator: "ADD",
                value: { targetingDimension: "AUDIENCE", bidOnly: true },
              },
            ],
          },
        },
      },
      {
        kind: "adGroupCriteria",
        method: "create",
        fields: {
          adGroup: target.groupResource,
          status: "ENABLED",
          negative: false,
          userInterest: {
            userInterestCategory: `customers/${target.customer}/userInterests/90100`,
          },
        },
      },
    ],
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
  return { context, account, key, stored, session, approval, proof, plan };
};
test("I persisted exact approval accepts actual preview TTL independent of readiness age", () => {
  const f = fixture();
  assert.equal(assertApprovedI(f, id, now).approval_persisted, true);
  f.context.readiness_timestamp = new Date(now - 1200000).toISOString();
  assertApprovedI(f, id, now);
});
test("I Prisma Date retains 677ms, exact ISO binding and subsecond audit ordering", () => {
  const at = Date.parse("2026-10-10T12:00:00.000Z"),
    expiry = "2026-10-10T12:51:17.677Z";
  assert.equal(timestampMillis(new Date(expiry)), timestampMillis(expiry));
  const f = fixture();
  f.key.expiresAt = new Date(expiry);
  f.context.expires_at = expiry;
  f.stored.expiresAt = new Date("2026-10-10T12:20:00.677Z");
  f.session.expiresAt = new Date(expiry);
  f.stored.confirmedAt = new Date(at - 500 + 177);
  f.approval.createdAt = new Date(at - 500 + 178);
  assertApprovedI(f, id, at);
  f.context.expires_at = "2026-10-10T12:51:17.678Z";
  assert.throws(() => assertApprovedI(f, id, at), /account_owner_invalid/);
  f.context.expires_at = expiry;
  f.approval.createdAt = new Date(at - 500 + 176);
  assert.throws(() => assertApprovedI(f, id, at), /session_audit_invalid/);
  f.approval.createdAt = new Date(at - 500 + 177);
  assertApprovedI(f, id, at);
});
test("I precise expiry boundaries reject exactly expired Date or ISO without tolerance", () => {
  const at = Date.parse("2026-10-10T12:00:00.677Z");
  for (const kind of ["key", "session", "preview"]) {
    const f = fixture();
    f.stored.confirmedAt = new Date(at - 1000);
    f.approval.createdAt = new Date(at - 999);
    f.key.expiresAt = new Date(at + 10000);
    f.context.expires_at = f.key.expiresAt.toISOString();
    f.session.expiresAt = new Date(at + 10000);
    f.stored.expiresAt = new Date(at + 10000);
    if (kind === "key") {
      f.key.expiresAt = new Date(at);
      f.context.expires_at = f.key.expiresAt.toISOString();
    }
    if (kind === "session") f.session.expiresAt = new Date(at);
    if (kind === "preview") f.stored.expiresAt = new Date(at);
    assert.throws(() => assertApprovedI(f, id, at));
    if (kind === "key") {
      f.key.expiresAt = new Date(at + 1);
      f.context.expires_at = f.key.expiresAt.toISOString();
    }
    if (kind === "session") f.session.expiresAt = new Date(at + 1);
    if (kind === "preview") f.stored.expiresAt = new Date(at + 1);
    assertApprovedI(f, id, at);
  }
});
test("I timestamps reject invalid, missing, numeric and rollover dates", () => {
  for (const value of [
    null,
    undefined,
    1791636677677,
    "1791636677677",
    "invalid",
    new Date(Number.NaN),
    "2026-02-30T12:00:00.677Z",
    "2026-10-10T24:00:00.677Z",
    {},
    "2026-10-10",
  ])
    assert.equal(Number.isNaN(timestampMillis(value)), true);
  for (const field of ["confirmedAt", "expiresAt"]) {
    const f = fixture();
    f.stored[field] = new Date(Number.NaN);
    assert.throws(() => assertApprovedI(f, id, now));
  }
  const previewSource = readFileSync(
    new URL("./audience-preview-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    previewSource.includes(
      "timestampMillis(key.expiresAt) !== timestampMillis(context.expires_at)",
    ),
  );
  assert.ok(!previewSource.includes("Date.parse(key.expiresAt)"));
});
test("I identity, finite expiry, exact scopes, session, audit, immutable and freshness fail closed", () => {
  const edits = [
    (f) => (f.context.key_id = "foreign"),
    (f) => delete f.key.expiresAt,
    (f) => (f.context.expires_at = new Date(now + 1).toISOString()),
    (f) => f.key.scopes.push("admin"),
    (f) => f.key.scopes.push("adforge:mcp:read"),
    (f) => (f.key.serviceIdentity.revokedAt = new Date()),
    (f) => delete f.session.expiresAt,
    (f) => (f.session.expiresAt = "invalid"),
    (f) => (f.stored.confirmedAt = null),
    (f) => (f.approval.success = false),
    (f) => (f.stored.expiresAt = new Date(now - 1)),
    (f) => (f.stored.consumedAt = new Date()),
    (f) => (f.stored.requestedState.operations[1].fields.status = "PAUSED"),
    (f) => (f.stored.beforeState = [{}]),
    (f) => (f.account.externalAccountId = target.mcc),
  ];
  for (const edit of edits) {
    const f = fixture();
    edit(f);
    assert.throws(() => assertApprovedI(f, id, now));
  }
});
test("I exact atomic transport only, no revalidate or alternate token/account/payload", () => {
  const f = fixture(),
    authority = assertApprovedI(f, id, now),
    options = {
      env,
      context: f.context,
      authority,
      proof: f.proof,
      plan: f.plan,
      now,
    };
  const url = `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:mutate`;
  const init = {
    method: "POST",
    headers: { "login-customer-id": target.mcc },
    body: JSON.stringify({
      ...assertPreparedI(f.plan, expectedTool),
      validateOnly: false,
    }),
  };
  assert.equal(validateCommitRequest(url, init, options), "write");
  for (const payload of [
    { ...JSON.parse(init.body), validateOnly: true },
    { ...JSON.parse(init.body), partialFailure: true },
    { ...JSON.parse(init.body), mutateOperations: [] },
  ])
    assert.throws(() =>
      validateCommitRequest(
        url,
        { ...init, body: JSON.stringify(payload) },
        options,
      ),
    );
  assert.throws(() =>
    validateCommitRequest(
      url.replace(target.customer, target.mcc),
      init,
      options,
    ),
  );
  const rpc = {
    jsonrpc: "2.0",
    id: "stage234-I-commit",
    method: "tools/call",
    params: {
      name: "commit_preview",
      arguments: { preview_token: f.context.preview.preview_token },
    },
  };
  assert.equal(
    validateCommitRequest(
      "http://127.0.0.1:4000/mcp",
      { method: "POST", body: JSON.stringify(rpc) },
      options,
    ),
    "mcp_commit",
  );
  rpc.params.arguments.preview_token = "other";
  assert.throws(() =>
    validateCommitRequest(
      "http://127.0.0.1:4000/mcp",
      { method: "POST", body: JSON.stringify(rpc) },
      options,
    ),
  );
  assert.throws(() =>
    validateCommitRequest(url, init, { ...options, authority: null }),
  );
});
const snapshots = () => {
  const before = {
    campaign: [{ campaign: { status: "PAUSED" } }],
    group: [
      { adGroup: { resourceName: target.groupResource, status: "PAUSED" } },
    ],
    keywords: [{ adGroupCriterion: { status: "ENABLED", id: "11743561" } }],
    ads: [
      {
        adGroupAd: {
          status: "PAUSED",
          ad: {
            id: "827463920328",
            policySummaryInfo: { reviewStatus: "PENDING" },
          },
        },
      },
    ],
    groupAudiences: [],
    campaignCriteria: [],
    deliveryCampaigns: [],
    deliveryGroups: [],
    deliveryAds: [],
    sharedSet: [],
    attachments: [],
  };
  const actual = {
    resourceName: `customers/${target.customer}/adGroupCriteria/${target.group}~123456`,
    adGroup: target.groupResource,
    status: "ENABLED",
    type: "USER_INTEREST",
    userInterest: {
      userInterestCategory: `customers/${target.customer}/userInterests/90100`,
    },
  };
  const after = structuredClone(before);
  after.group[0].adGroup.targetingSetting = {
    targetRestrictions: [{ targetingDimension: "AUDIENCE", bidOnly: true }],
  };
  after.groupAudiences = [{ adGroupCriterion: actual }];
  const result = {
    status: "VERIFIED",
    account_id: target.customer,
    operation_count: 2,
    atomic: true,
    partial_failure: false,
    commit_id: "hmc_" + "a".repeat(43),
    items: [
      {
        operations: [
          {
            success: true,
            error: null,
            resource_name: target.groupResource,
            actual: after.group[0].adGroup,
          },
          {
            success: true,
            error: null,
            resource_name: actual.resourceName,
            actual,
          },
        ],
      },
    ],
  };
  return { before, after, result };
};
test("I provider-managed negative=false omission allowed only on newly created criterion", () => {
  for (const negative of [undefined, false]) {
    const f = snapshots();
    if (negative !== undefined)
      f.after.groupAudiences[0].adGroupCriterion.negative = negative;
    assert.equal(
      assertCreatedAudience(f.before, f.after, f.result).criterion_id,
      "123456",
    );
  }
});
test("I observation and every raw original inventory including L residual remain strict", () => {
  const edits = [
    (f) => (f.after.groupAudiences[0].adGroupCriterion.negative = true),
    (f) => (f.after.groupAudiences[0].adGroupCriterion.negative = "false"),
    (f) =>
      (f.after.group[0].adGroup.targetingSetting.targetRestrictions[0].bidOnly = false),
    (f) => (f.after.group[0].adGroup.status = "ENABLED"),
    (f) =>
      (f.after.ads[0].adGroupAd.ad.policySummaryInfo.reviewStatus = "APPROVED"),
    (f) => (f.after.keywords[0].adGroupCriterion.status = "PAUSED"),
    (f) =>
      (f.after.groupAudiences[0].adGroupCriterion.userInterest.userInterestCategory = `customers/${target.customer}/userInterests/90101`),
    (f) => f.after.attachments.push({ unexpected: true }),
    (f) =>
      f.after.groupAudiences.push({
        adGroupCriterion: { resourceName: "foreign" },
      }),
  ];
  for (const edit of edits) {
    const f = snapshots();
    edit(f);
    assert.throws(() => assertCreatedAudience(f.before, f.after, f.result));
  }
});
test("I restore is pure, exact verified created resource only, human approval and OBS residual disclosed", () => {
  const f = snapshots(),
    created = assertCreatedAudience(f.before, f.after, f.result),
    restore = makeIRestoreRequest(f.result, created);
  assert.equal(restore.request.arguments.items[0].criterion_id, "123456");
  assert.equal(restore.request.arguments.items[0].operation, "audience_remove");
  assert.equal(
    restore.request.arguments.items[0].acknowledge_irreversible,
    true,
  );
  assert.equal(restore.auto_submitted, false);
  assert.equal(restore.manual_approval_required, true);
  assert.equal(restore.original_absent_mode_restored, false);
  assert.equal(restore.residual_audience_mode, "OBSERVATION");
  assert.throws(() =>
    makeIRestoreRequest({ ...f.result, status: "UNVERIFIED" }, created),
  );
  assert.throws(() =>
    makeIRestoreRequest(f.result, { ...created, criterion_id: "999" }),
  );
});
test("I retained durable claims prevent second commit/write", () => {
  const root = mkdtempSync(join(tmpdir(), "hm-i-claim-"));
  claim(root, "write");
  assert.throws(() => claim(root, "write"));
  claim(root, "mcp_commit");
  assert.throws(() => claim(root, "mcp_commit"));
});
test("I DB-only check before vault and API; no automatic restoration or approval", () => {
  const text = readFileSync(
    new URL("./audience-commit-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    text.indexOf("STAGE234_I_DB_PREFLIGHT_ONLY") <
      text.indexOf("vault.decrypt"),
  );
  assert.equal((text.match(/await mcp\(/g) ?? []).length, 1);
  assert.ok(!text.includes('await mcp("google_ads_targeting_preview"'));
  assert.ok(!text.includes("mcp/approve"));
});

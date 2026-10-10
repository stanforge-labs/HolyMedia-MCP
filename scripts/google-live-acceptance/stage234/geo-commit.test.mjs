import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { assertJApproval, classifyJCommit } from "./geo-commit-guard.mjs";
import { assertCreatedJ, assertJJournal } from "./geo-commit-runner.mjs";
import {
  J_TOOL,
  J_QUERIES,
  target,
  sourceHead,
  imageDigest,
  assertPreparedJ,
  digest,
  canonical,
} from "./geo-preview-guard.mjs";
const { tsImport } = createRequire(
  new URL("../../../apps/api/package.json", import.meta.url),
)("tsx/esm/api");
const now = Date.now(),
  future = new Date(now + 600000).toISOString(),
  id = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
async function fixture() {
  const { buildStage3Plan } = await tsImport(
      "../../../apps/api/src/providers/google-ads-stage3.ts",
      import.meta.url,
    ),
    campaignResource = `customers/${target.customer}/campaigns/${target.campaign}`;
  const city = {
    campaignCriterion: {
      resourceName: `customers/${target.customer}/campaignCriteria/${target.campaign}~9235214`,
      campaign: campaignResource,
      type: "LOCATION",
      status: "ENABLED",
      negative: false,
      location: { geoTargetConstant: "geoTargetConstants/9235214" },
    },
  };
  const plan = await buildStage3Plan(
    target.customer,
    { action: "targeting", items: J_TOOL.arguments.items },
    async (q) => {
      if (q === J_QUERIES.customer)
        return [
          {
            customer: {
              id: target.customer,
              resourceName: `customers/${target.customer}`,
              currencyCode: "USD",
              timeZone: "Asia/Almaty",
            },
          },
        ];
      if (q === J_QUERIES.campaign)
        return [
          {
            campaign: {
              resourceName: campaignResource,
              id: target.campaign,
              status: "PAUSED",
              advertisingChannelType: "SEARCH",
              biddingStrategyType: "MANUAL_CPC",
            },
          },
        ];
      if (q === J_QUERIES.locations) return [city];
      if (q === J_QUERIES.proximity) return [];
      if (q === J_QUERIES.district)
        return [
          {
            geoTargetConstant: {
              resourceName: "geoTargetConstants/9196209",
              id: "9196209",
              countryCode: "KZ",
              status: "ENABLED",
              targetType: "District",
              name: "Almaly District",
            },
          },
        ];
      throw Error("unmanifested mock READ");
    },
    async () => [
      {
        geoTargetConstant: {
          resourceName: "geoTargetConstants/9196209",
          id: "9196209",
          countryCode: "KZ",
          status: "ENABLED",
        },
      },
    ],
  );
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
  const stored = {
    id,
    workspaceId: account.workspaceId,
    principalType: "SERVICE_TOKEN",
    serviceTokenId: key.id,
    accountId: account.id,
    connectionId: account.connectionId,
    provider: "GOOGLE_ADS",
    previewTokenDigest: digest(context.preview.preview_token),
    confirmedAt: new Date(now - 1000).toISOString(),
    approvalSessionId: "session",
    approvedByUserId: "human",
    commitStatus: "CONFIRMED",
    expiresAt: future,
    operation: "GOOGLE_STAGE3_TARGETING",
    diff: { provider_validation: "passed" },
    snapshotDigest: digest(plan),
    requestedState: plan,
    beforeState: plan.checks,
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
      workspaceId: account.workspaceId,
      actorType: "HUMAN",
      actorUserId: "human",
      success: true,
      createdAt: new Date(now - 500).toISOString(),
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
  const proof = {
    customer_id: target.customer,
    mcc_id: target.mcc,
    test_account: true,
    hierarchy: true,
    currency: "USD",
    group_resource: target.groupResource,
    group_cpc_micros: "100000",
    fixture_paused: true,
    fixture_sha256: "a".repeat(64),
    source_head: sourceHead,
    verified_at: new Date(now).toISOString(),
  };
  return {
    context,
    account,
    key,
    stored,
    session,
    approval,
    env,
    proof,
    plan,
    city,
  };
}
test("J persisted human/session/audit exact immutable approval; expired, changed, attempted and foreign bindings reject", async () => {
  const f = await fixture();
  assertJApproval(f, id, undefined, now);
  for (const change of [
    (x) => (x.stored.confirmedAt = null),
    (x) => (x.session.revokedAt = now),
    (x) => (x.approval.success = false),
    (x) => (x.stored.expiresAt = new Date(now - 1).toISOString()),
    (x) => (x.stored.commitAttemptedAt = now),
    (x) => (x.stored.consumedAt = now),
    (x) => (x.account.externalAccountId = target.mcc),
    (x) => (x.stored.requestedState.operations[1].fields.proximity.radius = 3),
    (x) => (x.stored.approvedByUserId = "other"),
  ]) {
    const x = structuredClone(f);
    change(x);
    assert.throws(() => assertJApproval(x, id, undefined, now));
  }
});
test("J commit guard permits only approved exact two-op write; no preview, validation, approval, changed payload or retry authority", async () => {
  const f = await fixture(),
    state = { ...f, authority: assertJApproval(f, id, undefined, now), now };
  const body = { ...assertPreparedJ(f.plan), validateOnly: false },
    url = `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:mutate`,
    req = (b) => ({
      method: "POST",
      headers: { "login-customer-id": target.mcc },
      body: JSON.stringify(b),
    });
  assert.equal(classifyJCommit(url, req(body), state), "write");
  const rpc = {
    jsonrpc: "2.0",
    id: "stage234-J-commit",
    method: "tools/call",
    params: {
      name: "commit_preview",
      arguments: { preview_token: f.context.preview.preview_token },
    },
  };
  assert.equal(
    classifyJCommit("http://127.0.0.1:4000/mcp", req(rpc), state),
    "mcp_commit",
  );
  for (const [u, b] of [
    [url, { ...body, validateOnly: true }],
    [url.replace(target.customer, target.mcc), body],
    ["http://127.0.0.1:4000/mcp", { ...rpc, params: J_TOOL }],
    ["http://127.0.0.1:4001/api/v1/mcp/public/approval", {}],
  ])
    assert.throws(() => classifyJCommit(u, req(b), state));
  assert.throws(() =>
    classifyJCommit(url, req(body), {
      ...state,
      authority: {
        ...state.authority,
        expires_at: new Date(now - 1).toISOString(),
      },
    }),
  );
  assert.throws(() =>
    classifyJCommit(url, req(body), {
      ...state,
      proof: { ...f.proof, test_account: false },
    }),
  );
  assert.throws(() =>
    classifyJCommit(url, req(body), {
      ...state,
      env: { ...f.env, GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: target.mcc },
    }),
  );
});
test("J reread verifies both actual new IDs and exact geo/proximity, rejects partial failures and neighbor changes", async () => {
  const f = await fixture(),
    created = f.plan.operations.map((op, i) => ({
      ...op.expected,
      resourceName: `customers/${target.customer}/campaignCriteria/${target.campaign}~${11 + i}`,
      type: i === 0 ? "LOCATION" : "PROXIMITY",
    })),
    before = { campaignCriteria: [f.city], other: "unchanged" },
    after = {
      ...before,
      campaignCriteria: [
        f.city,
        ...created.map((c) => ({ campaignCriterion: c })),
      ],
    };
  const result = {
    status: "VERIFIED",
    account_id: target.customer,
    operation_count: 2,
    atomic: false,
    partial_failure: true,
    irreversible: false,
    commit_id: "hmc_" + "a".repeat(43),
    items: created.map((c, i) => ({
      operations: [
        {
          operation: i,
          success: true,
          error: null,
          resource_name: c.resourceName,
          actual: c,
        },
      ],
    })),
  };
  const args = [
    before,
    after,
    result,
    [{ campaignCriterion: created[0] }],
    [{ campaignCriterion: created[1] }],
    f.plan,
  ];
  assert.equal(assertCreatedJ(...args).length, 2);
  for (const change of [
    (a) => (a[1].other = "changed"),
    (a) => (a[2].items[1].operations[0].success = false),
    (a) => (a[4][0].campaignCriterion.proximity.radius = 3),
    (a) => (a[1].campaignCriteria[0].campaignCriterion.negative = true),
  ]) {
    const a = structuredClone(args);
    change(a);
    assert.throws(() => assertCreatedJ(...a));
  }
});

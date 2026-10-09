import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { target, canonical, digest } from "./live-guard.mjs";
import {
  H_QUERIES,
  H_INTENT,
  H_VALIDATION,
  assertHRuntime,
  classifyHRequest,
  installHGuard,
  assertHProof,
  assertHPlan,
  runHAdapterDiagnostic,
  runHWarningOnly,
} from "./h-warning-only.mjs";
const { structuredClone, Response, URL } = globalThis;
const resource = `customers/${target.customer}/campaignBudgets/${target.budget}`;
const campaign = {
  resourceName: `customers/${target.customer}/campaigns/${target.campaign}`,
  id: target.campaign,
  name: "HM_MCP_WRITE_ACCEPTANCE_20261007T134837Z",
  status: "PAUSED",
  campaignBudget: resource,
  biddingStrategyType: "MANUAL_CPC",
};
function rows() {
  return {
    [H_QUERIES.customer]: [
      {
        customer: {
          id: target.customer,
          testAccount: true,
          currencyCode: "USD",
          timeZone: "Asia/Almaty",
        },
      },
    ],
    [H_QUERIES.hierarchy]: [
      { customerClient: { id: target.customer, testAccount: true, level: 1 } },
    ],
    [H_QUERIES.currency]: [
      { customer: { id: target.customer, currencyCode: "USD" } },
    ],
    [H_QUERIES.currencyUnit]: [
      {
        currencyConstant: {
          resourceName: "currencyConstants/USD",
          code: "USD",
          billableUnitMicros: "10000",
        },
      },
    ],
    [H_QUERIES.campaign]: [{ campaign }],
    [H_QUERIES.budget]: [
      {
        campaignBudget: {
          resourceName: resource,
          name: campaign.name,
          amountMicros: "2000000",
          explicitlyShared: false,
          deliveryMethod: "STANDARD",
          period: "DAILY",
        },
      },
    ],
    [H_QUERIES.consumers]: [{ campaign }],
    [H_QUERIES.groups]: [
      {
        campaign: { id: target.campaign },
        adGroup: {
          resourceName: `customers/${target.customer}/adGroups/${target.group}`,
          status: "PAUSED",
        },
      },
    ],
    [H_QUERIES.ads]: [
      {
        campaign: { id: target.campaign },
        adGroupAd: {
          resourceName: `customers/${target.customer}/adGroupAds/${target.group}~${target.rsa}`,
          status: "PAUSED",
        },
      },
    ],
  };
}
const request = (
  body = H_VALIDATION,
  path = `/v24/customers/${target.customer}/campaignBudgets:mutate`,
) => [
  "https://googleads.googleapis.com" + path,
  {
    method: "POST",
    headers: { "login-customer-id": target.mcc },
    body: JSON.stringify(body),
  },
];
test("only exact validation payload accepted; writes/foreign/MCC/other field/mask blocked", () => {
  assert.equal(classifyHRequest(...request()), "validate_only");
  for (const mutate of [
    (v) => (v.validateOnly = false),
    (v) => (v.partialFailure = false),
    (v) => (v.operations[0].update.amountMicros = "3200001"),
    (v) => (v.operations[0].update.status = "ENABLED"),
    (v) => (v.operations[0].updateMask = "amount_micros,name"),
    (v) => v.operations.push(v.operations[0]),
    (v) =>
      (v.operations[0].update.resourceName = resource.replace(
        target.customer,
        target.mcc,
      )),
  ]) {
    const b = structuredClone(H_VALIDATION);
    mutate(b);
    assert.throws(() => classifyHRequest(...request(b)), /h_transport_blocked/);
  }
  for (const path of [
    `/v24/customers/${target.mcc}/campaignBudgets:mutate`,
    `/v24/customers/${target.customer}/googleAds:mutate`,
    `/v24/customers/${target.customer}/adGroups:mutate`,
  ])
    assert.throws(
      () => classifyHRequest(...request(H_VALIDATION, path)),
      /h_transport_blocked/,
    );
  assert.throws(
    () =>
      classifyHRequest("http://localhost:4000/mcp", {
        method: "POST",
        body: "{}",
      }),
    /h_transport_blocked/,
  );
});
test("full one-off lifecycle: encrypted-context injection/fresh key, no DB preview/audit writes, safe counts/evidence", async () => {
  const { tsImport } = createRequire(
    new URL("../../../apps/api/package.json", import.meta.url),
  )("tsx/esm/api");
  const { GoogleAdsAdapter } = await tsImport(
    new URL(
      "../../../apps/api/src/providers/adapters/google.ads.ts",
      import.meta.url,
    ).href,
    import.meta.url,
  );
  const now = Date.parse("2026-10-10T00:00:00Z"),
    env = {
      STAGE234_SOURCE_HEAD: "a".repeat(40),
      STAGE234_HARNESS_HEAD: "b".repeat(40),
      STAGE234_IMAGE_DIGEST: "sha256:" + "c".repeat(64),
      STAGE234_RUN_DIR: "/acceptance-state",
      STAGE234_H_WARNING_ONLY_AUTHORIZED: "true",
      STAGE234_GUARD_PRELOAD: "0",
    };
  const config = {
    databaseUrl: "postgresql://postgres/google_acceptance",
    redisUrl: "redis://redis:6379",
    providerGoogleApiVersion: "v24",
    providerGoogleLoginCustomerId: target.mcc,
    providerHttpTimeoutMs: 20000,
    previewOnly: true,
    confirmedWriteEnabled: false,
    providerGoogleAdsWriteEnabled: true,
    providerGoogleAdsStage2WriteEnabled: true,
    providerGoogleAdsStage3WriteEnabled: false,
    providerGoogleAdsStage4WriteEnabled: false,
    publicMcpWriteScopeEnabled: false,
    publicMcpControlledWriteEnabled: false,
    googleAdsWriteAccountAllowlist: [target.customer],
    googleAdsWriteBatchLimit: 500,
  };
  const context = {
    service_token: "mock-hidden-service-marker",
    key_id: "11111111-1111-4111-8111-111111111111",
    expires_at: new Date(now + 3600000).toISOString(),
    preview: { preview_id: "22222222-2222-4222-8222-222222222222" },
  };
  const account = {
    id: "account-test",
    workspaceId: "workspace-test",
    provider: "GOOGLE_ADS",
    externalAccountId: target.customer,
    enabled: true,
    connectionId: "connection-test",
  };
  const baseline = {
    provider: "GOOGLE_ADS",
    workspaceId: account.workspaceId,
    account,
  };
  const key = {
    id: context.key_id,
    tokenDigest: digest(context.service_token),
    expiresAt: new Date(context.expires_at),
    revokedAt: null,
    resourceAccessMode: "STATIC_ALLOWLIST",
    accountIds: [account.id],
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    serviceIdentity: { workspaceId: account.workspaceId, revokedAt: null },
  };
  const connection = {
    id: account.connectionId,
    workspaceId: account.workspaceId,
    provider: "GOOGLE_ADS",
    credential: {
      encryptedPayload: "mock-hidden-ciphertext",
      encryptionVersion: 1,
    },
  };
  const client = {
    mcpPreview: { findUnique: async () => baseline, count: async () => 0 },
    serviceToken: { findUnique: async () => key },
    providerAccount: {
      findMany: async () => [{ externalAccountId: target.customer }],
    },
    providerConnection: { findUnique: async () => connection },
    auditEvent: { count: async () => 42 },
  };
  const stock = {
    config,
    createDatabase: () => ({ client }),
    closeDatabase: async () => {},
    Vault: class {
      decrypt() {
        return {
          accessToken: "mock-hidden-access-marker",
          scopes: ["https://www.googleapis.com/auth/adwords"],
          expiresAt: new Date(now + 3600000).toISOString(),
        };
      }
    },
    Adapter: GoogleAdsAdapter,
  };
  const native = globalThis.fetch,
    data = rows();
  let transports = 0,
    claims = 0,
    evidence;
  globalThis.fetch = async (input, init) => {
    transports++;
    const kind = classifyHRequest(input, init);
    if (kind === "validate_only") return new Response("{}", { status: 200 });
    return new Response(
      JSON.stringify([{ results: data[JSON.parse(init.body).query] }]),
      { status: 200 },
    );
  };
  const options = {
    env,
    load: async () => stock,
    checkDirectory: () => {},
    readContext: async (file, options) => {
      assert.equal(
        file.replaceAll("\\", "/"),
        "/acceptance-state/fixture-context.json",
      );
      assert.equal(options.allowLegacyExpired, false);
      return context;
    },
    claim: () => {
      claims++;
    },
    save: (_file, value) => {
      evidence = value;
    },
    now: () => now,
  };
  try {
    const result = await runHWarningOnly(options);
    assert.equal(
      result.result,
      "PASS_WARNING_ONLY_DIAGNOSTIC",
      JSON.stringify(result),
    );
    assert.equal(result.validate_only, 1);
    assert.equal(result.write, 0);
    assert.equal(claims, 1);
    assert.equal(transports, result.read + result.validate_only);
    assert.equal(evidence.full_mcp_approval_commit_acceptance, false);
    assert.equal(evidence.shared_budget_live_verified, false);
    assert.equal(evidence.audit_count_before, 42);
    assert.equal(evidence.audit_count_after, 42);
    assert.equal(evidence.pending_preview_count_after, 0);
    assert.ok(!JSON.stringify(evidence).includes("mock-hidden"));
    for (const mutate of [
      () => {
        key.revokedAt = new Date(now);
      },
      () => {
        key.revokedAt = null;
        key.scopes = ["adforge:mcp:read"];
      },
      () => {
        key.scopes = ["adforge:mcp:read", "adforge:mcp:write"];
        key.accountIds.push("foreign-account");
      },
    ]) {
      mutate();
      const before = transports;
      const blocked = await runHWarningOnly(options);
      assert.equal(blocked.result, "BLOCKED");
      assert.equal(transports, before);
      assert.equal(blocked.validate_only, 0);
      assert.equal(blocked.write, 0);
    }
  } finally {
    globalThis.fetch = native;
  }
});
test("closed fixed READ queries and hierarchy-only MCC access", () => {
  for (const [name, query] of Object.entries(H_QUERIES))
    assert.equal(
      classifyHRequest(
        ...request(
          { query },
          `/v24/customers/${name === "hierarchy" ? target.mcc : target.customer}/googleAds:searchStream`,
        ),
      ),
      "read",
    );
  for (const [query, account] of [
    ["SELECT customer.id FROM customer", target.customer],
    [H_QUERIES.budget, target.mcc],
    [H_QUERIES.hierarchy, target.customer],
    [H_QUERIES.budget, "1111111111"],
  ])
    assert.throws(
      () =>
        classifyHRequest(
          ...request(
            { query },
            `/v24/customers/${account}/googleAds:searchStream`,
          ),
        ),
      /h_transport_blocked/,
    );
  const [url, init] = request();
  assert.throws(
    () => classifyHRequest(url + "?debug=1", init),
    /h_transport_blocked/,
  );
});
test("proof+verified plan+exclusive claim before sole validation; no retry after failure", async () => {
  const counts = {
      read: 0,
      oauth_refresh: 0,
      validate_only: 0,
      write: 0,
      failed_http: 0,
    },
    state = { proven: false, plan_verified: false };
  let fetches = 0,
    claims = 0;
  const f = installHGuard(
    async () => {
      fetches++;
      throw Error("mock network");
    },
    state,
    counts,
    () => {
      claims++;
    },
  );
  await assert.rejects(
    f(...request()),
    /h_validation_not_authorized_or_reused/,
  );
  await assert.rejects(
    f(
      ...request(
        { query: H_QUERIES.budget },
        `/v24/customers/${target.customer}/googleAds:searchStream`,
      ),
    ),
    /h_customer_proof_required/,
  );
  state.proven = true;
  state.plan_verified = true;
  await assert.rejects(f(...request()), /mock network/);
  await assert.rejects(
    f(...request()),
    /h_validation_not_authorized_or_reused/,
  );
  assert.equal(fetches, 1);
  assert.equal(claims, 1);
  assert.equal(counts.validate_only, 1);
  assert.equal(counts.write, 0);
  const blocked = installHGuard(
    async () => {
      fetches++;
      return new Response("{}");
    },
    { proven: true, plan_verified: true },
    { validate_only: 0, read: 0, oauth_refresh: 0, failed_http: 0 },
    () => {
      throw Error("existing claim");
    },
  );
  await assert.rejects(blocked(...request()), /existing claim/);
  assert.equal(fetches, 1);
});
test("TEST and hierarchy proof closed", () => {
  const r = rows();
  assertHProof(r[H_QUERIES.customer], r[H_QUERIES.hierarchy]);
  for (const edit of [
    (r) => (r[H_QUERIES.customer][0].customer.testAccount = false),
    (r) => (r[H_QUERIES.customer][0].customer.currencyCode = "KZT"),
    (r) => (r[H_QUERIES.hierarchy][0].customerClient.level = 0),
    (r) => (r[H_QUERIES.hierarchy][0].customerClient.id = "1111111111"),
  ]) {
    const changed = rows();
    edit(changed);
    assert.throws(
      () =>
        assertHProof(changed[H_QUERIES.customer], changed[H_QUERIES.hierarchy]),
      /h_test_customer_or_hierarchy_unproven/,
    );
  }
});
test("runtime requires preview-only/confirmed OFF, TEST-only allowlist and explicit diagnostic flag", () => {
  const env = {
    STAGE234_SOURCE_HEAD: "a".repeat(40),
    STAGE234_HARNESS_HEAD: "b".repeat(40),
    STAGE234_IMAGE_DIGEST: "sha256:" + "c".repeat(64),
    STAGE234_RUN_DIR: "/acceptance-state",
    STAGE234_H_WARNING_ONLY_AUTHORIZED: "true",
    STAGE234_GUARD_PRELOAD: "0",
  };
  const config = {
    databaseUrl: "postgresql://postgres/google_acceptance",
    redisUrl: "redis://redis:6379",
    providerGoogleApiVersion: "v24",
    providerGoogleLoginCustomerId: target.mcc,
    previewOnly: true,
    confirmedWriteEnabled: false,
    providerGoogleAdsWriteEnabled: true,
    providerGoogleAdsStage2WriteEnabled: true,
    providerGoogleAdsStage3WriteEnabled: false,
    providerGoogleAdsStage4WriteEnabled: false,
    publicMcpWriteScopeEnabled: false,
    publicMcpControlledWriteEnabled: false,
    googleAdsWriteAccountAllowlist: [target.customer],
  };
  assertHRuntime(env, config);
  for (const field of [
    "confirmedWriteEnabled",
    "providerGoogleAdsStage3WriteEnabled",
    "providerGoogleAdsStage4WriteEnabled",
    "publicMcpWriteScopeEnabled",
    "publicMcpControlledWriteEnabled",
  ])
    assert.throws(
      () => assertHRuntime(env, { ...config, [field]: true }),
      /h_disposable_runtime_invalid/,
    );
  assert.throws(
    () =>
      assertHRuntime(
        { ...env, STAGE234_H_WARNING_ONLY_AUTHORIZED: "false" },
        config,
      ),
    /h_disposable_runtime_invalid/,
  );
  assert.throws(
    () =>
      assertHRuntime(env, {
        ...config,
        googleAdsWriteAccountAllowlist: [target.customer, target.mcc],
      }),
    /h_disposable_runtime_invalid/,
  );
});
async function builder() {
  const { tsImport } = createRequire(
    new URL("../../../apps/api/package.json", import.meta.url),
  )("tsx/esm/api");
  return (
    await tsImport(
      new URL(
        "../../../apps/api/src/providers/google-ads-stage2.ts",
        import.meta.url,
      ).href,
      import.meta.url,
    )
  ).buildStage2Plan;
}
test("actual stock build/checks produce exact +60% nonshared impact and warning", async () => {
  const build = await builder(),
    data = rows();
  const plan = await build(target.customer, H_INTENT, async (q) => {
    assert.ok(q in data);
    return structuredClone(data[q]);
  });
  assert.equal(assertHPlan(plan).campaign_id, target.campaign);
  assert.equal(plan.operations[0].expected.amountMicros, "3200000");
  for (const edit of [
    (p) => (p.operations[0].fields.amountMicros = "3300000"),
    (p) => (p.operations[0].expected.deliveryMethod = "ACCELERATED"),
    (p) => (p.operations[0].before.explicitlyShared = true),
    (p) => (p.items[0].warnings = []),
    (p) =>
      p.checks
        .find((c) => c.query === H_QUERIES.consumers)
        .rows.push({ campaign: { ...campaign, id: "1" } }),
  ]) {
    const changed = structuredClone(plan);
    edit(changed);
    assert.throws(() => assertHPlan(changed), /h_exact_nonshared_plan_invalid/);
  }
});
test("mock stock builder driver validates once, no MCP preview/commit, before==after", async () => {
  const build = await builder(),
    data = rows(),
    state = { proven: false, plan_verified: false },
    calls = [];
  const adapter = {
    searchStream: async (_token, account, _mcc, q) => {
      assert.equal(
        account,
        q === H_QUERIES.hierarchy ? target.mcc : target.customer,
      );
      return structuredClone(data[q]);
    },
    stage2: async (_context, action, input) => {
      calls.push(action);
      if (action === "build")
        return build(target.customer, input, async (q) =>
          structuredClone(data[q]),
        );
      if (action === "read")
        return input.checks.map((c) => ({
          query: c.query,
          rows: structuredClone(data[c.query]),
        }));
      assert.equal(action, "validate");
      assert.equal(state.plan_verified, true);
      return [{ success: true, resource_name: resource, error: null }];
    },
  };
  const result = await runHAdapterDiagnostic(
    adapter,
    {
      accountId: target.customer,
      loginCustomerId: target.mcc,
      credentials: { accessToken: "mock-hidden" },
    },
    state,
  );
  assert.equal(result.provider_before_after_unchanged, true);
  assert.equal(result.provider_amount_after_validation, "2000000");
  assert.equal(result.warning_over_50_percent, true);
  assert.deepEqual(calls, ["build", "read", "validate", "read"]);
  assert.ok(!canonical(result).includes("mock-hidden"));
});
test("drift and validation error stop diagnostic without compensating writes", async () => {
  const build = await builder();
  for (const mode of ["stale_before", "stale_after", "validation_error"]) {
    const data = rows(),
      calls = [];
    const adapter = {
      searchStream: async (_t, _a, _m, q) => structuredClone(data[q]),
      stage2: async (_ctx, action, input) => {
        calls.push(action);
        if (action === "build")
          return build(target.customer, input, async (q) =>
            structuredClone(data[q]),
          );
        if (action === "validate") {
          if (mode === "validation_error")
            return [{ success: false, error: { code: "MOCK_GOOGLE_ERROR" } }];
          data[H_QUERIES.budget][0].campaignBudget.amountMicros = "2100000";
          return [{ success: true, error: null }];
        }
        if (mode === "stale_before")
          data[H_QUERIES.budget][0].campaignBudget.amountMicros = "2100000";
        return input.checks.map((c) => ({
          query: c.query,
          rows: structuredClone(data[c.query]),
        }));
      },
    };
    await assert.rejects(
      runHAdapterDiagnostic(
        adapter,
        {
          accountId: target.customer,
          loginCustomerId: target.mcc,
          credentials: { accessToken: "mock-hidden" },
        },
        { proven: false, plan_verified: false },
      ),
      mode === "stale_before"
        ? /h_snapshot_changed_before_validation/
        : mode === "stale_after"
          ? /h_provider_changed_during_validation/
          : /h_validation_failed_or_plan_changed/,
    );
    assert.ok(!calls.includes("commit"));
    assert.equal(
      calls.filter((v) => v === "validate").length,
      mode === "stale_before" ? 0 : 1,
    );
  }
});
test("actual GoogleAdsAdapter build/validate/read under transport guard; commit disabled", async () => {
  const { tsImport } = createRequire(
    new URL("../../../apps/api/package.json", import.meta.url),
  )("tsx/esm/api");
  const { GoogleAdsAdapter } = await tsImport(
    new URL(
      "../../../apps/api/src/providers/adapters/google.ads.ts",
      import.meta.url,
    ).href,
    import.meta.url,
  );
  const data = rows(),
    state = { proven: false, plan_verified: false },
    counts = {
      read: 0,
      oauth_refresh: 0,
      validate_only: 0,
      write: 0,
      failed_http: 0,
    },
    before = canonical(data),
    native = globalThis.fetch;
  let claims = 0;
  globalThis.fetch = installHGuard(
    async (input, init) => {
      const kind = classifyHRequest(input, init),
        body = JSON.parse(init.body);
      if (kind === "validate_only") {
        assert.equal(canonical(body), canonical(H_VALIDATION));
        return new Response("{}", { status: 200 });
      }
      return new Response(
        JSON.stringify([{ results: structuredClone(data[body.query]) }]),
        { status: 200 },
      );
    },
    state,
    counts,
    () => {
      claims++;
    },
  );
  try {
    const adapter = new GoogleAdsAdapter({
      providerGoogleAdsWriteEnabled: true,
      providerGoogleAdsStage2WriteEnabled: true,
      googleAdsWriteAccountAllowlist: [target.customer],
      googleAdsWriteBatchLimit: 500,
      previewOnly: true,
      confirmedWriteEnabled: false,
      providerGoogleApiVersion: "v24",
      providerGoogleLoginCustomerId: target.mcc,
      providerHttpTimeoutMs: 20000,
    });
    const context = {
      accountId: target.customer,
      loginCustomerId: target.mcc,
      currency: "USD",
      credentials: {
        accessToken: "mock-hidden",
        scopes: ["https://www.googleapis.com/auth/adwords"],
      },
    };
    const result = await runHAdapterDiagnostic(adapter, context, state);
    assert.equal(result.google_validation, "PASS");
    assert.equal(result.provider_before_after_unchanged, true);
    assert.equal(canonical(data), before);
    assert.equal(claims, 1);
    assert.equal(counts.validate_only, 1);
    assert.equal(counts.write, 0);
    const plan = await adapter.stage2(context, "build", H_INTENT),
      readCount = counts.read;
    await assert.rejects(
      adapter.stage2(context, "commit", plan),
      (e) => e.writeCode === "confirmed_write_disabled",
    );
    assert.equal(counts.read, readCount);
    assert.equal(counts.validate_only, 1);
    assert.equal(counts.write, 0);
  } finally {
    globalThis.fetch = native;
  }
});

// H warning-only: stock builder/validator, not a persisted MCP preview or commit.
import { createRequire } from "node:module";
import { lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { readAcceptanceContext } from "./context-vault.mjs";
import { target, queries, canonical, digest } from "./live-guard.mjs";
import {
  assertReadinessAuthority,
  safeReadinessError,
} from "./targeting-readiness-runner.mjs";
const { URL, Headers, URLSearchParams, AbortSignal, structuredClone, console } =
  globalThis;
const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};
const resource = `customers/${target.customer}/campaignBudgets/${target.budget}`;
const campaignResource = `customers/${target.customer}/campaigns/${target.campaign}`;
const campaignSelect = queries.campaign.slice(
  0,
  queries.campaign.indexOf(" WHERE "),
);
export const H_QUERIES = Object.freeze({
  customer: queries.customer,
  hierarchy: queries.hierarchy,
  currency: queries.currency,
  currencyUnit: queries.currencyUnit,
  campaign: queries.campaign,
  budget:
    "SELECT campaign_budget.resource_name, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.explicitly_shared, campaign_budget.delivery_method, campaign_budget.period FROM campaign_budget WHERE campaign_budget.resource_name = '" +
    resource +
    "'",
  consumers:
    campaignSelect +
    " WHERE campaign.campaign_budget = '" +
    resource +
    "' AND campaign.status != REMOVED",
  groups: queries.fixtureGroups,
  ads: queries.fixtureAds,
});
export const H_INTENT = Object.freeze({
  action: "bid_budget_update",
  items: [
    {
      field: "campaign_daily_budget",
      campaign_id: target.campaign,
      change: { mode: "percent", percent: "60", currency: "USD" },
    },
  ],
});
export const H_VALIDATION = Object.freeze({
  operations: [
    {
      update: { resourceName: resource, amountMicros: "3200000" },
      updateMask: "amount_micros",
    },
  ],
  validateOnly: true,
  partialFailure: true,
});
export function assertHRuntime(env, config) {
  let db, redis;
  try {
    db = new URL(config.databaseUrl);
    redis = new URL(config.redisUrl);
  } catch {
    fail("h_disposable_runtime_invalid");
  }
  if (
    env.STAGE234_RUN_DIR !== "/acceptance-state" ||
    env.STAGE234_H_WARNING_ONLY_AUTHORIZED !== "true" ||
    env.STAGE234_GUARD_PRELOAD !== "0" ||
    !/^[a-f0-9]{40}$/.test(env.STAGE234_SOURCE_HEAD ?? "") ||
    !/^[a-f0-9]{40}$/.test(env.STAGE234_HARNESS_HEAD ?? "") ||
    !/^sha256:[a-f0-9]{64}$/.test(env.STAGE234_IMAGE_DIGEST ?? "") ||
    db.hostname !== "postgres" ||
    db.pathname !== "/google_acceptance" ||
    redis.hostname !== "redis" ||
    config.providerGoogleApiVersion !== "v24" ||
    config.providerGoogleLoginCustomerId !== target.mcc ||
    config.previewOnly !== true ||
    config.confirmedWriteEnabled !== false ||
    config.providerGoogleAdsWriteEnabled !== true ||
    config.providerGoogleAdsStage2WriteEnabled !== true ||
    [
      config.providerGoogleAdsStage3WriteEnabled,
      config.providerGoogleAdsStage4WriteEnabled,
      config.publicMcpWriteScopeEnabled,
      config.publicMcpControlledWriteEnabled,
    ].some((v) => v !== false) ||
    canonical(config.googleAdsWriteAccountAllowlist) !==
      canonical([target.customer])
  )
    fail("h_disposable_runtime_invalid");
}
export function classifyHRequest(input, init = {}) {
  let url, body;
  try {
    url = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url,
    );
  } catch {
    fail("h_transport_blocked");
  }
  if (
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (init.method ?? "GET").toUpperCase() !== "POST"
  )
    fail("h_transport_blocked");
  if (
    url.origin === "https://oauth2.googleapis.com" &&
    url.pathname === "/token"
  ) {
    const p = new URLSearchParams(init.body);
    if (
      canonical([...p.keys()].sort()) !==
        canonical([
          "client_id",
          "client_secret",
          "grant_type",
          "refresh_token",
        ]) ||
      p.get("grant_type") !== "refresh_token" ||
      ["client_id", "client_secret", "refresh_token"].some(
        (k) => !p.get(k) || p.get(k).length > 8192,
      )
    )
      fail("h_transport_blocked");
    return "oauth_refresh";
  }
  try {
    body = JSON.parse(String(init.body));
  } catch {
    fail("h_transport_blocked");
  }
  if (
    url.origin !== "https://googleads.googleapis.com" ||
    new Headers(init.headers).get("login-customer-id") !== target.mcc
  )
    fail("h_transport_blocked");
  if (
    url.pathname ===
      `/v24/customers/${target.customer}/campaignBudgets:mutate` &&
    canonical(body) === canonical(H_VALIDATION)
  )
    return "validate_only";
  if (
    canonical(Object.keys(body)) === canonical(["query"]) &&
    ((url.pathname ===
      `/v24/customers/${target.customer}/googleAds:searchStream` &&
      Object.entries(H_QUERIES).some(
        ([k, q]) => k !== "hierarchy" && q === body.query,
      )) ||
      (url.pathname === `/v24/customers/${target.mcc}/googleAds:searchStream` &&
        body.query === H_QUERIES.hierarchy))
  )
    return "read";
  fail("h_transport_blocked");
}
export function installHGuard(nativeFetch, state, counts, claim) {
  return async (input, init = {}) => {
    const kind = classifyHRequest(input, init);
    if (
      kind === "validate_only" &&
      (!state.proven || !state.plan_verified || counts.validate_only !== 0)
    )
      fail("h_validation_not_authorized_or_reused");
    if (
      (kind === "read" && counts.read >= 40) ||
      (kind === "oauth_refresh" && counts.oauth_refresh >= 1)
    )
      fail("h_request_limit_no_retry");
    if (
      kind === "read" &&
      !state.proven &&
      ![H_QUERIES.customer, H_QUERIES.hierarchy].includes(
        JSON.parse(String(init.body)).query,
      )
    )
      fail("h_customer_proof_required");
    if (kind === "validate_only") claim(); // durable wx claim retained even if transport outcome is uncertain
    counts[kind]++;
    try {
      const response = await nativeFetch(input, {
        ...init,
        redirect: "error",
        signal: init.signal
          ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
          : AbortSignal.timeout(20000),
      });
      if (!response.ok) counts.failed_http++;
      return response;
    } catch (e) {
      counts.failed_http++;
      throw e;
    }
  };
}
export function assertHProof(customerRows, hierarchyRows) {
  const c = customerRows?.[0]?.customer,
    h = hierarchyRows?.[0]?.customerClient;
  if (
    customerRows?.length !== 1 ||
    hierarchyRows?.length !== 1 ||
    String(c?.id) !== target.customer ||
    c.testAccount !== true ||
    c.currencyCode !== "USD" ||
    String(h?.id) !== target.customer ||
    h.testAccount !== true ||
    Number(h.level) !== 1
  )
    fail("h_test_customer_or_hierarchy_unproven");
}
export function assertHPlan(plan) {
  const o = plan?.operations?.[0],
    row = plan?.items?.[0];
  const check = (q) => plan?.checks?.find((c) => c.query === q)?.rows;
  const budget = check(H_QUERIES.budget),
    consumers = check(H_QUERIES.consumers),
    campaign = consumers?.[0]?.campaign;
  const actualPayload = {
    operations: plan?.operations?.map((v) => ({
      update: v.fields,
      updateMask: v.update_mask,
    })),
    validateOnly: true,
    partialFailure: true,
  };
  if (
    plan?.version !== 2 ||
    plan.account_id !== target.customer ||
    canonical(plan.intent) !== canonical(H_INTENT) ||
    plan.operations.length !== 1 ||
    plan.items.length !== 1 ||
    o.kind !== "campaignBudgets" ||
    o.method !== "update" ||
    o.row !== 0 ||
    o.resource_name !== resource ||
    o.response_key !== "campaignBudget" ||
    o.read_query !== H_QUERIES.budget ||
    canonical(actualPayload) !== canonical(H_VALIDATION) ||
    o.before.amountMicros !== "2000000" ||
    o.before.period !== "DAILY" ||
    o.before.explicitlyShared !== false ||
    o.before.deliveryMethod !== "STANDARD" ||
    o.expected.amountMicros !== "3200000" ||
    canonical(o.expected) !==
      canonical({ ...o.before, amountMicros: "3200000" }) ||
    row.row_error ||
    row.before?.amountMicros !== "2000000" ||
    row.after?.amountMicros !== "3200000" ||
    row.before?.currency !== "USD" ||
    row.after?.currency !== "USD" ||
    !row.warnings?.some(
      (v) => typeof v === "string" && v.includes("более 50%"),
    ) ||
    budget?.length !== 1 ||
    budget[0]?.campaignBudget?.resourceName !== resource ||
    consumers?.length !== 1 ||
    campaign?.resourceName !== campaignResource ||
    String(campaign.id) !== target.campaign ||
    campaign.campaignBudget !== resource ||
    campaign.status !== "PAUSED" ||
    plan.checks.some(
      (c) =>
        ![
          H_QUERIES.currency,
          H_QUERIES.currencyUnit,
          H_QUERIES.campaign,
          H_QUERIES.budget,
          H_QUERIES.consumers,
        ].includes(c.query),
    )
  )
    fail("h_exact_nonshared_plan_invalid");
  return { campaign_id: target.campaign, campaign_name: String(campaign.name) };
}
function paused(rows, key) {
  if (
    !rows?.length ||
    rows.length > 5000 ||
    rows.some(
      (r) =>
        ![target.campaign, "24339483523"].includes(String(r.campaign?.id)) ||
        !r[key]?.resourceName?.startsWith(`customers/${target.customer}/`) ||
        r[key]?.status !== "PAUSED",
    )
  )
    fail("h_fixture_delivery_not_paused");
}
export async function runHAdapterDiagnostic(adapter, context, state) {
  if (
    context.accountId !== target.customer ||
    context.loginCustomerId !== target.mcc
  )
    fail("h_context_account_invalid");
  const read = async (query, account = target.customer) => {
    const rows = await adapter.searchStream(
      context.credentials.accessToken,
      account,
      target.mcc,
      query,
    );
    if (!Array.isArray(rows) || rows.length > 5000) fail("h_inventory_limit");
    return structuredClone(rows).sort((a, b) =>
      canonical(a).localeCompare(canonical(b), "en"),
    );
  };
  const proof = async () => {
    const customer = await read(H_QUERIES.customer),
      hierarchy = await read(H_QUERIES.hierarchy, target.mcc);
    assertHProof(customer, hierarchy);
    state.proven = true;
    return { customer, hierarchy };
  };
  const delivery = async () => {
    const groups = await read(H_QUERIES.groups),
      ads = await read(H_QUERIES.ads);
    paused(groups, "adGroup");
    paused(ads, "adGroupAd");
    return { groups, ads };
  };
  const beforeProof = await proof(),
    beforeDelivery = await delivery();
  const plan = await adapter.stage2(
    context,
    "build",
    structuredClone(H_INTENT),
  );
  const consumer = assertHPlan(plan),
    planDigest = digest(plan);
  const fresh = await adapter.stage2(context, "read", plan);
  if (canonical(fresh) !== canonical(plan.checks))
    fail("h_snapshot_changed_before_validation");
  state.plan_verified = true;
  const result = await adapter.stage2(context, "validate", plan);
  if (
    !Array.isArray(result) ||
    result.length !== 1 ||
    result[0]?.success !== true ||
    result[0]?.error ||
    digest(plan) !== planDigest
  )
    fail("h_validation_failed_or_plan_changed");
  const after = await adapter.stage2(context, "read", plan),
    afterProof = await proof(),
    afterDelivery = await delivery();
  if (
    canonical(after) !== canonical(plan.checks) ||
    canonical(beforeProof) !== canonical(afterProof) ||
    canonical(beforeDelivery) !== canonical(afterDelivery)
  )
    fail("h_provider_changed_during_validation");
  return {
    planned_before: {
      resource_name: resource,
      amount_micros: "2000000",
      amount: "2.00",
      currency: "USD",
      explicitly_shared: false,
      period: "DAILY",
    },
    planned_after: {
      resource_name: resource,
      amount_micros: "3200000",
      amount: "3.20",
      currency: "USD",
      explicitly_shared: false,
      period: "DAILY",
    },
    provider_amount_after_validation: "2000000",
    percent_change: "60",
    warning_over_50_percent: true,
    warnings: plan.items[0].warnings.filter(
      (v) => typeof v === "string" && v.includes("более 50%"),
    ),
    affected_campaigns: [consumer],
    provider_before_after_unchanged: true,
    immutable_plan_sha256: planDigest,
    google_validation: "PASS",
  };
}
async function loadStock() {
  createRequire("/workspace/apps/api/package.json")("reflect-metadata");
  const { loadConfig } =
      await import("/workspace/packages/config/dist/index.js"),
    database = await import("/workspace/packages/database/dist/index.js"),
    { CredentialVaultService } =
      await import("/workspace/apps/api/dist/providers/credential-vault.service.js"),
    { GoogleAdsAdapter } =
      await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
  return {
    config: loadConfig(),
    createDatabase: database.createDatabase,
    closeDatabase: database.closeDatabase,
    Vault: CredentialVaultService,
    Adapter: GoogleAdsAdapter,
  };
}
export async function runHWarningOnly({
  env = process.env,
  load = loadStock,
  readContext = readAcceptanceContext,
  checkDirectory = (dir) => {
    const s = lstatSync(dir);
    if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 0o077)
      fail("h_directory_invalid");
  },
  save = (file, value) =>
    writeFileSync(file, JSON.stringify(value, null, 2), {
      mode: 0o600,
      flag: "wx",
    }),
  claim = (file) =>
    writeFileSync(file, "H validate-only claimed\n", {
      mode: 0o600,
      flag: "wx",
    }),
  now = () => Date.now(),
} = {}) {
  const counts = {
      read: 0,
      oauth_refresh: 0,
      validate_only: 0,
      write: 0,
      failed_http: 0,
    },
    nativeFetch = globalThis.fetch,
    state = { proven: false, plan_verified: false };
  let stock,
    db,
    evidence,
    directoryChecked = false,
    stage = "runtime_preflight";
  try {
    if (env.STAGE234_RUN_DIR !== "/acceptance-state")
      fail("h_directory_invalid");
    checkDirectory(env.STAGE234_RUN_DIR);
    directoryChecked = true;
    stock = await load();
    assertHRuntime(env, stock.config);
    globalThis.fetch = installHGuard(nativeFetch, state, counts, () =>
      claim(join(env.STAGE234_RUN_DIR, "h-warning-validation.claim")),
    );
    const vault = new stock.Vault(),
      context = await readContext(
        join(env.STAGE234_RUN_DIR, "fixture-context.json"),
        { vault, allowLegacyExpired: false, now: now() },
      );
    db = stock.createDatabase(stock.config.databaseUrl);
    const baseline = await db.client.mcpPreview.findUnique({
        where: { id: context.preview.preview_id },
        include: { account: true },
      }),
      key = await db.client.serviceToken.findUnique({
        where: { tokenDigest: digest(context.service_token) },
        include: { serviceIdentity: true },
      }),
      account = baseline?.account;
    if (!account || account.externalAccountId !== target.customer)
      fail("h_scoped_authority_invalid");
    const enabled = await db.client.providerAccount.findMany({
        where: {
          workspaceId: account.workspaceId,
          provider: "GOOGLE_ADS",
          enabled: true,
        },
        select: { externalAccountId: true },
      }),
      connection = await db.client.providerConnection.findUnique({
        where: { id: account.connectionId },
        include: { credential: true },
      });
    assertReadinessAuthority(
      { context, baseline, key, enabled, connection },
      now(),
    );
    if (!key.scopes.includes("adforge:mcp:write"))
      fail("h_write_scope_required");
    const adapter = new stock.Adapter(stock.config);
    let credentials = vault.decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (
      !credentials.accessToken ||
      !credentials.scopes?.includes("https://www.googleapis.com/auth/adwords")
    )
      fail("h_adwords_credential_missing");
    if (
      credentials.expiresAt &&
      Date.parse(credentials.expiresAt) <= now() + 60000
    ) {
      stage = "oauth_refresh";
      credentials = await adapter.refreshCredentials(credentials);
      const encrypted = vault.encrypt(credentials);
      await db.client.providerCredential.update({
        where: { connectionId: connection.id },
        data: {
          encryptedPayload: encrypted.ciphertext,
          encryptionVersion: encrypted.encryptionVersion,
        },
      });
    }
    const pending = () =>
      db.client.mcpPreview.count({
        where: {
          workspaceId: account.workspaceId,
          consumedAt: null,
          expiresAt: { gt: new Date(now()) },
        },
      });
    const pendingBefore = await pending();
    const auditBefore = await db.client.auditEvent.count({
      where: { workspaceId: account.workspaceId },
    });
    stage = "stock_build_validate_reread";
    const diagnostic = await runHAdapterDiagnostic(
      adapter,
      {
        credentials,
        accountId: target.customer,
        loginCustomerId: target.mcc,
        currency: "USD",
      },
      state,
    );
    const pendingAfter = await pending();
    const auditAfter = await db.client.auditEvent.count({
      where: { workspaceId: account.workspaceId },
    });
    if (
      pendingBefore !== pendingAfter ||
      auditBefore !== auditAfter ||
      counts.validate_only !== 1 ||
      counts.write !== 0
    )
      fail("h_preview_count_or_transport_invalid");
    evidence = {
      result: "PASS_WARNING_ONLY_DIAGNOSTIC",
      ...diagnostic,
      pending_preview_count_before: pendingBefore,
      pending_preview_count_after: pendingAfter,
      audit_count_before: auditBefore,
      audit_count_after: auditAfter,
    };
  } catch (e) {
    evidence = {
      result: "BLOCKED",
      failure_stage: stage,
      error: safeReadinessError(e),
    };
  } finally {
    globalThis.fetch = nativeFetch;
    if (db && stock?.closeDatabase)
      try {
        await stock.closeDatabase(db);
      } catch {
        evidence = {
          result: "BLOCKED",
          failure_stage: "database_close",
          error: { code: "h_database_close_failed" },
        };
      }
  }
  evidence = {
    ...evidence,
    acceptance_test: "H_WARNING_ONLY",
    test_customer_id: target.customer,
    campaign_id: target.campaign,
    budget_id: target.budget,
    source_head: /^[a-f0-9]{40}$/.test(env.STAGE234_SOURCE_HEAD ?? "")
      ? env.STAGE234_SOURCE_HEAD
      : null,
    harness_head: /^[a-f0-9]{40}$/.test(env.STAGE234_HARNESS_HEAD ?? "")
      ? env.STAGE234_HARNESS_HEAD
      : null,
    image_digest: /^sha256:[a-f0-9]{64}$/.test(env.STAGE234_IMAGE_DIGEST ?? "")
      ? env.STAGE234_IMAGE_DIGEST
      : null,
    full_mcp_approval_commit_acceptance: false,
    shared_budget_live_verified: false,
    persisted_preview_created: false,
    approval_performed: false,
    committed: false,
    provider_read_call_count: counts.read,
    validate_only_call_count: counts.validate_only,
    real_provider_write_call_count: counts.write,
    counts,
    production_changed: false,
    main_changed: false,
    timestamp: new Date(now()).toISOString(),
  };
  const file = directoryChecked
    ? join(env.STAGE234_RUN_DIR, "acceptance-H-warning-only-evidence.json")
    : null;
  if (file)
    try {
      save(file, evidence);
    } catch {
      evidence.result = "BLOCKED";
      evidence.error = { code: "h_evidence_write_failed" };
    }
  return {
    result: evidence.result,
    code: evidence.error?.code ?? null,
    read: counts.read,
    validate_only: counts.validate_only,
    write: counts.write,
    evidence: file,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const result = await runHWarningOnly();
  console.log(JSON.stringify(result));
  if (result.result !== "PASS_WARNING_ONLY_DIAGNOSTIC") process.exitCode = 1;
}

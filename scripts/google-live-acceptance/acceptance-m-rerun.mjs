// Live Acceptance B1 only: stock authenticated HTTP MCP preview, never approval/commit.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  identity,
  toolArguments,
  exactValidation,
} from "./acceptance-m-rerun-guard.mjs";
import { fixtureResources, proofQuery } from "./reconcile-read-guard.mjs";
// Restore the Acceptance B1 guard after imports (the shared read guard was already loaded).
createRequire("/workspace/apps/api/package.json")("reflect-metadata");
const { loadConfig } = await import("/workspace/packages/config/dist/index.js");
const { createDatabase, closeDatabase } =
  await import("/workspace/packages/database/dist/index.js");
const { GoogleAdsAdapter } =
  await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
const { CredentialVaultService } =
  await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
const { canonical } =
  await import("/workspace/apps/api/dist/providers/google-ads-stage1.js");
const { stage0Query } =
  await import("/workspace/apps/api/dist/providers/google-ads-stage0.js");
const config = loadConfig(),
  db = createDatabase(config.databaseUrl),
  root = "/acceptance-state";
const head = process.argv[2],
  stage0Id = "7a32e34a-32c4-471c-b912-e9928fdb655d";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const stateFiles = [
  "fixture-context.json",
  "fixture-commit-result.json",
  "fixture-reread.json",
  "fixture-budget-reconciliation.json",
  "fixture-commit-arm.json",
  "fixture-commit.claim",
  "test-proof.json",
  "acceptance-a-evidence.json",
  "acceptance-a-protected-context.json",
  "acceptance-a-proof.json",
  "acceptance-a-validation.json",
  "acceptance-a-validate.claim",
  "acceptance-a-calls.jsonl",
  "acceptance-b1-commit-evidence.json",
  "acceptance-b2-commit-evidence.json",
  "acceptance-c-evidence.json",
];
let stage = "preflight",
  server;
const evidence = {
  acceptance_test: "M",
  branch: "codex/google-ads-write-live-acceptance",
  HEAD: head,
  test_customer_id: "8590146099",
  campaign_id: identity.campaign_id,
  ad_group_id: identity.ad_group_id,
  criterion_id: identity.criterion_id,
  resource_name: identity.resource_name,
  requested_operation: "REMOVE_PROTECTION",
  semantic_payload: toolArguments,
  production_changed: false,
  main_changed: false,
  result: "BLOCKED",
};
const calls = () =>
  existsSync(root + "/acceptance-m-rerun-calls.jsonl")
    ? readFileSync(root + "/acceptance-m-rerun-calls.jsonl", "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
try {
  if (
    !/^[0-9a-f]{40}$/.test(head ?? "") ||
    existsSync(root + "/acceptance-m-rerun-evidence.json") ||
    existsSync(root + "/acceptance-m-rerun-validate.claim")
  )
    throw new Error("acceptance_m_rerun_already_attempted_or_head_mismatch");
  const url = new URL(config.databaseUrl);
  if (
    url.hostname !== "postgres" ||
    url.pathname !== "/google_acceptance" ||
    !config.previewOnly ||
    config.confirmedWriteEnabled ||
    !config.providerGoogleAdsWriteEnabled ||
    canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]' ||
    config.publicMcpWriteScopeEnabled ||
    config.publicMcpControlledWriteEnabled ||
    config.providerGoogleLoginCustomerId !== "4378327049" ||
    config.providerGoogleApiVersion !== "v24"
  )
    throw new Error("acceptance_m_rerun_unsafe_config");
  evidence.runtime_flags = {
    preview_only: true,
    confirmed_write_enabled: false,
    google_write_gate: true,
    write_allowlist: ["8590146099"],
    public_write_scope: false,
    public_controlled_write: false,
  };
  const fileHashes = Object.fromEntries(
    stateFiles.map((name) => [name, hash(readFileSync(root + "/" + name))]),
  );
  const reconciliation = JSON.parse(
    readFileSync(root + "/fixture-budget-reconciliation.json", "utf8"),
  );
  if (
    reconciliation.result !== "PASS" ||
    reconciliation.reconciled_result !== "VERIFIED" ||
    reconciliation.campaign_id !== identity.campaign_id ||
    reconciliation.keywords_verified !== 20
  )
    throw new Error("verified_fixture_evidence_missing");
  const old = await db.client.mcpPreview.findUnique({
    where: { id: stage0Id },
    include: {
      account: true,
      serviceToken: { include: { serviceIdentity: true } },
    },
  });
  const controlled = old?.serviceToken;
  const context = JSON.parse(
    readFileSync(root + "/fixture-context.json", "utf8"),
  );
  if (
    !old ||
    old.commitStatus !== "UNVERIFIED" ||
    !old.consumedAt ||
    old.account.externalAccountId !== "8590146099" ||
    !old.account.enabled ||
    old.account.workspaceId !== old.workspaceId ||
    !controlled ||
    controlled.revokedAt ||
    (controlled.expiresAt && controlled.expiresAt <= new Date()) ||
    controlled.resourceAccessMode !== "STATIC_ALLOWLIST" ||
    canonical(controlled.accountIds) !== canonical([old.accountId]) ||
    !controlled.scopes.includes("adforge:mcp:read") ||
    !controlled.scopes.includes("adforge:mcp:write") ||
    controlled.tokenDigest !== hash(context.service_token)
  )
    throw new Error("acceptance_m_rerun_controlled_key_or_account_invalid");
  const selectedAccounts = await db.client.providerAccount.findMany({
    where: {
      workspaceId: old.workspaceId,
      provider: "GOOGLE_ADS",
      enabled: true,
    },
    select: { externalAccountId: true },
  });
  if (
    selectedAccounts.length !== 1 ||
    selectedAccounts[0].externalAccountId !== "8590146099"
  )
    throw new Error("acceptance_m_rerun_foreign_account_selected");
  // Compare the exact historical Stage 0 row and every audit event, not only its status.
  const previousA = await db.client.mcpPreview.findUnique({
    where: { id: "d56aa0e6-8f96-4e4a-af53-efaffc4dbaea" },
  });
  const previousAHash = hash(canonical(previousA));
  const historical = await db.client.mcpPreview.findUnique({
      where: { id: stage0Id },
    }),
    historicalHash = hash(canonical(historical));
  const historyAudit = await db.client.auditEvent.findMany({
    where: { targetId: stage0Id },
    orderBy: { id: "asc" },
  });
  const countPrefix = readFileSync(root + "/provider-counts.jsonl", "utf8");
  const connection = await db.client.providerConnection.findUnique({
    where: { id: old.connectionId },
    include: { credential: true },
  });
  if (!connection?.credential || connection.workspaceId !== old.workspaceId)
    throw new Error("acceptance_m_rerun_disposable_vault_missing");
  const vault = new CredentialVaultService(),
    adapter = new GoogleAdsAdapter(config);
  let credentials = vault.decrypt(
    connection.credential.encryptedPayload,
    connection.credential.encryptionVersion,
  );
  if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
    throw new Error("acceptance_m_rerun_scope_missing");
  if (
    credentials.expiresAt &&
    Date.parse(credentials.expiresAt) <= Date.now() + 30000
  )
    credentials = await adapter.refreshCredentials(credentials);
  const read = (query) =>
    adapter.searchStream(
      credentials.accessToken,
      "8590146099",
      "4378327049",
      query,
    );
  stage = "test_customer_proof";
  const customerRows = await read(proofQuery);
  if (
    customerRows.length !== 1 ||
    String(customerRows[0]?.customer?.id) !== "8590146099" ||
    customerRows[0].customer.testAccount !== true
  )
    throw new Error("acceptance_m_rerun_test_account_not_proven");
  evidence.test_account = true;
  const readFixture = async () => {
    const snapshots = {};
    const kinds = {
      campaign_budget: "campaignBudget",
      campaign: "campaign",
      campaign_criterion: "campaignCriterion",
      ad_group: "adGroup",
      ad_group_criterion: "adGroupCriterion",
      ad_group_ad: "adGroupAd",
    };
    for (const [table, names] of Object.entries(fixtureResources)) {
      const query = stage0Query(
        kinds[table],
        `${table}.resource_name IN (${names.map((name) => `'${name}'`).join(", ")})`,
      );
      const entities = (await read(query))
        .map((row) => row[kinds[table]])
        .map((entity) => {
          const stable = { ...entity };
          delete stable.policySummary;
          return stable;
        })
        .sort((a, b) => canonical(a).localeCompare(canonical(b), "en"));
      if (
        entities.length !== names.length ||
        entities.some((e) => !names.includes(e.resourceName))
      )
        throw new Error("acceptance_m_rerun_fixture_inventory_mismatch");
      snapshots[table] = entities;
    }
    if (
      snapshots.campaign[0].status !== "PAUSED" ||
      snapshots.ad_group[0].status !== "PAUSED" ||
      snapshots.ad_group_ad[0].status !== "PAUSED" ||
      snapshots.ad_group_criterion.length !== 20 ||
      snapshots.ad_group_criterion.some((k) => k.status !== "ENABLED") ||
      snapshots.campaign[0].name !==
        "HM_MCP_WRITE_ACCEPTANCE_20261007T134837Z" ||
      snapshots.campaign[0].campaignBudget !==
        fixtureResources.campaign_budget[0] ||
      String(snapshots.campaign_budget[0].amountMicros) !== "2000000"
    )
      throw new Error("acceptance_m_rerun_fixture_state_changed_stop");
    return snapshots;
  };
  stage = "provider_before";
  const beforeFixture = await readFixture();
  const providerContext = {
    accountId: "8590146099",
    currency: "USD",
    credentials,
    metadata: { loginCustomerId: "4378327049" },
  };
  const before = (
    await adapter.readKeywordStates(providerContext, [identity])
  )[0];
  if (
    before.status !== "ENABLED" ||
    before.keyword !== "test marketing" ||
    before.match_type !== "EXACT" ||
    before.campaign_status !== "PAUSED" ||
    before.ad_group_status !== "PAUSED"
  )
    throw new Error("acceptance_m_rerun_keyword_state_unexpected");
  evidence.keyword_text = before.keyword;
  evidence.match_type = before.match_type;
  evidence.provider_state_before = before;
  evidence.expected_after_state = { ...before, status: "REMOVED" };
  writeFileSync(
    root + "/acceptance-m-rerun-proof.json",
    JSON.stringify({
      customer_id: "8590146099",
      test_account: true,
      mcc_id: "4378327049",
      status: before.status,
      resource_name: before.resource_name,
      verified_at: new Date().toISOString(),
    }),
    { mode: 0o600, flag: "wx" },
  );
  const { resourceQuery } =
    await import("/workspace/apps/api/dist/providers/google-ads-stage1.js");
  writeFileSync(
    root + "/acceptance-m-rerun-queries.json",
    JSON.stringify([
      resourceQuery("campaigns", "campaign.id = 24324170853"),
      resourceQuery("adGroups", "ad_group.id = 206587491811"),
      resourceQuery(
        "adGroupCriteria",
        "ad_group.id = 206587491811 AND ad_group_criterion.type = KEYWORD",
      ),
    ]),
    { mode: 0o600, flag: "wx" },
  );
  stage = "stock_mcp_runtime";
  server = spawn(
    process.execPath,
    [
      "--max-old-space-size=192",
      "--import",
      "/acceptance/acceptance-m-rerun-guard.mjs",
      "/workspace/apps/api/dist/main.js",
    ],
    {
      cwd: "/workspace",
      stdio: "ignore",
      env: { ...process.env, LOG_LEVEL: "error" },
    },
  );
  let healthy = false;
  for (let i = 0; i < 35; i++) {
    if (server.exitCode !== null)
      throw new Error("acceptance_m_rerun_stock_api_start_failed");
    try {
      const response = await fetch("http://127.0.0.1:4000/ready", {
        signal: AbortSignal.timeout(2000),
      });
      if (response.status === 200) {
        healthy = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!healthy) throw new Error("acceptance_m_rerun_stock_api_not_ready");
  stage = "single_stock_mcp_preview";
  const response = await fetch("http://127.0.0.1:4000/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${context.service_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "preview_delete_or_archive_object",
        arguments: toolArguments,
      },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const rpc = await response.json();
  const preview =
    rpc.result?.structuredContent ??
    (rpc.result?.content?.[0]?.text
      ? JSON.parse(rpc.result.content[0].text)
      : rpc.error);
  if (!response.ok || rpc.result?.isError || preview?.status !== "preview") {
    evidence.preview_result = {
      status: preview?.status ?? "FAILED",
      code: preview?.code ?? rpc.error?.code ?? null,
    };
    throw new Error("acceptance_m_rerun_preview_failed");
  }
  writeFileSync(
    root + "/acceptance-m-rerun-protected-context.json",
    JSON.stringify({ service_token: context.service_token, preview }),
    { mode: 0o600, flag: "wx" },
  );
  const item = preview.items?.[0];
  if (
    preview.provider !== "GOOGLE_ADS" ||
    preview.account_id !== "8590146099" ||
    preview.operation_count !== 1 ||
    preview.items.length !== 1 ||
    preview.provider_mutation_sent !== false ||
    preview.provider_validation !== "passed" ||
    item.before?.resource_name !== identity.resource_name ||
    item.before?.status !== "ENABLED" ||
    item.after?.status !== "REMOVED" ||
    item.after?.reversible !== false ||
    !item.warnings?.some((w) => w.includes("нельзя восстановить"))
  )
    throw new Error("acceptance_m_rerun_removal_preview_invalid");
  async function mcp(name, args) {
    const response = await fetch("http://127.0.0.1:4000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${context.service_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name, arguments: args },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const rpc = await response.json();
    return {
      is_error: Boolean(rpc.result?.isError || rpc.error),
      result:
        rpc.result?.structuredContent ??
        (rpc.result?.content?.[0]?.text
          ? JSON.parse(rpc.result.content[0].text)
          : rpc.error),
    };
  }
  stage = "unapproved_removal_commit_refusal";
  const refusal = await mcp("commit_preview", {
    preview_token: preview.preview_token,
  });
  if (!refusal.is_error || refusal.result?.code !== "preview_not_confirmed")
    throw new Error("acceptance_m_rerun_missing_approval_not_rejected");
  evidence.commit_refusal = {
    code: refusal.result.code,
    message: refusal.result.message,
    provider_mutation_sent: false,
  };
  evidence.preview_result = {
    status: preview.status,
    preview_id: preview.preview_id,
    expires_at: preview.expires_at,
    provider: preview.provider,
    account_id: preview.account_id,
    operation_count: preview.operation_count,
    items: preview.items,
    provider_validation: preview.provider_validation,
    provider_mutation_sent: preview.provider_mutation_sent,
  };
  evidence.validation_result = JSON.parse(
    readFileSync(root + "/acceptance-m-rerun-validation.json", "utf8"),
  );
  if (
    evidence.validation_result.http_status !== 200 ||
    canonical(evidence.validation_result.operations) !==
      canonical(exactValidation.operations)
  )
    throw new Error("acceptance_m_rerun_google_validation_failed");
  stage = "provider_after";
  const after = (
    await adapter.readKeywordStates(providerContext, [identity])
  )[0];
  const afterFixture = await readFixture();
  evidence.provider_state_after_preview = after;
  evidence.before_after_unchanged = canonical(before) === canonical(after);
  evidence.fixture_unchanged =
    canonical(beforeFixture) === canonical(afterFixture);
  if (!evidence.before_after_unchanged || !evidence.fixture_unchanged)
    throw new Error("acceptance_m_rerun_provider_state_changed_stop");
  const stored = await db.client.mcpPreview.findUnique({
    where: { id: preview.preview_id },
  });
  if (
    !stored ||
    stored.commitStatus !== "PREVIEWED" ||
    stored.confirmedAt ||
    stored.approvedByUserId ||
    stored.approvalSessionId ||
    stored.consumedAt ||
    stored.commitAttemptedAt ||
    stored.cancelledAt ||
    stored.operation !== "GOOGLE_STAGE1_KEYWORD_REMOVE" ||
    stored.requestedState?.operations?.length !== 1 ||
    stored.requestedState.operations[0].method !== "remove" ||
    stored.requestedState.operations[0].resource_name !==
      identity.resource_name ||
    stored.accountId !== old.accountId ||
    stored.workspaceId !== old.workspaceId
  )
    throw new Error("acceptance_m_rerun_preview_persistence_mismatch");
  evidence.approval_performed = false;
  evidence.commit_performed = false;
  evidence.unapproved_commit_request_sent = true;
  evidence.preview_stored_status = stored.commitStatus;
  evidence.fixture_state = {
    campaign_status: afterFixture.campaign[0].status,
    ad_group_status: afterFixture.ad_group[0].status,
    rsa_status: afterFixture.ad_group_ad[0].status,
    keyword_count: 20,
    budget_micros: afterFixture.campaign_budget[0].amountMicros,
  };
  for (const [name, digest] of Object.entries(fileHashes))
    if (hash(readFileSync(root + "/" + name)) !== digest)
      throw new Error("acceptance_m_rerun_historical_evidence_changed");
  if (
    hash(
      canonical(
        await db.client.mcpPreview.findUnique({ where: { id: stage0Id } }),
      ),
    ) !== historicalHash ||
    canonical(
      await db.client.auditEvent.findMany({
        where: { targetId: stage0Id },
        orderBy: { id: "asc" },
      }),
    ) !== canonical(historyAudit)
  )
    throw new Error("acceptance_m_rerun_historical_preview_or_audit_changed");
  if (
    !readFileSync(root + "/provider-counts.jsonl", "utf8").startsWith(
      countPrefix,
    )
  )
    throw new Error("acceptance_m_rerun_historical_counters_changed");
  const selectedAfter = await db.client.providerAccount.findMany({
    where: {
      workspaceId: old.workspaceId,
      provider: "GOOGLE_ADS",
      enabled: true,
    },
    select: { externalAccountId: true },
  });
  if (canonical(selectedAfter) !== canonical(selectedAccounts))
    throw new Error("acceptance_m_rerun_selected_accounts_changed");
  const events = calls();
  if (
    events.filter((e) => e.type === "validate_only").length !== 1 ||
    events.some(
      (e) => !["read", "validate_only", "oauth_refresh"].includes(e.type),
    ) ||
    events.some(
      (e) => e.type !== "oauth_refresh" && e.customer !== "8590146099",
    )
  )
    throw new Error("acceptance_m_rerun_counter_or_account_invariant_failed");
  if (
    hash(
      canonical(
        await db.client.mcpPreview.findUnique({
          where: { id: "d56aa0e6-8f96-4e4a-af53-efaffc4dbaea" },
        }),
      ),
    ) !== previousAHash
  )
    throw new Error("acceptance_m_rerun_previous_a_changed");
  evidence.immutable_preview_fingerprint = hash(
    canonical({
      payload: stored.payload,
      beforeState: stored.beforeState,
      requestedState: stored.requestedState,
      snapshotDigest: stored.snapshotDigest,
      accountId: stored.accountId,
      workspaceId: stored.workspaceId,
      operation: stored.operation,
    }),
  );
  evidence.historical_evidence_unchanged = true;
  evidence.no_provider_side_effects = true;
  evidence.result = "PASS";
} catch (error) {
  evidence.result = "BLOCKED";
  evidence.failure_stage = stage;
  evidence.error_class = error.constructor.name;
  evidence.code =
    error.code ??
    (/^[a-z_]+$/.test(error.message)
      ? error.message
      : "acceptance_m_rerun_internal_error");
  evidence.provider_status = error.providerStatus ?? null;
  evidence.provider_code = error.providerCode ?? null;
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      server.once("exit", resolve);
      setTimeout(resolve, 5000);
    });
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  const events = calls();
  evidence.provider_read_call_count = events.filter(
    (e) => e.type === "read",
  ).length;
  evidence.validate_only_call_count = events.filter(
    (e) => e.type === "validate_only",
  ).length;
  evidence.real_provider_write_call_count = events.filter(
    (e) => e.type === "write",
  ).length;
  evidence.oauth_refresh_call_count = events.filter(
    (e) => e.type === "oauth_refresh",
  ).length;
  evidence.timestamp = new Date().toISOString();
  writeFileSync(
    root + "/acceptance-m-rerun-evidence.json",
    JSON.stringify(evidence),
    { mode: 0o600, flag: "wx" },
  );
  console.log(JSON.stringify(evidence));
  await closeDatabase(db);
}

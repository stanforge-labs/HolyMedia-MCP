// C mixed-batch rerun: actual HTTP MCP with fixed product module; no approval/commit.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  identity,
  toolArguments,
  exactValidation,
  batchQuery,
  batchIdentities,
} from "./acceptance-c-rerun-guard.mjs";
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
];
let stage = "preflight",
  server;
const evidence = {
  acceptance_test: "C",
  branch: "codex/google-ads-write-live-acceptance",
  HEAD: head,
  test_customer_id: "8590146099",
  campaign_id: identity.campaign_id,
  ad_group_id: identity.ad_group_id,
  criterion_id: identity.criterion_id,
  resource_name: identity.resource_name,
  requested_operation: "PAUSE",
  semantic_payload: toolArguments,
  production_changed: false,
  main_changed: false,
  result: "BLOCKED",
};
const calls = () =>
  existsSync(root + "/acceptance-c-rerun-calls.jsonl")
    ? readFileSync(root + "/acceptance-c-rerun-calls.jsonl", "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
try {
  if (
    !/^[0-9a-f]{40}$/.test(head ?? "") ||
    existsSync(root + "/acceptance-c-rerun-evidence.json") ||
    existsSync(root + "/acceptance-c-rerun-validate.claim")
  )
    throw new Error("acceptance_c_rerun_already_attempted_or_head_mismatch");
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
    throw new Error("acceptance_c_rerun_unsafe_config");
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
    throw new Error("acceptance_c_rerun_controlled_key_or_account_invalid");
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
    throw new Error("acceptance_c_rerun_foreign_account_selected");
  // Compare the exact historical Stage 0 row and every audit event, not only its status.
  const completedB = JSON.parse(
    readFileSync(root + "/acceptance-b2-commit-evidence.json", "utf8"),
  );
  if (
    completedB.result !== "RESUME_PASS" ||
    completedB.provider_state_after_commit.status !== "ENABLED" ||
    completedB.two_distinct_journal_entries !== true
  )
    throw new Error("acceptance_c_rerun_b_incomplete");
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
    throw new Error("acceptance_c_rerun_disposable_vault_missing");
  const vault = new CredentialVaultService(),
    adapter = new GoogleAdsAdapter(config);
  let credentials = vault.decrypt(
    connection.credential.encryptedPayload,
    connection.credential.encryptionVersion,
  );
  if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
    throw new Error("acceptance_c_rerun_scope_missing");
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
    throw new Error("acceptance_c_rerun_test_account_not_proven");
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
        throw new Error("acceptance_c_rerun_fixture_inventory_mismatch");
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
      throw new Error("acceptance_c_rerun_fixture_state_changed_stop");
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
    throw new Error("acceptance_c_rerun_keyword_state_unexpected");
  evidence.keyword_text = before.keyword;
  evidence.match_type = before.match_type;
  evidence.provider_state_before = before;
  evidence.expected_after_state = { ...before, status: "ENABLED" }; // Sentinel is excluded from the batch.
  writeFileSync(
    root + "/acceptance-c-rerun-proof.json",
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
  const batchBefore = await read(batchQuery);
  if (
    batchBefore.length !== 19 ||
    batchBefore.some(
      (row) =>
        !batchIdentities
          .slice(0, 19)
          .some((i) => i.resource_name === row.adGroupCriterion?.resourceName),
    )
  )
    throw new Error("acceptance_c_rerun_invalid_criterion_not_proven");
  if (batchBefore.some((row) => row.adGroupCriterion.status !== "ENABLED"))
    throw new Error("acceptance_c_rerun_existing_keywords_not_enabled");
  evidence.batch_provider_state_before = batchBefore;
  evidence.runtime_product_module_sha256 = hash(
    readFileSync("/workspace/apps/api/dist/mcp/mcp-preview.service.js"),
  );
  evidence.batch_size = 20;
  evidence.existing_keywords = 19;
  evidence.invalid_criterion_id = "999999999999";
  stage = "stock_mcp_runtime";
  server = spawn(
    process.execPath,
    [
      "--max-old-space-size=192",
      "--import",
      "/acceptance/acceptance-c-rerun-guard.mjs",
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
      throw new Error("acceptance_c_rerun_stock_api_start_failed");
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
  if (!healthy) throw new Error("acceptance_c_rerun_stock_api_not_ready");
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
      params: { name: "pause_entities_preview", arguments: toolArguments },
    }),
    signal: AbortSignal.timeout(60000),
  });
  const rpc = await response.json();
  const preview =
    rpc.result?.structuredContent ??
    (rpc.result?.content?.[0]?.text
      ? JSON.parse(rpc.result.content[0].text)
      : rpc.error);
  evidence.preview_result = {
    status: preview?.status ?? "ERROR",
    code: preview?.code ?? rpc.error?.code ?? null,
    message: preview?.message ?? null,
    google_code: preview?.google_code ?? preview?.google_error_code ?? null,
    is_error: Boolean(rpc.result?.isError || rpc.error),
  };
  if (preview?.status === "preview") {
    writeFileSync(
      root + "/acceptance-c-rerun-protected-context.json",
      JSON.stringify({ service_token: context.service_token, preview }),
      { mode: 0o600, flag: "wx" },
    );
    evidence.preview_result = {
      status: "preview",
      preview_id: preview.preview_id,
      expires_at: preview.expires_at,
      operation_count: preview.operation_count,
      items: preview.items,
      provider_validation: preview.provider_validation,
    };
    evidence.approval_required = true;
  }
  if (
    rpc.result?.isError ||
    rpc.error ||
    preview?.status !== "preview" ||
    preview.operation_count !== 19 ||
    preview.requested_operation_count !== 20 ||
    preview.excluded_operation_count !== 1 ||
    preview.provider_validation !== "passed" ||
    preview.items?.length !== 20 ||
    preview.items
      .slice(0, 19)
      .some(
        (row, i) =>
          row.resource_name !== batchIdentities[i].resource_name ||
          row.before_status !== "ENABLED" ||
          row.after_status !== "PAUSED" ||
          row.eligible_for_commit !== true ||
          row.row_error ||
          row.google_validation?.success !== true,
      ) ||
    preview.items[19]?.criterion_id !== "999999999999" ||
    preview.items[19]?.eligible_for_commit !== false ||
    preview.items[19]?.row_error?.source !== "HOLYMEDIA" ||
    preview.items[19]?.row_error?.google_code !== null ||
    preview.items[19]?.google_validation?.status !==
      "not_sent_snapshot_rejected"
  )
    throw new Error("acceptance_c_rerun_mixed_preview_contract_failed");
  const stored = await db.client.mcpPreview.findUnique({
    where: { id: preview.preview_id },
  });
  if (
    !stored ||
    stored.operation !== "GOOGLE_KEYWORD_STATUS" ||
    stored.confirmedAt ||
    stored.consumedAt ||
    stored.cancelledAt ||
    stored.expiresAt <= new Date() ||
    stored.payload.items.length !== 20 ||
    stored.payload.batch_rejections.length !== 1 ||
    stored.beforeState.length !== 19 ||
    stored.requestedState.length !== 19 ||
    stored.requestedState.some(
      (row, i) =>
        row.resource_name !== batchIdentities[i].resource_name ||
        row.status !== "PAUSED",
    )
  )
    throw new Error("acceptance_c_rerun_immutable_plan_invalid");
  evidence.immutable_preview_fingerprint = hash(
    canonical({
      payload: stored.payload,
      before: stored.beforeState,
      requested: stored.requestedState,
      digest: stored.snapshotDigest,
      expiresAt: stored.expiresAt,
    }),
  );
  evidence.validation_result = JSON.parse(
    readFileSync(root + "/acceptance-c-rerun-validation.json", "utf8"),
  );
  if (
    evidence.validation_result.http_status !== 200 ||
    evidence.validation_result.operations.length !== 19 ||
    evidence.validation_result.validate_only !== true ||
    evidence.validation_result.partial_failure !== true
  )
    throw new Error("acceptance_c_rerun_validation_invariant_failed");
  stage = "provider_after";
  const after = (
    await adapter.readKeywordStates(providerContext, [identity])
  )[0];
  const afterFixture = await readFixture();
  evidence.provider_state_after_preview = after;
  evidence.before_after_unchanged = canonical(before) === canonical(after);
  evidence.batch_provider_state_after_preview = afterFixture.ad_group_criterion;
  evidence.fixture_unchanged =
    canonical(beforeFixture) === canonical(afterFixture);
  if (!evidence.before_after_unchanged || !evidence.fixture_unchanged)
    throw new Error("acceptance_c_rerun_provider_state_changed_stop");
  evidence.approval_performed = false;
  evidence.commit_performed = false;
  evidence.preview_created = preview?.status === "preview";
  evidence.fixture_state = {
    campaign_status: afterFixture.campaign[0].status,
    ad_group_status: afterFixture.ad_group[0].status,
    rsa_status: afterFixture.ad_group_ad[0].status,
    keyword_count: 20,
    budget_micros: afterFixture.campaign_budget[0].amountMicros,
  };
  for (const [name, digest] of Object.entries(fileHashes))
    if (hash(readFileSync(root + "/" + name)) !== digest)
      throw new Error("acceptance_c_rerun_historical_evidence_changed");
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
    throw new Error("acceptance_c_rerun_historical_preview_or_audit_changed");
  if (
    !readFileSync(root + "/provider-counts.jsonl", "utf8").startsWith(
      countPrefix,
    )
  )
    throw new Error("acceptance_c_rerun_historical_counters_changed");
  const selectedAfter = await db.client.providerAccount.findMany({
    where: {
      workspaceId: old.workspaceId,
      provider: "GOOGLE_ADS",
      enabled: true,
    },
    select: { externalAccountId: true },
  });
  if (canonical(selectedAfter) !== canonical(selectedAccounts))
    throw new Error("acceptance_c_rerun_selected_accounts_changed");
  const events = calls();
  if (
    events.filter((e) => e.type === "validate_only").length > 1 ||
    events.some(
      (e) => !["read", "validate_only", "oauth_refresh"].includes(e.type),
    ) ||
    events.some(
      (e) => e.type !== "oauth_refresh" && e.customer !== "8590146099",
    )
  )
    throw new Error("acceptance_c_rerun_counter_or_account_invariant_failed");
  if (
    hash(
      canonical(
        await db.client.mcpPreview.findUnique({
          where: { id: "d56aa0e6-8f96-4e4a-af53-efaffc4dbaea" },
        }),
      ),
    ) !== previousAHash
  )
    throw new Error("acceptance_c_rerun_previous_a_changed");
  if (events.filter((e) => e.type === "validate_only").length !== 1)
    throw new Error("acceptance_c_rerun_validate_count_mismatch");
  evidence.historical_evidence_unchanged = true;
  evidence.no_provider_side_effects = true;
  evidence.result = evidence.preview_created
    ? "WAITING_FOR_BATCH_APPROVAL"
    : "BLOCKED";
  evidence.blocker = evidence.preview_created
    ? "MANUAL_APPROVAL_REQUIRED"
    : "MIXED_PREVIEW_FAILED";
  evidence.expected_commit_result =
    "19 successes and 1 structured HOLYMEDIA snapshot_read error (not a Google mutation error)";
  evidence.actual_commit_result = "NOT EXECUTED";
  evidence.root_cause =
    "Corrected per-row snapshot contract excludes only the unavailable row; exact validated 19-operation plan and signed rejection remain immutable.";
} catch (error) {
  evidence.result = "BLOCKED";
  evidence.failure_stage = stage;
  evidence.error_class = error.constructor.name;
  evidence.code =
    error.code ??
    (/^[a-z_]+$/.test(error.message)
      ? error.message
      : "acceptance_c_rerun_internal_error");
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
    root + "/acceptance-c-rerun-evidence.json",
    JSON.stringify(evidence),
    { mode: 0o600, flag: "wx" },
  );
  console.log(JSON.stringify(evidence));
  await closeDatabase(db);
}

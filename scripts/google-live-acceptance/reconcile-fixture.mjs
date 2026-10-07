// Executes corrected product verifier over immutable existing plan, never commit/mutate.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { proofQuery, fixtureResources } from "./reconcile-read-guard.mjs";
createRequire("/workspace/apps/api/package.json")("reflect-metadata");
const { loadConfig } = await import("/workspace/packages/config/dist/index.js");
const { createDatabase, closeDatabase } =
  await import("/workspace/packages/database/dist/index.js");
const { CredentialVaultService } =
  await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
const { GoogleAdsAdapter } =
  await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
const { canonical } =
  await import("/workspace/apps/api/dist/providers/google-ads-stage1.js");
const { verifyStage0Mutation } =
  await import("/workspace/apps/api/dist/providers/google-ads-stage0.js");
const { AuditService } =
  await import("/workspace/apps/api/dist/audit/audit.service.js");
const config = loadConfig(),
  db = createDatabase(config.databaseUrl),
  root = "/acceptance-state";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const counts = () =>
  readFileSync(root + "/provider-counts.jsonl", "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
const previewId = "7a32e34a-32c4-471c-b912-e9928fdb655d",
  commitId = "hmc_WYmKzVTcdxdkNxEP_jrzTjNP-sZX4X3aEt4mUIew0Ag";
const fixSource = process.argv[2],
  verifierHash = process.argv[3];
let stage = "preflight";
try {
  if (
    fixSource !== "4cead41ea4e430dc00698cee29511425ffb20661" ||
    sha(
      readFileSync("/workspace/apps/api/dist/providers/google-ads-stage0.js"),
    ) !== verifierHash
  )
    throw new Error("corrected_verifier_identity_mismatch");
  const databaseUrl = new URL(config.databaseUrl);
  if (
    databaseUrl.hostname !== "postgres" ||
    databaseUrl.pathname !== "/google_acceptance" ||
    !config.previewOnly ||
    config.confirmedWriteEnabled ||
    config.providerGoogleAdsWriteEnabled ||
    config.googleAdsWriteAccountAllowlist.length ||
    config.publicMcpWriteScopeEnabled ||
    config.publicMcpControlledWriteEnabled ||
    config.providerGoogleLoginCustomerId !== "4378327049" ||
    config.providerGoogleApiVersion !== "v24"
  )
    throw new Error("reconcile_config_not_read_only");
  const original = await db.client.mcpPreview.findUnique({
    where: { id: previewId },
    include: { account: true },
  });
  if (
    !original ||
    original.account.externalAccountId !== "8590146099" ||
    original.provider !== "GOOGLE_ADS" ||
    original.commitStatus !== "UNVERIFIED" ||
    !original.consumedAt ||
    !original.confirmedAt
  )
    throw new Error("original_commit_mismatch");
  const plan = original.requestedState;
  if (
    plan.version !== 0 ||
    plan.operations.length !== 26 ||
    plan.account_id !== "8590146099" ||
    plan.summary.campaign_name !== "HM_MCP_WRITE_ACCEPTANCE_20261007T134837Z" ||
    sha(canonical(plan)) !== original.snapshotDigest ||
    canonical(original.beforeState) !== canonical(plan.checks)
  )
    throw new Error("immutable_legacy_plan_mismatch");
  const immutablePreview = sha(canonical(original));
  const receiptRows = original.providerResult.flatMap(
    (item) => item.operations,
  );
  const allowed = new Set(Object.values(fixtureResources).flat());
  const results = plan.operations.map((_, index) => {
    const receipt = receiptRows.find((r) => r.operation === index);
    if (!allowed.has(receipt?.resource_name))
      throw new Error("historical_resource_identity_mismatch");
    // Receipt resource identity is reused, not the old verifier's success flag.
    return { success: true, resource_name: receipt.resource_name, error: null };
  });
  if (new Set(results.map((r) => r.resource_name)).size !== 26)
    throw new Error("duplicate_historical_resource_identity");
  const auditBefore = await db.client.auditEvent.findMany({
    where: { targetType: "mcp_preview", targetId: previewId },
    orderBy: { id: "asc" },
  });
  if (
    !auditBefore.some(
      (e) =>
        e.eventType === "mcp_google_commit_result" &&
        e.metadata.result === "UNVERIFIED" &&
        e.metadata.commitId === commitId,
    )
  )
    throw new Error("original_audit_missing");
  const beforeCounts = counts();
  const connection = await db.client.providerConnection.findUnique({
    where: { id: original.connectionId },
    include: { credential: true },
  });
  if (
    !connection?.credential ||
    connection.workspaceId !== original.workspaceId
  )
    throw new Error("disposable_credential_missing");
  const vault = new CredentialVaultService(),
    adapter = new GoogleAdsAdapter(config);
  let credentials = vault.decrypt(
    connection.credential.encryptedPayload,
    connection.credential.encryptionVersion,
  );
  if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
    throw new Error("adwords_scope_missing");
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
  stage = "test_account_proof";
  const customerRows = await read(proofQuery),
    customer = customerRows[0]?.customer;
  if (
    customerRows.length !== 1 ||
    String(customer?.id) !== "8590146099" ||
    customer.testAccount !== true ||
    customer.currencyCode !== "USD"
  )
    throw new Error("test_account_not_proven");
  stage = "corrected_product_verifier";
  const verified = await verifyStage0Mutation(plan, results, read);
  const byKind = (kind) =>
    verified.items.filter((_, i) => plan.operations[i].kind === kind);
  const passed = (kind) => byKind(kind).every((item) => item.success);
  const actualCampaign = verified.actual[1],
    actualBudget = verified.actual[0];
  if (
    verified.status !== "VERIFIED" ||
    actualCampaign.status !== "PAUSED" ||
    actualBudget.name !== actualCampaign.name ||
    String(actualBudget.amountMicros) !== "2000000"
  )
    throw new Error("corrected_reconciliation_not_verified");
  const afterCounts = counts(),
    newCalls = afterCounts.slice(beforeCounts.length);
  if (
    newCalls.some((call) => !["read", "oauth_refresh"].includes(call.type)) ||
    newCalls.some(
      (call) => call.type === "read" && call.customer !== "8590146099",
    )
  )
    throw new Error("reconcile_counter_violation");
  if (
    sha(
      canonical(
        await db.client.mcpPreview.findUnique({
          where: { id: previewId },
          include: { account: true },
        }),
      ),
    ) !== immutablePreview
  )
    throw new Error("historical_preview_changed");
  const originalAuditAfter = await db.client.auditEvent.findMany({
    where: { id: { in: auditBefore.map((event) => event.id) } },
    orderBy: { id: "asc" },
  });
  if (canonical(originalAuditAfter) !== canonical(auditBefore))
    throw new Error("historical_audit_changed");
  stage = "separate_reconciliation_audit";
  const audit = new AuditService(db);
  await audit.record({
    eventType: "mcp_google_commit_reconciled",
    actorType: "SERVICE",
    actorUserId: original.approvedByUserId,
    workspaceId: original.workspaceId,
    targetType: "mcp_preview",
    targetId: previewId,
    success: true,
    metadata: {
      provider: "GOOGLE_ADS",
      accountId: "8590146099",
      campaignId: "24324170853",
      previewId,
      commitId,
      originalResult: "UNVERIFIED",
      reconciledResult: "VERIFIED",
      fixSource,
      verifierHash,
      verifiedOperationCount: 26,
      providerWriteCalls: 0,
    },
  });
  const reconciliationAudit = await db.client.auditEvent.findFirst({
    where: { targetId: previewId, eventType: "mcp_google_commit_reconciled" },
    orderBy: { createdAt: "desc" },
  });
  const report = {
    result: "PASS",
    fix_source: fixSource,
    verifier_sha256: verifierHash,
    preview_id: previewId,
    commit_id: commitId,
    original_commit: "UNVERIFIED",
    reconciled_result: verified.status,
    campaign: passed("campaign") ? "VERIFIED" : "FAIL",
    budget: passed("campaignBudget") ? "VERIFIED" : "FAIL",
    ad_group: passed("adGroup") ? "VERIFIED" : "FAIL",
    keywords_verified: byKind("adGroupCriterion").filter((i) => i.success)
      .length,
    rsa: passed("adGroupAd") ? "VERIFIED" : "FAIL",
    geo_language: passed("campaignCriterion") ? "VERIFIED" : "FAIL",
    campaign_id: "24324170853",
    budget_id: "15934365976",
    ad_group_id: "206587491811",
    rsa_id: "827349040712",
    campaign_status: actualCampaign.status,
    budget_name: actualBudget.name,
    budget_micros: actualBudget.amountMicros,
    test_account: true,
    original_preview_unchanged: true,
    original_audit_unchanged: true,
    reconciliation_audit_id: reconciliationAudit.id,
    reconciliation_timestamp: reconciliationAudit.createdAt.toISOString(),
    real_provider_read_calls: newCalls.filter((c) => c.type === "read").length,
    real_provider_write_calls: 0,
    validate_only_calls: 0,
    historical_provider_write_calls: afterCounts.filter(
      (c) => c.type === "write",
    ).length,
    verified_resources: verified.items.flatMap((item) =>
      item.operations.map((op) => ({
        operation: op.operation,
        resource_name: op.resource_name,
        success: op.success,
      })),
    ),
  };
  writeFileSync(
    root + "/fixture-budget-reconciliation.json",
    JSON.stringify(report),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} catch (error) {
  console.log(
    JSON.stringify({
      result: "BLOCKED",
      stage,
      error_class: error.constructor.name,
      code:
        error.code ??
        (/^[a-z_]+$/.test(error.message)
          ? error.message
          : "reconciliation_error"),
      provider_status: error.providerStatus ?? null,
      provider_code: error.providerCode ?? null,
      provider_mutation_initiated: false,
    }),
  );
  process.exitCode = 1;
} finally {
  await closeDatabase(db);
}

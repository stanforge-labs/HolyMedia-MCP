import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
  readAcceptanceContext,
  sealAcceptanceContext,
} from "./context-vault.mjs";
import { assertScopedIPreviewKey } from "./audience-preview-runner.mjs";
import { assertCreatedAudience } from "./audience-commit-runner.mjs";
import { queries, safeError } from "./live-guard.mjs";
import { waitLocalReady } from "./wait-local-ready.mjs";
import { startupDiagnostics } from "./startup-diagnostics.mjs";
import {
  installRemoveGuard,
  restoreTool,
  assertRemovePlan,
  target,
  canonical,
  digest,
  protectedJson,
  fail,
  READINESS_SNAPSHOT_QUERIES,
} from "./audience-remove-guard.mjs";
export async function runIRemovePreview() {
  installRemoveGuard();
  const env = process.env,
    root = env.STAGE234_RUN_DIR;
  const save = (name, value) =>
    writeFileSync(join(root, name), JSON.stringify(value, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  let db,
    closeDatabase,
    server,
    gateway,
    startupEvidence,
    stage = "origin_preflight";
  const callCounts = () => {
    let calls = [];
    try {
      calls = readFileSync(join(root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {
      /* No calls before preflight. */
    }
    return {
      provider_read_call_count: calls.filter((c) =>
        ["read", "read_mcc"].includes(c.type),
      ).length,
      validate_only_call_count: calls.filter((c) => c.type === "validate_only")
        .length,
      real_provider_write_call_count: 0,
      oauth_refresh_call_count: calls.filter((c) => c.type === "oauth_refresh")
        .length,
    };
  };
  try {
    const origin = protectedJson(join(root, "i-origin.json")),
      tool = restoreTool(origin),
      committed = protectedJson(join(root, "i-add-blocked-origin.json")),
      addPreview = protectedJson(join(root, "i-add-preview-origin.json"));
    if (
      committed.commit?.commit_id !== origin.commit_id ||
      committed.commit.preview_id !== origin.preview_id ||
      addPreview.preview_id !== origin.preview_id ||
      committed.real_provider_write_call_count !== 1
    )
      fail("stage234_i_remove_commit_origin_invalid");
    createRequire("/workspace/apps/api/package.json")("reflect-metadata");
    const { loadConfig } =
      await import("/workspace/packages/config/dist/index.js");
    const database = await import("/workspace/packages/database/dist/index.js");
    closeDatabase = database.closeDatabase;
    const { CredentialVaultService } =
      await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
    const { GoogleAdsAdapter } =
      await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
    const { stage3ToolIntent } =
      await import("/workspace/apps/api/dist/mcp/mcp-google-stage3-schema.js");
    const config = loadConfig();
    if (
      new URL(config.databaseUrl).hostname !== "postgres" ||
      new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
      new URL(config.redisUrl).hostname !== "redis" ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]' ||
      config.confirmedWriteEnabled ||
      !config.previewOnly
    )
      fail("stage234_i_remove_config_invalid");
    db = database.createDatabase(config.databaseUrl);
    const context = await readAcceptanceContext(
      join(root, "fixture-context.json"),
    );
    const original = await db.client.mcpPreview.findUnique({
        where: { id: origin.preview_id },
        include: { account: true },
      }),
      account = original?.account;
    const key = await db.client.serviceToken.findUnique({
      where: { tokenDigest: digest(context.service_token ?? "") },
      include: { serviceIdentity: true },
    });
    assertScopedIPreviewKey({ context, key, account });
    if (
      original.commitStatus !== "VERIFIED" ||
      !original.consumedAt ||
      original.snapshotDigest !== origin.immutable_digest
    )
      fail("stage234_i_remove_original_not_verified");
    const enabled = await db.client.providerAccount.findMany({
      where: {
        workspaceId: account.workspaceId,
        provider: "GOOGLE_ADS",
        enabled: true,
      },
      select: { id: true },
    });
    if (enabled.length !== 1 || enabled[0].id !== account.id)
      fail("stage234_i_remove_foreign_account_enabled");
    if (
      (await db.client.mcpPreview.count({
        where: {
          workspaceId: account.workspaceId,
          provider: "GOOGLE_ADS",
          consumedAt: null,
          cancelledAt: null,
          expiresAt: { gt: new Date() },
        },
      })) !== 0
    )
      fail("stage234_i_remove_another_pending_preview");
    const oldPreviewHash = digest(original),
      oldAudit = await db.client.auditEvent.findMany({
        where: { targetId: original.id },
        orderBy: { id: "asc" },
      }),
      oldAuditHash = digest(oldAudit);
    const connection = await db.client.providerConnection.findUnique({
      where: { id: account.connectionId },
      include: { credential: true },
    });
    if (
      connection?.provider !== "GOOGLE_ADS" ||
      connection.workspaceId !== account.workspaceId ||
      !connection.credential
    )
      fail("stage234_i_remove_vault_owner_invalid");
    const vault = new CredentialVaultService(),
      adapter = new GoogleAdsAdapter(config);
    let credentials = vault.decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_i_remove_scope_invalid");
    if (
      credentials.expiresAt &&
      Date.parse(credentials.expiresAt) <= Date.now() + 60000
    )
      credentials = await adapter.refreshCredentials(credentials);
    const read = (q, customer = target.customer) =>
      adapter.searchStream(credentials.accessToken, customer, target.mcc, q);
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(READINESS_SNAPSHOT_QUERIES).map(async ([name, q]) => [
            name,
            (await read(q)).sort((a, b) =>
              canonical(a).localeCompare(canonical(b), "en"),
            ),
          ]),
        ),
      );
    stage = "fresh_test_fixture";
    const customer = await read(queries.customer),
      mcc = await read(queries.customer, target.mcc),
      hierarchy = await read(queries.hierarchy, target.mcc);
    if (
      customer.length !== 1 ||
      String(customer[0]?.customer?.id) !== target.customer ||
      customer[0].customer.testAccount !== true ||
      customer[0].customer.currencyCode !== "USD" ||
      mcc.length !== 1 ||
      String(mcc[0]?.customer?.id) !== target.mcc ||
      mcc[0].customer.testAccount !== true ||
      hierarchy.length !== 1 ||
      String(hierarchy[0]?.customerClient?.id) !== target.customer ||
      hierarchy[0].customerClient.testAccount !== true ||
      Number(hierarchy[0].customerClient.level) !== 1
    )
      fail("stage234_i_remove_test_hierarchy_invalid");
    const before = await snapshot();
    assertCreatedAudience(
      addPreview.provider_state_before,
      before,
      committed.commit,
    );
    if (canonical(before) !== canonical(origin.provider_state_after_commit))
      fail("stage234_i_remove_origin_snapshot_stale");
    const bid = await read(queries.group);
    if (
      bid.length !== 1 ||
      String(bid[0]?.adGroup?.cpcBidMicros) !== "100000" ||
      bid[0].adGroup.status !== "PAUSED"
    )
      fail("stage234_i_remove_bid_changed");
    stage = "prepare_stock_plan";
    const plan = await adapter.extended(
      { accountId: target.customer, loginCustomerId: target.mcc, credentials },
      3,
      "build",
      stage3ToolIntent(tool.name, tool.arguments),
    );
    const validation = assertRemovePlan(plan, origin);
    save("prepared-i-remove-plan.json", plan);
    save("proof.json", {
      customer_id: target.customer,
      mcc_id: target.mcc,
      test_account: true,
      hierarchy: true,
      currency: "USD",
      group_resource: target.groupResource,
      group_cpc_micros: "100000",
      fixture_paused: true,
      fixture_sha256: digest(before),
      source_head: env.STAGE234_SOURCE_HEAD,
      verified_at: new Date().toISOString(),
    });
    stage = "stock_api_ready";
    server = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "--import",
        "/stage234/audience-remove-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...env,
          STAGE234_I_REMOVE_GUARD_PRELOAD: "1",
          LOG_LEVEL: "error",
        },
      },
    );
    startupEvidence = startupDiagnostics(server);
    if (
      !(await waitLocalReady({
        fetch: (...args) => globalThis.fetch(...args),
        server,
      }))
    )
      fail("stage234_i_remove_stock_api_not_ready");
    gateway = spawn(process.execPath, ["/stage234/rsa-approval-gateway.mjs"], {
      cwd: "/workspace",
      stdio: "ignore",
      env: { ...env, LOG_LEVEL: "error" },
    });
    let gatewayReady = false;
    for (let i = 0; i < 12; i++) {
      if (gateway.exitCode !== null)
        fail("stage234_i_remove_gateway_start_failed");
      try {
        if ((await globalThis.fetch("http://127.0.0.1:4001/ready")).ok) {
          gatewayReady = true;
          break;
        }
      } catch {
        /* bounded local readiness only */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!gatewayReady) fail("stage234_i_remove_gateway_not_ready");
    const bootstrap = await globalThis.fetch(
      "http://127.0.0.1:4001/acceptance/session",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:4403",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    if (
      !bootstrap.ok ||
      typeof (await bootstrap.json()).csrfToken !== "string" ||
      bootstrap.headers.getSetCookie().some((c) => /;\s*domain=/i.test(c))
    )
      fail("stage234_i_remove_human_session_not_ready");
    stage = "I_REMOVE_JIT_PREVIEW";
    const response = await globalThis.fetch("http://127.0.0.1:4000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${context.service_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "stage234-I-remove-preview",
        method: "tools/call",
        params: tool,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const rpc = await response.json();
    if (!response.ok || rpc.error || rpc.result?.isError)
      fail("stage234_i_remove_stock_preview_rejected");
    const preview =
      rpc.result?.structuredContent ??
      JSON.parse(rpc.result?.content?.[0]?.text ?? "null");
    if (
      preview?.status !== "preview" ||
      preview.account_id !== target.customer ||
      preview.provider !== "GOOGLE_ADS" ||
      preview.provider_validation !== "passed" ||
      preview.operation_count !== 1 ||
      preview.atomic !== false ||
      preview.partial_failure !== true ||
      preview.irreversible !== true ||
      !preview.items?.[0]?.warnings?.some((w) => w.includes("OBSERVATION")) ||
      Date.parse(preview.expires_at) <= Date.now() + 60000 ||
      !/^http:\/\/localhost:4403\/mcp\/approve#[A-Za-z0-9_-]+$/.test(
        preview.approval_url ?? "",
      )
    )
      fail("stage234_i_remove_preview_invalid");
    const stored = await db.client.mcpPreview.findUnique({
      where: { id: preview.preview_id },
    });
    if (
      !stored ||
      stored.confirmedAt ||
      stored.consumedAt ||
      stored.cancelledAt ||
      stored.accountId !== account.id ||
      stored.serviceTokenId !== key.id ||
      stored.commitStatus !== "PREVIEWED" ||
      canonical(stored.requestedState) !== canonical(plan) ||
      stored.snapshotDigest !== digest(plan)
    )
      fail("stage234_i_remove_persisted_preview_invalid");
    stage = "after_preview_unchanged";
    const after = await snapshot();
    if (
      canonical(before) !== canonical(after) ||
      canonical(bid) !== canonical(await read(queries.group))
    )
      fail("stage234_i_remove_provider_changed");
    if (
      digest(
        await db.client.mcpPreview.findUnique({
          where: { id: original.id },
          include: { account: true },
        }),
      ) !== oldPreviewHash ||
      digest(
        await db.client.auditEvent.findMany({
          where: { targetId: original.id },
          orderBy: { id: "asc" },
        }),
      ) !== oldAuditHash
    )
      fail("stage234_i_remove_history_changed");
    const counts = callCounts(),
      validationResult = protectedJson(join(root, "validation.json"));
    if (
      counts.validate_only_call_count !== 1 ||
      validationResult.http_status !== 200
    )
      fail("stage234_i_remove_validation_invalid");
    save(
      "protected-preview-context.json",
      sealAcceptanceContext(vault, {
        preview,
        service_token: context.service_token,
        key_id: key.id,
        fingerprint: key.tokenDigest,
        expires_at: key.expiresAt.toISOString(),
      }),
    );
    save("evidence.json", {
      acceptance_test: "I_REMOVE_PREVIEW_ONLY",
      result: "PREVIEW_PASS_REMOVE_APPROVAL_PENDING",
      source_head: env.STAGE234_SOURCE_HEAD,
      harness_head: env.STAGE234_HARNESS_HEAD,
      image_digest: env.STAGE234_IMAGE_DIGEST,
      test_customer_id: target.customer,
      campaign_id: target.campaign,
      ad_group_id: target.group,
      criterion_id: origin.created_audience.criterion_id,
      resource_name: origin.created_audience.resource_name,
      origin_preview_id: origin.preview_id,
      origin_commit_id: origin.commit_id,
      origin_sha256: env.STAGE234_I_ORIGIN_SHA256,
      semantic_payload: tool,
      exact_validate_only_payload: validation,
      provider_state_before: before,
      provider_state_after_preview: after,
      before_after_unchanged: true,
      preview_id: preview.preview_id,
      preview_expires_at: preview.expires_at,
      provider_validation: "passed",
      operation_count: 1,
      partial_failure: true,
      atomic: false,
      irreversible: true,
      residual_audience_mode: "OBSERVATION",
      original_absent_mode_restored: false,
      manual_approval_required: true,
      approval_performed_by_harness: false,
      committed: false,
      ...counts,
      historical_evidence_unchanged: true,
      production_changed: false,
      main_changed: false,
      startup: startupEvidence(),
      timestamp: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        result: "PREVIEW_PASS_REMOVE_APPROVAL_PENDING",
        preview_id: preview.preview_id,
        expires_at: preview.expires_at,
        approval_url: preview.approval_url,
        criterion_id: origin.created_audience.criterion_id,
        provider_reads: counts.provider_read_call_count,
        validate_only: 1,
        real_writes: 0,
      }),
    );
    await closeDatabase(db);
    db = undefined;
  } catch (error) {
    const blocked = {
      result: "BLOCKED",
      code: safeError(error),
      failure_stage: stage,
      ...callCounts(),
      startup: startupEvidence?.() ?? null,
      timestamp: new Date().toISOString(),
    };
    try {
      save("blocked-evidence.json", blocked);
    } catch {
      /* Never replace evidence. */
    }
    console.log(JSON.stringify(blocked));
    process.exitCode = 1;
    server?.kill("SIGTERM");
    gateway?.kill("SIGTERM");
  } finally {
    if (db) await closeDatabase(db);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runIRemovePreview();

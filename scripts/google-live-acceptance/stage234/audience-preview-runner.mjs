// I-only stock private MCP preview. Does not approve or commit.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { startupDiagnostics } from "./startup-diagnostics.mjs";
import {
  readAcceptanceContext,
  sealAcceptanceContext,
} from "./context-vault.mjs";
import {
  READINESS_SNAPSHOT_QUERIES,
  readinessSnapshotDigest,
} from "./targeting-readiness-runner.mjs";
import { queries as preflightQueries } from "./live-guard.mjs";
import {
  target,
  canonical,
  digest,
  safeError,
  assertReadiness,
  assertPreparedI,
  protectedJson,
  installIGuard,
} from "./audience-preview-guard.mjs";
const { URL, AbortSignal, setTimeout, console } = globalThis;
const fetch = (...args) => globalThis.fetch(...args);
const fail = (code) => {
  throw new Error(code);
};
export async function runIPreview() {
  await installIGuard();
  const env = process.env,
    root = env.STAGE234_RUN_DIR;
  const save = (name, value) =>
    writeFileSync(join(root, name), JSON.stringify(value, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  let db,
    server,
    gateway,
    stage = "runtime_preflight",
    evidence,
    preview,
    startupEvidence;
  try {
    if ((statSync(root).mode & 0o077) !== 0)
      fail("stage234_state_directory_permissions_invalid");
    const readinessFile = join(root, "readiness-evidence.json");
    protectedJson(readinessFile);
    const readinessRaw = readFileSync(readinessFile, "utf8");
    const { artifact: readiness, tool } = assertReadiness(readinessRaw, env);
    const contextFile = join(root, "fixture-context.json");
    if ((statSync(contextFile).mode & 0o077) !== 0)
      fail("stage234_protected_context_permissions_invalid");
    createRequire("/workspace/apps/api/package.json")("reflect-metadata");
    const context = await readAcceptanceContext(contextFile);
    const { loadConfig } =
      await import("/workspace/packages/config/dist/index.js");
    const { createDatabase, closeDatabase } =
      await import("/workspace/packages/database/dist/index.js");
    const { CredentialVaultService } =
      await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
    const { GoogleAdsAdapter } =
      await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
    const { stage3ToolIntent } =
      await import("/workspace/apps/api/dist/mcp/mcp-google-stage3-schema.js");
    const config = loadConfig(),
      dbUrl = new URL(config.databaseUrl),
      redisUrl = new URL(config.redisUrl);
    if (
      dbUrl.hostname !== "postgres" ||
      dbUrl.pathname !== "/google_acceptance" ||
      redisUrl.hostname !== "redis" ||
      config.providerGoogleApiVersion !== "v24" ||
      config.providerGoogleLoginCustomerId !== target.mcc ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]'
    )
      fail("stage234_acceptance_database_or_config_invalid");
    db = createDatabase(config.databaseUrl);
    const baseline = await db.client.mcpPreview.findUnique({
      where: { id: context.preview?.preview_id },
      include: { account: true },
    });
    const account = baseline?.account;
    const key = await db.client.serviceToken.findUnique({
      where: { tokenDigest: digest(context.service_token ?? "") },
      include: { serviceIdentity: true },
    });
    if (
      !account ||
      account.provider !== "GOOGLE_ADS" ||
      account.externalAccountId !== target.customer ||
      !account.enabled ||
      !key ||
      context.key_id !== key.id ||
      key.revokedAt ||
      key.serviceIdentity?.revokedAt ||
      !Number.isFinite(Date.parse(key.expiresAt)) ||
      Date.parse(key.expiresAt) !== Date.parse(context.expires_at) ||
      Date.parse(key.expiresAt) <= Date.now() ||
      Date.parse(key.expiresAt) > Date.now() + 24 * 60 * 60 * 1000 ||
      key.serviceIdentity.workspaceId !== account.workspaceId ||
      key.resourceAccessMode !== "STATIC_ALLOWLIST" ||
      canonical(key.accountIds) !== canonical([account.id]) ||
      !Array.isArray(key.scopes) ||
      canonical([...key.scopes].sort()) !==
        canonical(["adforge:mcp:read", "adforge:mcp:write"])
    )
      fail("stage234_owned_account_or_scoped_key_invalid");
    const enabled = await db.client.providerAccount.findMany({
      where: {
        workspaceId: account.workspaceId,
        provider: "GOOGLE_ADS",
        enabled: true,
      },
      select: { externalAccountId: true },
    });
    if (
      enabled.length !== 1 ||
      enabled[0].externalAccountId !== target.customer
    )
      fail("stage234_foreign_enabled_account_invalid");
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
      fail("stage234_another_pending_preview_exists");
    const historicalHash = digest({ ...baseline, account: undefined }),
      historicalAudit = await db.client.auditEvent.findMany({
        where: { targetId: baseline.id },
        orderBy: { id: "asc" },
      }),
      auditHash = digest(historicalAudit);
    const connection = await db.client.providerConnection.findUnique({
      where: { id: account.connectionId },
      include: { credential: true },
    });
    if (
      !connection?.credential ||
      connection.provider !== "GOOGLE_ADS" ||
      connection.workspaceId !== account.workspaceId
    )
      fail("stage234_disposable_credential_missing");
    const vault = new CredentialVaultService(),
      adapter = new GoogleAdsAdapter(config);
    let credentials = vault.decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_adwords_scope_missing");
    if (
      credentials.expiresAt &&
      Date.parse(credentials.expiresAt) <= Date.now() + 60000
    )
      credentials = await adapter.refreshCredentials(credentials);
    const read = (query, customer = target.customer) =>
      adapter.searchStream(
        credentials.accessToken,
        customer,
        target.mcc,
        query,
      );
    stage = "fresh_customer_hierarchy_proof";
    const customer = await read(preflightQueries.customer),
      mcc = await read(preflightQueries.customer, target.mcc),
      hierarchy = await read(preflightQueries.hierarchy, target.mcc);
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
      Number(hierarchy[0].customerClient.level) !== 1 ||
      hierarchy[0].customerClient.testAccount !== true
    )
      fail("stage234_customer_or_hierarchy_unproven");
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(READINESS_SNAPSHOT_QUERIES).map(
            async ([name, query]) => [
              name,
              (await read(query)).sort((a, b) =>
                canonical(a).localeCompare(canonical(b), "en"),
              ),
            ],
          ),
        ),
      );
    stage = "fixture_before";
    const before = await snapshot();
    if (readinessSnapshotDigest(before) !== readiness.full_snapshot_digest)
      fail("stage234_i_fresh_fixture_stale");
    const bidBefore = await read(preflightQueries.group);
    if (
      bidBefore.length !== 1 ||
      bidBefore[0].adGroup?.status !== "PAUSED" ||
      String(bidBefore[0].adGroup?.cpcBidMicros) !== "100000"
    )
      fail("stage234_i_fixture_bid_unproven");
    // READ-only production build prepares the EXACT expected validation payload
    // before any preview TTL. The actual preview is still created by stock MCP.
    const expectedPlan = await adapter.extended(
      { accountId: target.customer, loginCustomerId: target.mcc, credentials },
      3,
      "build",
      stage3ToolIntent(tool.name, tool.arguments),
    );
    const validationPayload = assertPreparedI(expectedPlan, tool);
    save("prepared-i-plan.json", expectedPlan);
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
    stage = "stock_private_http_mcp";
    server = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "--import",
        "/stage234/audience-preview-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...env,
          STAGE234_GUARD_PRELOAD: "0",
          STAGE234_L_GUARD_PRELOAD: "0",
          STAGE234_I_GUARD_PRELOAD: "1",
          LOG_LEVEL: "error",
        },
      },
    );
    startupEvidence = startupDiagnostics(server);
    let ready = false;
    for (let attempt = 0; attempt < 35; attempt++) {
      if (server.exitCode !== null)
        fail("stage234_exact_source_api_start_failed");
      try {
        if (
          (
            await fetch("http://127.0.0.1:4000/ready", {
              signal: AbortSignal.timeout(1000),
            })
          ).status === 200
        ) {
          ready = true;
          break;
        }
      } catch {
        /* Bounded health wait; never retry provider preview/mutation. */
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) fail("stage234_exact_source_api_not_ready");
    let approvalReady = false;
    if (env.STAGE234_APPROVAL_GATEWAY === "true") {
      gateway = spawn(
        process.execPath,
        ["/stage234/rsa-approval-gateway.mjs"],
        {
          cwd: "/workspace",
          stdio: "ignore",
          env: { ...env, LOG_LEVEL: "error" },
        },
      );
      for (let attempt = 0; attempt < 10; attempt++) {
        if (gateway.exitCode !== null)
          fail("stage234_stock_approval_gateway_start_failed");
        try {
          if (
            (
              await fetch("http://127.0.0.1:4001/ready", {
                signal: AbortSignal.timeout(1000),
              })
            ).status === 200
          ) {
            approvalReady = true;
            break;
          }
        } catch {
          /* Local gateway health wait only. */
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!approvalReady) fail("stage234_stock_approval_gateway_not_ready");
      // Only local TEST identity bootstrap, never an approval POST. Verify the
      // human UI can obtain its own session before starting the preview TTL.
      const sessionCheck = await fetch(
        "http://127.0.0.1:4001/acceptance/session",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:4403",
            "content-type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (
        !sessionCheck.ok ||
        typeof (await sessionCheck.json()).csrfToken !== "string"
      )
        fail("stage234_human_session_bootstrap_not_ready");
      if (
        sessionCheck.headers
          .getSetCookie()
          .some((cookie) => /;\s*domain=/i.test(cookie))
      )
        fail("stage234_local_human_session_cookie_domain_invalid");
    }
    stage = "I_JIT_preview";
    // JIT: all fixture/image/API/gateway prechecks are complete before preview.
    const response = await fetch("http://127.0.0.1:4000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${context.service_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "stage234-I-preview",
        method: "tools/call",
        params: tool,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const rpc = await response.json();
    if (!response.ok || rpc.error || rpc.result?.isError)
      fail("stage234_stock_preview_rejected");
    preview =
      rpc.result?.structuredContent ??
      JSON.parse(rpc.result?.content?.[0]?.text ?? "null");
    if (
      preview?.status !== "preview" ||
      preview.account_id !== target.customer ||
      preview.provider !== "GOOGLE_ADS" ||
      preview.provider_validation !== "passed" ||
      preview.operation_count !== expectedPlan.operations.length ||
      preview.items?.[0]?.after?.audience_mode !== "OBSERVATION" ||
      preview.partial_failure !== !expectedPlan.atomic ||
      preview.atomic !== expectedPlan.atomic ||
      !preview.items[0].warnings.some((w) => w.includes("OBSERVATION")) ||
      Date.parse(preview.expires_at) <= Date.now() + 60000 ||
      !/^http:\/\/localhost:4403\/mcp\/approve#[A-Za-z0-9_-]+$/.test(
        preview.approval_url ?? "",
      )
    )
      fail("stage234_i_preview_invalid");
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
      stored.provider !== "GOOGLE_ADS" ||
      stored.commitStatus !== "PREVIEWED" ||
      canonical(stored.requestedState) !== canonical(expectedPlan) ||
      stored.snapshotDigest !== digest(expectedPlan)
    )
      fail("stage234_i_persisted_preview_invalid");
    const previewAudit = await db.client.auditEvent.findMany({
      where: { targetId: stored.id },
      select: { eventType: true, createdAt: true },
    });
    if (
      !previewAudit.some(
        (e) => e.eventType === "mcp_google_stage1_preview_created",
      )
    )
      fail("stage234_preview_audit_missing");
    stage = "provider_reread_unchanged";
    const after = await snapshot();
    const bidAfter = await read(preflightQueries.group);
    if (
      canonical(bidBefore) !== canonical(bidAfter) ||
      readinessSnapshotDigest(after) !== readiness.full_snapshot_digest
    )
      fail("stage234_i_provider_state_changed");
    if (canonical(before) !== canonical(after))
      fail("stage234_provider_changed_after_preview");
    if (
      digest(
        await db.client.mcpPreview.findUnique({ where: { id: baseline.id } }),
      ) !== historicalHash ||
      digest(
        await db.client.auditEvent.findMany({
          where: { targetId: baseline.id },
          orderBy: { id: "asc" },
        }),
      ) !== auditHash
    )
      fail("stage234_historical_evidence_changed");
    const events = readFileSync(join(root, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    if (
      events.filter((e) => e.type === "validate_only").length !== 1 ||
      events.some(
        (e) =>
          !["read", "read_mcc", "validate_only", "oauth_refresh"].includes(
            e.type,
          ),
      )
    )
      fail("stage234_provider_call_accounting_invalid");
    const validation = JSON.parse(
      readFileSync(join(root, "validation.json"), "utf8"),
    );
    if (validation.http_status < 200 || validation.http_status >= 300)
      fail("stage234_validate_only_http_failed");
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
    evidence = {
      acceptance_test: "I_PREVIEW_ONLY",
      result: "PREVIEW_PASS_I_LIVE_COMMIT_PENDING",
      source_head: env.STAGE234_SOURCE_HEAD,
      harness_head: env.STAGE234_HARNESS_HEAD,
      image_digest: env.STAGE234_IMAGE_DIGEST,
      test_customer_id: target.customer,
      campaign_id: target.campaign,
      ad_group_id: target.group,
      semantic_payload: tool,
      exact_validate_only_payload: validationPayload,
      provider_state_before: before,
      provider_state_after_preview: after,
      before_after_unchanged: canonical(before) === canonical(after),
      preview_id: preview.preview_id,
      preview_expires_at: preview.expires_at,
      provider_validation: preview.provider_validation,
      operation_count: preview.operation_count,
      provider_read_call_count: events.filter((e) =>
        ["read", "read_mcc"].includes(e.type),
      ).length,
      validate_only_call_count: 1,
      real_provider_write_call_count: 0,
      audience_mode: "OBSERVATION",
      audience_mode_before:
        before.group?.[0]?.adGroup?.targetingSetting ?? null,
      approval_performed_by_harness: false,
      committed: false,
      readiness_sha256: env.STAGE234_I_READINESS_SHA256,
      readiness_harness_head: env.STAGE234_I_READINESS_HARNESS_HEAD,
      full_fixture_sha256: readiness.full_snapshot_digest,
      production_changed: false,
      main_changed: false,
      timestamp: new Date().toISOString(),
      audit: previewAudit.map((e) => ({
        type: e.eventType,
        timestamp: e.createdAt,
      })),
      persisted_preview_immutable: true,
      historical_evidence_unchanged: true,
      approval_url_ready: approvalReady,
      startup: startupEvidence(),
    };
    save("evidence.json", evidence);
    console.log(
      JSON.stringify({
        result: evidence.result,
        preview_id: preview.preview_id,
        expires_at: preview.expires_at,
        approval_url: preview.approval_url,
        provider_reads: evidence.provider_read_call_count,
        validate_only: 1,
        real_writes: 0,
        evidence: "stage234/" + root.split("/").at(-1) + "/evidence.json",
      }),
    );
    await closeDatabase(db);
    db = undefined;
    if (env.STAGE234_KEEP_API_ALIVE !== "true") {
      server.kill("SIGTERM");
      gateway?.kill("SIGTERM");
    }
  } catch (error) {
    let calls = [];
    try {
      calls = readFileSync(join(root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {
      /* Call log may not exist before a blocked preflight. */
    }
    const result = {
      result: "BLOCKED",
      failure_stage: stage,
      startup: startupEvidence?.() ?? null,
      code: safeError(error),
      provider_read_call_count: calls.filter((e) =>
        ["read", "read_mcc"].includes(e.type),
      ).length,
      validate_only_call_count: calls.filter((e) => e.type === "validate_only")
        .length,
      real_provider_write_call_count: 0,
      production_changed: false,
      main_changed: false,
      timestamp: new Date().toISOString(),
    };
    try {
      save("blocked-evidence.json", result);
    } catch {
      /* Never overwrite previous evidence. */
    }
    console.log(JSON.stringify(result));
    process.exitCode = 1;
    server?.kill("SIGTERM");
    gateway?.kill("SIGTERM");
  } finally {
    if (db) {
      try {
        await db.client.$disconnect();
      } catch {
        /* Do not obscure the original safe failure. */
      }
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runIPreview();

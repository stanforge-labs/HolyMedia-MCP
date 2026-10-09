// Explicitly authorized N continuation only. Importing this file never starts it.
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL, URL } from "node:url";
import {
  readAcceptanceContext,
  sealAcceptanceContext,
} from "./context-vault.mjs";
import process from "node:process";
const { structuredClone, AbortSignal, console } = globalThis;
// Resolve after guard installation; never capture the unguarded native fetch.
const fetch = (...args) => globalThis.fetch(...args);
import { queries, sanitized, safeError } from "./live-guard.mjs";
import { assertFixture, assertPausedDeliveryFixtures } from "./live-runner.mjs";
import { waitLocalReady } from "./wait-local-ready.mjs";
import { startupDiagnostics } from "./startup-diagnostics.mjs";
import {
  target,
  canonical,
  digest,
  fail,
  assertCommitRuntime,
  protectedJson,
  assertStoredN,
  assertRestoreOrigin,
  installCommitGuard,
} from "./restore-guard.mjs";

export function assertNFixture(snapshot, amount) {
  if (
    !["100000", "110000"].includes(amount) ||
    String(snapshot.group?.[0]?.adGroup?.cpcBidMicros) !== amount
  )
    fail("stage234_commit_provider_bid_unexpected");
  const normalized = structuredClone(snapshot);
  normalized.group[0].adGroup.cpcBidMicros = "100000";
  assertFixture(normalized);
  assertPausedDeliveryFixtures(snapshot);
}
export async function runNRestore() {
  const env = process.env,
    root = env.STAGE234_RUN_DIR;
  assertCommitRuntime(env);
  installCommitGuard();
  const save = (name, value) =>
    writeFileSync(join(root, name), JSON.stringify(value, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
  let db,
    server,
    stage = "approval_db_preflight",
    closeDatabase,
    startupEvidence;
  const report = {
    acceptance_test: "N_COMMIT_ROLLBACK_PREVIEW",
    source_head: env.STAGE234_SOURCE_HEAD,
    harness_head: env.STAGE234_HARNESS_HEAD,
    image_digest: env.STAGE234_IMAGE_DIGEST,
    test_customer_id: target.customer,
    campaign_id: target.campaign,
    ad_group_id: target.group,
    production_changed: false,
    main_changed: false,
    approval_performed_by_harness: false,
    result: "BLOCKED",
  };
  const calls = () => {
    try {
      return readFileSync(join(root, "nr-calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {
      return [];
    }
  };
  try {
    const stat = lstatSync(root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.mode & 0o077)
      fail("stage234_commit_directory_permissions_invalid");
    createRequire("/workspace/apps/api/package.json")("reflect-metadata");
    const context = await readAcceptanceContext(
      join(root, "protected-preview-context.json"),
    );
    const { loadConfig } =
      await import("/workspace/packages/config/dist/index.js");
    const database = await import("/workspace/packages/database/dist/index.js");
    closeDatabase = database.closeDatabase;
    const { CredentialVaultService } =
      await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
    const { GoogleAdsAdapter } =
      await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
    const config = loadConfig();
    if (
      new URL(config.databaseUrl).hostname !== "postgres" ||
      new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
      new URL(config.redisUrl).hostname !== "redis" ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]' ||
      !config.confirmedWriteEnabled ||
      config.previewOnly
    )
      fail("stage234_commit_disposable_config_invalid");
    db = database.createDatabase(config.databaseUrl);
    const approveProof = async () => {
      const stored = await db.client.mcpPreview.findUnique({
        where: { id: context.preview.preview_id },
        include: { account: true },
      });
      const account = stored?.account;
      const key = await db.client.serviceToken.findUnique({
        where: { tokenDigest: digest(context.service_token ?? "") },
        include: { serviceIdentity: true },
      });
      const session = stored?.approvalSessionId
        ? await db.client.session.findUnique({
            where: { id: stored.approvalSessionId },
            include: { user: true },
          })
        : null;
      const approval = stored
        ? await db.client.auditEvent.findFirst({
            where: {
              targetId: stored.id,
              workspaceId: stored.workspaceId,
              eventType: "mcp_preview_web_approved",
              actorType: "HUMAN",
              actorUserId: stored.approvedByUserId,
              success: true,
            },
            orderBy: { createdAt: "desc" },
          })
        : null;
      const authority = assertStoredN({
        context,
        stored,
        account,
        key,
        session,
        approval,
      });
      const originalEvent = await db.client.auditEvent.findFirst({
        where: {
          workspaceId: account.workspaceId,
          eventType: "mcp_google_commit_result",
          metadata: { path: ["commitId"], equals: context.original_commit_id },
        },
      });
      const original = originalEvent?.targetId
        ? await db.client.mcpPreview.findUnique({
            where: { id: originalEvent.targetId },
          })
        : null;
      assertRestoreOrigin(
        { context, stored, original, event: originalEvent },
        env.STAGE234_EXPECTED_ORIGINAL_COMMIT,
      );
      const enabled = await db.client.providerAccount.findMany({
        where: {
          workspaceId: account.workspaceId,
          provider: "GOOGLE_ADS",
          enabled: true,
        },
        select: { id: true, externalAccountId: true },
      });
      if (
        enabled.length !== 1 ||
        enabled[0].id !== account.id ||
        enabled[0].externalAccountId !== target.customer
      )
        fail("stage234_commit_foreign_account_enabled");
      const membership = await db.client.workspaceMembership.findFirst({
        where: {
          workspaceId: account.workspaceId,
          userId: stored.approvedByUserId,
        },
      });
      if (
        !membership ||
        !["OWNER", "ADMIN", "MEMBER"].includes(membership.role)
      )
        fail("stage234_commit_membership_invalid");
      return { stored, account, key, authority, approval };
    };
    let bound = await approveProof();
    const connection = await db.client.providerConnection.findUnique({
      where: { id: bound.account.connectionId },
      include: { credential: true },
    });
    if (
      !connection?.credential ||
      connection.workspaceId !== bound.account.workspaceId ||
      connection.provider !== "GOOGLE_ADS"
    )
      fail("stage234_commit_vault_missing");
    const adapter = new GoogleAdsAdapter(config),
      vault = new CredentialVaultService();
    let credentials = vault.decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_commit_adwords_scope_missing");
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
          [
            "campaign",
            "group",
            "keywords",
            "rsa",
            "budget",
            "criteria",
            "fixtureCampaigns",
            "fixtureGroups",
            "fixtureAds",
          ].map(async (name) => [
            name,
            (await read(queries[name])).sort((a, b) =>
              canonical(a).localeCompare(canonical(b)),
            ),
          ]),
        ),
      );
    const freshProof = async (snapshot, amount) => {
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
        fail("stage234_commit_test_hierarchy_unproven");
      return {
        customer_id: target.customer,
        mcc_id: target.mcc,
        test_account: true,
        hierarchy: true,
        currency: "USD",
        group_resource: target.groupResource,
        group_cpc_micros: amount,
        fixture_paused: true,
        fixture_sha256: digest(snapshot),
        source_head: env.STAGE234_SOURCE_HEAD,
        verified_at: new Date().toISOString(),
      };
    };
    stage = "fresh_test_fixture_preflight";
    const before = await snapshot();
    assertNFixture(before, "110000");
    const originalEvidence = protectedJson(join(root, "evidence.json"));
    if (
      originalEvidence.rollback_preview?.preview_id !==
        context.preview.preview_id ||
      originalEvidence.rollback_preview?.provider_validation !== "passed" ||
      canonical(before) !==
        canonical(originalEvidence.provider_state_after_rollback_preview)
    )
      fail("stage234_commit_provider_snapshot_stale");
    save("nr-proof.json", await freshProof(before, "110000"));
    server = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "--import",
        "/stage234/restore-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...env, STAGE234_COMMIT_GUARD_PRELOAD: "1", LOG_LEVEL: "error" },
      },
    );
    startupEvidence = startupDiagnostics(server);
    const ready = await waitLocalReady({ fetch, server });
    report.startup = startupEvidence();
    if (!ready) fail("stage234_commit_stock_api_not_ready");
    // Fresh DB approval immediately precedes the one immutable HTTP commit.
    bound = await approveProof();
    save("nr-authority.json", bound.authority);
    report.original_commit_id = context.original_commit_id;
    report.approval = {
      confirmed_at: new Date(bound.stored.confirmedAt).toISOString(),
      session_valid: true,
      audit_valid: true,
      preview_id: bound.stored.id,
      expires_at: bound.authority.expires_at,
      immutable_digest: bound.authority.snapshot_digest,
    };
    const mcp = async (name, args, id) => {
      const response = await fetch("http://127.0.0.1:4000/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${context.service_token}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name, arguments: args },
        }),
        signal: AbortSignal.timeout(60000),
      });
      const rpc = await response.json();
      if (!response.ok || rpc.error || rpc.result?.isError)
        fail("stage234_commit_stock_mcp_rejected_no_retry");
      return (
        rpc.result?.structuredContent ??
        JSON.parse(rpc.result?.content?.[0]?.text ?? "null")
      );
    };
    stage = "immutable_commit_once";
    const result = await mcp(
      "commit_preview",
      { preview_token: context.preview.preview_token },
      "stage234-N-restore-commit",
    );
    report.commit = sanitized(result);
    if (
      result.status !== "VERIFIED" ||
      result.account_id !== target.customer ||
      result.operation_count !== 1 ||
      result.partial_failure !== true ||
      !/^hmc_[A-Za-z0-9_-]{43}$/.test(result.commit_id ?? "")
    )
      fail("stage234_commit_result_not_verified_no_retry");
    stage = "provider_reread_journal";
    const after = await snapshot();
    assertNFixture(after, "100000");
    const expectedAfter = structuredClone(before);
    expectedAfter.group[0].adGroup.cpcBidMicros = "100000";
    if (canonical(after) !== canonical(expectedAfter))
      fail("stage234_commit_unexpected_provider_side_effect");
    const committed = await db.client.mcpPreview.findUnique({
      where: { id: bound.stored.id },
    });
    const events = await db.client.auditEvent.findMany({
      where: {
        targetId: bound.stored.id,
        workspaceId: bound.account.workspaceId,
      },
      orderBy: { createdAt: "asc" },
    });
    if (
      !committed?.consumedAt ||
      committed.commitStatus !== "VERIFIED" ||
      committed.snapshotDigest !== bound.stored.snapshotDigest ||
      canonical(committed.requestedState) !==
        canonical(bound.stored.requestedState) ||
      !events.some(
        (e) =>
          e.eventType === "mcp_google_commit_result" &&
          e.success === true &&
          e.metadata?.commitId === result.commit_id,
      ) ||
      !events.some(
        (e) =>
          e.eventType === "mcp_google_stage1_operation" && e.success === true,
      )
    )
      fail("stage234_commit_journal_missing_or_immutable_changed");
    report.provider_state_before = before;
    report.provider_state_after_commit = after;
    report.audit = events.map((e) => ({
      type: e.eventType,
      success: e.success,
      timestamp: e.createdAt,
    }));
    save("nr-commit-evidence.json", {
      ...report,
      result: "N_RESTORE_VERIFIED",
      timestamp: new Date().toISOString(),
    });
    const counts = calls();
    if (
      counts.filter((e) => e.type === "write").length !== 1 ||
      counts.some((e) => e.type === "validate_only")
    )
      fail("stage234_restore_call_accounting_invalid");
    save("nr-restored-evidence.json", {
      ...report,
      result: "N_RESTORE_VERIFIED",
      provider_read_call_count: counts.filter((e) =>
        ["read", "read_mcc"].includes(e.type),
      ).length,
      validate_only_call_count: 0,
      real_provider_write_call_count: 1,
      timestamp: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        result: "N_RESTORE_VERIFIED",
        commit_id: result.commit_id,
        preview_id: bound.stored.id,
        provider_reads: counts.filter((e) =>
          ["read", "read_mcc"].includes(e.type),
        ).length,
        validate_only: 0,
        real_writes: 1,
      }),
    );
  } catch (error) {
    const counts = calls(),
      blocked = {
        ...report,
        failure_stage: stage,
        code: safeError(error),
        startup: startupEvidence?.() ?? null,
        provider_read_call_count: counts.filter((e) =>
          ["read", "read_mcc"].includes(e.type),
        ).length,
        validate_only_call_count: counts.filter(
          (e) => e.type === "validate_only",
        ).length,
        real_provider_write_call_count: counts.filter((e) => e.type === "write")
          .length,
        timestamp: new Date().toISOString(),
      };
    try {
      save("nr-blocked-evidence.json", blocked);
    } catch {
      // Existing evidence is immutable; do not overwrite an earlier failure.
    }
    console.log(
      JSON.stringify({
        result: "BLOCKED",
        code: blocked.code,
        failure_stage: stage,
        real_writes: blocked.real_provider_write_call_count,
      }),
    );
    process.exitCode = 1;
  } finally {
    server?.kill("SIGTERM");
    if (db && closeDatabase) await closeDatabase(db);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runNRestore();

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { readAcceptanceContext } from "./context-vault.mjs";
import {
  target,
  canonical,
  digest,
  fail,
  protectedJson,
  READINESS_SNAPSHOT_QUERIES,
} from "./audience-commit-guard.mjs";
import {
  installRestoreJCommitGuard,
  assertRestoreJApproval,
  removedGeoQueries,
} from "./geo-restore-commit-guard.mjs";
import { assertRestoredJ } from "./geo-restore-verification.mjs";
import { assertJJournal } from "./geo-commit-runner.mjs";
import { assertRestoreJPlan } from "./geo-restore-guard.mjs";
import { queries, sanitized, safeError } from "./live-guard.mjs";
import { waitLocalReady } from "./wait-local-ready.mjs";
import { startupDiagnostics } from "./startup-diagnostics.mjs";
export async function runJRestoreCommit() {
  installRestoreJCommitGuard();
  const env = process.env,
    root = env.STAGE234_RUN_DIR;
  const save = (n, v) =>
    writeFileSync(join(root, n), JSON.stringify(v, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  const counts = () => {
    let a = [];
    try {
      a = readFileSync(join(root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {}
    return {
      provider_read_call_count: a.filter((c) =>
        ["read", "read_mcc"].includes(c.type),
      ).length,
      validate_only_call_count: 0,
      real_provider_write_call_count: a.filter((c) => c.type === "write")
        .length,
      oauth_refresh_call_count: a.filter((c) => c.type === "oauth_refresh")
        .length,
    };
  };
  let db,
    closeDatabase,
    server,
    startup,
    stage = "approval_db",
    commit = null;
  try {
    createRequire("/workspace/apps/api/package.json")("reflect-metadata");
    const { loadConfig } =
        await import("/workspace/packages/config/dist/index.js"),
      database = await import("/workspace/packages/database/dist/index.js");
    closeDatabase = database.closeDatabase;
    const { CredentialVaultService } =
        await import("/workspace/apps/api/dist/providers/credential-vault.service.js"),
      { GoogleAdsAdapter } =
        await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
    const context = await readAcceptanceContext(
        join(root, "protected-preview-context.json"),
      ),
      evidence = protectedJson(join(root, "evidence.json")),
      plan = protectedJson(join(root, "prepared-j-restore-plan.json")),
      origin = protectedJson(join(root, "j-origin.json")),
      config = loadConfig();
    assertRestoreJPlan(plan, origin);
    if (
      new URL(config.databaseUrl).hostname !== "postgres" ||
      new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
      new URL(config.redisUrl).hostname !== "redis" ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]' ||
      !config.confirmedWriteEnabled ||
      config.previewOnly
    )
      fail("stage234_j_restore_commit_disposable_config_invalid");
    db = database.createDatabase(config.databaseUrl);
    const startStock = async () => {
      stage = "stock_api_ready";
      server = spawn(
        process.execPath,
        [
          "--max-old-space-size=192",
          "--import",
          "/stage234/geo-restore-commit-guard.mjs",
          "/workspace/apps/api/dist/main.js",
        ],
        {
          cwd: "/workspace",
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...env,
            STAGE234_J_RESTORE_COMMIT_GUARD_PRELOAD: "1",
            LOG_LEVEL: "error",
          },
        },
      );
      startup = startupDiagnostics(server);
      if (
        !(await waitLocalReady({
          fetch: (...a) => globalThis.fetch(...a),
          server,
        }))
      )
        fail("stage234_j_restore_commit_api_not_ready");
    };
    if (env.STAGE234_J_RESTORE_STARTUP_ONLY === "true") {
      await startStock();
      const ready = {
        result:
          "J restore exact commit API startup PASS; no commit or provider calls",
        startup: startup(),
        ...counts(),
        timestamp: new Date().toISOString(),
      };
      save("startup-readiness.json", ready);
      console.log(JSON.stringify(ready));
      return;
    }
    const approve = async () => {
      const stored = await db.client.mcpPreview.findUnique({
          where: { id: env.STAGE234_EXPECTED_I_PREVIEW },
          include: { account: true },
        }),
        account = stored?.account;
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
      const authority = assertRestoreJApproval(
        { context, stored, account, key, session, approval },
        env.STAGE234_EXPECTED_I_PREVIEW,
        origin,
      );
      const only = await db.client.providerAccount.findMany({
          where: {
            workspaceId: account.workspaceId,
            provider: "GOOGLE_ADS",
            enabled: true,
          },
          select: { id: true },
        }),
        membership = await db.client.workspaceMembership.findFirst({
          where: {
            workspaceId: account.workspaceId,
            userId: stored.approvedByUserId,
          },
        });
      if (
        only.length !== 1 ||
        only[0].id !== account.id ||
        !membership ||
        !["OWNER", "ADMIN", "MEMBER"].includes(membership.role) ||
        canonical(stored.requestedState) !== canonical(plan)
      )
        fail("stage234_j_restore_commit_scope_or_payload_invalid");
      return { stored, account, authority };
    };
    let bound = await approve();
    if (
      evidence.preview_id !== bound.stored.id ||
      evidence.harness_head !== env.STAGE234_PREVIEW_HARNESS_HEAD ||
      evidence.before_after_unchanged !== true ||
      evidence.provider_validation !== "passed" ||
      evidence.real_provider_write_call_count !== 0 ||
      evidence.result !== "PREVIEW_PASS_J_RESTORE_APPROVAL_PENDING"
    )
      fail("stage234_j_restore_commit_preview_origin_invalid");
    const connection = await db.client.providerConnection.findUnique({
      where: { id: bound.account.connectionId },
      include: { credential: true },
    });
    if (
      connection?.provider !== "GOOGLE_ADS" ||
      connection.workspaceId !== bound.account.workspaceId ||
      !connection.credential
    )
      fail("stage234_j_restore_commit_credential_owner_invalid");
    const adapter = new GoogleAdsAdapter(config);
    let credentials = new CredentialVaultService().decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_j_restore_commit_oauth_scope_invalid");
    if (
      credentials.expiresAt &&
      Date.parse(credentials.expiresAt) <= Date.now() + 60000
    )
      credentials = await adapter.refreshCredentials(credentials);
    const read = (q, c = target.customer) =>
      adapter.searchStream(credentials.accessToken, c, target.mcc, q);
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          Object.entries(READINESS_SNAPSHOT_QUERIES).map(async ([n, q]) => [
            n,
            (await read(q)).sort((a, b) =>
              canonical(a).localeCompare(canonical(b), "en"),
            ),
          ]),
        ),
      );
    stage = "fresh_fixture_and_stock_stale_checks";
    const customer = await read(queries.customer),
      mcc = await read(queries.customer, target.mcc),
      hierarchy = await read(queries.hierarchy, target.mcc);
    if (
      customer.length !== 1 ||
      String(customer[0].customer?.id) !== target.customer ||
      customer[0].customer.testAccount !== true ||
      customer[0].customer.currencyCode !== "USD" ||
      mcc.length !== 1 ||
      String(mcc[0].customer?.id) !== target.mcc ||
      mcc[0].customer.testAccount !== true ||
      hierarchy.length !== 1 ||
      String(hierarchy[0].customerClient?.id) !== target.customer ||
      hierarchy[0].customerClient.testAccount !== true ||
      Number(hierarchy[0].customerClient.level) !== 1
    )
      fail("stage234_j_restore_commit_test_hierarchy_invalid");
    const before = await snapshot(),
      bidBefore = await read(queries.group);
    if (
      canonical(before) !== canonical(evidence.provider_state_before) ||
      canonical(before) !== canonical(evidence.provider_state_after_preview) ||
      bidBefore.length !== 1 ||
      String(bidBefore[0].adGroup?.cpcBidMicros) !== "100000" ||
      bidBefore[0].adGroup.status !== "PAUSED"
    )
      fail("stage234_j_restore_commit_fixture_stale");
    for (const c of plan.checks)
      if (canonical(await read(c.query)) !== canonical(c.rows))
        fail("stage234_j_restore_commit_frozen_check_stale");
    save("j-proof.json", {
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
    await startStock();
    bound = await approve();
    save("j-authority.json", bound.authority);
    stage = "immutable_commit_once";
    const response = await globalThis.fetch("http://127.0.0.1:4000/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer " + context.service_token,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "stage234-J-restore-commit",
          method: "tools/call",
          params: {
            name: "commit_preview",
            arguments: { preview_token: context.preview.preview_token },
          },
        }),
        signal: AbortSignal.timeout(60000),
      }),
      rpc = await response.json();
    if (!response.ok || rpc.error || rpc.result?.isError)
      fail("stage234_j_restore_commit_rejected_no_retry");
    commit =
      rpc.result?.structuredContent ??
      JSON.parse(rpc.result?.content?.[0]?.text ?? "null");
    save("j-restore-commit-result.json", sanitized(commit));
    if (commit.status !== "VERIFIED" || commit.preview_id !== bound.stored.id)
      fail("stage234_j_restore_commit_not_verified_no_retry");
    stage = "provider_reread_audit";
    const after = await snapshot(),
      removedRows = await Promise.all(
        removedGeoQueries(origin).map((q) => read(q)),
      ),
      removed = assertRestoredJ(
        before,
        after,
        commit,
        removedRows,
        plan,
        origin,
      );
    if (canonical(await read(queries.group)) !== canonical(bidBefore))
      fail("stage234_j_restore_commit_bid_side_effect");
    const stored = await db.client.mcpPreview.findUnique({
        where: { id: bound.stored.id },
      }),
      events = await db.client.auditEvent.findMany({
        where: {
          targetId: bound.stored.id,
          workspaceId: bound.account.workspaceId,
        },
        orderBy: { createdAt: "asc" },
      }),
      journal = assertJJournal({
        stored,
        original: bound.stored,
        result: commit,
        events,
      });
    if (counts().real_provider_write_call_count !== 1)
      fail("stage234_j_restore_commit_count_invalid");
    save("j-restore-verified-evidence.json", {
      acceptance_test: "J_RESTORE_COMMIT",
      result: "J restored VERIFIED; LIVE PASS",
      source_head: env.STAGE234_SOURCE_HEAD,
      harness_head: env.STAGE234_HARNESS_HEAD,
      preview_harness_head: env.STAGE234_PREVIEW_HARNESS_HEAD,
      image_digest: env.STAGE234_IMAGE_DIGEST,
      test_customer_id: target.customer,
      preview_id: stored.id,
      commit_id: commit.commit_id,
      approval: {
        confirmed_at: bound.stored.confirmedAt,
        expires_at: bound.stored.expiresAt,
        session_valid: true,
        audit_valid: true,
        immutable_digest: stored.snapshotDigest,
      },
      removed_criteria: removed,
      provider_state_before: before,
      provider_state_after: after,
      commit: sanitized(commit),
      original_geo_fully_restored: true,
      origin_commit_id: origin.commit_id,
      removed_provider_rows: removedRows,
      journal,
      audit: events.map((e) => ({
        id: e.id,
        type: e.eventType,
        result: e.metadata?.result ?? null,
        success: e.success,
        timestamp: e.createdAt,
      })),
      ...counts(),
      production_changed: false,
      main_changed: false,
      retried: false,
      timestamp: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        result: "J_RESTORE_LIVE_VERIFIED",
        preview_id: stored.id,
        commit_id: commit.commit_id,
        removed_criteria: removed,
        journal: "VERIFIED",
        ...counts(),
      }),
    );
  } catch (error) {
    const blocked = {
      result: "BLOCKED",
      code: safeError(error),
      failure_stage: stage,
      commit: sanitized(commit),
      ...counts(),
      startup: startup?.() ?? null,
      timestamp: new Date().toISOString(),
    };
    try {
      save("blocked-evidence.json", blocked);
    } catch {}
    console.log(
      JSON.stringify({
        result: blocked.result,
        code: blocked.code,
        failure_stage: stage,
        ...counts(),
      }),
    );
    process.exitCode = 1;
  } finally {
    server?.kill("SIGTERM");
    if (db) await closeDatabase(db);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runJRestoreCommit();

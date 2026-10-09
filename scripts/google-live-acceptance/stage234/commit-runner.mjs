// Explicitly authorized N continuation only. Importing this file never starts it.
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL, URL } from "node:url";
import process from "node:process";
const { structuredClone, AbortSignal, setTimeout, console } = globalThis;
// Resolve after guard installation; never capture the unguarded native fetch.
const fetch = (...args) => globalThis.fetch(...args);
import { queries, sanitized, safeError } from "./live-guard.mjs";
import { assertFixture, assertPausedDeliveryFixtures } from "./live-runner.mjs";
import {
  target,
  canonical,
  digest,
  fail,
  assertCommitRuntime,
  protectedJson,
  assertStoredN,
  installCommitGuard,
  rollbackPayload,
} from "./commit-guard.mjs";

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
export function assertRollbackPreview(p, stored, account, key, commitId) {
  const item = p?.items?.[0],
    op = stored?.requestedState?.operations?.[0];
  if (
    p?.status !== "preview" ||
    p.provider !== "GOOGLE_ADS" ||
    p.account_id !== target.customer ||
    p.operation_count !== 1 ||
    p.provider_validation !== "passed" ||
    p.partial_failure !== true ||
    p.provider_mutation_sent !== false ||
    p.items?.length !== 1 ||
    item.before?.resourceName !== target.groupResource ||
    String(item.before.cpcBidMicros) !== "110000" ||
    canonical({ ...item.before, cpcBidMicros: "100000" }) !==
      canonical(item.after) ||
    Date.parse(p.expires_at) <= Date.now() ||
    !Number.isFinite(Date.parse(p.expires_at)) ||
    p.rollback_of !== commitId ||
    !/^hmc_[A-Za-z0-9_-]{43}$/.test(commitId ?? "") ||
    !stored ||
    stored.id !== p.preview_id ||
    stored.previewTokenDigest !== digest(p.preview_token ?? "") ||
    stored.accountId !== account.id ||
    stored.connectionId !== account.connectionId ||
    stored.workspaceId !== account.workspaceId ||
    stored.serviceTokenId !== key.id ||
    stored.confirmedAt ||
    stored.consumedAt ||
    stored.cancelledAt ||
    stored.commitStatus !== "PREVIEWED" ||
    stored.diff?.provider_validation !== "passed" ||
    stored.snapshotDigest !== digest(stored.requestedState) ||
    stored.requestedState.version !== 2 ||
    stored.requestedState.account_id !== target.customer ||
    stored.requestedState.operations?.length !== 1 ||
    op?.kind !== "adGroups" ||
    op.method !== "update" ||
    op.resource_name !== target.groupResource ||
    op.update_mask !== "cpc_bid_micros" ||
    canonical(op.fields) !== canonical(rollbackPayload.operations[0].update) ||
    String(op.before?.cpcBidMicros) !== "110000" ||
    canonical({ ...op.before, cpcBidMicros: "100000" }) !==
      canonical(op.expected)
  )
    fail("stage234_commit_inverse_preview_invalid");
}
export async function runNContinuation() {
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
    closeDatabase;
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
      return readFileSync(join(root, "n-calls.jsonl"), "utf8")
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
    const context = protectedJson(join(root, "protected-preview-context.json"));
    createRequire("/workspace/apps/api/package.json")("reflect-metadata");
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
    assertNFixture(before, "100000");
    const originalEvidence = protectedJson(join(root, "evidence.json"));
    if (
      originalEvidence.preview_id !== context.preview.preview_id ||
      originalEvidence.persisted_preview_immutable !== true ||
      originalEvidence.provider_validation !== "passed" ||
      canonical(before) !== canonical(originalEvidence.provider_state_before)
    )
      fail("stage234_commit_provider_snapshot_stale");
    save("n-proof.json", await freshProof(before, "100000"));
    server = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "--import",
        "/stage234/commit-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: "ignore",
        env: { ...env, STAGE234_COMMIT_GUARD_PRELOAD: "1", LOG_LEVEL: "error" },
      },
    );
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      if (server.exitCode !== null)
        fail("stage234_commit_stock_api_start_failed");
      try {
        ready =
          (
            await fetch("http://127.0.0.1:4000/ready", {
              signal: AbortSignal.timeout(1000),
            })
          ).status === 200;
      } catch {
        // Bounded local API health wait only, never a provider retry.
      }
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) fail("stage234_commit_stock_api_not_ready");
    // Fresh DB approval immediately precedes the one immutable HTTP commit.
    bound = await approveProof();
    save("n-authority.json", bound.authority);
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
      "stage234-N-commit",
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
    assertNFixture(after, "110000");
    const expectedAfter = structuredClone(before);
    expectedAfter.group[0].adGroup.cpcBidMicros = "110000";
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
    save("n-commit-evidence.json", {
      ...report,
      result: "COMMIT_VERIFIED_ROLLBACK_APPROVAL_PENDING",
      timestamp: new Date().toISOString(),
    });
    // This is a new inverse preview, never an automatic restoration mutation.
    stage = "rollback_preview_once";
    writeFileSync(
      join(root, "n-proof.json"),
      JSON.stringify(await freshProof(after, "110000")),
      { mode: 0o600 },
    );
    writeFileSync(
      join(root, "n-authority.json"),
      JSON.stringify({
        ...bound.authority,
        phase: "rollback",
        commit_id: result.commit_id,
        expires_at: new Date(Date.now() + 120000).toISOString(),
      }),
      { mode: 0o600 },
    );
    const inverse = await mcp(
      "preview_rollback_commit",
      { commit_id: result.commit_id },
      "stage234-N-rollback-preview",
    );
    const storedInverse = await db.client.mcpPreview.findUnique({
      where: { id: inverse.preview_id },
    });
    assertRollbackPreview(
      inverse,
      storedInverse,
      bound.account,
      bound.key,
      result.commit_id,
    );
    const unchanged = await snapshot();
    assertNFixture(unchanged, "110000");
    if (canonical(unchanged) !== canonical(after))
      fail("stage234_commit_provider_changed_by_inverse_preview");
    const counts = calls();
    if (
      counts.filter((e) => e.type === "write").length !== 1 ||
      counts.filter((e) => e.type === "validate_only").length !== 1
    )
      fail("stage234_commit_call_accounting_invalid");
    save("protected-n-rollback-context.json", {
      preview: inverse,
      service_token: context.service_token,
      original_commit_id: result.commit_id,
    });
    save("n-rollback-preview-evidence.json", {
      ...report,
      result: "WAITING_FOR_MANUAL_ROLLBACK_APPROVAL",
      rollback_preview: sanitized(inverse),
      rollback_before: "110000",
      rollback_expected_after: "100000",
      provider_state_after_rollback_preview: unchanged,
      provider_read_call_count: counts.filter((e) =>
        ["read", "read_mcc"].includes(e.type),
      ).length,
      validate_only_call_count: 1,
      real_provider_write_call_count: 1,
      timestamp: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        result: "WAITING_FOR_MANUAL_ROLLBACK_APPROVAL",
        commit_id: result.commit_id,
        preview_id: inverse.preview_id,
        expires_at: inverse.expires_at,
        approval_url: inverse.approval_url,
        before_cpc_micros: "110000",
        after_cpc_micros: "100000",
        provider_reads: counts.filter((e) =>
          ["read", "read_mcc"].includes(e.type),
        ).length,
        validate_only: 1,
        real_writes: 1,
      }),
    );
  } catch (error) {
    const counts = calls(),
      blocked = {
        ...report,
        failure_stage: stage,
        code: safeError(error),
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
      save("n-blocked-evidence.json", blocked);
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
  await runNContinuation();

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
  installRemoveCommitGuard,
  assertRemoveApproval,
  removedQuery,
} from "./audience-remove-commit-guard.mjs";
import { queries, sanitized, safeError } from "./live-guard.mjs";
import { waitLocalReady } from "./wait-local-ready.mjs";
import { startupDiagnostics } from "./startup-diagnostics.mjs";
export function assertRemovedAudience(before, after, result, removed, origin) {
  const resource = origin.created_audience.resource_name,
    ops = result?.items?.[0]?.operations;
  if (
    result?.status !== "VERIFIED" ||
    result.account_id !== target.customer ||
    result.operation_count !== 1 ||
    result.atomic !== false ||
    result.partial_failure !== true ||
    result.irreversible !== true ||
    !/^hmc_[A-Za-z0-9_-]{43}$/.test(result.commit_id ?? "") ||
    result.items?.length !== 1 ||
    ops?.length !== 1 ||
    ops[0].operation !== 0 ||
    ops[0].success !== true ||
    ops[0].error !== null ||
    ops[0].resource_name !== resource ||
    (ops[0].actual !== null &&
      (ops[0].actual?.resourceName !== resource ||
        ops[0].actual.status !== "REMOVED"))
  )
    fail("stage234_i_remove_commit_result_invalid");
  if (
    removed?.length !== 1 ||
    removed[0]?.adGroupCriterion?.resourceName !== resource ||
    removed[0].adGroupCriterion.adGroup !== target.groupResource ||
    removed[0].adGroupCriterion.status !== "REMOVED" ||
    removed[0].adGroupCriterion.type !== "USER_INTEREST" ||
    removed[0].adGroupCriterion.userInterest?.userInterestCategory !==
      origin.created_audience.audience_resource
  )
    fail("stage234_i_remove_provider_status_unverified");
  const original = before.groupAudiences.filter(
    (r) => r.adGroupCriterion?.resourceName === resource,
  );
  const expected = structuredClone(before);
  expected.groupAudiences = expected.groupAudiences.filter(
    (r) => r.adGroupCriterion?.resourceName !== resource,
  );
  if (
    original.length !== 1 ||
    original[0].adGroupCriterion.status !== "ENABLED" ||
    canonical(after) !== canonical(expected)
  )
    fail("stage234_i_remove_unexpected_side_effect");
  const group = after.group?.[0]?.adGroup;
  if (
    group?.status !== "PAUSED" ||
    group.resourceName !== target.groupResource ||
    group.targetingSetting?.targetRestrictions?.filter(
      (r) => r.targetingDimension === "AUDIENCE" && r.bidOnly === true,
    ).length !== 1
  )
    fail("stage234_i_remove_observation_changed");
  return {
    criterion_id: origin.created_audience.criterion_id,
    resource_name: resource,
    status: "REMOVED",
    residual_audience_mode: "OBSERVATION",
    original_absent_mode_restored: false,
  };
}
export function assertRemoveJournal({ stored, original, result, events }) {
  const ops = events.filter(
      (e) => e.eventType === "mcp_google_stage1_operation",
    ),
    attempts = ops.filter((e) => e.metadata?.result === "attempted"),
    finals = ops.filter((e) => e.metadata?.result === "success"),
    commits = events.filter((e) => e.eventType === "mcp_google_commit_result");
  if (
    !stored?.consumedAt ||
    stored.commitStatus !== "VERIFIED" ||
    stored.snapshotDigest !== original.snapshotDigest ||
    canonical(stored.requestedState) !== canonical(original.requestedState) ||
    canonical(stored.beforeState) !== canonical(original.beforeState) ||
    ops.length !== 2 ||
    attempts.length !== 1 ||
    finals.length !== 1 ||
    commits.length !== 1
  )
    fail("stage234_i_remove_journal_missing_or_changed");
  const final = finals[0],
    attempt = attempts[0],
    commit = commits[0],
    resource = result.items[0].operations[0].resource_name;
  if (
    [...ops, commit].some(
      (e) =>
        !e.success ||
        !Number.isFinite(+new Date(e.createdAt)) ||
        e.targetId !== stored.id ||
        e.workspaceId !== stored.workspaceId ||
        e.metadata?.commitId !== result.commit_id ||
        e.metadata?.previewId !== stored.id ||
        e.metadata?.accountId !== target.customer ||
        e.metadata?.provider !== "GOOGLE_ADS",
    ) ||
    ops.some(
      (e) =>
        e.metadata.providerOperation !== 0 ||
        e.metadata.campaignId !== target.campaign ||
        e.metadata.adGroupId !== target.group ||
        e.metadata.operation !== "targeting" ||
        e.metadata.googleErrorCode !== null,
    ) ||
    final.metadata.objectId !== resource ||
    final.metadata.actual !== canonical(result.items[0].operations[0].actual) ||
    final.metadata.before !== attempt.metadata.before ||
    final.metadata.after !== attempt.metadata.after ||
    commit.metadata.result !== "VERIFIED" ||
    commit.metadata.operation !== "GOOGLE_STAGE3_TARGETING" ||
    +new Date(attempt.createdAt) > +new Date(final.createdAt) ||
    +new Date(final.createdAt) > +new Date(commit.createdAt)
  )
    fail("stage234_i_remove_journal_identity_or_state_invalid");
  return {
    result: "VERIFIED",
    attempted_operations: 1,
    terminal_success_operations: 1,
    verified_commit_events: 1,
  };
}
export async function runRemoveCommit() {
  installRemoveCommitGuard();
  const env = process.env,
    root = env.STAGE234_RUN_DIR;
  const save = (name, value) =>
    writeFileSync(join(root, name), JSON.stringify(value, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  const counts = () => {
    let rows = [];
    try {
      rows = readFileSync(join(root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {
      /* Before network. */
    }
    return {
      provider_read_call_count: rows.filter((r) =>
        ["read", "read_mcc"].includes(r.type),
      ).length,
      validate_only_call_count: 0,
      real_provider_write_call_count: rows.filter((r) => r.type === "write")
        .length,
      oauth_refresh_call_count: rows.filter((r) => r.type === "oauth_refresh")
        .length,
    };
  };
  let db,
    closeDatabase,
    server,
    startupEvidence,
    stage = "approval_db",
    commit = null;
  try {
    createRequire("/workspace/apps/api/package.json")("reflect-metadata");
    const { loadConfig } =
      await import("/workspace/packages/config/dist/index.js");
    const database = await import("/workspace/packages/database/dist/index.js");
    closeDatabase = database.closeDatabase;
    const { CredentialVaultService } =
      await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
    const { GoogleAdsAdapter } =
      await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
    const context = await readAcceptanceContext(
        join(root, "protected-preview-context.json"),
      ),
      origin = protectedJson(join(root, "i-origin.json")),
      previewEvidence = protectedJson(join(root, "evidence.json")),
      config = loadConfig();
    if (
      new URL(config.databaseUrl).hostname !== "postgres" ||
      new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
      new URL(config.redisUrl).hostname !== "redis" ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]' ||
      !config.confirmedWriteEnabled ||
      config.previewOnly
    )
      fail("stage234_i_remove_commit_disposable_config_invalid");
    db = database.createDatabase(config.databaseUrl);
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
      const authority = assertRemoveApproval(
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
      });
      const membership = await db.client.workspaceMembership.findFirst({
        where: {
          workspaceId: account.workspaceId,
          userId: stored.approvedByUserId,
        },
      });
      if (
        only.length !== 1 ||
        only[0].id !== account.id ||
        !membership ||
        !["OWNER", "ADMIN", "MEMBER"].includes(membership.role)
      )
        fail("stage234_i_remove_commit_scope_or_membership_invalid");
      return { stored, account, authority };
    };
    let bound = await approve();
    if (
      previewEvidence.preview_id !== bound.stored.id ||
      previewEvidence.harness_head !== env.STAGE234_PREVIEW_HARNESS_HEAD ||
      previewEvidence.before_after_unchanged !== true ||
      previewEvidence.provider_validation !== "passed" ||
      previewEvidence.real_provider_write_call_count !== 0 ||
      previewEvidence.result !== "PREVIEW_PASS_REMOVE_APPROVAL_PENDING"
    )
      fail("stage234_i_remove_commit_preview_origin_invalid");
    const connection = await db.client.providerConnection.findUnique({
      where: { id: bound.account.connectionId },
      include: { credential: true },
    });
    if (
      connection?.provider !== "GOOGLE_ADS" ||
      connection.workspaceId !== bound.account.workspaceId ||
      !connection.credential
    )
      fail("stage234_i_remove_commit_vault_owner_invalid");
    const adapter = new GoogleAdsAdapter(config);
    let credentials = new CredentialVaultService().decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_i_remove_commit_scope_missing");
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
    stage = "fresh_fixture_stale_check";
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
      fail("stage234_i_remove_commit_test_hierarchy_invalid");
    const before = await snapshot(),
      bidBefore = await read(queries.group);
    if (
      canonical(before) !==
        canonical(previewEvidence.provider_state_after_preview) ||
      canonical(before) !== canonical(previewEvidence.provider_state_before) ||
      bidBefore.length !== 1 ||
      String(bidBefore[0]?.adGroup?.cpcBidMicros) !== "100000" ||
      bidBefore[0].adGroup.status !== "PAUSED"
    )
      fail("stage234_i_remove_commit_fixture_stale");
    save("remove-proof.json", {
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
        "/stage234/audience-remove-commit-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...env,
          STAGE234_I_REMOVE_COMMIT_GUARD_PRELOAD: "1",
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
      fail("stage234_i_remove_commit_api_not_ready");
    bound = await approve();
    save("remove-authority.json", bound.authority);
    stage = "immutable_commit_once";
    const response = await globalThis.fetch("http://127.0.0.1:4000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${context.service_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "stage234-I-remove-commit",
        method: "tools/call",
        params: {
          name: "commit_preview",
          arguments: { preview_token: context.preview.preview_token },
        },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const rpc = await response.json();
    if (!response.ok || rpc.error || rpc.result?.isError)
      fail("stage234_i_remove_commit_rejected_no_retry");
    commit =
      rpc.result?.structuredContent ??
      JSON.parse(rpc.result?.content?.[0]?.text ?? "null");
    save("remove-commit-result.json", sanitized(commit));
    if (commit.status !== "VERIFIED" || commit.preview_id !== bound.stored.id)
      fail("stage234_i_remove_commit_not_verified_no_retry");
    stage = "provider_reread_audit";
    const after = await snapshot(),
      removed = await read(removedQuery(origin));
    const verified = assertRemovedAudience(
      before,
      after,
      commit,
      removed,
      origin,
    );
    if (canonical(await read(queries.group)) !== canonical(bidBefore))
      fail("stage234_i_remove_commit_bid_side_effect");
    const stored = await db.client.mcpPreview.findUnique({
        where: { id: bound.stored.id },
      }),
      events = await db.client.auditEvent.findMany({
        where: {
          targetId: bound.stored.id,
          workspaceId: bound.account.workspaceId,
        },
        orderBy: { createdAt: "asc" },
      });
    const journal = assertRemoveJournal({
        stored,
        original: bound.stored,
        result: commit,
        events,
      }),
      accounting = counts();
    if (accounting.real_provider_write_call_count !== 1)
      fail("stage234_i_remove_commit_count_invalid");
    save("i-remove-verified-evidence.json", {
      acceptance_test: "I_REMOVE",
      result: "LIVE_PASS",
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
      verified,
      provider_state_before: before,
      provider_state_after: after,
      removed_provider_row: removed,
      commit: sanitized(commit),
      journal,
      audit: events.map((e) => ({
        id: e.id,
        type: e.eventType,
        result: e.metadata?.result ?? null,
        success: e.success,
        timestamp: e.createdAt,
      })),
      ...accounting,
      production_changed: false,
      main_changed: false,
      retried: false,
      timestamp: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        result: "I_REMOVE_LIVE_PASS",
        preview_id: stored.id,
        commit_id: commit.commit_id,
        criterion_id: verified.criterion_id,
        status: "REMOVED",
        mode: "OBSERVATION",
        journal: "VERIFIED",
        ...accounting,
      }),
    );
  } catch (error) {
    const blocked = {
      result: "BLOCKED",
      code: safeError(error),
      failure_stage: stage,
      commit: sanitized(commit),
      ...counts(),
      startup: startupEvidence?.() ?? null,
      timestamp: new Date().toISOString(),
    };
    try {
      save("blocked-evidence.json", blocked);
    } catch {
      /* Immutable evidence. */
    }
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
  await runRemoveCommit();

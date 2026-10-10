import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { readAcceptanceContext } from "./context-vault.mjs";
import {
  assertApprovedStage3,
  target,
  canonical,
  digest,
  fail,
  protectedJson,
  READINESS_SNAPSHOT_QUERIES,
} from "./audience-commit-guard.mjs";
import { installJCommitGuard } from "./geo-commit-guard.mjs";
import { assertPreparedJ, J_QUERIES, geoQuery } from "./geo-preview-guard.mjs";
import { queries, sanitized, safeError } from "./live-guard.mjs";
import { waitLocalReady } from "./wait-local-ready.mjs";
import { startupDiagnostics } from "./startup-diagnostics.mjs";
export function assertCreatedJ(
  before,
  after,
  result,
  locations,
  proximity,
  plan,
) {
  assertPreparedJ(plan);
  if (
    result?.status !== "VERIFIED" ||
    result.account_id !== target.customer ||
    result.operation_count !== 2 ||
    result.atomic !== false ||
    result.partial_failure !== true ||
    result.irreversible !== false ||
    !/^hmc_[A-Za-z0-9_-]{43}$/.test(result.commit_id ?? "") ||
    result.items?.length !== 2
  )
    fail("stage234_j_commit_result_invalid");
  const subset = (a, e) =>
    e && typeof e === "object"
      ? a &&
        typeof a === "object" &&
        Object.entries(e).every(([k, v]) => subset(a[k], v))
      : String(a) === String(e);
  const created = result.items.map((item, i) => {
    const op = item.operations?.[0],
      expected = plan.operations[i].expected;
    if (
      item.operations?.length !== 1 ||
      op.operation !== i ||
      op.success !== true ||
      op.error !== null ||
      !new RegExp(
        "^customers/" +
          target.customer +
          "/campaignCriteria/" +
          target.campaign +
          "~[1-9][0-9]{0,19}$",
      ).test(op.resource_name ?? "") ||
      !subset(op.actual, expected) ||
      op.actual.resourceName !== op.resource_name
    )
      fail("stage234_j_commit_operation_invalid");
    const rows = (i === 0 ? locations : proximity).filter(
      (r) => r.campaignCriterion?.resourceName === op.resource_name,
    );
    if (
      rows.length !== 1 ||
      !subset(rows[0].campaignCriterion, expected) ||
      rows[0].campaignCriterion.type !== (i === 0 ? "LOCATION" : "PROXIMITY")
    )
      fail("stage234_j_provider_reread_unverified");
    return {
      criterion_id: op.resource_name.split("~")[1],
      resource_name: op.resource_name,
      type: i === 0 ? "LOCATION" : "PROXIMITY",
      provider_state: rows[0].campaignCriterion,
    };
  });
  if (
    new Set(created.map((c) => c.resource_name)).size !== 2 ||
    created.some((c) =>
      before.campaignCriteria.some(
        (r) => r.campaignCriterion.resourceName === c.resource_name,
      ),
    )
  )
    fail("stage234_j_created_identity_not_new");
  const expected = structuredClone(after);
  expected.campaignCriteria = expected.campaignCriteria.filter(
    (r) =>
      !created.some(
        (c) => c.resource_name === r.campaignCriterion.resourceName,
      ),
  );
  if (
    after.campaignCriteria.length !== before.campaignCriteria.length + 2 ||
    canonical(expected) !== canonical(before)
  )
    fail("stage234_j_unexpected_side_effect");
  return created;
}
export function assertJJournal({ stored, original, result, events }) {
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
    ops.length !== 4 ||
    attempts.length !== 2 ||
    finals.length !== 2 ||
    commits.length !== 1
  )
    fail("stage234_j_journal_missing_or_changed");
  if (
    [...ops, ...commits].some(
      (e) =>
        !e.success ||
        !Number.isFinite(+new Date(e.createdAt)) ||
        e.targetId !== stored.id ||
        e.workspaceId !== stored.workspaceId ||
        e.metadata?.commitId !== result.commit_id ||
        e.metadata?.previewId !== stored.id ||
        e.metadata?.accountId !== target.customer ||
        e.metadata?.provider !== "GOOGLE_ADS",
    )
  )
    fail("stage234_j_journal_identity_invalid");
  for (let i = 0; i < 2; i++) {
    const a = attempts.filter((e) => e.metadata.providerOperation === i),
      f = finals.filter((e) => e.metadata.providerOperation === i),
      op = result.items[i].operations[0];
    if (
      a.length !== 1 ||
      f.length !== 1 ||
      [a[0], f[0]].some(
        (e) =>
          e.metadata.campaignId !== target.campaign ||
          e.metadata.adGroupId !== "" ||
          e.metadata.operation !== "targeting" ||
          e.metadata.googleErrorCode !== null,
      ) ||
      f[0].metadata.objectId !== op.resource_name ||
      f[0].metadata.actual !== canonical(op.actual) ||
      f[0].metadata.before !== a[0].metadata.before ||
      f[0].metadata.after !== a[0].metadata.after ||
      +new Date(a[0].createdAt) > +new Date(f[0].createdAt) ||
      +new Date(f[0].createdAt) > +new Date(commits[0].createdAt)
    )
      fail("stage234_j_journal_operation_invalid");
  }
  if (
    commits[0].metadata.result !== "VERIFIED" ||
    commits[0].metadata.operation !== "GOOGLE_STAGE3_TARGETING"
  )
    fail("stage234_j_journal_result_invalid");
  return {
    result: "VERIFIED",
    attempted_operations: 2,
    terminal_success_operations: 2,
    verified_commit_events: 1,
  };
}
export async function runJCommit() {
  installJCommitGuard();
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
      plan = protectedJson(join(root, "prepared-j-plan.json")),
      geoProof = protectedJson(join(root, "geo-proof.json")),
      config = loadConfig();
    assertPreparedJ(plan);
    if (
      new URL(config.databaseUrl).hostname !== "postgres" ||
      new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
      new URL(config.redisUrl).hostname !== "redis" ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]' ||
      !config.confirmedWriteEnabled ||
      config.previewOnly
    )
      fail("stage234_j_commit_disposable_config_invalid");
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
      const authority = {
        ...assertApprovedStage3(
          { context, stored, account, key, session, approval },
          env.STAGE234_EXPECTED_I_PREVIEW,
          assertPreparedJ,
        ),
        phase: "j_commit",
      };
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
        fail("stage234_j_commit_scope_or_payload_invalid");
      return { stored, account, authority };
    };
    let bound = await approve();
    if (
      evidence.preview_id !== bound.stored.id ||
      evidence.harness_head !== env.STAGE234_PREVIEW_HARNESS_HEAD ||
      evidence.before_after_unchanged !== true ||
      evidence.provider_validation !== "passed" ||
      evidence.real_provider_write_call_count !== 0 ||
      evidence.result !== "PREVIEW_PASS_MANUAL_APPROVAL_PENDING"
    )
      fail("stage234_j_commit_preview_origin_invalid");
    const connection = await db.client.providerConnection.findUnique({
      where: { id: bound.account.connectionId },
      include: { credential: true },
    });
    if (
      connection?.provider !== "GOOGLE_ADS" ||
      connection.workspaceId !== bound.account.workspaceId ||
      !connection.credential
    )
      fail("stage234_j_commit_credential_owner_invalid");
    const adapter = new GoogleAdsAdapter(config);
    let credentials = new CredentialVaultService().decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_j_commit_oauth_scope_invalid");
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
      fail("stage234_j_commit_test_hierarchy_invalid");
    const before = await snapshot(),
      bidBefore = await read(queries.group);
    if (
      canonical(before) !== canonical(evidence.provider_state_before) ||
      canonical(before) !== canonical(evidence.provider_state_after_preview) ||
      bidBefore.length !== 1 ||
      String(bidBefore[0].adGroup?.cpcBidMicros) !== "100000" ||
      bidBefore[0].adGroup.status !== "PAUSED"
    )
      fail("stage234_j_commit_fixture_stale");
    for (const c of plan.checks)
      if (canonical(await read(c.query)) !== canonical(c.rows))
        fail("stage234_j_commit_frozen_check_stale");
    for (const id of ["9235214", "9196209", "2398", "9070290"]) {
      const rows = await read(geoQuery(id, true));
      if (
        rows.length !== 1 ||
        canonical(rows[0].geoTargetConstant) !== canonical(geoProof[id])
      )
        fail("stage234_j_commit_geo_parent_stale");
    }
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
    stage = "stock_api_ready";
    server = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "--import",
        "/stage234/geo-commit-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...env,
          STAGE234_J_COMMIT_GUARD_PRELOAD: "1",
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
      fail("stage234_j_commit_api_not_ready");
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
          id: "stage234-J-commit",
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
      fail("stage234_j_commit_rejected_no_retry");
    commit =
      rpc.result?.structuredContent ??
      JSON.parse(rpc.result?.content?.[0]?.text ?? "null");
    save("j-commit-result.json", sanitized(commit));
    if (commit.status !== "VERIFIED" || commit.preview_id !== bound.stored.id)
      fail("stage234_j_commit_not_verified_no_retry");
    stage = "provider_reread_audit";
    const after = await snapshot(),
      locations = await read(J_QUERIES.locations),
      proximity = await read(J_QUERIES.proximity),
      created = assertCreatedJ(
        before,
        after,
        commit,
        locations,
        proximity,
        plan,
      );
    if (canonical(await read(queries.group)) !== canonical(bidBefore))
      fail("stage234_j_commit_bid_side_effect");
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
      fail("stage234_j_commit_count_invalid");
    save("j-verified-evidence.json", {
      acceptance_test: "J_COMMIT",
      result: "LIVE_VERIFIED_RESTORE_PENDING",
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
      created_criteria: created,
      provider_state_before: before,
      provider_state_after: after,
      commit: sanitized(commit),
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
        result: "J_ADD_LIVE_VERIFIED_RESTORE_PENDING",
        preview_id: stored.id,
        commit_id: commit.commit_id,
        created_criteria: created,
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
  await runJCommit();

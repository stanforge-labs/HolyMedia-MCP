// Explicitly authorized L continuation only. Importing this file never starts it.
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL, URL } from "node:url";
import { readAcceptanceContext } from "./context-vault.mjs";
import process from "node:process";
const { structuredClone, AbortSignal, console } = globalThis;
// Resolve after guard installation; never capture the unguarded native fetch.
const fetch = (...args) => globalThis.fetch(...args);
import { queries, sanitized, safeError } from "./live-guard.mjs";
import { createFields } from "./rsa-preview-guard.mjs";
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
  assertApprovedL,
  exactPreview,
  installCommitGuard,
} from "./rsa-commit-guard.mjs";

// NEW ad only. Keep the full raw old inventory in the before/after comparison.
export function createdRsaContent(ad) {
  const rsa = ad?.responsiveSearchAd;
  if (
    !rsa ||
    typeof rsa !== "object" ||
    Array.isArray(rsa) ||
    Object.keys(rsa).some(
      (k) => !["headlines", "descriptions", "path1", "path2"].includes(k),
    )
  )
    fail("stage234_l_created_rsa_content_invalid");
  const textAssets = (values) => {
    if (!Array.isArray(values)) fail("stage234_l_created_rsa_content_invalid");
    return values.map((value) => {
      if (
        !value ||
        typeof value !== "object" ||
        typeof value.text !== "string" ||
        Object.keys(value).some(
          (k) =>
            ![
              "text",
              "pinnedField",
              "assetPerformanceLabel",
              "policySummaryInfo",
            ].includes(k),
        )
      )
        fail("stage234_l_created_rsa_content_invalid");
      // Known read-only provider metadata is not part of the creation contract.
      return {
        text: value.text,
        ...(value.pinnedField && value.pinnedField !== "UNSPECIFIED"
          ? { pinnedField: value.pinnedField }
          : {}),
      };
    });
  };
  return {
    finalUrls: ad.finalUrls,
    responsiveSearchAd: {
      headlines: textAssets(rsa.headlines),
      descriptions: textAssets(rsa.descriptions),
      ...(rsa.path1 !== undefined && rsa.path1 !== ""
        ? { path1: rsa.path1 }
        : {}),
      ...(rsa.path2 !== undefined && rsa.path2 !== ""
        ? { path2: rsa.path2 }
        : {}),
    },
  };
}
export function assertCreatedRsa(before, after) {
  const prior = new Set(before.rsa.map((r) => r.adGroupAd.resourceName));
  const additions = after.rsa.filter(
    (r) => !prior.has(r.adGroupAd?.resourceName),
  );
  if (additions.length !== 1 || after.rsa.length !== before.rsa.length + 1)
    fail("stage234_l_created_rsa_count_invalid");
  const row = additions[0],
    ad = row.adGroupAd?.ad,
    id = String(ad?.id ?? ""),
    resource = row.adGroupAd?.resourceName;
  if (
    !/^[1-9][0-9]*$/.test(id) ||
    resource !==
      `customers/${target.customer}/adGroupAds/${target.group}~${id}` ||
    row.adGroupAd.status !== "PAUSED" ||
    String(row.campaign?.id) !== target.campaign ||
    String(row.adGroup?.id) !== target.group ||
    ad.type !== "RESPONSIVE_SEARCH_AD" ||
    canonical(createdRsaContent(ad)) !== canonical(createFields.ad)
  )
    fail("stage234_l_created_rsa_poststate_invalid");
  const normalized = structuredClone(after);
  normalized.rsa = normalized.rsa.filter(
    (r) => r.adGroupAd.resourceName !== resource,
  );
  const deliveryNew = normalized.fixtureAds.filter(
    (r) => r.adGroupAd?.resourceName === resource,
  );
  if (deliveryNew.length !== 1 || deliveryNew[0].adGroupAd.status !== "PAUSED")
    fail("stage234_l_created_delivery_row_invalid");
  normalized.fixtureAds = normalized.fixtureAds.filter(
    (r) => r.adGroupAd.resourceName !== resource,
  );
  assertFixture(normalized);
  assertPausedDeliveryFixtures(normalized);
  if (canonical(normalized) !== canonical(before))
    fail("stage234_l_commit_unexpected_provider_side_effect");
  return {
    ad_id: id,
    resource_name: resource,
    status: "PAUSED",
    provider_state: row.adGroupAd,
  };
}
export async function runLCommit() {
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
    acceptance_test: "L_COMMIT",
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
      return readFileSync(join(root, "l-calls.jsonl"), "utf8")
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
      const authority = assertApprovedL(
        {
          context,
          stored,
          account,
          key,
          session,
          approval,
        },
        env.STAGE234_EXPECTED_L_PREVIEW,
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
    if (env.STAGE234_L_DB_PREFLIGHT_ONLY === "true") {
      const checked = {
        result: "L_DB_APPROVAL_PREFLIGHT_PASS",
        preview_id: bound.stored.id,
        confirmed_at: new Date(bound.stored.confirmedAt).toISOString(),
        expires_at: bound.authority.expires_at,
        session_valid: true,
        audit_valid: true,
        immutable_digest: bound.authority.snapshot_digest,
        provider_reads: 0,
        validate_only: 0,
        real_writes: 0,
      };
      save("l-db-precheck.json", checked);
      console.log(JSON.stringify(checked));
      return;
    }
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
    assertFixture(before);
    assertPausedDeliveryFixtures(before);
    const originalEvidence = protectedJson(join(root, "evidence.json"));
    if (
      originalEvidence.acceptance_test !== "L_PREVIEW_ONLY" ||
      originalEvidence.preview_id !== exactPreview ||
      originalEvidence.provider_validation !== "passed" ||
      originalEvidence.source_head !== env.STAGE234_SOURCE_HEAD ||
      originalEvidence.image_digest !== env.STAGE234_IMAGE_DIGEST ||
      canonical(before) !== canonical(originalEvidence.provider_state_before) ||
      canonical(before) !==
        canonical(originalEvidence.provider_state_after_preview)
    )
      fail("stage234_commit_provider_snapshot_stale");
    save("l-proof.json", await freshProof(before, "100000"));
    server = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "--import",
        "/stage234/rsa-commit-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...env,
          STAGE234_COMMIT_GUARD_PRELOAD: "0",
          STAGE234_L_COMMIT_GUARD_PRELOAD: "1",
          LOG_LEVEL: "error",
        },
      },
    );
    startupEvidence = startupDiagnostics(server);
    const ready = await waitLocalReady({ fetch, server });
    report.startup = startupEvidence();
    if (!ready) fail("stage234_commit_stock_api_not_ready");
    // Fresh DB approval immediately precedes the one immutable HTTP commit.
    bound = await approveProof();
    save("l-authority.json", bound.authority);
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
      "stage234-L-commit",
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
    report.created_rsa = assertCreatedRsa(before, after);
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
    save("l-commit-evidence.json", {
      ...report,
      result: "L_COMMIT_VERIFIED",
      timestamp: new Date().toISOString(),
    });
    const counts = calls();
    if (
      counts.filter((e) => e.type === "write").length !== 1 ||
      counts.some((e) => e.type === "validate_only")
    )
      fail("stage234_restore_call_accounting_invalid");
    save("l-verified-evidence.json", {
      ...report,
      result: "L_COMMIT_VERIFIED",
      provider_read_call_count: counts.filter((e) =>
        ["read", "read_mcc"].includes(e.type),
      ).length,
      validate_only_call_count: 0,
      real_provider_write_call_count: 1,
      timestamp: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        result: "L_COMMIT_VERIFIED",
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
      save("l-blocked-evidence.json", blocked);
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
  await runLCommit();

// Read-only reconciliation of ONE already attempted I commit. Never retries it.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { assertIJournal } from "./audience-journal.mjs";
import { assertCreatedAudience } from "./audience-commit-runner.mjs";
import { sourceHead, imageDigest } from "./audience-preview-guard.mjs";
import {
  canonical,
  digest,
  queries,
  target,
  protectedJson,
  fail,
  READINESS_SNAPSHOT_QUERIES,
} from "./audience-commit-guard.mjs";
import { safeError } from "./live-guard.mjs";
export function classifyIReconcile(input, init = {}) {
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    method !== "POST"
  )
    fail("stage234_i_reconcile_transport_blocked");
  if (
    url.origin === "https://oauth2.googleapis.com" &&
    url.pathname === "/token" &&
    new URLSearchParams(init.body).get("grant_type") === "refresh_token"
  )
    return "oauth_refresh";
  const body = JSON.parse(init.body);
  if (
    url.origin !== "https://googleads.googleapis.com" ||
    new Headers(init.headers).get("login-customer-id") !== target.mcc ||
    canonical(Object.keys(body)) !== canonical(["query"])
  )
    fail("stage234_i_reconcile_transport_blocked");
  if (
    url.pathname ===
      `/v24/customers/${target.customer}/googleAds:searchStream` &&
    [
      ...Object.values(READINESS_SNAPSHOT_QUERIES),
      queries.customer,
      queries.group,
    ].includes(body.query)
  )
    return "read";
  if (
    url.pathname === `/v24/customers/${target.mcc}/googleAds:searchStream` &&
    [queries.customer, queries.hierarchy].includes(body.query)
  )
    return "read_mcc";
  fail("stage234_i_reconcile_transport_blocked");
}
export async function reconcileI() {
  const env = process.env,
    root = env.STAGE234_RUN_DIR;
  if (
    env.STAGE234_SOURCE_HEAD !== sourceHead ||
    env.STAGE234_IMAGE_DIGEST !== imageDigest ||
    env.V2_CONFIRMED_WRITE_ENABLED !== "false" ||
    env.V2_PREVIEW_ONLY !== "true" ||
    env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST !== target.customer ||
    !/^\/acceptance-state\/stage234-i-reconcile-[A-Za-z0-9_-]+$/.test(
      root ?? "",
    )
  )
    fail("stage234_i_reconcile_runtime_invalid");
  let db, closeDatabase;
  const calls = [],
    nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({
      type: classifyIReconcile(input, init),
      at: new Date().toISOString(),
    });
    return nativeFetch(input, { ...init, redirect: "error" });
  };
  try {
    const blocked = protectedJson("/i-origin/i-blocked-evidence.json");
    const preview = protectedJson("/i-origin/evidence.json");
    const plan = protectedJson("/i-origin/prepared-i-plan.json");
    if (
      blocked.code !== "stage234_commit_journal_missing_or_immutable_changed" ||
      blocked.real_provider_write_call_count !== 1 ||
      blocked.commit?.status !== "VERIFIED" ||
      preview.preview_id !== blocked.commit.preview_id ||
      preview.source_head !== sourceHead ||
      preview.image_digest !== imageDigest ||
      digest(plan) !== blocked.approval?.immutable_digest ||
      preview.before_after_unchanged !== true
    )
      fail("stage234_i_reconcile_origin_invalid");
    createRequire("/workspace/apps/api/package.json")("reflect-metadata");
    const { loadConfig } =
      await import("/workspace/packages/config/dist/index.js");
    const database = await import("/workspace/packages/database/dist/index.js");
    const { CredentialVaultService } =
      await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
    const { GoogleAdsAdapter } =
      await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
    closeDatabase = database.closeDatabase;
    const config = loadConfig();
    if (
      new URL(config.databaseUrl).hostname !== "postgres" ||
      new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
      new URL(config.redisUrl).hostname !== "redis" ||
      config.providerGoogleApiVersion !== "v24" ||
      config.providerGoogleLoginCustomerId !== target.mcc ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]'
    )
      fail("stage234_i_reconcile_config_invalid");
    db = database.createDatabase(config.databaseUrl);
    const stored = await db.client.mcpPreview.findUnique({
      where: { id: preview.preview_id },
      include: { account: true },
    });
    const account = stored?.account;
    if (
      account?.provider !== "GOOGLE_ADS" ||
      account.externalAccountId !== target.customer ||
      !account.enabled ||
      stored.workspaceId !== account.workspaceId ||
      stored.connectionId !== account.connectionId
    )
      fail("stage234_i_reconcile_owner_invalid");
    const events = await db.client.auditEvent.findMany({
      where: { targetId: stored.id, workspaceId: stored.workspaceId },
      orderBy: { createdAt: "asc" },
    });
    const journal = assertIJournal({
      stored,
      original: {
        id: stored.id,
        workspaceId: stored.workspaceId,
        snapshotDigest: digest(plan),
        requestedState: plan,
        beforeState: plan.checks,
      },
      result: blocked.commit,
      events,
    });
    const beforeDbHash = digest(stored),
      beforeAuditHash = digest(events);
    const connection = await db.client.providerConnection.findUnique({
      where: { id: account.connectionId },
      include: { credential: true },
    });
    if (
      connection?.provider !== "GOOGLE_ADS" ||
      connection.workspaceId !== account.workspaceId ||
      !connection.credential
    )
      fail("stage234_i_reconcile_credential_owner_invalid");
    let credentials = new CredentialVaultService().decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_i_reconcile_scope_invalid");
    const adapter = new GoogleAdsAdapter(config);
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
    const customer = await read(queries.customer),
      mcc = await read(queries.customer, target.mcc),
      hierarchy = await read(queries.hierarchy, target.mcc);
    if (
      customer.length !== 1 ||
      String(customer[0]?.customer?.id) !== target.customer ||
      customer[0].customer.testAccount !== true ||
      mcc.length !== 1 ||
      String(mcc[0]?.customer?.id) !== target.mcc ||
      mcc[0].customer.testAccount !== true ||
      hierarchy.length !== 1 ||
      String(hierarchy[0]?.customerClient?.id) !== target.customer ||
      hierarchy[0].customerClient.testAccount !== true ||
      Number(hierarchy[0].customerClient.level) !== 1
    )
      fail("stage234_i_reconcile_test_proof_invalid");
    const after = Object.fromEntries(
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
    const created = assertCreatedAudience(
      preview.provider_state_before,
      after,
      blocked.commit,
    );
    const bid = await read(queries.group);
    if (
      bid.length !== 1 ||
      bid[0]?.adGroup?.resourceName !== target.groupResource ||
      String(bid[0].adGroup.cpcBidMicros) !== "100000" ||
      bid[0].adGroup.status !== "PAUSED"
    )
      fail("stage234_i_reconcile_bid_changed");
    if (
      digest(
        await db.client.mcpPreview.findUnique({
          where: { id: stored.id },
          include: { account: true },
        }),
      ) !== beforeDbHash ||
      digest(
        await db.client.auditEvent.findMany({
          where: { targetId: stored.id, workspaceId: stored.workspaceId },
          orderBy: { createdAt: "asc" },
        }),
      ) !== beforeAuditHash
    )
      fail("stage234_i_reconcile_history_changed");
    const evidence = {
      acceptance_test: "I_READ_ONLY_RECONCILIATION",
      result: "I_ADD_VERIFIED_REMOVE_PENDING",
      source_head: sourceHead,
      harness_head: env.STAGE234_HARNESS_HEAD,
      image_digest: imageDigest,
      preview_id: stored.id,
      commit_id: blocked.commit.commit_id,
      created_audience: created,
      journal,
      audit: events.map((e) => ({
        id: e.id,
        type: e.eventType,
        result: e.metadata?.result ?? null,
        success: e.success,
        timestamp: e.createdAt,
      })),
      provider_state_after_commit: after,
      immutable_digest: stored.snapshotDigest,
      original_failure_preserved: true,
      commit_retried: false,
      history_unchanged: true,
      provider_read_call_count: calls.filter((c) =>
        ["read", "read_mcc"].includes(c.type),
      ).length,
      oauth_refresh_call_count: calls.filter((c) => c.type === "oauth_refresh")
        .length,
      validate_only_call_count: 0,
      real_provider_write_call_count: 0,
      original_commit_call_counts: {
        read: blocked.provider_read_call_count,
        validate_only: 0,
        real_write: 1,
      },
      production_changed: false,
      main_changed: false,
      timestamp: new Date().toISOString(),
    };
    writeFileSync(
      join(root, "i-reconciled-evidence.json"),
      JSON.stringify(evidence, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        result: evidence.result,
        criterion_id: created.criterion_id,
        journal: "VERIFIED",
        read: evidence.provider_read_call_count,
        validate_only: 0,
        real_write: 0,
      }),
    );
  } catch (error) {
    console.log(
      JSON.stringify({
        result: "BLOCKED",
        code: safeError(error),
        read: calls.filter((c) => ["read", "read_mcc"].includes(c.type)).length,
        real_write: 0,
      }),
    );
    process.exitCode = 1;
  } finally {
    if (db) await closeDatabase(db);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await reconcileI();

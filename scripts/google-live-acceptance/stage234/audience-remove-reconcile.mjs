// Reconciles only the already consumed removal. No MCP or mutate transport.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import process from "node:process";
import { classifyIReconcile } from "./audience-reconcile.mjs";
import { removedQuery } from "./audience-remove-commit-guard.mjs";
import {
  assertRemovedAudience,
  assertRemoveJournal,
} from "./audience-remove-commit-runner.mjs";
import {
  canonical,
  digest,
  queries,
  target,
  protectedJson,
  fail,
  READINESS_SNAPSHOT_QUERIES,
} from "./audience-commit-guard.mjs";
import { sourceHead, imageDigest } from "./audience-preview-guard.mjs";
import { safeError } from "./live-guard.mjs";
export async function reconcileRemoval() {
  const env = process.env,
    root = env.STAGE234_RUN_DIR;
  if (
    env.STAGE234_SOURCE_HEAD !== sourceHead ||
    env.STAGE234_IMAGE_DIGEST !== imageDigest ||
    env.V2_CONFIRMED_WRITE_ENABLED !== "false" ||
    env.V2_PREVIEW_ONLY !== "true" ||
    env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST !== target.customer ||
    !/^\/acceptance-state\/stage234-i-remove-reconcile-[A-Za-z0-9_-]+$/.test(
      root ?? "",
    )
  )
    fail("stage234_i_remove_reconcile_runtime_invalid");
  const origin = protectedJson("/i-origin/i-origin.json"),
    original = protectedJson("/i-origin/evidence.json"),
    plan = protectedJson("/i-origin/prepared-i-remove-plan.json"),
    blocked = protectedJson("/i-origin/blocked-evidence.json"),
    result = protectedJson("/i-origin/remove-commit-result.json");
  if (
    blocked.code !== "stage234_i_remove_provider_status_unverified" ||
    blocked.real_provider_write_call_count !== 1 ||
    result.status !== "VERIFIED" ||
    result.preview_id !== original.preview_id ||
    original.source_head !== sourceHead ||
    original.image_digest !== imageDigest
  )
    fail("stage234_i_remove_reconcile_origin_invalid");
  const exactQuery = removedQuery(origin),
    calls = [],
    native = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    let type;
    if (
      url.href ===
        `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:searchStream` &&
      init.method === "POST" &&
      new Headers(init.headers).get("login-customer-id") === target.mcc &&
      canonical(JSON.parse(init.body)) === canonical({ query: exactQuery })
    )
      type = "read";
    else type = classifyIReconcile(input, init);
    calls.push({ type });
    return native(input, { ...init, redirect: "error" });
  };
  let db, closeDatabase;
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
    const config = loadConfig();
    if (
      new URL(config.databaseUrl).hostname !== "postgres" ||
      new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
      new URL(config.redisUrl).hostname !== "redis" ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]'
    )
      fail("stage234_i_remove_reconcile_database_invalid");
    db = database.createDatabase(config.databaseUrl);
    const stored = await db.client.mcpPreview.findUnique({
        where: { id: result.preview_id },
        include: { account: true },
      }),
      account = stored?.account;
    if (
      account?.provider !== "GOOGLE_ADS" ||
      account.externalAccountId !== target.customer ||
      stored.workspaceId !== account.workspaceId ||
      stored.connectionId !== account.connectionId
    )
      fail("stage234_i_remove_reconcile_owner_invalid");
    const events = await db.client.auditEvent.findMany({
        where: { targetId: stored.id, workspaceId: stored.workspaceId },
        orderBy: { createdAt: "asc" },
      }),
      history = digest({ stored, events });
    const journal = assertRemoveJournal({
      stored,
      original: {
        ...stored,
        requestedState: plan,
        beforeState: plan.checks,
        snapshotDigest: digest(plan),
      },
      result,
      events,
    });
    const connection = await db.client.providerConnection.findUnique({
      where: { id: account.connectionId },
      include: { credential: true },
    });
    if (
      connection?.provider !== "GOOGLE_ADS" ||
      connection.workspaceId !== account.workspaceId ||
      !connection.credential
    )
      fail("stage234_i_remove_reconcile_vault_invalid");
    let cred = new CredentialVaultService().decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    const adapter = new GoogleAdsAdapter(config);
    if (!cred.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_i_remove_reconcile_scope_invalid");
    if (cred.expiresAt && Date.parse(cred.expiresAt) <= Date.now() + 60000)
      cred = await adapter.refreshCredentials(cred);
    const read = (q, c = target.customer) =>
      adapter.searchStream(cred.accessToken, c, target.mcc, q);
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
      fail("stage234_i_remove_reconcile_hierarchy_invalid");
    const after = Object.fromEntries(
        await Promise.all(
          Object.entries(READINESS_SNAPSHOT_QUERIES).map(async ([n, q]) => [
            n,
            (await read(q)).sort((a, b) =>
              canonical(a).localeCompare(canonical(b), "en"),
            ),
          ]),
        ),
      ),
      removed = await read(exactQuery);
    const verified = assertRemovedAudience(
        original.provider_state_before,
        after,
        result,
        removed,
        origin,
      ),
      bid = await read(queries.group);
    if (
      bid.length !== 1 ||
      String(bid[0]?.adGroup?.cpcBidMicros) !== "100000" ||
      bid[0].adGroup.status !== "PAUSED"
    )
      fail("stage234_i_remove_reconcile_bid_changed");
    if (
      history !==
      digest({
        stored: await db.client.mcpPreview.findUnique({
          where: { id: stored.id },
          include: { account: true },
        }),
        events: await db.client.auditEvent.findMany({
          where: { targetId: stored.id, workspaceId: stored.workspaceId },
          orderBy: { createdAt: "asc" },
        }),
      })
    )
      fail("stage234_i_remove_reconcile_history_changed");
    const evidence = {
      acceptance_test: "I",
      result: "LIVE_PASS_ADD_AND_REMOVE",
      source_head: sourceHead,
      harness_head: env.STAGE234_HARNESS_HEAD,
      image_digest: imageDigest,
      test_customer_id: target.customer,
      preview_id: stored.id,
      commit_id: result.commit_id,
      origin_add_commit_id: origin.commit_id,
      verified,
      journal,
      provider_state_after: after,
      exact_removed_query_rows: removed,
      audit: events.map((e) => ({
        id: e.id,
        type: e.eventType,
        result: e.metadata?.result ?? null,
        success: e.success,
        timestamp: e.createdAt,
      })),
      history_unchanged: true,
      blocked_artifact_preserved: true,
      mutation_retried: false,
      provider_read_call_count: calls.filter((c) =>
        ["read", "read_mcc"].includes(c.type),
      ).length,
      oauth_refresh_call_count: calls.filter((c) => c.type === "oauth_refresh")
        .length,
      validate_only_call_count: 0,
      real_provider_write_call_count: 0,
      original_commit_counts: {
        read: blocked.provider_read_call_count,
        validate_only: 0,
        real_write: 1,
      },
      production_changed: false,
      main_changed: false,
      timestamp: new Date().toISOString(),
    };
    writeFileSync(
      join(root, "i-remove-reconciled-evidence.json"),
      JSON.stringify(evidence, null, 2),
      { flag: "wx", mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        result: evidence.result,
        criterion_id: verified.criterion_id,
        status: verified.status,
        status_observation: verified.provider_status_observation,
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
  await reconcileRemoval();

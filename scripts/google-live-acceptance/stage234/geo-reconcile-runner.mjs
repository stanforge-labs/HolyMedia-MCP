// Append-only READ reconciliation of the one already dispatched J commit.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import process from "node:process";
import { readAcceptanceContext } from "./context-vault.mjs";
import {
  installJGuard,
  J_QUERIES,
  protectedJson,
  target,
  digest,
  canonical,
  READINESS_SNAPSHOT_QUERIES,
  fail,
} from "./geo-preview-guard.mjs";
import { assertCreatedJ, assertJJournal } from "./geo-commit-runner.mjs";
import { assertScopedIPreviewKey } from "./audience-preview-runner.mjs";
import { queries, sanitized, safeError } from "./live-guard.mjs";
const root = process.env.STAGE234_RUN_DIR;
installJGuard();
// No local MCP, suggest or validate_only can pass this extra READ-only layer.
const guardedFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const u = new URL(input);
  if (!(
    (u.origin === "https://googleads.googleapis.com" &&
      u.pathname.endsWith("/googleAds:searchStream")) ||
    u.href === "https://oauth2.googleapis.com/token"
  ))
    fail("stage234_j_reconcile_nonread_blocked");
  return guardedFetch(input, init);
};
const save = (n, v) =>
  writeFileSync(join(root, n), JSON.stringify(v, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
let db, closeDatabase;
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
  const config = loadConfig(),
    context = await readAcceptanceContext(
      join(root, "protected-preview-context.json"),
    ),
    plan = protectedJson(join(root, "prepared-j-plan.json")),
    previewEvidence = protectedJson(join(root, "evidence.json")),
    result = protectedJson(join(root, "j-commit-result.json"));
  if (
    new URL(config.databaseUrl).hostname !== "postgres" ||
    new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
    canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]'
  )
    fail("stage234_j_reconcile_scope_invalid");
  db = database.createDatabase(config.databaseUrl);
  const stored = await db.client.mcpPreview.findUnique({
      where: { id: context.preview.preview_id },
      include: { account: true },
    }),
    account = stored.account,
    key = await db.client.serviceToken.findUnique({
      where: { tokenDigest: digest(context.service_token) },
      include: { serviceIdentity: true },
    });
  assertScopedIPreviewKey({ context, key, account });
  if (
    stored.id !== previewEvidence.preview_id ||
    stored.id !== result.preview_id ||
    stored.commitStatus !== "VERIFIED" ||
    !stored.consumedAt ||
    stored.snapshotDigest !== digest(plan) ||
    canonical(stored.requestedState) !== canonical(plan) ||
    canonical(stored.beforeState) !== canonical(plan.checks) ||
    stored.approvedByUserId !== key.serviceIdentity.createdById
  )
    fail("stage234_j_reconcile_commit_binding_invalid");
  const events = await db.client.auditEvent.findMany({
      where: { targetId: stored.id, workspaceId: stored.workspaceId },
      orderBy: { createdAt: "asc" },
    }),
    journal = assertJJournal({
      stored,
      original: {
        snapshotDigest: digest(plan),
        requestedState: plan,
        beforeState: plan.checks,
      },
      result,
      events,
    });
  const frozen = digest(stored),
    auditHash = digest(events);
  const connection = await db.client.providerConnection.findUnique({
    where: { id: account.connectionId },
    include: { credential: true },
  });
  if (
    connection.provider !== "GOOGLE_ADS" ||
    connection.workspaceId !== account.workspaceId ||
    !connection.credential
  )
    fail("stage234_j_reconcile_connection_invalid");
  const adapter = new GoogleAdsAdapter(config);
  let credentials = new CredentialVaultService().decrypt(
    connection.credential.encryptedPayload,
    connection.credential.encryptionVersion,
  );
  if (
    credentials.expiresAt &&
    Date.parse(credentials.expiresAt) <= Date.now() + 60000
  )
    credentials = await adapter.refreshCredentials(credentials);
  const beforeCalls = readFileSync(join(root, "calls.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean).length;
  const read = (q, c = target.customer) =>
    adapter.searchStream(credentials.accessToken, c, target.mcc, q);
  const customer = await read(queries.customer),
    mcc = await read(queries.customer, target.mcc),
    hierarchy = await read(queries.hierarchy, target.mcc);
  if (
    customer.length !== 1 ||
    customer[0].customer.testAccount !== true ||
    String(customer[0].customer.id) !== target.customer ||
    mcc.length !== 1 ||
    mcc[0].customer.testAccount !== true ||
    String(mcc[0].customer.id) !== target.mcc ||
    hierarchy.length !== 1 ||
    hierarchy[0].customerClient.testAccount !== true ||
    String(hierarchy[0].customerClient.id) !== target.customer ||
    Number(hierarchy[0].customerClient.level) !== 1
  )
    fail("stage234_j_reconcile_test_hierarchy_invalid");
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
    bid = await read(queries.group),
    locations = await read(J_QUERIES.locations),
    proximity = await read(J_QUERIES.proximity);
  if (
    bid.length !== 1 ||
    String(bid[0].adGroup.cpcBidMicros) !== "100000" ||
    bid[0].adGroup.status !== "PAUSED"
  )
    fail("stage234_j_reconcile_bid_invalid");
  const created = assertCreatedJ(
    previewEvidence.provider_state_before,
    after,
    result,
    locations,
    proximity,
    plan,
  );
  if (
    digest(
      await db.client.mcpPreview.findUnique({
        where: { id: stored.id },
        include: { account: true },
      }),
    ) !== frozen ||
    digest(
      await db.client.auditEvent.findMany({
        where: { targetId: stored.id, workspaceId: stored.workspaceId },
        orderBy: { createdAt: "asc" },
      }),
    ) !== auditHash
  )
    fail("stage234_j_reconcile_history_changed");
  const rows = readFileSync(join(root, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse)
      .slice(beforeCalls),
    counts = {
      provider_read_call_count: rows.filter((c) =>
        ["read", "read_mcc"].includes(c.type),
      ).length,
      validate_only_call_count: 0,
      real_provider_write_call_count: 0,
    };
  const report = {
    acceptance_test: "J_RECONCILIATION",
    result: "J add VERIFIED; restoration pending",
    harness_head: process.env.STAGE234_HARNESS_HEAD,
    source_head: process.env.STAGE234_SOURCE_HEAD,
    image_digest: process.env.STAGE234_IMAGE_DIGEST,
    test_customer_id: target.customer,
    preview_id: stored.id,
    commit_id: result.commit_id,
    created_criteria: created,
    provider_state_before: previewEvidence.provider_state_before,
    provider_state_after: after,
    commit: sanitized(result),
    journal,
    audit: events.map((e) => ({
      id: e.id,
      type: e.eventType,
      success: e.success,
      result: e.metadata?.result ?? null,
      timestamp: e.createdAt,
    })),
    harness_failure:
      "Original post-write harness expected null adGroupId; stock campaign-level journal uses exact empty string. No commit retried, audit rewritten or provider data compensated.",
    original_blocked_evidence_preserved: true,
    ...counts,
    production_changed: false,
    main_changed: false,
    timestamp: new Date().toISOString(),
  };
  save("j-reconciled-evidence.json", report);
  console.log(
    JSON.stringify({
      result: report.result,
      created_criteria: created,
      journal,
      ...counts,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      result: "BLOCKED",
      code: safeError(error),
      real_provider_write_call_count: 0,
    }),
  );
  process.exitCode = 1;
} finally {
  if (db) await closeDatabase(db);
}

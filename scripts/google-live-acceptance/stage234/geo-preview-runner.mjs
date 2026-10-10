// J stock MCP preview only. Prepare, ready and verify recovery contract before TTL.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import process from "node:process";
import {
  readAcceptanceContext,
  sealAcceptanceContext,
} from "./context-vault.mjs";
import { assertScopedIPreviewKey } from "./audience-preview-runner.mjs";
import { queries, originalKeywords, safeError } from "./live-guard.mjs";
import { waitLocalReady } from "./wait-local-ready.mjs";
import { startupDiagnostics } from "./startup-diagnostics.mjs";
import {
  J_TOOL,
  assertJGeos,
  geoQuery,
  assertPreparedJ,
  installJGuard,
  protectedJson,
  target,
  canonical,
  digest,
  fail,
  READINESS_SNAPSHOT_QUERIES,
} from "./geo-preview-guard.mjs";
export function assertJFixture(snapshot, origin) {
  if (
    origin?.result !== "LIVE_PASS_ADD_AND_REMOVE" ||
    origin.verified?.status !== "REMOVED" ||
    origin.verified.residual_audience_mode !== "OBSERVATION" ||
    origin.journal?.result !== "VERIFIED" ||
    canonical(snapshot) !== canonical(origin.provider_state_after)
  )
    fail("stage234_j_fixture_changed_since_verified_i");
  if (
    snapshot.deliveryCampaigns?.length !== 2 ||
    snapshot.deliveryCampaigns.some((r) => r.campaign?.status !== "PAUSED") ||
    snapshot.deliveryGroups?.length !== 3 ||
    snapshot.deliveryGroups.some((r) => r.adGroup?.status !== "PAUSED") ||
    snapshot.deliveryAds?.length !== 4 ||
    snapshot.deliveryAds.some((r) => r.adGroupAd?.status !== "PAUSED") ||
    snapshot.attachments?.length !== 0
  )
    fail("stage234_j_delivery_or_attachment_changed");
  const originals = snapshot.keywords?.filter((r) =>
    originalKeywords.includes(r.adGroupCriterion?.criterionId),
  );
  if (
    originals?.length !== 20 ||
    originals.some((r) => r.adGroupCriterion.status !== "ENABLED") ||
    snapshot.keywords.length !== 21 ||
    snapshot.keywords.find((r) => r.adGroupCriterion.criterionId === "11479221")
      ?.adGroupCriterion.status !== "PAUSED"
  )
    fail("stage234_j_keyword_fixture_changed");
}
export function safeJError(error) {
  // Exact local product codes only, never Google bodies, OAuth or arbitrary text.
  const code = error?.writeCode;
  return [
    "google_stage3_duplicate",
    "google_stage3_geo_ambiguous",
    "google_stage3_geo_invalid",
    "google_stage3_geo_limit",
  ].includes(code)
    ? code
    : safeError(error);
}
export async function runJPreview() {
  installJGuard();
  const env = process.env,
    root = env.STAGE234_RUN_DIR;
  const save = (name, value) =>
    writeFileSync(join(root, name), JSON.stringify(value, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  const counts = () => {
    let calls = [];
    try {
      calls = readFileSync(join(root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {
      /* Before first provider call. */
    }
    return {
      provider_read_call_count: calls.filter((c) =>
        ["read", "read_mcc", "read_geo_service"].includes(c.type),
      ).length,
      geo_service_read_call_count: calls.filter(
        (c) => c.type === "read_geo_service",
      ).length,
      validate_only_call_count: calls.filter((c) => c.type === "validate_only")
        .length,
      oauth_refresh_call_count: calls.filter((c) => c.type === "oauth_refresh")
        .length,
      real_provider_write_call_count: 0,
    };
  };
  let db,
    closeDatabase,
    server,
    gateway,
    startup,
    stage = "runtime_auth",
    preview;
  try {
    const raw = readFileSync(join(root, "i-remove-origin.json"), "utf8");
    protectedJson(join(root, "i-remove-origin.json"));
    if (
      digest(raw) !==
      "33a5304a8c1e87caa0c0921ea359b80b6e333cbf7c16c79f3d52475b0d7cfc97"
    )
      fail("stage234_j_origin_hash_invalid");
    const origin = JSON.parse(raw);
    createRequire("/workspace/apps/api/package.json")("reflect-metadata");
    const context = await readAcceptanceContext(
      join(root, "fixture-context.json"),
    );
    const { loadConfig } =
      await import("/workspace/packages/config/dist/index.js");
    const database = await import("/workspace/packages/database/dist/index.js");
    closeDatabase = database.closeDatabase;
    const { CredentialVaultService } =
      await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
    const { GoogleAdsAdapter } =
      await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
    const { stage3ToolIntent, stage3ToolSchema } =
      await import("/workspace/apps/api/dist/mcp/mcp-google-stage3-schema.js");
    const config = loadConfig();
    if (
      new URL(config.databaseUrl).hostname !== "postgres" ||
      new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
      new URL(config.redisUrl).hostname !== "redis" ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]' ||
      !config.previewOnly ||
      config.confirmedWriteEnabled
    )
      fail("stage234_j_config_invalid");
    db = database.createDatabase(config.databaseUrl);
    const baseline = await db.client.mcpPreview.findUnique({
        where: { id: context.preview.preview_id },
        include: { account: true },
      }),
      account = baseline?.account;
    if (
      baseline?.id !== origin.preview_id ||
      baseline.commitStatus !== "VERIFIED" ||
      !baseline.consumedAt
    )
      fail("stage234_j_origin_commit_not_verified");
    const key = await db.client.serviceToken.findUnique({
      where: { tokenDigest: digest(context.service_token) },
      include: { serviceIdentity: true },
    });
    assertScopedIPreviewKey({ context, key, account });
    if (key.serviceIdentity.createdById !== baseline.approvedByUserId)
      fail("stage234_j_key_owner_invalid");
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
      fail("stage234_j_foreign_enabled_account");
    const pending = () =>
      db.client.mcpPreview.count({
        where: {
          workspaceId: account.workspaceId,
          provider: "GOOGLE_ADS",
          consumedAt: null,
          cancelledAt: null,
          expiresAt: { gt: new Date() },
        },
      });
    if ((await pending()) !== 0) fail("stage234_j_pending_preview_exists");
    const baselineHash = digest(baseline),
      auditQuery = { where: { targetId: baseline.id }, orderBy: { id: "asc" } },
      auditHash = digest(await db.client.auditEvent.findMany(auditQuery));
    const connection = await db.client.providerConnection.findUnique({
      where: { id: account.connectionId },
      include: { credential: true },
    });
    if (
      !connection?.credential ||
      connection.workspaceId !== account.workspaceId ||
      connection.provider !== "GOOGLE_ADS"
    )
      fail("stage234_j_credential_owner_invalid");
    const vault = new CredentialVaultService(),
      adapter = new GoogleAdsAdapter(config);
    let credentials = vault.decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_j_oauth_scope_invalid");
    if (
      credentials.expiresAt &&
      Date.parse(credentials.expiresAt) <= Date.now() + 60000
    )
      credentials = await adapter.refreshCredentials(credentials);
    const read = (query, id = target.customer) =>
      adapter.searchStream(credentials.accessToken, id, target.mcc, query);
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
    stage = "test_hierarchy_geo_and_fixture";
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
      fail("stage234_j_test_hierarchy_invalid");
    const geos = {};
    for (const id of ["9235214", "9196209", "2398", "9070290"]) {
      const rows = await read(geoQuery(id, true));
      if (rows.length !== 1) fail("stage234_j_geo_constant_not_unique");
      geos[id] = rows[0].geoTargetConstant;
    }
    assertJGeos(geos);
    save("geo-proof.json", geos);
    const before = await snapshot();
    assertJFixture(before, origin);
    const bid = await read(queries.group);
    if (
      bid.length !== 1 ||
      bid[0].adGroup.status !== "PAUSED" ||
      String(bid[0].adGroup.cpcBidMicros) !== "100000"
    )
      fail("stage234_j_group_bid_changed");
    stage = "prepare_exact_stock_plan_before_ttl";
    const plan = await adapter.extended(
      { accountId: target.customer, loginCustomerId: target.mcc, credentials },
      3,
      "build",
      stage3ToolIntent(J_TOOL.name, J_TOOL.arguments),
    );
    const validation = assertPreparedJ(plan);
    save("prepared-j-plan.json", plan);
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
    // Future recovery is the stock criterion_remove profile for actual created
    // IDs only; never guessed IDs or an automatic inverse of irreversible create.
    const recoverySchema = stage3ToolSchema("google_ads_targeting_preview");
    const recoveryBranch = recoverySchema.properties?.items?.items?.oneOf?.find(
      (branch) => branch.properties?.operation?.const === "criterion_remove",
    );
    if (
      !recoveryBranch?.properties?.criterion_type?.enum?.includes("LOCATION") ||
      !recoveryBranch.properties.criterion_type.enum.includes("PROXIMITY") ||
      recoveryBranch.properties.acknowledge_irreversible?.const !== true
    )
      fail("stage234_j_recovery_contract_invalid");
    if (env.STAGE234_J_PREPARE_ONLY === "true") {
      const ready = {
        result: "J_EXACT_STOCK_PREPARATION_PASS_NO_PREVIEW",
        source_head: env.STAGE234_SOURCE_HEAD,
        harness_head: env.STAGE234_HARNESS_HEAD,
        geo_proof: geos,
        fixture_sha256: digest(before),
        exact_validate_only_payload: validation,
        planned_operations: 2,
        existing_city_preserved: true,
        ...counts(),
        preview_created: false,
        committed: false,
        production_changed: false,
        main_changed: false,
        timestamp: new Date().toISOString(),
      };
      save("prepared-readiness.json", ready);
      console.log(
        JSON.stringify({
          result: ready.result,
          planned_operations: 2,
          ...counts(),
        }),
      );
      await closeDatabase(db);
      db = undefined;
      return;
    }
    stage = "stock_api_ready";
    server = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "--import",
        "/stage234/geo-preview-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...env, STAGE234_J_GUARD_PRELOAD: "1", LOG_LEVEL: "error" },
      },
    );
    startup = startupDiagnostics(server);
    if (
      !(await waitLocalReady({
        fetch: (...args) => globalThis.fetch(...args),
        server,
      }))
    )
      fail("stage234_j_stock_api_not_ready");
    gateway = spawn(process.execPath, ["/stage234/rsa-approval-gateway.mjs"], {
      cwd: "/workspace",
      stdio: "ignore",
      env: { ...env, LOG_LEVEL: "error" },
    });
    let gatewayReady = false;
    for (let i = 0; i < 12; i++) {
      if (gateway.exitCode !== null) fail("stage234_j_gateway_start_failed");
      try {
        if (
          (
            await globalThis.fetch("http://127.0.0.1:4001/ready", {
              signal: AbortSignal.timeout(1000),
            })
          ).ok
        ) {
          gatewayReady = true;
          break;
        }
      } catch {
        /* bounded local health only */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!gatewayReady) fail("stage234_j_gateway_not_ready");
    const session = await globalThis.fetch(
      "http://127.0.0.1:4001/acceptance/session",
      {
        method: "POST",
        headers: {
          origin: "http://localhost:4403",
          "content-type": "application/json",
        },
        body: "{}",
      },
    );
    if (
      !session.ok ||
      typeof (await session.json()).csrfToken !== "string" ||
      session.headers.getSetCookie().some((c) => /;\s*domain=/i.test(c))
    )
      fail("stage234_j_human_session_not_ready");
    // All tests/preparation happen before launch. Recheck auth, actual fixture
    // and the administrative chain immediately before creating the one preview.
    assertScopedIPreviewKey({
      context,
      key: await db.client.serviceToken.findUnique({
        where: { id: key.id },
        include: { serviceIdentity: true },
      }),
      account,
    });
    if ((await pending()) !== 0) fail("stage234_j_pending_preview_exists");
    if (canonical(before) !== canonical(await snapshot()))
      fail("stage234_j_fixture_changed_before_preview");
    for (const id of ["9235214", "9196209", "2398", "9070290"]) {
      const rows = await read(geoQuery(id, true));
      if (
        rows.length !== 1 ||
        canonical(rows[0].geoTargetConstant) !== canonical(geos[id])
      )
        fail("stage234_j_geo_parent_changed_before_preview");
    }
    stage = "J_JIT_PREVIEW";
    const response = await globalThis.fetch("http://127.0.0.1:4000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${context.service_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "stage234-J-preview",
        method: "tools/call",
        params: J_TOOL,
      }),
      signal: AbortSignal.timeout(60000),
    });
    const rpc = await response.json();
    if (!response.ok || rpc.error || rpc.result?.isError)
      fail("stage234_j_stock_preview_rejected");
    preview =
      rpc.result?.structuredContent ??
      JSON.parse(rpc.result?.content?.[0]?.text ?? "null");
    if (
      preview?.status !== "preview" ||
      preview.provider !== "GOOGLE_ADS" ||
      preview.account_id !== target.customer ||
      preview.provider_validation !== "passed" ||
      preview.operation_count !== 2 ||
      preview.partial_failure !== true ||
      preview.atomic !== false ||
      preview.irreversible !== false ||
      preview.items?.length !== 2 ||
      preview.items.some(
        (item, i) =>
          canonical(item.before) !== canonical(plan.items[i].before) ||
          canonical(item.after) !== canonical(plan.items[i].after),
      ) ||
      Date.parse(preview.expires_at) <= Date.now() + 60000 ||
      !/^http:\/\/localhost:4403\/mcp\/approve#[A-Za-z0-9_-]+$/.test(
        preview.approval_url ?? "",
      )
    )
      fail("stage234_j_preview_semantics_invalid");
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
      stored.commitStatus !== "PREVIEWED" ||
      canonical(stored.requestedState) !== canonical(plan) ||
      stored.snapshotDigest !== digest(plan)
    )
      fail("stage234_j_persisted_preview_invalid");
    const events = await db.client.auditEvent.findMany({
      where: { targetId: stored.id },
      select: { id: true, eventType: true, createdAt: true, success: true },
    });
    if (
      !events.some(
        (e) => e.eventType === "mcp_google_stage1_preview_created" && e.success,
      )
    )
      fail("stage234_j_preview_audit_missing");
    stage = "after_preview_unchanged";
    const after = await snapshot();
    if (
      canonical(before) !== canonical(after) ||
      canonical(bid) !== canonical(await read(queries.group))
    )
      fail("stage234_j_provider_changed_after_preview");
    if (
      digest(
        await db.client.mcpPreview.findUnique({
          where: { id: baseline.id },
          include: { account: true },
        }),
      ) !== baselineHash ||
      digest(await db.client.auditEvent.findMany(auditQuery)) !== auditHash
    )
      fail("stage234_j_historical_evidence_changed");
    const accounting = counts(),
      checked = protectedJson(join(root, "validation.json"));
    if (
      accounting.validate_only_call_count !== 1 ||
      checked.http_status !== 200 ||
      checked.operation_count !== 2
    )
      fail("stage234_j_validation_not_proved");
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
    save("evidence.json", {
      acceptance_test: "J_PREVIEW_ONLY",
      result: "PREVIEW_PASS_MANUAL_APPROVAL_PENDING",
      source_head: env.STAGE234_SOURCE_HEAD,
      harness_head: env.STAGE234_HARNESS_HEAD,
      image_digest: env.STAGE234_IMAGE_DIGEST,
      test_customer_id: target.customer,
      campaign_id: target.campaign,
      key_id: key.id,
      key_expires_at: key.expiresAt,
      semantic_payload: J_TOOL,
      existing_city: {
        geo_target_id: "9235214",
        resource_name:
          "customers/8590146099/campaignCriteria/24324170853~9235214",
        status: "ENABLED",
        negative: false,
        disposition: "already included; preserved without mutation",
        original_city_add_live_acceptance: "NOT_REPLAYED; HISTORICAL_FIXTURE",
      },
      geo_proof: geos,
      coordinate_source: "EXPLICIT_USER_TEST_INPUT_PARK_FIRST_PRESIDENT",
      exact_validate_only_payload: validation,
      provider_state_before: before,
      provider_state_after_preview: after,
      before_after_unchanged: true,
      preview_id: preview.preview_id,
      preview_expires_at: preview.expires_at,
      preview_items: preview.items,
      provider_validation: "passed",
      operation_count: 2,
      partial_failure: true,
      atomic: false,
      irreversible: false,
      ...accounting,
      manual_approval_required: true,
      approval_performed_by_harness: false,
      committed: false,
      persisted_preview_immutable: true,
      history_unchanged: true,
      recovery:
        "New approved criterion_remove preview for actual new IDs only; full original inventory verified unchanged afterward. No recovery operations executed or fabricated IDs used as provider inputs.",
      startup: startup(),
      production_changed: false,
      main_changed: false,
      timestamp: new Date().toISOString(),
    });
    console.log(
      JSON.stringify({
        result: "PREVIEW_PASS_MANUAL_APPROVAL_PENDING",
        preview_id: preview.preview_id,
        expires_at: preview.expires_at,
        approval_url: preview.approval_url,
        ...accounting,
      }),
    );
    await closeDatabase(db);
    db = undefined;
    if (env.STAGE234_KEEP_API_ALIVE !== "true") {
      server.kill("SIGTERM");
      gateway.kill("SIGTERM");
    }
  } catch (error) {
    const blocked = {
      result: "BLOCKED",
      failure_stage: stage,
      code: safeJError(error),
      preview_id: preview?.preview_id ?? null,
      ...counts(),
      startup: startup?.() ?? null,
      production_changed: false,
      main_changed: false,
      timestamp: new Date().toISOString(),
    };
    try {
      save("blocked-evidence.json", blocked);
    } catch {
      /* preserve prior evidence */
    }
    console.log(JSON.stringify(blocked));
    process.exitCode = 1;
    server?.kill("SIGTERM");
    gateway?.kill("SIGTERM");
  } finally {
    if (db) await closeDatabase(db);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runJPreview();

// N preparation through the unmodified exact-image private HTTP MCP only.
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import {
  target,
  originalKeywords,
  queries,
  toolArguments,
  invalidRsaArguments,
  validationPayload,
  canonical,
  digest,
  sanitized,
  safeError,
  installLiveGuard,
} from "./live-guard.mjs";

const fail = (code) => {
  throw new Error(code);
};
export function assertInvalidRsaResult(rpc) {
  let error;
  try {
    error = JSON.parse(rpc?.result?.content?.[0]?.text ?? "null");
  } catch {
    fail("stage234_invalid_rsa_response_not_structured");
  }
  if (
    rpc?.error ||
    rpc?.result?.isError !== true ||
    error?.code !== "google_brief_invalid" ||
    error?.source !== "HOLYMEDIA" ||
    error?.provider !== "GOOGLE_ADS" ||
    error?.field_path !== "brief.items[0].rsa.headlines[0].text" ||
    error?.google_errors?.length !== 0
  )
    fail("stage234_invalid_rsa_wrong_rejection");
  return {
    code: error.code,
    source: error.source,
    field_path: error.field_path,
  };
}
export function assertFixture(snapshot) {
  const campaign = snapshot.campaign?.[0]?.campaign,
    group = snapshot.group?.[0]?.adGroup,
    budget = snapshot.budget?.[0]?.campaignBudget,
    ads = snapshot.rsa ?? [],
    keywords = snapshot.keywords ?? [];
  if (
    snapshot.campaign?.length !== 1 ||
    String(campaign?.id) !== target.campaign ||
    campaign?.resourceName !==
      `customers/${target.customer}/campaigns/${target.campaign}` ||
    campaign.status !== "PAUSED" ||
    campaign.name !== "HM_MCP_WRITE_ACCEPTANCE_20261007T134837Z" ||
    campaign.campaignBudget !==
      `customers/${target.customer}/campaignBudgets/${target.budget}` ||
    campaign.biddingStrategyType !== "MANUAL_CPC" ||
    campaign.biddingStrategy
  )
    fail("stage234_fixture_campaign_changed");
  if (
    snapshot.group?.length !== 1 ||
    String(snapshot.group[0]?.campaign?.id) !== target.campaign ||
    group?.resourceName !== target.groupResource ||
    String(group.id) !== target.group ||
    group.status !== "PAUSED" ||
    String(group.cpcBidMicros) !== "100000"
  )
    fail("stage234_fixture_group_changed");
  if (
    snapshot.budget?.length !== 1 ||
    budget?.resourceName !== campaign.campaignBudget ||
    String(budget.amountMicros) !== "2000000" ||
    budget.explicitlyShared === true
  )
    fail("stage234_fixture_budget_changed");
  if (
    ads.length !== 1 ||
    ads[0]?.adGroupAd?.resourceName !==
      `customers/${target.customer}/adGroupAds/${target.group}~${target.rsa}` ||
    ads[0].adGroupAd.status !== "PAUSED" ||
    ads[0].adGroupAd.ad?.type !== "RESPONSIVE_SEARCH_AD" ||
    String(ads[0].campaign?.id) !== target.campaign ||
    String(ads[0].adGroup?.id) !== target.group
  )
    fail("stage234_fixture_rsa_changed");
  const actual = keywords.map((r) => r.adGroupCriterion?.resourceName);
  const expected = [...originalKeywords, "11479221"].map(
    (id) =>
      `customers/${target.customer}/adGroupCriteria/${target.group}~${id}`,
  );
  if (
    keywords.length !== expected.length ||
    new Set(actual).size !== expected.length ||
    expected.some((r) => !actual.includes(r)) ||
    keywords.some(
      (r) =>
        String(r.campaign?.id) !== target.campaign ||
        String(r.adGroup?.id) !== target.group ||
        r.adGroupCriterion?.type !== "KEYWORD" ||
        r.adGroupCriterion?.negative === true ||
        r.adGroupCriterion.status !==
          (String(r.adGroupCriterion.criterionId) === "11479221"
            ? "PAUSED"
            : "ENABLED"),
    )
  )
    fail("stage234_fixture_keywords_changed");
  const criteria = snapshot.criteria ?? [];
  if (
    criteria.length !== 2 ||
    criteria.some(
      (r) =>
        r.campaignCriterion?.negative === true ||
        r.campaignCriterion?.status === "REMOVED",
    ) ||
    !criteria.some(
      (r) =>
        r.campaignCriterion?.location?.geoTargetConstant ===
        "geoTargetConstants/9235214",
    ) ||
    !criteria.some(
      (r) =>
        r.campaignCriterion?.language?.languageConstant ===
        "languageConstants/1031",
    )
  )
    fail("stage234_fixture_targeting_changed");
}
export function assertPreview(preview) {
  const item = preview?.items?.[0],
    before = item?.before,
    after = item?.after;
  if (
    preview?.status !== "preview" ||
    preview.provider !== "GOOGLE_ADS" ||
    preview.account_id !== target.customer ||
    preview.operation_count !== 1 ||
    preview.provider_validation !== "passed" ||
    preview.items?.length !== 1 ||
    item.campaign_id !== target.campaign ||
    item.ad_group_id !== target.group ||
    before?.resourceName !== target.groupResource ||
    after?.resourceName !== target.groupResource ||
    String(before.cpcBidMicros) !== "100000" ||
    String(after.cpcBidMicros) !== "110000" ||
    canonical({ ...before, cpcBidMicros: "110000" }) !== canonical(after) ||
    !/^[a-f0-9-]{36}$/.test(preview.preview_id ?? "") ||
    Date.parse(preview.expires_at) <= Date.now()
  )
    fail("stage234_preview_semantics_invalid");
}
export function makeCheckpoint({
  preview,
  before,
  after,
  events,
  sourceHead,
  imageDigest,
  result = "PREVIEW_PASS_NOT_COMMITTED",
}) {
  return sanitized({
    acceptance_test: "N_PREVIEW_ONLY",
    source_head: sourceHead,
    image_digest: imageDigest,
    test_customer_id: target.customer,
    mcc_id: target.mcc,
    campaign_id: target.campaign,
    ad_group_id: target.group,
    semantic_payload: toolArguments,
    exact_validate_only_payload: validationPayload,
    provider_state_before: before,
    expected_after: { ...before.group[0].adGroup, cpcBidMicros: "110000" },
    provider_state_after_preview: after,
    before_after_unchanged: canonical(before) === canonical(after),
    preview_id: preview.preview_id,
    preview_expires_at: preview.expires_at,
    provider_validation: preview.provider_validation,
    operation_count: preview.operation_count,
    provider_read_call_count: events.filter((e) =>
      ["read", "read_mcc"].includes(e.type),
    ).length,
    validate_only_call_count: events.filter((e) => e.type === "validate_only")
      .length,
    oauth_refresh_call_count: events.filter((e) => e.type === "oauth_refresh")
      .length,
    real_provider_write_call_count: 0,
    semantic_write_operations: [],
    approval_performed_by_harness: false,
    committed: false,
    production_changed: false,
    main_changed: false,
    result,
    timestamp: new Date().toISOString(),
    next_action:
      "Review preview; separate human approval and separate explicit write authorization are required. Harness cannot commit.",
  });
}

export async function runLivePreview() {
  installLiveGuard();
  const env = process.env,
    root = env.STAGE234_RUN_DIR;
  const save = (name, value) =>
    writeFileSync(join(root, name), JSON.stringify(value, null, 2), {
      flag: "wx",
      mode: 0o600,
    });
  let db,
    server,
    gateway,
    stage = "runtime_preflight",
    evidence,
    preview;
  try {
    if ((statSync(root).mode & 0o077) !== 0)
      fail("stage234_state_directory_permissions_invalid");
    const contextFile = join(root, "fixture-context.json");
    if ((statSync(contextFile).mode & 0o077) !== 0)
      fail("stage234_protected_context_permissions_invalid");
    const context = JSON.parse(readFileSync(contextFile, "utf8"));
    createRequire("/workspace/apps/api/package.json")("reflect-metadata");
    const { loadConfig } =
      await import("/workspace/packages/config/dist/index.js");
    const { createDatabase, closeDatabase } =
      await import("/workspace/packages/database/dist/index.js");
    const { CredentialVaultService } =
      await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
    const { GoogleAdsAdapter } =
      await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
    const config = loadConfig(),
      dbUrl = new URL(config.databaseUrl),
      redisUrl = new URL(config.redisUrl);
    if (
      dbUrl.hostname !== "postgres" ||
      dbUrl.pathname !== "/google_acceptance" ||
      redisUrl.hostname !== "redis" ||
      config.providerGoogleApiVersion !== "v24" ||
      config.providerGoogleLoginCustomerId !== target.mcc ||
      canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]'
    )
      fail("stage234_acceptance_database_or_config_invalid");
    db = createDatabase(config.databaseUrl);
    const baseline = await db.client.mcpPreview.findUnique({
      where: { id: context.preview?.preview_id },
      include: { account: true },
    });
    const account = baseline?.account;
    const key = await db.client.serviceToken.findUnique({
      where: { tokenDigest: digest(context.service_token ?? "") },
      include: { serviceIdentity: true },
    });
    if (
      !account ||
      account.provider !== "GOOGLE_ADS" ||
      account.externalAccountId !== target.customer ||
      !account.enabled ||
      !key ||
      key.revokedAt ||
      (key.expiresAt && key.expiresAt <= new Date()) ||
      key.serviceIdentity.workspaceId !== account.workspaceId ||
      key.resourceAccessMode !== "STATIC_ALLOWLIST" ||
      canonical(key.accountIds) !== canonical([account.id]) ||
      !Array.isArray(key.scopes) ||
      !["adforge:mcp:read", "adforge:mcp:write"].every((scope) =>
        key.scopes.includes(scope),
      )
    )
      fail("stage234_owned_account_or_scoped_key_invalid");
    const enabled = await db.client.providerAccount.findMany({
      where: {
        workspaceId: account.workspaceId,
        provider: "GOOGLE_ADS",
        enabled: true,
      },
      select: { externalAccountId: true },
    });
    if (
      enabled.length !== 1 ||
      enabled[0].externalAccountId !== target.customer
    )
      fail("stage234_foreign_enabled_account_invalid");
    const historicalHash = digest({ ...baseline, account: undefined }),
      historicalAudit = await db.client.auditEvent.findMany({
        where: { targetId: baseline.id },
        orderBy: { id: "asc" },
      }),
      auditHash = digest(historicalAudit);
    const connection = await db.client.providerConnection.findUnique({
      where: { id: account.connectionId },
      include: { credential: true },
    });
    if (
      !connection?.credential ||
      connection.provider !== "GOOGLE_ADS" ||
      connection.workspaceId !== account.workspaceId
    )
      fail("stage234_disposable_credential_missing");
    const vault = new CredentialVaultService(),
      adapter = new GoogleAdsAdapter(config);
    let credentials = vault.decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
      fail("stage234_adwords_scope_missing");
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
    stage = "fresh_customer_hierarchy_proof";
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
      Number(hierarchy[0].customerClient.level) !== 1 ||
      hierarchy[0].customerClient.testAccount !== true
    )
      fail("stage234_customer_or_hierarchy_unproven");
    const snapshot = async () =>
      Object.fromEntries(
        await Promise.all(
          ["campaign", "group", "keywords", "rsa", "budget", "criteria"].map(
            async (name) => [
              name,
              (await read(queries[name])).sort((a, b) =>
                canonical(a).localeCompare(canonical(b)),
              ),
            ],
          ),
        ),
      );
    stage = "fixture_before";
    const before = await snapshot();
    assertFixture(before);
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
    stage = "stock_private_http_mcp";
    server = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "--import",
        "/stage234/live-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: "ignore",
        env: { ...env, STAGE234_GUARD_PRELOAD: "1", LOG_LEVEL: "error" },
      },
    );
    let ready = false;
    for (let attempt = 0; attempt < 35; attempt++) {
      if (server.exitCode !== null)
        fail("stage234_exact_source_api_start_failed");
      try {
        if (
          (
            await fetch("http://127.0.0.1:4000/ready", {
              signal: AbortSignal.timeout(1000),
            })
          ).status === 200
        ) {
          ready = true;
          break;
        }
      } catch {
        /* Bounded health wait; never retry provider preview/mutation. */
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ready) fail("stage234_exact_source_api_not_ready");
    let approvalReady = false;
    if (env.STAGE234_APPROVAL_GATEWAY === "true") {
      gateway = spawn(process.execPath, ["/stage234/approval-gateway.mjs"], {
        cwd: "/workspace",
        stdio: "ignore",
        env: { ...env, LOG_LEVEL: "error" },
      });
      for (let attempt = 0; attempt < 10; attempt++) {
        if (gateway.exitCode !== null)
          fail("stage234_stock_approval_gateway_start_failed");
        try {
          if (
            (
              await fetch("http://127.0.0.1:4001/ready", {
                signal: AbortSignal.timeout(1000),
              })
            ).status === 200
          ) {
            approvalReady = true;
            break;
          }
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!approvalReady) fail("stage234_stock_approval_gateway_not_ready");
      // Only local TEST identity bootstrap, never an approval POST. Verify the
      // human UI can obtain its own session before starting the preview TTL.
      const sessionCheck = await fetch(
        "http://127.0.0.1:4001/acceptance/session",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:4402",
            "content-type": "application/json",
          },
          body: "{}",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (
        !sessionCheck.ok ||
        typeof (await sessionCheck.json()).csrfToken !== "string"
      )
        fail("stage234_human_session_bootstrap_not_ready");
    }
    // K uses the stock MCP schema rejection before the Stage 4 gate/provider.
    // No provider read/validate/mutation and no preview may be created by K.
    stage = "K_invalid_rsa";
    const readCalls = () => {
      try {
        return readFileSync(join(root, "calls.jsonl"), "utf8");
      } catch {
        return "";
      }
    };
    const callsBeforeK = readCalls();
    const previewsBeforeK = await db.client.mcpPreview.count({
      where: { workspaceId: account.workspaceId },
    });
    const invalidResponse = await fetch("http://127.0.0.1:4000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${context.service_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "stage234-K-invalid-rsa",
        method: "tools/call",
        params: {
          name: "google_ads_ads_assets_preview",
          arguments: invalidRsaArguments,
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!invalidResponse.ok) fail("stage234_invalid_rsa_transport_rejected");
    const invalidResult = assertInvalidRsaResult(await invalidResponse.json());
    if (
      readCalls() !== callsBeforeK ||
      (await db.client.mcpPreview.count({
        where: { workspaceId: account.workspaceId },
      })) !== previewsBeforeK
    )
      fail("stage234_invalid_rsa_side_effect");
    save("acceptance-K-evidence.json", {
      acceptance_test: "K",
      result: "PASS",
      test_customer_id: target.customer,
      source_head: env.STAGE234_SOURCE_HEAD,
      runtime: "stock_private_HTTP_MCP_exact_immutable_image",
      invalid_headline_length: 31,
      rejection: invalidResult,
      provider_read_call_count: 0,
      validate_only_call_count: 0,
      real_provider_write_call_count: 0,
      preview_created: false,
      production_changed: false,
      main_changed: false,
      timestamp: new Date().toISOString(),
    });
    stage = "N_JIT_preview";
    // JIT: all fixture/image/API/gateway prechecks are complete before preview.
    const response = await fetch("http://127.0.0.1:4000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${context.service_token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "stage234-N-preview",
        method: "tools/call",
        params: {
          name: "google_ads_bid_budget_preview",
          arguments: toolArguments,
        },
      }),
      signal: AbortSignal.timeout(60000),
    });
    const rpc = await response.json();
    if (!response.ok || rpc.error || rpc.result?.isError)
      fail("stage234_stock_preview_rejected");
    preview =
      rpc.result?.structuredContent ??
      JSON.parse(rpc.result?.content?.[0]?.text ?? "null");
    assertPreview(preview);
    const stored = await db.client.mcpPreview.findUnique({
      where: { id: preview.preview_id },
    });
    if (
      !stored ||
      stored.confirmedAt ||
      stored.consumedAt ||
      stored.accountId !== account.id ||
      stored.serviceTokenId !== key.id ||
      stored.provider !== "GOOGLE_ADS" ||
      stored.commitStatus !== "PREVIEWED" ||
      stored.requestedState?.version !== 2 ||
      canonical(stored.requestedState.intent.items) !==
        canonical(toolArguments.items) ||
      stored.snapshotDigest !== digest(stored.requestedState) ||
      canonical(
        stored.requestedState.operations?.map((o) => ({
          update: o.fields,
          updateMask: o.update_mask,
        })),
      ) !== canonical(validationPayload.operations)
    )
      fail("stage234_persisted_immutable_preview_invalid");
    const previewAudit = await db.client.auditEvent.findMany({
      where: { targetId: stored.id },
      select: { eventType: true, createdAt: true },
    });
    if (
      !previewAudit.some(
        (e) => e.eventType === "mcp_google_stage1_preview_created",
      )
    )
      fail("stage234_preview_audit_missing");
    stage = "provider_reread_unchanged";
    const after = await snapshot();
    assertFixture(after);
    if (canonical(before) !== canonical(after))
      fail("stage234_provider_changed_after_preview");
    if (
      digest(
        await db.client.mcpPreview.findUnique({ where: { id: baseline.id } }),
      ) !== historicalHash ||
      digest(
        await db.client.auditEvent.findMany({
          where: { targetId: baseline.id },
          orderBy: { id: "asc" },
        }),
      ) !== auditHash
    )
      fail("stage234_historical_evidence_changed");
    const events = readFileSync(join(root, "calls.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(JSON.parse);
    if (
      events.filter((e) => e.type === "validate_only").length !== 1 ||
      events.some(
        (e) =>
          !["read", "read_mcc", "validate_only", "oauth_refresh"].includes(
            e.type,
          ),
      )
    )
      fail("stage234_provider_call_accounting_invalid");
    const validation = JSON.parse(
      readFileSync(join(root, "validation.json"), "utf8"),
    );
    if (validation.http_status < 200 || validation.http_status >= 300)
      fail("stage234_validate_only_http_failed");
    save("protected-preview-context.json", {
      preview,
      service_token: context.service_token,
    });
    evidence = {
      ...makeCheckpoint({
        preview,
        before,
        after,
        events,
        sourceHead: env.STAGE234_SOURCE_HEAD,
        imageDigest: env.STAGE234_IMAGE_DIGEST,
      }),
      audit: previewAudit.map((e) => ({
        type: e.eventType,
        timestamp: e.createdAt,
      })),
      persisted_preview_immutable: true,
      historical_evidence_unchanged: true,
      approval_url_ready: approvalReady,
    };
    save("evidence.json", evidence);
    console.log(
      JSON.stringify({
        result: evidence.result,
        preview_id: preview.preview_id,
        expires_at: preview.expires_at,
        approval_url: preview.approval_url,
        provider_reads: evidence.provider_read_call_count,
        validate_only: 1,
        real_writes: 0,
        evidence: "stage234/" + root.split("/").at(-1) + "/evidence.json",
      }),
    );
    await closeDatabase(db);
    db = undefined;
    if (env.STAGE234_KEEP_API_ALIVE !== "true") {
      server.kill("SIGTERM");
      gateway?.kill("SIGTERM");
    }
  } catch (error) {
    let calls = [];
    try {
      calls = readFileSync(join(root, "calls.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse);
    } catch {}
    const result = {
      result: "BLOCKED",
      failure_stage: stage,
      code: safeError(error),
      provider_read_call_count: calls.filter((e) =>
        ["read", "read_mcc"].includes(e.type),
      ).length,
      validate_only_call_count: calls.filter((e) => e.type === "validate_only")
        .length,
      real_provider_write_call_count: 0,
      production_changed: false,
      main_changed: false,
      timestamp: new Date().toISOString(),
    };
    try {
      save("blocked-evidence.json", result);
    } catch {
      /* Never overwrite previous evidence. */
    }
    console.log(JSON.stringify(result));
    process.exitCode = 1;
    server?.kill("SIGTERM");
    gateway?.kill("SIGTERM");
  } finally {
    if (db) {
      try {
        await db.client.$disconnect();
      } catch {}
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await runLivePreview();

// Stock API startup and authenticated DB-only MCP checks. No preview/approval/commit.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import { readAcceptanceContext } from "./context-vault.mjs";
import { readinessOnlyFetch } from "./runtime-readiness-guard.mjs";
import { waitLocalReady } from "./wait-local-ready.mjs";
import { canonical, digest } from "./live-guard.mjs";
const { AbortSignal, console } = globalThis;
const fail = (code) => {
  throw Error(code);
};
globalThis.fetch = readinessOnlyFetch(globalThis.fetch);
const root = process.env.STAGE234_RUN_DIR;
const report = {
  source_head: process.env.STAGE234_SOURCE_HEAD,
  image_digest: process.env.STAGE234_IMAGE_DIGEST,
  provider_reads: 0,
  validate_only: 0,
  real_writes: 0,
  commit_sent: false,
  boots: [],
  result: "BLOCKED",
};
let db, closeDatabase, server;
try {
  createRequire("/workspace/apps/api/package.json")("reflect-metadata");
  const context = await readAcceptanceContext(
    join(root, "fixture-context.json"),
  );
  const { loadConfig } =
    await import("/workspace/packages/config/dist/index.js");
  const database = await import("/workspace/packages/database/dist/index.js");
  // Match commit parent footprint without calling the adapter.
  await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
  closeDatabase = database.closeDatabase;
  const config = loadConfig();
  if (
    new URL(config.databaseUrl).hostname !== "postgres" ||
    new URL(config.databaseUrl).pathname !== "/google_acceptance" ||
    new URL(config.redisUrl).hostname !== "redis" ||
    canonical(config.googleAdsWriteAccountAllowlist) !== '["8590146099"]' ||
    config.previewOnly ||
    !config.confirmedWriteEnabled
  )
    fail("stage234_readiness_config_invalid");
  db = database.createDatabase(config.databaseUrl);
  const key = await db.client.serviceToken.findUnique({
    where: { tokenDigest: digest(context.service_token) },
    include: { serviceIdentity: true },
  });
  if (
    !key ||
    key.id !== "34cd413a-8aff-4677-9439-abf2a9fb473a" ||
    key.revokedAt ||
    key.expiresAt <= new Date() ||
    key.serviceIdentity.revokedAt ||
    key.resourceAccessMode !== "STATIC_ALLOWLIST" ||
    key.accountIds.length !== 1 ||
    !["adforge:mcp:read", "adforge:mcp:write"].every((s) =>
      key.scopes.includes(s),
    )
  )
    fail("stage234_readiness_key_invalid");
  const account = await db.client.providerAccount.findUnique({
    where: { id: key.accountIds[0] },
    include: { connection: { include: { credential: true } } },
  });
  if (
    !account?.enabled ||
    account.externalAccountId !== "8590146099" ||
    account.provider !== "GOOGLE_ADS" ||
    account.workspaceId !== key.serviceIdentity.workspaceId ||
    !account.connection.credential
  )
    fail("stage234_readiness_account_invalid");
  report.key = {
    id: key.id,
    expires_at: key.expiresAt,
    scopes: key.scopes,
    one_test_account: true,
  };
  report.pending_previews = await db.client.mcpPreview.count({
    where: {
      workspaceId: account.workspaceId,
      provider: "GOOGLE_ADS",
      consumedAt: null,
      cancelledAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (report.pending_previews !== 0)
    fail("stage234_readiness_pending_preview_stop");
  const mcp = async (body) => {
    const res = await globalThis.fetch("http://127.0.0.1:4000/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${context.service_token}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    const rpc = await res.json();
    if (!res.ok || rpc.error || rpc.result?.isError)
      fail("stage234_readiness_authenticated_mcp_failed");
    return (
      rpc.result?.structuredContent ??
      (rpc.result?.content
        ? JSON.parse(rpc.result.content[0]?.text ?? "null")
        : rpc.result)
    );
  };
  for (let boot = 0; boot < 3; boot++) {
    const started = performance.now();
    let raw = "";
    server = spawn(
      process.execPath,
      [
        "--max-old-space-size=192",
        "--import",
        "/stage234/runtime-readiness-guard.mjs",
        "/workspace/apps/api/dist/main.js",
      ],
      {
        cwd: "/workspace",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          STAGE234_RUNTIME_READINESS_PRELOAD: "1",
          LOG_LEVEL: "warn",
        },
      },
    );
    for (const s of [server.stdout, server.stderr])
      s.on("data", (d) => {
        raw = (raw + d.toString()).slice(-32000);
      });
    const probes = [];
    const observedFetch = async (url, options) => {
      try {
        const res = await globalThis.fetch(url, options);
        const body = await res
          .clone()
          .json()
          .catch(() => null);
        probes.push({
          status: res.status,
          postgres: body?.dependencies?.postgres?.status ?? null,
          redis: body?.dependencies?.redis?.status ?? null,
        });
        return res;
      } catch (e) {
        probes.push({ error_class: e.name });
        throw e;
      }
    };
    let ready = false;
    try {
      ready = await waitLocalReady({ fetch: observedFetch, server });
      if (!ready) fail("stage234_readiness_stock_api_not_ready");
      const health = await globalThis.fetch("http://127.0.0.1:4000/health");
      if (health.status !== 200) fail("stage234_readiness_health_failed");
      const listed = await mcp({
        jsonrpc: "2.0",
        id: "readiness-tools",
        method: "tools/list",
      });
      const required = [
        "google_ads_bid_budget_preview",
        "commit_preview",
        "preview_rollback_commit",
      ];
      if (
        !required.every((name) =>
          listed.tools?.some(
            (t) => t.name === name && t.inputSchema?.type === "object",
          ),
        )
      )
        fail("stage234_readiness_commit_tools_missing");
      const accounts = await mcp({
        jsonrpc: "2.0",
        id: "readiness-accounts",
        method: "tools/call",
        params: {
          name: "list_accounts",
          arguments: { provider: "GOOGLE_ADS" },
        },
      });
      const status = await mcp({
        jsonrpc: "2.0",
        id: "readiness-account",
        method: "tools/call",
        params: {
          name: "get_account_status",
          arguments: { provider: "GOOGLE_ADS", account_id: "8590146099" },
        },
      });
      if (
        status.account_id !== "8590146099" ||
        status.enabled !== true ||
        !JSON.stringify(accounts).includes("8590146099")
      )
        fail("stage234_readiness_account_response_invalid");
    } finally {
      const safeLogs = raw.split("\n").flatMap((line) => {
        try {
          const row = JSON.parse(line);
          return [
            "api failed to start",
            "postgres readiness failed",
            "redis readiness failed",
          ].includes(row.msg)
            ? [
                {
                  message: row.msg,
                  error_class: /^[A-Za-z]+$/.test(row.errorType ?? "")
                    ? row.errorType
                    : null,
                },
              ]
            : [];
        } catch {
          return [];
        }
      });
      report.boots.push({
        ready,
        elapsed_ms: Math.round(performance.now() - started),
        probes,
        startup_errors: safeLogs,
        exit_code_before_shutdown: server.exitCode,
        signal_before_shutdown: server.signalCode,
      });
      const exited = new Promise((resolve) => server.once("exit", resolve));
      server.kill("SIGTERM");
      await exited;
      report.boots.at(-1).shutdown_exit_code = server.exitCode;
      report.boots.at(-1).shutdown_signal = server.signalCode;
      server = undefined;
    }
  }
  report.result = "RUNTIME_READINESS_PASS";
  report.exact_commit_prerequisites =
    "DB_KEY_ACCOUNT_GATES_TYPED_TOOLS_READY_NO_COMMIT";
} catch (e) {
  report.code = /^stage234_[a-z0-9_]+$/.test(e.message)
    ? e.message
    : "stage234_readiness_internal_redacted";
  report.error_class = e.constructor.name;
  process.exitCode = 1;
} finally {
  server?.kill("SIGTERM");
  if (db && closeDatabase) await closeDatabase(db);
  report.timestamp = new Date().toISOString();
  writeFileSync(
    join(root, "runtime-readiness-evidence.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  console.log(JSON.stringify(report));
}

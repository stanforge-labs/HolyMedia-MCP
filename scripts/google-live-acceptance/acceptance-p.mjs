import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { input, denialProven } from "./acceptance-p-guard.mjs";
createRequire("/workspace/apps/api/package.json")("reflect-metadata");
const { loadConfig } = await import("/workspace/packages/config/dist/index.js");
const { createDatabase, closeDatabase } =
  await import("/workspace/packages/database/dist/index.js");
const { assertGoogleWriteAccount } =
  await import("/workspace/apps/api/dist/providers/google-ads-write.js");
const config = loadConfig(),
  db = createDatabase(config.databaseUrl),
  root = "/acceptance-state";
const evidence = {
  acceptance_test: "P",
  branch: "codex/google-ads-write-live-acceptance",
  HEAD: process.argv[2],
  test_customer_id: "8590146099",
  provider_read_call_count: 0,
  validate_only_call_count: 0,
  real_provider_write_call_count: 0,
  production_changed: false,
  main_changed: false,
  result: "BLOCKED",
};
let server;
try {
  if (
    !/^[a-f0-9]{40}$/.test(evidence.HEAD ?? "") ||
    existsSync(root + "/acceptance-p-evidence.json") ||
    existsSync(root + "/acceptance-p-blocked-transport.jsonl")
  )
    throw new Error("acceptance_p_already_run_or_invalid_head");
  const url = new URL(config.databaseUrl);
  if (
    url.hostname !== "postgres" ||
    url.pathname !== "/google_acceptance" ||
    !config.providerGoogleAdsWriteEnabled ||
    JSON.stringify(config.googleAdsWriteAccountAllowlist) !==
      '["8590146099"]' ||
    !config.previewOnly ||
    config.confirmedWriteEnabled ||
    config.publicMcpWriteScopeEnabled ||
    config.publicMcpControlledWriteEnabled
  )
    throw new Error("acceptance_p_unsafe_config");
  evidence.write_allowlist = config.googleAdsWriteAccountAllowlist;
  const context = JSON.parse(
    readFileSync(root + "/fixture-context.json", "utf8"),
  );
  const old = await db.client.mcpPreview.findUnique({
    where: { id: context.preview.preview_id },
    include: { serviceToken: true },
  });
  const token = old?.serviceToken;
  const hash = (v) => createHash("sha256").update(v).digest("hex");
  if (
    !token ||
    token.revokedAt ||
    token.expiresAt <= new Date() ||
    token.resourceAccessMode !== "STATIC_ALLOWLIST" ||
    JSON.stringify(token.accountIds) !== JSON.stringify([old.accountId]) ||
    token.tokenDigest !== hash(context.service_token)
  )
    throw new Error("acceptance_p_principal_invalid");
  const previewCount = await db.client.mcpPreview.count();
  evidence.server_allowlist_checks = [];
  for (const account of ["4378327049", "0000000001"]) {
    let code, message;
    try {
      assertGoogleWriteAccount(config, account);
    } catch (error) {
      code = error.writeCode;
      message = error.message;
    }
    if (code !== "google_account_not_allowlisted")
      throw new Error("acceptance_p_server_guard_failed");
    evidence.server_allowlist_checks.push({
      account_id: account,
      code,
      message,
      provider_transport_attempted: false,
    });
  }
  server = spawn(
    process.execPath,
    [
      "--max-old-space-size=192",
      "--import",
      "/acceptance/acceptance-p-guard.mjs",
      "/workspace/apps/api/dist/main.js",
    ],
    {
      cwd: "/workspace",
      stdio: "ignore",
      env: { ...process.env, LOG_LEVEL: "error" },
    },
  );
  let ready = false;
  for (let i = 0; i < 35; i++) {
    if (server.exitCode !== null)
      throw new Error("acceptance_p_api_start_failed");
    try {
      if (
        (
          await fetch("http://127.0.0.1:4000/ready", {
            signal: AbortSignal.timeout(2000),
          })
        ).status === 200
      ) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("acceptance_p_api_not_ready");
  const response = await fetch("http://127.0.0.1:4000/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${context.service_token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "pause_entities_preview", arguments: input },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const rpc = await response.json();
  const result =
    rpc.result?.structuredContent ??
    (rpc.result?.content?.[0]?.text
      ? JSON.parse(rpc.result.content[0].text)
      : rpc.error);
  if (!rpc.result?.isError && !rpc.error)
    throw new Error("acceptance_p_mcp_not_rejected");
  if (
    !denialProven(
      Boolean(rpc.result?.isError || rpc.error),
      existsSync(root + "/acceptance-p-blocked-transport.jsonl"),
      (await db.client.mcpPreview.count()) !== previewCount,
    )
  )
    throw new Error("acceptance_p_transport_or_preview_side_effect");
  evidence.mcp_refusal = {
    code: result?.code ?? null,
    message: result.message,
    requested_account_id: "4378327049",
    provider_transport_attempted: false,
  };
  evidence.no_provider_access = true;
  evidence.preview_created = false;
  evidence.commit_attempted = false;
  evidence.audit_write_entries = 0;
  evidence.result = "PASS";
} catch (error) {
  evidence.code = /^[a-z_]+$/.test(error.message)
    ? error.message
    : "acceptance_p_internal_error";
  process.exitCode = 1;
} finally {
  if (server) {
    server.kill("SIGTERM");
    await new Promise((r) => {
      server.once("exit", r);
      setTimeout(r, 5000);
    });
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  evidence.timestamp = new Date().toISOString();
  writeFileSync(
    root + "/acceptance-p-evidence.json",
    JSON.stringify(evidence),
    { mode: 0o600, flag: "wx" },
  );
  console.log(JSON.stringify(evidence));
  await closeDatabase(db);
}

// Separate startup/health probe: never calls MCP or the commit runner.
import { spawn } from "node:child_process";
import { get } from "node:http";
import { createRequire } from "node:module";
import process from "node:process";
import { performance } from "node:perf_hooks";
createRequire("/workspace/apps/api/package.json")("reflect-metadata");
// Reproduce the commit parent's eager provider/database module footprint, not
// an unrealistically light bare-API startup. No adapter/provider method runs.
const { loadConfig } = await import("/workspace/packages/config/dist/index.js");
const database = await import("/workspace/packages/database/dist/index.js");
const { GoogleAdsAdapter } =
  await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
const config = loadConfig();
const db = database.createDatabase(config.databaseUrl);
const adapter = new GoogleAdsAdapter(config);
const { installCommitGuard } = await import("./commit-guard.mjs");
installCommitGuard();
const { AbortSignal, setTimeout, console } = globalThis;
const server = spawn(
  process.execPath,
  [
    "--max-old-space-size=192",
    "--import",
    "/stage234/diagnostic-fetch-preload.mjs",
    "--import",
    "/stage234/commit-guard.mjs",
    "/workspace/apps/api/dist/main.js",
  ],
  {
    cwd: "/workspace",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      STAGE234_COMMIT_GUARD_PRELOAD: "1",
      STAGE234_DIAGNOSTIC_PRELOAD: "1",
    },
  },
);
let logs = "";
for (const stream of [server.stdout, server.stderr])
  stream.on("data", (data) => {
    logs = (logs + data.toString()).slice(-32000);
  });
const nativeHealth = () =>
  new Promise((resolve) => {
    const r = get(
      "http://127.0.0.1:4000/ready",
      { timeout: 1000 },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    r.on("error", () => resolve(null));
    r.on("timeout", () => {
      r.destroy();
      resolve(null);
    });
  });
const probes = [];
const started = performance.now();
try {
  for (let i = 0; i < 35; i++) {
    const direct = await nativeHealth();
    let guarded = null,
      code = null;
    try {
      guarded = (
        await globalThis.fetch("http://127.0.0.1:4000/ready", {
          signal: AbortSignal.timeout(1000),
        })
      ).status;
    } catch (e) {
      code = /^stage234_[a-z0-9_]+$/.test(e.message) ? e.message : e.name;
    }
    probes.push({
      elapsed_ms: Math.round(performance.now() - started),
      direct_http_status: direct,
      guarded_fetch_status: guarded,
      guarded_error_class_or_code: code,
    });
    if (direct === 200 || server.exitCode !== null) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  console.log(
    JSON.stringify({
      result: "STARTUP_DIAGNOSTIC_ONLY",
      parent_rss_bytes: process.memoryUsage().rss,
      provider_adapter_loaded: Boolean(adapter),
      probes,
      child_exit_code: server.exitCode,
      child_signal: server.signalCode,
      safe_child_error_codes: [
        ...new Set(logs.match(/stage234_[a-z0-9_]+/g) ?? []),
      ],
      provider_reads: 0,
      validate_only: 0,
      real_writes: 0,
      mcp_called: false,
    }),
  );
} finally {
  server.kill("SIGTERM");
  await database.closeDatabase(db);
}

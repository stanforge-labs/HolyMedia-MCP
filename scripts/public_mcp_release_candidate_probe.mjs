// CI-only fail-closed observation, mounted after the immutable image is built.
// Health checks and docker-exec clients must not reset the API process counters.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";

if (process.argv[1]?.endsWith("/apps/api/dist/main.js")) {
  assert.equal(process.env.RELEASE_CANDIDATE_DISPOSABLE, "true");
  assert.equal(process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED, "false");
  assert.equal(process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED, "false");
  assert.equal(process.env.V2_CONFIRMED_WRITE_ENABLED, "false");
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, "candidate-postgres");
  assert.equal(url.pathname, "/public_mcp_candidate");
  const require = createRequire("/workspace/apps/api/package.json");
  require("reflect-metadata");
  const counters = {
    providerAdapterAttempts: 0,
    providerWriteAttempts: 0,
    publicWriteDispatchAttempts: 0,
    observedMethods: [],
  };
  const path = "/tmp/public-mcp-candidate-adapter-counts.json";
  const persist = () =>
    writeFileSync(path, JSON.stringify(counters), { mode: 0o600 });
  const classes = [
    ["google.ads", "GoogleAdsAdapter"],
    ["meta.ads", "MetaAdsAdapter"],
    ["google.analytics", "GoogleAnalyticsAdapter"],
    ["google.search-console", "GoogleSearchConsoleAdapter"],
    ["tiktok.ads", "TikTokAdsAdapter"],
    ["yandex.direct", "YandexDirectAdapter"],
    ["test.provider", "TestProviderAdapter"],
  ];
  for (const [file, exported] of classes) {
    const module = await import(
      `/workspace/apps/api/dist/providers/adapters/${file}.js`
    );
    const prototype = module[exported].prototype;
    for (const name of Object.getOwnPropertyNames(prototype)) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
      if (name === "constructor" || typeof descriptor?.value !== "function")
        continue;
      counters.observedMethods.push(`${exported}.${name}`);
      Object.defineProperty(prototype, name, {
        ...descriptor,
        value: function forbiddenProviderInvocation() {
          counters.providerAdapterAttempts++;
          if (/mutate|commit|pause|resume|change/i.test(name))
            counters.providerWriteAttempts++;
          persist();
          throw new Error(
            "Provider adapter invocation forbidden in disposable acceptance",
          );
        },
      });
    }
  }
  const { McpPublicWriteService } =
    await import("/workspace/apps/api/dist/mcp/mcp-public-write.service.js");
  McpPublicWriteService.prototype.call = function forbiddenWriteDispatch() {
    counters.publicWriteDispatchAttempts++;
    persist();
    throw new Error("Public write dispatch forbidden in disposable acceptance");
  };
  assert(counters.observedMethods.length > 20);
  persist();
  console.log(
    "CI adapter observation initialized; no provider dispatch permitted",
  );
}

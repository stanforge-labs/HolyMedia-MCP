import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("proxy rejects non-disposable or non-private destinations before listening", () => {
  const script = fileURLToPath(
    new URL("./public_mcp_split_candidate_browser_proxy.mjs", import.meta.url),
  );
  const safe = {
    ...process.env,
    RELEASE_CANDIDATE_DISPOSABLE: "true",
    COMPOSE_PROJECT_NAME: "hm-public-mcp-split-ci",
    SOURCE_SHA: "a00817b746211a295bcb966f7fd7ef12cd6178fb",
    RC_BROWSER_WEB_IP: "172.18.0.7",
  };
  for (const override of [
    { RELEASE_CANDIDATE_DISPOSABLE: "false" },
    { COMPOSE_PROJECT_NAME: "production" },
    { SOURCE_SHA: "different" },
    { RC_BROWSER_WEB_IP: "8.8.8.8" },
    { RC_BROWSER_WEB_IP: "mcp.holymedia.kz" },
    { RC_BROWSER_WEB_IP: "127.0.0.1" },
  ]) {
    const result = spawnSync(process.execPath, [script], {
      env: { ...safe, ...override },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert(!result.stdout.includes("loopback ingress ready"));
  }
});

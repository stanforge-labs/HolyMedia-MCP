import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("temporary approval gateway has no OAuth/MCP routes and never logs query or secrets", async (t) => {
  const received = [];
  const upstream = createServer((req, res) => {
    received.push(req.url);
    if (req.url.split("?")[0] === "/oauth/GOOGLE_ADS/callback") {
      res.writeHead(302, {
        Location:
          "/dashboard/connections?oauth=error&provider=GOOGLE_ADS&oauth_reason=invalid_callback",
      });
    } else res.writeHead(200);
    res.end();
  });
  upstream.listen(4000, "127.0.0.1");
  await once(upstream, "listening");
  t.after(() => new Promise((resolve) => upstream.close(resolve)));
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("./approval-gateway.mjs", import.meta.url))],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout.on("data", (value) => (output += value));
  child.stderr.on("data", (value) => (output += value));
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    assert.equal(output, "", "gateway must not log callback data");
  });
  const get = (path) =>
    fetch("http://127.0.0.1:4001" + path, {
      redirect: "manual",
      headers: { host: "localhost:4401" },
    });
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null) throw new Error("test_gateway_exited");
    try {
      ready = (await get("/health")).status === 200;
    } catch {}
    if (ready) break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.ok(ready, "mock gateway must become ready");
  received.length = 0;
  for (const path of [
    "/acceptance/oauth/start",
    "/api/v1/oauth/GOOGLE_ADS/callback?code=synthetic&state=synthetic",
    "/dashboard/connections?oauth=success",
    "/oauth/GOOGLE_ADS/callback",
  ]) {
    const count = received.length;
    assert.equal((await get(path)).status, 404);
    assert.equal(received.length, count);
  }
  assert.equal((await get("/ready")).status, 200);
  assert.equal(received.at(-1), "/ready");
  const approval = await get("/mcp/approve");
  assert.equal(approval.status, 200);
  assert.match(await approval.text(), /TEST CLIENT 8590146099/);
  assert.equal(approval.headers.get("referrer-policy"), "no-referrer");
  const js = await get("/acceptance/approval.mjs");
  assert.equal(js.status, 200);
  const script = await js.text();
  assert.doesNotMatch(
    script,
    /commit_preview|commit_confirmed_preview|console\./,
  );
  const forbidden = await fetch(
    "http://127.0.0.1:4001/api/v1/mcp/public/approval",
    {
      method: "POST",
      headers: { host: "localhost:4401", origin: "https://example.invalid" },
    },
  );
  assert.equal(forbidden.status, 403);
  assert.equal(
    (
      await fetch("http://127.0.0.1:4001/mcp", {
        method: "POST",
        headers: { host: "localhost:4401" },
      })
    ).status,
    404,
  );
});

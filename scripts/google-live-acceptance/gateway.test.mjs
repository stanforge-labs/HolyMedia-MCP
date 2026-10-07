import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("acceptance gateway rewrites only the exact callback and never logs its query", async (t) => {
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
    [fileURLToPath(new URL("./gateway.mjs", import.meta.url))],
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
      headers: { host: "localhost:4400" },
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
  const external = "/api/v1/oauth/GOOGLE_ADS/callback";
  const noParams = await get(external);
  assert.equal(noParams.status, 302);
  assert.equal(
    new URL(
      noParams.headers.get("location"),
      "http://localhost:4400",
    ).searchParams.get("oauth_reason"),
    "invalid_callback",
  );
  assert.equal(received.at(-1), "/oauth/GOOGLE_ADS/callback");
  // Synthetic markers only; no real authorization material in this test.
  const query =
    "?code=synthetic%2Bmarker%2Fvalue&state=synthetic-state&scope=a+b&scope=c%20d&extra=%26%3D&empty=";
  assert.equal((await get(external + query)).status, 302);
  assert.equal(received.at(-1), "/oauth/GOOGLE_ADS/callback" + query);
  for (const path of [
    external + "/extra",
    "/api/v1/oauth/META_ADS/callback",
    "/oauth/GOOGLE_ADS/callback",
    "/api/v1/anything",
  ]) {
    const count = received.length;
    assert.equal((await get(path)).status, 404);
    assert.equal(received.length, count);
  }
  const dashboard = await get("/dashboard/connections?oauth=success");
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /OAuth callback successful/);
  assert.equal((await get("/ready")).status, 200);
  assert.equal(received.at(-1), "/ready");
});

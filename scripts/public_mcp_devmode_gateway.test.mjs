import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { after, test } from "node:test";
import {
  createGateway,
  safePathname,
  upstreamFor,
} from "./public_mcp_devmode_gateway.mjs";
import { sanitize } from "./public_mcp_devmode_logs.mjs";

const servers = [];
after(async () => {
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

async function listening(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  servers.push(server);
  return server.address().port;
}

test("routes API, OAuth and metadata to API while auth and approval stay Web", () => {
  for (const path of [
    "/mcp",
    "/mcp/public",
    "/.well-known/oauth-authorization-server",
    "/oauth/token",
    "/api/v1/auth/csrf",
    "/api/profile",
    "/health",
    "/ready",
  ])
    assert.equal(upstreamFor(path), "api", path);
  for (const path of [
    "/auth",
    "/en/auth",
    "/mcp/approve",
    "/en/mcp/approve",
    "/dashboard",
    "/api/health",
  ])
    assert.equal(upstreamFor(path), "web", path);
});

test("gateway never logs credentials, query, body or token-bearing paths", async () => {
  const logs = [];
  const apiPort = await listening(
    createServer((req, res) => {
      req.resume();
      res.writeHead(200, { "set-cookie": "session=secret-cookie" }).end("ok");
    }),
  );
  const webPort = await listening(
    createServer((_req, res) => res.writeHead(200).end("web")),
  );
  const gatewayPort = await listening(
    createGateway({ apiPort, webPort, logger: (line) => logs.push(line) }),
  );
  const secret = "hmap_nonce access_token refresh_token Bearer Cookie CSRF";
  const response = await fetch(
    `http://127.0.0.1:${gatewayPort}/oauth/${encodeURIComponent(secret)}?code=${encodeURIComponent(secret)}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        cookie: `session=${secret}`,
        "x-csrf-token": secret,
      },
      body: secret,
    },
  );
  assert.equal(response.status, 200);
  await response.text();
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0]), {
    method: "POST",
    pathname: "/oauth/*",
    status: 200,
    duration_ms: JSON.parse(logs[0]).duration_ms,
  });
  assert.equal(logs[0].includes(secret), false);
  assert.equal(logs[0].includes("code="), false);
  assert.equal(safePathname(`/mcp/${secret}`), "/mcp/*");
});

test("gateway may start before upstreams and returns a safe 502", async () => {
  const logs = [];
  const gatewayPort = await listening(
    createGateway({
      apiPort: 1,
      webPort: 1,
      logger: (line) => logs.push(line),
    }),
  );
  const response = await fetch(
    `http://127.0.0.1:${gatewayPort}/health?access_token=hidden`,
  );
  assert.equal(response.status, 502);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes("hidden"), false);
});

test("artifact sanitizer copies allowlisted telemetry only", () => {
  const secret = "Bearer hmap_secret access_token refresh_token Cookie CSRF";
  const raw = JSON.stringify({
    method: "POST",
    path: `/oauth/${secret}?code=${secret}`,
    status: 401,
    authorization: secret,
    cookie: secret,
    body: secret,
    msg: secret,
    requestId: secret,
  });
  const result = sanitize(`${raw}\n${secret}\n`);
  assert.deepEqual(JSON.parse(result), {
    method: "POST",
    pathname: "/oauth/*",
    status: 401,
    duration_ms: null,
  });
  assert.equal(result.includes(secret), false);
});

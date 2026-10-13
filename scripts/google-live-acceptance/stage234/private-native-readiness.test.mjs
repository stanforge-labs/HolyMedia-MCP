import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  probeTestNativeMcp,
  validateDiscovery,
  validateTestOrigin,
} from "./private-native-readiness.mjs";

test("requires an explicit canonical TEST origin and rejects production", () => {
  assert.equal(
    validateTestOrigin("http://127.0.0.1:4404"),
    "http://127.0.0.1:4404",
  );
  assert.equal(
    validateTestOrigin("https://test-mcp.example.test"),
    "https://test-mcp.example.test",
  );
  for (const candidate of [
    undefined,
    "https://mcp.holymedia.kz",
    "http://example.test",
    "https://user:pass@example.test",
    "https://example.test/mcp",
    "https://example.test/?token=x",
  ]) {
    assert.throws(() => validateTestOrigin(candidate));
  }
});

test("readiness is unauthenticated and never sends a mutation", async () => {
  const requests = [];
  let origin;
  const server = createServer((request, response) => {
    requests.push({
      method: request.method,
      path: request.url,
      authorization: request.headers.authorization,
    });
    response.setHeader("content-type", "application/json");
    if (request.url === "/.well-known/oauth-protected-resource/mcp") {
      response.end(
        JSON.stringify({
          resource: `${origin}/mcp`,
          authorization_servers: [origin],
          scopes_supported: ["adforge:mcp:read"],
        }),
      );
    } else if (request.url === "/.well-known/oauth-authorization-server") {
      response.end(
        JSON.stringify({
          issuer: origin,
          authorization_endpoint: `${origin}/oauth/authorize`,
          token_endpoint: `${origin}/oauth/token`,
          registration_endpoint: `${origin}/oauth/register`,
          code_challenge_methods_supported: ["S256"],
        }),
      );
    } else if (request.url === "/mcp?profile=google_ads_write") {
      response.statusCode = 401;
      response.end("{}");
    } else {
      response.statusCode = 404;
      response.end("{}");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const result = await probeTestNativeMcp(origin);
    assert.equal(result.status, "PASS_UNAUTHENTICATED_READINESS_ONLY");
    assert.equal(result.provider_write, 0);
    assert.deepEqual(
      requests.map((request) => `${request.method} ${request.path}`),
      [
        "GET /.well-known/oauth-protected-resource/mcp",
        "GET /.well-known/oauth-authorization-server",
        "POST /mcp?profile=google_ads_write",
      ],
    );
    assert.ok(requests.every((request) => request.authorization === undefined));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("requires exact issuer/resource/routes and S256, not approval-only metadata", () => {
  const origin = "https://test-mcp.example.test";
  const resource = {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: ["adforge:mcp:read"],
  };
  const server = {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    code_challenge_methods_supported: ["S256"],
  };
  assert.doesNotThrow(() => validateDiscovery(origin, resource, server));
  assert.throws(() =>
    validateDiscovery(
      origin,
      { ...resource, resource: `${origin}/mcp/public` },
      server,
    ),
  );
  assert.throws(() =>
    validateDiscovery(origin, resource, {
      ...server,
      issuer: "https://mcp.holymedia.kz",
    }),
  );
  assert.throws(() =>
    validateDiscovery(origin, resource, {
      ...server,
      code_challenge_methods_supported: ["plain"],
    }),
  );
});

import assert from "node:assert/strict";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  createDatabase,
  closeDatabase,
} from "../packages/database/dist/index.js";
import { assertDisposableDatabase } from "./public_mcp_devmode_seed.mjs";

const expectedGoogleReads = [
  "google_ads_list_keywords",
  "google_ads_search_terms",
  "google_ads_list_negatives",
  "google_ads_check_negative_conflicts",
];

async function main() {
  const { TUNNEL_ORIGIN, DATABASE_URL, RUNNER_TEMP } = process.env;
  if (!TUNNEL_ORIGIN || !DATABASE_URL || !RUNNER_TEMP)
    throw new Error("preflight environment missing");
  assertDisposableDatabase(DATABASE_URL);
  const origin = new URL(TUNNEL_ORIGIN);
  assert.equal(origin.protocol, "https:");
  assert.notEqual(origin.hostname, "mcp.holymedia.kz");
  const fixturePath = join(RUNNER_TEMP, "public-mcp-preflight-token.json");
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  const request = (path, options = {}) =>
    fetch(`${origin.origin}${path}`, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
      ...options,
    });
  const rpc = (path, method, token, params) =>
    request(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method,
        ...(params ? { params } : {}),
      }),
    });
  try {
    for (const [path, label] of [
      ["/health", "API health"],
      ["/ready", "API ready"],
      ["/api/health", "Web health"],
    ]) {
      const response = await fetch(`http://127.0.0.1:8787${path}`, {
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(response.status, 200, label);
    }
    const resourceResponse = await request(
      "/.well-known/oauth-protected-resource/mcp/public",
    );
    assert.equal(resourceResponse.status, 200, "resource metadata");
    const resource = await resourceResponse.json();
    assert.equal(resource.resource, `${origin.origin}/mcp/public`);
    assert.deepEqual(resource.authorization_servers, [origin.origin]);
    assert.deepEqual(resource.scopes_supported, ["adforge:mcp:read"]);
    const authResponse = await request(
      "/.well-known/oauth-authorization-server",
    );
    assert.equal(authResponse.status, 200, "authorization metadata");
    const authorization = await authResponse.json();
    for (const [key, path] of Object.entries({
      issuer: "",
      authorization_endpoint: "/oauth/authorize",
      token_endpoint: "/oauth/token",
      registration_endpoint: "/oauth/register",
      revocation_endpoint: "/oauth/revoke",
    }))
      assert.equal(authorization[key], `${origin.origin}${path}`, key);
    assert.deepEqual(authorization.scopes_supported, ["adforge:mcp:read"]);
    assert.equal(
      /mcp\.holymedia\.kz|v2-staging-mcp\.holymedia\.kz/.test(
        JSON.stringify({ resource, authorization }),
      ),
      false,
    );

    for (const path of [
      "/auth",
      "/en/auth",
      "/mcp/approve",
      "/en/mcp/approve",
    ]) {
      const response = await request(path);
      assert.equal(response.status, 200, `Web route ${path}`);
      assert.match(
        response.headers.get("content-security-policy") ?? "",
        /connect-src/,
        `Web CSP ${path}`,
      );
      if (path.includes("approve")) {
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
        assert.match(response.headers.get("cache-control") ?? "", /no-store/);
        assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
      }
    }

    const anonymous = await rpc("/mcp/public", "initialize", null);
    assert.equal(anonymous.status, 401, "unauthenticated challenge");
    assert.match(
      anonymous.headers.get("www-authenticate") ?? "",
      /oauth-protected-resource\/mcp\/public/,
    );
    const invalid = await rpc("/mcp/public", "initialize", "hm_oauth_invalid");
    assert.equal(invalid.status, 401, "invalid token");
    const wrongResource = await rpc("/mcp", "initialize", fixture.token);
    assert.equal(wrongResource.status, 401, "wrong-resource token");
    const legacyAnonymous = await rpc("/mcp", "initialize", null);
    assert.equal(legacyAnonymous.status, 401, "legacy boundary");
    const initialized = await rpc("/mcp/public", "initialize", fixture.token);
    assert.equal(initialized.status, 200, "Public MCP initialize");
    assert.equal(
      (await initialized.json()).result.protocolVersion,
      "2025-03-26",
    );
    const listed = await rpc("/mcp/public", "tools/list", fixture.token);
    assert.equal(listed.status, 200, "tools/list");
    const toolList = (await listed.json()).result.tools;
    const names = new Set(toolList.map((tool) => tool.name));
    for (const name of expectedGoogleReads)
      assert(names.has(name), `missing ${name}`);
    for (const tool of toolList)
      assert.equal(tool.inputSchema?.type, "object", `schema ${tool.name}`);
    const inventory = await rpc("/mcp/public", "tools/call", fixture.token, {
      name: "list_connected_resources",
      arguments: {},
    });
    assert.equal(inventory.status, 200, "empty provider inventory");
    assert.equal((await inventory.json()).result?.isError ?? false, false);
    const blockedWrite = await rpc("/mcp/public", "tools/call", fixture.token, {
      name: "commit_confirmed_preview",
      arguments: { preview_token: "unavailable" },
    });
    assert.equal(blockedWrite.status, 200, "write denial transport");
    const writeResult = (await blockedWrite.json()).result;
    assert.equal(writeResult?.isError, true, "write denial");
    assert.match(JSON.stringify(writeResult), /write_scope_required/);

    const authorize = new URL(`${origin.origin}/oauth/authorize`);
    for (const [key, value] of Object.entries({
      client_id: fixture.clientId,
      redirect_uri: "https://client.example.test/callback",
      response_type: "code",
      code_challenge: "A".repeat(43),
      code_challenge_method: "S256",
      resource: `${origin.origin}/mcp/public`,
      scope: "adforge:mcp:read adforge:mcp:write",
    }))
      authorize.searchParams.set(key, value);
    const writeScope = await fetch(authorize, {
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    assert.equal(writeScope.status, 400, "write OAuth scope denied");
    console.log("PUBLIC MCP DEVELOPER PREFLIGHT PASS");
  } finally {
    const database = createDatabase(DATABASE_URL);
    try {
      await database.client.oAuthPublicClient.deleteMany({
        where: { clientId: fixture.clientId },
      });
    } finally {
      await closeDatabase(database);
      await unlink(fixturePath).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  console.error(
    `PUBLIC MCP DEVELOPER PREFLIGHT FAIL: ${error instanceof Error ? error.constructor.name : "unknown"}`,
  );
  process.exitCode = 1;
});

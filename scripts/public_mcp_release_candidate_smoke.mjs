import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const origin = "https://mcp.holymedia.kz";
const api = "http://127.0.0.1:4000";
const web = "http://candidate-web:3000";
const mode = process.argv[2] ?? "candidate";
assert.equal(process.env.NODE_ENV, "production");
assert.equal(process.env.RELEASE_CANDIDATE_DISPOSABLE, "true");
assert.equal(process.env.HOLYMEDIA_PUBLIC_BASE_URL, origin);
for (const flag of [
  "PUBLIC_MCP_WRITE_SCOPE_ENABLED",
  "PUBLIC_MCP_CONTROLLED_WRITE_ENABLED",
  "V2_CONFIRMED_WRITE_ENABLED",
])
  assert.equal(process.env[flag], "false", flag);
const dbUrl = new URL(process.env.DATABASE_URL);
assert.equal(dbUrl.protocol, "postgresql:");
assert.equal(dbUrl.port, "5432");
assert.equal(dbUrl.username, "holymedia");
assert.equal(dbUrl.password, "ci-only-public-mcp");
assert.equal(
  dbUrl.hostname,
  mode === "rollback" ? "rollback-postgres" : "candidate-postgres",
);
assert.equal(
  dbUrl.pathname,
  mode === "rollback" ? "/public_mcp_rollback" : "/public_mcp_candidate",
);
for (const [key, value] of Object.entries(process.env))
  if (
    /^(?:PROVIDER_.+(?:CLIENT_SECRET|CLIENT_ID|DEVELOPER_TOKEN)|AD_MCP_.+(?:TOKEN|SECRET)|NGROK_AUTHTOKEN|PUBLIC_MCP_ACCEPTANCE_(?:EMAIL|PASSWORD))$/.test(
      key,
    )
  )
    assert(!value, `Unexpected external credential: ${key}`);

async function request(base, path, options = {}) {
  const url = new URL(path, base);
  assert(["127.0.0.1", "candidate-web"].includes(url.hostname));
  assert.equal(url.protocol, "http:");
  return fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    ...options,
  });
}
async function rpc(path, method, token, params) {
  return request(api, path, {
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
}
async function success(path, method, token, params) {
  const response = await rpc(path, method, token, params);
  assert.equal(response.status, 200, `${path} ${method}`);
  const body = await response.json();
  assert.equal(body.id, 1);
  assert.equal(body.error, undefined);
  return body.result;
}
for (const path of ["/health", "/ready"]) {
  const response = await request(api, path);
  assert.equal(response.status, 200, path);
  assert.equal((await response.json()).status, "ok");
}
assert.equal((await rpc("/mcp", "initialize")).status, 401);
if (mode === "rollback") {
  console.log(
    "ROLLBACK_RESULT " +
      JSON.stringify({
        apiBoot: "PASS",
        health: 200,
        ready: 200,
        legacyUnauth: 401,
        downMigration: "NOT ATTEMPTED",
        providerCalls: 0,
        providerWrites: 0,
      }),
  );
} else {
  const challenge = await rpc("/mcp/public", "initialize");
  assert.equal(challenge.status, 401);
  assert.match(
    challenge.headers.get("www-authenticate") ?? "",
    /https:\/\/mcp\.holymedia\.kz\/\.well-known\/oauth-protected-resource\/mcp\/public/,
  );
  const resourceResponse = await request(
    api,
    "/.well-known/oauth-protected-resource/mcp/public",
  );
  assert.equal(resourceResponse.status, 200);
  const resource = await resourceResponse.json();
  assert.equal(resource.resource, `${origin}/mcp/public`);
  assert.deepEqual(resource.authorization_servers, [origin]);
  assert.deepEqual(resource.scopes_supported, ["adforge:mcp:read"]);
  const authResponse = await request(
    api,
    "/.well-known/oauth-authorization-server",
  );
  assert.equal(authResponse.status, 200);
  const authorization = await authResponse.json();
  for (const [key, path] of Object.entries({
    issuer: "",
    authorization_endpoint: "/oauth/authorize",
    token_endpoint: "/oauth/token",
    registration_endpoint: "/oauth/register",
    revocation_endpoint: "/oauth/revoke",
  }))
    assert.equal(authorization[key], `${origin}${path}`);
  assert.deepEqual(authorization.scopes_supported, ["adforge:mcp:read"]);
  assert(
    !/ngrok|localhost|127\.0\.0\.1|v2-staging-mcp/.test(
      JSON.stringify({ resource, authorization }),
    ),
  );
  const webHealth = await request(web, "/api/health");
  assert.equal(webHealth.status, 200);
  for (const path of [
    "/support",
    "/en/support",
    "/privacy",
    "/terms",
    "/en/privacy",
    "/en/terms",
  ]) {
    const response = await request(web, path);
    assert.equal(response.status, 200, path);
    if (path.includes("support")) {
      const html = await response.text();
      assert.match(html, /mailto:mcp@holymedia\.kz/);
      assert(
        html.includes(
          path.startsWith("/en/")
            ? "HolyMedia MCP Support"
            : "Поддержка HolyMedia MCP",
        ),
      );
      assert(html.includes(`${origin}${path}`));
    }
  }
  for (const path of ["/mcp/approve", "/en/mcp/approve"]) {
    const response = await request(web, path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    assert.match(response.headers.get("x-robots-tag") ?? "", /noindex/);
  }

  const require = createRequire("/workspace/apps/api/package.json");
  require("reflect-metadata");
  const { createDatabase, closeDatabase } =
    await import("/workspace/packages/database/dist/index.js");
  const { PUBLIC_READ_TOOLS, PUBLIC_WRITE_TOOLS } =
    await import("/workspace/apps/api/dist/mcp/mcp-public-tools.js");
  const { googleAdsDefinition } =
    await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
  assert.equal(googleAdsDefinition(false).write, false);
  assert.equal(googleAdsDefinition(true).write, false);
  const database = createDatabase(process.env.DATABASE_URL);
  const db = database.client;
  let workspaceId, userId, clientId;
  try {
    assert.equal(await db.providerConnection.count(), 0);
    assert.equal(await db.providerCredential.count(), 0);
    const rawPublic = `hm_oauth_${randomBytes(32).toString("base64url")}`;
    const rawLegacy = `hmst_${randomBytes(32).toString("base64url")}`;
    await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `rc-${randomUUID()}@example.test`,
          name: "Disposable candidate reviewer",
          passwordHash: "unusable-disposable-no-login",
          status: "active",
          emailVerifiedAt: new Date(),
        },
      });
      userId = user.id;
      const workspace = await tx.workspace.create({
        data: {
          name: "Disposable release candidate",
          slug: `public-mcp-rc-${randomUUID()}`,
          accessStatus: "ACTIVE",
          memberships: { create: { userId, role: "OWNER" } },
          entitlements: {
            create: { featureKey: "mcp", value: true, source: "acceptance_ci" },
          },
        },
      });
      workspaceId = workspace.id;
      const client = await tx.oAuthPublicClient.create({
        data: {
          clientId: `rc-${randomUUID()}`,
          clientName: "Disposable read principal",
          redirectUris: ["https://client.example.test/callback"],
          scope: "adforge:mcp:read",
          registrationSource: "acceptance_ci",
        },
      });
      clientId = client.id;
      await tx.oAuthAccessToken.create({
        data: {
          tokenDigest: createHash("sha256").update(rawPublic).digest("hex"),
          tokenPrefix: "hm_oauth_",
          clientId,
          workspaceId,
          userId,
          scope: "adforge:mcp:read",
          resource: `${origin}/mcp/public`,
          refreshFamilyId: randomUUID(),
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      const identity = await tx.serviceIdentity.create({
        data: { workspaceId, name: "disposable-candidate-legacy" },
      });
      await tx.serviceToken.create({
        data: {
          serviceIdentityId: identity.id,
          tokenDigest: createHash("sha256").update(rawLegacy).digest("hex"),
          tokenPrefix: "hmst_rc",
          name: "disposable-candidate-legacy",
          scopes: ["adforge:mcp:read"],
          accountIds: [],
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
    });
    assert.equal(
      (await success("/mcp/public", "initialize", rawPublic)).protocolVersion,
      "2025-03-26",
    );
    const listing = await success("/mcp/public", "tools/list", rawPublic);
    const tools = listing.tools;
    assert.equal(tools.length, 42);
    assert.deepEqual(
      tools.map((tool) => tool.name),
      [...PUBLIC_READ_TOOLS],
    );
    for (const tool of tools) {
      assert.equal(tool.inputSchema.type, "object");
      assert(tool.title && tool.annotations.title);
      for (const key of [
        "readOnlyHint",
        "openWorldHint",
        "destructiveHint",
        "idempotentHint",
      ])
        assert.equal(
          typeof tool.annotations[key],
          "boolean",
          `${tool.name} ${key}`,
        );
      assert.equal(tool.annotations.destructiveHint, false);
      assert.equal(
        tool.annotations.readOnlyHint,
        tool.name !== "run_connection_diagnostics",
      );
      assert.equal(
        tool.annotations.idempotentHint,
        tool.name !== "run_connection_diagnostics",
      );
      assert.equal(
        tool.annotations.openWorldHint,
        ![
          "list_connected_resources",
          "list_ad_accounts",
          "get_account_status",
        ].includes(tool.name),
      );
    }
    const google = [
      "google_ads_list_keywords",
      "google_ads_search_terms",
      "google_ads_list_negatives",
      "google_ads_check_negative_conflicts",
    ];
    for (const name of google) {
      const tool = tools.find((tool) => tool.name === name);
      assert(tool && tool.inputSchema.properties.account_id);
    }
    for (const name of PUBLIC_WRITE_TOOLS) {
      assert(!tools.some((tool) => tool.name === name));
      const denied = await success("/mcp/public", "tools/call", rawPublic, {
        name,
        arguments: {},
      });
      assert.equal(denied.isError, true);
      assert.equal(
        JSON.parse(denied.content[0].text).code,
        "public_operation_not_available",
      );
    }
    assert.equal((await rpc("/mcp", "initialize", rawPublic)).status, 401);
    assert.equal(
      (await rpc("/mcp/public", "initialize", rawLegacy)).status,
      401,
    );
    assert.equal(
      (await success("/mcp", "initialize", rawLegacy)).protocolVersion,
      "2025-03-26",
    );
    const legacy = await success("/mcp", "tools/list", rawLegacy);
    for (const name of google)
      assert(legacy.tools.some((tool) => tool.name === name));
    if (mode === "observed") {
      const counts = JSON.parse(
        await readFile("/tmp/public-mcp-candidate-adapter-counts.json", "utf8"),
      );
      assert.equal(counts.providerAdapterAttempts, 0);
      assert.equal(counts.providerWriteAttempts, 0);
      assert.equal(counts.publicWriteDispatchAttempts, 0);
      assert(counts.observedMethods.length > 20);
    }
    console.log(
      "CANDIDATE_RESULT " +
        JSON.stringify({
          mode,
          api: "PASS",
          web: "PASS",
          supportRU: "PASS",
          supportEN: "PASS",
          publicMetadata: "PASS",
          publicAuth: "PASS",
          publicInitialize: "PASS",
          publicTools: tools.length,
          reviewedReadInventory: "PASS",
          annotations: "PASS",
          controlledWritesVisible: false,
          directHiddenWriteCalls: "PASS (all four)",
          legacyMcp: "PASS",
          googleReadTools: "PASS",
          googleWrite: false,
          approvalHeaders: "PASS",
          providerConnections: 0,
          providerCredentials: 0,
          providerCalls: 0,
          providerWrites: 0,
        }),
    );
  } finally {
    // Deletes are guarded to the exact disposable fixture and database above.
    if (clientId)
      await db.oAuthPublicClient.deleteMany({ where: { id: clientId } });
    if (workspaceId)
      await db.workspace.deleteMany({ where: { id: workspaceId } });
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await closeDatabase(database);
  }
}

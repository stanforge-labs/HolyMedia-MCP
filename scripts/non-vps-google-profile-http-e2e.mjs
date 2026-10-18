// Execute through stdin inside the isolated localhost API container only.
// No real provider account, OAuth credential, or Google network request is used.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import {
  createDatabase,
  closeDatabase,
} from "/workspace/packages/database/dist/index.js";
import { GOOGLE_WRITE_PROFILE_TOOLS } from "/workspace/apps/api/dist/mcp/google-write-client-contract.js";

assert.equal(process.env.HOLYMEDIA_PUBLIC_BASE_URL, "http://127.0.0.1:13300");
assert.match(
  process.env.DATABASE_URL ?? "",
  /@postgres:5432\/holypilot_local$/,
);
assert.equal(process.env.V2_PREVIEW_ONLY, "true");
for (const key of [
  "PROVIDER_GOOGLE_ADS_WRITE_ENABLED",
  "PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED",
  "PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED",
  "PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED",
  "V2_CONFIRMED_WRITE_ENABLED",
  "PUBLIC_MCP_WRITE_SCOPE_ENABLED",
  "PUBLIC_MCP_CONTROLLED_WRITE_ENABLED",
])
  assert.equal(process.env[key], "false", `${key} must be OFF`);

const base = "http://127.0.0.1:4000";
const database = createDatabase(process.env.DATABASE_URL);
const db = database.client;
const slug = `local-http-e2e-${randomBytes(7).toString("hex")}`;
let workspaceId;
const evidence = { kind: "LOCAL_HTTP_E2E", stageCalls: [], pmaxCalls: [] };

async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    redirect: "manual",
    ...init,
  });
  let body = null;
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) body = await response.json();
  return { status: response.status, body, headers: response.headers };
}
async function mcp(
  token,
  method,
  params,
  path = "/mcp?profile=google_ads_write",
) {
  const response = await request(path, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  assert.equal(response.status, 200, `${method} HTTP status`);
  return response.body;
}
function toolError(reply, label) {
  assert.equal(reply?.result?.isError, true, `${label} must fail closed`);
  const text = reply.result.content?.[0]?.text;
  const body = JSON.parse(text);
  assert.equal(typeof body.message, "string", `${label} error body`);
  return body.code ?? body.message.slice(0, 160);
}
async function tokenFor(identityId, name, scopes) {
  const token = `hmst_${randomBytes(32).toString("base64url")}`;
  await db.serviceToken.create({
    data: {
      serviceIdentityId: identityId,
      tokenDigest: createHash("sha256").update(token).digest("hex"),
      tokenPrefix: token.slice(0, 13),
      name,
      scopes,
      accountIds: [],
      expiresAt: new Date(Date.now() + 5 * 60_000),
    },
  });
  return token;
}

try {
  const workspace = await db.workspace.create({
    data: { name: "Disposable HTTP E2E", slug, accessStatus: "ACTIVE" },
  });
  workspaceId = workspace.id;
  await db.entitlement.create({
    data: {
      workspaceId,
      featureKey: "legacy_access",
      value: true,
      source: "disposable_http_e2e",
    },
  });
  const identity = await db.serviceIdentity.create({
    data: { workspaceId, name: "disposable-http-e2e" },
  });
  const readToken = await tokenFor(identity.id, "read-only", [
    "adforge:mcp:read",
  ]);
  const writeToken = await tokenFor(identity.id, "write-gated", [
    "adforge:mcp:read",
    "adforge:mcp:write",
  ]);

  for (const path of [
    "/mcp",
    "/mcp/public",
    "/api/v1/mcp/openapi",
    "/api/v1/mcp/rest/commit_preview",
  ]) {
    const response = await request(
      path,
      path.includes("rest") ? { method: "POST" } : {},
    );
    assert.equal(
      response.status,
      path.includes("/rest/") ? 403 : 401,
      `${path} unauthenticated`,
    );
  }
  for (const path of [
    "/api/v1/mcp/public/approval/view",
    "/api/v1/mcp/public/approval",
  ]) {
    const response = await request(path, { method: "POST" });
    assert(
      [401, 403].includes(response.status),
      `${path} browser session required`,
    );
  }
  evidence.unauthenticatedRoutes = 6;

  const initialized = await mcp(readToken, "initialize");
  assert.equal(initialized.result.protocolVersion, "2025-03-26");
  const listing = await mcp(readToken, "tools/list");
  const tools = listing.result.tools;
  const names = new Set(tools.map((tool) => tool.name));
  for (const name of GOOGLE_WRITE_PROFILE_TOOLS) {
    assert(names.has(name), `private write-profile tool missing: ${name}`);
  }
  for (const name of [
    "create_campaign_from_brief",
    "google_ads_change_keyword_match_type_preview",
    "google_ads_bid_budget_preview",
    "google_ads_targeting_preview",
    "google_ads_ads_assets_preview",
    "google_ads_pmax_preview",
    "google_ads_conversion_action_preview",
    "commit_preview",
    "preview_rollback_commit",
  ])
    assert(names.has(name), `acceptance tool missing: ${name}`);
  evidence.privateProfileToolCount = tools.length;
  evidence.privateProfileSchemaCount = tools.filter(
    (tool) => tool.inputSchema?.type === "object",
  ).length;

  const publicWithServiceToken = await request("/mcp/public", {
    method: "POST",
    headers: {
      authorization: `Bearer ${readToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(
    publicWithServiceToken.status,
    401,
    "public route requires OAuth client grant",
  );
  evidence.publicServiceTokenDenied = true;

  const openapi = await request("/api/v1/mcp/openapi", {
    headers: { authorization: `Bearer ${readToken}` },
  });
  assert.equal(openapi.status, 200);
  assert.equal(openapi.body.openapi, "3.1.0");
  assert(
    Object.keys(openapi.body.paths).some((path) =>
      path.includes("google_ads_pmax_preview"),
    ),
  );
  evidence.restOpenApiPaths = Object.keys(openapi.body.paths).length;

  const profileInputs = [
    ["stage0", "create_campaign_from_brief", {}],
    ["stage1", "google_ads_change_keyword_match_type_preview", {}],
    ["stage2", "google_ads_bid_budget_preview", {}],
    ["stage3", "google_ads_targeting_preview", {}],
    ["stage4", "google_ads_ads_assets_preview", {}],
    ["conversion", "google_ads_conversion_action_preview", {}],
    ["rollback", "preview_rollback_commit", {}],
    ["commit", "commit_preview", { preview_token: "invalid-local-preview" }],
  ];
  for (const [stage, name, args] of profileInputs) {
    const reply = await mcp(writeToken, "tools/call", {
      name,
      arguments: args,
    });
    evidence.stageCalls.push({
      stage,
      tool: name,
      code: toolError(reply, name),
    });
  }
  for (const action of [
    "asset_group_update",
    "pmax_asset_attach",
    "pmax_audience_signal_add",
    "pmax_search_theme_add",
    "pmax_negative_add",
    "pmax_brand_exclude",
  ]) {
    const reply = await mcp(writeToken, "tools/call", {
      name: "google_ads_pmax_preview",
      arguments: {
        provider: "GOOGLE_ADS",
        account_id: "8590146099",
        action,
        items: [{}],
      },
    });
    evidence.pmaxCalls.push({ action, code: toolError(reply, action) });
  }

  const rest = await request("/api/v1/mcp/rest/google_ads_pmax_preview", {
    method: "POST",
    headers: {
      authorization: `Bearer ${writeToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      provider: "GOOGLE_ADS",
      account_id: "8590146099",
      action: "pmax_create",
      items: [{}],
    }),
  });
  assert.equal(rest.status, 200);
  assert.equal(rest.body?.isError, true, "REST PMax must fail closed");
  evidence.restPmaxDenied = true;

  const readOnlyWrite = await mcp(readToken, "tools/call", {
    name: "preview_pause_campaign",
    arguments: {
      provider: "GOOGLE_ADS",
      account_id: "8590146099",
      campaign_id: "1",
    },
  });
  evidence.readOnlyWriteCode = toolError(
    readOnlyWrite,
    "read-only write attempt",
  );

  const localAccounts = await mcp(readToken, "tools/call", {
    name: "list_accounts",
    arguments: { provider: "GOOGLE_ADS" },
  });
  assert.equal(
    localAccounts?.result?.isError,
    undefined,
    `local workspace read should succeed: ${localAccounts?.result?.content?.[0]?.text ?? "unknown"}`,
  );
  evidence.localWorkspaceRead = "PASS";

  evidence.localPreviewCount = await db.mcpPreview.count({
    where: { workspaceId },
  });
  evidence.localProviderConnectionCount = await db.providerConnection.count({
    where: { workspaceId },
  });
  evidence.localProviderAccountCount = await db.providerAccount.count({
    where: { workspaceId },
  });
  assert.equal(evidence.localPreviewCount, 0);
  assert.equal(evidence.localProviderConnectionCount, 0);
  assert.equal(evidence.localProviderAccountCount, 0);
  evidence.auditTypes = [
    ...new Set(
      (
        await db.auditEvent.findMany({
          where: { workspaceId },
          select: { eventType: true },
        })
      ).map((row) => row.eventType),
    ),
  ].sort();
  assert(evidence.auditTypes.includes("mcp_tool_executed"));
  console.log(JSON.stringify(evidence));
} finally {
  if (workspaceId) {
    await db.auditEvent.deleteMany({ where: { workspaceId } });
    await db.workspace.delete({ where: { id: workspaceId } });
  }
  await closeDatabase(database);
}

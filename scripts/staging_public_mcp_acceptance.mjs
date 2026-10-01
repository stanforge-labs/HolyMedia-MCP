#!/usr/bin/env node
// Run on the isolated staging VM only. Never performs a provider call or write.
import { execFileSync } from "node:child_process";

const targetSha = "ac083f319304fe95272717a96804ce7349d0ccf4";
const origin = "https://v2-staging-mcp.holymedia.kz";
const containers = ["api", "web", "worker"].map(
  (service) => `hm-public-staging-${service}`,
);
const expectedFlags = {
  PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
  PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  V2_CONFIRMED_WRITE_ENABLED: "false",
  V2_PREVIEW_ONLY: "true",
};

function check(condition, message) {
  if (!condition) throw new Error(message);
}

function docker(...args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 15_000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function inspectRuntime() {
  const images = new Set();
  for (const container of containers) {
    const revision = docker(
      "inspect",
      "--format",
      '{{ index .Config.Labels "org.opencontainers.image.revision" }}',
      container,
    );
    check(revision === targetSha, `${container}: unexpected source revision`);
    images.add(docker("inspect", "--format", "{{.Image}}", container));
  }
  check(images.size === 1, "API, Web and Worker must use one exact image");
  const flagCheck = `const flags=${JSON.stringify(expectedFlags)};for(const [key,want] of Object.entries(flags)){if(process.env[key]!==want)process.exit(1)}`;
  for (const container of [containers[0], containers[2]]) {
    docker("exec", container, "node", "-e", flagCheck);
  }
  console.log("PASS: exact source SHA, shared image, running write flags OFF");
}

async function request(path, options = {}) {
  const url = new URL(path, origin);
  check(url.origin === origin, "refusing cross-origin request");
  const response = await fetch(url, {
    ...options,
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  check(
    response.status < 300 || response.status >= 400,
    `${path}: unexpected redirect; refusing to follow it`,
  );
  return response;
}

async function json(response, label) {
  check(response.ok, `${label}: HTTP ${response.status}`);
  return response.json();
}

async function mcp(token, id, method, params = {}) {
  const response = await request("/mcp/public", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  return json(response, `MCP ${method}`);
}

async function main() {
  inspectRuntime();
  for (const path of ["/health", "/ready"]) {
    check((await request(path)).status === 200, `${path}: expected 200`);
  }
  console.log("PASS: health and ready");

  const unauthenticated = await request("/mcp/public");
  check(unauthenticated.status === 401, "public MCP GET must require auth");
  check(
    unauthenticated.headers
      .get("www-authenticate")
      ?.includes(`${origin}/.well-known/oauth-protected-resource/mcp/public`),
    "public MCP challenge points outside staging",
  );
  const noBearer = await request("/mcp/public", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  check(noBearer.status === 401, "public MCP POST must require auth");
  for (const method of ["GET", "POST"]) {
    const badRoute = await request("/api/v1/mcp/public", { method });
    check(badRoute.status === 404, `prefixed MCP ${method} must be 404`);
  }
  console.log("PASS: public MCP auth boundary and incorrect route");

  const resource = await json(
    await request("/.well-known/oauth-protected-resource/mcp/public"),
    "protected-resource metadata",
  );
  check(
    resource.resource === `${origin}/mcp/public`,
    "resource is not staging",
  );
  check(
    JSON.stringify(resource.authorization_servers) === JSON.stringify([origin]),
    "authorization server is not staging",
  );
  check(
    JSON.stringify(resource.scopes_supported) ===
      JSON.stringify(["adforge:mcp:read"]),
    "write scope is advertised while gate must be OFF",
  );
  const server = await json(
    await request("/.well-known/oauth-authorization-server"),
    "authorization-server metadata",
  );
  check(server.issuer === origin, "OAuth issuer is not staging");
  for (const field of [
    "authorization_endpoint",
    "token_endpoint",
    "registration_endpoint",
    "revocation_endpoint",
  ]) {
    check(
      typeof server[field] === "string" &&
        server[field].startsWith(`${origin}/`),
      `${field} points outside staging`,
    );
  }
  console.log("PASS: staging-only OAuth discovery and write-scope gate OFF");

  const token = process.env.STAGING_OAUTH_READ_TOKEN;
  check(token, "STAGING_OAUTH_READ_TOKEN is required for full read acceptance");
  const listed = await mcp(token, 2, "tools/list");
  const names = listed?.result?.tools?.map((tool) => tool.name);
  check(
    Array.isArray(names) && names.length === 42,
    "public tools count is not 42",
  );
  for (const hidden of ["confirm_preview", "commit_preview"]) {
    check(!names.includes(hidden), `${hidden} unexpectedly listed`);
    const result = await mcp(token, 3, "tools/call", {
      name: hidden,
      arguments: {},
    });
    check(result?.result?.isError === true, `${hidden} was not rejected`);
    const content = JSON.parse(result.result.content[0].text);
    check(
      content.code === "public_operation_not_available",
      `${hidden}: wrong rejection code`,
    );
  }
  // Database-only read. No provider request and no provider mutation.
  const read = await mcp(token, 4, "tools/call", {
    name: "list_connected_resources",
    arguments: {},
  });
  check(read?.result?.isError !== true, "OAuth database-only read failed");
  console.log("PASS: OAuth read, 42 tools, hidden tools rejected");
  console.log("PASS: public staging baseline acceptance (no provider writes)");
}

main().catch((error) => {
  // Do not print URLs, response bodies, tokens, container env or Docker output.
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});

// Read-only readiness probe for an explicitly authorized TEST native MCP origin.
// No credential, OAuth grant, preview, approval, or provider mutation is sent.
import { pathToFileURL } from "node:url";

const TIMEOUT_MS = 5_000;
const PRIVATE_SCOPE = "adforge:mcp:read";

export function validateTestOrigin(input) {
  if (typeof input !== "string" || !input)
    throw new Error("test_origin_required");
  const url = new URL(input);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.hostname === "mcp.holymedia.kz"
  )
    throw new Error("test_origin_not_isolated_or_canonical");
  return url.origin;
}

export function validateDiscovery(origin, resource, authorizationServer) {
  if (
    resource?.resource !== `${origin}/mcp` ||
    !Array.isArray(resource.authorization_servers) ||
    resource.authorization_servers.length !== 1 ||
    resource.authorization_servers[0] !== origin ||
    !resource.scopes_supported?.includes(PRIVATE_SCOPE) ||
    authorizationServer?.issuer !== origin ||
    authorizationServer.authorization_endpoint !==
      `${origin}/oauth/authorize` ||
    authorizationServer.token_endpoint !== `${origin}/oauth/token` ||
    authorizationServer.registration_endpoint !== `${origin}/oauth/register` ||
    !authorizationServer.code_challenge_methods_supported?.includes("S256")
  )
    throw new Error("test_oauth_discovery_mismatch");
}

async function getJson(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "manual",
  });
  if (response.status !== 200)
    throw new Error("test_oauth_metadata_unavailable");
  return response.json();
}

export async function probeTestNativeMcp(input) {
  const origin = validateTestOrigin(input);
  const [resource, authorizationServer] = await Promise.all([
    getJson(`${origin}/.well-known/oauth-protected-resource/mcp`),
    getJson(`${origin}/.well-known/oauth-authorization-server`),
  ]);
  validateDiscovery(origin, resource, authorizationServer);
  const response = await fetch(`${origin}/mcp?profile=google_ads_write`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "unauthenticated-readiness",
      method: "tools/list",
      params: {},
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: "manual",
  });
  if (response.status !== 401)
    throw new Error("test_mcp_unauthenticated_boundary_failed");
  return {
    status: "PASS_UNAUTHENTICATED_READINESS_ONLY",
    origin,
    resource: `${origin}/mcp`,
    oauth_metadata: true,
    pkce_s256: true,
    unauthenticated_mcp_http: response.status,
    client_oauth_and_tools_list: "NOT_TESTED",
    provider_read: 0,
    validate_only: 0,
    provider_write: 0,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(JSON.stringify(await probeTestNativeMcp(process.argv[2])));
  } catch (error) {
    console.error(
      JSON.stringify({
        status: "BLOCKED",
        reason: error instanceof Error ? error.message : "readiness_failed",
        provider_write: 0,
      }),
    );
    process.exitCode = 1;
  }
}

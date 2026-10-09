// One user-authorized TEST key through stock human-authenticated HTTP only.
import { openSync, closeSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { URL } from "node:url";
import process from "node:process";
import { canonical } from "./live-guard.mjs";
const { Headers } = globalThis;
export const fail = (code) => {
  throw new Error(code);
};
export function assertKeyRuntime(env) {
  const expected = {
    STAGE234_KEY_ISSUANCE_AUTHORIZED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
    PROVIDER_GOOGLE_LOGIN_CUSTOMER_ID: "4378327049",
    PROVIDER_GOOGLE_API_VERSION: "v24",
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED: "false",
    PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED: "false",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  };
  if (Object.entries(expected).some(([k, v]) => env[k] !== v))
    fail("stage234_key_runtime_not_authorized");
}
export function keyRequest(authority) {
  if (
    !authority ||
    !/^[a-f0-9-]{36}$/.test(authority.workspace_id ?? "") ||
    !/^[a-f0-9-]{36}$/.test(authority.account_id ?? "") ||
    authority.customer_id !== "8590146099" ||
    authority.owner_confirmed !== true ||
    !/^HM_TEST_STAGE234_[0-9]{8}T[0-9]{6}Z$/.test(authority.name ?? "")
  )
    fail("stage234_key_authority_invalid");
  return {
    name: authority.name,
    scopes: ["adforge:mcp:read", "adforge:mcp:write"],
    accountIds: [authority.account_id],
    resourceAccessMode: "STATIC_ALLOWLIST",
    expiresInDays: 1,
  };
}
export function validateKeyRequest(input, init = {}, { env, authority } = {}) {
  assertKeyRuntime(env);
  if (typeof input !== "string" && !(input instanceof URL))
    fail("stage234_key_request_object_blocked");
  const url = new URL(input),
    method = String(init.method ?? "GET").toUpperCase();
  if (
    url.origin !== "http://127.0.0.1:4000" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    fail("stage234_key_external_or_provider_transport_blocked");
  if (
    method === "GET" &&
    ["/health", "/ready", "/api/v1/auth/csrf", "/api/v1/auth/session"].includes(
      url.pathname,
    )
  )
    return "local_read";
  if (
    method === "POST" &&
    url.pathname === "/api/v1/auth/login" &&
    canonical(JSON.parse(init.body)) ===
      canonical({
        email: "google-acceptance@local.invalid",
        password: env.ACCEPTANCE_PASSWORD,
      }) &&
    typeof env.ACCEPTANCE_PASSWORD === "string" &&
    env.ACCEPTANCE_PASSWORD.length > 0
  )
    return "human_login";
  const body = keyRequest(authority),
    path = `/api/v1/workspaces/${authority.workspace_id}/service-tokens`;
  if (method === "GET" && url.pathname === path) return "key_list";
  if (
    method === "POST" &&
    url.pathname === path &&
    canonical(JSON.parse(init.body)) === canonical(body)
  ) {
    const headers = new Headers(init.headers),
      cookie = headers.get("cookie") ?? "",
      csrf = cookie
        .split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith("hm_v2_csrf="))
        ?.slice(11);
    if (
      headers.get("authorization") ||
      headers.get("origin") !== "http://localhost:4402" ||
      !cookie.includes("hm_v2_session=") ||
      !csrf ||
      headers.get("x-csrf-token") !== csrf
    )
      fail("stage234_key_human_auth_csrf_required");
    return "key_create";
  }
  if (
    method === "POST" &&
    url.pathname === "/mcp" &&
    canonical(JSON.parse(init.body)) ===
      canonical({
        jsonrpc: "2.0",
        id: "stage234-key-access",
        method: "tools/list",
        params: {},
      })
  )
    return "mcp_access_read";
  fail("stage234_key_unapproved_route_or_body_blocked");
}
export function claimKeyCreate(root) {
  let fd;
  try {
    fd = openSync(join(root, "issued-once.claim"), "wx", 0o600);
  } catch {
    fail("stage234_key_already_attempted_no_second_key");
  }
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        customer_id: "8590146099",
        issued_request_at: new Date().toISOString(),
      }),
    );
  } finally {
    closeSync(fd);
  }
}
export function installKeyGuard(env = process.env) {
  assertKeyRuntime(env);
  if (globalThis.__hmKeyGuard) return;
  globalThis.__hmKeyGuard = true;
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    let authority;
    try {
      authority = JSON.parse(
        readFileSync(join(env.STAGE234_KEY_RUN_DIR, "authority.json"), "utf8"),
      );
    } catch {
      /* Missing authority blocks requests that require it. */
    }
    const type = validateKeyRequest(input, init, { env, authority });
    if (type === "key_create") claimKeyCreate(env.STAGE234_KEY_AUTHORITY_DIR);
    return nativeFetch(input, { ...init, redirect: "error" });
  };
}
if (process.env.STAGE234_KEY_GUARD_PRELOAD === "1") installKeyGuard();

// Independent diagnostic process. Even commit-enabled config cannot mutate.
import process from "node:process";
import { URL } from "node:url";
import { createHash } from "node:crypto";
import { timestampMillis } from "./timestamp.mjs";
export function assertReadinessKey(context, key, account, now = Date.now()) {
  const expiry = timestampMillis(key?.expiresAt);
  const scopes = [...(Array.isArray(key?.scopes) ? key.scopes : [])].sort();
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(
      context?.key_id ?? "",
    ) ||
    key?.id !== context.key_id ||
    typeof context.service_token !== "string" ||
    key.tokenDigest !==
      createHash("sha256").update(context.service_token).digest("hex") ||
    !Number.isFinite(expiry) ||
    expiry !== timestampMillis(context.expires_at) ||
    expiry <= now ||
    expiry > now + 86400000 ||
    key.revokedAt ||
    !key.serviceIdentity?.createdById ||
    key.serviceIdentity.revokedAt ||
    key.resourceAccessMode !== "STATIC_ALLOWLIST" ||
    JSON.stringify(scopes) !== '["adforge:mcp:read","adforge:mcp:write"]' ||
    !account?.enabled ||
    account.externalAccountId !== "8590146099" ||
    account.provider !== "GOOGLE_ADS" ||
    account.workspaceId !== key.serviceIdentity.workspaceId ||
    JSON.stringify(key.accountIds) !== JSON.stringify([account.id])
  )
    throw Error("stage234_readiness_key_invalid");
}
export function diagnosticRequest(input, init = {}) {
  const url = new URL(String(input));
  const method = String(init.method ?? "GET").toUpperCase();
  if (
    url.origin !== "http://127.0.0.1:4000" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw Error("stage234_readiness_external_request_blocked");
  if (method === "GET" && ["/health", "/ready"].includes(url.pathname))
    return "health";
  if (method === "POST" && url.pathname === "/mcp") {
    const rpc = JSON.parse(init.body);
    if (rpc.jsonrpc === "2.0" && rpc.method === "tools/list" && !rpc.params)
      return "tools";
    if (
      rpc.jsonrpc === "2.0" &&
      rpc.method === "tools/call" &&
      ((rpc.params?.name === "list_accounts" &&
        JSON.stringify(rpc.params.arguments) === '{"provider":"GOOGLE_ADS"}') ||
        (rpc.params?.name === "get_account_status" &&
          JSON.stringify(rpc.params.arguments) ===
            '{"provider":"GOOGLE_ADS","account_id":"8590146099"}'))
    )
      return "read";
  }
  throw Error("stage234_readiness_non_read_request_blocked");
}
export const readinessOnlyFetch =
  (native) =>
  (input, init = {}) => {
    diagnosticRequest(input, init);
    return native(input, { ...init, redirect: "error" });
  };
if (process.env.STAGE234_RUNTIME_READINESS_PRELOAD === "1")
  globalThis.fetch = readinessOnlyFetch(globalThis.fetch);

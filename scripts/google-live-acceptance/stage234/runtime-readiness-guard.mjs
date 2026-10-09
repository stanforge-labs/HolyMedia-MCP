// Independent diagnostic process. Even commit-enabled config cannot mutate.
import process from "node:process";
import { URL } from "node:url";
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

// Negative authorization test: every external transport is forbidden.
import { appendFileSync } from "node:fs";
const nativeFetch = globalThis.fetch;
export const input = {
  provider: "GOOGLE_ADS",
  account_id: "4378327049",
  entity_type: "keyword",
  items: [
    {
      campaign_id: "24324170853",
      ad_group_id: "206587491811",
      criterion_id: "11743561",
    },
  ],
};
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
export function denialProven(isError, externalAttempted, previewCountChanged) {
  return (
    isError === true &&
    externalAttempted === false &&
    previewCountChanged === false
  );
}
export function permitted(input_, init = {}) {
  const url = new URL(
    typeof input_ === "string" ? input_ : (input_.url ?? String(input_)),
  );
  const method = (init.method ?? input_.method ?? "GET").toUpperCase();
  if (url.origin !== "http://127.0.0.1:4000" || url.hash || url.search)
    return false;
  if (method === "GET" && ["/health", "/ready"].includes(url.pathname))
    return true;
  const rpc = JSON.parse(init.body ?? "{}");
  return (
    method === "POST" &&
    url.pathname === "/mcp" &&
    rpc.jsonrpc === "2.0" &&
    rpc.method === "tools/call" &&
    rpc.params?.name === "pause_entities_preview" &&
    canonical(rpc.params.arguments) === canonical(input)
  );
}
globalThis.fetch = async (input_, init = {}) => {
  if (!permitted(input_, init)) {
    appendFileSync(
      (process.env.ACCEPTANCE_STATE_DIR ?? "/acceptance-state") +
        "/acceptance-p-blocked-transport.jsonl",
      JSON.stringify({ external_attempt_blocked: true }) + "\n",
      { mode: 0o600 },
    );
    throw new Error("acceptance_p_external_transport_forbidden");
  }
  return nativeFetch(input_, { ...init, redirect: "error" });
};

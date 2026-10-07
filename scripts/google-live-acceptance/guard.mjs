// Acceptance-only preload. Does not replace the exact-source application.
import { appendFileSync } from "node:fs";
const nativeFetch = globalThis.fetch;
const allowed = new Set(["4378327049", "8590146099"]);
const record = (value) =>
  appendFileSync(
    `${process.env.ACCEPTANCE_STATE_DIR ?? "/acceptance-state"}/provider-counts.jsonl`,
    JSON.stringify(value) + "\n",
    { mode: 0o600 },
  );
export function validateRequest(input, init = {}) {
  const url = new URL(
    typeof input === "string" ? input : (input.url ?? String(input)),
  );
  if (url.hostname !== "googleads.googleapis.com") return { google: false };
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("acceptance_provider_origin_blocked");
  const method = (init.method ?? input.method ?? "GET").toUpperCase();
  if (
    url.pathname === "/v24/customers:listAccessibleCustomers" &&
    method === "GET"
  )
    return { google: true, accessible: true };
  const match = url.pathname.match(
    /^\/v24\/customers\/(4378327049|8590146099)\/googleAds:(search|searchStream)$/,
  );
  if (!match || method !== "POST")
    throw new Error("acceptance_customer_or_write_blocked");
  const headers = new Headers(init.headers ?? input.headers);
  if (headers.get("login-customer-id") !== "4378327049")
    throw new Error("acceptance_login_customer_mismatch");
  const query = JSON.parse(init.body).query;
  if (
    typeof query !== "string" ||
    !/^SELECT\s/i.test(query) ||
    !/\sFROM\s+customer(?:_client)?(?:\s|$)/i.test(query) ||
    /\sFROM\s+(?!customer(?:_client)?(?:\s|$))/i.test(query)
  )
    throw new Error("acceptance_metadata_only");
  return { google: true, accessible: false, customer: match[1] };
}
export function validateAccessible(payload) {
  if (
    !Array.isArray(payload.resourceNames) ||
    payload.resourceNames.some((x) => !/^customers\/\d{10}$/.test(x))
  )
    throw new Error("acceptance_accessible_response_invalid");
  const ids = payload.resourceNames.map((x) => x.split("/")[1]);
  if (ids.some((x) => !allowed.has(x))) {
    record({ type: "unexpected_accessible_ids", ids });
    throw new Error("acceptance_unexpected_hierarchy_stop");
  }
}
globalThis.fetch = async (input, init = {}) => {
  const checked = validateRequest(input, init);
  if (checked.google)
    record({ type: "read", customer: checked.customer ?? null });
  const response = await nativeFetch(input, { ...init, redirect: "error" });
  if (checked.accessible && response.ok)
    validateAccessible(await response.clone().json());
  if (checked.customer && response.ok) {
    const payload = await response.clone().json();
    const rows = (Array.isArray(payload) ? payload : [payload]).flatMap(
      (x) => x.results ?? [],
    );
    const ids = rows.flatMap((x) =>
      x.customerClient
        ? [
            String(
              x.customerClient.id ??
                x.customerClient.clientCustomer?.split("/").pop(),
            ),
          ]
        : [],
    );
    if (ids.some((x) => !allowed.has(x))) {
      record({ type: "unexpected_hierarchy_ids", ids });
      throw new Error("acceptance_unexpected_hierarchy_stop");
    }
  }
  return response;
};

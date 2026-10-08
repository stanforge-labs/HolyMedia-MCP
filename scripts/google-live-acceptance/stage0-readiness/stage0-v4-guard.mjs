// Acceptance-only transport. Every actual mutation and self-approval is denied.
import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  openSync,
  closeSync,
} from "node:fs";
import { canonical, hierarchyQuery } from "./stage0-v4-contract.mjs";
const nativeFetch = globalThis.fetch,
  root = () => process.env.ACCEPTANCE_STATE_DIR ?? "/acceptance-state";
// Load shared query definitions now; then replace their read-only preload with
// this stricter Stage0 guard using the captured native transport exactly once.
await import("./reconcile-read-guard.mjs");
export const prefix = "acceptance-stage0-readiness-v4-20261008";
export const step = {
  prefix,
  phase: "readiness",
  identity: { criterion_id: "11479221" },
  input: null,
};
export const validation = null,
  mutation = null;
const tables = new Set([
  "customer",
  "campaign",
  "campaign_budget",
  "campaign_criterion",
  "ad_group",
  "ad_group_criterion",
  "ad_group_ad",
  "asset",
  "campaign_asset",
  "geo_target_constant",
  "language_constant",
  "conversion_action",
  "customer_conversion_goal",
  "campaign_conversion_goal",
  "conversion_goal_campaign_config",
  "custom_conversion_goal",
  "shared_set",
  "shared_criterion",
  "campaign_shared_set",
]);
export function validateRequest(input, init = {}) {
  const u = new URL(
      typeof input === "string" ? input : (input.url ?? String(input)),
    ),
    method = (init.method ?? input.method ?? "GET").toUpperCase();
  if (u.search || u.hash || u.username || u.password)
    throw Error("stage0_url_blocked");
  if (u.origin === "http://127.0.0.1:4000") {
    if (method === "GET" && ["/health", "/ready"].includes(u.pathname))
      return "health";
    const rpc = JSON.parse(init.body ?? "{}"),
      prepared = JSON.parse(
        readFileSync(root() + "/" + prefix + "-inputs.json", "utf8"),
      );
    if (
      method !== "POST" ||
      u.pathname !== "/mcp" ||
      rpc.jsonrpc !== "2.0" ||
      rpc.method !== "tools/call"
    )
      throw Error("stage0_internal_route_blocked");
    if (
      rpc.params?.name === "get_launch_checklist" &&
      canonical(rpc.params.arguments) ===
        canonical({
          provider: "GOOGLE_ADS",
          account_id: "8590146099",
          campaign_id: "24324170853",
        })
    )
      return "checklist";
    if (
      rpc.params?.name === "create_campaign_from_brief" &&
      canonical(rpc.params.arguments) === canonical(prepared.invalid)
    )
      return "invalid_rsa";
    if (
      process.env.ACCEPTANCE_STAGE0_MODE === "preview" &&
      rpc.params?.name === "create_campaign_from_brief" &&
      canonical(rpc.params.arguments) === canonical(prepared.brief)
    )
      return "preview";
    throw Error("stage0_commit_approval_or_replacement_blocked");
  }
  if (
    u.origin === "https://oauth2.googleapis.com" &&
    u.pathname === "/token" &&
    method === "POST" &&
    new URLSearchParams(init.body).get("grant_type") === "refresh_token"
  )
    return "oauth_refresh";
  if (
    u.origin !== "https://googleads.googleapis.com" ||
    method !== "POST" ||
    new Headers(init.headers).get("login-customer-id") !== "4378327049"
  )
    throw Error("stage0_provider_origin_or_login_blocked");
  const body = JSON.parse(init.body ?? "{}");
  if (
    u.pathname === "/v24/customers/4378327049/googleAds:searchStream" &&
    canonical(body) === canonical({ query: hierarchyQuery })
  )
    return "read_mcc";
  if (
    u.pathname === "/v24/geoTargetConstants:suggest" &&
    canonical(body) ===
      canonical({
        locale: "ru",
        countryCode: "KZ",
        locationNames: { names: ["Алматы"] },
      })
  )
    return "read";
  if (u.pathname === "/v24/customers/8590146099/googleAds:searchStream") {
    const q = body.query,
      table =
        typeof q === "string"
          ? q.match(/\sFROM\s+([a-z_]+)(?:\s|$)/i)?.[1]
          : null;
    if (
      Object.keys(body).join(",") !== "query" ||
      typeof q !== "string" ||
      !q.startsWith("SELECT ") ||
      q.includes(";") ||
      !tables.has(table) ||
      /customers\/(?!8590146099(?:\/|$))\d+/.test(q)
    )
      throw Error("stage0_query_blocked");
    return "read";
  }
  if (u.pathname === "/v24/customers/8590146099/googleAds:mutate") {
    if (
      process.env.ACCEPTANCE_STAGE0_MODE !== "preview" ||
      process.env.V2_PREVIEW_ONLY !== "true" ||
      process.env.V2_CONFIRMED_WRITE_ENABLED !== "false" ||
      process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED !== "true" ||
      process.env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST !== "8590146099" ||
      process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED !== "false" ||
      process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED !== "false"
    )
      throw Error("stage0_real_mutation_blocked");
    const prepared = JSON.parse(
        readFileSync(root() + "/" + prefix + "-prepared-plan.json", "utf8"),
      ),
      proof = JSON.parse(
        readFileSync(
          root() + "/" + prefix + "-preview-test-proof.json",
          "utf8",
        ),
      );
    if (
      proof.customer_id !== "8590146099" ||
      proof.test_account !== true ||
      proof.hierarchy !== true ||
      Date.now() - Date.parse(proof.verified_at) > 300000 ||
      canonical(body) !==
        canonical({
          mutateOperations: prepared.provider_operations,
          validateOnly: true,
          partialFailure: false,
        })
    )
      throw Error("stage0_atomic_validation_payload_or_proof_invalid");
    return "validate_only";
  }
  throw Error("stage0_other_account_or_mutation_blocked");
}
globalThis.fetch = async (input, init = {}) => {
  const type = validateRequest(input, init);
  if (type === "validate_only") {
    const fd = openSync(
      root() + "/" + prefix + "-validation.claim",
      "wx",
      0o600,
    );
    closeSync(fd);
  }
  if (["read", "read_mcc", "validate_only", "oauth_refresh"].includes(type))
    for (const n of [
      "provider-counts.jsonl",
      prefix +
        "-" +
        (process.env.ACCEPTANCE_STAGE0_MODE ?? "prepare") +
        "-calls.jsonl",
    ])
      appendFileSync(
        root() + "/" + n,
        JSON.stringify({
          type: type === "read_mcc" ? "read" : type,
          customer:
            type === "oauth_refresh"
              ? null
              : type === "read_mcc"
                ? "4378327049"
                : "8590146099",
          purpose: prefix,
        }) + "\n",
        { mode: 0o600 },
      );
  const response = await nativeFetch(input, { ...init, redirect: "error" });
  if (["read", "read_mcc"].includes(type) && !response.ok) {
    const body = await response.clone().json(),
      error = (Array.isArray(body) ? body[0]?.error : body.error) ?? body;
    const safe = {
      http_status: response.status,
      status: error?.status ?? null,
      table:
        JSON.parse(init.body).query.match(/\sFROM\s+([a-z_]+)/i)?.[1] ?? null,
      errors: (error?.details ?? [])
        .flatMap((d) => d.errors ?? [])
        .map((e) => ({
          google_code: e.errorCode ?? null,
          field_path:
            e.location?.fieldPathElements?.map((p) => p.fieldName) ?? [],
          unrecognized_field:
            typeof e.message === "string"
              ? (e.message.match(/Unrecognized field[^']*'([^']+)'/i)?.[1] ??
                null)
              : null,
        })),
    };
    writeFileSync(
      root() + "/" + prefix + "-provider-error.json",
      JSON.stringify(safe),
      { mode: 0o600, flag: "wx" },
    );
  }
  if (type === "validate_only")
    writeFileSync(
      root() + "/" + prefix + "-validation.json",
      JSON.stringify({
        http_status: response.status,
        validate_only: true,
        partial_failure: false,
        operation_count: JSON.parse(init.body).mutateOperations.length,
      }),
      { mode: 0o600, flag: "wx" },
    );
  return response;
};

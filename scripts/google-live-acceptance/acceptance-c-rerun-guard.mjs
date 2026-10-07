// C mixed preview: all 20 review rows, exactly 19 validated status operations; no real writes.
import {
  appendFileSync,
  readFileSync,
  openSync,
  closeSync,
  writeFileSync,
} from "node:fs";
const nativeFetch = globalThis.fetch;
const { validateReconcileRequest, fixtureResources } =
  await import("./reconcile-read-guard.mjs");
export const identity = Object.freeze({
  campaign_id: "24324170853",
  ad_group_id: "206587491811",
  criterion_id: "11743561",
  resource_name: "customers/8590146099/adGroupCriteria/206587491811~11743561",
});
export const invalidCriterionId = "999999999999";
export const batchIdentities = [
  ...fixtureResources.ad_group_criterion
    .filter((name) => name !== identity.resource_name)
    .map((name) => ({
      ...identity,
      criterion_id: name.split("~").at(-1),
      resource_name: name,
    })),
  {
    ...identity,
    criterion_id: invalidCriterionId,
    resource_name:
      "customers/8590146099/adGroupCriteria/206587491811~" + invalidCriterionId,
  },
];
export const toolArguments = Object.freeze({
  provider: "GOOGLE_ADS",
  account_id: "8590146099",
  entity_type: "keyword",
  items: batchIdentities,
});
export const keywordQuery = `SELECT campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status, ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.type FROM ad_group_criterion WHERE ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = FALSE AND ad_group_criterion.resource_name IN ('${identity.resource_name}')`;
export const batchQuery = keywordQuery.replace(
  "'" + identity.resource_name + "'",
  batchIdentities.map((row) => "'" + row.resource_name + "'").join(", "),
);
export const exactValidation = {
  operations: batchIdentities.slice(0, 19).map((row) => ({
    update: { resourceName: row.resource_name, status: "PAUSED" },
    updateMask: "status",
  })),
  validateOnly: true,
  partialFailure: true,
};
const canonical = (value) =>
  JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((k) => [k, item[k]]),
        )
      : item,
  );
const root = () => process.env.ACCEPTANCE_STATE_DIR ?? "/acceptance-state";
export function validateAcceptanceCRequest(input, init = {}) {
  const url = new URL(
      typeof input === "string" ? input : (input.url ?? String(input)),
    ),
    method = (init.method ?? input.method ?? "GET").toUpperCase();
  if (url.origin === "http://127.0.0.1:4000" && !url.search && !url.hash) {
    if (method === "GET" && ["/health", "/ready"].includes(url.pathname))
      return "internal_health";
    const rpc = typeof init.body === "string" ? JSON.parse(init.body) : {};
    if (
      method === "POST" &&
      url.pathname === "/mcp" &&
      rpc.jsonrpc === "2.0" &&
      rpc.method === "tools/call" &&
      rpc.params?.name === "pause_entities_preview" &&
      canonical(rpc.params.arguments) === canonical(toolArguments)
    )
      return "internal_preview";
    throw new Error("acceptance_c_rerun_approval_or_commit_blocked");
  }
  if (
    url.hostname === "googleads.googleapis.com" &&
    url.pathname.endsWith(":mutate")
  ) {
    if (
      url.origin !== "https://googleads.googleapis.com" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      method !== "POST" ||
      url.pathname !== "/v24/customers/8590146099/adGroupCriteria:mutate" ||
      new Headers(init.headers).get("login-customer-id") !== "4378327049"
    )
      throw new Error("acceptance_c_rerun_mutation_endpoint_blocked");
    const body = JSON.parse(init.body);
    if (canonical(body) !== canonical(exactValidation))
      throw new Error("acceptance_c_rerun_real_write_or_payload_blocked");
    if (
      process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED !== "true" ||
      process.env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST !== "8590146099" ||
      process.env.V2_PREVIEW_ONLY !== "true" ||
      process.env.V2_CONFIRMED_WRITE_ENABLED !== "false" ||
      process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED !== "false" ||
      process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED !== "false"
    )
      throw new Error("acceptance_c_rerun_gate_invalid");
    const proof = JSON.parse(
        readFileSync(root() + "/acceptance-c-rerun-proof.json", "utf8"),
      ),
      age = Date.now() - Date.parse(proof.verified_at);
    if (
      proof.customer_id !== "8590146099" ||
      proof.test_account !== true ||
      proof.mcc_id !== "4378327049" ||
      proof.status !== "ENABLED" ||
      proof.resource_name !== identity.resource_name ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 30 * 60000
    )
      throw new Error("acceptance_c_rerun_test_proof_invalid");
    return "validate_only";
  }
  if (
    url.hostname === "googleads.googleapis.com" &&
    url.pathname === "/v24/customers/8590146099/googleAds:searchStream" &&
    method === "POST" &&
    new Headers(init.headers).get("login-customer-id") === "4378327049" &&
    !url.search &&
    !url.hash &&
    url.origin === "https://googleads.googleapis.com" &&
    !url.username &&
    !url.password &&
    [
      canonical({ query: keywordQuery }),
      canonical({ query: batchQuery }),
      ...batchIdentities.map((row) =>
        canonical({
          query: keywordQuery.replace(
            identity.resource_name,
            row.resource_name,
          ),
        }),
      ),
    ].includes(canonical(JSON.parse(init.body)))
  )
    return "read";
  return validateReconcileRequest(input, init);
}
export function claimValidation() {
  let fd;
  try {
    fd = openSync(root() + "/acceptance-c-rerun-validate.claim", "wx", 0o600);
  } catch {
    throw new Error("acceptance_c_rerun_validation_already_attempted_stop");
  }
  try {
    writeFileSync(
      fd,
      JSON.stringify({
        test: "C",
        resource_name: identity.resource_name,
        validate_only: true,
        attempted_at: new Date().toISOString(),
      }),
    );
  } finally {
    closeSync(fd);
  }
}
globalThis.fetch = async (input, init = {}) => {
  const type = validateAcceptanceCRequest(input, init);
  if (type === "validate_only") claimValidation();
  if (["read", "validate_only", "oauth_refresh"].includes(type)) {
    const event = {
      type,
      customer: type === "oauth_refresh" ? null : "8590146099",
      purpose: "acceptance_c_rerun_keyword_pause_preview",
    };
    appendFileSync(
      root() + "/provider-counts.jsonl",
      JSON.stringify(event) + "\n",
      { mode: 0o600 },
    );
    appendFileSync(
      root() + "/acceptance-c-rerun-calls.jsonl",
      JSON.stringify(event) + "\n",
      { mode: 0o600 },
    );
  }
  const response = await nativeFetch(input, { ...init, redirect: "error" });
  if (type === "validate_only")
    writeFileSync(
      root() + "/acceptance-c-rerun-validation.json",
      JSON.stringify({
        http_status: response.status,
        validate_only: true,
        partial_failure: true,
        operations: exactValidation.operations,
      }),
      { mode: 0o600 },
    );
  return response;
};

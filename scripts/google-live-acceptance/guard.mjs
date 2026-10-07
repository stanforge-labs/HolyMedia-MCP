// Acceptance-only preload. Does not replace the exact-source application.
import { appendFileSync, readFileSync } from "node:fs";
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
  const headers = new Headers(init.headers ?? input.headers);
  if (headers.get("login-customer-id") !== "4378327049")
    throw new Error("acceptance_login_customer_mismatch");
  const body = typeof init.body === "string" ? JSON.parse(init.body) : {};
  if (url.pathname === "/v24/geoTargetConstants:suggest" && method === "POST") {
    if (
      body.locale !== "ru" ||
      body.countryCode !== "KZ" ||
      JSON.stringify(body.locationNames?.names) !== JSON.stringify(["Алматы"])
    )
      throw new Error("acceptance_geo_request_blocked");
    return {
      google: true,
      customer: "8590146099",
      purpose: "fixture_geo_resolution",
    };
  }
  if (
    url.pathname === "/v24/customers/8590146099/googleAds:mutate" &&
    method === "POST"
  ) {
    verifyPreviewGate();
    if (
      body.validateOnly !== true ||
      body.partialFailure !== false ||
      !Array.isArray(body.mutateOperations) ||
      !body.mutateOperations.length ||
      body.mutateOperations.length > 500
    )
      throw new Error("acceptance_real_write_blocked");
    const allowedOperations = new Set([
      "campaignBudgetOperation",
      "campaignOperation",
      "campaignCriterionOperation",
      "adGroupOperation",
      "adGroupCriterionOperation",
      "adGroupAdOperation",
      "campaignConversionGoalOperation",
    ]);
    for (const operation of body.mutateOperations) {
      const keys = Object.keys(operation);
      const value = operation[keys[0]];
      if (
        keys.length !== 1 ||
        !allowedOperations.has(keys[0]) ||
        Object.keys(value).join(",") !== "create"
      )
        throw new Error("acceptance_fixture_operation_blocked");
      const create = value.create;
      if (
        [
          "campaignOperation",
          "adGroupOperation",
          "adGroupAdOperation",
        ].includes(keys[0]) &&
        create.status !== "PAUSED"
      )
        throw new Error("acceptance_delivery_must_be_paused");
      if (
        keys[0] === "campaignOperation" &&
        !/^HM_MCP_WRITE_ACCEPTANCE_\d{8}T\d{6}Z$/.test(create.name)
      )
        throw new Error("acceptance_fixture_name_invalid");
      if (/customers\/(?!8590146099(?:\/|$))\d+/.test(JSON.stringify(create)))
        throw new Error("acceptance_foreign_resource_blocked");
    }
    return {
      google: true,
      customer: "8590146099",
      validateOnly: true,
      operationCount: body.mutateOperations.length,
    };
  }
  const match = url.pathname.match(
    /^\/v24\/customers\/(4378327049|8590146099)\/googleAds:(search|searchStream)$/,
  );
  if (!match || method !== "POST")
    throw new Error("acceptance_customer_or_write_blocked");
  const query = body.query;
  if (typeof query !== "string" || !/^SELECT\s/i.test(query) || /;/.test(query))
    throw new Error("acceptance_metadata_only");
  const table = query.match(/\sFROM\s+([a-z_]+)(?:\s|$)/i)?.[1]?.toLowerCase();
  const metadata = new Set(["customer", "customer_client"]);
  const fixtureTables = new Set([
    ...metadata,
    "campaign",
    "geo_target_constant",
    "language_constant",
    "conversion_action",
    "customer_conversion_goal",
    "campaign_conversion_goal",
    "ad_group_criterion",
    "campaign_criterion",
    "shared_set",
    "shared_criterion",
    "campaign_shared_set",
  ]);
  if (
    !metadata.has(table) &&
    (match[1] !== "8590146099" || !fixtureTables.has(table))
  )
    throw new Error("acceptance_metadata_only");
  return {
    google: true,
    accessible: false,
    customer: match[1],
    hierarchy: /\sFROM\s+customer_client(?:\s|$)/i.test(query),
  };
}
export function verifyPreviewGate() {
  if (
    process.env.PROVIDER_GOOGLE_ADS_WRITE_ENABLED !== "true" ||
    process.env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST !== "8590146099" ||
    process.env.PUBLIC_MCP_WRITE_SCOPE_ENABLED !== "false" ||
    process.env.PUBLIC_MCP_CONTROLLED_WRITE_ENABLED !== "false" ||
    process.env.V2_CONFIRMED_WRITE_ENABLED !== "false" ||
    process.env.V2_PREVIEW_ONLY !== "true"
  )
    throw new Error("acceptance_preview_gate_invalid");
  const proof = JSON.parse(
    readFileSync(
      `${process.env.ACCEPTANCE_STATE_DIR ?? "/acceptance-state"}/test-proof.json`,
      "utf8",
    ),
  );
  const age = Date.now() - Date.parse(proof.verified_at);
  if (
    proof.customer_id !== "8590146099" ||
    proof.test_account !== true ||
    proof.mcc_id !== "4378327049" ||
    proof.hierarchy !== true ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > 30 * 60_000
  )
    throw new Error("acceptance_test_proof_invalid");
}
export function validateAccessible(payload) {
  if (
    !Array.isArray(payload.resourceNames) ||
    payload.resourceNames.some((x) => !/^customers\/\d{10}$/.test(x))
  )
    throw new Error("acceptance_accessible_response_invalid");
  const ids = payload.resourceNames.map((x) => x.split("/")[1]);
  if (!ids.includes("4378327049"))
    throw new Error("acceptance_test_mcc_not_accessible");
  const resourceNames = payload.resourceNames.filter((name) =>
    allowed.has(name.split("/")[1]),
  );
  record({
    type: "accessible_filter",
    accessible_count: ids.length,
    ignored_count: ids.length - resourceNames.length,
  });
  return { ...payload, resourceNames };
}
export function validateHierarchy(payload) {
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
globalThis.fetch = async (input, init = {}) => {
  const checked = validateRequest(input, init);
  // Probe hierarchy IDs only before the exact-source adapter asks for names/data.
  // Unexpected children are detected without fetching their descriptive metadata.
  if (checked.hierarchy) {
    record({
      type: "read",
      customer: checked.customer,
      purpose: "hierarchy_ids_only",
    });
    const probe = await nativeFetch(input, {
      ...init,
      redirect: "error",
      body: JSON.stringify({
        query:
          "SELECT customer_client.id, customer_client.client_customer, customer_client.level FROM customer_client WHERE customer_client.level <= 1",
      }),
    });
    if (!probe.ok) return probe;
    validateHierarchy(await probe.json());
  }
  if (checked.google)
    record({
      type: checked.validateOnly ? "validate_only" : "read",
      customer: checked.customer ?? null,
      ...(checked.validateOnly
        ? { operation_count: checked.operationCount, partial_failure: false }
        : {}),
    });
  const response = await nativeFetch(input, { ...init, redirect: "error" });
  if (checked.accessible && response.ok)
    return new Response(
      JSON.stringify(validateAccessible(await response.json())),
      {
        status: response.status,
        headers: { "content-type": "application/json" },
      },
    );
  if (checked.hierarchy && response.ok)
    validateHierarchy(await response.clone().json());
  return response;
};

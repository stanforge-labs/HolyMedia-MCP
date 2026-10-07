import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
process.env.ACCEPTANCE_STATE_DIR = mkdtempSync(
  join(tmpdir(), "google-acceptance-c-rerun-"),
);
const nativeCalls = [];
globalThis.fetch = async (input) => {
  nativeCalls.push(String(input));
  return Response.json({ ok: true });
};
const {
  validateAcceptanceCRequest,
  claimValidation,
  exactValidation,
  identity,
  toolArguments,
  batchIdentities,
  batchQuery,
  keywordQuery,
} = await import("./acceptance-c-rerun-guard.mjs");
const endpoint =
  "https://googleads.googleapis.com/v24/customers/8590146099/adGroupCriteria:mutate";
const request = (body) => ({
  method: "POST",
  headers: { "login-customer-id": "4378327049" },
  body: JSON.stringify(body),
});

test("global guard allows local health through mocked transport but rejects commit before transport", async () => {
  assert.equal((await fetch("http://127.0.0.1:4000/ready")).status, 200);
  await assert.rejects(
    fetch(
      "http://127.0.0.1:4000/mcp",
      request({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "commit_preview", arguments: {} },
      }),
    ),
    /blocked/,
  );
  assert.deepEqual(nativeCalls, ["http://127.0.0.1:4000/ready"]);
});
test("only exact 19 existing plus 1 invalid criterion PAUSE validate-only passes; real/mixed/foreign payloads rejected", () => {
  Object.assign(process.env, {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
    V2_PREVIEW_ONLY: "true",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
  });
  writeFileSync(
    join(process.env.ACCEPTANCE_STATE_DIR, "acceptance-c-rerun-proof.json"),
    JSON.stringify({
      customer_id: "8590146099",
      test_account: true,
      mcc_id: "4378327049",
      status: "ENABLED",
      resource_name: identity.resource_name,
      verified_at: new Date().toISOString(),
    }),
  );
  assert.equal(
    validateAcceptanceCRequest(endpoint, request(exactValidation)),
    "validate_only",
  );
  for (const body of [
    { ...exactValidation, validateOnly: false },
    { ...exactValidation, partialFailure: false },
    {
      ...exactValidation,
      operations: [
        ...exactValidation.operations,
        ...exactValidation.operations,
      ],
    },
    {
      ...exactValidation,
      operations: [
        {
          update: { resourceName: identity.resource_name, status: "ENABLED" },
          updateMask: "status",
        },
      ],
    },
    { ...exactValidation, operations: [{ create: { status: "PAUSED" } }] },
  ])
    assert.throws(() => validateAcceptanceCRequest(endpoint, request(body)));
  for (const id of ["4378327049", "1234567890"])
    assert.throws(() =>
      validateAcceptanceCRequest(
        endpoint.replace("8590146099", id),
        request(exactValidation),
      ),
    );
  process.env.V2_CONFIRMED_WRITE_ENABLED = "true";
  assert.throws(() =>
    validateAcceptanceCRequest(endpoint, request(exactValidation)),
  );
  process.env.V2_CONFIRMED_WRITE_ENABLED = "false";
  claimValidation();
  assert.throws(() => claimValidation(), /already_attempted/);
});
test("local MCP route permits only pause preview, not approval/commit/other tools", () => {
  const rpc = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "pause_entities_preview", arguments: toolArguments },
  };
  assert.equal(
    validateAcceptanceCRequest("http://127.0.0.1:4000/mcp", request(rpc)),
    "internal_preview",
  );
  for (const name of [
    "commit_preview",
    "confirm_preview",
    "create_campaign_from_brief",
    "update_entity_status_preview",
  ])
    assert.throws(() =>
      validateAcceptanceCRequest(
        "http://127.0.0.1:4000/mcp",
        request({ ...rpc, params: { ...rpc.params, name } }),
      ),
    );
  assert.throws(() =>
    validateAcceptanceCRequest(
      "http://127.0.0.1:4000/api/v1/mcp/public/approval/approve",
      request({}),
    ),
  );
});

test("20-row read plus bounded per-row reads; invalid ID never sent to validate", () => {
  assert.equal(toolArguments.items.length, 20);
  assert.equal(exactValidation.operations.length, 19);
  assert.ok(!JSON.stringify(exactValidation).includes("999999999999"));
  const search = endpoint.replace(
    "adGroupCriteria:mutate",
    "googleAds:searchStream",
  );
  for (const query of [
    batchQuery,
    ...batchIdentities.map((row) =>
      keywordQuery.replace(identity.resource_name, row.resource_name),
    ),
  ]) {
    assert.equal(
      validateAcceptanceCRequest(search, request({ query })),
      "read",
    );
  }
  assert.throws(() =>
    validateAcceptanceCRequest(
      search,
      request({
        query: keywordQuery.replace(
          identity.resource_name,
          "customers/8590146099/adGroupCriteria/206587491811~88888888",
        ),
      }),
    ),
  );
  assert.throws(() =>
    validateAcceptanceCRequest(
      endpoint,
      request({
        ...exactValidation,
        operations: [
          ...exactValidation.operations,
          {
            update: {
              resourceName: batchIdentities[19].resource_name,
              status: "PAUSED",
            },
            updateMask: "status",
          },
        ],
      }),
    ),
  );
});

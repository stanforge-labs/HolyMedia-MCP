import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.ACCEPTANCE_STATE_DIR = mkdtempSync(
  join(tmpdir(), "google-acceptance-guard-"),
);
const { validateRequest, validateAccessible, validateHierarchy } =
  await import("./guard.mjs");
const url = (id) =>
  `https://googleads.googleapis.com/v24/customers/${id}/googleAds:searchStream`;
const init = {
  method: "POST",
  headers: { "login-customer-id": "4378327049" },
  body: JSON.stringify({
    query: "SELECT customer.id, customer.test_account FROM customer",
  }),
};
test("Only two TEST customers and MCC login are allowed", () => {
  for (const id of ["4378327049", "8590146099"])
    assert.equal(validateRequest(url(id), init).customer, id);
  assert.throws(() => validateRequest(url("1234567890"), init));
  assert.throws(() =>
    validateRequest(url("8590146099"), {
      ...init,
      headers: { "login-customer-id": "1234567890" },
    }),
  );
});
test("All real writes and non-client campaign reads blocked before external request", () => {
  for (const endpoint of [
    "googleAds:mutate",
    "adGroupCriteria:mutate",
    "campaigns:mutate",
  ])
    assert.throws(() =>
      validateRequest(
        url("8590146099").replace("googleAds:searchStream", endpoint),
        init,
      ),
    );
  assert.throws(() =>
    validateRequest(url("4378327049"), {
      ...init,
      body: JSON.stringify({ query: "SELECT campaign.id FROM campaign" }),
    }),
  );
});
test("Wrong API version, origin and query-string ambiguity fail closed", () => {
  assert.throws(() =>
    validateRequest(url("8590146099").replace("v24", "v23"), init),
  );
  assert.throws(() =>
    validateRequest(url("8590146099").replace("https:", "http:"), init),
  );
  assert.throws(() => validateRequest(url("8590146099") + "?x=1", init));
});
test("Hierarchy IDs-only probe blocks unexpected children before descriptive reads", () => {
  const request = {
    ...init,
    body: JSON.stringify({
      query: "SELECT customer_client.id FROM customer_client",
    }),
  };
  assert.equal(validateRequest(url("4378327049"), request).hierarchy, true);
  validateHierarchy([{ results: [{ customerClient: { id: "8590146099" } }] }]);
  assert.throws(() =>
    validateHierarchy([
      { results: [{ customerClient: { id: "1234567890" } }] },
    ]),
  );
});
test("Accessible list is filtered to TEST IDs before account discovery; MCC required", () => {
  assert.deepEqual(
    validateAccessible({
      resourceNames: ["customers/4378327049", "customers/1234567890"],
    }),
    { resourceNames: ["customers/4378327049"] },
  );
  assert.throws(() =>
    validateAccessible({ resourceNames: ["customers/1234567890"] }),
  );
  assert.deepEqual(
    JSON.parse(
      readFileSync(
        join(process.env.ACCEPTANCE_STATE_DIR, "provider-counts.jsonl"),
        "utf8",
      )
        .trim()
        .split("\n")
        .at(-1),
    ),
    { type: "accessible_filter", accessible_count: 2, ignored_count: 1 },
  );
});

test("Only client atomic validate-only fixture allowed after fresh test proof; real writes always blocked", () => {
  const keys = {
    PROVIDER_GOOGLE_ADS_WRITE_ENABLED: "true",
    GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: "8590146099",
    PUBLIC_MCP_WRITE_SCOPE_ENABLED: "false",
    PUBLIC_MCP_CONTROLLED_WRITE_ENABLED: "false",
    V2_CONFIRMED_WRITE_ENABLED: "false",
    V2_PREVIEW_ONLY: "true",
  };
  const original = Object.fromEntries(
    Object.keys(keys).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, keys);
  const proofFile = join(process.env.ACCEPTANCE_STATE_DIR, "test-proof.json");
  const proof = {
    customer_id: "8590146099",
    test_account: true,
    mcc_id: "4378327049",
    hierarchy: true,
    verified_at: new Date().toISOString(),
  };
  writeFileSync(proofFile, JSON.stringify(proof), { mode: 0o600 });
  const endpoint = url("8590146099").replace(
    "googleAds:searchStream",
    "googleAds:mutate",
  );
  const payload = {
    validateOnly: true,
    partialFailure: false,
    mutateOperations: [
      {
        campaignOperation: {
          create: {
            resourceName: "customers/8590146099/campaigns/-2",
            name: "HM_MCP_WRITE_ACCEPTANCE_20261007T140000Z",
            status: "PAUSED",
          },
        },
      },
    ],
  };
  const req = (body) => ({ ...init, body: JSON.stringify(body) });
  try {
    assert.equal(validateRequest(endpoint, req(payload)).validateOnly, true);
    assert.throws(() =>
      validateRequest(
        endpoint.replace("8590146099", "4378327049"),
        req(payload),
      ),
    );
    assert.throws(() =>
      validateRequest(endpoint, req({ ...payload, validateOnly: false })),
    );
    assert.throws(() =>
      validateRequest(endpoint, req({ ...payload, partialFailure: true })),
    );
    assert.throws(() =>
      validateRequest(
        endpoint,
        req({
          ...payload,
          mutateOperations: [
            { campaignOperation: { update: { status: "PAUSED" } } },
          ],
        }),
      ),
    );
    assert.throws(() =>
      validateRequest(
        endpoint,
        req({
          ...payload,
          mutateOperations: [
            {
              campaignOperation: {
                create: {
                  ...payload.mutateOperations[0].campaignOperation.create,
                  status: "ENABLED",
                },
              },
            },
          ],
        }),
      ),
    );
    process.env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST = "8590146099,4378327049";
    assert.throws(() => validateRequest(endpoint, req(payload)));
    process.env.GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST = "8590146099";
    writeFileSync(proofFile, JSON.stringify({ ...proof, test_account: false }));
    assert.throws(() => validateRequest(endpoint, req(payload)));
    writeFileSync(
      proofFile,
      JSON.stringify({
        ...proof,
        verified_at: new Date(Date.now() - 31 * 60_000).toISOString(),
      }),
    );
    assert.throws(() => validateRequest(endpoint, req(payload)));
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

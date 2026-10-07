import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
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
test("All writes, validate-only mutations and campaign reads blocked before external request", () => {
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
    validateRequest(url("8590146099"), {
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
test("Unexpected accessible accounts stop discovery and record only IDs", () => {
  validateAccessible({ resourceNames: ["customers/4378327049"] });
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
    { type: "unexpected_accessible_ids", ids: ["1234567890"] },
  );
});

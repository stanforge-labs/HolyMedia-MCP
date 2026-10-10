import test from "node:test";
import assert from "node:assert/strict";
import { classifyIReconcile } from "./audience-reconcile.mjs";
import {
  target,
  queries,
  READINESS_SNAPSHOT_QUERIES,
} from "./audience-commit-guard.mjs";
test("I reconciliation transport permits only exact TEST READ and MCC proof", () => {
  const request = (query) => ({
    method: "POST",
    headers: { "login-customer-id": target.mcc },
    body: JSON.stringify({ query }),
  });
  const url = `https://googleads.googleapis.com/v24/customers/${target.customer}/googleAds:searchStream`;
  assert.equal(
    classifyIReconcile(url, request(READINESS_SNAPSHOT_QUERIES.groupAudiences)),
    "read",
  );
  assert.equal(
    classifyIReconcile(
      url.replace(target.customer, target.mcc),
      request(queries.hierarchy),
    ),
    "read_mcc",
  );
  for (const [u, r] of [
    [
      url.replace(":searchStream", ":mutate"),
      {
        ...request(queries.group),
        body: JSON.stringify({ validateOnly: true }),
      },
    ],
    [
      url.replace(":searchStream", ":mutate"),
      {
        ...request(queries.group),
        body: JSON.stringify({ validateOnly: false }),
      },
    ],
    [url.replace(target.customer, "1234567890"), request(queries.group)],
    [url, request("SELECT asset.id FROM asset")],
    ["http://127.0.0.1:4000/mcp", request(queries.group)],
  ])
    assert.throws(() => classifyIReconcile(u, r));
});

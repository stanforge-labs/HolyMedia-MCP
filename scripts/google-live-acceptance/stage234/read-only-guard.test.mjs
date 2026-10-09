import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyReadOnlyRequest as classify,
  PREFLIGHT_QUERIES as q,
} from "./read-only-guard.mjs";
const origin = "https://googleads.googleapis.com/v24/customers/",
  headers = { "login-customer-id": "4378327049" };
const request = (query) => ({
  method: "POST",
  headers,
  body: JSON.stringify({ query }),
});
test("exact TEST proof and fixture inventory reads only", () => {
  assert.equal(
    classify(origin + "8590146099/googleAds:searchStream", request(q.keywords)),
    "read",
  );
  assert.equal(
    classify(
      origin + "4378327049/googleAds:searchStream",
      request(q.hierarchy),
    ),
    "read",
  );
});
test("every mutation, validate-only, other account and other MCC inventory denied", () => {
  for (const path of [
    "8590146099/googleAds:mutate",
    "8590146099/adGroupCriteria:mutate",
    "4378327049/googleAds:mutate",
    "1234567890/googleAds:searchStream",
  ]) {
    assert.throws(() => classify(origin + path, request(q.customer)));
  }
  assert.throws(() =>
    classify(origin + "4378327049/googleAds:searchStream", request(q.keywords)),
  );
});
test("unbounded/arbitrary query, wrong login, URL credentials and extra fields denied", () => {
  assert.throws(() =>
    classify(
      origin + "8590146099/googleAds:searchStream",
      request("SELECT customer.id FROM customer"),
    ),
  );
  assert.throws(() =>
    classify(origin + "8590146099/googleAds:searchStream", {
      ...request(q.customer),
      headers: { "login-customer-id": "1" },
    }),
  );
  assert.throws(() =>
    classify(
      "https://u:p@googleads.googleapis.com/v24/customers/8590146099/googleAds:searchStream",
      request(q.customer),
    ),
  );
  assert.throws(() =>
    classify(origin + "8590146099/googleAds:searchStream", {
      ...request(q.customer),
      body: JSON.stringify({ query: q.customer, extra: true }),
    }),
  );
});
test("only normal encrypted-vault refresh allowed, no code exchange", () => {
  assert.equal(
    classify("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: "grant_type=refresh_token&refresh_token=synthetic",
    }),
    "oauth_refresh",
  );
  assert.throws(() =>
    classify("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: "grant_type=authorization_code&code=synthetic",
    }),
  );
});

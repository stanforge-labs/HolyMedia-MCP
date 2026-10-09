import test from "node:test";
import assert from "node:assert/strict";
import { healthOnlyFetch } from "./diagnostic-fetch-preload.mjs";
test("startup diagnostic allows only exact local health, no provider/MCP/auth/write transport", async () => {
  let calls = 0;
  const fetch = healthOnlyFetch(async () => {
    calls++;
    return { status: 200 };
  });
  assert.equal((await fetch("http://127.0.0.1:4000/ready")).status, 200);
  for (const url of [
    "https://googleads.googleapis.com/v24/customers/8590146099/adGroups:mutate",
    "https://oauth2.googleapis.com/token",
    "http://127.0.0.1:4000/mcp",
    "http://localhost:4402/mcp/approve",
    "http://127.0.0.1:4000/ready?override=1",
    "http://127.0.0.1:4000/ready#foo",
    "http://synthetic@127.0.0.1:4000/ready",
  ]) {
    assert.throws(() => fetch(url), /diagnostic_non_health_fetch_blocked/);
  }
  assert.throws(
    () => fetch("http://127.0.0.1:4000/ready", { method: "POST" }),
    /diagnostic_non_health_fetch_blocked/,
  );
  assert.equal(calls, 1);
});

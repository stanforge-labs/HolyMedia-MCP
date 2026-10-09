import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  waitLocalReady,
  LOCAL_STARTUP_BUDGET_MS,
} from "./wait-local-ready.mjs";
const server = { exitCode: null, signalCode: null };
test("cold API startup beyond old ten-second poll window remains bounded and health-only", async () => {
  let time = 0,
    calls = 0;
  const ready = await waitLocalReady({
    server,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
    },
    fetch: async (url, options) => {
      assert.equal(url, "http://127.0.0.1:4000/ready");
      assert.deepEqual(Object.keys(options), ["signal"]);
      calls++;
      return { status: time >= 16000 ? 200 : 503 };
    },
  });
  assert.equal(ready, true);
  assert.equal(time, 16000);
  assert.equal(calls, 33);
});
test("unavailable API times out without mutations, infinite waits or server restarts", async () => {
  let time = 0,
    calls = 0;
  assert.equal(
    await waitLocalReady({
      server,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      fetch: async () => {
        calls++;
        throw Error("synthetic private message");
      },
    }),
    false,
  );
  assert.equal(time, LOCAL_STARTUP_BUDGET_MS);
  assert.equal(calls, 90);
});
test("failed child is not retried and stock persisted approval still runs after readiness before commit", async () => {
  let calls = 0;
  await assert.rejects(
    waitLocalReady({
      server: { exitCode: 1 },
      fetch: async () => {
        calls++;
      },
    }),
    /stock_api_start_failed/,
  );
  assert.equal(calls, 0);
  const source = readFileSync(
    new URL("./commit-runner.mjs", import.meta.url),
    "utf8",
  );
  assert.ok(
    source.indexOf("await waitLocalReady") <
      source.indexOf(
        "bound = await approveProof();",
        source.indexOf("await waitLocalReady"),
      ),
  );
  assert.ok(
    source.indexOf(
      "bound = await approveProof();",
      source.indexOf("await waitLocalReady"),
    ) < source.indexOf('stage = "immutable_commit_once"'),
  );
  assert.match(source, /stage234_commit_stock_api_not_ready/);
});
test("missing readiness route is never treated as healthy or permission to commit", async () => {
  let time = 0;
  assert.equal(
    await waitLocalReady({
      server,
      now: () => time,
      sleep: async (ms) => {
        time += ms;
      },
      fetch: async () => ({ status: 404 }),
    }),
    false,
  );
  assert.equal(time, LOCAL_STARTUP_BUDGET_MS);
});

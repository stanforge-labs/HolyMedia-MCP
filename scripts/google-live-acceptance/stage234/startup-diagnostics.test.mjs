import test from "node:test";
import assert from "node:assert/strict";
import { safeStartupErrors } from "./startup-diagnostics.mjs";
test("startup stderr projection never emits values, messages or stacks outside fixed safe fields", () => {
  const input = JSON.stringify({
    msg: "api failed to start",
    errorType: "Error",
    stack: "private stack",
    password: "private",
    url: "private",
  });
  assert.deepEqual(safeStartupErrors(input), [
    { message: "api failed to start", error_class: "Error" },
  ]);
  assert.deepEqual(
    safeStartupErrors(
      JSON.stringify({ msg: "private message", errorType: "Error" }),
    ),
    [],
  );
  assert.deepEqual(
    safeStartupErrors(
      JSON.stringify({
        msg: "redis readiness failed",
        errorType: "private: value",
      }),
    ),
    [{ message: "redis readiness failed", error_class: null }],
  );
});

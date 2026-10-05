import { test } from "node:test";
import assert from "node:assert/strict";
import {
  measuredStorage,
  GiB,
  productionFree,
} from "./public_mcp_split_candidate_storage.mjs";
const measure = (api, web) => ({
  beforeFreeBytes: 10 * GiB,
  afterApiFreeBytes: 10 * GiB - api,
  afterWebFreeBytes: 10 * GiB - api - web,
});
test("real sequential deltas and exact last-known free", () => {
  const r = measuredStorage(measure(100000000, 200000000));
  assert.equal(r.API_INCREMENTAL_BYTES, 100000000);
  assert.equal(r.WEB_INCREMENTAL_BYTES, 200000000);
  assert.equal(r.COMBINED_INCREMENTAL_BYTES, 300000000);
  assert.equal(r.estimatedFreeAfterPullBytes, productionFree - 300000000);
  assert.equal(r.result, "PASS");
});
test("strict 0.40 and 0.445 GiB thresholds; no relaxed headroom", () => {
  assert.equal(
    measuredStorage(measure(Math.floor(0.4 * GiB), 0)).result,
    "PASS",
  );
  assert.equal(
    measuredStorage(measure(Math.floor(0.4 * GiB) + 1, 0)).result,
    "CONDITIONAL",
  );
  assert.equal(
    measuredStorage(measure(Math.floor(0.445 * GiB), 0)).result,
    "CONDITIONAL",
  );
  assert.equal(
    measuredStorage(measure(Math.floor(0.445 * GiB) + 1, 0)).result,
    "BLOCKED",
  );
  assert.equal(
    measuredStorage(measure(productionFree - GiB + 1, 0)).oneGiBHeadroom,
    "FAIL",
  );
});
test("invalid or reversed measurements fail closed", () => {
  assert.throws(() => measuredStorage(measure(-1, 10)));
  assert.throws(() => measuredStorage(measure(1, -10)));
  assert.throws(() => measuredStorage(measure(1.5, 1)));
});

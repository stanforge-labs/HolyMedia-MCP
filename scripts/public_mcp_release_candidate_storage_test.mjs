import { test } from "node:test";
import assert from "node:assert/strict";
import { storageResult } from "./public_mcp_release_candidate_storage.mjs";

function result(increment) {
  return storageResult(
    { Size: 1000, RootFS: { Layers: ["base", "old"] } },
    { Size: 1200, RootFS: { Layers: ["base", "new", "web"] } },
    {
      layers: [
        { digest: "base-c", size: 200 },
        { digest: "old-c", size: 300 },
      ],
    },
    {
      layers: [
        { digest: "base-c", size: 200 },
        { digest: "new-c", size: 600 },
        { digest: "web-c", size: 100 },
      ],
    },
    {
      incrementalBytes: increment,
      beforeFreeBytes: 10_000_000_000,
      afterFreeBytes: 10_000_000_000 - increment,
    },
    {
      rootfs: { diff_ids: ["base", "new", "web"] },
      history: [
        { created_by: "base" },
        { empty_layer: true, created_by: "env" },
        { created_by: "dependencies" },
        { created_by: "web" },
      ],
    },
  );
}
test("uses measured filesystem increment, not sum of layer sizes", () => {
  const value = result(123456789);
  assert.equal(value.incrementalBytes, 123456789);
  assert.equal(value.sharedLayers, 1);
  assert.equal(value.uniqueCandidateLayers, 2);
  assert.equal(value.currentCompressedLayerBytes, 500);
  assert.equal(value.candidateCompressedLayerBytes, 900);
  assert.equal(value.largestUniqueLayers[0].createdBy, "dependencies");
  assert.equal(value.oneGiBHeadroom, "PASS");
});
test("near threshold requires fresh measurement even with estimated headroom", () => {
  assert.equal(
    result(Math.ceil(0.45 * 1073741824)).oneGiBHeadroom,
    "FRESH CHECK REQUIRED",
  );
});
test("more than 0.5 GiB blocks the release without deleting rollback image", () => {
  const value = result(536870913);
  assert.equal(value.oneGiBHeadroom, "FAIL");
  assert.equal(
    value.diskFeasibility,
    "BLOCKED / FRESH VPS MEASUREMENT REQUIRED",
  );
});
test("rejects invalid or negative measurement rather than guessing", () => {
  assert.throws(() => result(-1));
  assert.throws(() => result(NaN));
});

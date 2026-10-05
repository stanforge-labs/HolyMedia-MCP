import assert from "node:assert/strict";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
export const GiB = 1073741824;
export const productionFree = 1552011264;
export function measuredStorage(m) {
  for (const value of Object.values(m))
    assert(Number.isSafeInteger(value) && value >= 0);
  const api = m.beforeFreeBytes - m.afterApiFreeBytes;
  const web = m.afterApiFreeBytes - m.afterWebFreeBytes;
  assert(api >= 0 && web >= 0);
  const combined = api + web;
  assert.equal(combined, m.beforeFreeBytes - m.afterWebFreeBytes);
  const remaining = productionFree - combined;
  const result =
    combined > Math.floor(0.445 * GiB) || remaining < GiB
      ? "BLOCKED"
      : combined > Math.floor(0.4 * GiB)
        ? "CONDITIONAL"
        : "PASS";
  return {
    API_INCREMENTAL_BYTES: api,
    API_INCREMENTAL_GIB: api / GiB,
    WEB_INCREMENTAL_BYTES: web,
    WEB_INCREMENTAL_GIB: web / GiB,
    COMBINED_INCREMENTAL_BYTES: combined,
    COMBINED_INCREMENTAL_GIB: combined / GiB,
    lastKnownProductionFreeBytes: productionFree,
    estimatedFreeAfterPullBytes: remaining,
    estimatedFreeAfterPullGiB: remaining / GiB,
    oneGiBHeadroom: result === "BLOCKED" ? "FAIL" : result,
    result,
    freshVpsMeasurementRequired: result !== "PASS",
  };
}
if (process.argv[1]?.endsWith("public_mcp_split_candidate_storage.mjs")) {
  const folder = process.argv[2];
  assert(folder);
  const read = (file) => JSON.parse(readFileSync(join(folder, file), "utf8"));
  const result = {
    ...measuredStorage(read("measured.json")),
    runtimeSource: process.env.SOURCE_SHA,
    harnessHead: process.env.GITHUB_SHA,
    images: {},
    measurement:
      "Separate hosted runner; empty isolated Docker store; old full image -> API -> Web sequential pulls; sync + df -B1, not a manifest estimate",
    productionAccessed: false,
    productionChanged: false,
  };
  const alreadyPresent = new Set(read("current-inspect.json")[0].RootFS.Layers);
  for (const kind of ["current", "api", "web"]) {
    const image = read(kind + "-inspect.json")[0];
    const manifest = read(kind + "-manifest.json");
    const config = read(kind + "-config.json");
    assert.deepEqual(config.rootfs.diff_ids, image.RootFS.Layers);
    assert.equal(manifest.layers.length, image.RootFS.Layers.length);
    const history = config.history.filter((x) => !x.empty_layer);
    assert.equal(history.length, image.RootFS.Layers.length);
    const unique = image.RootFS.Layers.map((id, i) => ({
      diffId: id,
      compressedBytes: manifest.layers[i].size,
      createdBy: history[i].created_by,
      shared: alreadyPresent.has(id),
    }))
      .filter((x) => !x.shared)
      .sort((a, b) => b.compressedBytes - a.compressedBytes);
    result.images[kind] = {
      tag: process.env[
        kind === "current" ? "CURRENT_TAG" : kind.toUpperCase() + "_TAG"
      ],
      digest:
        process.env[
          kind === "current" ? "CURRENT_DIGEST" : kind.toUpperCase() + "_DIGEST"
        ],
      compressedBytes: manifest.layers.reduce((a, x) => a + x.size, 0),
      uncompressedBytes: image.Size,
      uniqueLayersAfterPreviousPulls: unique.length,
      largestUniqueLayers: unique.slice(0, 5),
    };
    for (const id of image.RootFS.Layers) alreadyPresent.add(id);
  }
  writeFileSync(
    join(folder, "storage-result.json"),
    JSON.stringify(result, null, 2),
  );
  for (const key of [
    "API_INCREMENTAL_BYTES",
    "API_INCREMENTAL_GIB",
    "WEB_INCREMENTAL_BYTES",
    "WEB_INCREMENTAL_GIB",
    "COMBINED_INCREMENTAL_BYTES",
    "COMBINED_INCREMENTAL_GIB",
  ])
    console.log(key + "=" + result[key]);
  console.log("SPLIT_STORAGE_RESULT " + JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "\nSplit storage result: " + JSON.stringify(result) + "\n",
    );
  if (result.result === "BLOCKED") process.exitCode = 1;
}

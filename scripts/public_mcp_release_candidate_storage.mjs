import assert from "node:assert/strict";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

export function storageResult(
  current,
  candidate,
  currentManifest,
  candidateManifest,
  measured,
  candidateConfig,
) {
  assert(
    Number.isSafeInteger(measured.incrementalBytes) &&
      measured.incrementalBytes >= 0,
  );
  assert.equal(
    measured.beforeFreeBytes - measured.afterFreeBytes,
    measured.incrementalBytes,
  );
  const oldDiffIds = new Set(current.RootFS.Layers);
  const diffIds = candidate.RootFS.Layers;
  const shared = diffIds.filter((layer) => oldDiffIds.has(layer)).length;
  const oldCompressed = new Set(
    currentManifest.layers.map((layer) => layer.digest),
  );
  const compressed = (layers) =>
    layers.reduce((sum, layer) => sum + layer.size, 0);
  assert.equal(candidateManifest.layers.length, diffIds.length);
  assert.deepEqual(candidateConfig.rootfs.diff_ids, diffIds);
  const history = candidateConfig.history.filter((entry) => !entry.empty_layer);
  assert.equal(history.length, diffIds.length);
  const uniqueLayers = candidateManifest.layers
    .map((layer, index) => ({
      digest: layer.digest,
      diffId: diffIds[index],
      compressedBytes: layer.size,
      createdBy: history[index].created_by,
      sharedUncompressed: oldDiffIds.has(diffIds[index]),
      sharedCompressed: oldCompressed.has(layer.digest),
    }))
    .filter((layer) => !layer.sharedUncompressed)
    .sort((a, b) => b.compressedBytes - a.compressedBytes);
  const GiB = 1073741824;
  const estimatedFree = 1.5 * GiB - measured.incrementalBytes;
  const nearThreshold = measured.incrementalBytes >= 0.4 * GiB;
  const headroom =
    estimatedFree < GiB
      ? "FAIL"
      : nearThreshold
        ? "FRESH CHECK REQUIRED"
        : "PASS";
  return {
    runtimeSource: process.env.SOURCE_SHA,
    harnessHead: process.env.GITHUB_SHA,
    currentTag: process.env.CURRENT_TAG,
    currentDigest: process.env.CURRENT_DIGEST,
    candidateTag: process.env.CANDIDATE_TAG,
    candidateDigest: process.env.CANDIDATE_DIGEST,
    currentCompressedLayerBytes: compressed(currentManifest.layers),
    candidateCompressedLayerBytes: compressed(candidateManifest.layers),
    currentUncompressedBytes: current.Size,
    candidateUncompressedBytes: candidate.Size,
    sharedLayers: shared,
    uniqueCandidateLayers: diffIds.length - shared,
    sharedCompressedLayerCount: candidateManifest.layers.filter((layer) =>
      oldCompressed.has(layer.digest),
    ).length,
    incrementalBytes: measured.incrementalBytes,
    incrementalGiB: measured.incrementalBytes / GiB,
    lastKnownProductionFreeGiB: 1.5,
    estimatedFreeAfterPullGiB: estimatedFree / GiB,
    oneGiBHeadroom: headroom,
    diskFeasibility:
      headroom === "PASS"
        ? "PASS (last-known estimate only)"
        : "BLOCKED / FRESH VPS MEASUREMENT REQUIRED",
    largestUniqueLayers: uniqueLayers.slice(0, 8),
    measurement:
      "Separate clean hosted runner, current pull first, df -B1 at DockerRootDir before and after candidate pull; sync; no builds or service containers",
    productionAccessed: false,
    productionChanged: false,
  };
}

if (process.argv[1]?.endsWith("public_mcp_release_candidate_storage.mjs")) {
  assert(process.argv[2], "Storage artifact folder required");
  const folder = process.argv[2];
  const read = (name) => JSON.parse(readFileSync(join(folder, name), "utf8"));
  const result = storageResult(
    read("current-inspect.json")[0],
    read("candidate-inspect.json")[0],
    read("current-manifest.json"),
    read("candidate-manifest.json"),
    read("measured.json"),
    read("candidate-config.json"),
  );
  writeFileSync(
    join(folder, "storage-result.json"),
    JSON.stringify(result, null, 2),
  );
  console.log("STORAGE_RESULT " + JSON.stringify(result));
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\nIncremental Docker storage: ${result.incrementalBytes} bytes (${result.incrementalGiB.toFixed(3)} GiB).\nEstimated free from last-known 1.5 GiB: ${result.estimatedFreeAfterPullGiB.toFixed(3)} GiB.\n1.0 GiB headroom: ${result.oneGiBHeadroom}.\n`,
    );
  if (result.oneGiBHeadroom !== "PASS") process.exitCode = 1;
}

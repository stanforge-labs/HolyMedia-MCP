import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [revision, destination] = process.argv.slice(2);
assert.match(revision ?? "", /^[a-f0-9]{40}$/, "Pass an exact CI-verified SHA");
assert.ok(destination, "Pass a new staging directory");
const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const prefix = "infra/production-static-landing/";
const blob = (relative) =>
  execFileSync("git", ["show", `${revision}:${prefix}${relative}`], {
    cwd: repo,
    maxBuffer: 10 * 1024 * 1024,
  });

const manifest = blob("MANIFEST.sha256");
const entries = manifest
  .toString("utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const match = line.match(
      /^([a-f0-9]{64})  (site\/[\w.-]+|nginx\/holypilot-landing\.conf)$/,
    );
    assert.ok(match, `Malformed manifest line: ${line}`);
    return { hash: match[1], path: match[2] };
  });
const scripts = [
  "scripts/publish-once.sh",
  "scripts/rollback-nginx.sh",
  "scripts/resource-guard.sh",
  "scripts/build-production-config.mjs",
];

await mkdir(destination);
await writeFile(join(destination, "MANIFEST.sha256"), manifest);
for (const entry of entries) {
  const bytes = blob(entry.path);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    entry.hash,
    `Git blob checksum mismatch: ${entry.path}`,
  );
  const output = join(destination, entry.path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
}
for (const relative of scripts) {
  const output = join(destination, relative);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, blob(relative));
}
console.log(
  `Verified deployment stage from ${revision}: ${entries.length} immutable files`,
);

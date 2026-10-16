import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const [baselinePath, outputPath] = process.argv.slice(2);
if (!baselinePath || !outputPath) {
  console.error(
    "Usage: node build-production-config.mjs <read-only-production-baseline> <candidate-output>",
  );
  process.exit(2);
}

const expectedBaselineSha256 =
  "c711bb0b6f85390afa8482ed58611371c3648690a55f09f421254475e8fd1b91";
const baseline = await readFile(baselinePath);
const actual = createHash("sha256").update(baseline).digest("hex");
assert.equal(
  actual,
  expectedBaselineSha256,
  "Production Nginx source changed; stop and review before generating a candidate",
);
const source = baseline.toString("utf8");
const marker = "    location / {";
assert.equal(
  source.split(marker).length,
  2,
  "Expected one generic Web fallback",
);
assert.ok(
  !source.includes("holypilot-landing.conf"),
  "Static include already present",
);
const insertion = "    include /etc/nginx/snippets/holypilot-landing.conf;\n\n";
const candidate = source.replace(marker, insertion + marker);
assert.equal(
  candidate.replace(insertion, ""),
  source,
  "Candidate must change only one include line",
);
await writeFile(outputPath, candidate, { flag: "wx", mode: 0o644 });
console.log(
  `Candidate generated; baseline SHA-256 ${actual}; only the scoped include was inserted`,
);

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("strict Turbo env preserves the isolated PG18 acceptance selectors", () => {
  const turbo = JSON.parse(
    readFileSync(new URL("../turbo.json", import.meta.url), "utf8"),
  );
  for (const name of [
    "V2_INTEGRATION_TESTS",
    "V2_PG18_REHEARSAL",
    "V2_PG18_TEST_DATABASE_URL",
  ])
    assert.ok(
      turbo.globalEnv.includes(name),
      `${name} must survive strict task environment filtering`,
    );
});
test("CI prepares its dedicated disposable PG18 DB without removing test safety guards", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/v2-foundation.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /V2_PG18_REHEARSAL: "true"/);
  assert.match(
    workflow,
    /V2_PG18_TEST_DATABASE_URL: .*127\.0\.0\.1:5432\/public_mcp_upgrade/,
  );
  assert.match(workflow, /createdb -U holymedia public_mcp_upgrade/);
  assert.ok(
    workflow.indexOf("Prepare separate disposable PostgreSQL 18") <
      workflow.indexOf("- run: pnpm test"),
  );
  const source = readFileSync(
    new URL(
      "../apps/api/src/mcp/mcp-public-write.pg18.integration.test.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /ciUrl\.pathname === "\/public_mcp_upgrade"/);
  assert.match(source, /expect\(version\[0\]\?\.version\)\.toMatch\(\/\^18/);
});

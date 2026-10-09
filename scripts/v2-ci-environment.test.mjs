import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

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

test("quality service pulls use official public mirror and exact job service identities", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/v2-foundation.yml", import.meta.url),
    "utf8",
  );
  assert.match(
    workflow,
    /image: public\.ecr\.aws\/docker\/library\/postgres:18-alpine/,
  );
  assert.match(
    workflow,
    /image: public\.ecr\.aws\/docker\/library\/redis:7\.4-alpine/,
  );
  assert.doesNotMatch(workflow, /image: (?:postgres|redis):|ancestor=/);
  assert.match(
    workflow,
    /postgres_container='\$\{\{ job\.services\.postgres\.id \}\}'/,
  );
  assert.match(
    workflow,
    /postgres_id='\$\{\{ job\.services\.postgres\.id \}\}'/,
  );
  assert.match(workflow, /redis_id='\$\{\{ job\.services\.redis\.id \}\}'/);
  for (const flag of [
    "PROVIDER_GOOGLE_ADS_WRITE_ENABLED",
    "PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED",
    "PROVIDER_GOOGLE_ADS_STAGE3_WRITE_ENABLED",
    "PROVIDER_GOOGLE_ADS_STAGE4_WRITE_ENABLED",
    "PUBLIC_MCP_WRITE_SCOPE_ENABLED",
    "PUBLIC_MCP_CONTROLLED_WRITE_ENABLED",
  ])
    assert.match(workflow, new RegExp(`${flag}: "false"`));
  assert.match(workflow, /GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST: ""/);
});

test("only isolated acceptance CI overrides Node image; default production base remains unchanged", () => {
  const dockerfile = readFileSync(
    new URL("../infra/Dockerfile.v2", import.meta.url),
    "utf8",
  );
  assert.match(
    dockerfile,
    /ARG NODE_BASE_IMAGE=node:24-bookworm-slim\s+FROM \$\{NODE_BASE_IMAGE\} AS base/,
  );
  const from = dockerfile
    .split(/\r?\n/u)
    .filter((line) => /^FROM /u.test(line));
  assert.equal(
    from.filter((line) => line.includes("${NODE_BASE_IMAGE}")).length,
    1,
  );
  for (const line of from.slice(1))
    assert.match(line, /^FROM (?:base|manifests|build-deps) AS /u);
  const workflow = readFileSync(
    new URL(
      "../.github/workflows/google-stage234-acceptance-image.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    workflow,
    /build-args: \|\s+NODE_BASE_IMAGE=public\.ecr\.aws\/docker\/library\/node:24-bookworm-slim/,
  );
  assert.match(workflow, /target: api-runtime/);
  assert.match(workflow, /google-stage234-acceptance-\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /org\.holymedia\.acceptance-only=true/);
  assert.match(dockerfile, /FROM base AS api-runtime/);
  assert.match(dockerfile, /FROM base AS runtime/);
  for (const name of [
    "v2-production-image.yml",
    "v2-api-only-image.yml",
    "google-live-acceptance-image.yml",
  ])
    assert.doesNotMatch(
      readFileSync(
        new URL(`../.github/workflows/${name}`, import.meta.url),
        "utf8",
      ),
      /NODE_BASE_IMAGE=/,
    );
});

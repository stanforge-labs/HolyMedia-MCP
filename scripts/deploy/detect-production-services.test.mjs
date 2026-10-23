import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { detectProductionServices } from "./detect-production-services.mjs";

const migration =
  "packages/database/prisma/migrations/0034_openai_oidc_identity/migration.sql";

test("OIDC release merge cannot enter the ordinary deploy matrix", () => {
  assert.deepEqual(
    detectProductionServices([
      "apps/web/app/connect/claude/page.tsx",
      "apps/api/src/mcp/oidc-identity.ts",
      migration,
    ]),
    { openaiRelease: true, services: [] },
  );
});

test("pending release holds later Web/API pushes but preserves Worker-only", () => {
  assert.deepEqual(detectProductionServices(["apps/web/app/page.tsx"], true), {
    openaiRelease: true,
    services: [],
  });
  assert.deepEqual(detectProductionServices(["apps/api/src/main.ts"], true), {
    openaiRelease: true,
    services: [],
  });
  assert.deepEqual(
    detectProductionServices(["apps/worker/src/main.ts"], true),
    {
      openaiRelease: false,
      services: ["worker"],
    },
  );
});

for (const [label, paths, expected] of [
  ["Web only", ["apps/web/app/page.tsx"], ["web"]],
  ["API only", ["apps/api/src/main.ts"], ["api"]],
  ["Worker only", ["apps/worker/src/main.ts"], ["worker"]],
  [
    "ordinary Prisma schema",
    ["packages/database/prisma/schema.prisma"],
    ["api", "worker"],
  ],
  ["shared lockfile only", ["pnpm-lock.yaml"], ["web", "api", "worker"]],
]) {
  test(`${label} keeps existing service selection`, () => {
    assert.deepEqual(detectProductionServices(paths), {
      openaiRelease: false,
      services: expected,
    });
  });
}

test("release workflow has explicit API -> OIDC -> Web dependencies and no Worker", () => {
  const workflow = readFileSync(
    new URL("../../.github/workflows/openai-oidc-release.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /\n  api:\n    needs: preflight\n/);
  assert.match(
    workflow,
    /\n  stage-api-image:\n    if: github\.ref == 'refs\/heads\/main' && inputs\.phase == 'stage'\n/,
  );
  assert.match(
    workflow,
    /\n  preflight:\n    if: github\.ref == 'refs\/heads\/main' && inputs\.phase == 'deploy'\n/,
  );
  assert.match(workflow, /\n  oidc-gate:\n    needs: \[preflight, api\]\n/);
  assert.match(workflow, /\n  web:\n    needs: \[preflight, oidc-gate\]\n/);
  assert.doesNotMatch(workflow, /\n  worker:\n/);
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /"\$RELEASE_SHA" == "\$GITHUB_SHA"/);
  assert.match(workflow, /openai-preflight \$RELEASE_SHA/);
});

import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
const kind = process.argv[2];
assert(["api", "web"].includes(kind));
assert.notEqual(process.getuid(), 0);
for (const path of [
  "/ms-playwright",
  "/root/.cache/ms-playwright",
  "/home/node/.cache/ms-playwright",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
])
  assert(!existsSync(path), "Forbidden browser path: " + path);
const packages = readdirSync("/workspace/node_modules/.pnpm");
assert(
  !packages.some((name) =>
    /^(playwright|playwright-core|@playwright\+|@axe-core\+playwright)/.test(
      name,
    ),
  ),
  "No Playwright dependency graph in new images",
);
assert(!existsSync("/workspace/apps/worker"));
if (kind === "api") {
  assert(!existsSync("/workspace/apps/web"));
  assert(existsSync("/workspace/apps/api/dist/main.js"));
  assert(existsSync("/workspace/packages/database/dist/index.js"));
  assert(existsSync("/workspace/packages/database/node_modules/.bin/prisma"));
  for (const name of [
    "0032_public_mcp_oauth_previews",
    "0033_public_mcp_browser_approval",
  ])
    assert(
      existsSync(
        "/workspace/packages/database/prisma/migrations/" +
          name +
          "/migration.sql",
      ),
    );
} else {
  assert(!existsSync("/workspace/apps/api"));
  assert(!existsSync("/workspace/packages/database"));
  assert(
    !packages.some((name) =>
      /^(prisma@|@prisma\+|bullmq@|ioredis@)/.test(name),
    ),
  );
  assert(existsSync("/workspace/apps/web/.next/BUILD_ID"));
  assert(existsSync("/workspace/apps/web/public"));
  assert(existsSync("/workspace/apps/web/node_modules/.bin/next"));
  assert(existsSync("/workspace/packages/contracts/dist/index.js"));
}
console.log(
  "IMAGE_LAYOUT " +
    JSON.stringify({
      kind,
      nonRoot: true,
      chromium: false,
      playwright: false,
      worker: false,
      result: "PASS",
    }),
);

// Next's frozen peer graph includes its optional Playwright testing peer.
// Remove only test-only packages from this generated Web build-stage graph.
import assert from "node:assert/strict";
import {
  readdirSync,
  existsSync,
  rmSync,
  readlinkSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";
export const isTestingPackage = (name) =>
  /^(?:@playwright\+test|playwright|playwright-core)@/.test(name);
// Match the actual final linked module, never a peer name encoded in Next's
// virtual-store directory key (next@..._@playwright+test@...).
export const isTestingLink = (target) =>
  /(?:^|\/)(?:@playwright\/test|playwright(?:-core)?)\/?$/.test(target);
if (process.argv[1]?.endsWith("/web-prune.mjs")) {
  assert.equal(process.cwd(), "/workspace");
  for (const name of ["api", "worker"])
    assert(!existsSync("/workspace/apps/" + name));
  assert(!existsSync("/workspace/packages/database"));
  const store = "/workspace/node_modules/.pnpm";
  assert.equal(realpathSync(store), store);
  const removed = [];
  for (const entry of readdirSync(store, { withFileTypes: true })) {
    if (isTestingPackage(entry.name)) {
      assert(entry.isDirectory());
      rmSync(join(store, entry.name), { recursive: true });
      removed.push(entry.name);
    }
    if (entry.isDirectory() && entry.name.startsWith("next@")) {
      const next = join(store, entry.name, "node_modules/next");
      for (const suffix of [
        "experimental/testmode",
        "dist/experimental/testmode",
      ]) {
        const folder = join(next, suffix);
        if (!existsSync(folder)) continue;
        for (const item of readdirSync(folder, { withFileTypes: true })) {
          if (item.name === "playwright" || item.name.startsWith("playwright."))
            rmSync(join(folder, item.name), { recursive: item.isDirectory() });
        }
      }
    }
  }
  function unlinkTestingPeers(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const target = join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        if (isTestingLink(readlinkSync(target))) rmSync(target);
      } else if (
        entry.isFile() &&
        folder.endsWith("/.bin") &&
        entry.name === "playwright"
      ) {
        rmSync(target);
      } else if (entry.isDirectory()) unlinkTestingPeers(target);
    }
  }
  unlinkTestingPeers("/workspace/node_modules");
  unlinkTestingPeers("/workspace/apps/web/node_modules");
  assert(!readdirSync(store).some(isTestingPackage));
  console.log("WEB_TEST_ONLY_PEER_REMOVAL " + JSON.stringify(removed));
}

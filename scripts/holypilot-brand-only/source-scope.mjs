import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const baseline = "a00817b746211a295bcb966f7fd7ef12cd6178fb";
const original = (path) =>
  execFileSync("git", ["show", `${baseline}:${path}`], {
    encoding: "utf8",
  }).replace(/\r\n/g, "\n");
const current = async (path) =>
  (await readFile(path, "utf8")).replace(/\r\n/g, "\n");
const allowed = new Set([
  "apps/web/app/(public)/page.tsx",
  "apps/web/app/components/landing-header.tsx",
  "apps/web/app/components/site-footer.tsx",
  "apps/web/app/components/landing-brand-lockup.tsx",
  "apps/web/app/components/landing-brand-lockup.module.css",
  "apps/web/public/assets/brand/holy-pilot-symbol.svg",
]);
const changed = execFileSync(
  "git",
  ["diff", "--name-only", baseline, "--", "apps/web"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
const untracked = execFileSync(
  "git",
  ["ls-files", "--others", "--exclude-standard", "apps/web"],
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);
for (const path of [...changed, ...untracked])
  assert.ok(allowed.has(path), `Outside approved scope: ${path}`);
const page = "apps/web/app/(public)/page.tsx";
assert.equal(
  await current(page),
  original(page).replace("<SiteFooter />", "<SiteFooter holyPilot />"),
  "Homepage content must remain byte-identical apart from footer opt-in",
);
for (const path of [
  "apps/web/app/globals.css",
  "apps/web/app/components/brand-lockup.tsx",
  "apps/web/app/components/language-switcher.tsx",
  "apps/web/app/icon.svg",
  "apps/web/app/layout.tsx",
  "apps/web/app/(public)/layout.tsx",
])
  assert.equal(
    await current(path),
    original(path),
    `Shared behavior changed: ${path}`,
  );
const footer = "apps/web/app/components/site-footer.tsx";
const partnerStart = '        <a\n          className="footer__partner"';
assert.equal(
  (await current(footer)).split(partnerStart)[1],
  original(footer).split(partnerStart)[1],
  "Astana Hub, links and remaining footer must be identical",
);
assert.ok(
  (await current(footer)).includes("holyPilot = false"),
  "Other pages must retain the original footer by default",
);
assert.equal(
  createHash("sha256")
    .update(await current("apps/web/public/assets/brand/holy-pilot-symbol.svg"))
    .digest("hex"),
  "6001ff52f6ea2e1044c31a86bb3991c1e1783d0e9a6a14e940d5bea917b8c63e",
  "Official mark must not be redrawn",
);
console.log(
  "PASS: exact production baseline, homepage content, shared BrandLockup/CSS, Astana Hub and route scope preserved",
);

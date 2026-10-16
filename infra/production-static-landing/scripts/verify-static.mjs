import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const site = join(root, "site");
const packageBytes = async (path) => {
  const bytes = await readFile(path);
  return /\.(?:html|css|svg|conf)$/.test(path)
    ? Buffer.from(bytes.toString("utf8").replace(/\r\n/g, "\n"))
    : bytes;
};
const manifest = await readFile(join(root, "MANIFEST.sha256"), "utf8");
for (const line of manifest.trim().split("\n")) {
  const match = line.match(
    /^([a-f0-9]{64})  (site\/[\w.-]+|nginx\/holypilot-landing\.conf)$/,
  );
  assert.ok(match, `Malformed manifest line: ${line}`);
  const actual = createHash("sha256")
    .update(await packageBytes(join(root, match[2])))
    .digest("hex");
  assert.equal(actual, match[1], `Changed package file: ${match[2]}`);
}
const sourceSymbol = join(
  root,
  "..",
  "..",
  "apps",
  "web",
  "public",
  "assets",
  "brand",
  "holy-pilot-symbol.svg",
);
const symbol = await packageBytes(join(site, "symbol.svg"));
assert.equal(
  createHash("sha256").update(symbol).digest("hex"),
  createHash("sha256")
    .update(await packageBytes(sourceSymbol))
    .digest("hex"),
  "official symbol must be byte-identical",
);

for (const [file, locale, title, links] of [
  [
    "index.html",
    "ru",
    "HolyPilot — ваш персональный AI-маркетолог",
    ["/auth", "/auth?mode=signup", "/support", "/privacy", "/terms", "/en"],
  ],
  [
    "en.html",
    "en",
    "HolyPilot — your personal AI marketer",
    [
      "/en/auth",
      "/en/auth?mode=signup",
      "/en/support",
      "/en/privacy",
      "/en/terms",
      "/",
    ],
  ],
]) {
  const html = await readFile(join(site, file), "utf8");
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, new RegExp(`<html lang="${locale}">`));
  assert.ok(html.includes(`<title>${title}</title>`));
  assert.match(html, /<meta\s+name="description"/);
  assert.ok(html.includes('rel="canonical"'));
  assert.ok(html.includes('property="og:image"'));
  assert.ok(html.includes('rel="icon"'));
  assert.ok(html.includes('href="/_holypilot/landing.css"'));
  assert.ok(html.includes('src="/_holypilot/symbol.svg"'));
  assert.equal((html.match(/class="brand__mark"/g) ?? []).length, 2);
  assert.ok(
    !/<script\b|on(?:click|load|error)\s*=|http:\/\//i.test(html),
    `${file}: no scripts or active inline handlers`,
  );
  assert.ok(
    !/412\s?500|184\s?300|141\s?900|86\s?300/.test(html),
    `${file}: no invented performance numbers`,
  );
  for (const link of links)
    assert.ok(html.includes(`href="${link}"`), `${file}: missing ${link}`);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, `${file}: duplicate IDs`);
  for (const match of html.matchAll(/href="#([^"]+)"/g))
    assert.ok(ids.includes(match[1]), `${file}: broken anchor ${match[1]}`);
}
const css = await readFile(join(site, "landing.css"), "utf8");
assert.ok(css.includes("@media (max-width: 740px)"));
assert.ok(css.includes("prefers-reduced-motion"));
assert.ok(
  !/@import\b|url\(['"]?https?:/i.test(css),
  "no external CSS dependencies",
);
const snippet = await readFile(
  join(root, "nginx", "holypilot-landing.conf"),
  "utf8",
);
const locations = [...snippet.matchAll(/location\s+=\s+(\S+)\s*\{/g)].map(
  (m) => m[1],
);
assert.deepEqual(locations, [
  "/",
  "/en",
  "/_holypilot/landing.css",
  "/_holypilot/symbol.svg",
  "/_holypilot/icon.svg",
  "/_holypilot/og.png",
  "/_holypilot/manrope-cyrillic.woff2",
]);
assert.ok(!snippet.includes("proxy_pass") && !snippet.includes("sub_filter"));
for (const asset of ["icon.svg", "og.png", "manrope-cyrillic.woff2"])
  assert.ok((await readFile(join(site, asset))).length > 0);
console.log(
  "Static HTML, links, assets, route scope and Nginx snippet checks PASS",
);

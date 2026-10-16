import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const assets = new Map([
  ["/_holypilot/landing.css", ["landing.css", "text/css; charset=utf-8"]],
  ["/_holypilot/symbol.svg", ["symbol.svg", "image/svg+xml"]],
  ["/_holypilot/icon.svg", ["icon.svg", "image/svg+xml"]],
  ["/_holypilot/og.png", ["og.png", "image/png"]],
  [
    "/_holypilot/manrope-cyrillic.woff2",
    ["manrope-cyrillic.woff2", "font/woff2"],
  ],
]);
const publicCsp =
  "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'; upgrade-insecure-requests";

const server = createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const item =
    path === "/"
      ? ["index.html", "text/html; charset=utf-8"]
      : path === "/en"
        ? ["en.html", "text/html; charset=utf-8"]
        : assets.get(path);
  if (!item) {
    res.writeHead(418);
    res.end("Existing Web fallback");
    return;
  }
  try {
    const data = await readFile(join(site, item[0]));
    res.setHeader("Content-Type", item[1]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()",
    );
    if (path === "/" || path === "/en") {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("Content-Security-Policy", publicCsp);
    }
    res.writeHead(200);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.end(data);
  } catch {
    res.writeHead(500);
    res.end();
  }
});

server.listen(
  Number(process.env.HOLYPILOT_PREVIEW_PORT ?? "0"),
  "127.0.0.1",
  () => {
    console.log(`http://127.0.0.1:${server.address().port}`);
  },
);

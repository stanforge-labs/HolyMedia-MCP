import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "preview");
await mkdir(out, { recursive: true });
const server = spawn(process.execPath, [join(root, "scripts", "preview.mjs")], {
  stdio: ["ignore", "pipe", "inherit"],
});
const url = await new Promise((resolve, reject) => {
  let buffer = "";
  server.stdout.on("data", (chunk) => {
    buffer += String(chunk);
    const match = buffer.match(/http:\/\/127\.0\.0\.1:\d+/);
    if (match) resolve(match[0]);
  });
  server.on("exit", (code) =>
    reject(new Error(`Preview server exited ${code}`)),
  );
});

let browser;
try {
  browser = await chromium.launch({ headless: true });
  for (const [locale, path, expectedTitle] of [
    ["ru", "/", "HolyPilot — ваш персональный AI-маркетолог"],
    ["en", "/en", "HolyPilot — your personal AI marketer"],
  ]) {
    for (const [view, width, height] of [
      ["desktop", 1440, 900],
      ["mobile", 390, 844],
      ["small-mobile", 320, 740],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const failures = [];
      page.on("pageerror", (error) =>
        failures.push(`pageerror: ${error.message}`),
      );
      page.on("requestfailed", (request) =>
        failures.push(`request: ${request.url()}`),
      );
      const response = await page.goto(url + path, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200);
      assert.equal(await page.title(), expectedTitle);
      assert.equal(await page.locator("h1").count(), 1);
      assert.equal(await page.locator("script").count(), 0);
      assert.equal(await page.locator(".brand__mark").count(), 2);
      assert.ok(
        await page
          .locator(".brand__mark")
          .first()
          .evaluate((image) => image.complete && image.naturalWidth > 0),
      );
      assert.ok(
        await page
          .locator("body")
          .evaluate(
            (body) =>
              getComputedStyle(body).backgroundColor !== "rgba(0, 0, 0, 0)",
          ),
      );
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      );
      assert.ok(
        overflow <= 1,
        `${locale} ${view}: horizontal overflow ${overflow}px`,
      );
      assert.deepEqual(
        failures,
        [],
        `${locale} ${view}: failed requests or errors`,
      );
      if (view === "desktop") {
        const report = await new AxeBuilder({ page }).analyze();
        assert.deepEqual(
          report.violations.map(
            (violation) =>
              `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
          ),
          [],
          `${locale}: accessibility violations`,
        );
      }
      if (view !== "small-mobile")
        await page.screenshot({
          path: join(out, `${locale}-${view}.png`),
          fullPage: true,
        });
      await context.close();
    }
  }
  const page = await browser.newPage();
  await page.goto(url + "/");
  await page.locator(".locale-switch a").click();
  assert.equal(new URL(page.url()).pathname, "/en");
  assert.equal(await page.locator("html").getAttribute("lang"), "en");
  for (const route of [
    "/auth",
    "/en/auth",
    "/dashboard",
    "/mcp",
    "/api/health",
    "/oauth/authorize",
    "/.well-known/oauth-authorization-server",
    "/mcp/approve",
  ]) {
    const response = await page.request.get(url + route);
    assert.equal(
      response.status(),
      418,
      `${route} must remain with existing Web/API fallback`,
    );
  }
  await page.close();
  console.log(
    `Browser RU/EN, 1440/390/320px, original logo, navigation, fallback routing and CSP preview PASS; screenshots: ${out}`,
  );
} finally {
  await browser?.close();
  server.kill();
}

import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const origin = process.argv[2] ?? "http://127.0.0.1:3107";
assert.ok(
  new URL(origin).hostname === "127.0.0.1",
  "Use a disposable local Web only",
);
const browser = await chromium.launch();
try {
  for (const locale of ["ru", "en"]) {
    const home = locale === "en" ? "/en" : "/";
    const prefix = locale === "en" ? "/en" : "";
    const page = await browser.newPage();
    await page.route("**/api/v1/**", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"unauthenticated"}',
      }),
    );
    await page.goto(origin + home);
    await page
      .locator('.app-loader[data-loader-visible="false"]')
      .waitFor({ state: "attached" });
    assert.equal(
      await page
        .locator('main img[src="/assets/brand/holy-pilot-symbol.svg"]')
        .count(),
      2,
    );
    const tagline =
      locale === "ru"
        ? "Ваш персональный AI-маркетолог"
        : "Your personal AI marketer";
    for (const selector of [".site-brand", ".footer__identity"])
      assert.ok((await page.locator(selector).innerText()).includes(tagline));
    await page.locator('.site-nav a[href$="/auth"]').click();
    await page.waitForURL((url) => url.pathname === `${prefix}/auth`);
    assert.equal(new URL(page.url()).pathname, `${prefix}/auth`);
    assert.equal(
      await page
        .locator('img[src="/assets/brand/holy-pilot-symbol.svg"]')
        .count(),
      0,
      "Login must keep its baseline identity",
    );
    await page.goto(origin + home);
    await page.locator('.hero__actions a[href$="mode=signup"]').click();
    await page.waitForURL(
      (url) =>
        url.pathname === `${prefix}/auth` &&
        url.searchParams.get("mode") === "signup",
    );
    assert.equal(new URL(page.url()).pathname, `${prefix}/auth`);
    assert.equal(new URL(page.url()).searchParams.get("mode"), "signup");
    for (const path of [
      "/privacy",
      "/terms",
      "/support",
      "/mcp/approve",
      "/admin",
      "/connect/claude",
    ]) {
      const response = await page.goto(origin + prefix + path, {
        waitUntil: "networkidle",
      });
      assert.equal(response.status(), 200, `${prefix}${path}`);
      assert.equal(
        await page
          .locator('img[src="/assets/brand/holy-pilot-symbol.svg"]')
          .count(),
        0,
        `Unapproved identity change at ${prefix}${path}`,
      );
    }
    console.log(
      `${locale}: homepage identity, login/signup links and unchanged legal/admin/approval/connection branding PASS`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}

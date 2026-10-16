import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { chromium } from "@playwright/test";

const [label, baseUrl, outputArg] = process.argv.slice(2);
assert.ok(
  label && baseUrl && outputArg,
  "Usage: capture.mjs <label> <origin> <output>",
);
const output = resolve(outputArg, label);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const locale of ["ru", "en"]) {
    for (const theme of ["dark", "light"]) {
      for (const [device, width, height] of [
        ["desktop", 1440, 1000],
        ["tablet", 768, 1024],
        ["mobile", 390, 844],
        ["narrow", 320, 740],
      ]) {
        if (label === "live" && ["tablet", "narrow"].includes(device)) continue;
        const key = `${locale}-${theme}-${device}`;
        const context = await browser.newContext({
          viewport: { width, height },
          deviceScaleFactor: 1,
        });
        await context.addInitScript(
          (value) => localStorage.setItem("holymedia-theme", value),
          theme,
        );
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const response = await page.goto(
          baseUrl + (locale === "en" ? "/en" : "/"),
          { waitUntil: "networkidle" },
        );
        assert.equal(response.status(), 200, key);
        await page
          .locator('.app-loader[data-loader-visible="false"]')
          .waitFor({ state: "attached" });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(450);
        assert.equal(await page.locator("html").getAttribute("lang"), locale);
        assert.equal(
          await page.locator("html").getAttribute("data-theme"),
          theme,
        );
        if (label === "after") {
          const symbols = page.locator(
            'main img[src="/assets/brand/holy-pilot-symbol.svg"]',
          );
          assert.equal(
            await symbols.count(),
            2,
            `${key}: exactly two scoped identities`,
          );
          assert.ok(
            await symbols.evaluateAll((images) =>
              images.every((image) => {
                const box = image.getBoundingClientRect();
                return (
                  image.complete &&
                  image.naturalWidth > 0 &&
                  Math.abs(box.width / box.height - 73.6 / 75.1) < 0.001
                );
              }),
            ),
            `${key}: original symbol ratio`,
          );
          for (const selector of [".site-brand", ".footer__identity"]) {
            assert.ok(
              await page.locator(selector).evaluate((root) => {
                const parent = root.getBoundingClientRect();
                return [...root.querySelectorAll("span,img")].every((child) => {
                  const r = child.getBoundingClientRect();
                  return (
                    r.left >= parent.left - 0.01 &&
                    r.right <= parent.right + 0.01 &&
                    r.top >= parent.top - 0.01 &&
                    r.bottom <= parent.bottom + 0.01
                  );
                });
              }),
              `${key}: identity must fit the original footprint`,
            );
          }
        }
        const state = await page.evaluate(() => {
          const rect = (element) => {
            const b = element.getBoundingClientRect();
            return {
              x: b.x + scrollX,
              y: b.y + scrollY,
              width: b.width,
              height: b.height,
            };
          };
          const allowed = [".site-brand", ".footer__identity"].map(
            (selector) => ({
              selector,
              ...rect(document.querySelector(selector)),
            }),
          );
          const clone = document.querySelector("main.landing").cloneNode(true);
          clone.querySelectorAll("script").forEach((e) => e.remove());
          for (const selector of [".site-brand", ".footer__identity"]) {
            const element = clone.querySelector(selector);
            element.replaceChildren();
            if (selector === ".site-brand")
              element.setAttribute("aria-label", "BRANDING");
          }
          const outside = (e) => !e.closest(".site-brand, .footer__identity");
          const properties = [
            "display",
            "fontFamily",
            "fontSize",
            "fontWeight",
            "lineHeight",
            "color",
            "backgroundColor",
            "padding",
            "margin",
            "gap",
            "gridTemplateColumns",
          ];
          const layout = [...document.querySelectorAll("main.landing *")]
            .filter(
              (e) => outside(e) && !["SCRIPT", "STYLE"].includes(e.tagName),
            )
            .map((element) => {
              const style = getComputedStyle(element);
              return {
                tag: element.tagName,
                class: element.className,
                ...rect(element),
                style: Object.fromEntries(properties.map((p) => [p, style[p]])),
              };
            });
          const links = [...document.querySelectorAll("main.landing a")]
            .filter(outside)
            .map((e) => ({
              href: e.getAttribute("href"),
              text: e.textContent.trim(),
              target: e.getAttribute("target"),
            }));
          const buttons = [
            ...document.querySelectorAll("main.landing button"),
          ].map((e) => ({
            text: e.textContent.trim(),
            visible: !!(
              e.offsetWidth ||
              e.offsetHeight ||
              e.getClientRects().length
            ),
          }));
          const partner = document.querySelector(".footer__partner");
          const images = [...partner.querySelectorAll("img")].map((e) => ({
            src: e.getAttribute("src"),
            display: getComputedStyle(e).display,
            loaded: e.complete && e.naturalWidth > 0,
            ...rect(e),
          }));
          return {
            html: clone.outerHTML,
            layout,
            links,
            buttons,
            allowed,
            width: innerWidth,
            height: document.documentElement.scrollHeight,
            scrollWidth: document.documentElement.scrollWidth,
            partner: { href: partner.getAttribute("href"), images },
          };
        });
        assert.equal(state.partner.href, "https://astanahub.com/");
        assert.equal(state.partner.images.length, 2);
        assert.ok(state.partner.images.every((image) => image.loaded));
        assert.equal(
          state.partner.images.filter((image) => image.display !== "none")
            .length,
          1,
        );
        assert.ok(state.scrollWidth <= width, `${key}: horizontal overflow`);
        assert.deepEqual(errors, [], `${key}: browser errors`);
        await page.screenshot({
          path: join(output, `${key}-full.png`),
          fullPage: true,
          animations: "disabled",
          caret: "hide",
        });
        await page.screenshot({
          path: join(output, `${key}-top.png`),
          animations: "disabled",
          caret: "hide",
        });
        await page.locator("footer").scrollIntoViewIfNeeded();
        await page.screenshot({
          path: join(output, `${key}-footer.png`),
          animations: "disabled",
          caret: "hide",
        });
        await writeFile(
          join(output, `${key}.json`),
          JSON.stringify(state, null, 2),
        );
        results.push({
          key,
          width,
          height: state.height,
          allowed: state.allowed,
        });
        console.log(`${label} ${key} captured; height=${state.height}`);
        await context.close();
      }
    }
  }
  await writeFile(join(output, "index.json"), JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}

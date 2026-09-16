import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { installMockApi } from "./mock-api";
import {
  FRONTEND_ROUTES,
  languageSwitchHref,
  localizedHref,
} from "../apps/web/app/components/locale-routing";

test("locale helpers never prefix technical routes or carry OAuth parameters", () => {
  const oneTimeCode = "a".repeat(43);
  for (const form of ["/auth/reset", "/invitations/accept"]) {
    expect(
      languageSwitchHref(`${form}?token=${oneTimeCode}&code=secret`, "en"),
    ).toBe(`/en${form}?token=${oneTimeCode}`);
    expect(languageSwitchHref(`/en${form}?token=${oneTimeCode}`, "ru")).toBe(
      `${form}?token=${oneTimeCode}`,
    );
  }
  expect(languageSwitchHref(`/auth?token=${oneTimeCode}`, "en")).toBe(
    "/en/auth",
  );
  const transaction = "11111111-1111-4111-8111-111111111111";
  expect(
    languageSwitchHref(
      `/connect/claude?transaction=${transaction}&state=secret`,
      "en",
    ),
  ).toBe(`/en/connect/claude?transaction=${transaction}`);
  for (const path of [
    "/api/v1/providers",
    "/oauth/meta/callback?code=x&state=y",
    "/mcp",
    "/health",
    "/ready",
    "/.well-known/oauth-authorization-server",
    "/api/reports/a/download",
  ])
    expect(localizedHref(path, "en")).toBe(path);
  expect(
    languageSwitchHref(
      "/dashboard/reports?period=30d&code=secret&state=secret&code_verifier=secret#summary",
      "en",
    ),
  ).toBe("/en/dashboard/reports?period=30d#summary");
});

for (const path of FRONTEND_ROUTES.filter(
  (p) => p !== "/app" && p !== "/onboarding",
)) {
  test(`route parity ${path}`, async ({ page }) => {
    await installMockApi(page);
    await page.route("**/api/v1/auth/session", (r) =>
      r.fulfill({ status: 401, json: {} }),
    );
    await page.route("**/api/v1/admin/**", (r) =>
      r.fulfill({ status: 401, json: {} }),
    );
    // Route testing only: no connected provider read or OAuth initiation.
    await page.route("**/workspaces/*/connections", (r) =>
      r.fulfill({ json: [] }),
    );
    await page.addInitScript(() =>
      localStorage.setItem("holymedia-language-v2", "en"),
    );
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(localizedHref(path, "en") + "$"));
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const links = await page
      .locator('a[href^="/"]')
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("href")!));
    for (const link of links) expect(localizedHref(link, "en")).toBe(link);
    await page.getByRole("button", { name: "Русский", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(path === "/" ? "/$" : path + "$"));
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
  });
}

test("EN anonymous deep link and existing session restore preserve URL", async ({
  page,
}) => {
  await installMockApi(page);
  let signedIn = false;
  await page.route("**/api/v1/workspaces", (r) =>
    r.fulfill({
      status: signedIn ? 200 : 401,
      json: signedIn
        ? [{ id: "test", name: "Test", role: "OWNER", accessStatus: "ACTIVE" }]
        : {},
    }),
  );
  await page.route("**/api/v1/auth/session", (r) =>
    r.fulfill({
      status: signedIn ? 200 : 401,
      json: signedIn ? { user: { id: "test" } } : {},
    }),
  );
  await page.goto("/en/dashboard/reports?period=30d");
  await expect(page).toHaveURL(/\/en\/auth\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(
    "/en/dashboard/reports?period=30d",
  );
  signedIn = true;
  await page.reload();
  await expect(page).toHaveURL(/\/en\/dashboard\/reports\?period=30d$/);
});

test("public SEO, exact policy sections, light/dark axe and history", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await installMockApi(page);
  for (const locale of ["ru", "en"] as const) {
    for (const path of ["/", "/privacy", "/terms"]) {
      const target = localizedHref(path, locale);
      await page.goto(target);
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        `https://mcp.holymedia.kz${target === "/" ? "" : target}`,
      );
      await expect(page.locator('link[hreflang="en"]')).toHaveAttribute(
        "href",
        `https://mcp.holymedia.kz${localizedHref(path, "en")}`,
      );
      if (path === "/privacy") {
        await expect(page.locator("article h2")).toHaveCount(14);
        await expect(page.locator("article h3")).toHaveCount(3);
        await expect(page.locator("article")).toContainText(
          "analytics.readonly",
        );
        await expect(page.locator("article")).toContainText("Limited Use");
        if (locale === "en")
          expect(await page.locator("article").innerText()).not.toMatch(
            /[А-Яа-яЁё]/,
          );
        for (const theme of ["light", "dark"]) {
          await page.evaluate((t) => {
            document.documentElement.dataset.theme = t;
          }, theme);
          const results = await new AxeBuilder({ page })
            .include("main")
            .analyze();
          expect(results.violations).toEqual([]);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
        }
      }
    }
  }
  await page.goto("/en/privacy");
  await page.locator('footer a[href="/en/terms"]').click();
  await expect(page).toHaveURL(/\/en\/terms$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/en\/privacy$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/en\/terms$/);
});

test("legacy public locale redirects; no EN technical aliases; private noindex", async ({
  request,
}) => {
  const old = await request.get("/privacy?lang=en", { maxRedirects: 0 });
  expect(old.status()).toBe(308);
  expect(old.headers().location).toContain("/en/privacy");
  for (const route of ["/en/oauth/meta/callback", "/en/api/health", "/en/mcp"])
    expect((await request.get(route)).status()).toBe(404);
  for (const route of ["/dashboard", "/en/dashboard", "/admin", "/en/admin"])
    expect(await (await request.get(route)).text()).toMatch(/noindex/);
  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("/en/privacy");
  expect(sitemap).not.toMatch(/dashboard|admin|oauth/);
});

for (const mode of ["signup", "forgot"]) {
  test(`auth mode preserves locale ${mode}`, async ({ page }) => {
    await installMockApi(page);
    await page.goto(`/auth?mode=${mode}`);
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/en/auth\\?mode=${mode}$`));
    await expect(page.locator("h1")).toHaveText(
      mode === "signup" ? "Create your account" : "Reset your password",
    );
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
}

test("onboarding, legacy redirect and admin existing sections preserve locale", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await installMockApi(page);
  await page.route("**/api/v1/workspaces", (r) =>
    r.fulfill({
      json: [
        { id: "test", name: "Test", role: "OWNER", accessStatus: "PENDING" },
      ],
    }),
  );
  await page.route("**/api/v1/workspaces/test", (r) =>
    r.fulfill({ json: { name: "Test", registrationCountry: "KZ" } }),
  );
  await page.goto("/en/onboarding");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.reload();
  await expect(page).toHaveURL(/\/en\/onboarding$/);
  await page.getByRole("button", { name: "Русский", exact: true }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.goto("/en/app");
  await expect(page).toHaveURL(/\/en\/dashboard$/);
  await page.route("**/api/v1/admin/**", (r) => r.fulfill({ json: {} }));
  for (const section of [
    "overview",
    "companies",
    "users",
    "diagnostics",
    "support",
    "tariff-requests",
    "audit",
  ]) {
    await page.goto(`/en/admin?section=${section}`);
    await expect(page.locator("main.admin-shell")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1")).not.toHaveText(/[А-Яа-яЁё]/);
    await page.getByRole("button", { name: "Русский", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin\\?section=${section}$`));
    await page.reload();
    await expect(page.locator("main.admin-shell")).toBeVisible();
  }
});

test("admin locale controls never overlap logout at narrow widths", async ({
  page,
}) => {
  await installMockApi(page);
  await page.route("**/api/v1/admin/**", (r) => r.fulfill({ json: {} }));
  for (const width of [320, 600, 820]) {
    await page.setViewportSize({ width, height: 850 });
    for (const prefix of ["", "/en"]) {
      await page.goto(`${prefix}/admin`);
      const logout = page.locator(".admin-header__actions > button");
      await expect(logout).toBeVisible();
      await logout.click({ trial: true });
      const controls = await page
        .locator(".admin-header .header-preferences")
        .boundingBox();
      const button = await logout.boundingBox();
      expect(controls!.x + controls!.width).toBeLessThanOrEqual(button!.x);
      expect(button!.x + button!.width).toBeLessThanOrEqual(width);
    }
  }
});

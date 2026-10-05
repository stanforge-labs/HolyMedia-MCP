import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const locale of ["ru", "en"] as const) {
  const path = locale === "ru" ? "/support" : "/en/support";
  const title =
    locale === "ru" ? "Поддержка HolyMedia MCP" : "HolyMedia MCP Support";

  test(`public support page and legal links work in ${locale}`, async ({
    page,
  }) => {
    // The public header's optional session probe does not contact a live API.
    await page.route("**/api/v1/workspaces", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: "{}",
      }),
    );
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
    await expect(page).toHaveTitle(
      locale === "ru" ? `${title} | HolyMedia MCP` : title,
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://mcp.holymedia.kz${path}`,
    );
    await expect(page.getByRole("heading", { level: 2 })).toHaveCount(5);
    await expect(page.locator('a[href="mailto:mcp@holymedia.kz"]')).toHaveText(
      "mcp@holymedia.kz",
    );
    for (const legal of ["privacy", "terms"]) {
      const href = `${locale === "en" ? "/en" : ""}/${legal}`;
      await expect(page.locator(`.legal-card a[href="${href}"]`)).toBeVisible();
      const legalResponse = await page.request.get(href);
      expect(legalResponse.status()).toBe(200);
    }
    await expect(page.locator(`footer a[href="${path}"]`)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
    const accessibility = await new AxeBuilder({ page })
      .include(".legal-card")
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });
}

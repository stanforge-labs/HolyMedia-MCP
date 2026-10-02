import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installMockApi } from "./mock-api";

const email = "phase-b-legacy-user@example.test";
const password = "Phase-B-legacy-password-123!";

async function login(page: Page) {
  await page.goto("/auth");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Войти", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function expectAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations, label).toEqual([]);
}

test("tariffs, profile, AI client and light-theme assets remain usable", async ({
  page,
}, testInfo) => {
  await installMockApi(page);
  await login(page);

  await page.getByRole("button", { name: "Тарифы", exact: true }).click();
  const tariffs = page.locator("#tariffs");
  await expect(tariffs).toBeVisible();
  await expectAxe(page, "self-service tariffs");
  await tariffs.screenshot({
    path: testInfo.outputPath("tariffs-self-dark.png"),
  });

  await page.getByRole("radio", { name: "Расширенная поддержка" }).click();
  await expect(
    page.getByRole("heading", { name: "Что добавляет расширенная поддержка" }),
  ).toBeVisible();
  await expectAxe(page, "support tariffs");
  await tariffs.screenshot({
    path: testInfo.outputPath("tariffs-support-dark.png"),
  });

  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await tariffs.screenshot({
    path: testInfo.outputPath("tariffs-support-light.png"),
  });

  await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
  const tokenForm = page.locator("form.token-form");
  await expect(tokenForm.locator(".scope-note")).toContainText(
    "всем подключённым и выбранным ресурсам",
  );
  await tokenForm.getByRole("button", { name: "Срок действия" }).click();
  await expect(
    page.getByRole("listbox", { name: "Срок действия" }),
  ).toBeVisible();
  await expectAxe(page, "AI client");
  await page
    .locator(".mcp-setup")
    .screenshot({ path: testInfo.outputPath("ai-client-light-dropdown.png") });
  await page.keyboard.press("Escape");

  await page.locator(".profile-link").click();
  const profile = page.getByRole("heading", { name: "Профиль", exact: true });
  await expect(profile).toBeVisible();
  await expectAxe(page, "profile");
  await page
    .locator(".section")
    .filter({ has: profile })
    .screenshot({ path: testInfo.outputPath("profile-light.png") });

  await page.getByRole("button", { name: "Подключения", exact: true }).click();
  await expect(page.getByText("TikTok Ads", { exact: true })).toBeVisible();
  await page
    .locator(".connection-list")
    .screenshot({ path: testInfo.outputPath("connections-tiktok-light.png") });

  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page
    .locator(".connection-list")
    .screenshot({ path: testInfo.outputPath("connections-tiktok-dark.png") });
  await page.locator(".footer__partner").screenshot({
    path: testInfo.outputPath("astana-hub-dark.png"),
  });
  await page.getByRole("radio", { name: "Light", exact: true }).click();
  await page.locator(".footer__partner").screenshot({
    path: testInfo.outputPath("astana-hub-light.png"),
  });
});

import { expect, test, chromium } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installMockApi } from "./mock-api";

for (const theme of ["light", "dark"]) {
  test(`TikTok save lifecycle ${theme}`, async ({ page }) => {
    await installMockApi(page);
    await page.addInitScript((t) => {
      localStorage.setItem("holymedia-theme", t);
    }, theme);
    const accounts = [
      {
        id: "tiktok-account",
        externalAccountId: "1234567890123456789",
        displayName: "TikTok test account",
        enabled: false,
        status: "ENABLED",
      },
    ];
    await page.route("**/workspaces/*/connections", (route) =>
      route.fulfill({
        json: [
          {
            id: "tiktok-connection",
            provider: "TIKTOK_ADS",
            displayName: "TikTok",
            status: "CONNECTED",
            accounts,
          },
        ],
      }),
    );
    let reject = true;
    await page.route(
      "**/connections/tiktok-connection/accounts",
      async (route) => {
        if (reject)
          return route.fulfill({
            status: 503,
            json: { message: "unavailable" },
          });
        const selected = route.request().postDataJSON().accountIds as string[];
        accounts[0]!.enabled = selected.includes(accounts[0]!.id);
        await route.fulfill({ json: accounts });
      },
    );
    await page.goto("/dashboard/connections");
    const trigger = page.getByRole("button", { name: /Посмотреть кабинеты/ });
    await trigger.click();
    const dialog = page.getByRole("dialog");
    const checkbox = dialog.getByRole("checkbox").last();
    await checkbox.check();
    await dialog.getByRole("button", { name: "Сохранить выбор" }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(checkbox).toBeChecked();
    reject = false;
    await dialog.getByRole("button", { name: "Сохранить выбор" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(dialog.getByRole("checkbox").last()).toBeChecked();
    await dialog.getByRole("button", { name: "Сохранить выбор" }).click();
    await expect(dialog).toHaveCount(0);
  });
}

test("temporary bootstrap failure does not force login", async ({ page }) => {
  await installMockApi(page);
  await page.route("**/api/v1/workspaces", (route) =>
    route.fulfill({ status: 503, json: {} }),
  );
  await page.goto("/dashboard/connections");
  await expect(page.getByText(/Не удалось восстановить данные/)).toBeVisible();
  await expect(page).toHaveURL(/dashboard\/connections$/);
});

test("valid session restores from login to requested deep link", async ({
  page,
}) => {
  await installMockApi(page);
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { user: { id: "test-user" } } }),
  );
  await page.goto("/auth?next=%2Fdashboard%2Fconnections");
  await expect(page).toHaveURL(/dashboard\/connections$/);
  await page.reload();
  await expect(page).toHaveURL(/dashboard\/connections$/);
});

test("real session survives Chromium process restart and logout revokes it", async ({}, testInfo) => {
  test.skip(
    !process.env.V2_E2E_EMAIL,
    "Requires isolated CI API/database fixture, never production credentials",
  );
  const directory = await mkdtemp(join(tmpdir(), "holymedia-session-browser-"));
  const options = {
    headless: true,
    baseURL: String(testInfo.project.use.baseURL ?? "http://localhost:3000"),
  };
  let context = await chromium.launchPersistentContext(directory, options);
  try {
    let page = context.pages()[0] ?? (await context.newPage());
    await page.goto("/auth?next=%2Fdashboard%2Fconnections");
    await page.locator('input[name="email"]').fill(process.env.V2_E2E_EMAIL!);
    await page
      .locator('input[name="password"]')
      .fill(process.env.V2_E2E_PASSWORD!);
    await page
      .getByRole("button", { name: "Войти", exact: true })
      .last()
      .click();
    await expect(page).toHaveURL(/dashboard\/connections$/);
    const cookie = (await context.cookies()).find(
      (c) => c.name === "hm_v2_session",
    );
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie!.expires - Date.now() / 1000).toBeGreaterThan(13 * 86400);
    await page.reload();
    await expect(page).toHaveURL(/dashboard\/connections$/);
    await context.close();
    context = await chromium.launchPersistentContext(directory, options);
    page = context.pages()[0] ?? (await context.newPage());
    await page.goto("/dashboard/connections");
    await expect(page.locator("main.dashboard-shell")).toBeVisible();
    await expect(page).toHaveURL(/dashboard\/connections$/);
    await page.getByRole("button", { name: "Выйти", exact: true }).click();
    await expect(page).toHaveURL(/auth/);
    await page.goto("/dashboard/connections");
    await expect(page).toHaveURL(/auth\?next=/);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});

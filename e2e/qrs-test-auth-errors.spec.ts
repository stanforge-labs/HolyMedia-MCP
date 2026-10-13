import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/auth/session", async (route) => {
    await route.fulfill({ status: 401, body: "{}" });
  });
});

test("invalid email is rejected in the browser before any login request", async ({
  page,
}) => {
  let loginCalls = 0;
  await page.route("**/api/v1/auth/login", async (route) => {
    loginCalls += 1;
    await route.fulfill({ status: 401, body: "{}" });
  });
  await page.goto("/auth");
  await page.getByLabel("Email").fill("Admin");
  await page.getByLabel("Пароль", { exact: true }).fill("synthetic-value");
  await page.getByRole("button", { name: "Войти", exact: true }).last().click();
  await expect(
    page.getByText("Укажите корректный адрес электронной почты."),
  ).toBeVisible();
  expect(loginCalls).toBe(0);
});

test("invalid credentials and network failures are distinct", async ({
  page,
}) => {
  await page.route("**/api/v1/auth/csrf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "synthetic-csrf" }),
    });
  });
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({ status: 401, body: "{}" });
  });
  await page.goto("/auth");
  await page.getByLabel("Email").fill("owner@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("synthetic-value");
  await page.getByRole("button", { name: "Войти", exact: true }).last().click();
  await expect(page.getByText("Неверный email или пароль.")).toBeVisible();

  await page.route("**/api/v1/auth/csrf", async (route) => {
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Войти", exact: true }).last().click();
  await expect(
    page.getByText("Нет связи с сервисом входа.", { exact: false }),
  ).toBeVisible();
});

test("restricted Google denial explains the TEST owner boundary", async ({
  page,
}) => {
  await page.goto("/auth?error=google_access");
  await expect(
    page.getByText(
      "Этот Google-аккаунт не привязан к разрешённому владельцу TEST workspace.",
    ),
  ).toBeVisible();
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const transaction = "11111111-1111-4111-8111-111111111111";
const primaryWorkspace = "22222222-2222-4222-8222-222222222222";
const secondWorkspace = "33333333-3333-4333-8333-333333333333";

async function installConsentApi(
  page: Page,
  client: { id: string; name: string } = {
    id: "hm_public_test",
    name: "Claude",
  },
) {
  let consentBody: Record<string, unknown> | null = null;
  await page.route("**/oauth/authorize/transaction?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        transactionId: transaction,
        client,
        scope: "adforge:mcp:read",
        resource: "https://mcp.holymedia.kz/mcp",
        selectedWorkspaceId: null,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        workspaces: [
          { id: primaryWorkspace, name: "HolyMedia", role: "OWNER" },
          { id: secondWorkspace, name: "Second company", role: "ADMIN" },
        ],
      }),
    });
  });
  await page.route("**/api/v1/auth/csrf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "test-csrf" }),
    });
  });
  await page.route("**/oauth/authorize/consent", async (route) => {
    consentBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        redirect_url:
          "http://localhost:3000/oauth-test-complete?state=original",
      }),
    });
  });
  await page.route("**/oauth-test-complete?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "done",
    });
  });
  return { consentBody: () => consentBody };
}

test("ChatGPT CIMD consent uses verified client branding", async ({ page }) => {
  await installConsentApi(page, {
    id: "https://chatgpt.com/oauth/4CPt0xAKQRoU/client.json",
    name: "ChatGPT",
  });
  await page.goto(`/connect/claude?transaction=${transaction}`);
  await expect(
    page.getByRole("heading", { name: "Подключить ChatGPT" }),
  ).toBeVisible();
  await expect(
    page.getByText("ChatGPT запрашивает доступ к вашему HolyMedia MCP."),
  ).toBeVisible();
  await expect(page.getByText("ChatGPT сможет")).toBeVisible();
  await expect(page.getByText("ChatGPT не получает")).toBeVisible();
});

test("Claude consent is accessible, theme-aware and binds the selected company", async ({
  page,
}, testInfo) => {
  const api = await installConsentApi(page);
  await page.addInitScript(() =>
    localStorage.setItem("holymedia-theme", "light"),
  );
  await page.goto(`/connect/claude?transaction=${transaction}`);

  await expect(
    page.getByRole("heading", { name: "Подключить Claude" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.getByText("HolyMedia", { exact: true })).toBeVisible();
  await expect(page.getByText("Second company", { exact: true })).toBeVisible();
  await expect(page.getByText(primaryWorkspace)).toHaveCount(0);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("claude-consent-light.png"),
    fullPage: true,
  });

  await page.getByLabel("Second company").check();
  await page.getByRole("button", { name: "Разрешить" }).click();
  await expect(page).toHaveURL(/oauth-test-complete/);
  expect(api.consentBody()).toEqual({
    transaction_id: transaction,
    workspace_id: secondWorkspace,
    decision: "allow",
    approved_scope: "adforge:mcp:read",
  });
});

test("Claude consent supports denial and dark mobile layout without overflow", async ({
  page,
}, testInfo) => {
  const api = await installConsentApi(page);
  await page.addInitScript(() =>
    localStorage.setItem("holymedia-theme", "dark"),
  );
  await page.goto(`/connect/claude?transaction=${transaction}`);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(overflow).toBe(false);
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("claude-consent-dark.png"),
    fullPage: true,
  });

  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(page).toHaveURL(/oauth-test-complete/);
  expect(api.consentBody()).toMatchObject({ decision: "deny" });
});

test("password login resumes the exact OAuth transaction", async ({ page }) => {
  await page.route("**/api/v1/auth/csrf", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "test-csrf" }),
    });
  });
  await page.route("**/api/v1/auth/login", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { id: "user" } }),
    });
  });
  await page.route("**/oauth/authorize/continue?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "continued",
    });
  });

  await page.goto(`/auth?oauth_transaction=${transaction}`);
  await expect(page.locator("a.google-login-button")).toHaveAttribute(
    "href",
    new RegExp(`oauth_transaction=${transaction}`),
  );
  await page.getByLabel("Email").fill("client@example.test");
  await page.getByLabel("Пароль", { exact: true }).fill("safe-test-password");
  await page.getByRole("button", { name: "Войти", exact: true }).last().click();
  await expect(page).toHaveURL(
    new RegExp(`/oauth/authorize/continue\\?transaction=${transaction}`),
  );
});

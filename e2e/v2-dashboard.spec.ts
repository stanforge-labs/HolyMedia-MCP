import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { installMockApi } from "./mock-api";

const legacyEmail =
  process.env.V2_E2E_EMAIL ?? "phase-b-legacy-user@example.test";
const legacyPassword =
  process.env.V2_E2E_PASSWORD ?? "Phase-B-legacy-password-123!";
const connectionId = "22222222-2222-4222-8222-222222222222";

function collectClientFailures(page: Page) {
  const failures: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("eval() is not supported in this environment") &&
      !message.text().includes("React will never use eval() in production mode")
    )
      failures.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("favicon")) return;
    if (request.failure()?.errorText === "net::ERR_ABORTED") return;
    failures.push(
      `request: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
    );
  });
  return failures;
}

async function login(page: Page) {
  await page.goto("/auth");
  await page.locator('input[name="email"]').fill(legacyEmail);
  await page.locator('input[name="password"]').fill(legacyPassword);
  await page.getByRole("button", { name: "Войти", exact: true }).last().click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("main.dashboard-shell")).toBeVisible();
}

async function selectProjectOption(
  page: Page,
  ariaLabel: string,
  optionName: string,
) {
  const trigger = page.getByRole("button", { name: ariaLabel, exact: true });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
  }
  const listbox = page.getByRole("listbox", { name: ariaLabel, exact: true });
  await expect(listbox).toBeVisible();
  await listbox.getByRole("option", { name: optionName, exact: true }).click();
}

test.describe("restored HolyMedia client UX", () => {
  test("uses route-backed dashboard navigation and keeps paused tools unavailable", async ({
    page,
  }) => {
    await installMockApi(page);
    await login(page);

    await page
      .getByRole("button", { name: "Подключения", exact: true })
      .click();
    await expect(page).toHaveURL(/\/dashboard\/connections$/);
    await expect(page.getByRole("heading", { name: "Meta Ads" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.goto("/dashboard/reports");
    await expect(
      page.getByRole("heading", { name: "Отчёт по рекламному кабинету" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /SEO/ })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: /Анализ сайта/ }),
    ).toBeDisabled();

    await page.goto("/dashboard/analysis");
    await expect(
      page.getByRole("heading", { name: "Анализ сайта скоро вернётся" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Запустить аудит/ }),
    ).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("keeps an active session when returning from legal pages", async ({
    page,
  }) => {
    await installMockApi(page);
    await page.goto("/privacy");
    const brand = page.locator(".legal-brand");
    await expect(brand).toHaveAttribute("href", "/dashboard");
    await brand.click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.locator("main.dashboard-shell")).toBeVisible();
  });

  test("direct auth modes and a new registration work", async ({
    page,
  }, testInfo) => {
    await installMockApi(page);
    const failures = collectClientFailures(page);
    await page.goto("/");
    await page.screenshot({
      path: testInfo.outputPath("landing.png"),
      fullPage: true,
    });
    await page.goto("/auth?mode=signup");
    await expect(
      page.getByRole("heading", { name: "Новый аккаунт" }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Регистрация" }),
    ).toHaveAttribute("aria-selected", "true");
    const [leadBox, googleBox, formBox] = await Promise.all([
      page.locator("#auth-panel > .muted").boundingBox(),
      page.locator(".google-login-button").boundingBox(),
      page.locator("#auth-panel > form").boundingBox(),
    ]);
    expect(leadBox).not.toBeNull();
    expect(googleBox).not.toBeNull();
    expect(formBox).not.toBeNull();
    expect(
      googleBox!.y - (leadBox!.y + leadBox!.height),
    ).toBeGreaterThanOrEqual(8);
    expect(googleBox!.y - (leadBox!.y + leadBox!.height)).toBeLessThanOrEqual(
      12,
    );
    expect(
      formBox!.y - (googleBox!.y + googleBox!.height),
    ).toBeGreaterThanOrEqual(23);
    await expect(
      page
        .locator('input[name="confirmPassword"]')
        .evaluate((input) => (input as HTMLInputElement).required),
    ).resolves.toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "English" }).click();
    await expect(
      page.getByRole("heading", { name: "Create your account" }),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("button", { name: "Русский" }).click();
    const password = page.locator('input[name="password"]');
    await page.locator(".password-toggle").first().click();
    await expect(password).toHaveAttribute("type", "text");
    await page.screenshot({
      path: testInfo.outputPath("registration.png"),
      fullPage: true,
    });

    await page.goto("/auth?mode=forgot");
    await expect(page.locator(".auth-recovery-back")).toHaveCount(1);
    await expect(page.locator("a.back-link")).toHaveCount(0);
    await page.locator(".auth-recovery-back").click();
    await expect(page.getByRole("tab", { name: "Войти" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "Регистрация" }).click();

    const email = `playwright-${Date.now()}-${test.info().project.name}@example.test`;
    await page.locator('input[name="name"]').fill("Playwright User");
    await page.locator('input[name="email"]').fill(email);
    await page
      .locator('input[name="password"]')
      .fill("Playwright-password-123!");
    await page
      .locator('input[name="confirmPassword"]')
      .fill("Playwright-password-123!");
    await page.getByRole("button", { name: "Зарегистрироваться" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "Реклама в вашем AI-чате" }),
    ).toBeVisible();
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("shows live overview counts and routes to the useful next step", async ({
    page,
  }) => {
    await installMockApi(page);
    await login(page);

    const accessKeys = page
      .locator(".stat-card--link")
      .filter({ hasText: "Ключи доступа" });
    await expect(accessKeys).toContainText("1");
    await expect(accessKeys).toContainText("активных ключей");
    await accessKeys.click();
    await expect(
      page.getByRole("heading", { name: "Подключите HolyMedia MCP" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Обзор", exact: true }).click();
    const tariff = page
      .locator(".stat-card--link")
      .filter({ hasText: "Тариф" });
    await expect(tariff).toContainText("Не определён");
    await tariff.click();
    await expect(
      page.getByRole("heading", { name: "Тарифы HolyMedia MCP" }),
    ).toBeVisible();
  });

  test("keeps account selection controls clear and releases OAuth navigation on Back", async ({
    page,
  }) => {
    await installMockApi(page);
    await login(page);
    await page
      .getByRole("button", { name: "Подключения", exact: true })
      .click();

    const metaCard = page
      .locator(".connection-card")
      .filter({ hasText: "Meta Ads" });
    await expect(metaCard).toBeVisible();
    await metaCard.getByRole("button", { name: "Посмотреть кабинеты" }).click();
    const selector = page.getByRole("dialog", { name: "Выберите кабинеты" });
    const close = selector.getByRole("button", {
      name: "Закрыть выбор: кабинеты",
    });
    const bulkActions = selector.locator(".bulk-actions");
    await expect(close).toBeVisible();
    await expect(bulkActions).toBeVisible();

    const [closeBox, bulkBox, scrollbarColor] = await Promise.all([
      close.boundingBox(),
      bulkActions.boundingBox(),
      selector.evaluate((element) => getComputedStyle(element).scrollbarColor),
    ]);
    expect(closeBox).not.toBeNull();
    expect(bulkBox).not.toBeNull();
    expect(scrollbarColor).not.toBe("auto");
    expect(bulkBox!.y).toBeGreaterThanOrEqual(closeBox!.y + closeBox!.height);

    const selectedBeforeClose = await selector
      .locator('input[type="checkbox"]:checked')
      .count();
    await close.click();
    await expect(selector).toHaveCount(0);
    await metaCard.getByRole("button", { name: "Посмотреть кабинеты" }).click();
    await expect(
      page
        .getByRole("dialog", { name: "Выберите кабинеты" })
        .locator('input[type="checkbox"]:checked'),
    ).toHaveCount(selectedBeforeClose);
    await page.getByRole("button", { name: "Отмена" }).first().click();

    await page.route("https://oauth.example.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<title>Provider authorization</title><main>Provider authorization</main>",
      }),
    );
    const googleCard = page
      .locator(".connection-card")
      .filter({ hasText: "Google Ads" });
    const connect = googleCard.getByRole("button", {
      name: "Подключить Google Ads",
    });
    await connect.click();
    await expect(page).toHaveURL(/oauth\.example\.test/);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(connect).toBeEnabled();
  });

  test("shows Google Search Console and lets an owner select GA4 properties", async ({
    page,
  }) => {
    await installMockApi(page);
    await login(page);
    await page
      .getByRole("button", { name: "Подключения", exact: true })
      .click();

    const cards = page.locator(".connection-card");
    await expect(
      cards.last().getByRole("heading", { name: "Google Analytics" }),
    ).toBeVisible();
    const searchConsoleCard = cards.filter({
      hasText: "Google Search Console",
    });
    await expect(searchConsoleCard).toBeVisible();
    await expect(
      searchConsoleCard.getByRole("button", {
        name: /Google Search Console/,
      }),
    ).toBeEnabled();
    const analyticsCard = cards.filter({ hasText: "Google Analytics" });
    await analyticsCard
      .getByRole("button", { name: "Посмотреть ресурсы" })
      .click();
    const selector = page.getByRole("dialog", { name: "Выберите ресурсы" });
    await expect(
      selector.getByText("HolyMedia GA4", { exact: true }),
    ).toBeVisible();
    await expect(
      selector.getByText("987654321", { exact: true }),
    ).toBeVisible();
    await selector.getByRole("button", { name: "Отмена" }).click();
  });

  test("connections, account selection, MCP, reports and profile form a complete flow", async ({
    page,
  }, testInfo) => {
    await installMockApi(page);
    const failures = collectClientFailures(page);
    await login(page);

    await expect(page.getByText("Workspace", { exact: true })).toHaveCount(0);
    await expect(page.getByText("OWNER", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Тарифы", exact: true }),
    ).toBeEnabled();
    await expect(page.getByRole("button", { name: /SEO/ })).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath("dashboard.png"),
      fullPage: true,
    });

    await page.goto(
      "/dashboard?section=connections&oauth=success&provider=meta_ads",
    );
    await expect(
      page.getByText(
        "Платформа подключена. Откройте список кабинетов и выберите нужные.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Meta Ads" })).toBeVisible();
    const googleCard = page
      .locator(".connection-card")
      .filter({ hasText: "Google Ads" });
    await expect(googleCard).toContainText("Платформа ещё не подключена.");
    await expect(
      googleCard.getByRole("button", { name: "Подключить Google Ads" }),
    ).toBeVisible();
    const metaCard = page
      .locator(".connection-card")
      .filter({ hasText: "Meta Ads" });
    const selector = page.getByRole("dialog", { name: "Выберите кабинеты" });
    if (!(await selector.isVisible()))
      await metaCard
        .getByRole("button", { name: "Посмотреть кабинеты" })
        .click();
    await expect(selector).toBeVisible();
    await selector.screenshot({
      path: testInfo.outputPath("account-selector.png"),
    });
    const checkedAccounts = selector.locator('input[type="checkbox"]:checked');
    if ((await checkedAccounts.count()) > 0) {
      await selector.getByRole("button", { name: "Снять все" }).click();
      const clearResponse = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          response.url().includes(`/connections/${connectionId}/accounts`),
      );
      await selector.getByRole("button", { name: "Сохранить выбор" }).click();
      expect((await clearResponse).ok()).toBeTruthy();
      await expect(selector).toHaveCount(0);
      await metaCard
        .getByRole("button", { name: "Посмотреть кабинеты" })
        .click();
    }
    const reopenedSelector = page.getByRole("dialog", {
      name: "Выберите кабинеты",
    });
    await reopenedSelector.getByRole("button", { name: "Выбрать все" }).click();
    const allCheckboxes = reopenedSelector.locator('input[type="checkbox"]');
    await allCheckboxes.nth(1).uncheck();
    const saveResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes(`/connections/${connectionId}/accounts`),
    );
    await reopenedSelector
      .getByRole("button", { name: "Сохранить выбор" })
      .click();
    expect((await saveResponse).ok()).toBeTruthy();
    await expect(page.getByText("Выбранные кабинеты сохранены.")).toBeVisible();
    const refreshResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        response
          .url()
          .includes(`/connections/${connectionId}/accounts/discover`),
    );
    await metaCard.getByRole("button", { name: "Обновить" }).click();
    expect((await refreshResponse).ok()).toBeTruthy();
    await expect(
      page.getByText(
        "Список кабинетов обновлён. Сохранённый выбор не изменён.",
      ),
    ).toBeVisible();
    await page.reload();
    await page
      .locator(".connection-card")
      .filter({ hasText: "Meta Ads" })
      .getByRole("button", { name: "Посмотреть кабинеты" })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "Выберите кабинеты" })
        .locator('input[type="checkbox"]:checked'),
    ).toHaveCount(1);
    await page.getByRole("button", { name: "Отмена" }).first().click();

    await metaCard.getByRole("button", { name: "Отключить" }).click();
    await expect(page.getByRole("dialog")).toContainText("Отключить Meta Ads?");
    await page.getByRole("button", { name: "Отмена" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("connections.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
    await expect(page.locator(".mcp-step .copy-row code").first()).toHaveText(
      "https://mcp.holymedia.kz/mcp",
    );
    await expect(page.getByRole("tab", { name: "Codex" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tabpanel")).toContainText("Authorization");
    await expect(page.getByRole("tabpanel")).toContainText("Bearer");
    await expect(page.getByRole("tabpanel")).not.toContainText(
      "HOLYMEDIA_MCP_TOKEN",
    );
    await expect(page.getByRole("tabpanel")).toContainText(
      "Переменная окружения токена Bearer",
    );
    await page.getByRole("tab", { name: "Claude" }).click();
    await expect(page.getByRole("tabpanel")).toContainText(
      "Подключение выполняется через OAuth",
    );
    await expect(page.getByRole("tabpanel")).toContainText(
      "Customize → Connectors",
    );
    await expect(page.getByRole("tabpanel")).toContainText("Always required");
    await expect(page.getByRole("tabpanel")).toContainText(
      "No client ID — register one automatically",
    );
    await expect(page.getByRole("tabpanel")).toContainText("Connected");
    await expect(page.getByRole("tabpanel")).toContainText(
      "Покажи активные кампании Google Ads.",
    );
    await expect(page.getByText("Ключ доступа не требуется")).toBeVisible();
    await expect(page.locator("form.token-form")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Создать ключ" }),
    ).toHaveCount(0);

    await page.getByRole("tab", { name: "ChatGPT" }).click();
    await expect(page.getByText("Ключ доступа не требуется")).toBeVisible();
    await expect(page.locator("form.token-form")).toHaveCount(0);
    await expect(page.getByRole("tabpanel")).toContainText(
      "Просмотреть плагины",
    );
    await expect(page.getByRole("tabpanel")).toContainText(
      "Войти через HolyMedia MCP",
    );
    await expect(page.getByRole("tabpanel")).toContainText(
      "Расширенные настройки OAuth",
    );
    await expect(page.getByRole("tabpanel")).toContainText(
      "Покажи активные кампании Google Ads.",
    );

    await page.getByRole("tab", { name: "Codex" }).click();
    await expect(page.getByText("Ключ доступа не требуется")).toHaveCount(0);

    const tokenForm = page.locator("form.token-form");
    await tokenForm.locator('input[name="name"]').fill("Playwright client");
    const tokenRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/service-tokens"),
    );
    await tokenForm.getByRole("button", { name: "Создать ключ" }).click();
    const readOnlyRequest = (await tokenRequest).postDataJSON();
    expect(readOnlyRequest.scopes).toEqual(["adforge:mcp:read"]);
    expect(readOnlyRequest).not.toHaveProperty("accountIds");
    await expect(page.locator(".one-time-secret")).toBeVisible();
    await expect(page.locator(".account-picker")).toHaveCount(0);
    await expect(page.locator(".scope-note")).toContainText(
      "всем подключённым кабинетам",
    );
    await expect(tokenForm.locator('input[name="name"]')).toHaveValue("");
    await expect(page.locator(".notice--error")).toHaveCount(0);
    await page.getByRole("button", { name: "Скрыть" }).click();
    await tokenForm.locator('input[name="name"]').fill("Controlled review");
    await tokenForm
      .getByRole("button", { name: "Режим доступа", exact: true })
      .click();
    await tokenForm
      .getByRole("option", { name: "Контролируемая запись", exact: true })
      .click();
    const controlledRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/service-tokens"),
    );
    await tokenForm.getByRole("button", { name: "Создать ключ" }).click();
    expect((await controlledRequest).postDataJSON().scopes).toEqual([
      "adforge:mcp:read",
      "adforge:mcp:write",
    ]);
    await expect(tokenForm.locator('input[name="access_mode"]')).toHaveValue(
      "read_only",
    );
    await page.getByRole("button", { name: "Скрыть" }).click();
    await page.screenshot({
      path: testInfo.outputPath("mcp.png"),
      fullPage: true,
    });
    let reportUrl = "";
    await page.route("**/reports/performance?**", async (route) => {
      reportUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          account: {
            provider: "META_ADS",
            externalAccountId: "act_123",
            name: "Test account",
            currency: "USD",
            timezone: "UTC",
          },
          period: { startDate: "2026-01-01", endDate: "2026-01-07" },
          metrics: {
            spend: { amount: "10", currency: "USD" },
            impressions: 100,
            clicks: 10,
            conversions: 1,
          },
          campaigns: [],
          provenance: { summary: { realData: true } },
        }),
      });
    });

    await page.getByRole("button", { name: "Отчёты", exact: true }).click();
    await page.route("**/reports/performance.*?**", async (route) => {
      reportUrl = route.request().url();
      const isPresentation = new URL(reportUrl).pathname.endsWith(".pptx");
      await route.fulfill({
        status: 200,
        contentType: isPresentation
          ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        body: "PK-test",
      });
    });
    await expect(
      page.getByText("Сначала выберите рекламный кабинет."),
    ).toBeVisible();
    await page.locator(".report-account-trigger").click();
    const reportPicker = page.getByRole("dialog", {
      name: "Выберите рекламную платформу",
    });
    await expect(reportPicker).toBeVisible();
    await expect(reportPicker.getByText("Meta Ads")).toBeVisible();
    await expect(
      reportPicker.getByRole("button", { name: "Скрыть кабинеты" }),
    ).toHaveCount(0);
    await expect(
      reportPicker.getByRole("button", {
        name: "Закрыть выбор кабинета для отчёта",
      }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(reportPicker).toHaveCount(0);
    await expect(page.locator(".report-account-trigger")).toBeFocused();
    await page.locator(".report-account-trigger").click();
    await reportPicker
      .getByRole("button", { name: "Показать кабинеты" })
      .click();
    await expect(
      page.getByRole("dialog", { name: /Кабинеты Meta Ads/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Скрыть кабинеты" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: /Основной рекламный кабинет/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect.poll(() => reportUrl).not.toBe("");
    let previewParams = new URL(reportUrl).searchParams;
    expect(
      (new Date(previewParams.get("endDate")!).getTime() -
        new Date(previewParams.get("startDate")!).getTime()) /
        86_400_000,
    ).toBe(6);
    for (const [days, expectedRange] of [
      ["14", 13],
      ["30", 29],
    ]) {
      reportUrl = "";
      await selectProjectOption(
        page,
        "Период отчёта",
        `Последние ${days} дней`,
      );
      await expect.poll(() => reportUrl).not.toBe("");
      previewParams = new URL(reportUrl).searchParams;
      expect(
        (new Date(previewParams.get("endDate")!).getTime() -
          new Date(previewParams.get("startDate")!).getTime()) /
          86_400_000,
      ).toBe(expectedRange);
    }
    reportUrl = "";
    await selectProjectOption(page, "Период отчёта", "Последние 14 дней");
    await page.getByRole("button", { name: "Скачать отчёт" }).click();
    await expect.poll(() => reportUrl).not.toBe("");
    const reportParams = new URL(reportUrl).searchParams;
    expect(
      (new Date(reportParams.get("endDate")!).getTime() -
        new Date(reportParams.get("startDate")!).getTime()) /
        86_400_000,
    ).toBe(13);
    expect(new URL(reportUrl).pathname).toMatch(/performance\.docx$/);
    reportUrl = "";
    await selectProjectOption(page, "Формат отчёта", "PowerPoint (.pptx)");
    await page.getByRole("button", { name: "Скачать отчёт" }).click();
    await expect.poll(() => reportUrl).not.toBe("");
    expect(new URL(reportUrl).pathname).toMatch(/performance\.pptx$/);
    await page.screenshot({
      path: testInfo.outputPath("reports.png"),
      fullPage: true,
    });

    await page
      .getByRole("button", {
        name: new RegExp(`Открыть профиль.*${legacyEmail}`),
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Профиль", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Подключено платформ")).toBeVisible();
    const companyTeam = page.locator(".company-team");
    await expect(companyTeam).toContainText("Название компании не указано");
    await expect(companyTeam.getByText("OWNER", { exact: true })).toHaveCount(
      0,
    );
    const [inviteInput, inviteButton] = await Promise.all([
      companyTeam.locator(".invite-form input").boundingBox(),
      companyTeam.locator(".invite-form__submit").boundingBox(),
    ]);
    expect(inviteInput).not.toBeNull();
    expect(inviteButton).not.toBeNull();
    expect(inviteInput!.height).toBeGreaterThanOrEqual(44);
    expect(inviteButton!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({
      path: testInfo.outputPath("profile.png"),
      fullPage: true,
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("Claude onboarding is keyless, responsive and accessible in both themes", async ({
    page,
  }, testInfo) => {
    await installMockApi(page);
    const failures = collectClientFailures(page);
    await login(page);
    await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
    await page.getByRole("tab", { name: "Claude" }).click();

    const panel = page.getByRole("tabpanel");
    await expect(page.getByText("Ключ доступа не требуется")).toBeVisible();
    await expect(page.locator("form.token-form")).toHaveCount(0);
    await expect(panel).toContainText("File → Settings");
    await expect(panel).toContainText("Customize → Connectors");
    await expect(panel).toContainText("Always required");
    await expect(panel).toContainText(
      "No client ID — register one automatically",
    );
    await expect(
      panel.getByRole("button", { name: "Скопировать" }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Скопировать" }).focus();
    await expect(
      panel.getByRole("button", { name: "Скопировать" }),
    ).toBeFocused();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("claude-dark.png"),
      fullPage: true,
    });

    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.getByRole("radio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("claude-light.png"),
      fullPage: true,
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("ChatGPT onboarding is keyless, responsive and accessible in both themes", async ({
    page,
  }, testInfo) => {
    await installMockApi(page);
    const failures = collectClientFailures(page);
    await login(page);
    await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
    await page.getByRole("tab", { name: "ChatGPT" }).click();

    const panel = page.getByRole("tabpanel");
    await expect(page.getByText("Ключ доступа не требуется")).toBeVisible();
    await expect(page.locator("form.token-form")).toHaveCount(0);
    await expect(panel).toContainText("Настройки");
    await expect(panel).toContainText("Просмотреть плагины");
    await expect(panel).toContainText("Войти через HolyMedia MCP");
    await expect(panel).toContainText("Расширенные настройки OAuth");
    await expect(panel).toContainText("Покажи расходы за последние 7 дней.");
    await expect(
      panel.getByRole("button", { name: "Скопировать" }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Скопировать" }).focus();
    await expect(
      panel.getByRole("button", { name: "Скопировать" }),
    ).toBeFocused();

    const dimensions = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("chatgpt-dark.png"),
      fullPage: true,
    });

    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.getByRole("radio", { name: "Light" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("chatgpt-light.png"),
      fullPage: true,
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("reports picker keeps provider and account statuses customer-facing", async ({
    page,
  }, testInfo) => {
    await installMockApi(page);
    await page.route("**/api/v1/workspaces/**/connections", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "http://localhost:3000",
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify([
          {
            id: "10000000-0000-4000-8000-000000000001",
            provider: "META_ADS",
            displayName: "Meta connection",
            status: "CONNECTED",
            accounts: [
              {
                id: "10000000-0000-4000-8000-000000000011",
                externalAccountId: "meta-active",
                displayName: "Meta active account",
                enabled: true,
                status: "active",
              },
              {
                id: "10000000-0000-4000-8000-000000000012",
                externalAccountId: "meta-canceled",
                displayName: "Meta previous account",
                enabled: true,
                status: "canceled",
              },
              {
                id: "10000000-0000-4000-8000-000000000013",
                externalAccountId: "meta-unknown",
                displayName: "Meta review account",
                enabled: true,
                status: "provider_state_pending_review",
              },
            ],
          },
          {
            id: "10000000-0000-4000-8000-000000000002",
            provider: "GOOGLE_ADS",
            displayName: "Google connection",
            status: "CONNECTED",
            accounts: [],
          },
          {
            id: "10000000-0000-4000-8000-000000000003",
            provider: "YANDEX_DIRECT",
            displayName: "Yandex connection",
            status: "DISCONNECTED",
            accounts: [],
          },
          {
            id: "10000000-0000-4000-8000-000000000004",
            provider: "TIKTOK_ADS",
            displayName: "TikTok connection",
            status: "REAUTH_REQUIRED",
            accounts: [],
          },
        ]),
      }),
    );
    await login(page);
    await page.goto("/dashboard?section=reports");
    await page.locator(".report-account-trigger").click();
    const picker = page.getByRole("dialog", {
      name: "Выберите рекламную платформу",
    });
    await expect(picker).toBeVisible();
    for (const provider of [
      "Google Ads",
      "Meta Ads",
      "Яндекс Директ",
      "TikTok Ads",
    ]) {
      await expect(picker.getByText(provider, { exact: true })).toBeVisible();
    }
    await expect(picker.getByText("Подключено").first()).toHaveClass(
      /status-badge/,
    );
    await picker.screenshot({
      path: testInfo.outputPath("reports-platform-modal.png"),
    });

    await picker
      .locator(".report-provider-option")
      .filter({ hasText: "Meta Ads" })
      .getByRole("button", { name: "Показать кабинеты" })
      .click();
    const accounts = page.getByRole("dialog", { name: /Кабинеты Meta Ads/ });
    await expect(accounts.getByText("Активен", { exact: true })).toBeVisible();
    await expect(
      accounts.getByText("Не используется", { exact: true }),
    ).toBeVisible();
    await expect(
      accounts.getByText("Статус неизвестен", { exact: true }),
    ).toBeVisible();
    await expect(accounts.getByText("active", { exact: true })).toHaveCount(0);
    await expect(accounts.getByText("canceled", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      accounts.locator(".report-account-option.is-inactive"),
    ).toHaveCount(1);
    await accounts.screenshot({
      path: testInfo.outputPath("reports-account-modal.png"),
    });
    const overflow = await accounts.evaluate(
      (element) => element.scrollWidth > element.clientWidth,
    );
    expect(overflow).toBe(false);
  });

  test("reports explain an unsupported account instead of showing a generic error", async ({
    page,
  }) => {
    await installMockApi(page);
    await login(page);
    await page.goto("/dashboard?section=reports");
    await expect(
      page.getByRole("heading", { name: "Отчёт по рекламному кабинету" }),
    ).toBeVisible();
    await page.route("**/reports/performance?**", (route) =>
      route.fulfill({ status: 400, body: "unsupported account" }),
    );
    await page.locator(".report-account-trigger").click();
    await page.getByRole("button", { name: "Показать кабинеты" }).click();
    await page
      .getByRole("button", { name: /Основной рекламный кабинет/ })
      .first()
      .click();
    await expect(
      page.getByText(
        "Для отчёта выберите подключённый кабинет Meta Ads или Google Ads.",
      ),
    ).toBeVisible();
  });

  test("reports expose reauth and empty account states without a placeholder", async ({
    page,
  }) => {
    await installMockApi(page);
    await page.route("**/api/v1/workspaces/**/connections", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "http://localhost:3000",
          "access-control-allow-credentials": "true",
        },
        body: JSON.stringify([
          {
            id: "88888888-8888-4888-8888-888888888888",
            provider: "META_ADS",
            displayName: "Expired Meta",
            status: "REAUTH_REQUIRED",
            accounts: [],
          },
        ]),
      }),
    );
    await login(page);
    await page.goto("/dashboard?section=reports");
    await expect(
      page.getByText(
        "Meta Ads нужно переподключить, чтобы получить данные для отчёта.",
      ),
    ).toBeVisible();
    await expect(page.locator(".report-account-trigger")).toContainText(
      "Выберите кабинет",
    );
    await page.locator(".report-account-trigger").click();
    const reportPicker = page.getByRole("dialog", {
      name: "Выберите рекламную платформу",
    });
    await expect(
      reportPicker.getByRole("button", { name: "Переподключить" }),
    ).toBeVisible();
    await reportPicker.getByRole("button", { name: "Переподключить" }).click();
    await expect(
      page.getByRole("heading", { name: "Подключения" }),
    ).toBeVisible();
  });

  test("keeps the service-token lifecycle clear without re-exposing secrets", async ({
    page,
  }) => {
    await installMockApi(page);
    await login(page);
    await page.goto("/dashboard/ai-client");

    const tokenList = page.locator(".token-list");
    await expect(
      tokenList.getByText("Без названия", { exact: true }),
    ).toBeVisible();
    await expect(tokenList.getByText("Истёк", { exact: true })).toBeVisible();
    await expect(tokenList.getByText(/Создан/).first()).toBeVisible();
    await expect(tokenList.getByText(/Действует до/).first()).toBeVisible();

    const unnamedToken = tokenList
      .locator(".token-row")
      .filter({ hasText: "Без названия" });
    await unnamedToken.getByRole("button", { name: "Назвать" }).click();
    await tokenList
      .locator(".token-name-editor")
      .getByRole("textbox", { name: "Название ключа" })
      .fill("Codex");
    const renameResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PATCH" &&
        response.url().includes("/service-tokens/"),
    );
    await tokenList
      .locator(".token-name-editor")
      .getByRole("button", { name: "Сохранить" })
      .click();
    expect((await renameResponse).ok()).toBeTruthy();
    await expect(tokenList.getByText("Codex", { exact: true })).toBeVisible();

    const tokenForm = page.locator("form.token-form");
    await tokenForm.locator('input[name="name"]').fill("30-day client");
    await selectProjectOption(page, "Срок действия", "30 дней");
    await tokenForm.getByRole("button", { name: "Создать ключ" }).click();
    await expect(page.locator(".one-time-secret")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
    await expect(page.locator(".one-time-secret")).toHaveCount(0);
    const thirtyDayToken = page
      .locator(".token-row")
      .filter({ hasText: "30-day client" });
    await expect(
      thirtyDayToken.getByText("Активен", { exact: true }),
    ).toBeVisible();
    await expect(thirtyDayToken.getByText(/Действует до/)).toBeVisible();

    await tokenForm.locator('input[name="name"]').fill("90-day client");
    await selectProjectOption(page, "Срок действия", "90 дней");
    await tokenForm.getByRole("button", { name: "Создать ключ" }).click();
    await expect(page.locator(".one-time-secret")).toBeVisible();
    await page.getByRole("button", { name: "Скрыть" }).click();
    await page.reload();
    await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
    const ninetyDayToken = page
      .locator(".token-row")
      .filter({ hasText: "90-day client" });
    await expect(ninetyDayToken.getByText("Действует до")).toBeVisible();

    await thirtyDayToken.getByRole("button", { name: "Удалить ключ" }).click();
    await expect(page.getByRole("dialog")).toContainText("30-day client");
    await page.getByRole("button", { name: "Удалить ключ" }).last().click();
    await expect(thirtyDayToken).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
    await expect(
      page.locator(".token-row").filter({ hasText: "30-day client" }),
    ).toHaveCount(0);

    const codexToken = page.locator(".token-row").filter({ hasText: "Codex" });
    await codexToken.getByRole("button", { name: "Обновить" }).click();
    await expect(page.getByRole("dialog")).toContainText("Codex");
    await page.getByRole("button", { name: "Обновить" }).last().click();
    await expect(page.locator(".one-time-secret")).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "AI-клиент", exact: true }).click();
    await expect(page.locator(".one-time-secret")).toHaveCount(0);
    await expect(
      page
        .locator(".token-row")
        .filter({ hasText: "Codex" })
        .getByText("Активен", { exact: true }),
    ).toBeVisible();
  });

  test("localizes the customer-facing dashboard surfaces in English", async ({
    page,
  }, testInfo) => {
    await installMockApi(page);
    await login(page);
    await page.getByRole("button", { name: "English" }).click();

    await expect(
      page.getByRole("button", { name: "Connections", exact: true }),
    ).toBeVisible();

    await expect(
      page.getByText("Sign in through official OAuth."),
    ).toBeVisible();
    await expect(page.getByText("Add an AI client")).toBeVisible();

    await page
      .getByRole("button", { name: "Connections", exact: true })
      .click();
    await expect(
      page.getByText("Campaigns, spend, clicks, and conversions."),
    ).toBeVisible();
    await expect(
      page.getByText("Direct clients and advertising accounts."),
    ).toBeVisible();
    await expect(
      page.getByText("Available TikTok advertising accounts."),
    ).toBeVisible();

    await page.getByRole("button", { name: "AI client", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Copy the MCP URL" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Copy", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Create an access key" }),
    ).toBeVisible();
    expect(await page.locator(".mcp-setup").innerText()).not.toMatch(
      /[А-Яа-яЁё]/,
    );

    await page.getByRole("button", { name: "Reports", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Advertising account report" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Build report" }),
    ).toBeVisible();
    await expect(page.locator(".report-account-trigger")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("dashboard-en-reports.png"),
      fullPage: true,
    });
  });

  test("mobile navigation and connections do not overflow", async ({
    page,
  }, testInfo) => {
    test.skip(!testInfo.project.name.includes("mobile"), "mobile project only");
    await installMockApi(page);
    const failures = collectClientFailures(page);
    await login(page);
    await page
      .getByRole("button", { name: "Подключения", exact: true })
      .click();
    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      shell: document
        .querySelector("main.dashboard-shell")
        ?.getBoundingClientRect(),
      footer: document
        .querySelector("footer.footer--app")
        ?.getBoundingClientRect(),
      buttons: [...document.querySelectorAll("button")].map((button) => ({
        label: button.textContent?.trim(),
        width: button.getBoundingClientRect().width,
        height: button.getBoundingClientRect().height,
        themeControl: Boolean(button.closest(".theme-switcher")),
      })),
    }));
    expect(layout.document).toBeLessThanOrEqual(layout.viewport + 1);
    expect(layout.footer?.left).toBeCloseTo(layout.shell?.left ?? 0, 0);
    expect(layout.footer?.right).toBeCloseTo(layout.shell?.right ?? 0, 0);
    expect(
      layout.buttons.filter(
        (button) =>
          button.label &&
          button.width > 0 &&
          button.height > 0 &&
          button.height < 36 &&
          !button.themeControl &&
          !["EN", "RU"].includes(button.label),
      ),
    ).toEqual([]);
    await page.screenshot({
      path: testInfo.outputPath("mobile-connections.png"),
      fullPage: true,
    });
    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("keeps the temporarily disabled website audit fail-closed", async ({
    page,
  }) => {
    await installMockApi(page);
    const failures = collectClientFailures(page);
    await login(page);
    const navigationItem = page.getByRole("button", {
      name: /Анализ сайта/,
    });
    await expect(navigationItem).toBeDisabled();
    await expect(navigationItem.locator("small")).toHaveText("Скоро");

    await page.goto("/dashboard/analysis");
    await expect(
      page.getByRole("heading", { name: "Анализ сайта скоро вернётся" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Запустить аудит" }),
    ).toHaveCount(0);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

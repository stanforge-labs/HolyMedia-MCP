import { expect, test } from "@playwright/test";

const nonce = `hmap_${"a".repeat(43)}`;
const cors = {
  "access-control-allow-origin": "http://localhost:3000",
  "access-control-allow-credentials": "true",
  "access-control-allow-headers": "content-type,x-csrf-token",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

test("RU/EN approval keeps its nonce and only POST approves", async ({
  page,
}) => {
  const decisions: Array<{ approval_nonce: string; decision: string }> = [];
  const viewBodies: Array<{ approval_nonce: string }> = [];
  const navigationUrls: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest()) navigationUrls.push(request.url());
  });
  // The local production build has a production-only connect-src CSP; remove
  // it for this fully mocked browser test without changing app configuration.
  await page.route(
    /^http:\/\/localhost:3000\/(?:en\/)?mcp\/approve$/,
    async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["content-security-policy"];
      await route.fulfill({ response, headers });
    },
  );
  await page.route(
    /\/api\/v1\/mcp\/public\/approval(?:\/view)?$/,
    async (route) => {
      const request = route.request();
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: cors });
        return;
      }
      expect(request.method()).toBe("POST");
      expect(request.url()).not.toContain(nonce);
      if (new URL(request.url()).pathname.endsWith("/view")) {
        expect(request.headers()["x-csrf-token"]).toBe("test-csrf");
        viewBodies.push(request.postDataJSON() as { approval_nonce: string });
        await route.fulfill({
          status: 200,
          headers: cors,
          contentType: "application/json",
          body: JSON.stringify({
            provider: "Meta Ads",
            account: "Test account",
            campaign: "Summer campaign",
            operation: "META_CAMPAIGN_PAUSE",
            field: "status",
            before: "ACTIVE",
            after: "PAUSED",
            expires_at: "2030-01-01T00:00:00.000Z",
            approved: false,
          }),
        });
        return;
      }
      expect(request.headers()["x-csrf-token"]).toBe("test-csrf");
      decisions.push(
        request.postDataJSON() as { approval_nonce: string; decision: string },
      );
      await route.fulfill({
        status: 201,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify({ status: "approved" }),
      });
    },
  );
  await page.route("**/api/v1/auth/csrf", async (route) => {
    await route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "test-csrf" }),
    });
  });

  const firstResponse = await page.goto(`/mcp/approve#${nonce}`);
  expect(firstResponse?.headers()["referrer-policy"]).toBe("no-referrer");
  expect(firstResponse?.headers()["cache-control"]).toBe("no-store");
  expect(firstResponse?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(
    page.getByRole("heading", { name: "Подтверждение изменения" }),
  ).toBeVisible();
  await expect(page.getByText("Summer campaign")).toBeVisible();
  await expect(page.getByText("ACTIVE")).toBeVisible();
  await expect(page.getByText("PAUSED")).toBeVisible();
  await expect(page).toHaveURL("http://localhost:3000/mcp/approve");
  expect(navigationUrls.some((url) => url.includes(nonce))).toBe(false);
  expect(viewBodies).toEqual([{ approval_nonce: nonce }]);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBe(nonce);
  await expect(page.locator(".app-loader")).toHaveAttribute(
    "data-loader-visible",
    "false",
  );
  expect(decisions).toHaveLength(0);

  await page.getByRole("button", { name: "English" }).click();
  await expect(page).toHaveURL("http://localhost:3000/en/mcp/approve");
  const englishResponse = await page.request.get("/en/mcp/approve");
  expect(englishResponse.headers()["referrer-policy"]).toBe("no-referrer");
  expect(englishResponse.headers()["cache-control"]).toBe("no-store");
  expect(englishResponse.headers()["x-robots-tag"]).toContain("noindex");
  await expect(
    page.getByRole("heading", { name: "Approve a change" }),
  ).toBeVisible();
  await expect(page.getByText("Summer campaign")).toBeVisible();
  expect(viewBodies).toEqual([
    { approval_nonce: nonce },
    { approval_nonce: nonce },
  ]);
  expect(decisions).toHaveLength(0);

  await page.getByRole("button", { name: "Approve change" }).click();
  await expect(
    page.getByText("Change approved. Return to ChatGPT/Codex to execute it."),
  ).toBeVisible();
  expect(decisions).toEqual([{ approval_nonce: nonce, decision: "approve" }]);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBeNull();
  await expect(
    page.getByText("Approval here does not yet change the Meta Ads campaign."),
  ).toBeVisible();
});

test("login return URL is fixed and approval survives in the same tab", async ({
  page,
}) => {
  let signedIn = false;
  await page.route(/^http:\/\/localhost:3000\/mcp\/approve$/, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });
  await page.route(/^http:\/\/localhost:3000\/auth\?next=/, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });
  await page.route("**/api/v1/auth/csrf", (route) =>
    route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "test-csrf" }),
    }),
  );
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ status: 401, headers: cors }),
  );
  await page.route("**/api/v1/auth/login", async (route) => {
    signedIn = true;
    await route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ user: { id: "test-user" } }),
    });
  });
  await page.route("**/api/v1/mcp/public/approval/view", (route) =>
    route.fulfill({
      status: signedIn ? 200 : 401,
      headers: cors,
      contentType: "application/json",
      body: signedIn
        ? JSON.stringify({
            provider: "Meta Ads",
            account: "Test account",
            campaign: "After login",
            operation: "META_CAMPAIGN_PAUSE",
            field: "status",
            before: "ACTIVE",
            after: "PAUSED",
            expires_at: "2030-01-01T00:00:00.000Z",
            approved: false,
          })
        : "{}",
    }),
  );

  await page.goto(`/mcp/approve#${nonce}`);
  await expect(page).toHaveURL(/\/auth\?next=/);
  expect(page.url()).not.toContain(nonce);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/mcp/approve");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBe(nonce);
  await page.locator('input[name="email"]').fill("user@example.test");
  await page.locator('input[name="password"]').fill("test-password");
  await page.locator('form button[type="submit"]').click();
  await expect(page).toHaveURL("http://localhost:3000/mcp/approve");
  await expect(page.getByText("After login")).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBe(nonce);
});

test("approval context survives a same-tab cross-origin login round trip", async ({
  page,
}) => {
  await page.route(/^http:\/\/localhost:3000\/mcp\/approve$/, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });
  await page.route("**/api/v1/auth/csrf", (route) =>
    route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "test-csrf" }),
    }),
  );
  await page.route("**/api/v1/mcp/public/approval/view", (route) =>
    route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "Meta Ads",
        account: "Test account",
        campaign: "Cross-origin return",
        operation: "META_CAMPAIGN_PAUSE",
        field: "status",
        before: "ACTIVE",
        after: "PAUSED",
        expires_at: "2030-01-01T00:00:00.000Z",
        approved: false,
      }),
    }),
  );
  await page.route("http://localhost:4000/auth/google/start**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>External login handoff</title>",
    }),
  );
  await page.goto(`/mcp/approve#${nonce}`);
  await expect(page.getByText("Cross-origin return")).toBeVisible();
  await page.goto(
    "http://localhost:4000/auth/google/start?next=%2Fmcp%2Fapprove",
  );
  await expect(page).toHaveURL(/localhost:4000\/auth\/google\/start/);
  await page.goto("http://localhost:3000/mcp/approve");
  await expect(page).toHaveURL("http://localhost:3000/mcp/approve");
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBe(nonce);
  await expect(page.getByText("Cross-origin return")).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBe(nonce);
});

test("invalid preview clears per-tab nonce; cancellation also clears it", async ({
  page,
}) => {
  let valid = false;
  await page.route(/^http:\/\/localhost:3000\/mcp\/approve$/, async (route) => {
    const response = await route.fetch();
    const headers = { ...response.headers() };
    delete headers["content-security-policy"];
    await route.fulfill({ response, headers });
  });
  await page.route("**/api/v1/auth/csrf", (route) =>
    route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "test-csrf" }),
    }),
  );
  await page.route(/\/api\/v1\/mcp\/public\/approval(?:\/view)?$/, (route) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers: cors });
    if (new URL(route.request().url()).pathname.endsWith("/view"))
      return route.fulfill({
        status: valid ? 200 : 404,
        headers: cors,
        contentType: "application/json",
        body: valid
          ? JSON.stringify({
              provider: "Meta Ads",
              account: "Test account",
              campaign: "Cancel me",
              operation: "META_CAMPAIGN_PAUSE",
              field: "status",
              before: "ACTIVE",
              after: "PAUSED",
              expires_at: "2030-01-01T00:00:00.000Z",
              approved: false,
            })
          : "{}",
      });
    return route.fulfill({
      status: 201,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ status: "cancelled" }),
    });
  });
  await page.goto(`/mcp/approve#${nonce}`);
  await expect(
    page.getByText("Ссылка недействительна", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBeNull();
  valid = true;
  await page.goto("/");
  await page.goto(`/mcp/approve#${nonce}`);
  await expect(page.getByText("Test account", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Отмена" }).click();
  await expect(
    page.getByText("Изменение отменено.", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBeNull();
});

test("two approval tabs keep separate sessionStorage contexts", async ({
  context,
}) => {
  const first = await context.newPage();
  const second = await context.newPage();
  const otherNonce = `hmap_${"b".repeat(43)}`;
  for (const page of [first, second]) {
    await page.route(
      /^http:\/\/localhost:3000\/mcp\/approve$/,
      async (route) => {
        const response = await route.fetch();
        const headers = { ...response.headers() };
        delete headers["content-security-policy"];
        await route.fulfill({ response, headers });
      },
    );
    await page.route("**/api/v1/auth/csrf", (route) =>
      route.fulfill({
        status: 200,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify({ csrfToken: "test-csrf" }),
      }),
    );
    await page.route("**/api/v1/mcp/public/approval/view", (route) =>
      route.fulfill({
        status: 200,
        headers: cors,
        contentType: "application/json",
        body: JSON.stringify({
          provider: "Meta Ads",
          account: "Test account",
          campaign: "Separate tab",
          operation: "META_CAMPAIGN_PAUSE",
          field: "status",
          before: "ACTIVE",
          after: "PAUSED",
          expires_at: "2030-01-01T00:00:00.000Z",
          approved: false,
        }),
      }),
    );
  }
  await first.goto(`/mcp/approve#${nonce}`);
  await second.goto(`/mcp/approve#${otherNonce}`);
  await expect(first.getByText("Separate tab")).toBeVisible();
  await expect(second.getByText("Separate tab")).toBeVisible();
  expect(
    await first.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBe(nonce);
  expect(
    await second.evaluate(() =>
      sessionStorage.getItem("holymedia:mcp:approval-nonce"),
    ),
  ).toBe(otherNonce);
  await first.close();
  await second.close();
});

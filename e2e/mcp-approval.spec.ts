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
  const decisions: Array<{ approval: string; decision: string }> = [];
  // The local production build has a production-only connect-src CSP; remove
  // it for this fully mocked browser test without changing app configuration.
  await page.route(
    /^http:\/\/localhost:3000\/(?:en\/)?mcp\/approve\?/,
    async (route) => {
      const response = await route.fetch();
      const headers = { ...response.headers() };
      delete headers["content-security-policy"];
      await route.fulfill({ response, headers });
    },
  );
  await page.route("**/api/v1/mcp/public/approval**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cors });
      return;
    }
    if (request.method() === "GET") {
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
      request.postDataJSON() as { approval: string; decision: string },
    );
    await route.fulfill({
      status: 201,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ status: "approved" }),
    });
  });
  await page.route("**/api/v1/auth/csrf", async (route) => {
    await route.fulfill({
      status: 200,
      headers: cors,
      contentType: "application/json",
      body: JSON.stringify({ csrfToken: "test-csrf" }),
    });
  });

  await page.goto(`/mcp/approve?approval=${nonce}`);
  await expect(
    page.getByRole("heading", { name: "Подтверждение изменения" }),
  ).toBeVisible();
  await expect(page.getByText("Summer campaign")).toBeVisible();
  await expect(page.getByText("ACTIVE")).toBeVisible();
  await expect(page.getByText("PAUSED")).toBeVisible();
  await expect(page.locator(".app-loader")).toHaveAttribute(
    "data-loader-visible",
    "false",
  );
  expect(decisions).toHaveLength(0);

  await page.getByRole("button", { name: "English" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/en/mcp/approve\\?approval=${nonce}$`),
  );
  await expect(
    page.getByRole("heading", { name: "Approve a change" }),
  ).toBeVisible();
  expect(decisions).toHaveLength(0);

  await page.getByRole("button", { name: "Approve change" }).click();
  await expect(
    page.getByText("Change approved. Return to ChatGPT/Codex to execute it."),
  ).toBeVisible();
  expect(decisions).toEqual([{ approval: nonce, decision: "approve" }]);
  await expect(
    page.getByText("Approval here does not yet change the Meta Ads campaign."),
  ).toBeVisible();
});

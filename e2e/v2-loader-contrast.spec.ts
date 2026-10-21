import { expect, test } from "@playwright/test";

function luminance(color: string): number {
  const channels = color
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number);
  if (!channels || channels.length !== 3)
    throw new Error(`Unexpected computed color: ${color}`);
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722;
}

function contrast(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test.describe("HolyPilot loader contrast", () => {
  for (const locale of ["ru", "en"] as const) {
    for (const theme of ["dark", "light"] as const) {
      test(`${locale} ${theme} tagline stays readable during entrance`, async ({
        page,
      }) => {
        await page.addInitScript((selectedTheme) => {
          localStorage.setItem("holymedia-theme", selectedTheme);
        }, theme);
        await page.goto(locale === "ru" ? "/auth" : "/en/auth");
        const loader = page.locator('.app-loader[data-loader-visible="true"]');
        await expect(loader).toBeVisible();
        const tagline = loader.locator(".app-loader__tagline");
        await expect(tagline).toHaveText(
          locale === "ru"
            ? "Ваш персональный AI-маркетолог"
            : "Your personal AI marketer",
        );
        const styles = await tagline.evaluate((element) => {
          const loaderElement = element.closest(".app-loader")!;
          const identity = element.closest(".app-loader__identity")!;
          return {
            color: getComputedStyle(element).color,
            background: getComputedStyle(loaderElement).backgroundColor,
            identityOpacity: getComputedStyle(identity).opacity,
          };
        });
        expect(styles.identityOpacity).toBe("1");
        expect(
          contrast(styles.color, styles.background),
        ).toBeGreaterThanOrEqual(5);
      });
    }
  }
});

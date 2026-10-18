/** Website SIGNUP conversion. This module is inert unless explicitly configured. */
export type SignupConversionConfig = {
  conversionId: string;
  label: string;
};

export function signupConversionConfig(values: {
  enabled?: string | undefined;
  conversionId?: string | undefined;
  label?: string | undefined;
  restrictedTestAuth?: string | undefined;
}): SignupConversionConfig | null {
  if (values.enabled !== "true" || values.restrictedTestAuth === "true")
    return null;
  const conversionId = values.conversionId?.trim() ?? "";
  const label = values.label?.trim() ?? "";
  if (!/^AW-[1-9][0-9]{5,19}$/.test(conversionId)) return null;
  if (!/^[A-Za-z0-9_-]{3,100}$/.test(label)) return null;
  return { conversionId, label };
}

type GoogleTagWindow = Window & {
  dataLayer?: unknown[][];
  gtag?: (...args: unknown[]) => void;
};

/**
 * Only called after a successful signup response and an unchecked-by-default
 * measurement choice. The local marker is written before network activity:
 * failure may lose a measurement, but can never turn a retry into two sends.
 */
export async function measureSuccessfulSignup(
  config: SignupConversionConfig | null,
  consent: boolean,
  userId: string | undefined,
  workspaceId: string | undefined,
  browser: Window = window,
): Promise<
  | "disabled"
  | "no-consent"
  | "invalid-success"
  | "duplicate"
  | "queued"
  | "failed"
> {
  if (
    !config ||
    !signupConversionConfig({
      enabled: "true",
      conversionId: config.conversionId,
      label: config.label,
    })
  )
    return "disabled";
  if (!consent) return "no-consent";
  if (!userId || !workspaceId) return "invalid-success";
  const marker = `holypilot:signup-conversion:v1:${config.conversionId}:${userId}`;
  try {
    if (browser.localStorage.getItem(marker)) return "duplicate";
    browser.localStorage.setItem(marker, "1");
  } catch {
    return "failed"; // No durable deduplication, so fail closed.
  }

  try {
    const tagWindow = browser as GoogleTagWindow;
    tagWindow.dataLayer ??= [];
    tagWindow.gtag ??= (...args: unknown[]) => {
      tagWindow.dataLayer?.push(args);
    };
    const gtag = tagWindow.gtag;
    gtag("consent", "default", {
      ad_storage: "denied",
      analytics_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
    });
    gtag("consent", "update", { ad_storage: "granted" });
    gtag("set", "allow_ad_personalization_signals", false);
    gtag("js", new Date());
    const cleanLocation = `${browser.location.origin}${browser.location.pathname}`;
    gtag("config", config.conversionId, {
      send_page_view: false,
      page_location: cleanLocation,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = browser.document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${config.conversionId}`;
    const loaded = new Promise<boolean>((resolve) => {
      const timer = browser.setTimeout(() => resolve(false), 1500);
      script.onload = () => {
        browser.clearTimeout(timer);
        resolve(true);
      };
      script.onerror = () => {
        browser.clearTimeout(timer);
        resolve(false);
      };
    });
    browser.document.head.appendChild(script);
    if (!(await loaded)) return "failed";
    await new Promise<void>((resolve) => {
      const timer = browser.setTimeout(resolve, 1200);
      gtag("event", "conversion", {
        send_to: `${config.conversionId}/${config.label}`,
        page_location: cleanLocation,
        event_timeout: 1200,
        event_callback: () => {
          browser.clearTimeout(timer);
          resolve();
        },
      });
    });
    return "queued"; // The browser/Google, not this app, confirms delivery.
  } catch {
    return "failed";
  }
}

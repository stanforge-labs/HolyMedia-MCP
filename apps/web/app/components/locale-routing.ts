export type Locale = "ru" | "en";

/** Frontend pages only. Never prefix API, provider callbacks or download URLs. */
export const FRONTEND_ROUTES = [
  "/",
  "/privacy",
  "/terms",
  "/auth",
  "/auth/reset",
  "/invitations/accept",
  "/onboarding",
  "/connect/claude",
  "/app",
  "/dashboard",
  "/dashboard/overview",
  "/dashboard/connections",
  "/dashboard/ai-client",
  "/dashboard/reports",
  "/dashboard/tariffs",
  "/dashboard/profile",
  "/dashboard/analysis",
  "/admin",
] as const;

export function localeFromPath(path: string): Locale {
  return path === "/en" || path.startsWith("/en/") ? "en" : "ru";
}

export function withoutLocale(path: string): string {
  return localeFromPath(path) === "en" ? path.slice(3) || "/" : path;
}

export function localizedHref(href: string, locale: Locale): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const split = href.search(/[?#]/);
  const path = split < 0 ? href : href.slice(0, split);
  const suffix = split < 0 ? "" : href.slice(split);
  const base = withoutLocale(path);
  if (!(FRONTEND_ROUTES as readonly string[]).includes(base)) return href;
  return (locale === "en" ? `/en${base === "/" ? "" : base}` : base) + suffix;
}

/** Only UI state crosses a language switch. OAuth protocol parameters never do. */
export function languageSwitchHref(href: string, locale: Locale): string {
  const url = new URL(href, "https://locale.invalid");
  const safe = new URLSearchParams();
  for (const key of [
    "mode",
    "period",
    "since",
    "until",
    "section",
    "q",
    "page",
    "status",
  ]) {
    for (const value of url.searchParams.getAll(key)) safe.append(key, value);
  }
  const next = url.searchParams.get("next");
  // These two frontend forms already receive a HolyMedia one-time code in
  // their URL. Preserve it only on the same form, never on provider callbacks.
  if (
    ["/auth/reset", "/invitations/accept"].includes(withoutLocale(url.pathname))
  ) {
    const token = url.searchParams.get("token");
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) safe.set("token", token);
  }
  // HolyMedia UI continuation IDs are not provider OAuth state/code. Keep only
  // validated internal UUIDs so switching the consent/login UI cannot lose it.
  for (const key of ["oauth_transaction", "transaction"]) {
    const value = url.searchParams.get(key);
    if (
      value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      safe.set(key, value);
  }
  if (
    next?.startsWith("/") &&
    !next.startsWith("//") &&
    !/[\\\r\n]/.test(next)
  ) {
    const nested = new URL(next, "https://locale.invalid");
    if (
      (FRONTEND_ROUTES as readonly string[]).includes(
        withoutLocale(nested.pathname),
      )
    )
      safe.set("next", languageSwitchHref(next, locale));
  }
  const query = safe.toString();
  return (
    localizedHref(url.pathname, locale) + (query ? `?${query}` : "") + url.hash
  );
}

export function currentLocaleHref(href: string): string {
  return localizedHref(
    href,
    typeof window === "undefined"
      ? "ru"
      : localeFromPath(window.location.pathname),
  );
}

import { NextResponse, type NextRequest } from "next/server";
import {
  FRONTEND_ROUTES,
  languageSwitchHref,
  localeFromPath,
  withoutLocale,
} from "./app/components/locale-routing";

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (!(FRONTEND_ROUTES as readonly string[]).includes(withoutLocale(path)))
    return NextResponse.next();
  const legacy = request.nextUrl.searchParams.get("lang");
  if (
    ["/", "/privacy", "/terms"].includes(withoutLocale(path)) &&
    (legacy === "en" || legacy === "ru")
  ) {
    return NextResponse.redirect(
      new URL(
        languageSwitchHref(path + request.nextUrl.search, legacy),
        request.url,
      ),
      308,
    );
  }
  const headers = new Headers(request.headers);
  headers.set("x-holymedia-page-locale", localeFromPath(path));
  return NextResponse.next({ request: { headers } });
}

// Explicit frontend matcher, not a catch-all rewrite. Technical routes are untouched.
export const config = {
  matcher: [
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
    "/dashboard/:section",
    "/admin",
    "/en",
    "/en/privacy",
    "/en/terms",
    "/en/auth",
    "/en/auth/reset",
    "/en/invitations/accept",
    "/en/onboarding",
    "/en/connect/claude",
    "/en/app",
    "/en/dashboard",
    "/en/dashboard/:section",
    "/en/admin",
  ],
};

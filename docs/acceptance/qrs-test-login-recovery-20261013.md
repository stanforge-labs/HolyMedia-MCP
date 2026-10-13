# Q/R/S TEST login recovery — 2026-10-13

Status: **CODE PREPARED / LIVE LOGIN BLOCKED**. This file contains no account emails or secrets. Production and main were not changed.

## Verified cause

- TEST PostgreSQL has one active user with a password and one active OWNER membership in the active workspace holding the enabled Google Ads TEST account `8590146099`. Production users are not copied into this separate database. The existing TEST password was not compared with any production password.
- The TEST edge returns HTTP 200 for CSRF, HTTP 401 for anonymous session, and HTTP 401 for a deliberately invalid login with a valid CSRF token. The login route, CSRF check and host-only Secure/SameSite=Lax cookie path work for this negative case. The audit contains login failures; no real owner login was attempted by this investigation.
- Google Login was absent: no TEST Google Login OAuth client configuration, the TEST Web image was built with the button disabled, and the exact `/auth/google/start` and `/auth/google/callback` routes were not exposed by the TEST vhost.
- Signup and password-recovery controls were visible although their API paths returned 404. A successful ordinary login would navigate to `/dashboard`, which the restricted TEST edge also returns as 404.
- Before this change, an unknown Google email would create a user, workspace and OWNER membership. Enabling Google Login without changing this behavior would be unsafe.

## Prepared TEST-only code and edge diff

- `QRS_TEST_RESTRICTED_AUTH=true` defaults to false elsewhere. It refuses signup and permits login only for an existing active OWNER in an active workspace with enabled Google Ads account `8590146099`, with the canonical TEST origin and exact one-account allowlist. Unknown Google identities cannot create users or OWNER memberships.
- Google UserInfo now requires `email_verified === true`. The Google authorization state remains one-time, browser-cookie-bound and time-limited; the TEST session remains separate from production. No Google Ads OAuth credential is reused for identity login.
- TEST Web hides signup/recovery, explains separate TEST credentials, resumes an existing OAuth transaction after login, and otherwise stays on an available TEST page. Known Google-login denial returns a safe generic message without exposing account identity.
- The additive TEST vhost template exposes only the exact Google start/callback routes; broad `/api` remains closed. The TEST Web CI image enables the login UI and restricted mode; the TEST Compose config pins the exact HTTPS callback and server-side restricted mode.
- No running TEST image or vhost was changed by this code preparation.

## One approval package required before live activation

1. Create one **separate Google OAuth 2.0 Web application client for TEST identity login** in the authorized Google Cloud project. Authorized redirect URI must be exactly `https://mcp-test.holymedia.kz/auth/google/callback`; origin `https://mcp-test.holymedia.kz`; requested scopes `openid email profile`. Do not use the Google Ads OAuth client. Store client ID/secret only in the protected disposable TEST vault; do not send them through chat or Git. The verified Google email must match the already-authorized TEST OWNER email; if not, stop and request an explicit identity-binding decision. No public signup or automatic OWNER creation.
2. After checking production health, TEST resource headroom, pending approvals and a rollback point, build immutable TEST API/Web images from this branch and replace only TEST API/Web. Set `PROVIDER_GOOGLE_LOGIN_CLIENT_ID`, `PROVIDER_GOOGLE_LOGIN_CLIENT_SECRET` in the protected TEST vault and `PROVIDER_GOOGLE_LOGIN_REDIRECT_URI` to the exact callback. Keep the write allowlist to `8590146099` and all production/Public write gates OFF.
3. Add exactly two locations to the existing TEST vhost (`/auth/google/start`, `/auth/google/callback`), run `nginx -t`, reload once and immediately compare production `/health` and `/ready` with pre-change results. Do not edit the production vhost.
4. In a real browser, have the already-authorized owner complete Google login, HolyMedia OAuth consent and each native client callback. Verify TEST session, `tools/list`, TEST READ, and audit. Q/R/S remain pending until actual ChatGPT and Claude invocations and separately approved writes/restoration where required.

If the authorized Google account does not match the existing TEST OWNER, use only a separately approved restricted TEST onboarding or password reset. The owner enters any TEST password locally; never copy a production password or credential.

## Verification and rollback

Local: TEST edge contract 3/3, restricted-login and Google-login tests 13/13, full API suite 1439 passed / 21 skipped, API/Web typecheck, Web build, lint, Prisma validate and standard secret scan pass. The skipped tests are not represented as PASS. This is **not** a live browser/OAuth/client PASS. After activation verify the Google callback route, state/cookie, owner restriction, OAuth transaction continuation, and a negative unknown-email test without account creation. On failure, restore the prior pinned TEST API/Web digests and prior TEST vhost, keep the isolated TEST DB/Redis/vault and historical audit intact, and check production health again. No Google Ads mutation is authorized by this package.

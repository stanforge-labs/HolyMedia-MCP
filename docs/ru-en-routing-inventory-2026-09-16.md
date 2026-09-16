# HolyMedia RU/EN frontend routes

Inventory source: recursively enumerated `apps/web/app/**/page.tsx` before implementation, plus `components/dashboard-routes.ts` and the admin section registry. No API routes inferred as pages. RU is the default; URL is authoritative, not storage, cookies or Accept-Language.

| Page                        | RU URL                 | EN URL                    | Public/private                          | Login                  | Workspace               | Admin | Indexable |
| --------------------------- | ---------------------- | ------------------------- | --------------------------------------- | ---------------------- | ----------------------- | ----- | --------- |
| Home                        | /                      | /en                       | Public                                  | No                     | No                      | No    | Yes       |
| Privacy                     | /privacy               | /en/privacy               | Public                                  | No                     | No                      | No    | Yes       |
| Terms                       | /terms                 | /en/terms                 | Public                                  | No                     | No                      | No    | Yes       |
| Sign in                     | /auth                  | /en/auth                  | Public                                  | No                     | No                      | No    | No        |
| Registration mode           | /auth?mode=signup      | /en/auth?mode=signup      | Public                                  | No                     | No                      | No    | No        |
| Password recovery mode      | /auth?mode=forgot      | /en/auth?mode=forgot      | Public                                  | No                     | No                      | No    | No        |
| Password reset              | /auth/reset            | /en/auth/reset            | Public one-time-code form               | No                     | No                      | No    | No        |
| Invitation                  | /invitations/accept    | /en/invitations/accept    | Public form; protected accept API       | For acceptance         | Invitation-bound        | No    | No        |
| Company onboarding          | /onboarding            | /en/onboarding            | Private                                 | Yes                    | Pending owner workspace | No    | No        |
| Overview                    | /dashboard             | /en/dashboard             | Private                                 | Yes                    | Yes                     | No    | No        |
| Overview alias              | /dashboard/overview    | /en/dashboard/overview    | Private                                 | Yes                    | Yes                     | No    | No        |
| Connections                 | /dashboard/connections | /en/dashboard/connections | Private                                 | Yes                    | Yes                     | No    | No        |
| AI client                   | /dashboard/ai-client   | /en/dashboard/ai-client   | Private                                 | Yes                    | Yes                     | No    | No        |
| Reports                     | /dashboard/reports     | /en/dashboard/reports     | Private                                 | Yes                    | Yes                     | No    | No        |
| Plans                       | /dashboard/tariffs     | /en/dashboard/tariffs     | Private                                 | Yes                    | Yes                     | No    | No        |
| Profile / company / team    | /dashboard/profile     | /en/dashboard/profile     | Private                                 | Yes                    | Yes                     | No    | No        |
| Website analysis (disabled) | /dashboard/analysis    | /en/dashboard/analysis    | Private                                 | Yes                    | Yes                     | No    | No        |
| Legacy app redirect         | /app                   | /en/app                   | Redirect to private dashboard           | At destination         | At destination          | No    | No        |
| AI consent UI               | /connect/claude        | /en/connect/claude        | Protected transaction UI                | For consent            | Authorized choice       | No    | No        |
| Admin / admin login         | /admin                 | /en/admin                 | Private data; public admin sign-in form | Separate admin session | No                      | Yes   | No        |

Admin has one real page, not `/admin/users`, `/admin/companies` etc. Its existing sections are overview, companies, users, diagnostics, support, tariff-requests, audit. The same page and API guards are reused; `?section=` preserves the current existing tab on refresh/language switch. There are no separate `/login`, `/register`, `/forgot-password`, `/reset-password`, `/dashboard/seo`, `/dashboard/site-audit`, or `/admin/tariffs` pages. No speculative routes added. The pre-existing dynamic dashboard fallback for unknown slugs is not a separately supported page.

## Architecture / boundaries

- Explicit EN wrappers re-export existing pages/layouts, not business logic copies.
- Frontend-only proxy matcher passes a derived locale header for server HTML/metadata. No catch-all rewrite, authentication or provider callback handling in proxy.
- Shared locale helper prefixes only inventoried frontend URLs. Technical routes, absolute provider URLs, API fetches and downloads remain unchanged.
- URL-based `useLanguage` replaces the storage-derived locale. Existing component dictionaries and legacy UI translation dictionary are reused. Legal policy is an owner-provided RU/EN content object; Terms wording is unchanged.
- Language switching preserves allowlisted UI query fields and fragment, and a safe local return route. OAuth codes/state/PKCE/provider query parameters are not copied.
- Public SEO: self canonical, ru/en/x-default hreflang, only home/privacy/terms in sitemap (six URLs). Private/auth/admin/consent routes are noindex in both languages.
- Dashboard section is pathname-derived; locale does not change backend permissions or product-disable enforcement.
- Provider OAuth URLs/callbacks and the existing provider-return processing branch are unchanged. No provider API calls are part of this work.

## Policy review scope

Owner-supplied September 16, 2026 text replaces the policy verbatim, with 14 sections and Ads/GA4/GSC subsections. Includes Google Limited Use, AI client transfers, storage, retention, revocation and deletion contacts. No direct contradiction identified with existing Terms concerning authorization, AI client responsibility or confirmed actions. This is implementation of supplied text, not a legal-compliance certification or automatic Google submission.

Google Cloud Privacy URL remains `https://mcp.holymedia.kz/privacy`; English supporting URL is `https://mcp.holymedia.kz/en/privacy`. Google Cloud configuration is not changed.

## Verification

Local checks: repository lint/typecheck/build/secret scan and unit suites passed (API: 275 passed, 20 integration tests skipped without local DB). Production-build Playwright routing/accessibility/session/TikTok matrix: 66 passed, 2 real-DB browser tests deferred to isolated CI. Desktop/mobile and Light/Dark privacy screenshots inspected; no horizontal overflow. RU/EN policy content was mechanically compared against the owner's attachment and matched exactly.

Only the frontend return-path allowlist in Google Login accepts `/en/dashboard/...` in addition to existing RU paths; OAuth redirect URI construction, scopes, state lifecycle, exchange and provider callbacks are untouched. Internal HolyMedia consent transaction UUIDs survive language switch; raw provider code/state/PKCE never do.

Browser fixtures are local, isolated and do not perform provider requests. Meta modules, provider config, callbacks, policies, DB data and connection handlers are unchanged; no Meta Graph smoke is authorized. Immutable production receipt is reported separately after deployment, not inferred from local checks.

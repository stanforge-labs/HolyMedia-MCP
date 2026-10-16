# HolyPilot: static public landing via the existing Nginx

Status: **review candidate; production unchanged**. This route does not start another Next.js process or replace the running production Web image. Nginx publication requires the owner's separate explicit approval.

## Scope and source

- Source branch: `codex/holypilot-production-web`. The static site and its verification scripts are in `infra/production-static-landing/`.
- The round symbol in `site/symbol.svg` is byte-for-byte identical to the committed `apps/web/public/assets/brand/holy-pilot-symbol.svg` (Git blob SHA-256 `6001ff52f6ea2e1044c31a86bb3991c1e1783d0e9a6a14e940d5bea917b8c63e`). The icon, 256 × 256 first-party Open Graph PNG, and Cyrillic Manrope font are copied from the existing Web source. No logo redraw or external image/script/font request is used.
- RU and EN pages are independent HTML/CSS with no JavaScript or React hydration. They retain the current dark palette, typography, brand lockup, hero/chat composition, steps, capabilities, confirmation explanation and footer. The chat panel labels its content as an illustration and contains no fabricated performance numbers. All sign-in, sign-up, support, Privacy and Terms links point to existing live routes.
- [RU desktop preview](../../infra/production-static-landing/preview/ru-desktop.png), [RU mobile preview](../../infra/production-static-landing/preview/ru-mobile.png), [EN desktop preview](../../infra/production-static-landing/preview/en-desktop.png), [EN mobile preview](../../infra/production-static-landing/preview/en-mobile.png).

## Read-only production findings

The active HTTPS server is `/etc/nginx/sites-enabled/adforge-mcp`, SHA-256 `c711bb0b6f85390afa8482ed58611371c3648690a55f09f421254475e8fd1b91`, `root:root 0644`. It serves both `mcp.holymedia.kz` and the legacy `77.240.38.131.sslip.io` alias. Exact and prefix locations already route auth, OAuth, MCP, API, `.well-known`, health, Web assets and the generic Web fallback. There is no public-home-specific location. `/` and `/en` return 200 from Web; `/en/` redirects 308 to `/en`. Nginx 1.18.0 `-t` passed on the active configuration.

The current Nginx master and two workers total approximately **9.8 MiB PSS** (read-only `/proc/*/smaps_rollup`); RSS totals approximately 28 MiB with shared pages counted repeatedly. A reload will temporarily overlap old and new workers. The additional memory is expected to be closer to one worker generation than a Next.js restart, but has **not** been measured on this VPS. At inspection, MemAvailable was 986,948 KiB and disk free 11,197 MiB. A fresh full resource guard is still mandatory before and after any reload.

## Exact proposed change

1. Create the root-owned release directory `/srv/holypilot-landing/2026-10-16-static-v1/` containing only `index.html`, `en.html`, `landing.css`, `symbol.svg`, `icon.svg`, `og.png`, and `manrope-cyrillic.woff2` (62,108 bytes total). `MANIFEST.sha256` fixes the contents.
2. Create `/etc/nginx/snippets/holypilot-landing.conf` from the reviewed snippet. It defines exact locations for `/`, `/en` and the five `/_holypilot/*` static assets. Its two HTML locations set a restrictive CSP, no-store, nosniff, DENY framing, no-referrer, same-origin resource policy and existing permission restrictions. Asset locations inherit the existing server security headers.
3. In `/etc/nginx/sites-enabled/adforge-mcp`, insert exactly one line before the existing `location / {`:

   ```nginx
   include /etc/nginx/snippets/holypilot-landing.conf;
   ```

   `scripts/build-production-config.mjs` refuses any live config whose SHA differs from the recorded baseline and generates a candidate with **only this insertion**. Generated candidate SHA-256: `e435a5b323de9eb96dc7c4c65eac9628351dd4f13951f8bf09a0a8efdf5d0d75`. The exact local diff was verified. No Docker Compose, Web container, API, Worker, DB, OAuth, TEST, system setting or main-branch file is part of the change.

Because the existing HTTPS server block also names `77.240.38.131.sslip.io`, its `/` and `/en` would show the same static pages. Other paths on that alias also retain their existing routing.

## Routing and security boundary

| URL                                                                                                                        | Candidate behavior                                                    |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `/`, `/en`                                                                                                                 | Static RU/EN HTML                                                     |
| `/_holypilot/landing.css`, `symbol.svg`, `icon.svg`, `og.png`, `manrope-cyrillic.woff2`                                    | Exact local static assets                                             |
| `/en/`                                                                                                                     | Existing Web redirect to `/en`, then static English page              |
| `/auth`, `/en/auth`, `/dashboard`, `/mcp/approve`, `/api`, `/oauth`, `/.well-known`, callbacks, cookies, sessions and CSRF | Existing Nginx locations and Web/API behavior; no static interception |
| All other public and protected routes                                                                                      | Existing `location /` Web fallback or more specific existing location |

Read-only GET checks on the live site returned 200 for RU/EN auth and approval, dashboard, Privacy, Terms, Support, `.well-known/oauth-authorization-server` and `/ready`. The static browser test requires the preview fallback to retain these route paths; the isolated Nginx test requires all protected paths to fall through to its unchanged dummy fallback. No authenticated session, mutation or OAuth transaction was started for this release candidate.

## Verification and deployment gate

- `node infra/production-static-landing/scripts/verify-static.mjs`: package hashes, official symbol hash, RU/EN metadata, links, exact Nginx route scope, no script or external CSS, no fabricated metrics — **PASS**.
- `node infra/production-static-landing/scripts/verify-browser.mjs`: Chromium at 1440, 390 and 320 px for RU/EN; rendered symbol, no horizontal overflow, no failed requests, language navigation and protected fallback — **PASS**. Axe reported no accessibility violations on both desktop pages.
- Active production Nginx syntax test — **PASS**. The isolated Linux CI job additionally tests the proposed snippet's syntax, exact static routes, MIME, CSP/security headers and protected fallback. Its result must be recorded before approval.
- Existing site legality/login routes — **PASS** as read-only GETs. Production behavior after an actual Nginx reload is **not yet verified**.
- `scripts/publish-once.sh` is prepared but **must not run before approval**. It checks the exact manifest and config hashes, preserves a root-only copy of the old config, runs a 600-second RAM/swap/PSI/OOM/disk/health preflight with existing floors, atomically installs the one-line config candidate, checks `nginx -t`, reloads (not restarts) Nginx, checks public and protected routes/container IDs, and runs the same 600-second post-reload guard. It rejects >64 swap-out pages total or >32 in any 60 seconds and immediately rolls back on failure. These are preparation details, not a claim of runtime PASS.

## One-operation rollback

`scripts/rollback-nginx.sh <protected-backup-dir>` verifies the original config checksum, atomically restores `/etc/nginx/sites-enabled/adforge-mcp`, tests syntax and reloads Nginx. The existing running Web again serves `/` and `/en`. The static files can remain unused for audit; no image rollback or Docker restart is required. Publication automation invokes this once on failure and stops without retrying.

**Approval point:** after Linux CI PASS and review of the four screenshots, the owner must explicitly approve this single production Nginx include/reload. Earlier Web-only deployment approval does not cover this change. No production file or live route has been changed for this candidate.

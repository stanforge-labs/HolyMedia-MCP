# Separate local Google Ads TEST profile

This profile is separate from `infra/local-test`: distinct Compose project, PostgreSQL/Redis volumes, localhost ports, API/Web builds and credential vault. It is restricted to Google Ads TEST customer `8590146099`. On 2026-10-19 the owner approved copying the existing TEST database and TEST-only keys from the VPS to root-only WSL storage. The four-service localhost stack now contains that TEST snapshot and passes HTTP smoke. It has **not** completed local Google OAuth or made a Google provider request. No production account, key, database or public ingress is reused. The checked-in `provider.env.example` is intentionally invalid; the API cannot start with it. See [`docs/operations/HOLYPILOT_TEST_TO_WSL_MIGRATION_20261019.md`](../../docs/operations/HOLYPILOT_TEST_TO_WSL_MIGRATION_20261019.md).

## Current safety contract

- Web `127.0.0.1:23300`, API `127.0.0.1:24404`, PostgreSQL `127.0.0.1:25432`, Redis `127.0.0.1:26379`. All services and volumes have names distinct from the disposable stack.
- Google callback is `http://127.0.0.1:24404/oauth/google/callback`; the API redirects back to the configured Web origin after completion. Google supports localhost HTTP redirects for web server applications and desktop loopback flows, but the current HolyPilot provider is a **server-side Web OAuth flow** with a client secret and encrypted refresh-token vault. A standalone desktop token flow would be a separate design, not an automatic substitute.
- `https://www.googleapis.com/auth/adwords` is the provider scope. Google Cloud project API access, the OAuth client, TEST MCC/customer permissions and exact callback registration must all be verified before authorization. Google Ads developer tokens were sunset on 2026-09-09; access now follows the OAuth client's Cloud project, and this adapter intentionally omits the old header. Some older Google overview/header pages still say the token is required; verify against the dedicated sunset page before a real call.
- Google writes, confirmed writes, Public MCP write scope, Google Login UI and signup conversion measurement remain OFF. The account allowlist is the one TEST customer `8590146099`, but every write gate is OFF. A dedicated `QRS_TEST_LOCAL_READONLY_AUTH` mode closes public signup and limits login to the existing active TEST OWNER; it is valid only for the exact loopback origin, callback and CORS with all writes OFF. No Google request is sent by `docker compose config` or HTTP smoke.
- The real provider env file is `/root/.config/holypilot-google-test/provider.env` (mode `0600`), outside Git and Windows mounts. It contains only the approved TEST session/vault and OAuth client material; the database password remains independent in the local Compose env. The TEST database, audit and approvals reside only in the WSL2 Docker volume. The Windows C: drive is intentionally unencrypted by owner decision; access controls and root-only paths reduce exposure but do not provide at-rest disk encryption. Do not paste credentials into chat or CI.

## Owner-gated activation sequence

1. Owner separately approves local Google TEST OAuth, the exact Cloud project/client and secure local storage. Verify the project has Google Ads API Test access and the OAuth user can access the TEST manager or customer `8590146099`; verify manager `login-customer-id` from Google rather than guessing it. Register the exact localhost callback above for a Web application OAuth client. Keep the approved scope to `adwords`.
2. The owner approved TEST-only transfer to the unencrypted WSL virtual disk. Keep the approved TEST session/vault and OAuth client material in the protected WSL file. No values enter source control, console logs, screenshots, or public CI.
3. Build this profile from one exact committed source SHA, validate the rendered Compose contract, then start the separate four-service stack. Confirm localhost-only binding, healthy API/Web/PostgreSQL/Redis and `/mcp/approve`. Existing-owner interactive login and browser approval still require a real OWNER session; no one may claim those from an anonymous route HTTP 200.
4. With a fresh explicit owner approval, perform one browser OAuth authorization. Confirm `state`, exact callback, encrypted vault, owner/workspace binding and TEST customer discovery. Perform READ-only customer/account/ConversionAction/PMax-resource inventory first. No Google mutation or `validate_only` is implicit in this step.
5. A separate authorization is required before any Google `validate_only`, and a distinct immutable preview and OWNER browser approval are required before each commit or restore. All confirmed-write flags remain OFF until their own controlled acceptance window.

Google TEST accounts do not serve ads; conversion, cost, impression and CPA serving metrics remain unavailable there. No local fixture should be reported as Google LIVE.

## On-demand localhost operation

From the Windows repository checkout, run `./scripts/ops/start-holypilot-local-test.ps1` and `./scripts/ops/stop-holypilot-local-test.ps1`. The start script uses the existing WSL2 Ubuntu and already-built images with `--no-build --pull never`, verifies all four published ports are loopback-only, checks localhost routes, and keeps WSL running in a hidden window. Stop preserves both named volumes and does not touch the separate disposable project. Stop → start was exercised after the real TEST restore; 1 user, 63 previews and 1168 audit events remained. The existing Google callbacks and public TEST origin are not switched by these scripts. The VPS TEST stays running until authenticated local acceptance and separate owner approval to stop those four containers.

## Official references

- [Google Ads developer-token sunset](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
- [Google Ads OAuth scope and offline access](https://developers.google.com/google-ads/api/docs/oauth/internals)
- [OAuth web-server localhost redirect and exact-match rules](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Ads TEST account permissions and serving limitations](https://developers.google.com/google-ads/api/docs/best-practices/test-accounts)
- [Google Ads API project access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)

# Separate local Google Ads TEST profile (prepared, not activated)

This profile is separate from `infra/local-test`: distinct Compose project, PostgreSQL/Redis volumes, localhost ports, API/Web builds and credential vault. It is intended only for Google Ads TEST customer `8590146099` after an explicit owner decision. It has not been started, authorized, or used for a Google provider request. The checked-in `provider.env.example` is intentionally invalid; the API cannot start with it. No VPS data, existing OAuth grant, production account, or public ingress is reused.

## Current safety contract

- Web `127.0.0.1:23300`, API `127.0.0.1:24404`, PostgreSQL `127.0.0.1:25432`, Redis `127.0.0.1:26379`. All services and volumes have names distinct from the disposable stack.
- Google callback is `http://127.0.0.1:24404/oauth/google/callback`; the API redirects back to the configured Web origin after completion. Google supports localhost HTTP redirects for web server applications and desktop loopback flows, but the current HolyPilot provider is a **server-side Web OAuth flow** with a client secret and encrypted refresh-token vault. A standalone desktop token flow would be a separate design, not an automatic substitute.
- `https://www.googleapis.com/auth/adwords` is the provider scope. Google Cloud project API access, the OAuth client, TEST MCC/customer permissions and exact callback registration must all be verified before authorization. Google Ads developer tokens were sunset on 2026-09-09; access now follows the OAuth client's Cloud project, and this adapter intentionally omits the old header. Some older Google overview/header pages still say the token is required; verify against the dedicated sunset page before a real call.
- Google writes, confirmed writes, Public MCP write scope, restricted production-origin gates, Google Login and signup conversion measurement remain OFF. `GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST` is empty. No Google request is sent by `docker compose config` or the CI contract check.
- The real provider env file must be outside the repository (for example `/root/.config/holypilot-google-test/provider.env`, mode `0600`) and contain only TEST-specific OAuth client credentials plus new local `SESSION_HASH_SECRET` and `PROVIDER_CREDENTIAL_ENCRYPTION_KEYS` (`1:` followed by base64 for exactly 32 random bytes). The independent PostgreSQL password is supplied through `HOLYPILOT_GOOGLE_TEST_DB_PASSWORD`. Do not copy any secret or database from VPS and do not paste credentials into chat or CI.

## Owner-gated activation sequence

1. Owner separately approves local Google TEST OAuth, the exact Cloud project/client and secure local storage. Verify the project has Google Ads API Test access and the OAuth user can access the TEST manager or customer `8590146099`; verify manager `login-customer-id` from Google rather than guessing it. Register the exact localhost callback above for a Web application OAuth client. Keep the approved scope to `adwords`.
2. Verify Windows disk protection and access controls for the WSL virtual disk. Generate new local-only database/session/vault secrets and save TEST-only OAuth client credentials in the protected WSL file. No values enter source control, console logs, screenshots, or public CI.
3. Build this profile from one exact committed source SHA, validate the rendered Compose contract, then start the separate four-service stack. Confirm localhost-only binding, healthy API/Web/PostgreSQL/Redis, sessions, login, CSRF, consent and `/mcp/approve` before OAuth.
4. With a fresh explicit owner approval, perform one browser OAuth authorization. Confirm `state`, exact callback, encrypted vault, owner/workspace binding and TEST customer discovery. Perform READ-only customer/account/ConversionAction/PMax-resource inventory first. No Google mutation or `validate_only` is implicit in this step.
5. A separate authorization is required before any Google `validate_only`, and a distinct immutable preview and OWNER browser approval are required before each commit or restore. All confirmed-write flags remain OFF until their own controlled acceptance window.

Google TEST accounts do not serve ads; conversion, cost, impression and CPA serving metrics remain unavailable there. No local fixture should be reported as Google LIVE.

## Official references

- [Google Ads developer-token sunset](https://developers.google.com/google-ads/api/docs/api-policy/developer-token)
- [Google Ads OAuth scope and offline access](https://developers.google.com/google-ads/api/docs/oauth/internals)
- [OAuth web-server localhost redirect and exact-match rules](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google Ads TEST account permissions and serving limitations](https://developers.google.com/google-ads/api/docs/best-practices/test-accounts)
- [Google Ads API project access levels](https://developers.google.com/google-ads/api/docs/api-policy/access-levels)

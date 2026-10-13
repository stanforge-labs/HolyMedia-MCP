# Q/R/S TEST onboarding — ChatGPT + Claude

Status: **PREPARATION ONLY**. The user selected `mcp-test.holymedia.kz` on the **existing VPS**; DNS/HTTPS deployment is not authorized or performed. Q/R/S LIVE NOT RUN. Codex may perform development and smoke tests but is not Q. Historical 20/20 Google Ads advertising acceptance remains separate and is not repeated here. The current infrastructure diff and gates are in [the single-VPS TEST deployment packet](mcp-test-single-vps-deployment-plan-20261013.md).

## One recommended transport

Provision, only after separate operator approval, one dedicated internet-reachable HTTPS TEST origin `https://<approved-test-host>`. Route `POST /mcp?profile=google_ads_write` and the exact OAuth discovery, authorization/token/registration/revocation, human login/consent and browser approval paths listed in [the native readiness checkpoint](private-test-native-mcp-readiness-20261013.md). Run a dedicated TEST proxy and TLS certificate, never the production Nginx vhost or `/mcp/public`. Keep API/web/DB/Redis/vault/network/volumes separate from production and Google account allowlist exactly `8590146099`. No public route exists yet. “Protected” means OAuth and narrow routing, **not** private network reachability: Claude's remote connector must be reachable from Anthropic's cloud.

An OpenAI Secure MCP Tunnel only serves OpenAI clients and does not automatically expose browser-facing HolyMedia OAuth. Choosing it for ChatGPT would still require a separate Claude HTTPS route and an OAuth route; therefore it is not the two-client recommendation. No tunnel, ingress, DNS, firewall, certificate or production configuration was changed.

## Operator change list — separate permission required

1. Allocate a user-owned TEST hostname and certificate; approve DNS and a dedicated TEST-only ingress/proxy with only the allowlisted paths. No wildcard proxy to `/api`, no production vhost modification. Record exact hostname, certificate SAN/issuer, proxy config diff, upstream container image digest and rollback.
2. Pin the TEST API/web source and image; check DB/Redis/vault mount identities differ from production and no pending preview/approval exists. Set canonical `publicBaseUrl`/web API origin consistently to the approved HTTPS origin. Do not expose the current localhost approval gateway as `/mcp`.
3. Verify OAuth metadata: issuer `<origin>`, resource `<origin>/mcp`, S256 PKCE, code+refresh, scope descriptions, DCR or CIMD client registration, exact per-client redirect URI, state/CSRF/session/owner/workspace checks and browser login/consent. Never copy production OAuth secrets or use a TEST service key as a client grant.
4. Keep TEST write allowlist to `8590146099`, production/Public write flags OFF and kill switch tested. Prove unauthenticated HTTP 401 with resource metadata; wrong-account denial; authenticated tools/list, typed schemas/annotations/per-tool OAuth scopes and TEST READ. Then test client-specific interactive OAuth on the actual HTTPS origin. The repository's read-only readiness probe is a transport check, not proof of login.
5. Document rollback as disabling the TEST proxy route and revoking only TEST OAuth grants through stock flows while preserving audit/DB/Redis; revert TEST images only to a pinned digest. No Google raw cleanup or automatic commit retry.

## Q — ChatGPT

In the authorized ChatGPT workspace, verify custom MCP plugin permission. On the web: Plugins → Add custom MCP server → Server URL `https://<approved-test-host>/mcp?profile=google_ads_write` → OAuth → complete HolyMedia interactive login/consent. Record actual tools/list, TEST account READ and A/B/C/M client evidence. Do not claim Q PASS from Codex, REST or mock calls. Any TEST mutation needs its own JIT preview, HolyMedia human browser approval, immutable commit, provider reread, audit and separately approved restoration.

## R — Claude

For Pro/Max: Customize → Connectors → Add custom connector. For Team/Enterprise an owner first uses Organization settings → Connectors → Add → Custom → Web. Enter the **same** MCP URL, choose interactive sign-in and a verified OAuth client mode: published identity/CIMD if compatible, otherwise DCR. Confirm the real redirect URI in registration; do not wildcard it or use fixed bearer headers. Enable the connector only for the acceptance conversation. Record actual tools/list, TEST READ and A/B/C/M-equivalent evidence with a separate Claude client identity. No Claude remote connector exists yet.

## S — two independent consent proofs

For **each** client, retain evidence of the client tool permission if shown, the HolyMedia OAuth login/consent grant, exact preview ID and immutable digest, persisted browser approval (`confirmedAt`/owner/session/audit), fresh TTL/stale/consumed checks, one exact commit, provider reread/journal and an independently approved restoration. Client permission or a chat message never replaces HolyMedia browser approval. Only TEST Client `8590146099`; no historical preview reuse.

## Current evidence and next authorization

Local source has private Streamable HTTP, OAuth metadata and PKCE/redirect/consent guards. Targeted contract/transport tests: 48 PASS, 1 DB-backed integration SKIPPED in the current Windows run; PMax/media/clone targeted tests: 165 PASS. Per-tool OAuth read vs read/write metadata was added and typechecked. No remote ChatGPT/Claude OAuth flow, protected TEST HTTPS origin, live tools/list or client consent was verified; Q/R/S remain BLOCKED.

**Next user action:** review the single-VPS TEST-only packet for `77.240.38.131` and explicitly authorize its bounded DNS/TLS/Nginx/TEST-container changes, conditional on the stated capacity/rollback gates. The DNS A record may require one portal action because no authorized DNS API is attached. Until approval, continue only local/mock/read-only work; do not register a tunnel or expose a route.

Official references: [ChatGPT custom MCP connection](https://developers.openai.com/api/docs/guides/custom-mcp-server), [OpenAI OAuth tool metadata](https://developers.openai.com/plugins/build/auth), [Secure MCP Tunnel limits](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [Claude remote connector and network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

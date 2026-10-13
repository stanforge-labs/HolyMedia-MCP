# Q/R/S TEST onboarding — ChatGPT + Claude

Status: **TEST HTTPS TRANSPORT DEPLOYED; Q/R/S LIVE NOT RUN**. The user approved the conditional [single-VPS TEST deployment packet](mcp-test-single-vps-deployment-plan-20261013.md) and added its DNS A record. `https://mcp-test.holymedia.kz/mcp?profile=google_ads_write` is externally reachable; OAuth discovery and PKCE S256 metadata are live, unauthenticated MCP is 401. This is not proof of interactive human login, client registration, authenticated tools/list, or Google Ads acceptance from either client. Codex is not Q. Historical advertising acceptance 20/20 remains separate.

## One recommended transport

The approved origin is `https://mcp-test.holymedia.kz`, with exact `POST /mcp?profile=google_ads_write` and narrow OAuth/browser routes listed in [the native readiness checkpoint](private-test-native-mcp-readiness-20261013.md). Dedicated TEST API/Web are loopback-bound behind an additive TEST Nginx vhost and certificate; TEST DB/Redis/vault/network remain separate from production and Google account allowlist is exactly `8590146099`. Broad `/api`, `/admin`, `/health` and `/mcp/public` are 404 on this origin. “Protected” means OAuth and narrow routing, **not** private network reachability: Claude's remote connector must be reachable from Anthropic's cloud.

An OpenAI Secure MCP Tunnel only serves OpenAI clients and does not automatically expose browser-facing HolyMedia OAuth. Choosing it for ChatGPT would still require a separate Claude HTTPS route and an OAuth route; therefore it is not the two-client recommendation. No tunnel, firewall or production application/vhost configuration was changed; the approved TEST DNS, certificate and additive TEST ingress were deployed.

## Deployment checklist — infrastructure applied, client proof outstanding

1. Allocate a user-owned TEST hostname and certificate; approve DNS and a dedicated TEST-only ingress/proxy with only the allowlisted paths. No wildcard proxy to `/api`, no production vhost modification. Record exact hostname, certificate SAN/issuer, proxy config diff, upstream container image digest and rollback.
2. Pin the TEST API/web source and image; check DB/Redis/vault mount identities differ from production and no pending preview/approval exists. Set canonical `publicBaseUrl`/web API origin consistently to the approved HTTPS origin. Do not expose the current localhost approval gateway as `/mcp`.
3. Verify OAuth metadata: issuer `<origin>`, resource `<origin>/mcp`, S256 PKCE, code+refresh, scope descriptions, DCR or CIMD client registration, exact per-client redirect URI, state/CSRF/session/owner/workspace checks and browser login/consent. Never copy production OAuth secrets or use a TEST service key as a client grant.
4. Keep TEST write allowlist to `8590146099`, production/Public write flags OFF and kill switch tested. Prove unauthenticated HTTP 401 with resource metadata; wrong-account denial; authenticated tools/list, typed schemas/annotations/per-tool OAuth scopes and TEST READ. Then test client-specific interactive OAuth on the actual HTTPS origin. The repository's read-only readiness probe is a transport check, not proof of login.
5. Document rollback as disabling the TEST proxy route and revoking only TEST OAuth grants through stock flows while preserving audit/DB/Redis; revert TEST images only to a pinned digest. No Google raw cleanup or automatic commit retry.

## Q — ChatGPT

In a ChatGPT workspace that permits custom MCP apps, use Settings or Workspace Settings → Apps → Create (developer mode may need an admin/owner) and enter `https://mcp-test.holymedia.kz/mcp?profile=google_ads_write`, then choose OAuth and complete HolyMedia interactive login/consent. Scan tools and test from a real ChatGPT chat. Record actual tools/list, TEST account READ and A/B/C/M client evidence. Do not claim Q PASS from Codex, REST or mock calls. Any TEST mutation needs its own JIT preview, HolyMedia human browser approval, immutable commit, provider reread, audit and separately approved restoration.

## R — Claude

For Pro/Max: Customize → Connectors → Add custom connector. For Team/Enterprise an owner first uses Organization settings → Connectors → Add → Custom → Web. Enter the **same** MCP URL `https://mcp-test.holymedia.kz/mcp?profile=google_ads_write`, choose interactive sign-in and a verified OAuth client mode: published identity/CIMD if compatible, otherwise DCR. Confirm the real redirect URI in registration; do not wildcard it or use fixed bearer headers. Enable the connector only for the acceptance conversation. Record actual tools/list, TEST READ and A/B/C/M-equivalent evidence with a separate Claude client identity. No Claude remote connector exists yet.

## S — two independent consent proofs

For **each** client, retain evidence of the client tool permission if shown, the HolyMedia OAuth login/consent grant, exact preview ID and immutable digest, persisted browser approval (`confirmedAt`/owner/session/audit), fresh TTL/stale/consumed checks, one exact commit, provider reread/journal and an independently approved restoration. Client permission or a chat message never replaces HolyMedia browser approval. Only TEST Client `8590146099`; no historical preview reuse.

## Current evidence and next authorization

Local source has private Streamable HTTP, OAuth metadata and PKCE/redirect/consent guards. Targeted contract/transport tests: 48 PASS, 1 DB-backed integration SKIPPED in the prior Windows run; latest PMax/media/clone targeted tests: 169 PASS / 0 skipped. Per-tool OAuth read vs read/write metadata was added and typechecked. Exact-HEAD Linux foundation/API/Web CI succeeded. TEST HTTPS, external discovery and unauthenticated protection passed, but no remote ChatGPT/Claude human OAuth grant, live tools/list or client consent was verified; Q/R/S remain NOT RUN. Initial TEST Google write gates are OFF and must remain so until a separately controlled TEST-only write acceptance step; Public and production write gates stay OFF. ChatGPT OAuth refresh-token continuity may require advertising/requesting `offline_access`; this has not been proven by a real client flow.

**Next user action:** the user has separately authorized at most two TEST OAuth **public client registrations** (client IDs, no client secrets, no new service key) and read-only Q/R smoke; none has been created yet. Add the TEST MCP URL above in ChatGPT and Claude and complete HolyMedia login/consent locally. Do not enter passwords, tokens or private keys in chat. This consent does **not** authorize enabling TEST write gates or a Google commit; each future Google commit still requires its own HolyMedia browser approval.

Official references: [ChatGPT custom MCP connection](https://developers.openai.com/api/docs/guides/custom-mcp-server), [OpenAI OAuth tool metadata](https://developers.openai.com/plugins/build/auth), [Secure MCP Tunnel limits](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels), [Claude remote connector and network requirements](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

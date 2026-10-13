# Private TEST native MCP — Q/R/S readiness checkpoint

Status: **LOCAL CODE/TEST PREPARATION PASS; real-client Q/R/S BLOCKED**. This is a design and read-only preparation record, not permission to publish an ingress, change DNS/firewall/production routing, issue a service key, or perform Google Ads mutations.

## Verified local boundary

- Existing private Streamable HTTP transport is `POST /mcp?profile=google_ads_write`; a valid `GET /mcp` deliberately does not offer SSE. Public `/mcp/public` has separate read/write flags, which must remain OFF for writes.
- Stock API has private protected-resource and authorization-server metadata, `/oauth/authorize`, `/oauth/authorize/continue`, `/oauth/authorize/transaction`, `/oauth/authorize/consent`, `/oauth/token`, `/oauth/register`, `/oauth/revoke`. Stock web has `/auth`, `/connect/claude` and `/mcp/approve`. OAuth code flow requires S256 PKCE, exact redirect URI, workspace/user consent and exact resource binding. A client tool permission is **not** HolyMedia browser approval.
- The existing `localhost:4404` acceptance approval gateway exposes only browser-approval routes; it is **not** the native MCP endpoint. No external private TEST origin, certificate, tunnel association or real client session was proved in this work.
- Local tests: native OAuth/MCP routing plus shared-budget integration 80 PASS; new read-only native readiness checker 3 PASS. The checker emits no credentials, calls no Google API and can only prove unauthenticated transport/metadata readiness, not actual user login or Q/R/S.

## Isolation contract before any external connection

Use a dedicated TEST API, TEST web, TEST Postgres, TEST Redis, acceptance vault and private network with separate volume names and no production mounts. Pin the exact tested source/image digest and record a rollback image. The only Google write allowlist entry may be `8590146099`; the MCC `4378327049` is context, never a mutation target. Keep `PUBLIC_MCP_WRITE_SCOPE_ENABLED=false` and `PUBLIC_MCP_CONTROLLED_WRITE_ENABLED=false`, production write gates OFF, and verify TEST owner/workspace/scopes against the actual DB. Do not run the general development Compose file as an ingress: it publishes ports and runs Prisma deploy. No migration or shared production state is authorized here.

The canonical TEST origin must be selected and separately authorized **before** configuration; no hostname is invented here. Bind the TEST proxy to loopback/private interfaces while preparing it. Route the following exact paths at one canonical origin, with TEST-only web and API upstreams:

| Route                                                                                                                                                           | TEST upstream / gate                                                                                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `POST /mcp?profile=google_ads_write`                                                                                                                            | Stock TEST API; bearer OAuth; no Public profile fallback                                              |
| `GET /.well-known/oauth-protected-resource/mcp`, `GET /.well-known/oauth-authorization-server`                                                                  | Stock TEST API; resource must be `<origin>/mcp`, issuer `<origin>`                                    |
| `/oauth/authorize`, `/oauth/authorize/continue`, `/oauth/authorize/transaction`, `/oauth/authorize/consent`, `/oauth/token`, `/oauth/register`, `/oauth/revoke` | Stock TEST API; PKCE S256, exact redirect URI, CSRF/session and client registration controls retained |
| `/auth`, `/connect/claude`, `/mcp/approve`                                                                                                                      | Stock TEST web; actual human login/consent/approval, not a simulated page                             |
| Browser approval API routes                                                                                                                                     | Stock TEST API; same TEST session/CSRF/owner; never proxy arbitrary `/api` paths by default           |

Set the TEST process's public base URL and web API base URL to the **same authorized canonical origin** before image build; verify cookies, CORS, forwarded host/protocol, TLS chain and redirect URIs. The exact hostname, certificate issuer/SAN, origin of credentials, OAuth client registrations and required proxy changes are currently **NOT VERIFIED / NOT ALLOCATED**. Do not copy production OAuth or Google credentials into TEST. Only the separately isolated TEST vault may hold TEST credentials.

The network options are (a) a separately approved dedicated TEST HTTPS ingress, with its own DNS/TLS/firewall review, or (b) a separately approved outbound Secure MCP Tunnel **after** confirming that its URL and browser OAuth/login/consent callbacks are reachable and canonical for both clients. A tunnel does not waive HolyMedia PKCE, account, approval or audit guards. No option was provisioned here.

Before enabling a client, run `node scripts/google-live-acceptance/stage234/private-native-readiness.mjs <authorized-test-origin>` from an operator host. PASS proves only exact metadata and unauthenticated HTTP 401. Then separately test authorized `initialize`, `tools/list`, typed schemas/annotations, TEST READ, wrong-account denial, OAuth state/PKCE/redirect rejection, human consent, approval/CSRF, expiry/stale/consumed guards and audit. Keep the TEST transport closed to clients until this evidence and source/image/database/network isolation are recorded.

## Q: ChatGPT; R: Gemini CLI; S: independent human approval

Q cannot be marked available from repository tests. The workspace admin/user must verify that ChatGPT custom MCP apps/developer mode are enabled for this specific workspace, then create a private TEST connection to the **verified** endpoint and complete HolyMedia OAuth interactively. First record real native `tools/list`, schemas/annotations and TEST account READ; then A/B/C/M-equivalent scenarios with new preview IDs. Do not reuse historical commits. The current conversation does not prove this workspace permission or a connected HolyMedia TEST MCP plugin.

For R, after the same endpoint is verified, use a private user-level Gemini CLI `settings.json` entry with `httpUrl: "<verified TEST origin>/mcp?profile=google_ads_write"`, `trust: false`, OAuth dynamic discovery and initially only `adforge:mcp:read`. Do not put a service key or client secret in the repository, command line or URL. Run `/mcp auth holymediaTest`, `/mcp list`, `/mcp desc`, then TEST reads. The CLI is not currently found in this Windows PATH, and no real R call was made.

For S, record per client: its tool-call permission if offered; client/user/workspace identity; exact preview ID and immutable digest; separate human browser approval session and `confirmedAt`; one stock commit only after fresh TTL/stale/consumed checks; provider reread; journal/audit; separately approved restoration. Neither client permission nor a chat message substitutes for HolyMedia approval. Q/R/S remain **BLOCKED** until those real client calls and approvals happen.

## Kill switch and rollback

Before a TEST connection, confirm a bounded stop procedure: disable/disconnect the isolated tunnel or TEST proxy; revoke only TEST OAuth clients/grants and disposable TEST service keys through the stock admin flow if needed; set TEST provider write gates OFF; preserve DB/audit/volumes; restore only the pinned TEST API/web image if an update fails. Do not remove production routes, change production credentials, delete audit state, or run a Google raw cleanup. Any test Google object restoration requires its own new approved preview.

External publication, TEST OAuth client registration and any real Google mutation remain separate checkpoints. No pending Google approval is created by this document.

# Native OAuth private Google controlled writes — original PPC P46

## Identity and scope

Private `/mcp?profile=google_ads_write` and the same Google `/mcp/rest/:tool` profile preserve an authenticated `OAuthMcpPrincipal`; an OAuth access-token ID is never treated as a ServiceToken ID. Existing service-key behavior is retained, and private OAuth read-only clients keep read access.

The existing Authorization Code + S256 PKCE issuer may grant `adforge:mcp:read adforge:mcp:write` for the exact private legacy resource only when `PROVIDER_GOOGLE_ADS_WRITE_ENABLED=true`. The client must declare those scopes and the human must explicitly select write consent; read-only consent cannot silently escalate. The existing read-only legacy client remains read-only: obtain a new explicit native issuer grant rather than editing an old token. The consent screen identifies Google Ads, the server account allowlist, per-operation preview and human browser approval. It explicitly does not authorize other providers or Public MCP.

Public resource scopes and operations retain their separate existing gates. `PUBLIC_MCP_WRITE_SCOPE_ENABLED=false` and `PUBLIC_MCP_CONTROLLED_WRITE_ENABLED=false` remain unchanged; the private Google gate does not enable Public writes. Resource-bound access and refresh tokens cannot be exchanged/used across private and Public resources. Google provider connection OAuth credentials and callbacks are untouched.

## Preview, approval and commit

Existing `McpPreview` columns store `principalType=OAUTH_USER`, `oauthUserId`, `oauthClientId`, `oauthGrantId`, and `serviceTokenId=null`. There is no `oauthResource` column and no new migration: the exact resource is bound in the protected stored `diff.authorization` context and compared with the independently verified fresh grant resource, stable identity columns and current principal. Commit CAS includes the stored identity, diff, payload, before/requested states, snapshot digest, approval/session and consumed/expiry guards.

The stable user/client/workspace/refresh-family/resource identity survives access-token rotation. A consumed preview cannot be reused, and each inverse requires a new preview and a new human approval.

Fresh checks cover active user, workspace and client, a current workspace role (OWNER/ADMIN/MEMBER, not VIEWER), declared/granted read/write scopes, current unrevoked/unexpired access token at API operations and a usable refresh-family grant. Browser approval additionally requires the same OAuth user and a valid human session. Commit requires persisted confirmation, matching human session, durable successful approval audit, account ownership, provider permission, write allowlist, existing flags, unchanged exact payload and stale provider snapshot. These checks run again at claim and immediately before provider mutation; a late revocation closes the operation without retry. A denied claim may remain consumed, intentionally preventing uncertain replay.

All Google lifecycle audit events retain the existing journal architecture, with HUMAN actor identity for native OAuth and explicit approving-user evidence. There is no synthetic service identity, ServiceToken creation, separate confirmation service, TTL extension, or raw provider write path. Other private OAuth provider writes remain rejected.

## Verification boundary

`google-native-oauth.integration.test.ts` uses the stock MCP/preview/approval/commit/reread/audit/rollback services with provider HTTP mocked. It checks native nullable ServiceToken FK storage, rotation, keyword and extended-plan lifecycles, fresh scope/role/grant/token checks, foreign user/client/grant/workspace/resource, missing session/audit/approval, expiry, stale/tamper, concurrent CAS, revocation during claim and private/Public isolation. Issuer tests cover explicit private consent, read-only downgrade, PKCE token/refresh resource binding and Public-gate independence. Existing browser approval CSRF/authentication HTTP tests remain the same protected route.

Real OAuth, Google TEST account mutation and cross-client Q/R/S acceptance are NOT performed by this package. Q/R remain a mandatory separate LIVE gate: connect a real supported MCP client, request the explicit private resource/scope, obtain human consent, and then execute only separately approved TEST-account previews/commits. Mock PASS is not LIVE PASS.

Provider calls/writes for implementation: 0. Production, main, Google client credentials and the Stage 0+1 release candidate are unchanged. No database migration or dependency upgrade is introduced.

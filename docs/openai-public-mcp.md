# HolyMedia public MCP: implementation and rollout

This is **code-only and not deployed**. The future production endpoint is
`https://mcp.holymedia.kz/mcp/public`; local acceptance uses an HTTPS tunnel
configured through `HOLYMEDIA_PUBLIC_BASE_URL`. It shares the API process,
OAuth server, database and provider adapters. Legacy `/mcp`, ServiceToken
previews, `confirm_preview`, App Review aliases and the hardcoded Meta App
Review flow remain separate and unchanged.

## Routing and tools

The production API bootstrap excludes public MCP and its protected-resource
metadata from the `api/v1` global prefix. Root routes are `POST /mcp/public`,
`GET /mcp/public` and
`GET /.well-known/oauth-protected-resource/mcp/public`. The last URL is used
in public MCP's `WWW-Authenticate` challenge. Its authorization-server
reference points to root `/.well-known/oauth-authorization-server`; authorize
and token endpoints remain `/oauth/authorize` and `/oauth/token`. A real
Nest/Fastify HTTP test checks these routes, their prefixed counterparts, and
legacy `/mcp`.

`POST /mcp/public` supports Streamable HTTP JSON-RPC `initialize`,
`notifications/initialized`, `tools/list` and `tools/call`. Authenticated GET
returns 405, not SSE. Only an OAuth token for the exact `/mcp/public` resource
is accepted. Both listing and invocation enforce the server-side allowlist.

The public registry has an explicit reviewed read allowlist from the current
legacy MCP registry, plus four controlled-write tools:

```text
preview_change_campaign_name
preview_pause_campaign
preview_resume_campaign
commit_confirmed_preview
```

The read allowlist includes `google_ads_list_keywords`,
`google_ads_search_terms`, `google_ads_list_negatives` and
`google_ads_check_negative_conflicts`. Its test checks capabilities and names,
not an old fixed tool count. `confirm_preview`, `commit_preview`, `commit_meta_app_review_preview` and
`commit_meta_confirmed_write` are not public. The read registry includes the
selected account, campaign, analytics, diagnostics and structured-report tools
in `mcp-public-tools.ts`; arbitrary-site analysis and capability aliases are
omitted. Public write descriptions explicitly say preview does not mutate a
provider and commit needs separate HolyMedia browser approval.

### Annotation rationale

Preview persists local preview/audit state: `readOnlyHint=false`,
`destructiveHint=false`. Commit may mutate a Meta campaign:
`readOnlyHint=false`, `destructiveHint=true`. `run_connection_diagnostics`
may refresh credentials or update persistent health status, so it is not
marked read-only. `generate_monthly_ads_report` builds structured data in
memory, not a persistent user report resource, and remains read-only. Other
provider reads have no business mutation. Credential refresh, usage accounting
and telemetry are operational effects distinct from business writes. Hints are
advisory; server authorization is the actual boundary.

## OAuth scope and two independent gates

`adforge:mcp:read` supports the reviewed read tools. Controlled writes additionally
require an explicitly granted `adforge:mcp:write` scope for the public resource.
`PUBLIC_MCP_WRITE_SCOPE_ENABLED` defaults to `false`: public OAuth metadata
omits write, authorization rejects it, and refresh cannot add it to a read
grant. API and Web must roll out together before enabling issuance. New Web
consent uses the actual OAuth client name, separates read/write, and leaves
write unchecked by default. A stale Web consent that does not explicitly
submit approved write scope cannot silently issue it.

`PUBLIC_MCP_CONTROLLED_WRITE_ENABLED` also defaults to `false`; it separately
blocks provider commit. Both flags, granted write scope, human approval and
all policy checks must pass for a mutation. Legacy `V2_CONFIRMED_WRITE_ENABLED`
and App Review paths are independent. Do not enable either new flag in
production as part of this code-only task.

## Public browser approval

Only Meta campaign rename, pause and resume are supported. Preview fetches
direct campaign state, checks ownership and `ads_management`, and stores
before/requested state. It returns a `preview_token` for later MCP commit and
a separate high-entropy approval URL nonce, plus before, requested, expiry
and a notice that no mutation was sent. Both tokens are stored as SHA-256
digests. The nonce is single-purpose, expires within the ten-minute preview,
and is not sufficient to approve anything by possession alone.

The user opens `/mcp/approve#hmap_...` or its `/en` equivalent. The fragment
is not sent in the initial HTTP GET. The page immediately stores the nonce in
per-tab `sessionStorage` and removes the fragment with `history.replaceState`.
An authenticated, CSRF-protected `POST /api/v1/mcp/public/approval/view`
passes the nonce in a JSON body and only shows provider, account, campaign,
operation, before, after and expiry; it never sets `confirmedAt`. The page
omits credentials, preview tokens, grant IDs and policy details. Locale
switching uses only the safe path and recovers the nonce from the same tab.
Login return URLs are restricted to the fixed `/mcp/approve` or
`/en/mcp/approve` path, without a nonce in query, path or fragment. Approval
success does not redirect to a query-provided destination. Approval/cancel
POSTs also pass the nonce in a JSON body and clear it from sessionStorage on
success. Both approval pages respond with `Referrer-Policy: no-referrer`,
`Cache-Control: no-store` and noindex headers/metadata.

An explicit Confirm or Cancel POST uses the HolyMedia cookie session and
existing CSRF protection. An MCP bearer token alone cannot authorize it. The
server verifies exact preview user/workspace, active membership, active
same-client OAuth refresh family with public-resource write grant, connected
Meta account and `ads_management`; it checks expiry and unconsumed/uncancelled
state. An atomic update records `confirmedAt`, approving user and web session,
or `cancelledAt`. Cancellation permanently prevents commit. Neither web
action sends a Meta mutation.

`commit_confirmed_preview` accepts only `preview_token`. The actual sequence
is OAuth/resource/scope authorization; preview and owner/workspace/client/grant
validation; operation/expiry/human approval; account and Meta permission
checks; direct provider read; operation-specific stale check; both flags;
atomic claim; at most one mutation; direct read-back; final status and audit.
Campaign/account identity is always checked separately. For rename only a
changed name is stale; for pause/resume only a changed status is stale. This
is a HolyMedia optimistic-concurrency check, not a Meta version.

The adapter mutates only `name` or `status` as appropriate. Read-back must
match before `VERIFIED`. A request failure before accepted mutation is not
committed/verified. A lost response is never automatically retried: direct
read-back may establish success; otherwise the result is non-verified or
uncertain. Successful mutation with failed or mismatched read-back is never
`VERIFIED`; the consumed preview prevents a second mutation. Audit keeps
actor, resource, before/requested, approval, attempt and verification outcome
without storing raw tokens or credentials.

## PostgreSQL 18 migration and application rollback

Migration `0032_public_mcp_oauth_previews` enables OAuth-owned rows while
preserving legacy ServiceToken rows. Migration
`0033_public_mcp_browser_approval` adds a nullable unique approval digest,
approver/session and cancellation fields plus database identity constraints.
Rehearse both fresh installation and current-main upgrade on a disposable
PostgreSQL 18 database before local acceptance. The rehearsal must inspect
legacy ServiceToken previews, OAuth preview/browser approval and Prisma
client behavior. Never point this procedure at production data.

If the API must revert to the old image after migration, keep **both public
flags OFF**. The old image can use the additive schema: Prisma ignores new
nullable columns, old ServiceToken rows retain `serviceTokenId`, and legacy
queries filter by that ID. They ignore new OAuth rows with null
`serviceTokenId`. The old image does not understand browser approval;
outstanding OAuth previews should be abandoned and re-previewed after a
forward deploy. In particular, do not enable old-image public controlled
write during rollback: that version exposes MCP `confirm_preview`. No
destructive SQL-down migration is planned; preserve audit evidence and roll
forward with a corrected application image. Verify old-image boot and legacy
smoke tests in an isolated local rehearsal before relying on rollback.

## Separate report phase and rollout

Public report tools return structured chat data, not files. Web DOCX/PPTX
downloads are not exposed through MCP; file delivery needs separate design.

1. Run CI and local unit, integration, browser and PostgreSQL 18 migration
   rehearsals with both public write flags OFF and no live provider calls.
2. In a separate task, expose the isolated local API/Web through an HTTPS
   tunnel and set `HOLYMEDIA_PUBLIC_BASE_URL` to that tunnel origin. Use
   ChatGPT Developer Mode to check root discovery, read consent, write
   rejection, both locales, ownership/CSRF denial, `/mcp` and App Review.
3. Record local acceptance evidence, including origin/resource isolation and
   ingress log redaction. Only then plan a separately approved production
   acceptance and Plugin submission. This document authorizes neither a
   production deploy nor a provider write.

Before enabling `PUBLIC_MCP_WRITE_SCOPE_ENABLED` in any environment, verify
the actual ingress configuration and access logs. They must not record
sensitive query, body or header values, including Authorization, Cookie,
CSRF proofs, approval nonces and preview tokens. The approval route itself
must not carry a nonce in its requested URL, and local acceptance must
confirm that Web/API/ingress logs and telemetry contain none of these values.
Application-level redaction does not prove ingress-level redaction.

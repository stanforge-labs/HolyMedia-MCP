# HolyMedia public MCP: implementation and rollout

This is **code-only and not deployed**. The future endpoint is
`https://mcp.holymedia.kz/mcp/public`. It shares the existing API process,
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

The public registry has **42 tools: 38 read and four controlled-write**:

```text
preview_change_campaign_name
preview_pause_campaign
preview_resume_campaign
commit_confirmed_preview
```

`confirm_preview`, `commit_preview`, `commit_meta_app_review_preview` and
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

`adforge:mcp:read` supports all 38 read tools. Controlled writes additionally
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

The user opens `/mcp/approve?approval=...` or its `/en` equivalent. GET only
shows provider, account, campaign, operation, before, after and expiry; it
never sets `confirmedAt`. The page omits credentials, preview tokens, grant
IDs and policy details. Locale switching preserves only a validated approval
nonce. Authentication redirects use a same-origin allowlist; approval success
does not redirect to a query-provided destination.

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

Migration `0032_public_mcp_oauth_preview` enables OAuth-owned rows while
preserving legacy ServiceToken rows. Migration
`0033_public_mcp_browser_approval` adds a nullable unique approval digest,
approver/session and cancellation fields plus database identity constraints.
In a disposable **PostgreSQL 18.6** database, we applied pre-0032 schema,
created a representative ServiceToken preview, applied 0032 and 0033, queried
the legacy row through Prisma, exercised OAuth preview/browser approval and
parallel commit with a fake provider, and checked nullability, FKs and
indexes. No production database or provider was used.

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
smoke tests in staging before relying on rollback.

## Separate report phase and rollout

Public report tools return structured chat data, not files. Web DOCX/PPTX
downloads are not exposed through MCP; file delivery needs separate design.

1. Deploy new API and Web together with both flags OFF. Verify additive
   migrations on a backed-up staging database.
2. In staging, check root discovery, read consent, write rejection while its
   gate is OFF, both locales, ownership/CSRF denial, `/mcp` and App Review.
3. Enable scope issuance only in staging and obtain explicit new-Web consent.
   Test preview, approval/cancel, expiry and stale detection with commit OFF.
4. After separate approval, enable controlled commit only in staging, using a
   designated test campaign and direct read-back/audit/uncertainty drills.
5. Review monitoring and rollback before any production rollout. This
   document authorizes neither production deploy nor provider write.

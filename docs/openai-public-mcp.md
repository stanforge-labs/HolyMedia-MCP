# HolyMedia public MCP (implementation and rollout)

This document describes the code-only public MCP profile. It is **not deployed**.
The production URL after a separately approved rollout will be
`https://mcp.holymedia.kz/mcp/public`. It uses the existing API process,
OAuth, workspace database, and provider adapters. The legacy `/mcp` route and
its 157-tool compatibility registry remain separate and unchanged.

## Endpoint and transport

`POST /mcp/public` handles the same Streamable HTTP JSON-RPC methods as `/mcp`:
`initialize`, `notifications/initialized`, `tools/list`, and `tools/call`.
`GET /mcp/public` authenticates and returns the same explicit 405 response as
`GET /mcp` (no SSE stream). The public resource metadata is at
`/.well-known/oauth-protected-resource/mcp/public`. Public access requires an
OAuth access token whose resource is exactly `/mcp/public`; a legacy service
token or a token for `/mcp` is not accepted there.

The server filters both `tools/list` and `tools/call`. Calling an omitted tool
by name returns `public_operation_not_available`; hiding tools in a plugin
manifest is not the authorization boundary.

## Exact public tool registry (43)

READ (38):

```text
list_connected_resources
list_ad_accounts
get_account_status
get_account_summary
run_connection_diagnostics
list_campaigns
get_campaign
get_campaign_statuses
get_basic_metrics
get_performance_report
get_spend_overview
get_status_summary
get_top_performers
get_campaign_structure
get_google_ads_detailed_report
get_meta_ads_detailed_report
get_meta_oauth_permissions
get_flexible_insights
google_analytics_list_properties
google_analytics_get_property
google_analytics_run_report
google_analytics_check_compatibility
google_analytics_traffic_overview
google_analytics_acquisition
google_analytics_landing_pages
google_analytics_pages
google_analytics_events
google_analytics_key_events
google_analytics_devices
google_analytics_geography
google_analytics_realtime
google_analytics_compare_periods
google_analytics_list_google_ads_links
google_analytics_get_custom_dimensions_metrics
get_search_console_report
list_search_console_properties
compare_periods
generate_monthly_ads_report
```

CONTROLLED WRITE (5):

```text
preview_change_campaign_name
preview_pause_campaign
preview_resume_campaign
confirm_preview
commit_confirmed_preview
```

The shared ads read tools resolve Google Ads, Meta Ads, TikTok Ads, and Yandex
Direct through the existing account/provider adapters. GA4 and Search Console
have dedicated read tools. `generate_monthly_ads_report` produces structured
report data, not a file. It requires the existing `reports` entitlement and
performs provider reads only. Arbitrary-site analysis and capability aliases
that advertise hidden operations are intentionally omitted. All public tools
have `readOnlyHint`, `destructiveHint`, and `openWorldHint`; the registry also
sets `title` and `idempotentHint`. Provider/workspace reads are read-only;
preview and confirm persist local state; commit can mutate a provider.

## OAuth consent and scope

`adforge:mcp:read` remains sufficient for all 38 analytics tools.
`adforge:mcp:write` must be requested in addition to read, for the public
resource only. A client must declare write in its registration/metadata, the
authorization request must explicitly include it, and the user sees a
separate consent statement: “Разрешить HolyMedia MCP выполнять подтверждённые
вами изменения в подключённых рекламных аккаунтах.” The code and refresh
tokens persist exactly the granted scope string. Refresh rotation copies it;
it never adds write. An OAuth grant for `/mcp` remains read-only.

Write scope alone is not sufficient for a mutation. Server-side workspace,
connection, account, campaign, provider permission, operation, preview and
feature-flag policy are independently enforced.

## Controlled Meta campaign write

Only `META_CAMPAIGN_RENAME`, `META_CAMPAIGN_PAUSE`, and
`META_CAMPAIGN_RESUME` are supported. Public preview inputs contain only
`account_id`, `campaign_id`, and (for rename) `new_name`. The server fetches a
direct Meta campaign state, checks account ownership and `ads_management`,
then stores its `name` and `status`, the requested value, and a SHA-256 hash of
the canonical `[campaignId, accountId, name, status]` snapshot. This is a
HolyMedia optimistic-concurrency hash, **not a claimed Meta version**.

The preview is bound to the workspace, user, OAuth client, stable refresh-family
grant, connection, account, campaign and operation. It is not bound to an
hour-lived access token. TTL is **10 minutes**, matching the pre-existing MCP
preview lifetime. A repeated confirm returns the original confirmation time;
confirm itself sends no provider mutation. Legacy `SERVICE_TOKEN` previews
remain supported through the original `/mcp` flow.

`commit_confirmed_preview` accepts **only** `preview_token`. It takes all
mutation parameters from the stored preview. Before a provider call, it
atomically claims the preview and directly rereads the campaign. A changed
snapshot returns typed `preview_stale`, sends no mutation, and requires a new
preview. The existing Meta adapter sends only the mutation business field:
`name` for rename or `status=PAUSED|ACTIVE` for pause/resume. The provider
credential is supplied for authentication, not as an additional mutation
field. A fresh **direct** campaign read-back must match the requested state
before the final status becomes `VERIFIED`.

If the provider response is lost, commit is never retried automatically. One
direct read-back determines whether the requested state is present. If it is,
the result can be `VERIFIED`; if it differs, the result is `NOT_VERIFIED`; if
read-back fails, the typed result is `provider_outcome_uncertain` and the
preview stays consumed. A mismatched successful provider response returns
`verification_mismatch`, not `VERIFIED`.

Public preview records and audit events retain actor/workspace/client/grant,
provider, connection/account/campaign/operation, before/requested values,
creation and confirmation times, commit attempt, provider result, verification
read and final status. OAuth tokens, refresh tokens and Meta credentials are
never placed in this audit metadata.

## Feature flag and App Review isolation

`PUBLIC_MCP_CONTROLLED_WRITE_ENABLED` defaults to `false`. When false, public
preview and confirmation work, but provider commit is blocked before a write.
This flag is independent of `V2_CONFIRMED_WRITE_ENABLED`, its generic
allowlists, and the hardcoded Meta App Review exceptions. The latter remain
on the old `/mcp` path and are not public tools. Do not enable this new flag
in production as part of this code-only task.

## Report files: separate phase

The current MCP report tools return structured data for a chat response. The
existing authenticated Web API has `performance.docx` and `performance.pptx`
downloads, but no reviewed public MCP tool returns a file, link or attachment.
File delivery through the plugin needs a separate design and end-to-end
acceptance phase; this change does not expose Web download URLs as a shortcut.

## Rollout after code review

1. Apply and verify Prisma migration in a disposable/staging database, including
   a pre-migration service-token preview row and an OAuth preview lifecycle.
2. Run staging OAuth read-only and write-consent flows with distinct users,
   workspaces, clients and rotated access tokens. Verify public and legacy
   `tools/list` and hidden-tool rejection.
3. With the public flag still OFF, validate preview, confirmation, expiry,
   stale detection and audit against a staging Meta connection. No provider
   mutation is allowed in this step.
4. After separate owner approval, enable the flag only in staging, run one
   approved campaign rename/pause/resume acceptance with direct read-back and
   audit inspection; include lost-response and mismatch drills.
5. Reconfirm App Review regressions, production readiness, rollback and
   monitoring before any production deploy. Prepare Plugin ZIP only after the
   endpoint and live acceptance are separately approved.

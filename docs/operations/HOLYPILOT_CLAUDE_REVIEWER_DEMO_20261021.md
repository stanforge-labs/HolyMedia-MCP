# HolyPilot Claude reviewer demo — release boundary

Status: **local disposable acceptance passed; production unchanged**. No API deploy, production reviewer identity or Directory submission has been executed from this branch.

## Local disposable acceptance (2026-10-21)

An isolated PostgreSQL 18 and Redis instance were used without starting the existing WSL2 TEST stack. All schema migrations were applied to the disposable database. The owner-only maintenance command passed `inspect → provision → repeat provision → inspect → remove → inspect`; the repeat created no duplicate, a conflicting reviewer email was rejected, and removal left the demo workspace absent. The reviewer logged into a local API as `VIEWER`, completed public OAuth registration, authorization and PKCE exchange with the read scope, and ran three public MCP use cases: account selection, five synthetic campaigns, and period comparison plus report. The synthetic results carried `realData=false` and `dataStatus=demo`.

The local checks rejected another workspace in OAuth, a foreign account ID, a WRITE preview and an expired demo marker. Before removal, the demo workspace had zero provider accounts and zero provider connections. Focused database-backed OAuth and security tests passed. This is local integration evidence only; no Claude UI reviewer session or production demo identity is claimed.

## Design

- The demo marker uses the existing entitlement model: `reviewer_demo=true`, source `reviewer_demo_bootstrap`, on the fixed `holypilot-anthropic-reviewer-demo` slug. The API validates all three values and active workspace status. No public HTTP/MCP endpoint can set the trusted source; the private admin entitlement path rewrites source to `admin_manual`. Only the owner-operated maintenance command creates the marker. No schema migration is needed.
- The command creates one new password-based reviewer identity, one `VIEWER` membership, and bounded `mcp`, `reports`, and monthly MCP request entitlements in one transaction. It refuses an email already registered in HolyPilot. The password comes from a file supplied by the operator, never a command argument, Git file or log.
- OAuth authorization remains the existing Claude/HolyPilot flow. A valid OAuth principal, read scope and current membership are required. Account-restricted grants fail closed because the synthetic fixture IDs are not real provider-account UUIDs.
- The MCP service recognizes the database marker and serves an explicit, synthetic, read-only fixture. The regular provider adapter, credential store, reports and preview paths are not called. Public WRITE tools fail closed. Provider OAuth start/callback/refresh and credential-backed reads reject demo workspaces.
- Every synthetic result is marked `realData=false`, `dataStatus=demo` and carries synthetic provenance. The fixture has five Google Ads campaigns across two different 14-day periods, keywords, search terms and negatives, plus small Meta, GA4 and Search Console examples. No provider account, provider connection or credential is inserted into the database.
- The explicit Search Console `property_not_found` result no longer lists available properties. Unknown properties do not trigger credential refresh. The authorized `list_search_console_properties` behavior remains separate.

## Three reviewer scenarios after owner approval and API release

1. Select account: authorize reviewer in Claude, call `list_ad_accounts`, select only `GOOGLE_ADS / 9990000001`. Confirm `dataStatus=demo` and `realData=false`.
2. Campaigns: call `list_campaigns` with that account, a date range within the last 28 complete UTC days and `limit=5`. Expect five synthetic campaigns, no Google API call, no WRITE.
3. Management comparison: call `compare_periods` with the preceding and current 14-day periods, then `generate_monthly_ads_report` for the current period. Explain that figures and recommendations illustrate product behavior and are not real ad-platform performance.

Meta, GA4 and Search Console examples are limited synthetic illustrations. Live parity for those providers is not claimed. Connection diagnostics is intentionally unavailable in demo because the production implementation may refresh provider credentials. All advertising WRITE operations remain unavailable.

## Owner-controlled activation and removal

After separate approval: merge only reviewed API changes into `main`; allow the existing GitHub Actions API-only build and deploy. Do not change Compose, Nginx, Worker or the deployment workflow. Verify production health and existing tenant reads.

Run `apps/api/dist/scripts/reviewer-demo-maintenance.js inspect` with the existing production `DATABASE_URL` only after the approved API release. To provision, supply `REVIEWER_DEMO_OWNER_APPROVAL=OWNER_APPROVED_REVIEWER_DEMO`, `REVIEWER_DEMO_EMAIL`, and `REVIEWER_DEMO_PASSWORD_FILE` in a protected operator context, then run `provision` once. The password file must be readable only by the operator and removed from the runtime after secure handoff. Never paste the password into GitHub, logs, a ticket or this chat. Idempotent re-runs verify the same user, marker and entitlements.

For removal, first run `inspect` in the protected context and record `reviewerUserId`; then supply the same approval, email and `REVIEWER_DEMO_EXPECT_USER_ID` and run `remove`. Removal refuses workspaces with provider accounts/connections or users with additional memberships. The operator should revoke Claude access after review and confirm cleanup. These commands have been exercised only on the disposable local database; production activation and removal remain pending approval.

## Stop points

1. Owner approval required before merge, API deploy and reviewer provisioning.
2. Authorized Claude tests on the actual demo identity are required before adding credentials to either Directory draft.
3. Directory legal declarations and Submit require separate final owner confirmation. Both applications remain DRAFT.

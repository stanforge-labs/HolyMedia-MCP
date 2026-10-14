# Claude Manual Write OAuth — TEST server verification

Status: **R WRITE OAUTH VERIFIED; R/A–M and two-client S remain OPEN**. This is not a Google Ads write or a full Claude acceptance PASS.

## Redacted server evidence (UTC, 2026-10-14)

- New TEST public DCR client alias `fcffec5584f9`, created 19:48:32, active, `none` client authentication and the single confirmed Claude callback. Its registration scope is exactly `adforge:mcp:read adforge:mcp:write`.
- Authorization transaction alias `c410f2d9a958`, created 19:54:21 and consumed 19:55:53, has exact resource `https://mcp-test.holymedia.kz/mcp`, S256, both scopes, active OWNER and TEST workspace aliases `d5cd2f5de434` / `848efb4c952c`. A matching code was created 19:55:53 and used 19:55:55. The code's approved scopes, not merely the registration capability, contain READ+WRITE. The user's explicit consent checkbox was reported by the user; the server stores the resulting scope/code rather than a separate checkbox event.
- Access and refresh records were created 19:55:55 with both scopes, exact TEST resource and the same family alias `99d2d3ccb17b`; both were active at verification. The access token's `last_used_at` became 19:56:50. No token, digest, authorization code, state, cookie, email, or full client ID is retained in this report.
- TEST MCP audit: `req-4u` `list_accounts` failed at 19:56:45; `req-4v` `list_campaigns` succeeded at 19:56:47; `req-4w` `list_accounts` succeeded at 19:56:50. The failed call's API log explicitly binds `req-4u` to the new client alias and grant family alias above. Successful audit rows have the same OWNER/workspace aliases, and the new access token was used in the same call sequence. **Audit-schema limit:** success rows do not themselves store OAuth client/grant IDs; the successful-call binding is corroborated by token use and the unique observed sequence, not a direct per-row FK.
- The first failure was **not OAuth, refresh, transport, or Google Ads**: the TEST API logged `PrismaClientKnownRequestError`, and TEST PostgreSQL logged `could not serialize access due to concurrent update` in the same seconds. The exact SQL statement/table was not logged in the redacted application event, so the contended row is unproven. The later reads succeeded. Do not turn this into an automatic retry of a write.
- The previous Claude client population checked before 19:00 retained READ-only access/refresh grants (zero WRITE grants). Production audit has zero matching `req-4u`/`req-4v`/`req-4w` request IDs in this time window, and production API logs have no corresponding error event.

## Fresh TEST baseline and boundaries

- TEST MCP `list_accounts` returns only `8590146099`; the account's provider status is `CLOSED` as expected for this TEST fixture. A provider-backed campaign read returned the three Search campaigns `24324170853`, `24339483523`, `24341802696`, all PAUSED at USD 2/day.
- Provider-backed keyword read returned 20 original ENABLED keywords in the source campaign/group, plus one extra PHRASE PAUSED. The group is PAUSED. Across all three campaigns there are 30 ENABLED and two PAUSED positive keyword rows; the other PAUSED row is the G fixture keyword. Candidate `11743561` is ENABLED in group `206587491811` and campaign `24324170853`.
- TEST DB has exactly one enabled owned provider-account row for `8590146099` in the same workspace. Active unconsumed previews, approved unconsumed previews and in-flight commits are all zero. No Google mutation or approval was performed in this verification.
- Running TEST API image digest `sha256:efcd161ff023e2c67a700a70001206a1c1304fdbdb1c0baa42136d8035b9bdd3` and production API are healthy with zero restarts. Production `/health` and `/ready` returned 200; unauthenticated TEST `/mcp?profile=google_ads_write` returned 401. No deployment or main/production change.

## Next native-client step

Run **R/A only in the real Claude Manual Write connector**: fresh read of keyword `11743561`, a PAUSED status preview with Google `validate_only`, compare BEFORE/AFTER, reread that the keyword remains ENABLED, never call `commit_preview`, then cancel the preview separately in the HolyMedia approval page and retain client/server audit evidence. R/B, R/C and R/M follow sequentially under the existing [plan](qrs-claude-real-read-and-write-plan-20261014.md). Every real commit and restoration still needs its own browser approval; client OAuth consent is not commit approval.

Local targeted PMax/Clone regressions: 3 files, 161/161 tests PASS. Their mandatory LIVE prerequisites and the C partial-failure contract decision remain open; this OAuth verification changes neither result.

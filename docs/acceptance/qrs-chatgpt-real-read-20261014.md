# Q: ChatGPT TEST read — native-client evidence (2026-10-14 local)

**Later update:** Claude's separate TEST grant and two real READ calls are now independently audited. See [dual-client checkpoint and controlled-write plan](qrs-claude-real-read-and-write-plan-20261014.md). The “R not connected” text below records the earlier time of this ChatGPT-only checkpoint, not current status.

Status: **REAL CLIENT READ PASS; Q A/B/C/M INCOMPLETE.** The user reported that the ChatGPT `mcp__Mcp_test__` connector returned exactly the TEST Google Ads account `8590146099` and three PAUSED Search campaigns `24324170853`, `24339483523`, `24341802696`, each at USD 2/day. The server does not persist successful response bodies: exact account/campaign content is user-observed, while the authenticated invocation and success are independently server-audited. No preview or Google Ads mutation was made in this ChatGPT run.

## Sanitized correlation (UTC, 2026-10-13)

| Evidence                  | Observed value                                                                                                                                                             |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OAuth public client       | `ChatGPT`, client-ID MD5 prefix `85be2314b34e`, active                                                                                                                     |
| Authorization transaction | digest prefix `8d0c981083f2`, consumed 19:33:39, PKCE `S256`                                                                                                               |
| Authorization code        | digest prefix `4821d5d46783`, used                                                                                                                                         |
| OAuth access grant        | refresh-family-or-token-ID digest prefix `c93d453dcdf8`, created 19:33:47, active when checked                                                                             |
| Resource / scope          | `https://mcp-test.holymedia.kz/mcp` / `adforge:mcp:read`                                                                                                                   |
| Workspace / principal     | stable nonreversible correlation prefixes `848efb4c952c` / `d5cd2f5de434`, matching both audit rows and OAuth token                                                        |
| `list_accounts`           | TEST `mcp_tool_executed`, request `req-61`, 19:34:08.246, success                                                                                                          |
| `list_campaigns`          | TEST `mcp_tool_executed`, request `req-67`, 19:35:24.721, success                                                                                                          |
| Production in 19:30–19:40 | zero `mcp_tool_executed` audit events; no `tools/call` observed in production API log for the narrower 19:33–19:36 window                                                  |
| TEST runtime              | guarded API image `sha256:35ec81976c82559585188adaf3ddc2ec4b86dd35cc0a2726ffab6866e64d86e7`, source `a84304796ef368c77ced40936d9856da3caad5dd`, healthy, zero restarts/OOM |

The previously misselected production connector was **not** the source of these two new audited calls. This is a correlation of the user-confirmed ChatGPT action with the TEST OAuth client, grant, resource, principal, workspace, request IDs and audit. The server logs do not independently prove the ChatGPT UI identity or retain a response-body fingerprint; do not claim byte-for-byte response verification.

## `providerAccount.status=closed`

The enabled TEST `provider_accounts` row for `8590146099` was discovered on 2026-10-07 and has `status=closed`; the separate TEST MCC row is also `closed` but disabled. A fresh TEST-only provider `get_account_object` read at 19:40:18 UTC returned `status=closed`, USD, and the same TEST account, so the stored status is **not merely a stale local label**. `list_campaigns` still succeeded because read authorization is based on enabled, owned TEST connection plus the TEST allowlist; the code does not equate customer status with read entitlement. The adapter maps Google `Customer.status` to lowercase (`CLOSED` → `closed`) and discovery persists it. [Google's CustomerStatus reference](https://developers.google.com/google-ads/api/reference/rpc/v24/CustomerStatusEnum.CustomerStatus) explicitly says test accounts also have `CLOSED` status. Historical evidence records `test_account=true`; this turn did not re-query that flag. Do not manually change database status or infer that campaign READ implies an enabled/serving customer.

## Next native-client proof

- Q/A: in ChatGPT, create one keyword-pause preview, verify before/after and provider unchanged; no commit. Current TEST write gates must be separately preflighted before preview.
- Q/B: only after a new human browser approval, pause one TEST keyword and separately approve restoration; reread and audit both writes.
- Q/C: only after separate approval, run the 20-keyword batch with one intentionally invalid ID, verify 19 outcomes plus coded error, then separately approve restoration.
- Q/M: verify an unapproved delete/commit is rejected without mutation; do not use a valid approved token for this negative test.
- R: connect Claude to the same TEST MCP origin with a **separate OAuth client/grant**, then real `tools/list`, TEST account/campaign READ and A/B/C/M equivalents. Claude has not connected yet.
- S: for each native client separately preserve client permission (when shown), HolyMedia OAuth consent, browser approval/session/audit, immutable preview digest, exact approved commit, provider reread/journal and separate restoration. Client permission never replaces HolyMedia approval.

At 19:40 UTC, TEST DB had zero new previews and zero preview/approval/commit audit entries since 19:30; the only extra MCP tool was this investigation's read-only `get_account_object`. Direct new provider READ/VALIDATE_ONLY/WRITE by this investigation: **1/0/0**. Production `/health` and `/ready` remained HTTP 200; TEST API/Web and production API/Web/Worker containers were healthy with zero restarts/OOM. Historical 20/20 advertising acceptance remains separate. Q, R, S are **not full LIVE PASS** and release remains **NOT READY**.

Local independent verification on the unchanged runtime-code branch: Q/OAuth guard regressions **65/65 PASS**; PMax/media/Clone **168/168 PASS**. A fresh cache-bypassing Turbo test run completed 15/15 tasks with API **1449 PASS / 21 skipped** (local integration dependencies); do not count skips as PASS. Format, lint, typecheck, build, Prisma validation, standard secret scan **7/7**, and moderate-threshold dependency audit all passed. Windows Application Event 1000 records with `0xC0000005` in the last 12 hours: **0**; historical root cause remains unknown. Exact-HEAD Linux CI for documentation changes must be reported separately from the previously deployed code-image CI.

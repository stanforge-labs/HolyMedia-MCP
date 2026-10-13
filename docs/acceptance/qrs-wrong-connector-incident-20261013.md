# Q read-only incident — wrong ChatGPT connector (2026-10-13)

Status: **Q BLOCKED.** Incident correlation made no Google Ads provider call; after the guard deployment, one bounded TEST provider READ was made. No mutation occurred. This is a sanitized evidence record, not a native-client PASS.

## Correlation (UTC)

| Evidence                                                            | TEST origin                                   | Production origin                                                                      |
| ------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| OAuth resource                                                      | `https://mcp-test.holymedia.kz/mcp`           | `https://mcp.holymedia.kz/mcp/public`                                                  |
| ChatGPT public-client ID fingerprint (MD5 prefix, correlation only) | `85be2314b34e`                                | `24d7587fdfd9`                                                                         |
| Token last used                                                     | 18:21:32                                      | 18:23:17                                                                               |
| API MCP methods                                                     | `server/discover`, `initialize`, `tools/list` | `initialize`, `tools/call`                                                             |
| Successful `mcp_tool_executed` since 18:00                          | 0                                             | Two `list_ad_accounts` at 18:23:04 and 18:23:17, request IDs `req-2ssi` and `req-2ssn` |
| Denied call                                                         | None observed                                 | `list_campaigns` HTTP 403 at 18:23:04, request ID `req-2ssk`                           |

The enabled Google Ads inventory in the production caller's workspace was exactly **64** records: 22 `active`, 32 `canceled`, 10 `closed`. That distribution matches the user's ChatGPT report. The production workspace had no stored `8590146099` account, explaining the denied campaign read. The TEST database had exactly two Google Ads rows, only **one enabled**: `8590146099`, owned by its TEST workspace with a connected provider connection and credential record. It had no enabled non-TEST providerAccount. No production account IDs, names, OAuth tokens, user email, or credential material are stored here.

Conclusion: **the 64-account inventory was not returned by TEST MCP.** ChatGPT used its separate, older production OAuth client/grant for the two inventory calls. TEST authenticated only discovery/initialization/tool listing. The server does not persist successful tool response bodies, so this conclusion is based on request/audit correlation and the exact inventory-count match, not a captured response-body digest. Do not call it a TEST data breach. Production metadata was returned to the authorized production OAuth principal; whether every returned account was intended for that client is outside this TEST incident and requires separate production policy review.

## Containment and hardening

- Pause Q/R/S LIVE calls until the user selects the TEST connector explicitly. Do not revoke production credentials or change production MCP.
- Restricted TEST startup now requires the exact `mcp-test.holymedia.kz` origin and single account `8590146099` even without OWNER binding.
- Restricted TEST MCP forces the Google-only tool profile for private `/mcp`, rejects unprofiled legacy inventory tools and public MCP, validates profile schemas, denies other account IDs/providers before provider access, and filters `list_accounts` by both provider and external account ID. This is a TEST-only guard; production behavior is unchanged.
- TEST read denials receive a sanitized persistent audit entry without argument values.
- The guarded API deployment required exact-code CI/image verification, zero active approvals, resource gates, a TEST rollback point and production health before/after. Those gates passed as recorded below; Q/R/S nevertheless remains paused pending the real-client retest.

## Guarded TEST deployment and read-only smoke (18:45–18:53 UTC)

The source commit `a84304796ef368c77ced40936d9856da3caad5dd` passed the exact-code [Linux foundation workflow](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38449019290) (**1470 passed, 0 skipped**) and [isolated API-image workflow](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38449019293). The non-root acceptance-only image has digest `sha256:35ec81976c82559585188adaf3ddc2ec4b86dd35cc0a2726ffab6866e64d86e7` and exact revision label. No schema migration was needed.

Before replacement: zero pending TEST previews and OAuth authorization transactions; prior image retained; root-only Compose and TEST DB backup saved at `/opt/holymedia-qrs-test/rollback/q-read-incident-20261013T1846Z/` (the database archive passed `pg_restore -l`). The old TEST API was stopped first (`AutoRemove=false`); available RAM then measured **951 MiB**, free swap **1156 MiB**, disk **10902 MiB**, and production health/ready 200. Only `qrs_api` was recreated from the pinned new image; TEST Web, TEST DB/Redis and production containers/images were not replaced. New API `/ready=200`, healthy, zero restarts/OOM. Later RAM available ~750 MiB, swap free 1154 MiB, memory PSI some avg10 0.18%; production health/ready remained 200. The 800 MiB gate was checked **before starting** the replacement, not misrepresented as a post-start requirement.

An existing Codex `mcp-test` connector was first correlated to the **TEST** audit using `get_provider_capabilities`, without Google provider access. Only then were these bounded read checks made through that verified connector:

- `list_accounts({provider: GOOGLE_ADS})` returned exactly one ID, `8590146099`; TEST audit recorded the invocation.
- A request for non-allowlisted MCC `4378327049` was denied with internal HTTP 403 and persisted `mcp_test_tool_denied`, without a provider call. The MCP client wrapper showed a generic error rather than exposing account data.
- One Google provider READ, `list_campaigns(8590146099)` with PAUSED filter, returned three TEST campaign IDs: `24324170853`, `24339483523`, `24341802696`; TEST audit recorded the invocation. No mutation or validate_only call was made.
- Anonymous POST to TEST `/mcp?profile=google_ads_write` returned HTTP 401. Wrong-workspace denial was covered in unit regression only because there is no second TEST workspace to use for a genuine OAuth session.

These checks prove guarded TEST inventory and one provider READ through Codex; they do **not** replace a fresh ChatGPT Q call, Claude R call, or dual-client consent S. Keep Q/R/S **BLOCKED** until the user selects the TEST connector and real native-client calls are separately correlated with TEST audit. The old production connector remains untouched and should not be used for Q.

## Recheck criteria

For a _new ChatGPT Q run_, verify `tools/list` Google-only, `list_accounts(GOOGLE_ADS)` exactly `8590146099`, `list_campaigns(8590146099)` TEST campaigns, and absence of any production inventory. Correlate each call with TEST audit and the TEST OAuth grant; no production `tools/call` should appear in the same window. A real wrong-workspace OAuth test remains pending a separately approved fixture, not fabricated. These are separate from user/client-side consent and later approved write acceptance. No Google Ads write is authorized by this incident work.

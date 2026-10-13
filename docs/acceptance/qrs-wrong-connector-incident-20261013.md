# Q read-only incident — wrong ChatGPT connector (2026-10-13)

Status: **Q BLOCKED; no new Google Ads provider call or mutation during investigation.** This is a sanitized evidence record, not a native-client PASS.

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
- Deploy the guarded API only after exact-code CI/image verification, zero active approvals, resource gates, TEST rollback point and production health before/after. Until then, Q/R/S remains paused even though the current TEST DB inventory is narrow.

## Recheck criteria

With the guarded TEST image and the _TEST_ ChatGPT connector only: `tools/list` Google-only; `list_accounts(GOOGLE_ADS)` exactly `8590146099`; `list_campaigns(8590146099)` actual TEST campaigns; another account denied; wrong workspace denied; anonymous request 401. These are separate from user/client-side consent and later approved write acceptance. No Google Ads write is authorized by this incident work.

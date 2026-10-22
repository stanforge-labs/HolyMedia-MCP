# HolyPilot reviewer demo — public MCP retest boundary

Source matrix: `C:/Users/geros/Проекты Codex/MCP/HOLYPILOT_PUBLIC_MCP_42_TOOL_SELF_TEST_20261022.md` (Claude production run on `6dfda9ff3f218dd62a121655f2038bff5f693f9a`). That run recorded 18 PASS, 6 FAIL, 17 `permission_denied`, and one tool not invoked. The exact historic arguments and results remain in that file.

PR #4 was merged as `4eb8394f8be831589e3e04d18b4c1c4aba288eff` and its standard API-only [deployment succeeded](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39794257719). PR #5, with exact reviewed head `f60cbc96961d08908bf9d55081c54f030b28cd2a`, passed Foundation, Browser E2E and Compose smoke, merged as `6a9fd680a401095faea794e0e815b435e49239f8`, and its standard [API-only deployment succeeded](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39804035113). The matrix records actual calls in the authorized [Claude reviewer chat](https://claude.ai/chat/3c3da1be-f30e-4ef4-a951-b0628612b8e8): 36 safe tools were functionally verified after PR #4, and the five failing synthetic tools were repeated after PR #5. These calls use synthetic data and do not prove Google/Meta/GA4/Search Console LIVE provider access. The owner separately approved one synthetic `run_connection_diagnostics` attempt, but Claude's client-side safety check rejected it before the request reached HolyPilot. No advertising WRITE was executed.

|   # | Public tool                                      | Prior Claude     | New offline synthetic contract                                   | Latest Claude result    |
| --: | ------------------------------------------------ | ---------------- | ---------------------------------------------------------------- | ----------------------- |
|   1 | `list_connected_resources`                       | PASS             | PASS                                                             | PASS — synthetic READ |
|   2 | `list_ad_accounts`                               | PASS             | PASS                                                             | PASS — synthetic READ |
|   3 | `get_account_status`                             | PASS             | PASS                                                             | PASS — synthetic READ |
|   4 | `get_account_summary`                            | PASS             | PASS                                                             | PASS — synthetic READ |
|   5 | `run_connection_diagnostics`                     | NOT CALLED       | Pure synthetic branch prepared, NOT INVOKED                      | BLOCKED — Claude client-side safety check; no MCP result |
|   6 | `list_campaigns`                                 | PASS             | PASS; `statuses` and limit applied                               | PASS — synthetic READ |
|   7 | `get_campaign`                                   | PASS             | PASS                                                             | PASS — synthetic READ |
|   8 | `get_campaign_statuses`                          | PASS             | PASS                                                             | PASS — synthetic READ |
|   9 | `get_basic_metrics`                              | PASS             | PASS                                                             | PASS — synthetic READ |
|  10 | `get_performance_report`                         | PASS             | PASS                                                             | PASS — synthetic READ |
|  11 | `get_spend_overview`                             | PASS             | PASS                                                             | PASS — synthetic READ |
|  12 | `get_status_summary`                             | PASS             | PASS                                                             | PASS — synthetic READ |
|  13 | `get_top_performers`                             | PASS             | PASS; `conversionValue` supported                                | PASS — synthetic READ |
|  14 | `get_campaign_structure`                         | FAIL             | PASS; `campaign_id` selects one row                              | PASS — synthetic READ |
|  15 | `get_google_ads_detailed_report`                 | PASS             | PASS; limit and cursor contract                                  | PASS — synthetic READ |
|  16 | `google_ads_list_keywords`                       | FAIL             | PASS; campaign, ad group, status, spend and date filters         | PASS — PR #5 retest |
|  17 | `google_ads_search_terms`                        | PASS with caveat | PASS; campaign attribution/filter and provider-shaped rows       | PASS — PR #5 retest |
|  18 | `google_ads_list_negatives`                      | PASS with caveat | PASS; provider-shaped campaign negative page                     | PASS — synthetic READ |
|  19 | `google_ads_check_negative_conflicts`            | BLOCKED          | PASS; synthetic text matching only, provider-shaped result       | PASS — synthetic READ |
|  20 | `get_meta_ads_detailed_report`                   | FAIL             | PASS; `since`/`until`, limit and period checked                  | PASS — synthetic READ |
|  21 | `get_meta_oauth_permissions`                     | BLOCKED          | PASS; empty synthetic permission set, no real credential         | PASS — synthetic READ |
|  22 | `get_flexible_insights`                          | BLOCKED          | PASS; synthetic account/campaign level, selected period          | PASS — synthetic READ |
|  23 | `google_analytics_list_properties`               | PASS             | PASS                                                             | PASS — synthetic READ |
|  24 | `google_analytics_get_property`                  | BLOCKED          | PASS; synthetic property metadata                                | PASS — synthetic READ |
|  25 | `google_analytics_run_report`                    | BLOCKED          | PASS for supported dimensions/metrics; advanced filters rejected | PASS — PR #5 retest |
|  26 | `google_analytics_check_compatibility`           | BLOCKED          | PASS for fixture dimensions/metrics                              | PASS — synthetic READ |
|  27 | `google_analytics_traffic_overview`              | FAIL             | PASS; requested dates                                            | PASS — synthetic READ |
|  28 | `google_analytics_acquisition`                   | BLOCKED          | PASS; synthetic report rows                                      | PASS — synthetic READ |
|  29 | `google_analytics_landing_pages`                 | BLOCKED          | PASS; synthetic report rows                                      | PASS — synthetic READ |
|  30 | `google_analytics_pages`                         | BLOCKED          | PASS; synthetic report rows                                      | PASS — synthetic READ |
|  31 | `google_analytics_events`                        | BLOCKED          | PASS; synthetic report rows                                      | PASS — PR #5 retest |
|  32 | `google_analytics_key_events`                    | BLOCKED          | PASS; synthetic report rows                                      | PASS — PR #5 retest |
|  33 | `google_analytics_devices`                       | BLOCKED          | PASS; synthetic report rows                                      | PASS — synthetic READ |
|  34 | `google_analytics_geography`                     | BLOCKED          | PASS; synthetic report rows                                      | PASS — synthetic READ |
|  35 | `google_analytics_realtime`                      | BLOCKED          | PASS; explicitly static synthetic snapshot                       | PASS — synthetic READ |
|  36 | `google_analytics_compare_periods`               | BLOCKED          | PASS; equal implicit period lengths                              | PASS — synthetic READ |
|  37 | `google_analytics_list_google_ads_links`         | BLOCKED          | PASS; empty synthetic links                                      | PASS — synthetic READ |
|  38 | `google_analytics_get_custom_dimensions_metrics` | BLOCKED          | PASS; empty synthetic definitions                                | PASS — synthetic READ |
|  39 | `get_search_console_report`                      | FAIL             | PASS; exact `days`, no property enumeration                      | PASS — synthetic READ |
|  40 | `list_search_console_properties`                 | PASS             | PASS                                                             | PASS — synthetic READ |
|  41 | `compare_periods`                                | PASS with caveat | PASS; unequal periods carry explicit warning                     | PASS — synthetic READ |
|  42 | `generate_monthly_ads_report`                    | FAIL             | PASS; preceding period has equal inclusive days                  | PASS — synthetic READ |

Claude matrix: **41/41 safe tools actually invoked and functionally PASS across the two authorized production runs; diagnostics BLOCKED before MCP**. The initial PR #4 run found five semantic fixture FAIL cases: keyword `all_conversions < conversions` (#16), an EXACT keyword paired with a different search query (#17), fractional daily sessions (#25), `page_view` event count differing from page views (#31), and `page_view` incorrectly returned as a key event (#32). PR #5 corrected these and the five affected calls returned PASS on the current deployed API; no claim is made that the other 36 calls were repeated on PR #5. The six older filter/period defects remained fixed and the 17 previously blocked valid calls returned data or a valid synthetic empty result on PR #4, with no `permission_denied`. Empty synthetic permissions, links and custom definitions do not demonstrate LIVE provider capability. Public WRITE remains denied in the reviewer workspace.

Security boundary: only the server-created `reviewer_demo` entitlement on the fixed active workspace slug activates fixtures; the MCP service requires an OAuth principal, read scope, membership, and an unrestricted workspace grant. All fixture account/property IDs are fixed, foreign IDs fail closed, and the demo branch returns before any provider adapter or credential access. Report entitlement remains required for monthly reports. The diagnostics branch is coded to return synthetic status without provider requests or credential refresh; it has not been confirmed by an actual MCP result because Claude blocked the approved attempt before network execution. The normal production diagnostics behavior and public annotations remain unchanged.

## Actual Claude arguments and evidence

Notation: `G={provider:"GOOGLE_ADS",account_id:"9990000001"}`, `M={provider:"META_ADS",account_id:"act_9990000002"}`, `A={property_id:"999000003"}`, `D={start_date:"2026-10-15",end_date:"2026-10-21"}`, `S={since:"2026-10-15",until:"2026-10-21"}`. `+` means merging these exact JSON fields. Every response carried `realData=false`, `dataStatus="demo"`, and provenance `sourceApi="HolyPilot isolated synthetic reviewer fixture"`. The Claude chat shows the individual tool cards and results.

| Tool numbers | Exact call arguments |
| --- | --- |
| 1, 23, 40 | `{}` |
| 2 | `{provider:"GOOGLE_ADS"}` |
| 3 | `G` |
| 4, 8–12 | `G+D` |
| 6 | `G+D+{statuses:["PAUSED"],limit:5}`; exactly one PAUSED campaign returned |
| 7, 14 | `G+D+{campaign_id:"9991000001"}`; exactly that campaign returned |
| 13, 15 | `G+D+{limit:5}` |
| 16, 17 | `G+S+{campaign_ids:["9991000001"],limit:5}`; campaign filter and period respected; synthetic values inconsistent as above |
| 18 | `G+{campaign_ids:["9991000001"]}`; one campaign negative |
| 19 | `G+{campaign_ids:["9991000001"],negatives:[{text:"demo irrelevant"}]}`; no conflicts |
| 20 | `M+S+{limit:5}`; exactly 7 days, two campaigns |
| 21 | `{account_id:"act_9990000002"}`; synthetic empty permission arrays, no live OAuth check |
| 22 | `M+D+{limit:5}`; account-level synthetic insights |
| 24, 37, 38 | `A`; property metadata or valid synthetic empty links/custom definitions |
| 25 | Initial PR #4 call: `A+D+{dimensions:["date"],metrics:["sessions"],limit:5}`; five of seven date rows; fractional daily sessions caused FAIL. PR #5 retest uses `limit:10`; see below. |
| 26 | `A+{dimensions:["date"],metrics:["sessions"]}`; compatible |
| 27–34 | Initial PR #4 calls: `A+D+{limit:5}`; exact dates, but #31–32 had event semantics FAIL. PR #5 retests are below. |
| 35 | `A+{metrics:["activeUsers"],limit:5}`; static synthetic snapshot, not live realtime |
| 36 | `A+D+{metrics:["sessions"],limit:5}`; prior period 2026-10-08..14, both seven days |
| 39 | `{site_url:"sc-domain:demo.invalid",days:7}`; exact seven completed UTC days |
| 41 | `G+{current_start_date:"2026-10-15",current_end_date:"2026-10-21",previous_start_date:"2026-10-01",previous_end_date:"2026-10-14"}`; unequal 7/14-day warning present |
| 42 | `G+D`; prior period 2026-10-08..14, both seven days |

Negative test: `list_campaigns` with `G` except `account_id="9990000099"`, plus `D` and `limit:5`, returned `permission_denied`, `retryable:false`, no data and no account existence disclosure. That rejection is a security PASS, not a functional PASS for a valid read. No other workspace identity was available in this Claude session; cross-workspace enforcement is also covered by the API tests. MCP Inspector was not used in this run; Claude is the actual authorized client evidence.

## PR #5 production retest — only five affected tools

All five calls were made once in the same authorized Claude reviewer conversation after API deploy `6a9fd680a401095faea794e0e815b435e49239f8`. Claude showed exactly five HolyPilot tool cards, no ToolSearch or sixth tool. Each raw MCP response included `realData:false`, `dataStatus:"demo"` and `provenance.sourceApi:"HolyPilot isolated synthetic reviewer fixture"`.

| Tool | Exact arguments | Raw result and check | Status |
| --- | --- | --- | --- |
| `google_ads_list_keywords` | `G+S+{campaign_ids:["9991000001"],limit:5}` | One EXACT `demo brand` keyword in the selected campaign; period `2026-10-15..21`; `conversions=8`, `all_conversions=8`, `cost=49.56 USD`, `cost_per_conversion=6.2` (two-decimal rounded value). | PASS — synthetic |
| `google_ads_search_terms` | `G+S+{campaign_ids:["9991000001"],limit:5}` | One selected-campaign term; `search_term=triggered_keyword="demo brand"`, EXACT; campaign `9991000001`, ad group `9994000001`; same requested period. | PASS — synthetic |
| `google_analytics_run_report` | `A+D+{dimensions:["date"],metrics:["sessions"],limit:10}` | Seven dated rows, `95,95,95,94,94,94,94` integer sessions; sum and total both `661`. | PASS — synthetic |
| `google_analytics_events` | `A+D+{limit:5}` | `page_view=1074` equals previously observed pageViews; `generate_lead=58`, `scroll=272`; event total `1404`, key events `58`, revenue `991.20 USD`. | PASS — synthetic |
| `google_analytics_key_events` | `A+D+{limit:5}` | Only `generate_lead`; eventCount and keyEvents both `58`; revenue `991.20 USD`. | PASS — synthetic |

Diagnostics attempt: after separate OWNER approval, Claude was asked to make exactly one call with `G`. The Claude tool card was marked **Not executed** by a client-side safety check; Claude reported that the request never reached HolyPilot. There is no HolyPilot error code or response fields (`external_requests`, `credential_refreshed`, provenance) to validate. No retry or alternative client was used. This is **BLOCKED**, not PASS or provider failure.

Submission boundary: the 41 safe tools have actual authorized synthetic Claude results and no outstanding functional FAIL in this matrix. `run_connection_diagnostics` remains BLOCKED at the Claude client before MCP and cannot be marked tested; do not work around the safety refusal or claim a server response. The Connector and Plugin applications remain DRAFT; no legal declarations or Submit were performed. This matrix does not establish LIVE provider access for Meta, GA4 or Search Console.

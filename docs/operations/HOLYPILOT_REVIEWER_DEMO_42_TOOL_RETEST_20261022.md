# HolyPilot reviewer demo — public MCP retest boundary

Source matrix: `C:/Users/geros/Проекты Codex/MCP/HOLYPILOT_PUBLIC_MCP_42_TOOL_SELF_TEST_20261022.md` (Claude production run on `6dfda9ff3f218dd62a121655f2038bff5f693f9a`). That run recorded 18 PASS, 6 FAIL, 17 `permission_denied`, and one tool not invoked. The exact historic arguments and results remain in that file.

This change is **API source only**. The tests below exercise synthetic fixtures locally; they are not a new Claude LIVE result or a Google/Meta/GA4/Search Console LIVE read. `run_connection_diagnostics` has not been invoked; owner permission is still required. No advertising WRITE is executed.

|   # | Public tool                                      | Prior Claude     | New offline synthetic contract                                   | Claude after deploy     |
| --: | ------------------------------------------------ | ---------------- | ---------------------------------------------------------------- | ----------------------- |
|   1 | `list_connected_resources`                       | PASS             | PASS                                                             | PENDING                 |
|   2 | `list_ad_accounts`                               | PASS             | PASS                                                             | PENDING                 |
|   3 | `get_account_status`                             | PASS             | PASS                                                             | PENDING                 |
|   4 | `get_account_summary`                            | PASS             | PASS                                                             | PENDING                 |
|   5 | `run_connection_diagnostics`                     | NOT CALLED       | Pure synthetic branch prepared, NOT INVOKED                      | OWNER APPROVAL REQUIRED |
|   6 | `list_campaigns`                                 | PASS             | PASS; `statuses` and limit applied                               | PENDING                 |
|   7 | `get_campaign`                                   | PASS             | PASS                                                             | PENDING                 |
|   8 | `get_campaign_statuses`                          | PASS             | PASS                                                             | PENDING                 |
|   9 | `get_basic_metrics`                              | PASS             | PASS                                                             | PENDING                 |
|  10 | `get_performance_report`                         | PASS             | PASS                                                             | PENDING                 |
|  11 | `get_spend_overview`                             | PASS             | PASS                                                             | PENDING                 |
|  12 | `get_status_summary`                             | PASS             | PASS                                                             | PENDING                 |
|  13 | `get_top_performers`                             | PASS             | PASS; `conversionValue` supported                                | PENDING                 |
|  14 | `get_campaign_structure`                         | FAIL             | PASS; `campaign_id` selects one row                              | PENDING                 |
|  15 | `get_google_ads_detailed_report`                 | PASS             | PASS; limit and cursor contract                                  | PENDING                 |
|  16 | `google_ads_list_keywords`                       | FAIL             | PASS; campaign, ad group, status, spend and date filters         | PENDING                 |
|  17 | `google_ads_search_terms`                        | PASS with caveat | PASS; campaign attribution/filter and provider-shaped rows       | PENDING                 |
|  18 | `google_ads_list_negatives`                      | PASS with caveat | PASS; provider-shaped campaign negative page                     | PENDING                 |
|  19 | `google_ads_check_negative_conflicts`            | BLOCKED          | PASS; synthetic text matching only, provider-shaped result       | PENDING                 |
|  20 | `get_meta_ads_detailed_report`                   | FAIL             | PASS; `since`/`until`, limit and period checked                  | PENDING                 |
|  21 | `get_meta_oauth_permissions`                     | BLOCKED          | PASS; empty synthetic permission set, no real credential         | PENDING                 |
|  22 | `get_flexible_insights`                          | BLOCKED          | PASS; synthetic account/campaign level, selected period          | PENDING                 |
|  23 | `google_analytics_list_properties`               | PASS             | PASS                                                             | PENDING                 |
|  24 | `google_analytics_get_property`                  | BLOCKED          | PASS; synthetic property metadata                                | PENDING                 |
|  25 | `google_analytics_run_report`                    | BLOCKED          | PASS for supported dimensions/metrics; advanced filters rejected | PENDING                 |
|  26 | `google_analytics_check_compatibility`           | BLOCKED          | PASS for fixture dimensions/metrics                              | PENDING                 |
|  27 | `google_analytics_traffic_overview`              | FAIL             | PASS; requested dates                                            | PENDING                 |
|  28 | `google_analytics_acquisition`                   | BLOCKED          | PASS; synthetic report rows                                      | PENDING                 |
|  29 | `google_analytics_landing_pages`                 | BLOCKED          | PASS; synthetic report rows                                      | PENDING                 |
|  30 | `google_analytics_pages`                         | BLOCKED          | PASS; synthetic report rows                                      | PENDING                 |
|  31 | `google_analytics_events`                        | BLOCKED          | PASS; synthetic report rows                                      | PENDING                 |
|  32 | `google_analytics_key_events`                    | BLOCKED          | PASS; synthetic report rows                                      | PENDING                 |
|  33 | `google_analytics_devices`                       | BLOCKED          | PASS; synthetic report rows                                      | PENDING                 |
|  34 | `google_analytics_geography`                     | BLOCKED          | PASS; synthetic report rows                                      | PENDING                 |
|  35 | `google_analytics_realtime`                      | BLOCKED          | PASS; explicitly static synthetic snapshot                       | PENDING                 |
|  36 | `google_analytics_compare_periods`               | BLOCKED          | PASS; equal implicit period lengths                              | PENDING                 |
|  37 | `google_analytics_list_google_ads_links`         | BLOCKED          | PASS; empty synthetic links                                      | PENDING                 |
|  38 | `google_analytics_get_custom_dimensions_metrics` | BLOCKED          | PASS; empty synthetic definitions                                | PENDING                 |
|  39 | `get_search_console_report`                      | FAIL             | PASS; exact `days`, no property enumeration                      | PENDING                 |
|  40 | `list_search_console_properties`                 | PASS             | PASS                                                             | PENDING                 |
|  41 | `compare_periods`                                | PASS with caveat | PASS; unequal periods carry explicit warning                     | PENDING                 |
|  42 | `generate_monthly_ads_report`                    | FAIL             | PASS; preceding period has equal inclusive days                  | PENDING                 |

Offline matrix: **41 safe READ handlers exercised**, 41 returned synthetic-marked results; diagnostics remained uncalled. The 17 previous `permission_denied` cases now have isolated fixture branches, subject to production deployment and authorized Claude retest. Empty synthetic permissions, links and custom definitions demonstrate valid empty results, not LIVE provider capability. Public WRITE remains denied in the reviewer workspace.

Security boundary: only the server-created `reviewer_demo` entitlement on the fixed active workspace slug activates fixtures; the MCP service requires an OAuth principal, read scope, membership, and an unrestricted workspace grant. All fixture account/property IDs are fixed, foreign IDs fail closed, and the demo branch returns before any provider adapter or credential access. Report entitlement remains required for monthly reports. The diagnostics branch returns synthetic status without provider requests or credential refresh, but it must not be called through MCP until the owner separately permits that check. The normal production diagnostics behavior and public annotations remain unchanged.

Next gates: GitHub Foundation, Browser E2E and Compose smoke; then owner approval for merge/API-only deployment. Only after deployment can Claude or an authorized MCP Inspector retest the new version. Keep both Anthropic applications DRAFT.

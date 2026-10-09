# Google Ads Write Stage 2 advanced profile

Engineering status (2026-10-09): typed implementation + mock regression. **Not live acceptance and not production release approval.** Real external provider calls/writes in this package: **0/0**. Main and the Stage 0+1 release candidate remain unchanged.

The existing Stage 2 bid/budget foundation is reused rather than replaced. The private MCP tools use the same preview, Google validation-only, browser human approval, immutable commit, account allowlist, stale snapshot, provider reread, audit/journal and rollback service. The independent `PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED` feature gate stays OFF by default. No public write exposure or parallel approval architecture is added.

## Typed entry points

- `google_ads_strategy_modifier_preview`: explicit `provider=GOOGLE_ADS`, `account_id`, 1–500 typed rows.
- `google_ads_bulk_bid_budget_preview`: explicit provider/account; campaign IDs, field, bounded date interval, closed performance filters, absolute/percent change and `max_items`.
- Both tools return preview only. Existing immutable commit accepts only its stored preview contract; caller cannot replace names, schemes, references, bids or selections.

Strategy/modifier row operations:

| Operation           | Required typed fields                                                            | Effect                                                                                   |
| ------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `campaign_strategy` | campaign_id, strategy                                                            | Switch/update one standard Search scheme; status/network/goal collection unchanged       |
| `portfolio_create`  | name, strategy                                                                   | New independent portfolio with no attached campaigns                                     |
| `portfolio_update`  | strategy_id, strategy                                                            | Update existing supported portfolio parameters, same scheme type, shared consumer impact |
| `portfolio_attach`  | campaign_id, strategy_id                                                         | Change only campaign bidding_strategy reference                                          |
| `portfolio_detach`  | campaign_id, strategy                                                            | Explicit replacement standard scheme; no hidden budget/status changes                    |
| `modifier`          | campaign_id, criterion_id, criterion_type, multiplier; ad_group_id for audiences | Update only existing positive criterion bid_modifier                                     |

All input object schemas are closed. Resource names, raw micros, arbitrary Google payloads and update masks are not accepted from the caller. IDs must be numeric strings; duplicate/resolved duplicate resources or foreign ownership fail the whole batch. Missing/no-op/unsupported rows carry a structured `source=HOLYMEDIA` error and are not represented as Google errors; if every row fails, no preview/validation request is created.

### Standard strategies

| Brief type              | Google v24 scheme       | Typed parameters                                                                   |
| ----------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| MANUAL_CPC              | manual_cpc              | enhanced CPC always false; no unsupported EnhancedCpc creation                     |
| MAXIMIZE_CLICKS         | target_spend            | optional cpc_ceiling                                                               |
| MAXIMIZE_CONVERSIONS    | maximize_conversions    | optional target_cpa; portfolio-only cpc_floor/cpc_ceiling                          |
| TARGET_CPA              | target_cpa              | required target_cpa; portfolio-only cpc_floor/cpc_ceiling                          |
| TARGET_ROAS             | target_roas             | required target_roas decimal ratio 0.01–1000; portfolio-only cpc_floor/cpc_ceiling |
| TARGET_IMPRESSION_SHARE | target_impression_share | location, share_percent (>0 through 100; max 4 decimals), required cpc_ceiling     |

Money input is `{amount: decimal_string, currency: ISO4217}` in normal account currency. Foundation `currencyMicros` conversion is reused; no FX is performed. Impression fraction uses exact integer micros, no silent precision truncation. CPC floor cannot exceed ceiling.

Existing campaigns must be non-removed SEARCH. Conversion-based schemes require an existing biddable campaign conversion goal; the preview does **not** create/enable goals and does **not** fabricate recent conversion health. It warns that the launch checklist remains required. Learning and ineffective keyword-CPC warnings are visible. No implicit campaign, ad group or ad status change.

Portfolio strategies must be ENABLED, owned by the same serving account and use the same effective currency. Manual CPC is not a v24 portfolio scheme. Portfolio type replacement, cross-account manager portfolio use and implicit aligned-budget changes are rejected. For aligned portfolios the campaign must already use the required budget. Consumer inventory is bounded, frozen and shown with campaign identities/names; conversion goals are checked for affected Search consumers. Optional parameters not supplied in a same-scheme update are preserved, not silently cleared. Explicit parameter clearing is not implemented and is reported as such.

### Modifiers

Supported: existing campaign DEVICE, LOCATION and AD_SCHEDULE criteria; existing ad-group USER_LIST/USER_INTEREST audience criteria. Only **standard MANUAL_CPC** compatibility is currently accepted. Automated/portfolio combinations are explicitly rejected rather than pretending an ignored modifier is effective. Campaign DEVICE supports multiplier 0 (explicit exclusion) or 0.1–10; other supported criteria use 0.1–10. Negative/removed/type-mismatched criteria cannot receive positive modifiers.

Schedule preview includes account timezone. The operation changes only `bid_modifier`; schedule intervals, nearby criteria, audience mode and entire targeting collections are not overwritten. Ad-group device modifiers (separate AdGroupBidModifier resource), hotel modifiers and other audience kinds are explicit remaining capabilities, not claimed implemented.

### Bulk selection

Fields: keyword_cpc, ad_group_cpc, ad_group_target_cpa, campaign_daily_budget. Filters: clicks, impressions, conversions, cost_micros with LT/LTE/GT/GTE/EQ and decimal-string values. Date range is explicit YYYY-MM-DD, up to 367 calendar days; 1–100 campaign IDs, 1–8 filters, max_items 1–500. Metrics are aggregated by entity for the date interval; no arbitrary GAQL supplied by the caller.

No truncation: inventory >5000 or selected items >max_items fails. Filter response IDs are bound to exact customer/resource/parent identity. Selection and performance snapshot are frozen in the immutable preview. Commit uses those IDs, not a fresh filter that could select different objects; changed relevant snapshots require a new preview. Foundation performs money/bid validation, >50% and automated-CPC warnings, shared-budget association/consumer impact, per-row errors and exact reread.

Stage 1/2 independent operations use **partial_failure=true**. Stage 0 atomic creation remains **partial_failure=false**. Portfolio creation is a resource-heavy creation with no automatic delete inverse.

## Inverse contract

Only exact typed reversals are advertised. Previously explicit amounts/modifiers and supported previous strategy schemes can produce a new inverse preview, requiring a fresh human approval and stale check. There is no automatic mutation, retry or raw cleanup. An inherited/absent prior override that would require an unimplemented explicit clear has no inverse. Creating a portfolio has no automatic delete rollback. A full-plan inverse must only run after every original operation has VERIFIED; partial/unknown results must not replay an inverse across unapplied rows. Foundation successful-row rollback remains unchanged.

## Evidence and tests

- Advanced standalone mock suite: 67 tests PASS; includes strategy payload/field masks, goal guards, shared portfolio impact, modifiers, bulk security/per-row failures, exact inverse intent and provider reread.
- Existing Stage 2 foundation suite: 42 tests PASS; combined 109 PASS. With existing Stage 0 and Stage 1 integration regressions: 174 PASS / 0 skipped. Acceptance equivalents G/H/N are mock/disposable, not live.
- No migration. Targeted format/lint, API typecheck/build and standard secret scan are required before commit/integration. Root integration adds stock controlled-flow approval/expired/consumed/stale/audit transport regressions.
- Live Stage 2 acceptance remains pending explicit user authorization and human approvals; Q/R client acceptance remains independent BLOCKED until actual clients are connected.

## API v24 primary references

- [Campaign bidding oneof](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/campaign.proto)
- [Portfolio BiddingStrategy schemes and ownership/currency semantics](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/bidding_strategy.proto)
- [Bidding parameter definitions](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/common/bidding.proto)
- [CampaignCriterion modifier bounds and immutable criteria](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/campaign_criterion.proto)
- [AdGroupCriterion audience bid_modifier](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/ad_group_criterion.proto)
- [Leaf field masks and empty scheme clearing](https://developers.google.com/google-ads/api/docs/client-libs/php/fieldmasks)

## Remaining scope / honest boundaries

Stage 2 is not declared universally complete: explicit clearing of inherited strategy parameters, manager-owned cross-account portfolios, non-Search channel matrix, ad-group device/hotel modifiers and non-listed audience modifier types remain unsupported. Creation, new portfolio attachment and every bid change still need real TEST acceptance after a separate approval; mock success does not replace provider acceptance. Stage 3 and Stage 4 are independent packages, not silently folded into this implementation.

# Google Ads Write Stage 2 advanced profile

Engineering status (2026-10-09): typed implementation + mock regression. **Not live acceptance and not production release approval.** Real external provider calls/writes in this package: **0/0**. Main and the Stage 0+1 release candidate remain unchanged.

The original PPC DOCX was recovered and read-only checked on 2026-10-09: SHA256 `51C94D3D2953B32821DC872822147B1FF6C28E36258211D9DDD916BFF2C30DB0`. Stage 2 paragraphs 165–193 require both CampaignCriterion and AdGroupBidModifier device adjustments, strategy parameters/portfolios and the CPA < 3 USD bulk example. Reading the source does not authorize live provider writes.

The existing Stage 2 bid/budget foundation is reused rather than replaced. The private MCP tools use the same preview, Google validation-only, browser human approval, immutable commit, account allowlist, stale snapshot, provider reread, audit/journal and rollback service. The independent `PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED` feature gate stays OFF by default. No public write exposure or parallel approval architecture is added.

## Typed entry points

- `google_ads_strategy_modifier_preview`: explicit `provider=GOOGLE_ADS`, `account_id`, 1–500 typed rows.
- `google_ads_bulk_bid_budget_preview`: explicit provider/account; campaign IDs, field, bounded date interval, closed performance filters, absolute/percent change and `max_items`.
- Both tools return preview only. Existing immutable commit accepts only its stored preview contract; caller cannot replace names, schemes, references, bids or selections.

Strategy/modifier row operations:

| Operation                  | Required typed fields                                                            | Effect                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `campaign_strategy`        | campaign_id, strategy                                                            | Switch/update one standard Search scheme; status/network/goal collection unchanged       |
| `portfolio_create`         | name, strategy                                                                   | New independent portfolio with no attached campaigns                                     |
| `portfolio_update`         | strategy_id, strategy                                                            | Update existing supported portfolio parameters, same scheme type, shared consumer impact |
| `portfolio_attach`         | campaign_id, strategy_id                                                         | Change only campaign bidding_strategy reference                                          |
| `portfolio_detach`         | campaign_id, strategy                                                            | Explicit replacement standard scheme; no hidden budget/status changes                    |
| `modifier`                 | campaign_id, criterion_id, criterion_type, multiplier; ad_group_id for audiences | Update only existing positive criterion bid_modifier                                     |
| `ad_group_device_modifier` | campaign_id, ad_group_id, device, multiplier                                     | Resolve device inventory; create local override or update existing AD_GROUP modifier     |

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

Portfolio strategies must be ENABLED, owned by the same serving account and use the same effective currency. Manual CPC is not a v24 portfolio scheme. Portfolio type replacement, cross-account manager portfolio use and implicit aligned-budget changes are rejected. For aligned portfolios the campaign must already use the required budget. Consumer inventory is bounded, frozen and shown with campaign identities/names; conversion goals are checked for affected Search consumers. Optional parameters not supplied in a same-scheme update are preserved, not silently cleared.

Typed `strategy.clear_fields` supports Maximize Clicks `cpc_ceiling`, Maximize Conversions `target_cpa`, and applicable portfolio `cpc_floor`/`cpc_ceiling`. Only optional fields are clearable: required Target CPA/ROAS goals and Target Impression Share ceiling cannot be cleared. Set+clear duplicates, arbitrary names and clears on creation reject. Clears send exact leaf masks with string `"0"`, preserve neighboring parameters and validate new floor against any preserved ceiling. Inverses restore old explicit amounts; setting a previously unset optional field records an explicit typed clear inverse. Reread accepts omitted protobuf zero only for these known optional paths with independent proof of the matching strategy type; wrong type or nonzero value still fails verification.

### Modifiers

Supported: existing campaign DEVICE, LOCATION and AD_SCHEDULE criteria; existing ad-group USER_LIST/USER_INTEREST audience criteria; separate AdGroupBidModifier DEVICE create/update. MANUAL_CPC and MAXIMIZE_CLICKS support the listed modifiers. TARGET_CPA supports device modifiers with an explicit warning that the adjustment affects the CPA target, not keyword CPC. Maximize Conversions, Target ROAS, Maximize Conversion Value and Target Impression Share accept only device exclusion 0 or neutral eligibility restore 1; other ignored adjustments reject. Portfolio ownership and effective type must be proven. DEVICE accepts 0 (-100% opt-out) or 0.1–10 (-90% through +900%); unsupported intermediate values such as -99% reject. Other supported criteria use 0.1–10. Negative/removed/type-mismatched criteria reject.

Audience modifiers require explicit parent `targetRestrictions[AUDIENCE].bidOnly=true`: OBSERVATION appears in preview, TARGETING/unknown rejects, mode is never changed. USER_INTEREST reread uses v24 `user_interest.user_interest_category`. Schedule preview includes account timezone; only `bid_modifier` changes, not intervals or targeting collections.

Ad-group device preview proves account/campaign/group/device identity and freezes group inventory plus same-device campaign criteria. An absent local modifier or CAMPAIGN-sourced inherited row uses CREATE of `{adGroup, device: {type}, bidModifier}`; a proven AD_GROUP row uses UPDATE with only `bid_modifier`. The inherited effective BEFORE is shown, never mislabelled local or updated as a virtual resource. Unknown/ambiguous source rejects. Existing local override can carry a typed inverse; creation does not promise automatic deletion or restoration of inheritance. A campaign -100% exclusion remains authoritative and is prominently warned, not silently enabled by a group override. Hotel and unlisted audience modifier types are outside this Search profile.

### Bulk selection

Fields: keyword_cpc, ad_group_cpc, ad_group_target_cpa, campaign_daily_budget. Filters: clicks, impressions, conversions, cost_micros, plus typed `cpa` with LT/LTE/GT/GTE/EQ and decimal-string values. CPA requires explicit account currency, e.g. `{ "metric": "cpa", "operator": "LT", "value": "3", "currency": "USD" }`, followed by a +10% change. No FX conversion. CPA compares account-currency cost_micros / attributed conversions by exact decimal cross-products; zero/negative conversions do not become zero CPA. Fractional/scientific attribution is parsed with bounded exact precision. Google returns bounded raw metrics; no imaginary `metrics.cpa` GAQL field is generated. All raw row ownership/duplicates are checked before local CPA exclusion, so an excluded foreign-account row cannot bypass guards. Date range is explicit YYYY-MM-DD, up to 367 calendar days; 1–100 campaign IDs, 1–8 filters, max_items 1–500. Metrics are aggregated by entity; no arbitrary GAQL supplied by the caller.

No truncation: inventory >5000 or selected items >max_items fails. Filter response IDs are bound to exact customer/resource/parent identity. Selection and performance snapshot are frozen in the immutable preview. Commit uses those IDs, not a fresh filter that could select different objects; changed relevant snapshots require a new preview. Foundation performs money/bid validation, >50% and automated-CPC warnings, shared-budget association/consumer impact, per-row errors and exact reread.

Stage 1/2 independent operations use **partial_failure=true**. Stage 0 atomic creation remains **partial_failure=false**. Portfolio creation is a resource-heavy creation with no automatic delete inverse.

## Inverse contract

Only exact typed reversals are advertised. Previously explicit amounts/local modifiers and supported previous strategy schemes can produce a new inverse preview, requiring fresh human approval and stale check. Optional strategy parameter clears have explicit typed inverses as described above. There is no automatic mutation, retry or raw cleanup. Creating a portfolio or a local device override has no automatic delete/inheritance-restoration rollback. A full-plan inverse must only run after every original operation has VERIFIED; partial/unknown results must not replay an inverse across unapplied rows. Foundation successful-row rollback remains unchanged.

## Evidence and tests

- Advanced standalone mock suite: 109 tests PASS, including strategy payload/field masks/optional clears, zero-default type proof, goal guards, shared portfolio impact, campaign/group device modifiers including inheritance, OBSERVATION enforcement, exact CPA filters, ownership/per-row failures, truthful inverse and provider reread. No mock test is claimed live.
- Existing Stage 2 foundation suite: 44 tests PASS. With Stage 0 and Stage 1 regressions, the targeted run is 218 PASS / 0 skipped. Acceptance equivalents G/H/N are mock/disposable, not live.
- No migration. Targeted format/lint, API typecheck/build and standard secret scan are required before commit/integration. Root integration adds stock controlled-flow approval/expired/consumed/stale/audit transport regressions.
- Live Stage 2 acceptance remains pending explicit user authorization and human approvals; Q/R client acceptance remains independent BLOCKED until actual clients are connected.

## API v24 primary references

- [Campaign bidding oneof](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/campaign.proto)
- [Portfolio BiddingStrategy schemes and ownership/currency semantics](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/bidding_strategy.proto)
- [Bidding parameter definitions](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/common/bidding.proto)
- [CampaignCriterion modifier bounds and immutable criteria](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/campaign_criterion.proto)
- [AdGroupCriterion audience bid_modifier](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/ad_group_criterion.proto)
- [AdGroupBidModifier device, range and output-only source](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/ad_group_bid_modifier.proto)
- [BidModifierSource inheritance versus local override](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/enums/bid_modifier_source.proto)
- [Google device adjustment strategy compatibility](https://support.google.com/google-ads/answer/2732132?hl=en)
- [Official CREATE ad-group device example](https://developers.google.com/google-ads/api/docs/campaigns/bidding/manage-bid-modifiers)
- [v24 cost/conversion metric definitions](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/common/metrics.proto)
- [Leaf field masks and empty scheme clearing](https://developers.google.com/google-ads/api/docs/client-libs/php/fieldmasks)

## Remaining scope / honest boundaries

The original required Search profile is implemented and mock-tested, not universally live accepted. Manager-owned cross-account portfolios, non-Search channel matrix, hotel modifiers and non-listed audience modifier types remain unsupported. Required strategy goals are not arbitrarily clearable; optional supported parameters are. Creation, new portfolio attachment and every bid change still need real TEST acceptance after separate approval; mock success does not replace provider acceptance. Stage 3 and Stage 4 are independent packages, not silently folded into this implementation. Historical JSON evidence is a dated snapshot and remains untouched.

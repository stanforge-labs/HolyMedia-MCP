# Google Ads: bounded rollback inherited keyword CPC

Original PPC source P39 / Acceptance N requires reversible bid changes to return to the recorded BEFORE state through a **new** controlled preview. This includes removing a keyword CPC override when the provider proves that BEFORE inherited the ad group bid. It does not authorize a public arbitrary parameter-clear API, cross-account operations, or any live mutation in this implementation package.

## Supported profile

- Positive keyword CPC writes remain absolute or percentage decimal account currency, with the authoritative `currency_constant.billable_unit_micros`. Percent changes still require a positive **explicit** BEFORE override; the effective inherited bid is not substituted as the percent base.
- A standard `SEARCH` / `MANUAL_CPC` campaign with no portfolio strategy can record inherited BEFORE only if the actual keyword has absent/zero `cpc_bid_micros`, `effective_cpc_bid_source = AD_GROUP`, and a positive `effective_cpc_bid_micros` exactly matching a separately read owned parent group's explicit CPC.
- Fresh account/currency, campaign/strategy, keyword identity and neighbors, parent group identity/CPC/status, and currency constant are frozen in the immutable plan and existing stale checks.
- `preview_rollback_commit` may derive the internal typed `bid_budget_inherited_rollback` intent from an eligible recorded successful operation. A new preview, Google validation, human approval, immutable commit, reread, and journal are still required.
- The provider inverse writes only `update: { resourceName }` plus exact `updateMask: cpc_bid_micros`. The optional CPC field is omitted; no zero/null bid, effective/source output field, parent bid, keyword status, text, or neighbor field is written.
- Expected inherited reread contains canonical CPC `"0"`, `AD_GROUP` source, and the frozen positive parent effective CPC. Raw absent/numeric-zero/string-zero is normalized **only** when actual source/effective match this proof. All other fields and parent context must still match. A wrong explicit override, source, effective value, text, status, resource, parent, or currency context is not verified.
- An inverse of the clear can restore the recorded explicit amount through a normal positive preview. Existing unaligned positive values are rejected for exact rollback rather than silently rounded.
- Advanced bulk inverses preserve each row's typed inherited proof alongside explicit positive inverse rows. A missing source/parent proof means no bounded inverse is promised; it is never replaced by a guessed effective bid.

## Deliberate boundaries

Public Stage 2 / bulk tools retain closed absolute/percent schemas; clients cannot request `inherit`, submit a clear mask, or replace a provider payload. This internal action is not a new client-facing tool. Unknown/unspecified/campaign-strategy source, unproven parent, automated/portfolio inheritance, and missing raw/source evidence do not mint an inherited inverse. Automated/portfolio positive CPC updates retain the existing warning; dynamic effective output fields are not mistaken for an explicit keyword result and are not used as rollback proof.

This is source + mock evidence, not live Google TEST acceptance. Feature gates, account allowlist, owner/session/approval guards, stale protection, per-row results, and `partial_failure=true` remain in the existing controlled flow. No migration, production change, or provider call is required for this package. Acceptance N for positive ad group CPC `0.10 → 0.11 USD` is unchanged.

## Primary API references

- [Set and remove bids](https://developers.google.com/google-ads/api/docs/campaigns/bidding/set-bids#remove_bids): supported `AdGroupCriterion.cpc_bid_micros` removal uses an unset optional field and an explicit update mask.
- [Google Ads v24 criterion proto](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/ad_group_criterion.proto): CPC optional int64; `effective_cpc_bid_micros` and `effective_cpc_bid_source` are output-only.
- [Google Ads v24 bidding source enum](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/enums/bidding_source.proto): distinguishes `AD_GROUP`, `AD_GROUP_CRITERION`, and `CAMPAIGN_BIDDING_STRATEGY`.
- [v24 criterion GAQL fields](https://developers.google.com/google-ads/api/fields/v24/ad_group_criterion): the actual selectable source is `effective_cpc_bid_source`, not `cpc_bid_source`.
- [Field masks / clearing fields](https://developers.google.com/google-ads/api/docs/client-libs/dotnet/field-masks): explicit masks are needed when the desired optional field is unset.

## Regression evidence

`google-ads-stage2-inherited.test.ts` covers inherited absent/zero → explicit → omitted-field inverse → explicit restore; public clear rejection; unknown/false source; mismatched parent; percentage inherited rejection; parent/strategy/currency/stale/security guards; strict reread mismatch; auto bidding warning; exact N group payload; authoritative rounding and non-rounded rollback; mixed bulk inherited/explicit inverse preservation. Existing foundation lifecycle tests verify normal approval, immutable commit, audit, consumed/expired/stale guards and provider errors.

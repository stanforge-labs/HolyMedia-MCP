# G / H / I / J / PMax prerequisite and recovery checkpoint

Source baseline: `c41ab30040cb42aa7c3b56aeb4cbb10ddf3d2f04`. This document and its schema/mock tests execute **zero provider calls**. Every setup below is a proposal, not authority to mutate or create missing resources. No runtime changes, VPS calls, public endpoint, raw mutation, automatic retries, self-approval, cleanup or production/main changes are part of this package.

## Verified evidence versus missing LIVE gates

| Profile                | Evidence actually available                                                                                                                                             | Still not proved                                                                                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G, original P288–291   | `eligibility-recovery-20261010.json`: 0 observed paused automatic SEARCH campaigns                                                                                      | +10% explicit keyword CPC under actual auto bidding; warning, approved commit and restoration                                                                                         |
| H, P292–295            | `H-warning-only-20261010.json`: 23 READ / 1 validate-only / 0 real write; non-shared 2→3.2 USD warning and unchanged provider budget, no preview/approval/journal added | Full controlled update/rollback; shared impact is MOCK only, conditional on a real shared budget                                                                                      |
| I, P194–206 / P296–299 | IN_MARKET 500-row bound; AFFINITY 190 rows exhausted; globally launched boolean-filter rows 0; user lists 0                                                             | Actual eligible OBSERVATION add/remove, not absence of eligible catalog. Old Search/global-locale diagnostic used wrong enums and must not be used as a definitive availability count |
| J, P213–225 / P300–303 | Actual Astana City ID `1009806`; direct parent district rows 0; existing provider proximity centers 0                                                                   | Eligible district/exclusion and legitimate real radius center; name-resolution + provider reread of all 3 newly created criteria                                                      |
| PMax                   | Existing same-account enabled conversion actions and usable images/logos not proved                                                                                     | Actual owned conversion action, authorized decoded media, reviewed business identity, atomic provider validation/create and complete reread                                           |

All current artifacts preserve historical Stage0/1 acceptance; they do not imply new G/H/I/J/PMax LIVE PASS. H >50% warning is a real validation diagnostic but not an approved update. Both original TEST campaigns remain PAUSED in the cited observations; fresh TEST/hierarchy/status/currency/allowlist proof is required again before future previews.

## G — preferred existing-resource route

First try bounded READ discovery of an already eligible PAUSED automatic SEARCH campaign and its owned positive keyword with explicit raw CPC. With such proof G needs **2 new approvals**: the +10% commit and its separate verified rollback. Dynamic effective CPC/source is not used as the percentage basis.

Current inventory has no such campaign. A separately authorized setup on the existing paused fixture can avoid creating resources:

1. While still standard MANUAL_CPC, use `google_ads_bid_budget_preview`:

   ```json
   {
     "provider": "GOOGLE_ADS",
     "account_id": "8590146099",
     "items": [
       {
         "field": "keyword_cpc",
         "campaign_id": "24324170853",
         "ad_group_id": "206587491811",
         "criterion_id": "11743561",
         "change": { "mode": "absolute", "amount": "0.10", "currency": "USD" }
       }
     ]
   }
   ```

   Only if fresh BEFORE is inherited absent/zero with actual AD_GROUP source/effective CPC and parent CPC proof does the server record a bounded inherited inverse. Existing explicit CPC is not overwritten merely to fit this plan. Mask: `cpc_bid_micros`; fixture status/text/match type remain unchanged.

2. Use `google_ads_strategy_modifier_preview` to set the existing paused SEARCH campaign to a non-conversion automatic strategy:

   ```json
   {
     "provider": "GOOGLE_ADS",
     "account_id": "8590146099",
     "items": [
       {
         "operation": "campaign_strategy",
         "campaign_id": "24324170853",
         "strategy": {
           "type": "MAXIMIZE_CLICKS",
           "cpc_ceiling": { "amount": "1.00", "currency": "USD" }
         }
       }
     ]
   }
   ```

   This maps to provider `TARGET_SPEND`, mask `target_spend.cpc_bid_ceiling_micros`, preserving status/budget/targeting. The 1 USD ceiling is proposed safety input requiring human review, not an observed provider value. No conversion action or conversion-history workaround is needed for this strategy. Do not substitute a conversion strategy when its goal guard blocks it.

3. Fresh auto/positive explicit CPC proof, then G `google_ads_bid_budget_preview` with the same identity and `change:{"mode":"percent","percent":"10","currency":"USD"}`. Expected raw CPC uses the authoritative USD billable unit; the mandatory warning says Google automatic bidding may ignore the manual override. Mask stays `cpc_bid_micros`.
4. Use `preview_rollback_commit` with **the verified G commit_id**, a new persisted manual approval, immutable commit and reread to return the raw override to its pre-G value.
5. Roll back the verified strategy-setup commit with its own fresh preview/approval. Original MANUAL_CPC inverse mask is `manual_cpc.enhanced_cpc_enabled`; no arbitrary restoration of guessed oneof fields.
6. Only after actual MANUAL_CPC/parent proof is restored, roll back the initial keyword-override setup commit. The server-recorded inherited inverse sends only the resource identity with exact `cpc_bid_micros` mask, verifying actual AD_GROUP source/effective value. No public arbitrary-clear input is introduced.

This inherited-baseline setup/test/recovery route needs **6 separate approvals**, not one broad consent: override setup, strategy setup, G, G rollback, strategy rollback, override rollback. If the original keyword was already explicit, skip initial override/its rollback: **4 approvals**. Never reuse preview/commit IDs or attempt automatic compensation after ambiguity. All campaign/group/RSA statuses remain PAUSED; all 20 original keyword statuses remain ENABLED. No setup is authorized by this document.

## H — true shared budget impact, no disguised coverage

The exact existing diagnostic request is `google_ads_bid_budget_preview`, campaign `24324170853`, `field:"campaign_daily_budget"`, `change:{"mode":"percent","percent":"60","currency":"USD"}`. Mask: `amount_micros`; with current 2 USD non-shared budget expected amount is 3.2 USD. A full controlled update/rollback needs **2 approvals**. Before both commits reread exact budget, billable unit and all consumers, then verify every affected consumer's identity/status and provider amount.

For the shared variant first prove an existing shared DAILY TEST budget and its complete non-removed owned consumers through stock READ. Freeze `resource_name`, `amount_micros`, `explicitly_shared`, period, delivery method and consumer association set. A 500-row limit/overflow is a blocker, not a silently truncated impact list. The same approved H row then updates the linked budget and must show every affected campaign; its rollback is again a separate approved operation.

**Current stock-contract gap:** foundation exposes amount updates to an existing campaign-linked budget. Stage0 creates non-shared budgets; Stage4 campaign_update does not expose campaign_budget association. There is no honest stock shared-budget create/attach tool in this baseline. Do not invent one or send raw mutate. If no shared TEST budget exists, either separately authorize manual TEST Google Ads UI setup/association + read-back/recovery, or implement a separately reviewed typed controlled setup surface before use. UI setup is not counted as a MCP approval/write and requires its own explicit authority. Original P295 makes shared impact conditional; current user-requested shared LIVE coverage remains unproved. No production/MCC/foreign consumer may be touched.

## I — fix provider enum proof before provisioning an audience

The exact v24 enum correction is documented in `google-ads-v24-audience-availability-correction.md`. `launched_to_all=true` remains valid, but records can independently prove `ALL_LOCALES` under matching actual channel values `ALL_CHANNELS`, `CHANNEL_TYPE_AND_ALL_SUBTYPES`, or `CHANNEL_TYPE_AND_SUBSET_SUBTYPES` with the applicable campaign subtype/default permission. Read the actual corrected-source catalog before claiming that resources are missing. Use actual returned IDs only; the current 500-row bound and zero boolean-filter sample do not prove account-global absence.

Once an owned eligible actual candidate is proved, the stock `google_ads_targeting_preview` row is:

```text
provider=GOOGLE_ADS; account_id=8590146099; items=[{
 operation: audience_add, level: AD_GROUP, campaign_id: 24324170853,
 ad_group_id: 206587491811, audience: {kind: IN_MARKET|AFFINITY|USER_LIST|DETAILED_DEMOGRAPHIC,
 id: exact provider-returned numeric ID}, mode: OBSERVATION
}]
```

The ID slot is a template, not executable input or a fabricated ID. Validate-only and stock owner/parent/mode guards remain mandatory. Add needs **1 approval**; restoration needs **1 new approval** with `operation:"audience_remove"`, same parent, actual newly created `criterion_id`, `acknowledge_irreversible:true`. Criterion creation/removal have no update mask. If the parent already has proven OBSERVATION, no mode update is needed; otherwise the explicit incremental mode mask is `targeting_setting.target_restriction_operations` and applies AUDIENCE `bidOnly=true` without overwriting other dimensions.

If the original AUDIENCE restriction was absent, removing the criterion does not remove this explicit observation setting. Exact absent-mode inverse is unsupported; do not promise complete targeting restoration. Prefer an already-proven OBSERVATION parent, or obtain explicit review/consent for the harmless retained mode and record it as a residual. Campaign ownership of conflicting targeting settings remains a blocker. Do not create Customer Match, upload personal data or fabricate user-list eligibility to resolve this prerequisite.

### Country-/language-specific eligibility is not enabled by this packet

Actual v24 modes are `COUNTRY_AND_ALL_LANGUAGES`, `LANGUAGE_AND_ALL_COUNTRIES`, `COUNTRY_AND_LANGUAGE`, carrying ISO alpha-2 country and ISO 639-1 language codes. Current builder freezes campaign channel/subtype but not a complete locale-context proof. It therefore intentionally remains fail-closed for those modes.

A future bounded supported profile must READ/freeze the complete positive/negative LOCATION/PROXIMITY/LANGUAGE criteria, actual geo country codes/ancestor identities, language constants/code/targetability, and campaign presence/interest settings. No positive geo restriction, all-language defaults, radius ambiguity, missing parent constants or incomplete inventories can be converted into invented KZ/ru context. A same-channel availability record must cover the entire proven country-language combination set, not just one matching Russian label; query selection/canonical fingerprints must detect context changes before commit. Account timezone/currency, keyword language and UI locale are not evidence. Geo-target presence-versus-interest and the exact provider interpretation of campaign locale must be reviewed before implementing this additional profile. The current safe GLOBAL enum fix does not guess it.

## J — actual district and real center, then one atomic criterion batch

Existing actual Astana city ID is `1009806`; this is source/artifact evidence, not a fresh constant lookup. Resolve the city by name again through stock GeoTargetConstantService, freeze the canonical GAQL constant and parent-scoped district response. No direct district and no existing radius center were observed. Do not silently substitute a region/country for a district or invent a centroid.

Needed inputs are a real provider-confirmed eligible district name/ID and a legitimate verified radius center supplied explicitly by the user or obtained from a fresh owned provider PROXIMITY. A different city/district pair requires actual provider relationship proof and explicit scenario selection, not automatic weakening of the current Astana-parent contract. If such inputs cannot be obtained, J remains BLOCKED.

The J `google_ads_targeting_preview` batch uses `level:"CAMPAIGN"`, `campaign_id:"24324170853"` in 3 rows: `geo_add` with resolved city `name/country_code/geo_target_id`, `geo_exclude` with actual district reference, `radius_add` with approved actual latitude/longitude/radius/unit. Add/exclude/proximity creation have no update masks. If presence changes are also requested, it is an explicitly separate typed `presence` row with exact leaf masks `geo_target_type_setting.positive_geo_target_type` / requested negative leaf, not an implicit change. No current criterion collection is replaced.

Base J batch needs **1 approval**, then **1 new approval** for a controlled batch of `criterion_remove` rows, only the 3 actual new provider IDs, correct LOCATION/PROXIMITY types and `acknowledge_irreversible:true`. Preserve full neighbor snapshots including built-in DEVICE/bidModifier. Reread all created criteria and restored absence, existing languages/geo/device criteria unchanged. The original fixture remains paused. These counts exclude any separately authorized prerequisite setup or presence update/restore.

## PMax — legitimate missing inputs, no fake goal/media setup

Use an existing same-account ENABLED conversion action whose owner and selected conversion customer equal TEST `8590146099`. No such action is currently proved. Creating a real action/goal in TEST Google Ads UI needs separate explicit authorization and follow-up READ; no generic stock conversion-action create tool is invented by this plan.

The stock create tool is `google_ads_pmax_preview`, `action:"pmax_create"`, one closed `items:[{brief:...}]`. Required brief fields: reviewed unique campaign_name, daily_budget `{amount,currency}`, actual conversion_actions IDs, genuine business_name ≤25, actual decoded logos, asset_groups, resolved locations/languages and the explicit EU political advertising declaration. Non-retail channel profile only. Supported bidding is MAXIMIZE_CONVERSIONS or MAXIMIZE_CONVERSION_VALUE; no conversion history is fabricated.

Media contract requires actual inline PNG/JPEG decoded bytes, ≤1 MiB each and ≤2 MiB aggregate, not asset IDs, paths or downloaded substitute media. Each group needs approved landscape/square media; landscape ≥600×314 at 1.91 ratio, square ≥300×300, real square logo ≥128×128. Supply at least 3 headlines ≤30, 1 long headline ≤90, 2 descriptions ≤90 with an actual short description ≤60, and valid final URL/paths. Existing metadata-only candidates cannot fill inline media fields or prove brand rights.

One atomic create requires **1 new approval** after real Google validate-only; `partial_failure=false`, no create update masks, exact temp-resource relationships. Its preview must disclose the campaign budget, campaign, custom goal mapping based on actual existing conversion actions, asset groups/assets/associations and paused defaults. The existing builder may create a new campaign-specific custom conversion goal mapping; it does not create a fictitious conversion action. Same-account ownership, Google policy/minimum-assets validation and full provider reread are mandatory. Ambiguity permits READ reconciliation only, never repeat creation.

Keep created campaign/groups/associations PAUSED and record every residual resource ID. Creation has no exact automatic destructive rollback. No automatic goal/asset/campaign removal; any later controlled status/removal needs its own preview, explicit human approval and irreversible safeguards. Missing resources cannot be fabricated under current authorization, so PMax remains BLOCKED until legitimate prerequisites and explicit live approval are available.

## Checkpoint / release boundary

For every future approved commit: fresh exact source/image/key/TEST/hierarchy/allowlist proof → provider BEFORE → immutable preview + validate-only → persisted human session/audit/confirmedAt + TTL/stale check → exactly one commit → reread + journal → independent approved recovery where defined. Exactly one pending approval at a time. Provider errors and UI actions are accounted separately; mock/schema PASS is never LIVE PASS.

Root handles Q/R connection separately. This packet does not publish endpoints, create keys, change scopes/allowlists, run missing-resource setup, merge/deploy, or rewrite evidence. Original requirement anchors are OOXML paragraphs, not page numbers. Source: `original-tz-source-20261009.json`, `requirements-matrix-20261009.json`, `eligibility-recovery-20261010.json`, `H-warning-only-20261010.json`.

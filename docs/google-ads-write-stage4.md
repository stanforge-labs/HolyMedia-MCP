# Google Ads Write Stage 4 — supported bounded profile

Date: 2026-10-09. Implementation and mock regression evidence, **not live acceptance**. No real Google Ads reads, validate-only requests, or mutations were performed by this package. Main and production are untouched; Stage 0+1 release candidate remains separate.

## Entry points and safety

Private typed tools: `google_ads_ads_assets_preview` and `google_ads_pmax_preview`. Inputs have explicit `provider: GOOGLE_ADS`, account, one homogeneous action and 1–100 rows. All nested schemas are closed; total provider operations must not exceed 500. IDs are numeric, not arbitrary resource names or Google mutation requests.

Plans use the existing controlled-write foundation and extension version 4: account ownership proof, provider-derived before state, immutable payload and reference snapshots, Google validate-only, manual browser approval, expiry/session/CSRF/owner/consumed/stale protections, exact commit, provider reread and audit/journal. No client-specific approval or parallel vault architecture. New Stage 4 gate defaults OFF; both the foundation gate and account allowlist remain mandatory. No automatic mutation retries or raw cleanup.

Independent updates use Stage 1 partial-failure semantics. Creates with temporary dependencies (new assets and their associations, ad groups) are atomic: `partial_failure=false`. The plan exposes atomic/irreversible flags and every provider operation; no silent extra resource activation. New RSA and ad groups always start PAUSED. Search campaign creation continues through the existing Stage 0 builder, unchanged; the non-retail PMax profile below has its own typed graph under the same controlled-write engine.

## Capability matrix

| Capability                                          | Package status and limits                                                                                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RSA create                                          | Implemented, Search standard groups only, PAUSED; 3–15 headlines/2–4 descriptions, pins, paths and one final URL                                                                        |
| RSA edit                                            | Implemented through **AdService / AdOperation**, not an invalid AdGroupAd content update; explicit whole RSA content with exact leaf masks, repeat-moderation warning                   |
| Ad PAUSE/RESUME                                     | Implemented, explicit status-only operation, inverse intent and provider identity/content preserved                                                                                     |
| Ad REMOVE                                           | Implemented only with `acknowledge_irreversible=true`, visible irreversible warning and mandatory separate destructive browser approval; no automatic inverse                           |
| Sitelink/callout/snippet/call/business name         | Implemented asset create + association at customer/campaign/group levels; Google validates exact field-type/level/account/policy eligibility                                            |
| Image/logo                                          | Existing owned IMAGE refs or bounded actual JPEG/PNG upload via `image_asset_create`, PMax create/replace; verified actual dimensions/MIME/size; no remote files or URLs                |
| Binary ingestion                                    | Implemented full pixel decode/re-encode, metadata stripping, <=1 MiB each, <=2 MiB aggregate, <=8 files, <=4096 dimensions and <=16M pixels; bytes redacted from returned/audit views   |
| Asset attach/detach                                 | Implemented exact association; detach requires explicit irreversible acknowledgement because Google removes the link resource; underlying asset is retained                             |
| Campaign rename/dates/networks/PAUSE                | Implemented exact masks without replacing adjacent settings. Search-only network edits                                                                                                  |
| Campaign RESUME                                     | Use existing generic `preview_resume_campaign`, with launch-checklist protections. Direct ENABLED generic campaign edit is explicitly rejected, not a bypass                            |
| Ad group create/rename/status                       | Implemented Search standard create PAUSED; existing-name duplicate rejection and parent proof                                                                                           |
| Tracking                                            | Implemented customer/campaign/group final suffix or HTTPS ValueTrack template with exact field masks; untouched tracker fields and landing URLs remain unchanged                        |
| Existing PMax asset group edit                      | Implemented name/status/paths/final URL, campaign type and parent verified                                                                                                              |
| Existing PMax search theme/audience signal add      | Implemented typed creates on an existing asset group; enabled account-scoped existing audience, duplicate rejection, policy validation                                                  |
| Existing PMax text/image association                | Implemented `pmax_asset_attach`: existing TEXT/IMAGE refs, existing verified PMax group, PAUSED link; limited HEADLINE/LONG_HEADLINE/DESCRIPTION/MARKETING_IMAGE/SQUARE_MARKETING_IMAGE |
| PMax association detach                             | Implemented exact selected association, explicit irreversible approval, full remaining asset composition/branding/ownership proof; insufficient minimum fails before mutation           |
| PMax campaign creation                              | Implemented **non-retail atomic profile**: PAUSED campaign/budget/PAUSED groups, full mandatory assets, explicit selected existing same-account goals, geo/language/tracking            |
| PMax new full asset group/assets/texts/images graph | Implemented in atomic campaign brief and on existing PAUSED PMax parent, full required media/texts and brand-mode proof, no half-group                                                  |
| PMax brand exclusions/negatives/signal removal      | v24 negative CampaignCriterion, existing ENABLED SharedSet **BRANDS** exclusion, exact explicit signal removal; Google account/brand-list eligibility must pass validate-only           |
| PMax text/image edits                               | Atomic group/campaign-brand replacement: new TEXT/IMAGE or verified owned IMAGE, preserve link status, remove only selected old link; original asset retained                           |
| Retail/travel/local-services PMax                   | Not supported by the non-retail profile; Merchant Center/feed/listing/vertical options rejected explicitly, never silently dropped                                                      |
| Cross-account PMax conversion customer              | Explicitly rejected for atomic custom-goal profile; same-account customer/actions are required; no fabricated goal references                                                           |

This is an implemented bounded non-retail PMax profile, not full support for every Google PMax business vertical or proven live policy eligibility. The original specification paragraphs 254–257 require PMax edits and assign campaign creation to Stage 0; the subsequent user scope explicitly adds full non-retail atomic PMax creation here. Google validate-only, manual approval and live provider reread remain mandatory before declaring a real campaign verified.

## Non-retail PMax creation and media

`google_ads_pmax_preview` action `pmax_create` accepts exactly one item `{brief: ...}`. Closed required brief fields: `campaign_name`, `daily_budget: {amount,currency}`, `conversion_actions: [existing action IDs]`, `business_name`, `logos`, `locations: [{geo_target_id, exclude?}]`, `languages: [Google constant IDs]`, `asset_groups` and explicit `contains_eu_political_advertising`. Optional: `brand_guidelines_enabled` (default true), `bidding_strategy` (`MAXIMIZE_CONVERSIONS` default or `MAXIMIZE_CONVERSION_VALUE`), matching `target_cpa` or `target_roas`, dates and typed Stage 0 UTM. Date fields map to v24 `start_date_time`/`end_date_time` in the account timezone; no old/deprecated date fields. Geo defaults PRESENCE, not presence-and-interest. This bounded PMax brief requires official resolved constant IDs; the separate Stage 0/3 geo resolver handles human-name ambiguity.

Each asset group requires name, public final URL, 3–15 headlines (30), 1–5 long headlines (90), 2–5 descriptions (90), at least one `MARKETING_IMAGE` and one `SQUARE_MARKETING_IMAGE`; optional paths (15), existing audience IDs and up to 50 search themes. No video asset is fabricated; provider auto-generated video/URL behavior is prominently warned, not claimed disabled.

Media source is exactly one of `{asset_id}` or `{mime_type:"image/png"|"image/jpeg",data_base64}`. Canonical base64 only: no `data:` URI, URL, filesystem path, private blob path or arbitrary Google object. Inline actual bytes are fully decoded with pinned Sharp, re-encoded without EXIF/ICC/XMP/trailing data, then stored only in the bounded private immutable payload. Returned MCP/browser previews, error context, journal and evidence must call `safeMediaSummary`; SHA256/dimensions/MIME/length are safe, binary content is not. Actual ImageAsset reread verifies type/size/dimensions/MIME; the mutate-only bytes field is not requested from Google. Local bounds (1 MiB/file, 2 MiB aggregate, 8 files) are deliberately stricter than Google's 5120 KB image limit and preserve the existing authenticated 3 MiB HTTP body parser. No global HTTP limit expansion.

Existing IMAGE refs require exact selected-account resource/type and provider dimension/file-size/MIME metadata. Landscape >=600x314, ratio 1.91:1 (narrow local tolerance, exact Google validation required); square >=300 square; logo >=128 square. Bounded dimensions <=4096 and <=16M pixels apply locally. Google policy/eligibility still requires validate-only; successful local decode is not approval.

The atomic graph creates non-shared budget with provider-derived campaign name, PAUSED PMax campaign, campaign conversion-goal updates, a CustomConversionGoal selecting the validated same-account existing actions, ConversionGoalCampaignConfig, geo/language criteria, assets, PAUSED asset groups, required associations and optional signals/themes. `partial_failure=false`; <=500 underlying operations, no truncation. Same-account conversion customer, action owner/status/category/origin and actual customer goals are checked; missing or incompatible actions fail. Recent conversions queried where available; zero data is a launch warning, never invented health.

Brand guidelines true: campaign-level AssetFieldType **LOGO** and **BUSINESS_NAME** associations. False: per-group LOGO/BUSINESS_NAME. `BUSINESS_LOGO` is the Search role and is not substituted for PMax LOGO. Mandatory links are explicitly ENABLED under PAUSED parents to satisfy composition; no campaign/group is activated. Full creation has no automatic delete/inverse rollback; safe recovery keeps the created parents PAUSED and uses separate approved operations.

`pmax_asset_replace` requires exact campaign/group/old asset/field IDs and `acknowledge_irreversible:true`, plus TEXT `text` or IMAGE `media`. Replaces only the association atomically, with moderation warning; old asset remains. `pmax_asset_detach` similarly requires separate destructive approval. Full current link+asset inventory, all selected parents and branding are stale snapshots. Minimum remaining ENABLED composition and maximum counts are checked; absent owner/type/content/image data fails closed. Generic campaign `asset_detach` cannot bypass mandatory PMax branding protection. For provider-proven enabled brand guidelines, `pmax_campaign_asset_replace`/`pmax_campaign_asset_detach` separately handle campaign LOGO/BUSINESS_NAME with complete inventory and minimum proof (1–5 logos, exactly one business name); the last mandatory association cannot be detached. `pmax_signal_remove`, `pmax_negative_remove` and `pmax_brand_remove` remove only selected proven identities with explicit acknowledgement and separate approval, not automatic cleanup.

`pmax_asset_group_create` creates a **complete** new group on an existing owned PAUSED PMax campaign. Each row supplies `campaign_id` and `asset_group` with the same mandatory text/image schema as campaign creation. The exact campaign status/type/brand mode, current complete group inventory/name uniqueness, every image/audience reference and campaign branding are snapshots. Brand guidelines true: existing campaign LOGO/BUSINESS_NAME must be fully proven and `business_name`/`logos` overrides are rejected. False: the row must explicitly supply business_name and 1–5 logos; these are created/attached only to the new group. The same graph helper builds campaign and standalone groups; no budget, campaign, conversion goal or campaign-branding mutation is generated. PAUSED group + all required TEXT/IMAGE assets and explicit ENABLED links are created atomically (`partial_failure=false`), <=500 operations, zero silent truncation, no standalone half-group. Parent activation remains outside this action. Existing-group creation/provider reread is tested for both brand modes, duplicate names, wrong/active parent and missing required composition.

Brand exclusions use actual v24 SharedSetType **BRANDS**, despite the outdated BRAND_HINT comment in CampaignCriterion proto; invented `BRAND_EXCLUSION` is rejected. Existing owned ENABLED list is required. Google may restrict brand-list eligibility per account; validate-only determines access. PMax keyword criteria are negative only; positive targeting cannot be removed via negative actions. Signals are immutable; change uses explicit remove/create approvals, not an invalid update mask. Retail/feed, local-services, travel, new brand registry entries and cross-account conversion customer remain explicit limitations.

The bounded `pmax_asset_attach` profile requires the campaign or asset group already PAUSED. It creates only one explicitly PAUSED association per row, without changing parent status or uploading assets. The complete current link inventory is retained in the stale/context snapshot; account ownership, parent, duplicate IDs, TEXT content (30/90), positive IMAGE dimensions and supported field maximum counts are checked. Square images require at least 300×300 and equal sides; landscape images require at least 600×314. Exact landscape ratio, media/policy eligibility and provider minimum composition remain Google validate-only checks, not inferred PASS. Brand logo/name roles are always rejected at the asset-group level in this profile; no unverified brand-guidelines exception is fabricated.

## Input examples

```json
{
  "provider": "GOOGLE_ADS",
  "account_id": "8590146099",
  "action": "rsa_create",
  "items": [
    {
      "campaign_id": "1",
      "ad_group_id": "2",
      "rsa": {
        "final_url": "https://example.com/",
        "headlines": [
          { "text": "Test headline one" },
          { "text": "Test headline two" },
          { "text": "Test headline three" }
        ],
        "descriptions": [
          { "text": "Test description one" },
          { "text": "Test description two" }
        ]
      }
    }
  ]
}
```

`rsa_update` additionally requires `ad_id`. Headline/description arrays and final URL are explicit; omitted optional paths are preserved using exact leaf masks, not cleared. Status is unchanged. `ad_status` requires those three parent/identity IDs and `status` only. `asset_create` accepts existing Stage 0 typed `assets`, `level` and relevant parent IDs; no arbitrary Asset object. `tracking_update` accepts `level`, relevant IDs and one/both supplied `final_url_suffix`/`tracking_url_template`; it does not write a default suffix when only a template is requested. Rollback intent is currently emitted only for fully reversible ad-status, campaign rename without activation, and ad-group rename/status batches; campaign PAUSE from ENABLED does **not** advertise an inverse that would bypass the generic resume launch checklist. Restoring that campaign requires a new generic resume/checklist/manual approval operation. Asset/resource creation and removal are not automatically rolled back. Restoring date/network/tracking/RSA content currently requires a new explicit approved operation.

Validation reuses Stage 0 RSA/schema/wide-character/asset text/date/tracking and Stage 1 URL validators. Landing URL checks reject credentials, localhost/private IPv4 literals and unsupported IPv6 literals without a network call. HTTP reachability and DNS safety cannot be proven from this static validation; launch checking remains separate. No token, credential, cookie, authorization header, binary payload or OAuth state belongs in evidence.

## Acceptance and evidence

`google-ads-stage4.test.ts` retains the 48 existing mock cases including K (31-character headline rejected before provider reads/mutation) and L (PAUSED RSA exact payload and verified reread). Additional `google-ads-media.test.ts` and `google-ads-pmax.test.ts` cover actual decode, MIME mismatch, malformed/oversize bytes, metadata stripping/redaction, atomic mandatory composition, goals and cross-account rejection, branding modes, dates/strategies, quotas, typed schemas, minimum detach/atomic replacement, genuine BRANDS/v24 negatives and full resolved-resource post-state verification. Complete sibling inventory checks remain mandatory; unexpected existing resource changes fail verification. These are **mock/disposable** tests, not live Google evidence. Approval/session/audit/expiry/stale transport are tested in the shared extension engine; required live acceptance is separate.

## Primary v24 references

- [Mutate ads — content via AdService](https://developers.google.com/google-ads/api/docs/ads/mutate-ads)
- [Create responsive Search ads](https://developers.google.com/google-ads/api/docs/responsive-search-ads/create-responsive-search-ads)
- [v24 ImageAsset and dimension protobuf](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/common/asset_types.proto)
- [v24 AssetGroup protobuf](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/asset_group.proto)
- [v24 AssetGroupSignal protobuf](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/asset_group_signal.proto)
- [v24 AssetGroupAsset protobuf and link status](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/asset_group_asset.proto)
- [PMax minimum asset requirements](https://developers.google.com/google-ads/api/performance-max/asset-requirements)
- [Atomic PMax asset group creation](https://developers.google.com/google-ads/api/performance-max/asset-groups)
- [PMax campaign creation](https://developers.google.com/google-ads/api/performance-max/create-campaign)
- [PMax criteria and brand exclusions](https://developers.google.com/google-ads/api/performance-max/create-campaign-criteria)
- [v24 actual SharedSetType enum](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/enums/shared_set_type.proto)
- [v24 CampaignConversionGoal](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/campaign_conversion_goal.proto)
- [v24 CustomConversionGoal](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/custom_conversion_goal.proto)

K passed through stock private HTTP MCP on source `99ce4f0` with exact headline field rejection and zero Google calls/preview creation: `artifacts/google-full-scope/K-private-mcp-live-20261009.json`. It was not repeated during N continuation. This is not native Q/R client evidence. L/other Stage 4 live acceptance, actual Google policy eligibility, Q/R client acceptance and production release remain pending separate authorization and review. This package does not enable any write flag or deploy anything.

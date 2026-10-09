# Google Ads Write Stage 4 — supported bounded profile

Date: 2026-10-09. Implementation and mock regression evidence, **not live acceptance**. No real Google Ads reads, validate-only requests, or mutations were performed by this package. Main and production are untouched; Stage 0+1 release candidate remains separate.

## Entry points and safety

Private typed tools: `google_ads_ads_assets_preview` and `google_ads_pmax_preview`. Inputs have explicit `provider: GOOGLE_ADS`, account, one homogeneous action and 1–100 rows. All nested schemas are closed; total provider operations must not exceed 500. IDs are numeric, not arbitrary resource names or Google mutation requests.

Plans use the existing controlled-write foundation and extension version 4: account ownership proof, provider-derived before state, immutable payload and reference snapshots, Google validate-only, manual browser approval, expiry/session/CSRF/owner/consumed/stale protections, exact commit, provider reread and audit/journal. No client-specific approval or parallel vault architecture. New Stage 4 gate defaults OFF; both the foundation gate and account allowlist remain mandatory. No automatic mutation retries or raw cleanup.

Independent updates use Stage 1 partial-failure semantics. Creates with temporary dependencies (new assets and their associations, ad groups) are atomic: `partial_failure=false`. The plan exposes atomic/irreversible flags and every provider operation; no silent extra resource activation. New RSA and ad groups always start PAUSED. Campaign creation continues through the existing Stage 0 builder, unchanged.

## Capability matrix

| Capability                                          | Package status and limits                                                                                                                                                               |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RSA create                                          | Implemented, Search standard groups only, PAUSED; 3–15 headlines/2–4 descriptions, pins, paths and one final URL                                                                        |
| RSA edit                                            | Implemented through **AdService / AdOperation**, not an invalid AdGroupAd content update; explicit whole RSA content with exact leaf masks, repeat-moderation warning                   |
| Ad PAUSE/RESUME                                     | Implemented, explicit status-only operation, inverse intent and provider identity/content preserved                                                                                     |
| Ad REMOVE                                           | Implemented only with `acknowledge_irreversible=true`, visible irreversible warning and mandatory separate destructive browser approval; no automatic inverse                           |
| Sitelink/callout/snippet/call/business name         | Implemented asset create + association at customer/campaign/group levels; Google validates exact field-type/level/account/policy eligibility                                            |
| Image/logo                                          | Existing selected-account IMAGE references only; type and positive provider dimension metadata checked; Google validates dimensions/ratio/eligibility                                   |
| Binary ingestion                                    | NOT IMPLEMENTED. No invented bytes, remote downloads, upload URLs or synthetic image evidence                                                                                           |
| Asset attach/detach                                 | Implemented exact association; detach requires explicit irreversible acknowledgement because Google removes the link resource; underlying asset is retained                             |
| Campaign rename/dates/networks/PAUSE                | Implemented exact masks without replacing adjacent settings. Search-only network edits                                                                                                  |
| Campaign RESUME                                     | Use existing generic `preview_resume_campaign`, with launch-checklist protections. Direct ENABLED generic campaign edit is explicitly rejected, not a bypass                            |
| Ad group create/rename/status                       | Implemented Search standard create PAUSED; existing-name duplicate rejection and parent proof                                                                                           |
| Tracking                                            | Implemented customer/campaign/group final suffix or HTTPS ValueTrack template with exact field masks; untouched tracker fields and landing URLs remain unchanged                        |
| Existing PMax asset group edit                      | Implemented name/status/paths/final URL, campaign type and parent verified                                                                                                              |
| Existing PMax search theme/audience signal add      | Implemented typed creates on an existing asset group; enabled account-scoped existing audience, duplicate rejection, policy validation                                                  |
| Existing PMax text/image association                | Implemented `pmax_asset_attach`: existing TEXT/IMAGE refs, existing verified PMax group, PAUSED link; limited HEADLINE/LONG_HEADLINE/DESCRIPTION/MARKETING_IMAGE/SQUARE_MARKETING_IMAGE |
| PMax association detach                             | **NOT IMPLEMENTED** until minimum remaining asset graph/brand requirements are proven. Explicit failure before provider reads; no automatic cleanup                                     |
| PMax campaign creation                              | **NOT IMPLEMENTED**. Explicit `google_pmax_profile_unsupported` before any provider read; no partial graph, no fake PASS                                                                |
| PMax new full asset group/assets/texts/images graph | **NOT IMPLEMENTED**; minimum asset/brand-guidelines atomic profile remains a blocker                                                                                                    |
| PMax brand exclusions/negatives/signal removal      | **NOT IMPLEMENTED in this profile**; unsupported input/action is rejected, never silently dropped                                                                                       |

PMax partial existing-object support is not full PPC Stage 4 completion. Non-retail PMax creation requires asset group plus all minimum assets in the same GoogleAdsService mutate. v21+ brand-guidelines defaults additionally change business-name/logo association level; this package does not pretend to satisfy an unverified media/conversion/brand profile.

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

`google-ads-stage4.test.ts`: **48 mock tests PASS**, including acceptance K (31-character headline rejected before any provider reader/mutation), L (valid PAUSED RSA with exact provider payload and verified mock reread), status/inverse/removal guards, assets/temporary graph, account/type proofs, duplicate rejection, exact network/tracking masks, unsafe URLs, unsupported PMax and existing PMax objects/signals. Added tests cover all five bounded existing TEXT/IMAGE PMax roles, parent/account/reference ownership, provider dimension metadata, field maxima, duplicate batches, unsafe active parents, no unverified branding, fail-closed detach and truthful campaign PAUSE rollback support. RSA and PMax association creation additionally verify complete sibling inventories; unexpected pre-existing ad activation or asset-link changes fail post-state verification even when the requested new object exists. These are **mock** assertions. Human approval/session/audit/expiry/stale/policy/provider error transport are integrated and tested in the shared root extension engine, not simulated as live Google acceptance in these standalone plan tests.

## Primary v24 references

- [Mutate ads — content via AdService](https://developers.google.com/google-ads/api/docs/ads/mutate-ads)
- [Create responsive Search ads](https://developers.google.com/google-ads/api/docs/responsive-search-ads/create-responsive-search-ads)
- [v24 ImageAsset and dimension protobuf](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/common/asset_types.proto)
- [v24 AssetGroup protobuf](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/asset_group.proto)
- [v24 AssetGroupSignal protobuf](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/asset_group_signal.proto)
- [v24 AssetGroupAsset protobuf and link status](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/asset_group_asset.proto)
- [PMax minimum asset requirements](https://developers.google.com/google-ads/api/performance-max/asset-requirements)
- [Atomic PMax asset group creation](https://developers.google.com/google-ads/api/performance-max/asset-groups)

Live K/L/Stage 4 acceptance, actual Google policy eligibility, Q/R client acceptance and production release are pending separate authorization and review. This package does not enable any write flag or deploy anything.

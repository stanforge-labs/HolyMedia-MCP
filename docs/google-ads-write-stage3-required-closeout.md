# Stage 3 REQUIRED-scope reconciliation to the original PPC document

Source: `ТЗ запись в Google Ads для HolyMedia MCP.docx`, SHA-256 `51C94D3D2953B32821DC872822147B1FF6C28E36258211D9DDD916BFF2C30DB0`.
Paragraph numbering includes table paragraphs (`//w:p`); body-only extraction loses the operation tables. Requirements were inspected read-only through DOCX ZIP/XML. The document is source material, **not** approval or authority for live writes.

Baseline: `2173047386e5b2fb54ba9987ea96330da4c330fd` in isolated branch `codex/google-ads-write-stage3-final`. No main/production changes, database migrations, live provider reads, validate-only requests or mutations.

## Original REQUIRED scope and implementation

| Original paragraphs | REQUIRED behavior                                                                                                                       | Implemented contract and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P198–200            | Campaign/group audiences add/remove/exclude, including remarketing, In-market, Affinity, custom and detailed demographics; mode visible | Existing owned audience profiles preserved. DETAILED_DEMOGRAPHIC is resolved by exact name/ID from Google's `detailed_demographic` GAQL catalog, not a invented ID list. Numeric catalog ID must match owned resource identity and applicable channel availability. Criterion creation uses `extendedDemographic.extendedDemographicId`; include/exclude/removal and audience multiplier use exact typed criterion resources. Custom negative criteria remain explicitly rejected because v24 supports only positive custom audiences.                                                                                      |
| P201–203            | Audience bid modifier **only in OBSERVATION**                                                                                           | `audience_bid_modifier` proves actual OBSERVATION from frozen own/inherited campaign setting; omitted/false bid-only means TARGETING and fails. `audience_add` with a multiplier requires requested OBSERVATION and a proven/planned compatible mode. No hidden mode switch. Before/after preview states identify OBSERVATION. Both campaign and group positive audience criteria supported; parent association is proved.                                                                                                                                                                                                  |
| P204–206            | Find audience segments by name                                                                                                          | Read-only typed search supports USER_LIST, IN_MARKET, AFFINITY, CUSTOM and DETAILED_DEMOGRAPHIC. Ownership, exact builder resolution and bounds enforced; search results are inventory, not a promise of eligibility.                                                                                                                                                                                                                                                                                                                                                                                                       |
| P207–209            | Custom segment using terms/URLs/apps; create/update composition                                                                         | Existing typed CustomAudienceService profile preserved: AUTO definition, contextual KEYWORD/URL/Android APP members, no output-only fields, explicit privacy acknowledgement and acknowledged full-members replacement. Standalone atomic service boundary maintained. No Customer Match/customer data uploads.                                                                                                                                                                                                                                                                                                             |
| P210–212            | Age/gender/parental/income include, exclude **and bid modifier**                                                                        | Added `demographic_bid_modifier` with dimension and existing positive criterion ID; all four dimensions covered. Only `bid_modifier` changes, with provider reread, currency-independent multiplier bounds and captured inverse. Include may optionally carry a modifier during creation; exclusions cannot. Campaign-positive parental status is explicitly rejected by v24 capability, while group positive/campaign negative remain supported.                                                                                                                                                                           |
| P213–215            | City/region add/exclude, radius, name resolution through GeoTargetConstantService, presence vs interest                                 | Builder now accepts a typed GeoTargetConstantService suggestion hook. Runtime adapter supplies service transport; chosen candidate is independently re-read by exact GAQL ID and frozen with full metadata. Country/ID ambiguity, invalid/disabled/mismatching references and suggestion limits fail, never silently truncate. Fallback GAQL lookup is for standalone mocks/legacy code, not a claim to have called the service. Radius includes real supplied coordinates/radius units, never invented geocoding; negative radius is not supported by the actual v24 criterion. Presence settings retain exact leaf masks. |
| P216–218            | Russian/Kazakh/English language targeting                                                                                               | Existing aliases resolve targetable Google language constants. Exact typed LANGUAGE removal uses its actual campaign criterion identity and explicit irreversible acknowledgement; no collection replacement.                                                                                                                                                                                                                                                                                                                                                                                                               |
| P219–221            | Weekdays/times, account timezone, **bid adjustments**                                                                                   | Added `schedule_bid_modifier` for an existing positive AD_SCHEDULE criterion, with exact leaf mask, preserved time interval and explicit frozen account timezone. Schedule create may include a supported multiplier. Existing quarter-hour, overlap, six-interval/day and operation-count guards retained.                                                                                                                                                                                                                                                                                                                 |
| P222–224            | Device exclusion = −100% bid adjustment                                                                                                 | Existing provider device criterion update with modifier 0 is retained; no negative-device creation. Existing 0.1–10 profile and parent/resource verification retained.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P225                | Modify individual criteria, never overwrite the collection                                                                              | Demographic/schedule/audience updates are exact single-criterion leaf writes. Audience mode uses incremental `target_restriction_operations` ADD for only AUDIENCE; all sibling restrictions remain intact. No blanket replacement of criteria or hidden status edits.                                                                                                                                                                                                                                                                                                                                                      |

## Typed examples (synthetic IDs; not live authorization)

```json
{
  "provider": "GOOGLE_ADS",
  "account_id": "8590146099",
  "items": [
    {
      "operation": "demographic_bid_modifier",
      "level": "AD_GROUP",
      "campaign_id": "1",
      "ad_group_id": "2",
      "dimension": "GENDER",
      "criterion_id": "7",
      "bid_modifier": 1.15
    },
    {
      "operation": "schedule_bid_modifier",
      "level": "CAMPAIGN",
      "campaign_id": "1",
      "criterion_id": "8",
      "bid_modifier": 0.8
    }
  ]
}
```

These IDs are placeholders. Runtime must find each positive criterion in the selected account, prove its parent/type and freeze the actual snapshot before validation. All valid writes still require Google validate-only, manual human approval, immutable commit, reread and audit. No example constitutes approval.

## Capability boundaries, not silently omitted features

- Audience definitions/criteria cannot be mixed in one cross-service atomic batch. This is the exact v24 CustomAudienceService/GoogleAdsService boundary.
- Custom audiences cannot be excluded as negative criteria or attached to Search as if they were user lists. PMax/Demand Gen grouped audiences use separate Stage 4 profiles; no pretend support through ordinary Search audience criteria.
- Positive campaign parental status is not accepted by Google v24; group positive and campaign exclusions are supported.
- Proximity is positive-only. The required radius inclusion profile is implemented; radius exclusion is not claimed.
- Modifier effectiveness in automatic/portfolio bidding is not invented. This package's normal multipliers use standard Manual CPC / Maximize Clicks; other strategies are explicit incompatible-profile errors, not claims that every Google API combination is impossible. Device opt-out remains supported subject to Google validation.
- Detailed/user-interest segments with channel-specific availability are supported where the requested channel/subtype and all-locales availability are proved. Restricted country/language locales that cannot be established from current account context are explicit eligibility errors. No fabricated availability or taxonomy IDs. Full Google provider validation remains authoritative before any commit.
- Customer Match uploads, cross-account targeting and PII collection are outside the original contextual custom-segment scope and are not implemented here.
- Automatic inverse exists only for captured reversible numeric/settings updates. Criteria creation/removal never promises delete/recreate rollback with the same identity. Remove requires explicit acknowledgement plus human approval.

## Mock evidence and remaining acceptance

New source-audited regressions in `google-ads-stage3-required.test.ts` cover: mandatory observation/default rejection; campaign/inherited-group audience multipliers; four demographic modifier dimensions and exact inverses; negative/foreign/type/auto-strategy rejection; detailed catalog lookup/include/exclude/search/removal/modifiers; ID/resource mismatch and availability; schedule multiplier and timezone; GeoTargetConstantService candidate proof, ambiguity/limits/injection; closed schemas and no arbitrary Google objects.

Mock success is **not** LIVE acceptance I/J. Full shared controlled-flow/gate/audit tests remain root integration work; GeoTargetConstantService hook must be wired by the adapter and checked in the integrated mock transport. Real Stage 3 calls require a new explicit user authorization and each write requires separate human approval. Q/R/S remain independent cross-client gates.

## Primary API v24 capability evidence

- [CampaignCriterion fields and bid modifier](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign_criterion.proto)
- [AdGroupCriterion fields and bid modifier](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/ad_group_criterion.proto)
- [Extended demographic taxonomy field](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/common/criteria.proto)
- [DetailedDemographic owned catalog](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/detailed_demographic.proto)
- [DetailedDemographic selectable catalog](https://developers.google.com/google-ads/api/fields/v24/detailed_demographic)
- [Extended demographic selectable criterion](https://developers.google.com/google-ads/api/fields/v24/ad_group_criterion)
- [Positive/negative criteria by level](https://developers.google.com/google-ads/api/docs/targeting/criteria)
- [Observation versus targeting, owner restrictions](https://developers.google.com/google-ads/api/docs/targeting/targeting-settings)
- [Incremental restriction operations](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/common/targeting_setting.proto)
- [GeoTargetConstantService](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/services/geo_target_constant_service.proto)
- [Channel/locale availability definition](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/common/criterion_category_availability.proto)

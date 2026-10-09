# Google Ads Write Stage 3 — audiences and targeting

Status: typed builder and schemas implemented; mock coverage is not live Google acceptance. No provider reads, validate-only or mutations were performed against live credentials for this package. Main/production and Stage 0+1 historical evidence are unchanged. No database migrations.

The package uses the existing controlled-write contract: account/workspace ownership and OAuth write scope → account allowlist and OFF-by-default Stage 3 gate → provider-derived immutable preview → Google validate-only → persisted human browser approval → exact commit → provider reread → existing audit/journal. No approval bypass, raw mutation input, automatic retry or automatic destructive rollback.

## Tools and typed contract

`google_ads_targeting_preview` accepts explicit `provider: GOOGLE_ADS`, account ID and 1–500 closed `items`. It returns an immutable version-3 extension plan; the shared engine performs validation and approval. `google_ads_audience_search` is a separate read-only reference lookup by name and kind. Both are private MCP tools; Public MCP remains read-only.

Every targeting row has `operation`, `level: CAMPAIGN | AD_GROUP`, `campaign_id`, and `ad_group_id` only at AD_GROUP level. IDs are numeric, never caller-supplied Google resource names. Definitions (`custom_audience_create/update`) do not accept a campaign or ad group because creating a definition is distinct from targeting it.

```json
{
  "provider": "GOOGLE_ADS",
  "account_id": "8590146099",
  "items": [
    {
      "operation": "audience_add",
      "level": "AD_GROUP",
      "campaign_id": "24324170853",
      "ad_group_id": "206587491811",
      "audience": { "kind": "USER_LIST", "id": "123" },
      "mode": "OBSERVATION"
    }
  ]
}
```

The example is a schema illustration, **not** authorization to mutate any account or evidence that user list 123 exists. Preview requires a real owned, open, channel-eligible reference.

## Implemented capability matrix

| Capability                   | Implemented profile / limitations                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audience search              | USER_LIST, IN_MARKET, AFFINITY, CUSTOM; name substring lookup, ownership checked; inventory over 5000 fails, never truncates. Results do not promise channel eligibility.                                                                                                                                                                                                                                |
| Audiences add/exclude/remove | Campaign/ad group criteria; user-list membership, access and Search/Display eligibility checked; user-interest taxonomy and launched availability checked. Custom definitions attach only to DISPLAY/VIDEO, not Search. PMax audiences are signals and belong to Stage 4, not this surface.                                                                                                              |
| OBSERVATION / TARGETING      | Required on audience add/exclude, explicit mode tool. OBSERVATION = `bid_only=true`; TARGETING = false. Existing unrelated restrictions are preserved. Conflicting campaign/ad-group restriction owners fail rather than clearing a collection. Campaign mode impact freezes all child groups.                                                                                                           |
| Audience bid multiplier      | Positive existing audience criteria, standard Manual CPC / Maximize Clicks profile only; 0.1–10. Other/portfolio strategies are explicitly rejected rather than claiming effective support.                                                                                                                                                                                                              |
| Custom audience definitions  | Create AUTO with 1–100 KEYWORD/URL/APP members. No output-only status/resource fields sent. Rename/description/member updates with exact masks; replacing members requires explicit acknowledgement. Privacy acknowledgement mandatory; no Customer Match/PII uploads. Contextual member constraints do not constitute a complete healthcare/privacy policy engine. Google validation remains mandatory. |
| Custom definition service    | Google Ads v24 CustomAudienceService is separate from GoogleAdsService.Mutate and has validateOnly but no partialFailure. Definitions cannot be mixed with campaign criteria in one preview. Dedicated service plan is atomic; no fake cross-service atomic promise.                                                                                                                                     |
| Demographics                 | Scoped add/exclude for age, gender, parental status, income; enum values bound to their dimensions. Exact criterion removal requires explicit irreversible acknowledgement and a new browser approval. Geography/policy eligibility is ultimately checked by Google validation.                                                                                                                          |
| Geo                          | Campaign-level location include/exclude; exact GeoTargetConstant name lookup, country/ID disambiguation, enabled references; explicit aliases Алматы/Астана/Казахстан still resolve and verify Google's actual constant. English/Google native names supported, no silent geocoding or guessing ambiguous names.                                                                                         |
| Proximity                    | Campaign include with latitude/longitude, 1–500 kilometers/miles, micro-degree conversion; no invented address coordinates. Radius exclusions are explicitly unsupported. Google minimum-radius/privacy rules remain provider validation.                                                                                                                                                                |
| Presence                     | Exact nested campaign update of positive PRESENCE or PRESENCE_OR_INTEREST; optional negative mode. Existing unrequested negative setting preserved; expanded interest reach prominently warned.                                                                                                                                                                                                          |
| Languages                    | Campaign add: aliases Russian/русский, Kazakh/казахский, English/английский and language codes → targetable language constants. Remove only an exact typed LANGUAGE criterion; no replacement of the collection.                                                                                                                                                                                         |
| Schedules                    | Campaign add, 1–7 weekdays, quarter hours, end 24:00 only, no overnight interval. Existing/planned overlap rejected, max 6 intervals/day. Account timezone shown. Immutable existing schedule dimensions are not edited in place; exact acknowledged remove and new add are separate explicit changes.                                                                                                   |
| Device targeting             | Update existing campaign MOBILE/DESKTOP/TABLET criterion bid modifier only, 0.1–10 or 0 exclusion. No creation of implicit devices, no negative-device criterion or unsupported group/device replacement. Normal multipliers require supported standard manual profile; explicit device opt-out remains allowed subject to Google validation.                                                            |

## Safety, snapshots and recovery

- Full customer proof, parent resource and campaign/group association, targeting restrictions, channel/strategy, selected criterion and reference inventory are frozen for stale checks. A foreign resource or mismatching association aborts the whole batch.
- Duplicate raw rows, resolved aliases, positive/negative contradictions and multiple changes to one exact resource fail before provider validation. Underlying operation count, including modes and each schedule day, cannot exceed 500.
- Criteria are modified with exact update masks or one exact remove, never by overwriting the targeting collection. Mode is the provider's repeated restriction field: the builder preserves every other restriction and shows its scope-wide impact.
- Criteria creations use provider-valid ENABLED; campaign/ad group/ad statuses are never altered by targeting writes. New campaign/ad-group/ad creation remains PAUSED in their respective builders.
- This targeting plan uses `atomic=true` (partial failure false) so an audience mode change and criterion addition cannot be split accidentally. This is distinct from Stage 1's intentionally partial keyword batches. Invalid input/reference rows fail clearly with a Russian HolyMedia code, never masquerading as Google API errors.
- Every remove requires `acknowledge_irreversible=true`, a visibly irreversible preview and separate human approval. No automatic delete rollback. Creation cannot be automatically reversed by deleting its new resource.
- Existing numeric modifiers and explicit geo settings can generate typed inverse intents. Inverse operations use new preview/validation/approval and stale verification. Custom member update inverse is available only where the old complete nonempty typed definition is captured. Empty/inherited/unknown before-values are not fabricated as reversible.
- Provider reread verifies full selected entities, identities, nested field values and unaffected parent/reference context. A successful mutate HTTP response without reread is not VERIFIED.

## Tests / acceptance

Acceptance I mock proves audience OBSERVATION is explicit, unrelated restrictions survive, correct audience criterion is created and exact criterion removal is guarded. Acceptance J mock proves city include/exclusion/radius resolve without collection overwrite.

Standalone regressions cover enums, account/group ownership, mismatching references, PII-like/custom URL inputs, user-list eligibility, Search custom-audience rejection, shared restriction ownership, contradictory modes, duplicates/aliases, schedule overlap/granularity, underlying 500-op cap, bounds, read limits, immutable plan ownership, selected-entity reread and stale parent strategy. No real Google transport is exercised. Root integration tests separately cover gates, approval/TTL/stale, immutable commit, audit and rollback using the shared engine.

## Primary API v24 references

- [Targeting mode and restriction ownership](https://developers.google.com/google-ads/api/docs/targeting/targeting-settings)
- [CampaignCriterion v24 protocol](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign_criterion.proto)
- [AdGroupCriterion v24 protocol](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/ad_group_criterion.proto)
- [CustomAudience v24 protocol](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/custom_audience.proto)
- [CustomAudienceService v24 protocol](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/services/custom_audience_service.proto)
- [Custom audience channel guide](https://developers.google.com/google-ads/api/docs/remarketing/audience-segments/custom-audiences)
- [UserList v24 eligibility](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/user_list.proto)
- [Criterion info: schedule, geo micro-degrees, proximity](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/common/criteria.proto)

Live Acceptance I/J remains NOT RUN until explicit TEST authorization and independent manual approval. Cross-client Q/R remains a separate mandatory client acceptance gate; mock results do not replace it.

# Google Ads Search clone: bounded profile

Original requirement: paragraphs 104–106 of the preserved 2026-10-05 PPC brief:
clone an existing campaign with a new name, geo and budget. This extension is based
on integration commit `94edb8c3c082bbd8951bf166e8797e83f3b8a5dc`.

## Supported additions

- Positive coordinate-based proximity criteria are passed through the existing
  typed Stage 0 proximity validator. Coordinates, radius and units are preserved.
- Same-account CALL and BUSINESS_NAME assets are reused through new campaign
  associations. The existing asset's phone, reporting action, schedule and text
  are not rewritten. An existing PAUSED association stays PAUSED.
- Existing same-account ENABLED NEGATIVE_KEYWORDS shared lists can be associated
  with the new campaign. Metadata and all members are read and frozen; conflicts
  with cloned positive keywords appear as preview warnings.

This is an atomic Stage 0 creation graph with `partial_failure=false`. The new
campaign, ad groups and RSA ads remain PAUSED. New association operations reference
the actual temporary campaign, with referenced resources verified as owned before
query or use. CampaignSharedSet status is output-only: it is verified after creation
but never sent in the provider create payload. The final complete plan is limited
to 500 operations, including appended associations.

All source queries are frozen into the existing immutable preview checks. Changes
to a source radius, call asset, association or shared-list membership invalidate
the snapshot. No source resource is mutated. Existing assets/lists are references,
not independent copies: later authorized edits to them can affect both campaigns;
the preview explicitly warns about that shared impact.

## Explicit profile limits

There is no silent omission of unsupported targeting or ads. Audience/custom device
criteria, non-RSA ads, non-Search channels, custom goals and unsupported bidding
parameters are rejected. Enhanced manual CPC and portfolio bidding remain outside
this inline clone profile. Inline Maximize Conversions preserves a non-zero
provider-derived target CPA exactly, with authoritative billable-unit proof and
explicit post-state verification; no targets or conversion history are invented.
These are local profile
limits, not claims that Google API lacks those capabilities.

The exact three provider-managed neutral Search devices are now supported through
an explicit source proof and mandatory full target reread, with zero device
mutations; see [default-device boundary](google-ads-clone-default-devices.md).
Custom campaign/device/geo/schedule or ad-group adjustments are not silently
normalized away.

Group/keyword/ad tracking overrides, custom URL parameters and mobile URLs are
explicit profile gaps. They are selected/frozen and rejected instead of silently
dropped. A source without an explicit campaign final URL suffix is also rejected:
the normal new-campaign default UTM must not overwrite existing inheritance.

Negative radii and address-only proximity cannot be cloned by this coordinate
profile. `new_locations` with existing radii is rejected: without an explicit
typed radius override, the builder must not guess relocation, geocode or discard
the source radius. Cross-account/manager-owned list references are deliberately
rejected. Paused non-reference text/image asset associations are also rejected
rather than silently enabled. Existing single-final-URL restrictions still apply.

The clone does not delete source or new entities, invent inverse deletion, create
another authorization system or bypass browser approval. Account gate, allowlist,
validate-only, immutable commit, reread and audit remain the ordinary Stage 0 flow.

## Verification

Dedicated mock regressions cover the actual Stage 0 builder, provider payloads,
temporary-to-real CampaignSharedSet identities, provider verification, foreign
references, duplicates, source snapshot changes, unsupported components and the
final operation limit. These are code/mock evidence, not new LIVE acceptance.
No real Google READ, validate-only or mutation was performed for this package.

API v24 references: [CampaignSharedSet proto](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign_shared_set.proto),
[GoogleAdsService operations](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/services/google_ads_service.proto),
[asset selectors](https://developers.google.com/google-ads/api/fields/v24/asset),
[temporary IDs](https://developers.google.com/google-ads/api/docs/batch-processing/temporary-ids).

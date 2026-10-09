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
- Campaign custom parameters and group/positive-keyword/RSA tracking overrides
  are now preserved on their original levels: tracking template, final suffix,
  custom parameters and one desktop/mobile URL where that resource supports it.
  These are provider-derived typed create fields, not a new raw request API.

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

Tracking fields are selected/frozen and included in the immutable target plan,
human preview and exact reread expectations. Group/keyword/ad overrides stay on
their own level rather than flattening into campaign UTM. Original URL encoding
is preserved after HTTP(S)/credential validation. Group identity, keyword text /
match type and temporary parent mapping are proved before adding those fields.
Account tracking is also frozen to protect inherited defaults on the same account.

Custom parameters are bounded to eight, with case-insensitive unique alphanumeric
keys (16 bytes) and values at most 200 UTF-8 bytes. Mapping order is not semantic:
reread compares exact keys/values independently of provider list ordering. The
only default normalization is an omitted empty CustomParameter value with its
exact independently verified key; nonempty or wrong values still fail.

Local tracking profile: HTTPS template containing `{lpurl}`, closed placeholder
syntax, suffix `key=value` without leading `?`, no credentials/control characters,
one desktop/mobile URL per positive keyword/RSA. Templates not covered by that
profile are explicitly rejected, not declared unsupported by Google. Existing
campaign UTM validation still bounds campaign placeholder support.

Absent/empty source campaign suffix and template now preserve same-account
inheritance. The clone alone removes the normal brief's generated suffix from
its internal create payload; those request leaves are omitted, not filled with
invented UTM and not sent as a public clear/update operation. Its expected raw
provider state is semantic empty. Raw source absence versus empty and frozen
customer tracking are explicit in the preview summary. A source's own nonempty
template remains its own override even while its suffix is inherited.

Google protobuf JSON may omit empty string defaults. The narrow comparison-only
normalization requires the genuine same-account source campaign and customer
tracking snapshots, selected raw fields, exact newly-created PAUSED target
identity, an omitted request leaf and an expected empty tracking string. Missing
proof, a foreign owner, a nonempty source, provider null or unexpected provider
tracking never normalize to success. Raw reread evidence remains unmodified.
Normal campaign-from-brief default UTM and its closed public input schema are
unchanged; this is not a new global clear, flag or arbitrary provider-payload API.

Negative-keyword tracking, app URL / URL collections and text-asset tracking or
mobile overrides are explicit profile gaps, selected/frozen and rejected before
target creation rather than silently dropped. Reused CALL/BUSINESS_NAME/image
assets keep their existing contents and settings without recreation.

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
final operation limit, exact level-preserving tracking, parameter ordering/defaults,
URL encoding, unsafe tracking and every tracking field as a stale dependency.
Inheritance regressions cover raw absent/empty suffix, frozen customer settings,
template-only campaign overrides, unchanged standard brief defaults, missing or
foreign independent proof and genuinely wrong/null provider post-state.
These are code/mock evidence, not new LIVE acceptance.
No real Google READ, validate-only or mutation was performed for this package.

API v24 references: [CampaignSharedSet proto](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign_shared_set.proto),
[GoogleAdsService operations](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/services/google_ads_service.proto),
[asset selectors](https://developers.google.com/google-ads/api/fields/v24/asset),
[temporary IDs](https://developers.google.com/google-ads/api/docs/batch-processing/temporary-ids).

Tracking primary sources: [v24 AdGroup](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/ad_group.proto),
[v24 AdGroupCriterion](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/ad_group_criterion.proto),
[v24 Ad](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/ad.proto),
[v24 Asset](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/asset.proto),
[upgraded URL limits](https://developers.google.com/google-ads/api/docs/ads/upgraded-urls/fields).
[serving URL inheritance](https://developers.google.com/google-ads/api/docs/ads/upgraded-urls/serving-url-rules),
[v24 optional campaign tracking fields](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign.proto).

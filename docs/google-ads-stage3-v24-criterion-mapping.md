# Stage 3 v24 criterion mapping correction

`EXTENDED_DEMOGRAPHIC` is only a HolyMedia local typed selector. It is **not** a
Google Ads API v24 CriterionType enum value and must never occur in a GAQL enum
filter or provider payload/expected type.

Google exposes the independently selectable/filterable numeric oneof leaf
`extended_demographic.extended_demographic_id`. Detailed demographic inventories
use this positive leaf predicate. Mixed audience inventories freeze all criteria
of the exact parent and classify typed oneofs locally: GAQL does not support OR,
and no provider enum is guessed. Regular inventories use genuine enum values
USER_LIST, USER_INTEREST and CUSTOM_AUDIENCE. Provider ownership and exact
parent are checked before local oneof classification. Keyword/other criterion
IDs are not accepted as audiences, and contradictory oneof responses fail closed.

Creation uses the real extendedDemographic oneof and the resolved owned catalog's
numeric taxonomy ID. Verification compares that binding, resource, parent, status
and exclusion—not an invented provider enum. UNKNOWN in mock rereads is not an
assertion that Google always returns UNKNOWN: no exact provider enum is guessed.
Availability, mode, modifier compatibility, immutable snapshots, browser approval
and stale checks remain unchanged. Age, gender, parental status and income retain
their actual v24 enums and selectors.

References: [v24 CriterionType proto](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/enums/criterion_type.proto),
[v24 ad group criterion oneof](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/ad_group_criterion.proto),
[official v24 field metadata](https://developers.google.com/google-ads/api/fields/v24/ad_group_criterion#extended_demographic.extended_demographic_id).

Regression evidence is mock/code only. This correction performs no live provider
READ, validate-only or mutation, and makes no new LIVE acceptance claim.

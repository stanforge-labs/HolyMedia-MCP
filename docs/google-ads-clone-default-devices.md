# Search clone: proven provider-managed device defaults

This narrow extension handles provider-generated Search campaign device targets,
not arbitrary device-setting cloning. A source must contain exactly the owned,
canonical DESKTOP/30000, MOBILE/30001 and TABLET/30002 positive ENABLED criteria.
Both device type and bid modifier are actually selected. Missing modifier means
neutral; explicit numeric `1` is also neutral. `0` is opt-out, never default.
Other adjustments, null/string/malformed values, missing/extra/duplicate devices,
foreign references or inconsistent criterion IDs/types reject the clone.

No device creation/update/removal is sent. Preview explicitly declares the
provider-managed defaults and the mandatory target postcondition. Source rows and
ad-group modifier inventories are frozen into normal immutable/stale checks.
All non-empty source ad_group_bid_modifier inventories currently reject: cloning
inherited/explicit group overrides is not proved by campaign defaults. Non-neutral
location/schedule modifiers also reject rather than silently disappear.

After atomic commit the verifier resolves the created campaign's actual identity
and rereads its **entire DEVICE inventory**. The exact three owned targets must
have matching IDs/types, ENABLED/positive state and absent/numeric-1 modifiers.
Missing/different/unreadable inventory makes the result UNVERIFIED even when all
planned mutations returned success. Postcondition evidence is separate from
mutation results; there are no synthetic device writes or additional operations.
Raw provider/source snapshots are not normalized in storage.

This does not lift other local Search clone limitations, add support for custom
device overrides, broaden allowlists or bypass browser approval. Target campaigns,
groups and RSA ads remain PAUSED. Existing Search creation without cloning is
unchanged. This package provides mock/code regressions, not a new live claim.

Primary sources:

- [Official device platform IDs](https://developers.google.com/google-ads/api/data/codes-formats#platforms).
- [Google platform reference: IDs and default modifier 1](https://developers.google.com/google-ads/scripts/docs/reference/adsapp/adsapp_platform#getBidModifier). The Scripts reference is evidence of device-platform semantics, not a claim that its mutation capabilities equal API v24.
- [API Team explanation of all-device defaults](https://groups.google.com/g/adwords-api/c/0NTWRf15iH4).
- [v24 CampaignCriterion proto: optional modifier and explicit zero opt-out](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign_criterion.proto).
- [API targeting guide: device is positive; exclusion uses modifier zero](https://developers.google.com/google-ads/api/docs/targeting/criteria).

The source/target reread postcondition is essential: documentation and one source
account's default inventory alone do not establish the actual newly created
target's state. No new provider READ, validate-only or mutation was run by this
code package; historical acceptance evidence remains unchanged.

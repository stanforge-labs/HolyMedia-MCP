# Required Search clone audit: inline target CPA

Baseline: `b259bfd503e5298fa23978a517acbe96fc884b88`.
Original requirement P104–106 remains a **bounded/partially covered clone profile**,
not full clone support. Provider-managed DEVICE defaults, their immutable source
proof and full created-campaign verification are unchanged.

## Targeted supported addition

An inline MAXIMIZE_CONVERSIONS campaign's non-zero targetCpaMicros can be preserved
exactly. Source owner/account/currency and strategy are independently read.
Portfolio references and contradictory/manual enhanced settings remain rejected.
Original Google micros must fit int64 and align with the authoritative
currency_constant billable unit already frozen by the Stage 0 builder. A target
below that unit or not aligned is rejected rather than silently rounded.

The existing typed builder still validates actual own conversion actions/goals,
creates the full PAUSED graph and runs the ordinary validate-only/approval/commit
flow. The clone adds only the supported targetCpaMicros leaf to the same campaign
create payload, exact expected state, campaign preview row and summary. Reread now
selects that leaf and must match it; a successful mutate response with a different
target remains UNVERIFIED. Source changes use existing frozen checks.

This is not a new bidding strategy or permission bypass. No target/goal/history
is fabricated. Google policy and live acceptance remain pending for this profile.
[Official API v24 MaximizeConversions definition](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/common/bidding.proto)
supports target_cpa_micros in bidding-currency micro units; portfolio-only CPC
limits do not imply support for copying portfolio configuration here.

## Found and guarded tracking gap

Previous clone reads did not select group, keyword or ad tracking overrides,
custom URL parameters or mobile URLs, so those fields could disappear unnoticed.
They are now selected and frozen; any non-empty value rejects with
`google_clone_tracking_unsupported`. Missing/empty campaign final URL suffix also
rejects, including template-only campaigns: ordinary builder default UTM cannot
silently replace inheritance. This is a local required coverage gap, not a claim
that API v24 cannot create those fields. This package does not expand that profile.

Remaining explicit required/local gaps include audiences, non-neutral/custom
device/geo/schedule adjustments, ad-group modifiers, alternative bidding/portfolio,
non-RSA ads, multi-final URLs, custom/cross-account goals, unsupported source asset
types, geo modes and ambiguous proximity relocation. They must not be called DONE
or API-unsupported without evidence.

All work is code/mock-only. Provider READ/validate-only/writes = 0 for this task;
no runtime, live preview, production or main changes. Historical live evidence is
not rewritten. Commit remains local for integration review.

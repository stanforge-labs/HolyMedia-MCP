# G planning proof and independent readiness limitations

This is a pure local acceptance-planning correction, not live acceptance or write authorization. No provider transport, approval, commit, runtime or account selection is added.

G requires a fresh same-TEST/customer/parent/keyword proof, a positive ENABLED keyword, a positive explicit `ad_group_criterion.cpc_bid_micros`, and a known actual automated bidding strategy. A portfolio reference alone does not prove an automated strategy; any supplied strategy resource must belong to the same TEST customer. Inherited absent/zero raw CPC is still blocked: the scenario never invents an effective bid to calculate +10%.

Under automated bidding, `effective_cpc_bid_source` and `effective_cpc_bid_micros` can be omitted or reflect dynamic campaign bidding rather than the explicit override. They are not required to equal the raw keyword override. The stock Stage2 builder already selects/verifies these effective fields only for the proven standard manual Search profile; this planner follows that boundary. The required warning remains: manual CPC override may not affect effective bids, and strategy is unchanged. Readiness is only `ELIGIBLE_READ_ONLY_PREVIEW_NOT_STARTED`, never LIVE PASS or permission to commit. Authority, currency-unit quantization, stale fingerprint, validate-only and human approval remain stock runtime responsibilities.

## Separate I / PMax gaps: no behavior change

- I OBSERVATION can add an explicit AUDIENCE restriction where the old field was absent. Removing the newly created criterion does not remove this restriction. The stock builder truthfully marks absent-mode inverse unsupported. Use an already-proven OBSERVATION parent or explicitly record the retained mode as a residual setting; never claim exact restoration from criterion removal alone or clear targeting collections raw.
- PMax existing-image IDs/dimensions are metadata candidates only. The current stock `pmaxBriefSchema` create profile requires actual inline media bytes for logos and asset-group images, not those IDs. Existing same-account conversion actions and reviewed real media inputs still need separate proof and normal Google validation; no bytes, goals, branding identity or permissions are fabricated by inventory readiness.

Mock regressions cover dynamic/omitted effective fields, positive raw CPC, inherited zero/absent CPC, manual/unknown strategies, owned portfolio references, foreign identities, negative/unknown keyword polarity and stale proof. Historical evidence and main/production remain unchanged.

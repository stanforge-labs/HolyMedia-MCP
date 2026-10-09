# TEST fixture device baseline (N acceptance)

Fresh read-only evidence on 2026-10-09 returned five non-REMOVED criteria on
TEST campaign `24324170853`: Russian `1031`, Almaty `9235214`, and the existing
default device criteria `30000` DESKTOP, `30001` MOBILE, `30002` TABLET.
All five are ENABLED, positive and owned by TEST Client `8590146099`.
No explicit `bidModifier` was returned for these device rows.

The old N harness queried all campaign criteria but assumed only two rows.
It therefore stopped before MCP/validation with `stage234_fixture_targeting_changed`.
This was a baseline assertion defect, not evidence of a provider mutation.

The corrected harness selects criterion identity/parent, device type and optional
bid modifier. It pins the exact five owned records and preserves all of them in
the immutable provider snapshot. Unknown/duplicate/missing criteria, a changed
device type or explicit bid modifier, different parent, negative, status, language
or geo all fail closed. No provider guard, approval or stale check is bypassed.

Historical targeting evidence selected explicit language/location components;
it remains unchanged. The read-only diagnostics and blocked N attempt are separate
evidence. No Google mutation or approval was performed by this fix.

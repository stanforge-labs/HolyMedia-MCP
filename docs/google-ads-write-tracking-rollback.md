# Google Ads tracking rollback — original PPC P39

## Supported bounded profile

`tracking_update` at account, campaign and ad group levels captures provider-derived BEFORE values and prepares an inverse for the exact changed `tracking_url_template` / `final_url_suffix` leaves. An untouched tracking neighbor is never filled using default UTM settings. Other names, statuses, URLs and settings are preserved.

The original commit must be fully VERIFIED. `preview_rollback_commit` builds a completely new typed preview using the captured inverse; it performs Google validation, rechecks account ownership, flags, allowlist and fresh snapshots, and requires its own human approval. The forward preview/token/approval cannot authorize rollback. Commit only accepts the immutable preview token, not replacement URLs. Provider reread and journal verification use the existing common engine. No new write/approval architecture or migration is introduced.

Google update masks select only these requested leaves. See the primary [Google field-mask documentation](https://developers.google.com/google-ads/api/docs/client-libs/php/fieldmasks).

## Explicit limitations

An inverse is available only when every changed BEFORE field is a nonempty string accepted by the supported typed URL/UTM validator. Missing/empty BEFORE values require a separate, proven field-clear profile; this packet does not silently invent that contract or substitute default UTM. Preview reports a structured HOLYMEDIA rollback capability with `supported: false` and `google_tracking_rollback_clear_unsupported`. Invalid existing URL/UTM values report `google_tracking_rollback_previous_invalid`. A legitimate forward update remains available, but rollback is not promised and the existing rollback guard rejects it.

Mixed plans do not expose an incomplete inverse if any row is unsupported. This packet does not add arbitrary clear inputs, shared missing-value normalization, or inverse support for unrelated RSA edits.

## Evidence boundary

`apps/api/src/mcp/google-tracking-rollback.integration.test.ts` uses the stock MCP preview, browser approval, immutable commit, provider verification, audit/journal and rollback services with HTTP mocked at the provider boundary. It covers exact restoration at all three levels, single-leaf preservation, independent approval, stale forward/inverse rejection, foreign identity, immutable input rejection, and explicit unsupported empty/invalid BEFORE.

Mock success is not Google TEST live acceptance or cross-client Q/R/S proof. Real Google calls and writes for this packet: 0. Main, production and the Stage 0+1 release candidate are unchanged.

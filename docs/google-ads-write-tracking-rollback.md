# Google Ads tracking rollback — original PPC P39

## Supported bounded profile

`tracking_update` at account, campaign and ad group levels captures provider-derived BEFORE values and prepares an inverse for the exact changed `tracking_url_template` / `final_url_suffix` leaves. An untouched tracking neighbor is never filled using default UTM settings. Other names, statuses, URLs and settings are preserved.

The original commit must be fully VERIFIED. `preview_rollback_commit` builds a completely new typed preview using the captured inverse; it performs Google validation, rechecks account ownership, flags, allowlist and fresh snapshots, and requires its own human approval. The forward preview/token/approval cannot authorize rollback. Commit only accepts the immutable preview token, not replacement URLs. Provider reread and journal verification use the existing common engine. No new write/approval architecture or migration is introduced.

Google update masks select only these requested leaves. `tracking_update` accepts optional `clear_fields: ["tracking_url_template", "final_url_suffix"]` (1–2 unique names). A row cannot set and clear the same field. Clear writes an explicit provider empty string with the exact selected field mask; preview shows CLEAR and warns that removing a local override may expose inherited parent tracking. Primary sources: [Google field-mask documentation](https://developers.google.com/google-ads/api/docs/client-libs/php/fieldmasks), [supported tracking entities](https://developers.google.com/google-ads/api/docs/ads/upgraded-urls/supported-entities), and [independent tracking-template/suffix hierarchy resolution](https://developers.google.com/google-ads/api/docs/ads/upgraded-urls/serving-url-rules).

## Explicit limitations

An inverse restores captured valid nonempty values or emits typed `clear_fields` when the selected raw provider BEFORE field was absent/empty. This represents the provider's unset tracking default, not a fabricated UTM. Invalid existing URL/UTM values report structured HOLYMEDIA `supported: false` and `google_tracking_rollback_previous_invalid`; a legitimate forward update remains available but rollback is not promised and the existing rollback guard rejects it.

Mixed plans do not expose an incomplete inverse if any row is unsupported. These two explicit tracking clears do not authorize arbitrary parameter clears or inverse support for unrelated RSA edits. If Google omits the cleared protobuf empty string on reread, the common verifier may compare that default only for the exact tracking leaf selected in the reread query/mask after independent resource and parent proof; raw audit reread data must not be rewritten.

## Evidence boundary

`apps/api/src/mcp/google-tracking-rollback.integration.test.ts` uses the stock MCP preview, browser approval, immutable commit, provider verification, audit/journal and rollback services with HTTP mocked at the provider boundary. It covers exact restoration at all three levels, approved empty clears, single-leaf preservation, independent approval, stale forward/inverse rejection, foreign identity, immutable input rejection, mixed set/clear, duplicate/conflicting/invalid clear rejection, and explicit unsupported invalid BEFORE. Omitted-default verifier regressions belong to the common-engine suite.

Mock success is not Google TEST live acceptance or cross-client Q/R/S proof. Real Google calls and writes for this packet: 0. Main, production and the Stage 0+1 release candidate are unchanged.

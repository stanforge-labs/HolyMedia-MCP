# Google Ads Stage 2 foundation

Base: Stage 0+1 integration `221371fd2c488a128c44c9f37b9de7195748a3c7`, verified Ubuntu CI run 37837941865. Branch: `codex/google-ads-write-stage2-foundation`. This implementation is mock-tested, NOT live accepted; no Stage 2 provider calls or writes have been authorized or made.

## Implemented package A

- Existing positive keyword CPC, ad-group CPC/target CPA override, campaign DAILY budget.
- Typed absolute account-currency amount or percentage; integer micros, decimal strings, no floating point and no FX conversion. Percentage requires a positive explicit amount (not an assumed effective inherited bid), greater than -100% and at most +1000%.
- Provider-derived before/full expected after, unchanged resource identity/status/text/URLs; all affected campaigns listed for shared budget. Impact topology, campaign strategy and currency are included in stale checks.
- Warnings for >50% changes and possibly ineffective CPC under automated/portfolio bidding. Ad-group target CPA requires TargetCpa, or standard MaximizeConversions with explicit campaign target CPA; other configurations reject rather than silently changing strategy.
- 1–500 underlying operations. Mixed unavailable/no-op rows return HOLYMEDIA row errors (not fabricated Google errors). Duplicate effective resources, foreign-account identities and unbounded inventory fail the entire plan. One resource per batch row; two fields on the same resource must use separate approved previews in this foundation.
- Google `validateOnly=true`, Stage 1-style `partialFailure=true`. Mixed services use one request per service, with independent per-operation results; this is NOT an atomic batch. A failed service request stops further service groups, preserves earlier outcomes, and never triggers an automatic retry. Unknown outcome requires read-only reconciliation/new explicit workflow.
- Existing McpPreviewService TTL/token/digest/browser owner-session approval/CAS claim/commit ID/stale protection/AuditService/list_change_journal. There is no second approval architecture or DB migration.
- Existing `commit_preview` takes ONLY the immutable preview token. Audits precede provider writes. Post-state reread verifies the complete selected resource fields.
- `preview_rollback_commit` creates a NEW inverse preview from server-recorded successful amounts, checks unchanged recorded post-state, revalidates with Google and requires NEW manual approval. No automatic rollback. Resetting an inherited/zero override is unsupported, not falsely advertised as reversible.

## Gate and private MCP contract

`PROVIDER_GOOGLE_ADS_STAGE2_WRITE_ENABLED=false` by default. Foundation Google write gate, exact account allowlist, adwords scope, workspace ownership, write principal, confirmed-write flag and browser approval all remain required. Stage 2 gate is rechecked on approval/commit/rollback, not just tool listing. Public MCP exposure is unchanged and remains read-only by default.

Private tool: `google_ads_bid_budget_preview`.

```json
{
  "provider": "GOOGLE_ADS",
  "account_id": "1234567890",
  "items": [
    {
      "field": "keyword_cpc",
      "campaign_id": "1",
      "ad_group_id": "10",
      "criterion_id": "101",
      "change": { "mode": "absolute", "amount": "0.10", "currency": "USD" }
    },
    {
      "field": "campaign_daily_budget",
      "campaign_id": "1",
      "change": { "mode": "percent", "percent": "10", "currency": "USD" }
    }
  ]
}
```

Other fields: `ad_group_cpc`, `ad_group_target_cpa` (campaign/ad-group IDs, no criterion ID). All Google nested objects are closed. No arbitrary Google request, raw micros, status, resource name or replacement commit values.

Generic `preview_change_campaign_budget` reuses the same Google builder with `items` restricted to `campaign_daily_budget`. Legacy Meta runtime arguments/semantics remain unchanged; its separate schema branch excludes explicit GOOGLE_ADS. Existing generic `preview_rollback_commit` and `commit_preview` are reused.

## Package B — NOT IMPLEMENTED / not live accepted

Strategy editing/parameters, portfolio create/attach/detach, device/geo/schedule modifiers, bulk discovery by filters and live acceptance remain separate work. Do not enable this foundation in production or claim full Stage 2 DONE. Existing strategy is only read/validated, never modified.

Next implementation sequence:

1. Typed standard/portfolio strategy inventory and channel/conversion eligibility. Full consumer-impact snapshot and strategy parameter validation before mutations. Explicit reject for portfolio incompatibilities; no implicit switch of shared budget or conversion goals.
2. Reversible strategy updates/attachments with exact oneof masks, preserved before state, fresh validate-only, browser approval, immutable commit, full reread and per-row journal. Define unsupported inverses honestly.
3. Device/geo/schedule modifiers with provider-specific ranges, compatible strategy matrix and identity snapshots. Do not pretend bid modifiers are effective under strategies that ignore them.
4. Bulk filters resolve to a bounded immutable inventory BEFORE approval; reject >500, no truncation and no late expansion during commit. Counts and all affected objects visible to user.
5. Separate TEST-only live plan per operation, explicit approval, reread and approved restoration. No production credentials or client-account writes.

## API v24 references

- [Official AdGroup proto](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/ad_group.proto): CPC applicability and target CPA overrides.
- [Official CampaignBudget proto](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign_budget.proto): account-currency micros, period and shared-budget semantics.
- [Google partial failure](https://developers.google.com/google-ads/api/docs/best-practices/partial-failures): per-operation outcomes; Stage 0 creation retains its separate atomic `partial_failure=false` exception.

Stage 3–4 proposal remains in `docs/acceptance/google-ads-stage2-4-proposed-backlog.md`; its historical blocker list is a dated snapshot, not current acceptance status. The detailed original PPC Stage 3–4 document was not recovered. Only the current user-approved category/scope is authoritative; proposed privacy/media/PMax extensions require separate scope validation.

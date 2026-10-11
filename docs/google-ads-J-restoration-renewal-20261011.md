# Acceptance J: exact restoration and expired-preview renewal

This is an acceptance-harness change, not a new product API, migration or
production rollout. The immutable stock API source remains
`55d9df3553ff1ad01586978b6e4ecc07913969c5`; harness HEAD is recorded separately.
Stage 0–1 release candidate remains untouched.

## Exact recovery

The VERIFIED J add created only:

- `customers/8590146099/campaignCriteria/24324170853~9196209`:
  Almaly District exclusion.
- `customers/8590146099/campaignCriteria/24324170853~2527337173874`:
  positive proximity, latitude 43.18690, longitude 76.88700, radius 2 km.

The original Almaty include ends in `~9235214` and must never be removed.
The two recovery removals are irreversible criterion removals and need a new
explicit browser approval. They restore the original targeting, not the old IDs.
No automatic recreation, raw mutation, cleanup or retry is permitted.

`run-geo-restore.py --expired-preview-run-id ... --expired-preview-id ...`
can renew only an exact expired, immutable, unconsumed, unattempted and uncancelled
TEST restoration preview. A valid pending preview or foreign account fails closed.
It preserves historical records, audits and protected files. Only that expired
disposable gateway is retired after key/runtime/pending-preview checks.

Use `--prepare-only` before JIT creation: fresh TEST hierarchy, full provider
snapshot and stock builder, with no preview or validate-only/mutation.
Only the final JIT run invokes stock private MCP preview and Google validate-only.

## Commit readiness before approval

`run-geo-restore-commit.py --prepare-only` starts the exact stock API with the
closed restoration commit transport guard. It checks readiness and exits before
approval lookup, commit or provider calls; it does not claim a commit launch.
The ordinary mode requires the exact new preview, persisted human owner/session/
audit, current key, unexpired immutable plan, frozen provider snapshots and stock
stale checks. Separate durable launch/MCP/provider latches prevent retries.
No public or production write surface is enabled.

The only allowed mutation payload is the two verified actual campaignCriterion
REMOVE operations, `partialFailure=true`, with no other changes. Full reread must
equal the original J-before snapshot. Each REMOVE must be acknowledged successfully
and its exact resource must be absent or explicitly REMOVED. Absence alone,
partial success, failed query, changed neighbors or missing journal never pass.
The journal retains exact campaign-level empty `adGroupId` semantics.

## Closeout boundaries

Fresh inventory on 2026-10-11 still shows no compatible paused Search automatic
bidding campaign, no shared budget, no enabled conversion actions and no IMAGE
assets. Existing budgets are nonshared, USD 2/day. Keyword 11743561 has no raw
CPC override: USD 0.10 is inherited from the ad group.

G needs separately agreed TEST strategy/keyword setup and approved restoration.
H nonshared warning validation is prior PASS; shared-impact coverage is MOCK only.
The current typed tooling has no shared-budget create/attach setup profile.
Do not silently change historical fixture strategies or substitute raw setup.

PMax needs genuine owned conversion/goal inventory, authorized landscape/square/
logo media and reviewed business branding. Clone remains the documented bounded
Search profile, with explicit unsupported-source errors, not full clone support.
Native Q/R/S client acceptance remains pending. The localhost approval gateway is
not a private MCP endpoint. See the existing private-client next-action document.

No new live PASS or full original-PPC completion is claimed from these preparations.
Production release still requires scope/client gates, documented Moderate-risk
review, integration review and separate merge/deployment authorization.

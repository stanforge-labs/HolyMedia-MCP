# Stage 2–4 exact-source live harness preparation

This package is code/mock preparation only. It does not authorize live writes and was not executed against Google or a VPS. Stage 2–4 mock PASS is not LIVE PASS; Q/R/S cross-client acceptance remains separate.

## N preview-only first checkpoint

The runner uses the existing disposable acceptance DB/vault/Redis/network only; it does not copy production data or start another OAuth. Target is fixed: TEST customer `8590146099`, login MCC `4378327049`, campaign `24324170853`, ad group `206587491811`. It proves customer `test_account=true`, USD, MCC metadata and one-level TEST hierarchy with fresh canonical reads. No other accessible customer discovery/metadata is allowed.

Before preview it checks the fixture: original 20 keywords ENABLED, residual PHRASE `11479221` PAUSED, campaign/group/RSA PAUSED, 2 USD non-shared budget, geo/language criteria only. Group CPC must be exactly 100000 micros (0.10 USD). Any difference stops without validation/mutation.

The only permitted HTTP MCP operation is stock private `google_ads_bid_budget_preview`, one `ad_group_cpc` row 0.10 → 0.11 USD. It invokes real Google validate-only via existing product code, not a manually manufactured provider mutation. The independent transport guard accepts exactly one provider payload with `validateOnly=true`, `partialFailure=true`, `cpc_bid_micros` leaf mask and group identity. A changed/omitted/false validation flag, real mutation, extra operation, wrong account/service/resource/amount/mask or commit/approval request is blocked before transport. Exclusive validation claim prevents retries after uncertain outcomes.

The runner checks persisted immutable plan/version/digest/audit, then rereads the complete fixture and requires identical BEFORE/AFTER. Evidence reports READ, VALIDATE_ONLY, refresh and real WRITE separately. N is **PREVIEW_PASS_NOT_COMMITTED**, not complete approved bid+rollback acceptance N. No commit/approval happens here.

## Exact-code runtime prerequisites (root preparation, not performed by this package)

1. Linux CI builds the final integrated source SHA into an API image with OCI `org.opencontainers.image.revision=<exact SHA>`. Pull its **immutable digest**, not production/latest. Image must contain all stock compiled packages and Prisma client matching migrated acceptance DB. No dist JS bind patch, old-image/new-harness masquerade or product file overlay.
2. Verify five production services remain healthy/unchanged; keep their environment, DB, Redis, network and ports untouched. Existing acceptance stack `/opt/holymedia-google-acceptance` retains its original network. The new one-off runtime uses the separate labelled `holymedia-google-acceptance_stage234` network, with only the existing disposable PostgreSQL/Redis connected as secondary aliases `postgres`/`redis` and their own volumes. The legacy approval container from another compose project is not admitted by weakening the ownership guard. `--prepare-network` validates dependencies and creates/connects only this secondary network: no restart/recreate, migration, production connection or provider call.
3. Existing acceptance env and `state/fixture-context.json` must be root-owned protected mode 600, not symlinks; context has the existing fixture preview ID and scoped service token. DB token must be unexpired/unrevoked, read+write scoped, STATIC_ALLOWLIST of the single selected internal provider-account ID. Enabled Google account inventory must contain only TEST customer. Existing encrypted vault stays in acceptance; decrypt only in memory for bounded reads/refresh, never output.
4. Upload this harness into an acceptance-only directory, without provider secrets. Each run receives a new unique run ID/directory (0700). Evidence/proof/claims/protected preview context are 0600, exclusive writes. Previous evidence/claims are never overwritten. Docker-compatible runtime env conversion stays protected inside that new directory; original Compose-quoted acceptance env is unchanged.
5. `run-live.py --check-only --head <40-hex> --image ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:<64-hex> --run-id <UTC>-<suffix>` checks local Docker/config only, no provider calls. Launch without `--check-only` only after root/user authorizes the bounded live READ+validate-only phase. There is no SSH auto-launch or real-write mode.
6. A one-off container runs the exact image plus read-only harness mount, never mounts compiled product files. Gates are enabled for Stage 2 preview in this child only; confirmed write/public writes remain OFF and preview-only remains TRUE. Stage 3/4 gates remain OFF. Existing acceptance env does not change. HTTP child API is `127.0.0.1:4000` inside the one-off container.
7. `--hold-api` starts root's new `stage234/approval-gateway.mjs`, checks its readiness before JIT preview, keeps the exact-code API/gateway alive and binds only VPS `127.0.0.1:4402` to gateway container port 4001. Stock MCP remains private at container `127.0.0.1:4000`; it is not proxied publicly by the gateway. Existing readonly `harness:/acceptance:ro` supplies the stock human approval assets. Otherwise the API stops after preview. Root must prepare that gateway and verify auth/CSRF/owner/session flow before asking approval. Existing old gateway hardcodes 4401 and must not be represented as new-code approval. The launcher intentionally does not approve, expose a substitute confirmation page or commit. Human approval URL exists only in protected preview context / intended user-facing response; no internal nonce is output separately.

No real commit or rollback can be executed with the preview guard. G/H/I/J/K/L likewise need distinct typed scenarios and evidence. Do not announce LIVE Stage 2–4 acceptance based on this package.

## Separately authorized N continuation

`run-commit.py` and `commit-runner.mjs` are prepared but not launched by the preview
workflow. The supervisor requires a specific human-authorized preview UUID, protected
context/evidence, exact immutable image revision/digest and source-hash manifest of
the mounted runner/guards. Its check-only mode never starts a container or calls Google.
Only a new isolated one-off may enable confirmed writes; production and the running
approval gateway remain unchanged. No external port or alternate approval route opens.

Immediately before the one stock `commit_preview` call, the runner rereads persisted
confirmedAt, matching human session/audit, scope/account ownership, TTL/consumption,
payload digest and fresh TEST/MCC/provider snapshot. Independent transport claims
permit exactly one CPC 110000-micros mutation. No self approval, raw adapter mutate,
automatic retry or replacement payload is present. An uncertain result stops.

After VERIFIED provider reread and journal checks, only the stock
`preview_rollback_commit` prepares a new inverse to 100000 micros with validate_only.
It does not execute restoration: a new human approval is mandatory. Original evidence
and claims are not overwritten; the original gateway stays available for that approval.
The manifest and context never expose service keys or provider credentials in reports.

## Expired service authority is a hard stop

The 20261009T120322Z-n1 live attempt stopped during DB preflight, before stock MCP,
Google reads/validation/writes or a preview. READ-only diagnosis proves the existing
single-account key expired at 2026-10-08T13:48:37.732Z; owner/account/scopes are correct.
This is MCP authority expiry, not Google provider OAuth failure. Do not edit its TTL,
revocation, scopes or historical context to make the guard pass.

A new disposable scoped key needs explicit authority and stock human-authenticated
token provisioning. Keep the secret only in a **new** protected
`state/stage234-scoped-context-<UTC>.json`; `run-live.py --context-basename <basename>`
accepts only that strict local basename or the original fixture context, never a path,
env file or production configuration. The runner independently rechecks the new key,
actual ownership, exact single-account scope and expiry before provider calls. No key
is created by this launcher, and operation-level human approval remains mandatory.

The separately authorized one-time stock administrative issuance is documented in
[disposable key issuance](google-ads-disposable-key-issuance.md). New contexts are
encrypted using the existing disposable CredentialVaultService, including opaque
preview/approval fields and future inverse contexts. Mode 600 plaintext is not a
substitute for the explicit encrypted-vault requirement. The pinned continuation
manifest now includes `context-vault.mjs`; public hints are not commit authority.

## Local/mock verification

## N restored and independent acceptance preparation (2026-10-10)

N now has two distinct human-approved stock commits: forward CPC100000→110000,
then the exact stock rollback CPC110000→100000. Both provider rereads and journals
are VERIFIED. The inverse uses separate once-claims/state and never replays the
forward runner. Evidence: `artifacts/google-full-scope/N-restored-pass-20261010.json`.
The stock API remains source-pinned to c11f14c; new harness modules are separate,
not product hotpatches. Production/main and historical evidence are unchanged.

H warning-only diagnostic uses the actual stock Stage2 provider builder/validator,
one exact Google validate_only and unchanged provider reread. Budget2USD→3.20USD
is previewed semantically, warning>50% is proved, one nonshared consumer is observed.
There is no persisted MCP preview, approval, commit or self-cancellation. This is
not full MCP H LIVE acceptance and not shared-budget LIVE coverage. See
`artifacts/google-full-scope/H-warning-only-20261010.json`.

G/I/J discovery is fixed-template, bounded, TEST-only READ and makes no global
absence claim. Actual API catalogs still do not prove an eligible automatic-bid
fixture, Search audience, district-parent or proximity center. PMax still needs
legitimate goal/media/brand prerequisites. See the separate eligibility evidence;
its source-label correction is separately attested, never a historical rewrite.

L uses a separate preview-only guarded API/gateway on localhost4403 and the actual
production adapter regression proves exact queries, create payload and immutable
plan. Only human browser approval can authorize a later commit; the preview runner
cannot commit. Prepare tests, source manifest, session/API readiness and tunnel
before the sole JIT RSA preview. Native Q/R instructions are in
`docs/google-ads-private-client-onboarding-20261010.md`; approval ports are not MCP.

`node --test scripts/google-live-acceptance/stage234/live.test.mjs`

`python -m unittest discover -s scripts/google-live-acceptance/stage234 -p "test_*.py"`

`python -m compileall -q scripts/google-live-acceptance/stage234`

Tests mock all transport. They cover validation true/false, exact payload, account/hierarchy/source/freshness proof, gates, scoped queries, no approval/commit, exclusive claim, safe errors/secret keys, fixture state and checkpoint accounting, immutable OCI/source and no production/product overlays. Standard secret scanner stays enabled.

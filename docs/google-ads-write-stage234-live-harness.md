# Stage 2–4 exact-source live harness preparation

This package is code/mock preparation only. It does not authorize live writes and was not executed against Google or a VPS. Stage 2–4 mock PASS is not LIVE PASS; Q/R/S cross-client acceptance remains separate.

## N preview-only first checkpoint

The runner uses the existing disposable acceptance DB/vault/Redis/network only; it does not copy production data or start another OAuth. Target is fixed: TEST customer `8590146099`, login MCC `4378327049`, campaign `24324170853`, ad group `206587491811`. It proves customer `test_account=true`, USD, MCC metadata and one-level TEST hierarchy with fresh canonical reads. No other accessible customer discovery/metadata is allowed.

Before preview it checks the fixture: original 20 keywords ENABLED, residual PHRASE `11479221` PAUSED, campaign/group/RSA PAUSED, 2 USD non-shared budget, geo/language criteria only. Group CPC must be exactly 100000 micros (0.10 USD). Any difference stops without validation/mutation.

The only permitted HTTP MCP operation is stock private `google_ads_bid_budget_preview`, one `ad_group_cpc` row 0.10 → 0.11 USD. It invokes real Google validate-only via existing product code, not a manually manufactured provider mutation. The independent transport guard accepts exactly one provider payload with `validateOnly=true`, `partialFailure=true`, `cpc_bid_micros` leaf mask and group identity. A changed/omitted/false validation flag, real mutation, extra operation, wrong account/service/resource/amount/mask or commit/approval request is blocked before transport. Exclusive validation claim prevents retries after uncertain outcomes.

The runner checks persisted immutable plan/version/digest/audit, then rereads the complete fixture and requires identical BEFORE/AFTER. Evidence reports READ, VALIDATE_ONLY, refresh and real WRITE separately. N is **PREVIEW_PASS_NOT_COMMITTED**, not complete approved bid+rollback acceptance N. No commit/approval happens here.

## Exact-code runtime prerequisites (root preparation, not performed by this package)

1. Linux CI builds the final integrated source SHA into an API image with OCI `org.opencontainers.image.revision=<exact SHA>`. Pull its **immutable digest**, not production/latest. Image must contain all stock compiled packages and Prisma client matching migrated acceptance DB. No dist JS bind patch, old-image/new-harness masquerade or product file overlay.
2. Verify five production services remain healthy/unchanged; keep their environment, DB, Redis, network and ports untouched. Existing acceptance stack `/opt/holymedia-google-acceptance` remains isolated on `holymedia-google-acceptance_default`, DB `postgres/google_acceptance`, Redis `redis`, own volumes. Old acceptance API is never restarted/recreated. No migrations in this launcher.
3. Existing acceptance env and `state/fixture-context.json` must be root-owned protected mode 600, not symlinks; context has the existing fixture preview ID and scoped service token. DB token must be unexpired/unrevoked, read+write scoped, STATIC_ALLOWLIST of the single selected internal provider-account ID. Enabled Google account inventory must contain only TEST customer. Existing encrypted vault stays in acceptance; decrypt only in memory for bounded reads/refresh, never output.
4. Upload this harness into an acceptance-only directory, without provider secrets. Each run receives a new unique run ID/directory (0700). Evidence/proof/claims/protected preview context are 0600, exclusive writes. Previous evidence/claims are never overwritten. Docker-compatible runtime env conversion stays protected inside that new directory; original Compose-quoted acceptance env is unchanged.
5. `run-live.py --check-only --head <40-hex> --image ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:<64-hex> --run-id <UTC>-<suffix>` checks local Docker/config only, no provider calls. Launch without `--check-only` only after root/user authorizes the bounded live READ+validate-only phase. There is no SSH auto-launch or real-write mode.
6. A one-off container runs the exact image plus read-only harness mount, never mounts compiled product files. Gates are enabled for Stage 2 preview in this child only; confirmed write/public writes remain OFF and preview-only remains TRUE. Stage 3/4 gates remain OFF. Existing acceptance env does not change. HTTP child API is `127.0.0.1:4000` inside the one-off container.
7. `--hold-api` starts root's new `stage234/approval-gateway.mjs`, checks its readiness before JIT preview, keeps the exact-code API/gateway alive and binds only VPS `127.0.0.1:4402` to gateway container port 4001. Stock MCP remains private at container `127.0.0.1:4000`; it is not proxied publicly by the gateway. Existing readonly `harness:/acceptance:ro` supplies the stock human approval assets. Otherwise the API stops after preview. Root must prepare that gateway and verify auth/CSRF/owner/session flow before asking approval. Existing old gateway hardcodes 4401 and must not be represented as new-code approval. The launcher intentionally does not approve, expose a substitute confirmation page or commit. Human approval URL exists only in protected preview context / intended user-facing response; no internal nonce is output separately.

No real commit or rollback can be executed with this guard. Future N bid change/rollback needs a separate approved controlled flow and explicit authorization; G/H/I/J/K/L likewise need distinct typed scenarios and evidence. Do not announce LIVE Stage 2–4 acceptance based on this package.

## Local/mock verification

`node --test scripts/google-live-acceptance/stage234/live.test.mjs`

`python -m unittest discover -s scripts/google-live-acceptance/stage234 -p "test_*.py"`

`python -m compileall -q scripts/google-live-acceptance/stage234`

Tests mock all transport. They cover validation true/false, exact payload, account/hierarchy/source/freshness proof, gates, scoped queries, no approval/commit, exclusive claim, safe errors/secret keys, fixture state and checkpoint accounting, immutable OCI/source and no production/product overlays. Standard secret scanner stays enabled.

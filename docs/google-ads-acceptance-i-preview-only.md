# Acceptance I: discovery-bound preview-only harness

This packet is not LIVE PASS. No provider/VPS calls were executed during implementation.

## Fixed safety profile

Source API55d9df3553ff1ad01586978b6e4ecc07913969c5, image digest2d7cd20cb25c268f74abd16f324d7b92ce5d804989a8de9b3fa062a0ca138d35. Only TEST8590146099 / MCC4378327049 / campaign24324170853 / group206587491811.

Requires an operator-pinned protected readiness artifact SHA/harness SHA, PASS_READ_ONLY, freshness<=5min, unchanged fixture, exact11-query raw snapshot attestation and historical verified L residual proof. No rd4 path/hash hardcoding. Only the selected proven AFFINITY/IN_MARKET candidate is consumed, with required exact candidate ID. No invented fallback IDs.

Fresh TEST/MCC/hierarchy and exact11 raw snapshots must match before preparation; group CPC100000 is separately reread, not assumed. A READ-only production Stage3 build resolves the exact observed audience and eligibility, freezing the actual provider plan before JIT. The actual preview is created only through stock private MCP google_ads_targeting_preview.

OBSERVATION is explicit. When previous mode is absent, the existing product contract performs mode update + audience create atomically, partial_failure=false. Already-observation criterion-only retains partial_failure=true. Harness never changes that contract.

Only exact plan validateOnly=true is allowed, once. Commits, raw mutations, retries, approvals and cancellation are prohibited. Afterwards all11 snapshots and group CPC must remain unchanged. Persisted immutable plan/digest, preview audit and old baseline audit hash are checked.

## Handoff

```text
python3 run-audience-preview.py --head <source55 fullSHA> --image ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:<2d7 fullDigest> --run-id <uniqueUTC> --context-basename <existing protected scoped-context basename> --readiness-relative stage234-readiness-<validatedRunID>/targeting-readiness-evidence.json --readiness-sha256 <fresh root-pinned complete-file SHA> --readiness-harness-head <root-pinned READ harness SHA> --candidate-key AFFINITY --candidate-id 90100 --check-only
```

Actual execution uses same args without check-only, only after root authorization/quality. It creates NEW stage234-i-state and i-harness-source.json; never edits L/N state. Root retires only the consumed L gateway before reusing localhost4403; this supervisor cannot retire/restart old containers.

API/gateway/session readiness are verified before a single JIT preview. Output approval URL is the intended existing human-facing contract. The opaque token stays in encrypted protected-preview-context.json, never stdout. Stop for manual approval; live I commit requires a separate reviewed continuation.

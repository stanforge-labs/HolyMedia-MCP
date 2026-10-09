# H warning-only diagnostic (not full acceptance H)

This isolated one-off harness invokes the existing `GoogleAdsAdapter.stage2`
builder and validator. It creates **no persisted MCP preview**, approval,
authorization or cancellation, and never invokes commit. No running API is
modified. This package was tested with mocks only; no live result is asserted.

Fixed scope: TEST Client `8590146099`, MCC login `4378327049`, paused campaign
`24324170853`, non-shared DAILY budget `15934365976`, USD 2.00 → planned USD 3.20
(+60%). The builder must emit the >50% warning, freeze authoritative currency
and budget consumer snapshots, and prove exactly one affected TEST campaign.
Shared-budget live impact and full MCP approval/commit H remain separate gates.

`runHWarningOnly()` reads the encrypted `fixture-context.json` using the stock
disposable credential vault. It checks the current scoped service key, expiry,
workspace/account ownership, OAuth scope, fresh TEST metadata and MCC hierarchy.
Stage 2 build/validate gates are ON **only in the disposable one-off**; preview
only is ON, confirmed writes, Stage 3/4 and Public writes are OFF, allowlist is
exactly the TEST Client. Runtime source, harness source and immutable image
digest are separate required pins. `STAGE234_H_WARNING_ONLY_AUTHORIZED=true`
and `STAGE234_GUARD_PRELOAD=0` are required. No CLI launches Docker or VPS.

Transport permits only fixed bounded READ queries and one stock validator
`campaignBudgets:mutate` request: `validateOnly=true`, `partialFailure=true`,
one `amount_micros` mask and exact `amountMicros="3200000"`. It categorically
blocks real mutation, foreign customer, direct MCC mutation, other operations,
arbitrary queries, MCP approval/commit requests and retries. The validation is
claimed with an exclusive protected file before transport; an uncertain result
retains the claim and must not be retried. OAuth refresh is bounded to one and
new credentials are persisted only through the disposable encrypted vault.

Before validation, frozen builder snapshots must still match fresh reads.
After validation, all snapshots and paused parent states must be unchanged and
the real budget must still be 2.00 USD. Pending preview count must be unchanged;
the harness does not impersonate a human to remove a pending preview. Sanitized
evidence is written exclusively, without credentials, payload bytes or tokens.
It labels `full_mcp_approval_commit_acceptance=false` and
`shared_budget_live_verified=false`. A PASS here is **only** a warning/validator
diagnostic, never a claim of full H LIVE PASS.

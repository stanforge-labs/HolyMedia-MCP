# Stage 0 isolated readiness harness (no commit capability)

This is acceptance-only code for TEST client `8590146099` through login MCC `4378327049`. It is not a public MCP tool or a deployment script. The runner uses the existing disposable acceptance DB/vault, dedicated compose project, readonly code mounts and a one-off API process. Production and the permanent acceptance API identities are checked before/after.

`prepare`: fresh canonical TEST/hierarchy proof; verify the restored Stage1 fixture against historical evidence; actual MCP U invalid-headline rejection; actual MCP V checklist; real-reference T plan construction; W resume plan. No Google validation or writes.

`preview`: only after a successful prepare and no other live pending preview; fresh proof; exact stored brief through the stock MCP route; exactly one Google `validateOnly:true, partialFailure:false` request. Confirm the proposed campaign is still absent and the full existing fixture is unchanged. Returns a manual approval checkpoint, never approves or commits.

Actual Google mutations, replacement payloads, all other customers, other MCC queries, approval and commit routes are denied by the transport guard. `wx` claims prevent validation retry. Atomic Stage0=false partial failure is not substituted for normal Stage1=true semantics.

The runner requires the pre-existing protected acceptance env/context and historical records; none are copied into this repository. Do not pass secrets on command lines. Do not run it against production or a newly invented DB. Review the pinned module hashes against the intended commits before execution:

- MCP mixed-batch module: `1d9a584579c9d33b2cf9f5d9dbc1e6f2891ce81980a4bb9a62480d450cd19e76`.
- Standalone Stage0 module from `e9097d66a4358b40d1e2704d8e3b99c43694046b`: `8a92cc8049c7c35b3fdd7fb41d01beb70de227638fe9d3e6f152477da857f957`.

The Stage0 mount alone does not add the new campaign PAUSE dispatch to the old image. W live remains blocked until the separately reviewed full candidate runtime is explicitly prepared, and every resume/restore requires its own human approval.

Regression (offline, no network): `node --test scripts/google-live-acceptance/stage0-readiness/*.test.mjs`.

Historical failed attempts are not overwritten. The v4 namespace is already used on the VPS. A later independent attempt must use a new namespace after explicit expiry/cancellation review; never clear a claim or reuse a consumed preview. Sanitized evidence excludes provider/MCP tokens, vault payloads, cookies, OAuth state/code and approval nonce; the intended complete user-facing approval URL is handed off separately.

Two diagnostic labels were shortened in this tracked copy to avoid accidental token-pattern matches. Historical evidence and the already-run VPS copy are preserved unchanged. The scanner itself and credential detection remain active; `scanner-label.test.mjs` verifies actual synthetic token input is still blocked.

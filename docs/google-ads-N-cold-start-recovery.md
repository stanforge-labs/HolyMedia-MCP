# N continuation: cold-start readiness recovery

The manually approved preview `ff5169fe-86ca-467f-9448-8c481619ad0c`
passed persisted confirmedAt/session/audit/owner/immutable verification. The exact
N supervisor launched once on source `99ce4f0`, performed 12 fixed provider READs
and proved CPC `100000`, TEST hierarchy and the unchanged paused fixture.
The stock commit API did not become ready within the old 20 x 500ms polling
window. Failure: `stage234_commit_stock_api_not_ready`, before HTTP MCP commit.

No MCP commit claim, Google write claim, consumedAt, commitAttemptedAt or write
audit exists for this attempt. The supervisor launch claim is retained. Real
Google writes = 0. The old preview subsequently expired and must never be retried,
patched, reused, or have its durable claims removed.

A separate startup diagnostic used the same immutable image, protected disposable
environment and a **read-only** historical state mount. Its preload denied all
Google/OAuth/MCP/approval fetches. Native HTTP and guarded fetch reached `/ready`
200 in the separate bounded diagnostics. The timed probes reached guarded 200
at 6754ms (light parent) and 6137ms (provider/database modules loaded). They did
**not** reproduce the original timeout; the original child stderr was discarded.
The exact lower-level cause of that first readiness timeout is therefore unproven,
not an asserted OAuth, database, provider or memory failure. No Google calls or
MCP operation was run by the diagnostics.

The targeted resilience fix uses a 45-second monotonic health-only startup budget,
one-second request deadlines and a bounded interval. It does not restart or retry
the child API, provider mutation or MCP commit. A terminated child fails immediately.
The stock persisted approval and all TTL/stale/immutable checks still run again
after readiness, immediately before the single commit. Preview TTL is unchanged.
The helper is included in the new exact-source harness manifest.

Recovery requires a **new** JIT N preview and fresh human approval on a tested
source. The failed old preview/history/runtime is not replaced or reused. Only
after a VERIFIED new N commit may stock rollback preview be created; rollback
has its own human approval. CPC currently remains `0.10 USD`; no rollback mutation
is needed for the failed attempt.

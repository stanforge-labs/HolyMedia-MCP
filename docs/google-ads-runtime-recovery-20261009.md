# Stage 2–4 TEST runtime recovery — 9 October 2026

The historical preview/commit pair used source `99ce4f0` and immutable image
`sha256:77f70b71f61953626d18c8e66f1315c3db1df8bc6848371a312866134580e9bd`.
Tested code was deliberately not hot-mounted into that running runtime:
preview identity, payload, approval and historical claims remain immutable.
Differences through `b259bfd` in API source concern Stage 0 Search clone;
Stage 2 N contracts, configuration and stock API routing did not change.

Independent diagnostics ran the exact `b259bfd` API image, with disposable
DB/Redis and the existing sole TEST key. Three API starts completed readiness
and authenticated DB-only `list_accounts`, `get_account_status`, and typed
`tools/list` checks. Timings including MCP probes: 9560, 7752, 7457 ms.
Each start initially observed a Redis readiness warning/503, then DB/Redis
OK/200. A diagnostic transport vetoed all external Google/OAuth requests,
previews, approvals and commits, including under commit-enabled config.

This demonstrates current technical readiness, not the exact cause of the
historical timeout. Original stderr was ignored; 45-second health waiting is
bounded resilience, not proof of a root-cause repair. The new commit harness
retains only fixed startup error classes, exit code and signal; raw logs,
credentials, URLs, stacks and arbitrary messages never enter evidence.

Regression coverage includes delayed/failed/unavailable startup, missing
readiness, expired/consumed/changed previews, transport denial and no-mutation
failure boundaries. Fresh provider READ confirms fixture unchanged and group
CPC 100000 micros. Existing key expiry remains 10 October 17:51:17 UTC+5.

Next N run must use a new directory and manifest (now including startup
diagnostics), matching immutable image revision, and a new human approval.
Old expired preview and durable attempt claims must never be retried. K is
referenced by verified full-file hash and not rerun. No provider mutation was
performed during recovery. Stock inverse preview/rollback semantics remain
mandatory after any separately approved, verified N change.

Q/R still require actual native clients and a separately accessible private
MCP/OAuth endpoint. Localhost port 4402 serves human approval only; publishing
it is not a client integration and must not enlarge the public write surface.

Evidence: `artifacts/google-full-scope/runtime-recovery-readiness-20261009.json`.
Original N/audit/checkpoint history is preserved. Production, main and the
Stage 0–1 release candidate remain unchanged.

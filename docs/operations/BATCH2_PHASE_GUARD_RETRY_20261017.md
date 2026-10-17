# Batch 2: phase-aware TEST maintenance retry

**Execution result:** [ROLLED BACK on strict new swap-out during first Web image pull](BATCH2_PHASE_GUARD_RETRY_RESULT_20261017.md). The complete maintenance-state guard passed; the full-stack post-start guard did not begin. Do not rerun this one-use procedure.

**Scope:** one newly authorized TEST Web/API maintenance attempt. The previous
[as-run scripts and protected rollback](BATCH2_TEST_ONLY_MAINTENANCE_RESULT_20261017.md)
remain in commit `fb2cd777f2fadd3ea142e8d688d036870b16a0fe` and on the VPS.
The retry uses a new root-only run directory; it never resumes the consumed
attempt. Production, TEST data services, Nginx, Google accounts and write gates
are outside the replacement scope.

## Phase contract

`maintenance` means both TEST API/Web are stopped while TEST PostgreSQL/Redis
and all five production containers stay healthy. This phase has its own policy:

- 600 seconds with no missing metrics, clock gap, OOM, approval/commit, container
  change or HTTP failure; production ready latency strictly below 0.8 s.
- `MemAvailable >=819200 KiB`, `SwapFree >=262144 KiB`, disk `>=10240 MiB`,
  PSI full `<1.5`, PSI some `<2.0`, and **zero new pswpout pages**.
- `pswpin` and major faults are recorded. An isolated burst is diagnostic. Three
  consecutive complete 60-second bins with **both** `pswpin >=64 pages` and
  `pgmajfault >=64` each fail as sustained paired activity. This conservative
  three-minute rule captures continuing reclaim while allowing the previous
  one-second `+251/+184` cold-page burst to be observed for the full interval.
  PSI and latency limits still abort immediately, independently of these bins.

The `full` phase retains the original Web-only policy **plus** exact
`pswpout delta=0` for TEST API. No threshold of the full policy changes. The
previous 1.1-second trace remains **FAIL** for incompleteness; the regression
shows only that the same isolated burst would not abort an otherwise complete,
healthy maintenance interval.

## One-use execution boundary

`batch2_test_maintenance_once_v2.py` is pinned to a new `phase-v2-once`
rollback directory and the same immutable TEST Web/API digests as the approved
plan. Before stopping TEST it verifies exact old images/config, zero pending
previews/OAuth/long transactions, production health, disk budget, and fresh
root-only TEST DB/Redis backups. After TEST stop it runs the 600-second
maintenance guard. On PASS it pulls Web then API one at a time, starts API then
Web without parallel old/new instances, verifies routes/flags, and runs the
600-second full guard. Any critical failure triggers one old-image rollback
and STOP. The script's digest, candidate labels and protected manifest must
match before execution. No result short of the full guard is Batch 2 PASS.

Local regression: `test_maintenance_guard_policy.py` covers the historical
burst, short trace, strict swap-out, PSI/RAM/OOM/production failure, sustained
paired activity, missing metrics and phase routing. Linux CI evidence and
the actual one-use result are recorded separately after execution.

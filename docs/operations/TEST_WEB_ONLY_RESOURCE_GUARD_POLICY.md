# TEST Web-only resource guard profile v1

Status: engineering candidate, awaiting exact-source Linux CI and a fresh full-stack preflight. Scope: **one TEST Web image replacement only**. This file and `scripts/ops/web_only_*` do not change `RECOVERY_PMAX_RESOURCE_10M.sh`, TEST API policy, production, Linux settings, or Google Ads permissions.

## Evidence and policy boundary

The existing no-swap guard rejected three recent full-stack 600-second observations with +37, +6 and +18 pages of `pswpout`, even though their RAM floor, PSI full, OOM and health checks passed. It also rejected materially unsafe +388 and +940-page intervals; the +940 case fell below the 819,200 KiB MemAvailable floor. A separate 60-second read-only calibration for the newly required host major-fault counter recorded `pgmajfault +1`, `pswpin +1`, `pswpout 0`, PSI some/full peak 0.00 and OOM 0. These observations are not evidence that all low page-outs are harmless or that Node healthchecks caused them.

The Linux kernel defines PSI `some` as time with at least one task stalled, and `full` as time when all non-idle tasks are stalled. The exported `avg10` is a recent ten-second percentage; `total` is cumulative microseconds ([kernel PSI documentation](https://docs.kernel.org/accounting/psi.html)). Thus a tiny page-out count alone is not treated as a healthy result: the profile also requires low PSI, no OOM, adequate memory, responsive production and no sustained paging.

| Criterion in one 600-second interval                 | Fail condition                                                                                                                                                       |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MemAvailable, free swap, free disk                   | Any sample below 819,200 KiB, 262,144 KiB, or 10,240 MiB respectively                                                                                                |
| PSI full / some avg10                                | Any sample ≥1.5% full or ≥2.0% some                                                                                                                                  |
| Swap-out                                             | >64 pages total, or >32 pages in any conservatively rounded rolling 60 seconds                                                                                       |
| Swap-in                                              | >64 pages total, or >32 pages in any rolling 60 seconds                                                                                                              |
| Major faults                                         | >256 total, or >64 in any rolling 60 seconds                                                                                                                         |
| Sustained activity                                   | Swap-out in three consecutive minute bins, or bidirectional swap-in/out in two consecutive minute bins                                                               |
| OOM                                                  | Any new host OOM kill or Docker OOM flag                                                                                                                             |
| Production `/ready`                                  | Any HTTP failure or latency ≥0.8 s; if any swap-out occurs, latency ≥0.5 s also fails                                                                                |
| TEST API ready, Web auth/approval, production health | Any HTTP failure; redirects are not treated as HTTP 200                                                                                                              |
| Containers and approvals                             | Required TEST and production containers unhealthy/restarted/replaced during the interval; pending/approved/in-flight TEST preview count other than 0 at start or end |
| Evidence completeness                                | Fewer than 600 seconds, missing counter/health result, nonmonotonic counter/clock, or sample gap >3.5 s                                                              |

Swap limits are pages, not KiB. The 64-page total equals 256 KiB on the current 4 KiB-page host and is over six times below the observed +388-page pull-associated pressure. The 60-second cap, sustained-activity rules, PSI `some`, major faults and latency association are extra safety checks. These numbers are scoped to this TEST Web trial and do **not** establish a safe TEST API deployment. The original no-swap policy and all previous FAIL evidence remain recorded.

## Historical backtest

The fixture `scripts/ops/fixtures/web_only_guard_history_20261016.json` contains only measurements actually retained in the evidence ledger. The policy returns:

| Historical interval                          | New profile result | Basis                                                      |
| -------------------------------------------- | ------------------ | ---------------------------------------------------------- |
| +940 pages; MemAvailable minimum 765,628 KiB | **REJECTED**       | Total swap-out and RAM floor                               |
| +388 pages; MemAvailable minimum 887,796 KiB | **REJECTED**       | Total swap-out                                             |
| +37 pages; RAM/PSI full/OOM passed           | **INDETERMINATE**  | Rolling 60-second, PSI some and major-fault history absent |
| +6 pages; RAM/PSI full/OOM passed            | **INDETERMINATE**  | Swap totals alone cannot establish full policy PASS        |
| +18 pages; RAM/PSI full/OOM passed           | **INDETERMINATE**  | Swap totals alone cannot establish full policy PASS        |

No historical unsafe case is reclassified as PASS. The lower totals are **not retroactively accepted**; one fresh, complete trace must satisfy every criterion before pull, and another after pull. The existing Web image must be stopped before the sole candidate starts. A full post-start trace is required; a failure triggers one protected Web-only rollback with no automatic retry. The owner has authorized only this conditional TEST Web trial; TEST API and production retain their original boundaries.

The host-side observer `scripts/ops/web_only_resource_guard.py` collects the new counters in one root Python process, performs Docker inspect and preview-count reads only at interval boundaries, and samples HTTP routes approximately every ten seconds. Its own PSS and CPU use are reported. Optional mode-0600 trace output contains metrics only, with no environment, OAuth credential or protected DB data. The pure policy and historical boundary tests run in Linux CI.

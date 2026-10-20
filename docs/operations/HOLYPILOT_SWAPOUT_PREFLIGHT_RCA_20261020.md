# HolyPilot: 93-second production-only preguard swap-out review

Date: 20 October 2026. This is an offline review of existing protected evidence,
not a new VPS observation or a release authorization. The complete raw trace
remains root-only at
`/var/backups/adforge-mcp/holypilot-web-stop-diag-20261020T1625Z/`.
`preflight-trace.jsonl` SHA-256:
`d4b71b3401c02b07c4e235448028d67c11905c700743647995b8679048d7844b`.

## Exact event and guard decision

The trace contains 93 host samples, four Docker/HTTP checkpoints and a final
result. Between the first sample (t=0.001245 s) and t=92.481513 s, host
`pswpout` was unchanged at 1,411,283 pages. Between t=92.481513 and
t=93.484923 s it increased by **90 pages** (approximately 360 KiB), in one
observed one-second burst. There were no other recorded swap-out increments.
Host `pswpin` stayed unchanged; `pgmajfault` increased by five over the entire
observation and by zero across the swap-out burst. `SwapFree` declined by
256 KiB overall. These counters use different accounting and are not a
per-process attribution.

| Signal | Recorded result |
|---|---:|
| Exact first-to-last sample interval | 93.48367840703577 s |
| `pswpout` / `pswpin` delta | +90 / 0 pages |
| `pgmajfault` / OOM-kill delta | +5 / 0 |
| `MemAvailable` first / last / minimum | 1,082,188 / 1,074,952 / 1,070,424 KiB |
| `SwapFree` first / last / minimum | 1,584,892 / 1,584,636 / 1,584,636 KiB |
| Memory PSI some/full avg10 | 0 throughout |
| Free disk | 11,691 MiB throughout |

`/health` and `/ready` each returned HTTP 200 at t=0.001, 30.548, 60.846 and
91.044 s. Their respective maximum measured latencies were 0.2079 and
0.1998 s, below the unchanged 0.8 s limit. The final HTTP checkpoint was
about 1.4 seconds before the swap-out burst began; **there is no HTTP sample
after the burst in this trace**. At all four external checkpoints, five
production containers were running/healthy without restarts or OOM, and four
retired TEST containers were exited with `restart=no`. No Web stop was attempted.

The protected result is `FAIL`, with exact reasons `swap_out_600s`,
`swap_out_60s`, and `observation_incomplete`. The first two are the triggering
resource violations: 90 pages exceeds the unchanged limits of 64 pages over
600 s and 32 pages over 60 s. `observation_incomplete` records that the guard
correctly stopped before its required 600 seconds; it is not a separate
memory-pressure diagnosis.

## Interpretation and unresolved source

This trace proves a short host-level swap-out event while production was
running normally; it does **not** identify the process/cgroup or prove RAM
exhaustion. Available memory stayed above 1 GiB, memory PSI and OOM stayed
zero, and no swap-in or major fault accompanied the burst. Conversely, the
event cannot be declared harmless: the trace has no simultaneous cgroup
reclaim/swap data or HTTP observation after it.

The current limits are achievable on this VPS: an earlier complete
`PRODUCTION_ONLY_V1` 600-second run had zero swap-out, 1,046,544 KiB minimum
MemAvailable, zero PSI and healthy HTTP. Other historical protected runs
recorded short swap-out bursts, including +72 pages after image delivery and
larger activity coincident with extra SSH/journal queries. Those distinct
conditions do not establish a normal baseline for idle production. There is
insufficient evidence to name the current +90-page source or to change a
release PASS criterion.

## Prepared passive observation, not executed on VPS

`production_web_passive_swap_watch.py` reuses
`production_web_swap_probe.py`. It discovers current process cgroups from
procfs once, selects at most 16 PIDs and 16 prioritized cgroups, records
omitted-PID/cgroup coverage, and samples host
vmstat/meminfo/PSI plus selected PID/cgroup counters at one-second intervals.
It uses no Docker CLI, network, process environment, command line or user
data. The proposed single observation is 120 seconds, bounded at 180 seconds;
the actual PID/cgroup selection must pass the existing 20 ms p95 / 40 ms max
capture-overhead gate before sampling. A missing sample or failed capture is
`INCOMPLETE`, never a release PASS. Output is a new root-only directory with
0600 evidence files. Cgroup `memory.swap.current` changes, reclaim counters
and PID `VmSwap`/major-fault changes are **correlations**, not direct proof of
which process generated each host swap-out page. A newly started process may
be outside the initial PID shortlist; cgroup coverage and omissions remain
visible. Broad system/user slice counters remain in the selection when present,
but a source outside the selected leaves may only be localized to a broad
slice or remain unattributed.
Parent and child cgroup counters may overlap and must not be summed as
independent contributors. The trace can narrow a candidate source but cannot
directly attribute every host swap-out page to a PID.

The owner separately authorized one passive run. Its first, broader revision
selected 64 PIDs and 46 cgroups but **stopped before observation** because ten
probe benchmarks measured median 38.781 ms, p95 50.075 ms and maximum
52.119 ms, exceeding the 20 ms p95 / 40 ms maximum budget. No trace was
created; protected overhead, selection and `INCOMPLETE` result are in
`/var/backups/adforge-mcp/holypilot-passive-swap-20261020T170221Z/`.
The approved run is consumed. The narrower 16/16 revision above was prepared
offline only; its VPS overhead and attribution coverage remain unverified.
Another VPS run needs a new separate approval and output directory. Do not
run a 600-second guard, stop Web, pull an image or attempt a release as part
of any passive observation.

## Release-policy options for a later owner decision

**A — Preserve `PRODUCTION_ONLY_V1`.** Keep `pswpout >32` pages per 60 s or
`>64` per 600 s as unconditional FAIL. If the passive trace identifies an
optional, safely stoppable source, remove that source separately and verify a
complete unchanged guard. No source has yet been identified. This preserves
the strictest current gate but may continue to block on isolated background
events.

**B — Propose, but do not implement, a pressure-aware profile.** Retain the
same numeric 32/60 and 64/600 swap-out triggers but classify an *isolated*
crossing as an information event only after a full 600-second observation if
all of these hold: no OOM; no swap-in; no direct reclaim increase; no sustained
swap-out across three consecutive minute bins; MemAvailable and SwapFree remain
above the current floors; PSI some/full remain below the current limits;
all required Docker checks and `/health`/`/ready` checks pass their current
status/latency limits; and the event has a subsequent successful HTTP/Docker
checkpoint. Any missing signal, repeated/sustained pressure or failed check
remains FAIL. All other existing guard thresholds and the 600-second minimum
remain hard gates. The exact difference is that two unconditional swap-out
FAIL reasons could become recorded warnings under *all* corroborating safety
conditions. The current guard does not record `pgscan_direct`; option B would
have to add that signal and fail closed if it is unavailable. This can admit a
release the current guard blocks, so it is a real reduction in conservatism
and requires source evidence, regression tests, and separate owner approval.
It is not used by current scripts.

**Current decision: NO-GO for Web and API release.** The candidate Web image
being cached does not overcome the failed preguard. The API image requires a
separate delivery and guarded startup plan. The minimum no-cost next step,
if the owner wants more attribution evidence, is one newly approved run of
the narrower procfs-only observer after exact-source Linux CI PASS. If it
shows no event or cannot pass its overhead gate, record `INCONCLUSIVE` and do
not infer a source or relax the policy. This work does not establish a need
for another VPS, nor does it prove that the current VPS can safely complete
both releases.

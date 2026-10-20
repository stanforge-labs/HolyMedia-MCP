# HolyPilot production release policy V2 — owner decision draft

Date: 20 October 2026. Source branch: `codex/qrs-test-auth-recovery`.
Status: **offline opt-in implementation only**. This document neither activates
V2 on the VPS nor authorizes a Web/API cutover. `PRODUCTION_ONLY_V1` remains the
default, and its policy, collector, protected images and thresholds are unchanged.

## Evidence boundary

The protected 93.483678-second preguard trace recorded one +90-page host
`pswpout` burst, zero swap-in, zero OOM, zero memory PSI and more than 1 GiB
`MemAvailable`. Its final HTTP/Docker checkpoint preceded the burst. It lacks
`pgscan_direct`. It **fails V1 and V2**: the required 600 seconds and post-event
evidence are absent. The two earlier +583/+631-page host swap-in bursts occurred
while stopping the old Web and before candidate startup. Their saved traces do
not establish the responsible PID/cgroup or direct-reclaim state, so neither
historical incident is retrospectively a V2 PASS. The separately authorized
passive probe stopped at its overhead gate before sampling. Source attribution
therefore remains **INCONCLUSIVE**.

## Decision table

| Gate | V1 active | V2 opt-in proposal |
| --- | --- | --- |
| Pre/post duration and checks | 600 exact monotonic seconds, 5 healthy production + 4 exited TEST, HTTP `/health` and `/ready` | Identical; incomplete/missing/post-event checks are FAIL |
| Swap-out threshold | More than 32 pages/60 s or 64 pages/600 s is immediate FAIL | Same values remain diagnostic triggers. **Precutover only:** one contiguous burst of at most 3 samples, 5 s and 256 pages can become WARNING only after full 600 s and a completed Docker/HTTP check after the burst. Poststart remains V1-hard. |
| Swap-in/major faults in 600 s guard | V1 thresholds remain hard | Unchanged hard FAIL, including during preguard and poststart |
| `stopping-old` Web phase | More than 32/60 or 64/600 swap-in pages, or 64/60 or 256/600 major faults, immediately fails watchdog | An isolated old-Web-stop burst may be provisional up to **1024 page-ins and 512 major faults**, at most 3 consecutive samples/5 s. It requires no swap-out, direct reclaim, OOM or meaningful PSI. Two subsequent stable old-stopped samples and a new watcher baseline must be acknowledged **before** candidate Compose. Otherwise rollback. |
| Candidate startup | V1 watchdog thresholds and 180 s | Original swap/major-fault thresholds remain hard from a separately armed candidate baseline. The old-stop exception cannot carry forward. |
| Critical pressure / integrity | Memory ≥819200 KiB; SwapFree ≥262144 KiB; disk ≥10240 MiB; PSI full <1.5 and some <2.0; OOM/restarts/container/HTTP failures block | Same floors/ceilings and blockers. Any increase in host `pgscan_direct`, repeated or sustained swapping, missing signal, sample gap, unverified phase, or incomplete 180/600 s is also a hard FAIL. Old-stop warning additionally requires PSI full=0 and some ≤0.1. |

The 256-page preguard and 1024-page old-stop ceilings are **new upper safety
bounds**, not claims that those volumes are universally harmless. The old
32/64-page triggers are preserved and recorded. V2 is less conservative than
V1 for two narrowly defined events; an accepted warning still carries risk of
an unattributed process consuming memory. It is not appropriate to infer that
zero PSI/OOM alone proves safety. V2 adds direct reclaim, phase and post-event
evidence to constrain that risk; missing evidence fails closed.

## Offline mechanism and release sequence

- `production_only_guard_policy_v2.py` evaluates the full trace against V1,
  then removes only precutover swap-out threshold reasons if every corroborating
  condition is true. It never masks any other V1 reason. The V2 collector reads
  host `pgscan_direct`, records the actual completion time of Docker/HTTP
  checks, and continues beyond a provisional swap-out trigger. It fails early
  on direct reclaim, repeated swap or another hard signal.
- `startup_watch_v2.py` retains the 180-second limit and watches old-Web-stop,
  candidate-start and candidate-running phases. The adapter waits for
  `old-stop-cleared` after two stable samples and then `candidate-armed` after a
  fresh sample before Compose. A failure or missing handshake triggers the
  existing **single** cached-image rollback; no candidate is started on an
  unverified old-stop event. API old-stop has no swap-in exception.
- `production_only_release_once.py --prepare web --profile PRODUCTION_ONLY_V2
  --run-dir <new-protected-path>` is the only V2 selection path. The default
  remains V1. The protected plan stores the profile and hashes of all staged
  V2 sources. `--execute` reads that plan; Compose retains `--pull never`,
  `--no-build`, `--no-deps`, one target service and one rollback. TEST remains
  exited/restart=no. The pre/post guards retain 600 exact seconds each.
- Existing Web branding and API candidate image identities are unchanged.
  API image delivery, cache verification and its own approval are separate.
  No full-stack or simultaneous Web/API cutover is implied.

The offline regression suite covers the exact +90 and +583/+631 magnitudes as
**synthetic complete-evidence scenarios**. That demonstrates how V2 could
change a future decision, not that the historical incomplete traces passed.
It also asserts FAIL for actual 93-second evidence, OOM, PSI, low RAM/swap,
direct reclaim, repeated/oversized or mixed swap, HTTP failure, missing
post-event checks, incomplete duration, candidate-phase swap-in, absent phase
handshake and rollback without candidate startup. V1 tests run alongside V2.

## GO / NO-GO and owner stop point

**GO to owner review of the V2 policy only** after exact-source Linux CI PASS.
**NO-GO for activation or production Web/API release** under this task. The
owner must separately approve (1) installing/using V2 on the VPS, with the
explicit 256/1024/512 and phase-warning semantics, and later (2) one specific
Web-only cutover from a new protected checkpoint. Approval of V2 does not
authorize a release. The active V1 remains unchanged until that decision.

If a future one-time Web attempt fails V2 on true pressure and rollback
completes, do not repeat the same release. A no-new-VPS fallback is to host
the Web process on the existing WSL2 machine and proxy it through an approved
persistent HTTPS connection; this would require a separate security, uptime,
DNS/Nginx and recovery review because Windows/WSL2 availability would become
a production dependency. It is a contingency proposal, not an implemented
deployment or a claim of equivalent reliability.

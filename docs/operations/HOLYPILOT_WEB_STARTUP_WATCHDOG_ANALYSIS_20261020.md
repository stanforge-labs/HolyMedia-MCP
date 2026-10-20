# HolyPilot Web startup watchdog: 19 and 20 October 2026

## Result and evidence boundary

**INCONCLUSIVE for the process that caused swap-in.** The repeated failure is
confirmed during the old-Web stop interval, before any candidate `compose up`.
The old phase label `starting` was misleading: `web-start.begin` was written
before `docker stop` of the old Web. The new image was not run in either incident.
The exact PID or cgroup responsible for host `pswpin` cannot be determined from
the retained one-second host-only startup traces.

The existing protected run archives were read once, without Docker or service
mutations, with the owner's separate read-only permission. The original evidence
remains in:

- 19 October: `/var/backups/adforge-mcp/holypilot-web-cache-approved-20261019T1017Z/run/`.
- 20 October: `/var/backups/adforge-mcp/holypilot-web-production-only-20261020T1155Z/`.

Times below are UTC. File modification times and trace epochs have millisecond
differences; they are not a precise Docker event log.

| Event | 19 October | 20 October |
| --- | --- | --- |
| Pre-cutover guard | PASS, 601 seconds | PASS, 600.001596 seconds |
| Watchdog ready / first trace | 10:27:41.959 / 41.965 | 12:15:43.984 / 43.989 |
| `cutover-attempted` | 10:27:42.172 | 12:15:44.172 |
| Legacy `web-start.begin` | 10:27:42.176 | 12:15:44.176 |
| Second startup sample / FAIL | 10:27:42.967 | 12:15:44.991 |
| Host `pswpin` / `pgmajfault` increase | +631 / +415 | +583 / +380 |
| Rollback marker | 10:27:43.340 | 12:15:46.840 |
| Rollback verified | Recorded in release evidence | 12:15:57.196 |

In both traces the first sample was `before`, the second `starting`, and the
watchdog reason was `swap_in`. In the old code, `starting` meant only that the
pre-stop `web-start.begin` marker existed. The adapter then invoked `docker
stop`, verified the old container was exited and observed `startup-watch.fail`
before calling candidate `compose_replace`. The exact start/end timestamps of
the `docker stop` syscall and Docker lifecycle event were not retained; the
stop completed between the marker and the failure branch. Neither archive
contains a candidate-running marker. The 19 October release log had no new-Web
`up` command; the 20 October adapter did not call it.

There was no observed swap-out or OOM in either one-second failure. PSI was zero
on 19 October and low on 20 October; available memory exceeded 1 GiB in both
startup windows. These observations do not establish active memory exhaustion.
They are compatible with reading previously swapped cold pages during Docker
or process activity, but could also reflect unrelated host activity. Host
`pswpin` and `pgmajfault` do not attribute pages to Node, Docker or a cgroup.
The existing watchdog correctly failed against its unchanged swap-in limit.

## Offline correction

The five-service release adapter now writes protected, timestamped phase events
and markers in this order: `before-stop` → `stopping-old` → `old-stopped` →
`starting-candidate` → `candidate-running`. `web-start.begin` is written only
at candidate start. The startup trace uses these phase names; an attempted
cutover that does not reach `candidate-running` within the original 180-second
window fails closed. The legacy nine-container script transform was aligned,
although that runner remains disabled for the retired-TEST topology.
The adapter also rechecks the watchdog failure marker immediately before
candidate Compose, closing a narrow interval between the old-stop check and
the start command.
The watchdog now writes its initial trace sample before publishing `ready`.
The adapter rejects a dead observer and requires a `PASS` result with at least
180 exact monotonic seconds. Missing output or rounded duration cannot produce
a successful cutover. The final resource sample is taken and evaluated after
the full 180-second interval, rather than ending after a sleep following the
previous sample.

No watchdog numeric threshold, sampling interval, timeout, resource guard,
TEST state or production service was changed. The current recovery still makes
one protected Compose rollback from the cached baseline image. Offline tests
cover a resource FAIL after old stop and before candidate start, marker failure,
phase order, the old-Web-exited recovery case, no TEST start and one rollback.

## Recovery option, not enabled

For a future pre-candidate failure, `docker start` of the original stopped Web
container could avoid a Compose recreate **only** if its container ID and image
ID match the protected checkpoint, it is still `exited`, the Compose/env hashes
match, no candidate container/start marker exists and all other production and
retired TEST identities remain intact. Docker stop normally leaves that
container available. This optimization has not been exercised against the
production recovery path, so the proven Compose rollback remains in force.
Any alternative must have an offline failure test and a safe fallback before
it is eligible for a separately approved release.

## Minimal attribution for a separately authorized observation

Extend the **existing** one-second watchdog trace, rather than start a second
SSH/Docker polling process. Capture before-stop and each subsequent sample:

- `/proc/vmstat`: `pswpin`, `pswpout`, `pgmajfault`, `pgscan_direct`,
  `pgscan_kswapd`, `oom_kill`;
- `/proc/meminfo` and memory PSI;
- selected Web and Docker cgroups: `memory.stat` `pgmajfault`, anon refault,
  scan/steal fields and `memory.swap.current`;
- matching live PIDs: `/proc/<pid>/stat` major faults and start time,
  `/proc/<pid>/status` `VmSwap`, and `/proc/<pid>/cgroup`.

Identify cgroups once from the protected checkpoint and procfs before the
window; avoid repeated Docker CLI, `journalctl`, `systemctl` and extra SSH.
Record monotonic and UTC timestamps with each sample, including the sample
immediately before `docker stop`, the first after it and the rollback. Test
the sampler's overhead offline before any server use. Even correlated major
fault and cgroup deltas are not by themselves proof of which PID produced
each host swap-in page.

## Policy decision and release gate

An alternate **phase policy** could treat isolated page-ins during
`stopping-old` separately from candidate startup, while retaining immediate
FAIL for OOM, swap-out, PSI, RAM/health failures and keeping all measured
counters visible. This would change the meaning of the startup protection;
it is **not implemented or approved**. The phase correction alone will make
future traces accurate but will not turn these two swap-in profiles into PASS.

**NO-GO for another Web cutover** under the unchanged watchdog until the
source is sufficiently attributed or the owner separately approves an
evidence-based phase policy and its regression tests. Any future observation
that stops production Web, any policy change and any release require separate
owner authorization. The previous release approval is exhausted.

# HolyPilot: one old-Web stop attribution window — preparation

## Evidence and decision boundary

The 19 and 20 October protected traces place both host swap-in threshold
crossings in the old-Web stop interval, before any candidate container started.
They do **not** identify a PID or cgroup source. The timeline and exact
limits are preserved in
`HOLYPILOT_WEB_STARTUP_WATCHDOG_ANALYSIS_20261020.md`. No Web release or
watchdog policy change is part of this diagnostic.

**Stage A is offline only.** The scenario below must not be launched until the
owner separately approves one production Web stop. A passing CI run does not
authorize a stop.

## Prepared mechanism

- `production_web_swap_probe.py` samples host `pswpin`, `pswpout`, major
  faults, reclaim and OOM; `MemAvailable`, `SwapFree` and memory PSI; selected
  Web/Docker PID major faults, process start ticks, `VmSwap` and cgroup; and
  cgroup `memory.stat`/`memory.swap.current`. Disappeared PIDs/cgroups are
  explicit. It reads no environment, command line, tokens or client data.
- `holypilot_web_release_once.py` can generate a **diagnostic-only** variant
  of the existing verified startup watchdog. All fail thresholds and the
  original 180-second window remain unchanged. The diagnostic variant records
  attribution at 0.5-second intervals only during stop/restore, and at
  one-second intervals otherwise. The normal release path is unchanged.
- `production_web_stop_diagnostic_once.py` checks the five active production
  and four retired TEST identities, pending operations, baseline image and
  config/source hashes; runs the unchanged 600-second production-only guard;
  benchmarks procfs overhead; then permits one old-Web stop only inside a
  transient systemd service with `ExecStopPost` recovery. There is no candidate
  image reference and no candidate start path.
- A boundary snapshot is written just before `docker stop` and immediately
  after it, even if the stop command fails. Timestamps use UTC epoch and
  monotonic clocks. Phases are `before-stop`, `stopping-old`, `old-stopped`,
  `restoring-old`, `restored`.
- Recovery first runs `docker start` on the **same** old Web container ID and
  image. If this fails, one cached-image Compose rollback is permitted with
  `--pull never --no-build`; it requires unchanged source/config hashes and
  unchanged other production/retired TEST identities. `ExecStopPost` resumes
  an interrupted direct-start recovery with that single fallback. All five
  production containers, retired TEST identities and public routes are
  checked after restore. A separate 600-second post-restore guard follows.

Trace and checkpoint files are created in a new root-only run directory with
0600 files. Existing protected release archives remain untouched.

## Time and operational limit

The Web is stopped only after the complete 600-second preguard and probe
benchmark pass. The stop command has a 12-second process timeout; original
`docker start` has 15 seconds, health recovery 25 seconds, and route probes
3 seconds each. The single Compose fallback has a 90-second process timeout.
The transient service has `RuntimeMaxSec=300` and `TimeoutStopSec=180` for
the external recovery command. Thus the automatic restoration window is
**at most 480 seconds from service start under a responsive Docker/systemd**;
the intended Web outage is much shorter. A Docker daemon or host failure can
prevent any software-only guarantee of an absolute outage ceiling. The
operator must remain available to follow the root-only trace and perform
manual recovery if both automatic paths fail. No second stop is allowed.

## Offline checks

The `test_production_web_*.py` regressions cover procfs/cgroup capture,
vanishing/reused PIDs, root-only prepare, preserved watchdog thresholds,
direct invocation refusal, single stop, recovery on stop failure, pre-stop
watchdog FAIL, exact-ID direct start, one cached Compose fallback, unrelated
production/TEST drift and interrupted recovery. Local WSL systemd transient
service tests confirmed that `ExecStopPost` runs after a failed main process.
In a local 40-snapshot overhead sample with 13 selected PIDs and three
cgroups, p95 was 3.40 ms and max 3.88 ms. Before any VPS stop, the scenario
benchmarks the actual selection and refuses to proceed above 20 ms p95 or
40 ms max. These local measurements do not predict the VPS result.

## Stage B sequence, only after separate owner approval

1. Stage the exact CI-passing scripts to a root-only source directory. Create
   one fresh root-only run directory. Run `--prepare`; inspect the protected
   plan, source hashes, old image and five-plus-four topology. If the snapshot
   differs, stop with no Web mutation.
2. Run `--preflight`: one unchanged `PRODUCTION_ONLY_V1` 600-second guard. A
   FAIL or incomplete interval ends the attempt with no stop.
3. Run `--launch` **once**. It starts the `--observe` action in a transient
   service with `ExecStopPost=... --recover`, confirms that backstop before
   stop, records the immediate boundary snapshots, runs one `docker stop` on
   the existing Web, and restores the old Web. It never references the
   branding image or production release adapter's cutover action.
4. Confirm old Web/API/MCP/OAuth routes, five healthy production containers,
   four exited TEST containers with `restart=no`, and the full 600-second
   post-restore guard. Read protected evidence only after the service ends.
5. Correlate host counters with cgroup/PID deltas and event ordering. A
   cgroup major-fault increase or `VmSwap` decrease is **supporting evidence**,
   not by itself proof that one process generated each host swap-in page.

**Current release gate: NO-GO** for another Web branding cutover until the
attribution result or a separately approved watchdog phase policy provides a
technical basis. The diagnostic stop itself also requires new owner approval.

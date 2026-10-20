# HolyPilot Web-only production release: stopped before guard and cutover

Date: 20 October 2026. Outcome: **BLOCKED before production mutation**.

The owner authorized one Web-only cutover using the cached branding image `sha256:1c39775ffbb095cc7d9037dfbea874be146ad25fe88ce255eaa794b0ccfd9ec0` (branding source `fa9805b0adeed1b225e34605b02ad0b67d5ebc33`) with rollback to image `sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833`. The prepared release adapter was from source commit `3ab273781398f46539c7355b68a69ce610f6e5c4`. Its three exact-source Linux workflows passed; local operations tests, format, lint, typecheck and secret scan passed.

## Preflight and protected preparation

Read-only preflight found five production containers running/healthy; four retired TEST containers exited with `restart=no` and exact IDs/images matching the protected TEST checkpoint. The six pending production preview/commit/OAuth counters were all zero. Cached candidate and rollback image digests and OCI revisions matched. Available memory was 1,072,488 KiB, SwapFree 1,565,692 KiB, free disk 11,704 MiB and PSI some/full 0. The cache-only disk floor remains 11,500 MiB; the full resource guard floor remains 10,240 MiB.

The existing release adapter created a root-only plan and copies of the Compose, environment and Nginx configuration at `/var/backups/adforge-mcp/holypilot-web-production-only-20261020T1100Z/`. Its directory is mode `0700`, protected plan/config files mode `0600`; all source and config hashes matched at preparation. This checkpoint is retained and must not be reused for a future attempt after source changes.

## Failure and state after it

The single authorized `--execute` returned immediately from the initial `verify_plan`, **before** invoking the 600-second pre-cutover guard, startup watchdog, Docker stop, Compose or a Web replacement:

`RuntimeError: topology_fail:container_baseline_incomplete`

The release plan correctly stores baseline identities for the five production containers. The shared `container_reasons` function erroneously required a nine-container baseline even though the four stopped TEST identities are separately checked against the protected checkpoint. Offline regression now covers both the five-production release baseline and the nine-row guard observation, including incomplete baseline and changed production image failures.

A separate read-only post-failure check confirmed all five production IDs/images unchanged and healthy, all four TEST IDs/images unchanged, exited and `restart=no`. `cutover-attempted`, `published`, `rollback-attempted` and `precutover-trace.jsonl` were absent. The old Web is still serving production. No rollback was required because no cutover occurred. No second `--execute` was run.

## Next release boundary

The correction is offline source-only. It must pass Linux CI, then be staged in a **new** protected run directory and validated without container mutation. The failed checkpoint and original protected trace/evidence remain intact. A fresh owner approval is required for any new `--execute`; prior authorization is consumed. The next attempt still needs a complete 600-second pre-guard, one Web cutover, startup watchdog, functional checks and a complete 600-second post-guard. No threshold, TEST state or production service was changed to work around this failure.

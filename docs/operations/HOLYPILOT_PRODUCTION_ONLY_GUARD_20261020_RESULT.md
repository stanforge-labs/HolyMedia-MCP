# HolyPilot production-only guard: one authorized read-only observation

Date: 20 October 2026. Source branch: `codex/qrs-test-auth-recovery`.
Source commit tested by CI: `3c2b983c6194e5d779a5a34fe7ffacd71e262cd1`.

## Scope and protected evidence

The owner authorized **one** 600-second read-only run after Linux CI PASS. No production cutover, Docker pull/build, TEST start, service restart, configuration change, or Google Ads operation was performed. The only VPS writes were the root-only staged guard and its result/trace files in:

`/var/backups/adforge-mcp/holypilot-production-only-guard-20261020T100752Z/`

The directory is mode `0700`; `result.json` and `trace.jsonl` are mode `0600`. The trace has 616 JSONL records. Its independently checked SHA-256 is `d132b72aa17edf40745948b72179f15c57e4d3560809585a7650664e6651ee69`, matching the runner result. The result SHA-256 is `56de64de8dacbf04c3e40a1c6f974a38a120d58b5df972802ad2abe54c8dcee7`. The protected TEST retirement checkpoint remained the source of exact TEST container IDs/images; neither its contents nor the trace are published here.

The original nine-container guard remains unchanged, SHA-256 `6f256d9b68bc6c909a6a4754bfda003333fe01ab80027e4c0d5db799374a5fa4`. The new profile is `PRODUCTION_ONLY_V1`. Policy SHA-256: `6e1cbbd70b7d226536943710ba1e4a2afda65975fe719a8c480414c4dfb78c99`; runner SHA-256: `f6df6426bc382214dde2edbb785b7ed3865e3122abdb06b105990047fa22a693`.

## Guard result: PASS

| Measurement | Observed | Required |
|---|---:|---:|
| Complete duration | 600.0 s | 600 s |
| Host samples / external checks | 595 / 21 | Complete 600 s / at least 21 checks |
| Minimum MemAvailable | 1,046,544 KiB | ≥819,200 KiB |
| Minimum SwapFree | 1,565,436 KiB | ≥262,144 KiB |
| Minimum free disk | 11,704 MiB | ≥10,240 MiB |
| Swap-in / swap-out delta | 1 / 0 pages | ≤64 each over 600 s, with 60 s and sustained-pressure checks |
| Major faults / OOM-kill delta | 1 / 0 | ≤256 faults over 600 s; OOM delta 0 |
| Peak PSI some / full avg10 | 0.0 / 0.0 | <2.0 / <1.5 |
| `/health` max measured duration | 0.3868 s | <0.8 s |
| `/ready` max measured duration | 0.2644 s | <0.8 s |
| HTTP statuses | 200 for both routes in all 21 checks | 200 |

All five production containers (API, Web, Worker, PostgreSQL, Redis) were `running/healthy` throughout the external checks. The four retired TEST containers remained `exited`, with `restart=no` and their original IDs/images matching the protected checkpoint. No container restart or image identity change was recorded. A separate post-run `docker ps -a` check again showed the five production containers healthy and the four selected TEST containers exited. The result contains no failure reasons.

This PASS describes **steady state with the current five production containers**. It does not measure image delivery or a new API/Web container startup and does not authorize either release.

## Local and CI verification

Linux local tests: 72 operations tests and 27 targeted regressions PASS. Format, lint, typecheck and secret scan PASS. Exact-source GitHub Actions all concluded `success` at `3c2b983c6194e5d779a5a34fe7ffacd71e262cd1`:

- [Foundation](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39403035122)
- [API-only image/smoke](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39403035136)
- [Stage234 image](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39403035138)

The release/recovery adapter has offline regressions for five healthy production services, stopped/unexpectedly started TEST, independent slow `/health` and `/ready`, 5xx/timeout, swap/PSI/OOM, memory floor, incomplete observation and recovery that leaves TEST stopped. No release adapter was executed against production.

## Release GO/NO-GO (no cutover performed)

**API-only MCP READ fix — NO-GO now.** Candidate source is `6e1f886ece8d4dc807cf7d8be8e306dce31b04a2`, expected digest `sha256:dfc2c3a36d8371b3143da9035bb2dc1ad9ec30772470af8d78422693418a4347`. A read-only VPS image inspect returned `No such image`. Image delivery must be separately planned and authorized, with exact digest/revision checks, enough disk and memory, a full guard after delivery, startup watchdog, post-start guard and protected rollback. No hidden pull/build is allowed.

**Web-only branding — conditional technical GO for a separately approved attempt, not a release authorization.** The candidate image is cached locally at digest `sha256:1c39775ffbb095cc7d9037dfbea874be146ad25fe88ce255eaa794b0ccfd9ec0` with OCI revision `fa9805b0adeed1b225e34605b02ad0b67d5ebc33`. The original production image remains cached at `sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833`, revision `a00817b746211a295bcb966f7fd7ef12cd6178fb`. The 11,704 MiB minimum disk free is above the separately approved 11,500 MiB cache-only Web preflight and the 10,240 MiB guard floor. A later attempt must recheck cache, Compose/env hashes, pending operations and rollback; use one cutover without simultaneous old/new Web; observe startup and then run the full post-start 600-second guard. Previous Web startup pressure remains a material risk despite this steady-state PASS.

Production API/Web cutovers, TEST changes and new resource observations require separate decisions. The approved one-run diagnostic window is closed.

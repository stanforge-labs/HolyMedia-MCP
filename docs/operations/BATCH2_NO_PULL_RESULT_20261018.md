# Batch 2 no-pull TEST deployment: protected rollback

**Result: ROLLED BACK.** The one authorized TEST-only maintenance window was used. No candidate API or Web container was started. The original TEST Web/API were restored; all nine containers were healthy at final verification. Batch 3 is not ready.

## Source and release evidence

- Owner-approved base source: `5e673f32a28e42ef9a7bb54310bb92c22a23d0b2`.
- Exact CI artifact: run `12112096387`, `qrs-test-api-delta.tar.gz`, SHA-256 `999d9ba21329217c7f71b76f8cda180190ac3fc8be7006bb13bf03840622cf32`. The artifact was verified locally and staged on the VPS; no Docker image was pulled or built there.
- Before the maintenance window, two `prepare` checks exposed runner defects. Both failed before TEST was stopped. The fixes were limited to creating the run directory before logging preflight results and treating absent, default-OFF TEST write flags as OFF. A separate CI health smoke race was corrected by waiting for Docker to report healthy. The exact code used for the maintenance attempt was `f50bca15316f327906365a06d6b3533002de61fa`; runner SHA-256 `5e82ebd5b1a6103beee81cb90a75e0b245aff0e2be662ce30f509e1d60115612`. [No-pull Linux CI run 39063987828](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39063987828) passed. The original API bundle and its hash did not change.
- Protected VPS evidence: `/opt/holymedia-qrs-test/rollback/batch2-no-pull-20261018-phase-v2-once/` contains the prepared configuration, backups, event log, guard trace, result and rollback marker. The earlier incomplete run directory was preserved.

## As-run checkpoints

| Checkpoint | Result |
|---|---|
| `prepare` | PASS: no pending/approved/in-flight previews or commits; no OAuth transactions/codes or long DB transactions; protected TEST PostgreSQL/Redis backups verified; old images and Compose saved. |
| TEST stop | Only TEST Web then TEST API stopped. MemAvailable rose from 895,892 to 1,109,768 KiB: **+213,876 KiB (208.9 MiB)**. Production and TEST PostgreSQL/Redis remained running. |
| 600-second maintenance guard | **PASS**, 600.001 seconds, 593 samples. MemAvailable min 1,088,488 KiB; free swap min 1,599,664 KiB; free disk min 12,382 MiB; PSI full peak 0.18 and some peak 0.36; swap-out delta 0; OOM delta 0; production `/ready` max latency 0.2833 s. Swap-in +6 pages and major faults +15 were diagnostic only in this phase. |
| Immediate gate after maintenance | **FAIL: `memory_psi`** at 20:00:41 UTC, after the complete maintenance guard and before starting either candidate container. The event does not retain the exact PSI component/value. Do not attribute its cause from this single event. |
| Rollback | One protected rollback completed at 20:01:16 UTC; marker `ROLLED_BACK`. No automatic retry. |
| 600-second candidate full-stack guard | **NOT RUN** because neither new TEST container was started. Strict no-swap full-stack stability remains unproven. |

## Final read-only verification

All **9/9 containers healthy**, including restored TEST API/Web, TEST PostgreSQL/Redis, and unchanged production API/Web/Worker/PostgreSQL/Redis. TEST API and Web retained their original installed image IDs (`sha256:35e95779d59df2b83eb45f3dfc481ffa9e2e09d494ee26315c6ae656d7111595` and `sha256:5e131625e622fe91aa578c0a53a586ffc5f30d49bf8ba39c8080bbd18835a0d6`). Production image IDs and restart counts were unchanged. Production `/health` and `/ready`, TEST `/ready`, `/auth`, `/mcp/approve`, public OAuth metadata and CSRF returned HTTP 200. Final MemAvailable was **924,772 KiB**, free disk **12,383 MiB**, free swap **1,599,664 KiB**, PSI full avg10 **0**, OOM **0**. No new swap-out occurred during the maintenance interval or rollback.

The no-pull technique avoided image transfer and unpacking, and the TEST stop released 208.9 MiB. It did **not** establish the candidate runtime's memory use or Web healthcheck saving on this VPS. The immediate PSI failure blocks calling Batch 2 PASS or proceeding to Batch 3. Any new deployment attempt requires a new owner decision and a separate explanation of the post-maintenance PSI event; the existing guard thresholds remain unchanged.

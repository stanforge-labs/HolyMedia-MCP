# Batch 2 no-pull TEST deployment: protected rollback

**Result: ROLLED BACK.** The one authorized TEST-only maintenance window was used. Subsequent journal review corrected an important omission in the first report: the candidate **TEST API did start briefly**; TEST Web did not start. The original TEST Web/API were restored; all nine containers were healthy at final verification. Batch 3 is not ready.

## Source and release evidence

- Owner-approved base source: `5e673f32a28e42ef9a7bb54310bb92c22a23d0b2`.
- Exact CI artifact: run `12112096387`, `qrs-test-api-delta.tar.gz`, SHA-256 `999d9ba21329217c7f71b76f8cda180190ac3fc8be7006bb13bf03840622cf32`. The artifact was verified locally and staged on the VPS; no Docker image was pulled or built there.
- Before the maintenance window, two `prepare` checks exposed runner defects. Both failed before TEST was stopped. The fixes were limited to creating the run directory before logging preflight results and treating absent, default-OFF TEST write flags as OFF. A separate CI health smoke race was corrected by waiting for Docker to report healthy. The exact code used for the maintenance attempt was `f50bca15316f327906365a06d6b3533002de61fa`; runner SHA-256 `5e82ebd5b1a6103beee81cb90a75e0b245aff0e2be662ce30f509e1d60115612`. [No-pull Linux CI run 39063987828](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39063987828) passed. The original API bundle and its hash did not change.
- Protected VPS evidence: `/opt/holymedia-qrs-test/rollback/batch2-no-pull-20261018-phase-v2-once/` contains the prepared configuration, backups, event log, guard trace, result and rollback marker. The earlier incomplete run directory was preserved.
- Byte-for-byte copies of the three non-secret result files are in [`artifacts/batch2-no-pull-as-run-20261018/`](../../artifacts/batch2-no-pull-as-run-20261018/). SHA-256: events `f8dd426128d025e158b490bcc75ba49cdea0c6e2548b4c5c6597559084ea3a59`; trace `a9b5c0406d3e66c2968a4ed8a6d47859b9b98b85e46276d280697580a25b5baa`; result `0494d94cf4838cdd8ea34b7417eea2eb850821054b26f50015b7acbecb20731a`. Protected DB/Redis backups and env files remain on the VPS and are not copied to the repository.

## As-run checkpoints

| Checkpoint | Result |
|---|---|
| `prepare` | PASS: no pending/approved/in-flight previews or commits; no OAuth transactions/codes or long DB transactions; protected TEST PostgreSQL/Redis backups verified; old images and Compose saved. |
| TEST stop | Only TEST Web then TEST API stopped. MemAvailable rose from 895,892 to 1,109,768 KiB: **+213,876 KiB (208.9 MiB)**. Production and TEST PostgreSQL/Redis remained running. |
| 600-second maintenance guard | **PASS**, 600.001 seconds, 593 samples. MemAvailable min 1,088,488 KiB; free swap min 1,599,664 KiB; free disk min 12,382 MiB; PSI full peak 0.18 and some peak 0.36; swap-out delta 0; OOM delta 0; production `/ready` max latency 0.2833 s. Swap-in +6 pages and major faults +15 were diagnostic only in this phase. |
| Maintenance → API startup | The last trace sample at 20:00:33 UTC had PSI full/some **0.00/0.00** and MemAvailable **1,114,084 KiB**. The Docker/systemd journal then records creation and start of candidate `qrs_api` at **20:00:34–35 UTC**. Its cgroup later reported **4.568 s CPU**, and Docker recorded **7.498 s runtime**. This was the installed old image with the planned read-only code mounts; no image pull occurred. |
| Immediate gate during API startup | **FAIL: `memory_psi`** at 20:00:41 UTC, inside `wait_health` after `docker compose up` started the API. The runner did not persist that failed sample, so exact PSI full/some, contemporaneous RAM and cgroup counters **cannot be recovered** from these files. The failure proves at least one PSI threshold was crossed (`full ≥1.5` or `some ≥2.0`). It does not identify which process or memory cgroup caused the stalls. |
| Rollback | One protected rollback completed at 20:01:16 UTC; marker `ROLLED_BACK`. No automatic retry. |
| 600-second candidate full-stack guard | **NOT RUN** because API startup failed and TEST Web was never started. Strict no-swap full-stack stability remains unproven. |

## Final read-only verification

All **9/9 containers healthy**, including restored TEST API/Web, TEST PostgreSQL/Redis, and unchanged production API/Web/Worker/PostgreSQL/Redis. TEST API and Web retained their original installed image IDs (`sha256:35e95779d59df2b83eb45f3dfc481ffa9e2e09d494ee26315c6ae656d7111595` and `sha256:5e131625e622fe91aa578c0a53a586ffc5f30d49bf8ba39c8080bbd18835a0d6`). Production image IDs and restart counts were unchanged. Production `/health` and `/ready`, TEST `/ready`, `/auth`, `/mcp/approve`, public OAuth metadata and CSRF returned HTTP 200. Final MemAvailable was **924,772 KiB**, free disk **12,383 MiB**, free swap **1,599,664 KiB**, PSI full avg10 **0**, OOM **0**. No new swap-out occurred during the maintenance interval or rollback.

The no-pull technique avoided image transfer and unpacking, and the TEST stop released 208.9 MiB. The **API startup**, rather than an idle maintenance-state transition, coincided with the PSI failure. This does **not** establish whether the pressure came from the API's 512 MiB no-swap cgroup, Docker/containerd startup, another process, or their overlap. It did not establish steady candidate memory use or Web healthcheck saving on this VPS. The immediate PSI failure blocks calling Batch 2 PASS or proceeding to Batch 3. Any new deployment attempt requires a new owner decision; the existing guard thresholds remain unchanged.

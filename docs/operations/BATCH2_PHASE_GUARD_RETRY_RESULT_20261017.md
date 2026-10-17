# Batch 2 phase-aware retry: protected rollback

**17.10.2026 UTC — ROLLED BACK.** The single newly authorized TEST Web/API
maintenance window used code commit `3e522bcc33cc49eba5df64aace3814cf391f81d4`.
Linux [foundation quality CI](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39057025580)
passed, including secret scan, original Web-only policy and six new
maintenance-phase regressions. The earlier as-run code/evidence in
`fb2cd777f2fadd3ea142e8d688d036870b16a0fe` was not replaced. The new
run directory was `/opt/holymedia-qrs-test/rollback/batch2-maintenance-20261017-phase-v2-once/`;
its protected backups, manifest, traces, pull log and `ROLLED_BACK` marker
remain on the VPS.

## What happened

1. Before stop: 9/9 containers healthy, no pending/approved/in-flight TEST
   previews (`0/0/0`), no active OAuth transactions/codes (`0/0`) or long DB
   transactions. TEST API/Web old image IDs and protected Compose matched the
   runner's pins. Fresh TEST DB/Redis backups totalled 349,470 bytes and passed
   header, hash and `pg_restore -l` verification. Disk free 12,539 MiB;
   production health/ready 200. Four uploaded script hashes matched local
   source. No production configuration was modified.
2. TEST Web then API stopped once. `MemAvailable` rose from **906,216 KiB to
   1,116,776 KiB**, a measured **+210,560 KiB = +205.6 MiB**. TEST DB/Redis
   and all production containers stayed running.
3. New phase-aware maintenance guard completed **600.001 s, PASS**, 591
   samples, min `MemAvailable 1,077,256 KiB`, min swap free `1,610,864 KiB`,
   min disk free `12,539 MiB`, peak PSI full `0.00`, peak PSI some `0.09`,
   `pswpout +0`, `pswpin +2`, major faults `+2`, OOM `+0`, maximum production
   ready latency `0.267 s`, and zero HTTP/container/approval failures. The
   prior `+251/+184` burst was not reproduced; its policy regression passed.
4. The runner began the **first**, pinned TEST Web image pull. At 18:26:35 UTC,
   its strict per-second host gate detected **new swap-out** and aborted the
   pull. No `image_pulled` event occurred; the Web candidate digest and API
   candidate digest were absent from local image inspection afterward. API pull,
   candidate starts and the full-stack 600-second guard never began. The pull
   log records some completed layers, so disk and page-cache work occurred.
5. One automatic rollback restored old TEST API/Web. At 18:27:48 UTC, all
   **9/9 containers healthy**; TEST API image ID
   `sha256:35e95779d59df2b83eb45f3dfc481ffa9e2e09d494ee26315c6ae656d7111595`,
   Web `sha256:5e131625e622fe91aa578c0a53a586ffc5f30d49bf8ba39c8080bbd18835a0d6`,
   restart counts `0`, OOM flags false. Production `/health` and `/ready` 200
   at `0.105/0.104 s`; TEST ready/auth/approval 200/200/200. `MemAvailable`
   **887,912 KiB (867.1 MiB)**, swap free `1,604,928 KiB`, disk free
   **12,388 MiB**, PSI full avg10 `0.01`, OOM counter `0`.

`pswpout` increased from 1,349,001 after TEST stop to 1,350,667 at the final
read, **+1,666 pages across pull, abort and rollback**. The first new page-out
was detected during the Web pull; this total must not be attributed entirely
to the pull. No post-rollback 600-second no-swap result was collected.

## Decision boundary

The phase-policy bug is fixed and CI verified. The concrete remaining blocker
is **active swap-out during image pull with TEST API/Web already stopped**.
This run does not prove whether the new full stack would have fit, because
neither candidate started. It does prove that a maintenance PASS alone is
insufficient to authorize ignoring pull-time pressure. The strict guard did
exactly what the owner required: one rollback, no retry, no weakened limits.
Batch 2 remains incomplete and Batch 3 is not ready. Both replacement
permissions for this one attempt are consumed. Any further deployment needs a
separate owner decision and a newly verified way to avoid pull-time pressure;
do not reuse this one-use directory or run another pull automatically.

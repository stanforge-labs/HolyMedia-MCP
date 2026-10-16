# HolyPilot Web: production release attempt, 16 October 2026

**Result: ROLLED BACK.** The public site remains on its previous Web image. No automatic retry is authorized by this record.

## Candidate and checks

- Running production image before and after: `sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833`, source `a00817b746211a295bcb966f7fd7ef12cd6178fb`.
- Visual identity change was applied to that exact source on `codex/holypilot-production-web`: HolyMedia round symbol, `HolyPilot` lockup, localized “Ваш персональный AI-маркетолог”, favicon and sharing image. No API, Worker, database, OAuth configuration or production Compose change is in the release source.
- Compact Web-only runtime source `6fe2ef2466d51ee6c2eaabc84c4b2ed92e58a6be`; image `ghcr.io/stanforge-labs/holymedia-mcp-v2:prod-web-sha-6fe2ef2466d51ee6c2eaabc84c4b2ed92e58a6be@sha256:86488159c5d9f42c6def46fda10f347980bbf44758089c35ba167c0de4e5301b`. Compressed layers: 223,145,534 bytes; CI image size: 646,610,746 bytes. The target excludes API, Worker and Chromium.
- [Exact-source CI run 38899868335](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38899868335): image build and Web-only smoke PASS; full-stack image smoke was intentionally skipped for the Web-only target. Local Web lint, TypeScript, production build and public brand route checks PASS. An earlier shared-runtime image had passed its build but failed the unrelated disposable API startup smoke; that image was not deployed.

## Guard and single replacement

- Protected rollback point: `/var/backups/adforge-mcp/holypilot-web-20261016T122232Z` (root-only). Existing production image, Compose, env files, API/Worker containers and TEST containers were retained.
- Initial 600-second full-stack observation: MemAvailable minimum 880,356 KiB, PSI full maximum 0.16, OOM 0, swap-out 225 pages in two bursts. This does **not** satisfy the separate TEST Web swap policy and was not presented as its PASS.
- Before the image pull: MemAvailable 892,896 KiB, free swap 1,560,672 KiB, disk 11,197 MiB, PSI full 0, OOM 0; all nine production/TEST containers healthy. Only the immutable Web image was pulled. Disk after pull was 10,417 MiB, above the unchanged 10,240 MiB floor.
- First 60-second post-pull check failed on 73 swap-out pages. After one settling interval, the final pre-cutover 60 seconds passed: MemAvailable minimum 890,820 KiB, disk 10,417 MiB, PSI full 0, swap-in/out 0/0, OOM 0, health PASS.
- The old Web stopped before the new one started. The new Web became Docker healthy; `/`, `/auth`, `/mcp/approve`, symbol SVG and favicon returned HTTP 200. Public HTML contained `HolyPilot` and the tagline; Web-to-API readiness succeeded. No Google Ads mutation occurred.
- **Post-start guard failed:** over the following 60 seconds, PSI full peaked at 2.58 (limit <1.5), swap-out rose 1,328 pages and swap-in 1,005 pages. MemAvailable minimum was 925,524 KiB, disk minimum 10,418 MiB, OOM 0. The cause of pressure is not conclusively attributed to the new Web: image startup, host activity and concurrent healthchecks were not separately isolated.
- The scripted single rollback recreated only the previous Web. Its image and Docker health matched the protected baseline; `/ready` returned 200. The unused candidate image was removed without force, restoring 11,197 MiB disk free. Thirty seconds after rollback: swap-out 0, swap-in 9, MemAvailable 940,080 KiB and PSI full 0.

## Final state and next gate

Production `/health`, `/ready`, `/`, `/auth` and `/mcp/approve`, plus TEST `/auth` and `/mcp/approve`, returned HTTP 200 after rollback. All nine required containers were healthy, with zero OOM and restarts. Production API/Worker and TEST API/Web container IDs were unchanged. Production Compose, compose.env and web.env checksums matched their pre-cutover copies. Main was not changed.

The HolyPilot code and CI-verified image remain available in Git/GHCR, but the production Web publication is **blocked** by observed post-start memory pressure. A further attempt requires a fresh owner decision and a concrete way to reduce peak pressure or add headroom. Do not reuse this failed attempt as an approval for another cutover or weaken the TEST resource policy.

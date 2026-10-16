# TEST Web healthcheck recovery checkpoint

Date: 2026-10-16. Branch: `codex/qrs-test-auth-recovery`. Starting HEAD: `db1bca3a0aeb4f62e4cb95ad8f568f4c1dc38f29`.

## Preserved state

- Existing TEST Web: `sha256:5e131625e622fe91aa578c0a53a586ffc5f30d49bf8ba39c8080bbd18835a0d6`, source `367a634c063492a6592e708b179ac240f9a68b61`, Node `/auth` healthcheck every 15 seconds.
- Candidate TEST Web: `ghcr.io/stanforge-labs/holymedia-mcp-v2@sha256:3e8b44908bc9f6752ea996aa699da49b91a85953a98f5c41638811719c888669`, exact source `6b212d4bdebd1dcfc191de27a03ad4963c09b7d3`, [CI PASS](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38799741133). Candidate is an image, not the running container unless a later evidence update says otherwise.
- Existing TEST API: `sha256:35e95779d59df2b83eb45f3dfc481ffa9e2e09d494ee26315c6ae656d7111595`; PostgreSQL and Redis stay in their separate TEST stack.
- TEST Compose: `/opt/holymedia-qrs-test/docker-compose.yml`, root-owned mode 0600, SHA-256 `4dab03f890eb4d27a0f42776ec7ac152806ffe6b7e96f877c8d8f265497e51ec`. Existing protected rollback directories and Docker old image are retained. No secret or protected config value is copied into this checkpoint.
- Preflight approvals: pending 0, approved 0, uncertain/in-flight commits 0. No Google Ads write was made in this work.

## Decision gate

**2026-10-16 outcome: TEST Web cutover BLOCKED before pull or restart.** The 600-second / 589-sample preflight had minimum MemAvailable 842,776 KiB, minimum free swap 1,562,320 KiB, minimum free disk 11,198 MiB, PSI full avg10 peak 0.06, production ready maximum 0.071 seconds, zero failed HTTP checks and zero OOM, but **six pages of active swap-out**. The unchanged no-swap guard failed. The earlier 10-second observer smoke also recorded 39 page-outs. The candidate image is not on the VPS; the old TEST Web image/Compose and Node healthcheck remain active. Post-check all TEST and production containers were Docker healthy with zero restarts/OOM, all checked routes returned 200, and pending/approved/in-flight previews remained 0/0/0. No Google Ads mutation was attempted. See [the dated evidence](TEST_WEB_HEALTHCHECK_CUTOVER_20261016.md) for observer overhead and PSS details.

The owner's permission covers exactly one TEST Web-only replacement after a complete guard PASS and was not consumed by this blocked preflight. No TEST API replacement or Google Ads commit is authorized. A future TEST API cutover requires fresh explicit owner permission, a separate complete resource guard, and its own protected rollback.

When a safe Web-only attempt becomes possible, recheck the exact current Compose hash, old image, zero approvals, full-stack routes and protected rollback immediately before it. Pull the pinned candidate only after a passing interval, then repeat the resource guard because image pull/unpack may alter pressure. Stop the old Web first; verify it is stopped; start only one new TEST Web with the isolated origin/network/port and unchanged auth configuration. Check actual Docker Bash healthcheck and login, consent, approval, CSRF and API connectivity. Any failed route or resource guard triggers one rollback to the recorded old Web image/config. Do not auto-retry, change production, lower thresholds, or turn off TEST Web as a permanent measure.

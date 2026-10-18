# HolyPilot disposable local TEST

This Compose file is for an empty, **localhost-only** development environment. It is not the authorized `mcp-test.holymedia.kz` TEST and cannot provide Google LIVE evidence. It builds the API-only and Web-only Docker targets from the current source. PostgreSQL and Redis get isolated named volumes; all published ports bind to `127.0.0.1`. Google writes, Public MCP writes, signup conversion measurement, and Google Login are OFF. The QRS restricted mode must be OFF on the local HTTP origin because the actual restricted TEST profile requires the exact HTTPS TEST origin and customer. Never import the VPS TEST database, vault, OAuth secrets, or production data.

On 2026-10-18, after owner approval, this Windows PC was set up with WSL2 Ubuntu 24.04 and Docker Engine inside Ubuntu. The four services were built from a clean tracked-source snapshot and checked through Windows localhost. The following commands restart these already built images after Windows reboots. Later source changes require a fresh build.

```powershell
Start-Process -FilePath wsl.exe -ArgumentList @('-d','Ubuntu-24.04','--user','root','--','sleep','infinity') -WindowStyle Hidden
wsl -d Ubuntu-24.04 --user root --cd /root/holypilot-local-7ce6ca1 -- docker compose -f infra/local-test/docker-compose.yml up --no-build --wait -d
$env:NON_VPS_API_BASE_URL = 'http://127.0.0.1:14404'
node scripts/non-vps-http-smoke.mjs
Invoke-WebRequest http://127.0.0.1:13300/auth
wsl -d Ubuntu-24.04 --user root --cd /root/holypilot-local-7ce6ca1 -- docker compose -f infra/local-test/docker-compose.yml ps
```

The hidden WSL process keeps the local distro running after the command exits; without it, WSL powers off and stops Docker. The smoke checks readiness, unauthorized session and REST/OpenAPI access, the development OpenAPI document, and signup using a disposable dummy identity. To stop the stack, run `wsl -d Ubuntu-24.04 --user root --cd /root/holypilot-local-7ce6ca1 -- docker compose -f infra/local-test/docker-compose.yml down`; `down` preserves the isolated local DB volume. Delete that volume only after verifying it contains no needed local evidence. This stack does not provide HTTPS OAuth callbacks or owner browser approval; those require a separately approved secure ingress and TEST-only credentials. Do not open public ports or switch `mcp-test.holymedia.kz` as part of local smoke.

An exact-source API-only CI image can be preloaded locally and selected with `HOLYPILOT_LOCAL_API_IMAGE`. After building the Web target for localhost, both existing images may be started with `--no-build --pull never`. The existing QRS TEST Web image is compiled against `https://mcp-test.holymedia.kz` and restricted signup; it is **not** a valid local HTTP Web image. This Compose file builds Web for `127.0.0.1` instead. Never relabel the QRS image as a local build or copy live credentials into a CI artifact.

# HolyPilot disposable local TEST (offline preparation)

This Compose file is for an empty, **localhost-only** development environment. It is not the authorized `mcp-test.holymedia.kz` TEST and cannot provide Google LIVE evidence. It builds the API-only and Web-only Docker targets from the current source. PostgreSQL and Redis get isolated named volumes; all published ports bind to `127.0.0.1`. Google writes, Public MCP writes, signup conversion measurement, and Google Login are OFF. The QRS restricted mode must be OFF on the local HTTP origin because the actual restricted TEST profile requires the exact HTTPS TEST origin and customer. Never import the VPS TEST database, vault, OAuth secrets, or production data.

The checked Windows PC has sufficient disk and RAM, but no Docker Engine and no installed WSL distribution. **Do not run installation or system changes without separate owner approval.** Once a container runtime is separately approved and installed:

```powershell
docker compose -f infra/local-test/docker-compose.yml config --quiet
docker compose -f infra/local-test/docker-compose.yml up --build --wait -d
$env:NON_VPS_API_BASE_URL = 'http://127.0.0.1:14404'
node scripts/non-vps-http-smoke.mjs
Invoke-WebRequest http://127.0.0.1:13300/auth
docker compose -f infra/local-test/docker-compose.yml down
```

The smoke checks readiness, unauthorized session and REST/OpenAPI access, and the development OpenAPI document. Signup may be exercised only with disposable dummy identities. `down` preserves the isolated local DB volume; delete it only after verifying it contains no needed local evidence. This stack does not provide HTTPS OAuth callbacks or owner browser approval; those require a separately approved secure ingress and TEST-only credentials. Do not open public ports or switch `mcp-test.holymedia.kz` as part of local smoke.

An exact-source API-only CI image can be preloaded locally and selected with `HOLYPILOT_LOCAL_API_IMAGE`. After building the Web target for localhost, both existing images may be started with `--no-build --pull never`. The existing QRS TEST Web image is compiled against `https://mcp-test.holymedia.kz` and restricted signup; it is **not** a valid local HTTP Web image. This Compose file builds Web for `127.0.0.1` instead. Never relabel the QRS image as a local build or copy live credentials into a CI artifact.

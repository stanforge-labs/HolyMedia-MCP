# Public MCP staging package — not deployed

Status: infrastructure files only. No separate staging VM has been supplied or
verified, and nothing in this package authorizes production access. **Do not
deploy the current target image for OAuth acceptance yet.** At source commit
`ac083f319304fe95272717a96804ce7349d0ccf4`, OAuth issuer/resource,
discovery endpoints, the `WWW-Authenticate` challenge and one public-write
resource comparison still hardcode `https://mcp.holymedia.kz`. An isolated
staging host would advertise production. The acceptance script fails closed on
this. Fix the code in a separately approved commit and agree a new immutable
target SHA before provisioning OAuth clients or serving staging traffic. Do
not mask this with ingress response rewriting.

## 1. Prerequisites and isolation

- A **separate VPS/VM**; never use the production VPS, PostgreSQL, Redis,
  network, volumes, env files, service tokens, OAuth refresh tokens, provider
  credentials or traffic.
- Operator access to the feature branch's deployment package, GitHub Actions
  and GHCR. No workflow is triggered by this package itself.
- A new staging-only Google Login OAuth client and a new test identity when
  interactive login is approved. Baseline has no provider credentials.
- Before any deploy, resolve the hardcoded production OAuth origin above and
  replace the fixed source SHA throughout this package through a reviewed
  change. The SHA in this package is intentionally not floating.

The earlier `staging-mcp.holymedia.kz` belongs to v1 staging. This v2 package
uses only `v2-staging-mcp.holymedia.kz`, matching the v2 architecture runbook.

## 2. VM sizing, DNS, firewall and TLS

Start with 2 vCPU, 8 GiB RAM, 60 GiB SSD, x86-64 Ubuntu 24.04 LTS. Build in
GitHub Actions rather than on the VM. This is acceptance capacity, not a load
target. The single application image is shared by API/Web/Worker, but the
current Dockerfile installs Chromium and its system dependencies; a previous
production [review](security/SECURITY_REVIEW_2026-09-04.md) recorded an approximately
4.6 GiB app image (historical snapshot, not a current live measurement). Allow
space for two image versions,
PostgreSQL 18, backups and Docker logs. Measure actual
image size and free disk on the new VM before pulling; increase disk only if
that evidence requires it. Install a supported Docker Engine from Docker's
Ubuntu repository with the `docker compose` v2 plugin (recommend Engine 27+
and Compose 2.24+); do not use legacy `docker-compose`.

Human-created DNS record, **not created here**:

```text
Type: A
Name: v2-staging-mcp.holymedia.kz
Value: <STAGING_VPS_IP>
TTL: 300
```

Allow inbound TCP 80/443; restrict SSH to the existing admin policy/known
addresses. PostgreSQL and Redis have **no published ports**. API 14000 and Web
13000 bind only `127.0.0.1` for the host Nginx on this separate VM. Deny
other inbound ports. Do not edit the production firewall. After DNS points at
the new VM, obtain a certificate there (for example, `certbot certonly
--standalone -d v2-staging-mcp.holymedia.kz` while port 80 is free), then
install [the staging Nginx example](../deploy/public-mcp-staging/nginx.conf.example),
run `nginx -t`, and enable/reload Nginx **on the staging VM only**. The example
provides TLS, short HSTS without `includeSubDomains`, forwarded headers,
Streamable HTTP-friendly unbuffered MCP proxying, 2 MiB request limit and
bounded timeouts. No WebSocket upgrade is needed by the current MCP transport.

## 3. Services, image and environment

[Staging Compose](../infra/docker-compose.v2.staging.yml) has five containers:
API, Web, Worker, PostgreSQL 18 and Redis 7.4. Host Nginx is the sixth
service. The Compose project, bridge network, container names and two named
volumes are staging-only. It does not reference the production Compose file.
This separation is necessary because the production file embeds production
`/etc` env paths and `/var/lib` binds that cannot be safely neutralized with
an override. API startup does **not** auto-run migrations; backup and migration
are explicit steps. The Web/API loopback mappings exist only for host Nginx.

Copy the three safe examples in `deploy/public-mcp-staging/` to
`/etc/holymedia-public-mcp-staging/{compose,app,web}.env` on the separate VM,
owned by the deploying admin and mode `0600`. Never commit filled copies.
The examples deliberately leave `STAGING_IMAGE`, DB/Redis passwords, DB/Redis
URLs, session secret and provider credential encryption key blank. Generate
fresh random values there; URL-encode passwords in `DATABASE_URL` and
`REDIS_URL`. `APP_ENV=staging` is descriptive only: the current config schema
uses `NODE_ENV=production` plus `V2_CONFIG_STRICT=true` for strict validation.
An encryption key is required by strict config even when no provider
connections exist; it must be new, staging-only, and formatted as
`1:<base64-encoded 32 random bytes>`. Do not copy production values.

The mandatory baseline policy is `V2_PREVIEW_ONLY=true` and
`PUBLIC_MCP_WRITE_SCOPE_ENABLED=false`,
`PUBLIC_MCP_CONTROLLED_WRITE_ENABLED=false`,
`V2_CONFIRMED_WRITE_ENABLED=false`, both Meta App Review rename flags false,
and Meta management OAuth false. No provider credentials or refresh tokens
are needed to boot. Only a separate Google Login client becomes necessary for
interactive login; its values remain blank until an operator configures it.

The existing production image workflow is unsuitable: it builds on main,
publishes a `production` tag and bakes the production API URL into Web.
[The staging image workflow](../.github/workflows/v2-public-staging-image.yml)
does not deploy or write production tags. GitHub does not dispatch a new
`workflow_dispatch`-only file until it is on the default branch, so this
feature-branch package instead has a guarded `push` trigger on a **separate,
future** `codex/public-mcp-staging-image` branch, requiring an explicit
`[build-staging-image]` commit marker. A push to the current feature branch
does nothing; no staging-build branch or marker commit is created here. Once
the file exists on the default branch, manual dispatch is also possible.
The workflow checks out exactly
`ac083f319304fe95272717a96804ce7349d0ccf4` as **application source**,
copies only [the staging build recipe](../infra/Dockerfile.v2.staging)
from the feature workflow revision, and builds Web with
`NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_PUBLIC_BASE_URL` both set to
`https://v2-staging-mcp.holymedia.kz`. OCI labels retain both
the exact application revision and the workflow/recipe revision. The image
gets only `sha-<40-character-source-SHA>` in a separate
`holymedia-mcp-v2-staging` GHCR package. Verify the resulting registry digest,
labels and baked Web API origin before entering `STAGING_IMAGE`; preferably
pin the digest as well as recording the SHA tag. Do not run this workflow until
the OAuth-origin blocker is fixed and the target SHA is updated.

## 4. PostgreSQL, migrations, backup and reset

The baseline choice is **empty PostgreSQL 18 plus repository migrations**,
never a production dump. The PostgreSQL named volume is private to this
staging Compose project. On the future staging VM, after verifying all env
files and image identity, the operator sequence is:

```sh
cd /opt/holymedia-public-mcp-staging
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml config --quiet
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml up -d postgres redis
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml run --rm --no-deps api pnpm --dir packages/database run prisma:status
# Take a snapshot/backup before changing any nonempty staging DB.
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml run --rm --no-deps api pnpm --dir packages/database run prisma:deploy
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml run --rm --no-deps api pnpm --dir packages/database run prisma:status
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml up -d api worker web
```

`prisma:deploy` applies all pending migrations, including `0032` and `0033`;
verify both in `_prisma_migrations`. For compatibility rehearsal, reset a
**separate staging rehearsal DB** to migration `0031`, insert synthetic legacy
rows, back it up, then apply `0032`/`0033` there. The proposed fixture has one
new test user/workspace/membership, a legacy ServiceToken (fresh digest of a
temporary test token, no production token), and one unconsumed legacy
`McpPreview` tied to that token with a synthetic Meta campaign ID and no
provider credentials. Check after migration that the legacy preview retains
its `service_token_id`, gets `principal_type=SERVICE_TOKEN`, has null OAuth
and approval columns, and is readable by the old API. No PII or real
provider identifiers are permitted. The fixture is a plan, not a committed
credential or executed seed.

For a simple backup on the staging VM, stop API/Worker before destructive
rehearsals and save a timestamped `pg_dump -Fc` from `hm-public-staging-postgres`
to a mode-`0600` file on that VM. Check the dump with `pg_restore --list`.
To restore, stop API/Worker/Web, drop/recreate **only**
`holymedia_public_staging` in the staging container, then `pg_restore` that
file. Record the dump path and test a restore before relying on it. For a
complete disposable reset, verify the Compose project and VM identity, stop
services, and run `docker compose ... down -v`; this deletes only the two
explicit staging volumes. Never run these commands on production or against
an unverified Docker context. Remove the separate VM only after preserving
any desired staging evidence.

Example future backup/restore commands, **only after confirming the VM name,
Docker context and Compose project on that separate VM**:

```sh
cd /opt/holymedia-public-mcp-staging
umask 077
install -d -m 0700 /srv/holymedia-public-mcp-staging/backups
STAGING_BACKUP=/srv/holymedia-public-mcp-staging/backups/pre-0032.dump
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml stop api worker web
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml exec -T postgres pg_dump -U holymedia_staging -d holymedia_public_staging -Fc > "$STAGING_BACKUP"
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml exec -T postgres pg_restore --list < "$STAGING_BACKUP" > /dev/null
```

Restore is a separate, explicitly chosen destructive operation that replaces
only the staging DB after a verified backup:

```sh
cd /opt/holymedia-public-mcp-staging
STAGING_BACKUP=/srv/holymedia-public-mcp-staging/backups/pre-0032.dump
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml exec -T postgres psql -U holymedia_staging -d postgres -c 'DROP DATABASE IF EXISTS holymedia_public_staging WITH (FORCE)'
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml exec -T postgres createdb -U holymedia_staging holymedia_public_staging
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml exec -T postgres pg_restore -U holymedia_staging -d holymedia_public_staging < "$STAGING_BACKUP"
```

## 5. OAuth console work after blocker resolution

These are the exact staging-owned URLs to configure or verify later; no
external console was changed:

| Purpose                              | URL                                                                                   |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| MCP resource for ChatGPT/Codex       | `https://v2-staging-mcp.holymedia.kz/mcp/public`                                      |
| Protected-resource metadata          | `https://v2-staging-mcp.holymedia.kz/.well-known/oauth-protected-resource/mcp/public` |
| Authorization-server metadata        | `https://v2-staging-mcp.holymedia.kz/.well-known/oauth-authorization-server`          |
| OAuth authorize                      | `https://v2-staging-mcp.holymedia.kz/oauth/authorize`                                 |
| OAuth token                          | `https://v2-staging-mcp.holymedia.kz/oauth/token`                                     |
| Google Login authorized redirect URI | `https://v2-staging-mcp.holymedia.kz/auth/google/callback`                            |
| Future Google Ads provider redirect  | `https://v2-staging-mcp.holymedia.kz/oauth/GOOGLE_ADS/callback`                       |
| Future Meta provider redirect        | `https://v2-staging-mcp.holymedia.kz/oauth/META_ADS/callback`                         |

OpenAI/ChatGPT's **client callback URI is not fixed by this repository**;
take the exact URI from the client registration/console and register it with
this staging authorization server. Do not invent one or add a production
callback. The application supports registered client redirect URI lists and
client metadata documents. Google permits multiple authorized redirect URIs
for one web client, but use a separate staging Google Login client for secret,
consent and incident isolation; do not reuse the production client or its
secret. Future provider-read clients must also be staging-only. None is
needed for the infrastructure baseline.

## 6. Acceptance, logging and rollback rehearsal

Run [the safe acceptance script](../scripts/staging_public_mcp_acceptance.mjs)
on the staging VM only, with a newly issued staging read token supplied at
runtime as `STAGING_OAUTH_READ_TOKEN` (never as a command argument or file in
Git). It checks image labels, running flags, health/ready, auth boundary,
unprefixed public route, both OAuth metadata documents, read-only scope,
42-tool allowlist, rejection of hidden legacy tools and a database-only
OAuth read. It makes no provider calls or writes. Without a token it reports
incomplete rather than claiming PASS. Against the current target commit it
must fail on production-origin OAuth metadata/challenge.

Nginx's custom staging access log retains only time, method, an allowlisted
route label, status, duration and request ID; it omits raw URI, query, body,
Authorization, Cookie and CSRF. The approval RU/EN locations explicitly
force `Referrer-Policy: no-referrer`, `Cache-Control: no-store` and
`X-Robots-Tag: noindex, nofollow, noarchive`. After deployment, inspect actual
Web/API/Nginx access **and error** logs plus telemetry with synthetic sentinel
values for approval nonce, OAuth code/token, preview token, Cookie and CSRF.
Do not claim ingress redaction verified from this example file alone.

For rollback-image smoke after `0032`/`0033`, use a verified immutable old API
image for `d88ac55d767f713f53932ea62673b09505b51f17`, pulled on the
**staging VM** by digest or exact SHA tag. Verify its OCI revision first; do
not fetch anything from the production host. Stop staging Web/Worker/API,
then run only the old API container with the staging `app.env`, staging
network `holymedia-public-mcp-staging-net` and loopback port 14000. Never run
its Web or migration entrypoint. Check `/health`, `/ready`, legacy `/mcp`
authentication and a safe read of the synthetic legacy ServiceToken/preview;
no `confirm_preview`, provider request or mutation. Stop/remove the temporary
legacy API, restart exact new API/Web/Worker, and rerun acceptance. A failed
legacy smoke means rollback compatibility is **not** established; restore
the rehearsal DB backup if needed. This procedure is deliberately not run by
this package.

Future operator commands, only on the verified separate VM and only after
recording `OLD_IMAGE` as an inspected digest or exact SHA-tagged image:

```sh
cd /opt/holymedia-public-mcp-staging
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml stop web worker api
test "$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$OLD_IMAGE")" = d88ac55d767f713f53932ea62673b09505b51f17
docker run --rm -d --init --name hm-public-staging-legacy-api --env-file /etc/holymedia-public-mcp-staging/app.env --network holymedia-public-mcp-staging-net -p 127.0.0.1:14000:4000 "$OLD_IMAGE" pnpm --filter @holymedia/api start
curl --fail --silent http://127.0.0.1:14000/health
curl --fail --silent http://127.0.0.1:14000/ready
# Use only the synthetic fixture's staging ServiceToken for read-only legacy smoke.
docker stop hm-public-staging-legacy-api
docker compose --env-file /etc/holymedia-public-mcp-staging/compose.env -f infra/docker-compose.v2.staging.yml up -d api worker web
```

The `OLD_IMAGE` registry reference must be independently verified before
these commands; the package does not assert that a particular GHCR tag or
digest currently exists. Do not expose the old API via the public Nginx while
it is running: temporarily disable staging ingress or limit the smoke to
loopback. The old image is API-only, so its baked Web origin is irrelevant.

## 7. Non-negotiable OFF list and stop condition

Keep all three write flags false, `V2_PREVIEW_ONLY=true`, both App Review
rename gates false, no real provider credentials, no production tokens or
traffic, no production Docker context, and no production env/DB/network.
Do not create DNS, VPS, GitHub secrets, OAuth console entries or deploy from
this repository change. Provisioning is blocked until a separate VM exists
**and** the production-origin constants are fixed in a newly approved target
commit.

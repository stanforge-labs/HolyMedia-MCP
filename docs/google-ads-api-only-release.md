# Google Ads READ: API-only image (pre-deploy runbook)

This is a preparation artifact, not a deployment record. The release source is
`15f6fc47be21da342ba07e5e17b1ea5a54f0577d`; the API-only image is built
from the separate commit on top of it. Do not use the shared `production` tag.

## Compatibility boundary

The diff from production application commit
`d88ac55d767f713f53932ea62673b09505b51f17` to the release source has no
`apps/web`, `apps/worker`, Prisma schema/migration or queue-contract changes.
Google Ads Stages 1–5 add API/provider/MCP reads. The shared contracts change
adds only an optional `ProviderCampaign.budgetDetails` type. The config change
is a comment. The database package moves the already-used Prisma CLI and
`dotenv` into production dependencies for the image. Thus the old Web and
Worker can remain on the d88 image while only API uses the new image.

API runtime workspace graph: `@holymedia/api`, `@holymedia/config`,
`@holymedia/contracts`, `@holymedia/database`, `@holymedia/observability`,
`@holymedia/site-audit`. The API imports `@holymedia/site-audit` for URL and
site-analysis helpers; it does not launch Chromium. The Worker continues to
own its existing Playwright/Site Audit runtime in the old image.

## Proposed production commands — DO NOT RUN during image preparation

First check the exact image digest and available space against the CI storage
report. Keep the old d88 image and database backups. On the production host,
with the existing production environment file intact:

```bash
export V2_IMAGE='ghcr.io/stanforge-labs/holymedia-mcp-v2:sha-d88ac55d767f713f53932ea62673b09505b51f17'
export V2_API_IMAGE='ghcr.io/stanforge-labs/holymedia-mcp-v2:api-sha-<verified-commit>'
dc=(docker compose --env-file /etc/holymedia-v2/compose.env \
  -f infra/docker-compose.v2.production.yml \
  -f infra/docker-compose.v2.api-release.yml)
"${dc[@]}" config --images
"${dc[@]}" pull api
"${dc[@]}" up -d --no-deps --no-build --force-recreate api
"${dc[@]}" ps api web worker
```

The override changes only `services.api.image`. Base compose retains
`V2_IMAGE` for Web and Worker, and leaves PostgreSQL and Redis unchanged. No
Google Ads migration is included. The Google Ads provider remains `write: false`.

Rollback recreates **only API** from the already-retained old image:

```bash
export V2_API_IMAGE="$V2_IMAGE"
"${dc[@]}" up -d --no-deps --no-build --force-recreate api
"${dc[@]}" ps api web worker
```

Alternatively omit the override and use base compose for API-only recreate.
Do not recreate Web/Worker or roll back the database for this read-only change.

#!/usr/bin/env bash
set -euo pipefail

test "${RELEASE_CANDIDATE_DISPOSABLE:-}" = true
test "${COMPOSE_PROJECT_NAME:-}" = hm-public-mcp-candidate-ci
test "${SOURCE_SHA:-}" = a00817b746211a295bcb966f7fd7ef12cd6178fb
test "${PUBLIC_MCP_WRITE_SCOPE_ENABLED:-}" = false
test "${PUBLIC_MCP_CONTROLLED_WRITE_ENABLED:-}" = false
test "${V2_CONFIRMED_WRITE_ENABLED:-}" = false
compose=(docker compose -f harness/infra/docker-compose.v2.public-mcp-candidate.yml)
output="$RUNNER_TEMP/rc-acceptance"
mkdir -p "$output"

if [ "${1:-}" = collect ]; then
  "${compose[@]}" ps > "$output/compose-status.txt"
  "${compose[@]}" logs --no-color candidate-api candidate-web candidate-worker candidate-observed-api rollback-api > "$output/runtime-logs.txt" 2>&1
  observed=$("${compose[@]}" ps -q candidate-observed-api)
  if [ -n "$observed" ]; then
    docker exec -e NODE_OPTIONS= "$observed" node -e '
      const fs=require("node:fs");
      const counts=JSON.parse(fs.readFileSync("/tmp/public-mcp-candidate-adapter-counts.json","utf8"));
      console.log("ADAPTER_COUNTS "+JSON.stringify(counts));
      if(counts.providerAdapterAttempts || counts.providerWriteAttempts || counts.publicWriteDispatchAttempts || counts.observedMethods.length<20) process.exit(1);
    ' | tee "$output/adapter-counts.txt"
  fi
  exit 0
fi

test "$(git -C runtime rev-parse HEAD)" = "$SOURCE_SHA"
test "$CANDIDATE_IMAGE" = "$CANDIDATE_TAG@$CANDIDATE_DIGEST"
test "$CURRENT_IMAGE" = "$CURRENT_TAG@$CURRENT_DIGEST"
docker pull "$CANDIDATE_IMAGE"
docker pull "$CURRENT_IMAGE"
docker pull postgres:18-alpine
docker pull redis:7.4-alpine
test "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$CANDIDATE_IMAGE")" = "$SOURCE_SHA"
test "$(docker image inspect -f '{{.Config.User}}' "$CANDIDATE_IMAGE")" = node
docker run --rm --network none --entrypoint node "$CANDIDATE_IMAGE" -e 'if(process.getuid()===0)process.exit(1);console.log("NON_ROOT PASS")' | tee "$output/non-root.txt"
scan_container="hm-public-mcp-candidate-scan-$GITHUB_RUN_ID"
docker create --name "$scan_container" "$CANDIDATE_IMAGE" > /dev/null
trap 'docker rm "$scan_container" >/dev/null 2>&1 || true' EXIT
docker export "$scan_container" | python3 harness/scripts/public_mcp_release_candidate_image_scan.py | tee "$output/image-secret-scan.txt"
docker rm "$scan_container" > /dev/null
trap - EXIT

"${compose[@]}" config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin)
assert c["networks"]["default"]["internal"] is True
for s in ["candidate-api","candidate-observed-api","candidate-worker","rollback-api"]:
    e=c["services"][s]["environment"]
    for flag in ["PUBLIC_MCP_WRITE_SCOPE_ENABLED","PUBLIC_MCP_CONTROLLED_WRITE_ENABLED","V2_CONFIRMED_WRITE_ENABLED"]: assert e[flag]=="false"
    assert e["HOLYMEDIA_PUBLIC_BASE_URL"]=="https://mcp.holymedia.kz"
    assert e["CORS_ORIGINS"]=="https://mcp.holymedia.kz"
for name, service in c["services"].items():
    networks=set(service.get("networks", {}))
    if name in ["candidate-migrate", "rollback-migrate"]:
        assert networks=={"default", "migration-downloads"}
        assert service["command"]==["pnpm", "--dir", "packages/database", "run", "prisma:deploy"]
    else:
        assert networks=={"default"}, "Application/runtime egress forbidden"
assert c["services"]["rollback-api"]["command"]==["node","apps/api/dist/main.js"]
assert "build" not in c["services"]["candidate-api"]
print("DISPOSABLE CONFIG / RUNTIME NO EGRESS / FLAGS OFF / NO OLD MIGRATION COMMAND: PASS; isolated one-shot Prisma CLI may download its pinned engine")
'
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 candidate-postgres candidate-redis rollback-postgres rollback-redis

for prefix in candidate rollback; do
  db="public_mcp_${prefix}"
  major=$("${compose[@]}" exec -T "$prefix-postgres" psql -U holymedia -d "$db" -At -v ON_ERROR_STOP=1 -c "SELECT current_setting('server_version_num')::int / 10000")
  test "$major" = 18
  empty=$("${compose[@]}" exec -T "$prefix-postgres" psql -U holymedia -d "$db" -At -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public._prisma_migrations') IS NULL")
  test "$empty" = t
  "${compose[@]}" run --rm --no-deps "$prefix-migrate" | tee "$output/$prefix-fresh-migration.txt"
  "${compose[@]}" exec -T "$prefix-postgres" psql -U holymedia -d "$db" -v ON_ERROR_STOP=1 < runtime/scripts/v2-public-mcp-pg18-assert.sql | tee "$output/$prefix-pg18-assert.txt"
  "${compose[@]}" run --rm --no-deps "$prefix-migrate" pnpm --dir packages/database run prisma:status | tee "$output/$prefix-migration-status.txt"
  grep -F 'Database schema is up to date' "$output/$prefix-migration-status.txt"
  "${compose[@]}" exec -T "$prefix-postgres" psql -U holymedia -d "$db" -At -v ON_ERROR_STOP=1 -c 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' > "$output/$prefix-applied-before-boot.txt"
  count=$(wc -l < "$output/$prefix-applied-before-boot.txt")
  expected=$(find runtime/packages/database/prisma/migrations -mindepth 1 -maxdepth 1 -type d | wc -l)
  test "$count" -eq "$expected"
done
echo 'PG18_FRESH / 0032 / 0033 / MIGRATE_STATUS: PASS'

# The old image is started only AFTER the additive candidate schema is installed.
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 rollback-api
old_id=$("${compose[@]}" ps -q rollback-api)
test "$(docker inspect -f '{{.Image}}' "$old_id")" = "$(docker image inspect -f '{{.Id}}' "$CURRENT_IMAGE")"
docker cp harness/scripts/public_mcp_release_candidate_smoke.mjs "$old_id:/tmp/rc-smoke.mjs"
"${compose[@]}" exec -T rollback-api node /tmp/rc-smoke.mjs rollback | tee "$output/rollback-smoke.txt"
"${compose[@]}" exec -T rollback-postgres psql -U holymedia -d public_mcp_rollback -At -v ON_ERROR_STOP=1 -c 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name' > "$output/rollback-applied-after-boot.txt"
diff -u "$output/rollback-applied-before-boot.txt" "$output/rollback-applied-after-boot.txt"

"${compose[@]}" up -d --no-build --wait --wait-timeout 180 candidate-api candidate-worker candidate-web candidate-observed-api
for service in candidate-api candidate-worker candidate-web candidate-observed-api; do
  id=$("${compose[@]}" ps -q "$service")
  test "$(docker inspect -f '{{.Image}}' "$id")" = "$(docker image inspect -f '{{.Id}}' "$CANDIDATE_IMAGE")"
  test "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy
done
worker_id=$("${compose[@]}" ps -q candidate-worker)
docker exec "$worker_id" node --input-type=module -e '
  import {Queue} from "bullmq";
  import {redisConnection} from "./dist/provider-discovery.job.js";
  const q=new Queue("holymedia-v2-foundation",{connection:redisConnection(process.env.REDIS_URL)});
  const complete=await q.getCompletedCount();
  await q.close();
  if(complete<1)throw new Error("Worker did not process its disposable foundation ping");
  console.log("WORKER_HEALTH PASS; foundation jobs processed: "+complete);
' | tee "$output/worker-health.txt"
api_id=$("${compose[@]}" ps -q candidate-api)
docker cp harness/scripts/public_mcp_release_candidate_smoke.mjs "$api_id:/tmp/rc-smoke.mjs"
"${compose[@]}" exec -T candidate-api node /tmp/rc-smoke.mjs candidate | tee "$output/candidate-smoke.txt"
"${compose[@]}" exec -T -e NODE_OPTIONS= candidate-observed-api node /acceptance/public_mcp_release_candidate_smoke.mjs observed | tee "$output/observed-smoke.txt"
echo 'FULL_CANDIDATE_API / WEB / WORKER / POSTGRES / REDIS: PASS'

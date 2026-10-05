#!/usr/bin/env bash
set -euo pipefail
test "${RELEASE_CANDIDATE_DISPOSABLE:-}" = true
test "${COMPOSE_PROJECT_NAME:-}" = hm-public-mcp-split-ci
test "${SOURCE_SHA:-}" = a00817b746211a295bcb966f7fd7ef12cd6178fb
for flag in PUBLIC_MCP_WRITE_SCOPE_ENABLED PUBLIC_MCP_CONTROLLED_WRITE_ENABLED V2_CONFIRMED_WRITE_ENABLED; do test "${!flag}" = false; done
compose=(docker compose -f harness/infra/docker-compose.v2.public-mcp-split-ci.yml)
output="$RUNNER_TEMP/rc-acceptance"
mkdir -p "$output"
schema_snapshot() {
  "${compose[@]}" exec -T candidate-postgres psql -U holymedia -d public_mcp_candidate -At -v ON_ERROR_STOP=1 -c 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name'
}
worker_check() {
  local phase="$1"
  local id
  id=$("${compose[@]}" ps -q candidate-worker)
  test "$(docker inspect -f '{{.Image}}' "$id")" = "$(docker image inspect -f '{{.Id}}' "$CURRENT_IMAGE")"
  test "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy
  docker exec "$id" node --input-type=module -e '
    import {Queue, QueueEvents} from "bullmq";
    import {redisConnection} from "./dist/provider-discovery.job.js";
    import {createDatabase,closeDatabase} from "/workspace/packages/database/dist/index.js";
    const db=createDatabase(process.env.DATABASE_URL);
    const rows=await db.client.$queryRawUnsafe("SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL");
    await closeDatabase(db);
    const connection=redisConnection(process.env.REDIS_URL);
    const q=new Queue("holymedia-v2-foundation",{connection});
    const events=new QueueEvents("holymedia-v2-foundation",{connection});
    await events.waitUntilReady();
    const job=await q.add("foundation.ping",{emittedAt:new Date().toISOString()},{removeOnComplete:10,removeOnFail:10});
    await job.waitUntilFinished(events,30000);
    await events.close(); await q.close();
    console.log("OLD_WORKER_CHECK "+JSON.stringify({databaseMigrations:rows[0].count,foundationPing:"PASS",providerCalls:0,providerWrites:0}));
  ' | tee "$output/worker-$phase.txt"
}
collect() {
  "${compose[@]}" ps -a > "$output/compose-status.txt"
  "${compose[@]}" logs --no-color candidate-api candidate-web candidate-worker candidate-observed-api > "$output/runtime-logs.txt" 2>&1
  local observed
  observed=$("${compose[@]}" ps -q candidate-observed-api)
  if [ -n "$observed" ] && [ "$(docker inspect -f '{{.State.Running}}' "$observed")" = true ]; then
    docker exec -e NODE_OPTIONS= "$observed" node -e '
      const fs=require("node:fs");
      const c=JSON.parse(fs.readFileSync("/tmp/public-mcp-candidate-adapter-counts.json","utf8"));
      console.log("ADAPTER_COUNTS "+JSON.stringify(c));
      if(c.providerAdapterAttempts || c.providerWriteAttempts || c.publicWriteDispatchAttempts || c.observedMethods.length<20) process.exit(1);
    ' | tee "$output/adapter-counts.txt"
  fi
}
if [ "${1:-}" = collect ]; then collect; exit 0; fi
if [ "${1:-}" = rollback ]; then
  collect
  schema_snapshot > "$output/schema-before-rollback.txt"
  worker_before=$("${compose[@]}" ps -q candidate-worker)
  "${compose[@]}" stop candidate-api candidate-web candidate-observed-api
  export API_IMAGE="$CURRENT_IMAGE" WEB_IMAGE="$CURRENT_IMAGE"
  "${compose[@]}" up -d --no-build --force-recreate --wait --wait-timeout 180 candidate-api candidate-web
  for service in candidate-api candidate-web; do
    id=$("${compose[@]}" ps -q "$service")
    test "$(docker inspect -f '{{.Image}}' "$id")" = "$(docker image inspect -f '{{.Id}}' "$CURRENT_IMAGE")"
    test "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy
  done
  test "$worker_before" = "$("${compose[@]}" ps -q candidate-worker)"
  api_id=$("${compose[@]}" ps -q candidate-api)
  docker cp harness/scripts/public_mcp_split_candidate_smoke.mjs "$api_id:/tmp/rc-smoke.mjs"
  "${compose[@]}" exec -T candidate-api node /tmp/rc-smoke.mjs rollback | tee "$output/rollback-smoke.txt"
  "${compose[@]}" exec -T candidate-api node -e 'fetch("http://candidate-web:3000/api/health").then(r=>{if(r.status!==200)process.exit(1);console.log("OLD_WEB_HEALTH 200")}).catch(()=>process.exit(1))' | tee "$output/rollback-web.txt"
  worker_check rollback
  schema_snapshot > "$output/schema-after-rollback.txt"
  diff -u "$output/schema-before-rollback.txt" "$output/schema-after-rollback.txt"
  echo 'SPLIT_ROLLBACK_API_WEB_OLD / WORKER_UNCHANGED / NO_SQL_ROLLBACK: PASS'
  exit 0
fi
test "$(git -C runtime rev-parse HEAD)" = "$SOURCE_SHA"
test "$API_IMAGE" = "$API_TAG@$API_DIGEST"
test "$WEB_IMAGE" = "$WEB_TAG@$WEB_DIGEST"
test "$CURRENT_IMAGE" = "$CURRENT_TAG@$CURRENT_DIGEST"
for kind in api web; do
  if [ "$kind" = api ]; then image="$API_IMAGE"; else image="$WEB_IMAGE"; fi
  docker pull "$image"
  test "$(docker image inspect -f '{{.Config.User}}' "$image")" = node
  test "$(docker image inspect -f '{{index .Config.Labels "io.holymedia.runtime-source"}}' "$image")" = "$SOURCE_SHA"
  docker run --rm --network none --entrypoint node -v "$HARNESS_SCRIPTS:/acceptance:ro" "$image" /acceptance/public_mcp_split_candidate_layout.mjs "$kind" | tee "$output/$kind-layout.txt"
  scan_container="hm-public-mcp-split-$kind-scan-$GITHUB_RUN_ID"
  docker create --name "$scan_container" "$image" > /dev/null
  trap 'docker rm "$scan_container" >/dev/null 2>&1 || true' EXIT
  docker export "$scan_container" | python3 harness/scripts/public_mcp_split_candidate_image_scan.py | tee "$output/$kind-secret-scan.txt"
  docker rm "$scan_container" > /dev/null
  trap - EXIT
done
docker pull "$CURRENT_IMAGE"
docker pull postgres:18-alpine
docker pull redis:7.4-alpine
"${compose[@]}" config --format json | python3 -c '
import json,sys
c=json.load(sys.stdin)
assert c["networks"]["default"]["internal"] is True
for name,service in c["services"].items():
    networks=set(service.get("networks",{}))
    if name in ["candidate-migrate","old-migrate"]:
        assert networks=={"default","migration-downloads"}
        assert service["command"]==["pnpm","--dir","packages/database","run","prisma:deploy"]
    else: assert networks=={"default"},"Runtime egress forbidden"
for name in ["candidate-api","candidate-observed-api","candidate-worker"]:
    e=c["services"][name]["environment"]
    for flag in ["PUBLIC_MCP_WRITE_SCOPE_ENABLED","PUBLIC_MCP_CONTROLLED_WRITE_ENABLED","V2_CONFIRMED_WRITE_ENABLED"]: assert e[flag]=="false"
    assert e["HOLYMEDIA_PUBLIC_BASE_URL"]=="https://mcp.holymedia.kz"
assert c["services"]["candidate-worker"]["image"]==c["services"]["old-migrate"]["image"]
assert c["services"]["candidate-api"]["command"]==["node","apps/api/dist/main.js"]
print("SPLIT_CONFIG_RUNTIME_INTERNAL_FLAGS_OFF_WORKER_OLD: PASS")
'
# Render the production override itself without reading any production env file.
V2_API_IMAGE="$API_IMAGE" V2_WEB_IMAGE="$WEB_IMAGE" docker compose -f harness/infra/docker-compose.v2.public-mcp-split.yml config --format json | python3 -c '
import json,sys
p=json.load(sys.stdin)
assert set(p["services"])=={"api","web"}
assert "public-mcp-api-" in p["services"]["api"]["image"]
assert "public-mcp-web-" in p["services"]["web"]["image"]
print("PRODUCTION_OVERRIDE_API_NEW_WEB_NEW_WORKER_UNCHANGED: PASS")
'
"${compose[@]}" up -d --no-build --wait --wait-timeout 120 candidate-postgres candidate-redis
major=$("${compose[@]}" exec -T candidate-postgres psql -U holymedia -d public_mcp_candidate -At -v ON_ERROR_STOP=1 -c "SELECT current_setting('server_version_num')::int/10000")
test "$major" = 18
empty=$("${compose[@]}" exec -T candidate-postgres psql -U holymedia -d public_mcp_candidate -At -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public._prisma_migrations') IS NULL")
test "$empty" = t
# OLD image establishes the current schema through 0031 on this fresh DB.
"${compose[@]}" run --rm --no-deps old-migrate | tee "$output/current-schema-0031.txt"
schema_snapshot > "$output/schema-0031.txt"
test "$(tail -1 "$output/schema-0031.txt")" = 0031_service_token_resource_access_mode
test "$(wc -l < "$output/schema-0031.txt")" -eq 32
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 candidate-worker
worker_id=$("${compose[@]}" ps -q candidate-worker)
worker_check before0032
worker_started=$(docker inspect -f '{{.State.StartedAt}}' "$worker_id")
# NEW API image adds 0032 and 0033 while OLD Worker remains running.
"${compose[@]}" run --rm --no-deps candidate-migrate | tee "$output/api-additive-migrations.txt"
"${compose[@]}" exec -T candidate-postgres psql -U holymedia -d public_mcp_candidate -v ON_ERROR_STOP=1 < runtime/scripts/v2-public-mcp-pg18-assert.sql | tee "$output/pg18-assert.txt"
"${compose[@]}" run --rm --no-deps candidate-migrate pnpm --dir packages/database run prisma:status | tee "$output/migration-status.txt"
grep -F 'Database schema is up to date' "$output/migration-status.txt"
schema_snapshot > "$output/schema-0033.txt"
test "$(wc -l < "$output/schema-0033.txt")" -eq 34
test "$worker_id" = "$("${compose[@]}" ps -q candidate-worker)"
test "$worker_started" = "$(docker inspect -f '{{.State.StartedAt}}' "$worker_id")"
worker_check after0033
"${compose[@]}" restart candidate-worker
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 candidate-worker
test "$worker_started" != "$(docker inspect -f '{{.State.StartedAt}}' "$worker_id")"
worker_check restarted0033
echo 'OLD_WORKER_0031 / CONTINUES_AFTER0033 / RESTART_AGAINST0033: PASS'
"${compose[@]}" up -d --no-build --wait --wait-timeout 180 candidate-api candidate-web candidate-observed-api
for service in candidate-api candidate-observed-api candidate-web; do
  id=$("${compose[@]}" ps -q "$service")
  if [ "$service" = candidate-web ]; then image="$WEB_IMAGE"; else image="$API_IMAGE"; fi
  test "$(docker inspect -f '{{.Image}}' "$id")" = "$(docker image inspect -f '{{.Id}}' "$image")"
  test "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy
done
api_id=$("${compose[@]}" ps -q candidate-api)
docker cp harness/scripts/public_mcp_split_candidate_smoke.mjs "$api_id:/tmp/rc-smoke.mjs"
"${compose[@]}" exec -T candidate-api node /tmp/rc-smoke.mjs candidate | tee "$output/mixed-smoke.txt"
"${compose[@]}" exec -T -e NODE_OPTIONS= candidate-observed-api node /acceptance/public_mcp_split_candidate_smoke.mjs observed | tee "$output/observed-smoke.txt"
collect
echo 'MIXED_STACK_API_NEW_WEB_NEW_WORKER_OLD / PUBLIC_MCP / SUPPORT: PASS'

#!/usr/bin/env bash
# Idempotent backstop for exactly one approved production Web-only attempt.
set -Eeuo pipefail

run_dir=${1:?protected run directory required}
base=/opt/adforge-mcp-v2/infra/docker-compose.v2.production.yml
envfile=/etc/holymedia-v2/compose.env
oldid=sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833
web=holymedia-v2-web-1
test_apps=(holymedia-qrs-test-qrs_api-1 holymedia-qrs-test-qrs_web-1)

[[ -f "$run_dir/container-ids.txt" ]] || exit 0

expected_id() { awk -F '|' -v name="$1" '$1==name {print $2}' "$run_dir/container-ids.txt"; }
expected_image() { awk -F '|' -v name="$1" '$1==name {print $3}' "$run_dir/container-ids.txt"; }
actual_id() { docker inspect "$1" --format '{{.Id}}'; }
actual_image() { docker inspect "$1" --format '{{.Image}}'; }

if [[ -f "$run_dir/cutover-attempted" && ! -f "$run_dir/published" ]]; then
  current_id=$(actual_id "$web" 2>/dev/null || true)
  current_image=$(actual_image "$web" 2>/dev/null || true)
  current_health=$(docker inspect "$web" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)
  if [[ "$current_image" != "$oldid" || "$current_health" != healthy ]]; then
    if [[ -f "$run_dir/rollback-attempted" ]]; then
      echo 'ROLLBACK_REPEAT_BLOCKED; manual recovery required' >&2
      exit 90
    fi
    touch "$run_dir/rollback-attempted"
    if [[ "$current_id" == "$(expected_id "$web")" && "$current_image" == "$oldid" ]]; then
      docker start "$web" >/dev/null
    else
      [[ -f "$run_dir/old-web.yml" ]] || { echo 'OLD_WEB_OVERRIDE_MISSING_REQUIRES_MANUAL_RECOVERY' >&2; exit 91; }
      docker stop "$web" >/dev/null 2>&1 || true
      docker compose --env-file "$envfile" -f "$base" -f "$run_dir/old-web.yml" \
        up -d --no-deps --no-build --pull never --force-recreate web >/dev/null
    fi
    for ((i=0; i<60; i++)); do
      current_health=$(docker inspect "$web" --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' 2>/dev/null || true)
      [[ "$current_health" == healthy ]] && break
      sleep 2
    done
    [[ "$current_health" == healthy && "$(actual_image "$web")" == "$oldid" ]]
    curl -fsS --max-time 5 https://mcp.holymedia.kz/ready >/dev/null
    echo 'WEB_ROLLBACK_VERIFIED'
  fi
fi

for name in "${test_apps[@]}"; do
  [[ "$(actual_id "$name")" == "$(expected_id "$name")" ]]
  [[ "$(actual_image "$name")" == "$(expected_image "$name")" ]]
  running=$(docker inspect "$name" --format '{{.State.Running}}')
  [[ "$running" == true ]] || docker start "$name" >/dev/null
done

for ((i=0; i<60; i++)); do
  healthy=1
  for name in "${test_apps[@]}"; do
    [[ "$(docker inspect "$name" --format '{{.State.Health.Status}}' 2>/dev/null || true)" == healthy ]] || healthy=0
  done
  (( healthy == 1 )) && break
  sleep 2
done
(( healthy == 1 ))
curl -fsS --max-time 5 http://127.0.0.1:14404/ready >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:13300/auth >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:13300/mcp/approve >/dev/null
echo 'TEST_RESTORED_VERIFIED'

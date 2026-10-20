#!/usr/bin/env bash
# A single-service Compose update with one automatic rollback. Installed root-owned
# on the VPS; GitHub Actions only supplies a validated service, digest and source SHA.
set -Eeuo pipefail

service=${1:-}
candidate=${2:-}
revision=${3:-}
[[ $# -eq 3 && $service =~ ^(api|web|worker)$ ]] || exit 2
[[ $candidate =~ ^ghcr\.io/stanforge-labs/holymedia-mcp-v2@sha256:[a-f0-9]{64}$ ]] || exit 2
[[ $revision =~ ^[a-f0-9]{40}$ ]] || exit 2

exec 9>/run/lock/holymedia-production-deploy.lock
flock -n 9 || { echo 'Another production deployment is active' >&2; exit 1; }

repo=/opt/adforge-mcp-v2/infra
state=/etc/holymedia-v2/deploy-images.env
compose_env=/etc/holymedia-v2/compose.env
base=$repo/docker-compose.v2.production.yml
override=$repo/docker-compose.v2.production-images.yml
[[ -r $state && -r $compose_env && -r $base && -r $override ]] || exit 1
case $service in
  api) key=V2_API_IMAGE ;;
  web) key=V2_WEB_IMAGE ;;
  worker) key=V2_WORKER_IMAGE ;;
esac

previous=$(sed -n "s/^${key}=//p" "$state")
[[ $previous =~ ^ghcr\.io/stanforge-labs/holymedia-mcp-v2@sha256:[a-f0-9]{64}$ ]] || {
  echo 'Previous immutable image is absent from deployment state' >&2; exit 1;
}
docker image inspect "$previous" >/dev/null
current_container=$(docker compose --env-file "$compose_env" -f "$base" ps -q "$service")
[[ -n $current_container ]] || { echo 'Current service container missing' >&2; exit 1; }
previous_id=$(docker image inspect -f '{{.Id}}' "$previous")
current_id=$(docker inspect -f '{{.Image}}' "$current_container")
[[ $current_id == "$previous_id" ]] || { echo 'Running image differs from rollback state' >&2; exit 1; }

run_dir=$(mktemp -d /var/backups/adforge-mcp/simple-deploy-"$service"-XXXXXXXX)
chmod 700 "$run_dir"
cp -- "$state" "$run_dir/previous-images.env"
chmod 600 "$run_dir/previous-images.env"
printf 'service=%s\nsource=%s\nprevious=%s\ncandidate=%s\n' \
  "$service" "$revision" "$previous" "$candidate" > "$run_dir/release.txt"
chmod 600 "$run_dir/release.txt"

cd "$repo"
compose() {
  # Compose interpolates the legacy V2_IMAGE from compose.env, while each
  # production service uses its independent override image.
  set -a
  # shellcheck disable=SC1090
  source "$state"
  set +a
  docker compose --env-file "$compose_env" -f "$base" -f "$override" "$@"
}
write_state() {
  local replacement=$1 temp
  temp=$(mktemp "${state}.XXXXXX")
  chmod 600 "$temp"
  sed "s|^${key}=.*$|${key}=${replacement}|" "$state" > "$temp"
  [[ $(grep -c "^${key}=" "$temp") -eq 1 ]] || { rm -f -- "$temp"; return 1; }
  mv -f -- "$temp" "$state"
}
wait_healthy() {
  local deadline=$((SECONDS + 90)) cid status
  while (( SECONDS < deadline )); do
    cid=$(compose ps -q "$service")
    if [[ -n $cid ]]; then
      status=$(docker inspect -f '{{.State.Health.Status}}' "$cid" 2>/dev/null || true)
      if [[ $status == healthy ]]; then return 0; fi
      [[ $status != unhealthy ]] || return 1
    fi
    sleep 2
  done
  return 1
}
check_routes() {
  curl --fail --silent --show-error --max-time 8 https://mcp.holymedia.kz/health >/dev/null
  curl --fail --silent --show-error --max-time 8 https://mcp.holymedia.kz/ready >/dev/null
  if [[ $service == web ]]; then
    curl --fail --silent --show-error --max-time 8 https://mcp.holymedia.kz/ > "$run_dir/ru.html"
    curl --fail --silent --show-error --max-time 8 https://mcp.holymedia.kz/en > "$run_dir/en.html"
    grep -Fq 'HolyPilot' "$run_dir/ru.html"
    grep -Fq 'Ваш персональный AI-маркетолог' "$run_dir/ru.html"
    grep -Fq 'Your personal AI marketer' "$run_dir/en.html"
    grep -Fq 'holy-pilot-symbol.svg' "$run_dir/ru.html"
    curl --fail --silent --show-error --max-time 8 https://mcp.holymedia.kz/auth >/dev/null
    curl --fail --silent --show-error --max-time 8 https://mcp.holymedia.kz/mcp/approve >/dev/null
  fi
  local mcp_status
  mcp_status=$(curl --silent --output /dev/null --write-out '%{http_code}' --max-time 8 https://mcp.holymedia.kz/mcp)
  [[ $mcp_status == 401 ]]
}

rollback_needed=0
rollback_done=0
on_exit() {
  local status=$?
  trap - EXIT INT TERM
  if (( status != 0 && rollback_needed == 1 && rollback_done == 0 )); then
    rollback_done=1
    echo 'Deployment failed; restoring the one previous image' >&2
    write_state "$previous" || status=1
    compose up -d --no-deps --no-build --pull never "$service" || status=1
    wait_healthy || status=1
    printf 'ROLLED_BACK=%s\n' "$previous" >> "$run_dir/release.txt"
  fi
  exit "$status"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
trap 'exit 129' HUP

docker pull "$candidate"
actual_revision=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$candidate")
[[ $actual_revision == "$revision" ]] || { echo 'OCI revision mismatch' >&2; exit 1; }
[[ $(docker image inspect -f '{{.Architecture}}' "$candidate") == amd64 ]] || exit 1
if [[ $candidate == "$previous" ]]; then
  echo 'Candidate already active in deployment state'; exit 0
fi

rollback_needed=1
write_state "$candidate"
compose up -d --no-deps --no-build --pull never "$service"
wait_healthy
check_routes
rollback_needed=0
printf 'LIVE_PASS=%s\n' "$candidate" >> "$run_dir/release.txt"
echo "LIVE PASS: $service $candidate"

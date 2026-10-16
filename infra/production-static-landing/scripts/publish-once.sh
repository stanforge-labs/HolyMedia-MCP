#!/usr/bin/env bash
# Prepared procedure only. Run after the owner explicitly approves the Nginx change.
set -Eeuo pipefail

[[ ${HOLYPILOT_NGINX_APPROVED:-} == YES ]] || { echo 'Explicit Nginx approval is required' >&2; exit 2; }
[[ $EUID -eq 0 ]] || { echo 'Run as root' >&2; exit 2; }
stage=${1:?pass the reviewed staging directory}
stage=$(realpath "$stage")
[[ -f "$stage/MANIFEST.sha256" && -f "$stage/nginx/adforge-mcp.candidate.conf" ]] || exit 2
base=/etc/nginx/sites-enabled/adforge-mcp
snippet=/etc/nginx/snippets/holypilot-landing.conf
release=/srv/holypilot-landing/2026-10-16-static-v1
baseline_sha=c711bb0b6f85390afa8482ed58611371c3648690a55f09f421254475e8fd1b91
candidate_sha=e435a5b323de9eb96dc7c4c65eac9628351dd4f13951f8bf09a0a8efdf5d0d75
backup=/var/backups/adforge-mcp/holypilot-static-$(date -u +%Y%m%dT%H%M%SZ)

cd "$stage"
sha256sum -c MANIFEST.sha256
[[ $(sha256sum "$base" | cut -d' ' -f1) == "$baseline_sha" ]] || { echo 'Production Nginx baseline changed' >&2; exit 3; }
[[ $(sha256sum nginx/adforge-mcp.candidate.conf | cut -d' ' -f1) == "$candidate_sha" ]] || { echo 'Candidate Nginx checksum mismatch' >&2; exit 4; }
[[ ! -e "$snippet" && ! -e "$release" ]] || { echo 'Static release already present; no automatic retry' >&2; exit 5; }
systemctl is-active --quiet nginx && nginx -t

protected_status() {
  local route
  for route in /auth /en/auth /mcp/approve /dashboard /api/v1/auth/session /.well-known/oauth-authorization-server; do
    curl --max-time 8 -sS -o /dev/null -w '%{http_code}\n' "https://mcp.holymedia.kz$route"
  done
}
before_routes=$(protected_status)
before_ids=$(docker inspect -f '{{.Id}}' holymedia-v2-api-1 holymedia-v2-worker-1 holymedia-qrs-test-qrs_api-1 holymedia-qrs-test-qrs_web-1)
bash "$stage/scripts/resource-guard.sh" pre 600

install -d -m 0700 -o root -g root "$backup"
install -m 0600 -o root -g root "$base" "$backup/adforge-mcp.before.conf"
sha256sum "$backup/adforge-mcp.before.conf" > "$backup/baseline.sha256"
install -d -m 0755 -o root -g root "$release"
install -m 0644 -o root -g root "$stage"/site/* "$release"/
install -m 0644 -o root -g root "$stage/nginx/holypilot-landing.conf" "$snippet"

armed=0
on_exit() {
  local result=$?
  if (( armed == 1 && result != 0 )); then
    echo 'Static route guard failed; restoring original Nginx routing' >&2
    bash "$stage/scripts/rollback-nginx.sh" "$backup" || { echo 'ROLLBACK FAILED: operator intervention required' >&2; exit 98; }
  fi
  exit "$result"
}
trap on_exit EXIT

install -m 0644 -o root -g root "$stage/nginx/adforge-mcp.candidate.conf" "${base}.holypilot.tmp"
armed=1
mv -f "${base}.holypilot.tmp" "$base"
nginx -t
before_out=$(awk '$1=="pswpout" {print $2}' /proc/vmstat)
before_oom=$(awk '$1=="oom_kill" {print $2}' /proc/vmstat)
systemctl reload nginx
systemctl is-active --quiet nginx

published=0
for ((attempt=0;attempt<10;attempt++)); do
  if curl -fsS --max-time 8 https://mcp.holymedia.kz/ | grep -F HolyPilot >/dev/null; then
    published=1
    break
  fi
  sleep 1
done
(( published == 1 )) || { echo 'Nginx did not serve the reviewed static home' >&2; exit 6; }
for url in / /en /_holypilot/landing.css /_holypilot/symbol.svg /_holypilot/icon.svg /_holypilot/og.png; do
  [[ $(curl --max-time 8 -sS -o /dev/null -w '%{http_code}' "https://mcp.holymedia.kz$url") == 200 ]] || { echo "Static route failed: $url" >&2; exit 6; }
done
[[ $(protected_status) == "$before_routes" ]] || { echo 'Protected route response changed' >&2; exit 7; }
[[ $(docker inspect -f '{{.Id}}' holymedia-v2-api-1 holymedia-v2-worker-1 holymedia-qrs-test-qrs_api-1 holymedia-qrs-test-qrs_web-1) == "$before_ids" ]] || { echo 'Protected container changed' >&2; exit 8; }
now_out=$(awk '$1=="pswpout" {print $2}' /proc/vmstat)
now_oom=$(awk '$1=="oom_kill" {print $2}' /proc/vmstat)
(( now_out-before_out <= 64 && now_oom == before_oom )) || { echo 'Reload pressure/OOM guard failed' >&2; exit 9; }
bash "$stage/scripts/resource-guard.sh" post 600
[[ $(protected_status) == "$before_routes" ]] || { echo 'Protected route response changed after observation' >&2; exit 10; }
[[ $(docker inspect -f '{{.Id}}' holymedia-v2-api-1 holymedia-v2-worker-1 holymedia-qrs-test-qrs_api-1 holymedia-qrs-test-qrs_web-1) == "$before_ids" ]] || { echo 'Protected container changed after observation' >&2; exit 11; }

armed=0
printf 'PUBLISHED; backup=%s; public roots=/,/en; production Web container untouched\n' "$backup"

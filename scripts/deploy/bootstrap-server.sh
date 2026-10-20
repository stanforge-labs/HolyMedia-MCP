#!/usr/bin/env bash
# One-time setup on the existing VPS. Input is a public SSH key only.
set -euo pipefail
[[ $# -eq 4 ]] || { echo 'usage: bootstrap-server.sh OVERRIDE DEPLOY_SCRIPT SSH_ENTRY PUBLIC_KEY' >&2; exit 2; }
override_source=$1 deploy_source=$2 entry_source=$3 public_key_file=$4
for source in "$override_source" "$deploy_source" "$entry_source" "$public_key_file"; do
  [[ -f $source ]] || exit 1
done
expected=sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833
image=ghcr.io/stanforge-labs/holymedia-mcp-v2@${expected}
for service in api web worker; do
  cid=$(docker ps -q --filter "name=^/holymedia-v2-${service}-1$")
  [[ -n $cid ]] || { echo "Missing production ${service}" >&2; exit 1; }
  [[ $(docker inspect -f '{{.State.Health.Status}}' "$cid") == healthy ]] || exit 1
  [[ $(docker inspect -f '{{.Image}}' "$cid") == "$expected" ]] || exit 1
done
docker image inspect "$image" >/dev/null
for service in postgres redis; do
  cid=$(docker ps -q --filter "name=^/holymedia-v2-${service}-1$")
  [[ -n $cid && $(docker inspect -f '{{.State.Health.Status}}' "$cid") == healthy ]] || exit 1
done
for test_name in holymedia-qrs-test-qrs_api-1 holymedia-qrs-test-qrs_web-1 holymedia-google-acceptance-postgres-1 holymedia-google-acceptance-redis-1; do
  [[ $(docker inspect -f '{{.State.Status}} {{.HostConfig.RestartPolicy.Name}}' "$test_name") == 'exited no' ]] || exit 1
done

install -o root -g root -m 644 "$override_source" /opt/adforge-mcp-v2/infra/docker-compose.v2.production-images.yml
install -o root -g root -m 750 "$deploy_source" /usr/local/sbin/holymedia-compose-deploy
install -o root -g root -m 755 "$entry_source" /usr/local/sbin/holymedia-ssh-entry
if [[ ! -e /etc/holymedia-v2/deploy-images.env ]]; then
  (umask 077; printf 'V2_API_IMAGE=%s\nV2_WEB_IMAGE=%s\nV2_WORKER_IMAGE=%s\n' "$image" "$image" "$image" > /etc/holymedia-v2/deploy-images.env)
fi
chown root:root /etc/holymedia-v2/deploy-images.env
chmod 600 /etc/holymedia-v2/deploy-images.env

if ! id holymedia-deploy >/dev/null 2>&1; then
  useradd --system --create-home --shell /bin/bash holymedia-deploy
fi
home_dir=$(getent passwd holymedia-deploy | cut -d: -f6)
install -d -o holymedia-deploy -g holymedia-deploy -m 700 "$home_dir/.ssh"
printf 'restrict,command="/usr/local/sbin/holymedia-ssh-entry" %s\n' "$(cat "$public_key_file")" > "$home_dir/.ssh/authorized_keys"
chown holymedia-deploy:holymedia-deploy "$home_dir/.ssh/authorized_keys"
chmod 600 "$home_dir/.ssh/authorized_keys"
printf '%s\n' 'holymedia-deploy ALL=(root) NOPASSWD: /usr/local/sbin/holymedia-compose-deploy' > /etc/sudoers.d/holymedia-compose-deploy
chmod 440 /etc/sudoers.d/holymedia-compose-deploy
visudo -cf /etc/sudoers.d/holymedia-compose-deploy >/dev/null

set -a
# shellcheck disable=SC1091
source /etc/holymedia-v2/deploy-images.env
set +a
docker compose --env-file /etc/holymedia-v2/compose.env \
  -f /opt/adforge-mcp-v2/infra/docker-compose.v2.production.yml \
  -f /opt/adforge-mcp-v2/infra/docker-compose.v2.production-images.yml \
  config --quiet
echo 'BOOTSTRAP_READY: no production container changed'

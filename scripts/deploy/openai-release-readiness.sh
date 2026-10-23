#!/usr/bin/env bash
# Read-only, release-scoped gate. An operator creates the root-owned marker only
# after separate OWNER approval and a verified backup/migration/key setup.
set -Eeuo pipefail

mode=${1:-}
revision=${2:-}
[[ $# -eq 2 && $mode =~ ^(openai-preflight|openai-oidc-gate)$ && $revision =~ ^[a-f0-9]{40}$ ]] || exit 2
[[ $(id -u) -eq 0 ]] || exit 1

marker=/etc/holymedia-v2/openai-oidc-release-ready
state=/etc/holymedia-v2/deploy-images.env
compose_env=/etc/holymedia-v2/compose.env
base=/opt/adforge-mcp-v2/infra/docker-compose.v2.production.yml
override=/opt/adforge-mcp-v2/infra/docker-compose.v2.production-images.yml
app_env=/etc/holymedia-v2/app.env
key=/etc/holymedia-v2/oidc/signing-keys.json
key_target=/run/holymedia/oidc/signing-keys.json

fail() { echo "OpenAI release readiness failed: $1" >&2; exit 1; }
for file in "$marker" "$state" "$compose_env" "$base" "$override" "$app_env"; do
  [[ -f $file && ! -L $file ]] || fail 'required file missing or symlinked'
done
[[ $(stat -c '%u:%a' "$marker") == 0:600 ]] || fail 'approval marker ownership or mode'
[[ $(stat -c '%u:%a' "$state") == 0:600 ]] || fail 'image state ownership or mode'
[[ $(wc -l < "$marker") -eq 5 ]] || fail 'approval marker shape'

# Values are parsed as data; the marker is never sourced as shell code.
field() {
  local matches
  matches=$(grep -c "^$1=" "$marker" || true)
  [[ $matches -eq 1 ]] || fail 'approval marker field missing or duplicated'
  sed -n "s/^$1=//p" "$marker"
}
[[ $(field revision) == "$revision" ]] || fail 'approval belongs to another commit'
backup=$(field backup)
backup_sha=$(field backup_sha256)
previous_api=$(field previous_api)
previous_web=$(field previous_web)
[[ $backup =~ ^/var/backups/adforge-mcp/[A-Za-z0-9._/-]+$ && $backup != *..* ]] || fail 'invalid backup path'
[[ $backup_sha =~ ^[a-f0-9]{64}$ ]] || fail 'invalid backup checksum'
for image in "$previous_api" "$previous_web"; do
  [[ $image =~ ^ghcr\.io/stanforge-labs/holymedia-mcp-v2@sha256:[a-f0-9]{64}$ ]] || fail 'invalid rollback digest'
  docker image inspect "$image" >/dev/null || fail 'rollback image is not cached'
done
[[ -f $backup && ! -L $backup && $(stat -c '%u' "$backup") -eq 0 ]] || fail 'verified backup unavailable'
[[ $(stat -c '%a' "$backup") =~ ^(400|600)$ ]] || fail 'backup permissions are too broad'
[[ $(sha256sum "$backup" | cut -d' ' -f1) == "$backup_sha" ]] || fail 'backup checksum mismatch'

current_api=$(sed -n 's/^V2_API_IMAGE=//p' "$state")
current_web=$(sed -n 's/^V2_WEB_IMAGE=//p' "$state")
current_worker=$(sed -n 's/^V2_WORKER_IMAGE=//p' "$state")
[[ $(grep -c '^V2_API_IMAGE=' "$state") -eq 1 && $(grep -c '^V2_WEB_IMAGE=' "$state") -eq 1 && $(grep -c '^V2_WORKER_IMAGE=' "$state") -eq 1 ]] || fail 'ambiguous image state'
for image in "$current_api" "$current_web" "$current_worker"; do
  [[ $image =~ ^ghcr\.io/stanforge-labs/holymedia-mcp-v2@sha256:[a-f0-9]{64}$ ]] || fail 'invalid image state'
done
[[ $current_web == "$previous_web" ]] || fail 'Web rollback state changed'
if [[ $mode == openai-preflight ]]; then
  [[ $current_api == "$previous_api" ]] || fail 'API rollback state changed'
fi

# The node user in api-runtime is UID 1000. The host directory is root-only;
# the file is owned by that UID and mounted read-only at an unprivileged path.
[[ -d $(dirname "$key") && ! -L $(dirname "$key") ]] || fail 'key directory unavailable'
[[ $(stat -c '%u:%a' "$(dirname "$key")") == 0:700 ]] || fail 'key directory not root-only'
[[ -f $key && ! -L $key && $(stat -c '%u:%a' "$key") == 1000:400 ]] || fail 'key file ownership or mode'
grep -Fxq "HOLYMEDIA_OIDC_SIGNING_KEYS_FILE=$key_target" "$app_env" || fail 'key path not configured'
! grep -q '^HOLYMEDIA_OIDC_SIGNING_KEYS_JSON=' "$app_env" || fail 'inline private key configured'
active_kid=$(sed -n 's/^HOLYMEDIA_OIDC_ACTIVE_KID=//p' "$app_env")
[[ $active_kid =~ ^[A-Za-z0-9_-]{8,64}$ ]] || fail 'active key ID missing'
jq -e --arg kid "$active_kid" 'type == "array" and any(.[]; .kid == $kid and (.privateKeyPemBase64 | type == "string"))' "$key" >/dev/null || fail 'active private key unavailable'

# Both public WRITE switches must be absent (their default is false) or
# explicitly false. Check the file and the already-running API container so a
# stale container cannot pass on the strength of a changed file alone.
for flag in PUBLIC_MCP_WRITE_SCOPE_ENABLED PUBLIC_MCP_CONTROLLED_WRITE_ENABLED; do
  count=$(grep -c "^${flag}=" "$app_env" || true)
  [[ $count -le 1 ]] || fail 'ambiguous public WRITE configuration'
  if [[ $count -eq 1 ]]; then
    value=$(sed -n "s/^${flag}=//p" "$app_env")
    [[ ${value,,} == false ]] || fail 'public WRITE configuration is not OFF'
  fi
done

export V2_API_IMAGE="$current_api" V2_WEB_IMAGE="$current_web" V2_WORKER_IMAGE="$current_worker"
docker compose --env-file "$compose_env" -f "$base" -f "$override" config --format json |
  jq -e --arg source "$key" --arg target "$key_target" \
    '.services.api.volumes | any(.[]; .source == $source and .target == $target and .read_only == true)' >/dev/null || fail 'read-only key mount absent'

for service in postgres redis api worker web; do
  cid=$(docker compose --env-file "$compose_env" -f "$base" -f "$override" ps -q "$service")
  [[ -n $cid && $(docker inspect -f '{{.State.Health.Status}}' "$cid") == healthy ]] || fail 'production service unhealthy'
done
for service in api web worker; do
  case $service in
    api) expected=$current_api ;;
    web) expected=$current_web ;;
    worker) expected=$current_worker ;;
  esac
  cid=$(docker compose --env-file "$compose_env" -f "$base" -f "$override" ps -q "$service")
  [[ $(docker inspect -f '{{.Image}}' "$cid") == $(docker image inspect -f '{{.Id}}' "$expected") ]] || fail 'running image differs from immutable state'
done

api_cid=$(docker compose --env-file "$compose_env" -f "$base" -f "$override" ps -q api)
docker exec -u node "$api_cid" node -e '
  for (const name of ["PUBLIC_MCP_WRITE_SCOPE_ENABLED", "PUBLIC_MCP_CONTROLLED_WRITE_ENABLED"]) {
    const value = process.env[name];
    if (value !== undefined && value.trim().toLowerCase() !== "false") process.exit(1);
  }
' >/dev/null || fail 'running API public WRITE is not OFF'

if [[ $mode == openai-preflight ]]; then
  # The additive migration must have been applied deliberately after backup;
  # do not let the API container's startup prisma:deploy be the first attempt.
  pgid=$(docker compose --env-file "$compose_env" -f "$base" -f "$override" ps -q postgres)
  migration=$(docker exec "$pgid" sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT CASE WHEN (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '\''0034_openai_oidc_identity'\'' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) = 1 AND NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) THEN '\''ready'\'' ELSE '\''not_ready'\'' END"')
  [[ $migration == ready ]] || fail 'migration 0034 or migration status not ready'
  echo 'OPENAI_PREFLIGHT_PASS'
  exit 0
fi

[[ $current_api != "$previous_api" ]] || fail 'candidate API not deployed'
[[ $(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$api_cid") == "$revision" ]] || fail 'candidate API revision mismatch'
[[ $(docker inspect -f '{{.Config.User}}' "$api_cid") == node ]] || fail 'API is not running as node'
docker exec -u node "$api_cid" node -e 'require("node:fs").readFileSync(process.env.HOLYMEDIA_OIDC_SIGNING_KEYS_FILE)' >/dev/null || fail 'runtime cannot read mounted key'

base_url=https://mcp.holymedia.kz
curl -fsS --max-time 8 "$base_url/health" >/dev/null || fail 'API health route failed'
curl -fsS --max-time 8 "$base_url/ready" >/dev/null || fail 'API readiness route failed'
curl -fsS --max-time 8 "$base_url/.well-known/openid-configuration" |
  jq -e --arg issuer "$base_url" \
    '.issuer == $issuer and .authorization_endpoint == ($issuer + "/oauth/authorize") and .token_endpoint == ($issuer + "/oauth/token") and .userinfo_endpoint == ($issuer + "/oauth/userinfo") and .jwks_uri == ($issuer + "/.well-known/jwks.json") and (.scopes_supported | index("adforge:mcp:write") | not)' >/dev/null || fail 'OIDC discovery or route targets failed'
curl -fsS --max-time 8 "$base_url/.well-known/jwks.json" |
  jq -e --arg kid "$active_kid" '.keys | any(.[]; .kid == $kid and .kty == "RSA" and (has("d") | not))' >/dev/null || fail 'public JWKS failed'
[[ $(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "$base_url/oauth/userinfo") == 401 ]] || fail 'UserInfo auth route failed'
curl -fsS --max-time 8 "$base_url/.well-known/oauth-protected-resource/mcp/public" |
  jq -e --arg resource "$base_url/mcp/public" '.resource == $resource and (.scopes_supported | index("adforge:mcp:write") | not)' >/dev/null || fail 'public MCP resource metadata failed'
[[ $(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "$base_url/mcp/public") == 401 ]] || fail 'public MCP auth boundary failed'
echo 'OPENAI_OIDC_GATE_PASS'

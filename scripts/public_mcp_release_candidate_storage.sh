#!/usr/bin/env bash
set -euo pipefail
test "${SOURCE_SHA:-}" = a00817b746211a295bcb966f7fd7ef12cd6178fb
test "${CURRENT_SHA:-}" = 2c1153d580e73192cfd5bc8aaf103cd01b8ab86a
[[ "${CANDIDATE_DIGEST:-}" =~ ^sha256:[a-f0-9]{64}$ ]]
output="$RUNNER_TEMP/rc-storage"
mkdir -p "$output"
# This job has neither a build nor service containers. Do not prune any images.
docker image ls --format '{{.Repository}}:{{.Tag}}' > "$output/initial-images.txt"
test ! -s "$output/initial-images.txt"
docker info --format '{{json .}}' > "$output/docker-info.json"
current="$CURRENT_TAG@$CURRENT_DIGEST"
candidate="$CANDIDATE_TAG@$CANDIDATE_DIGEST"
docker pull "$current"
docker_root=$(docker info --format '{{.DockerRootDir}}')
docker system df -v > "$output/docker-before.txt"
sync
before=$(df -B1 --output=avail "$docker_root" | tail -1 | tr -d ' ')
docker pull "$candidate"
sync
after=$(df -B1 --output=avail "$docker_root" | tail -1 | tr -d ' ')
increment=$((before - after))
test "$increment" -ge 0
docker system df -v > "$output/docker-after.txt"
printf '{"beforeFreeBytes":%s,"afterFreeBytes":%s,"incrementalBytes":%s}\n' "$before" "$after" "$increment" > "$output/measured.json"
docker image inspect "$current" > "$output/current-inspect.json"
docker image inspect "$candidate" > "$output/candidate-inspect.json"
docker history --no-trunc --human=false "$candidate" > "$output/candidate-history.txt"
for kind in current candidate; do
  if [ "$kind" = current ]; then ref="$current"; else ref="$candidate"; fi
  docker buildx imagetools inspect --raw "$ref" > "$output/$kind-manifest.json"
  config_ref="$ref"
  if jq -e '.manifests' "$output/$kind-manifest.json" > /dev/null; then
    digest=$(jq -er '.manifests[] | select(.platform.os=="linux" and .platform.architecture=="amd64") | .digest' "$output/$kind-manifest.json")
    test "$(printf '%s\n' "$digest" | wc -l)" -eq 1
    docker buildx imagetools inspect --raw "${ref%@*}@$digest" > "$output/$kind-platform.json"
    config_ref="${ref%@*}@$digest"
    mv "$output/$kind-platform.json" "$output/$kind-manifest.json"
  fi
  jq -e '.layers and .config' "$output/$kind-manifest.json" > /dev/null
  docker buildx imagetools inspect --format '{{json .Image}}' "$config_ref" > "$output/$kind-config.json"
done
node harness/scripts/public_mcp_release_candidate_storage.mjs "$output"

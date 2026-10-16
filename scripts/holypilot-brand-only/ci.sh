#!/usr/bin/env bash
set -Eeuo pipefail

repo=$(pwd)
baseline=$(mktemp -d)
evidence="$repo/.local/holypilot-brand-only-ci"
server_pid=''
cleanup() {
  if [[ -n "$server_pid" ]]; then kill "$server_pid" 2>/dev/null || true; fi
  git worktree remove --force "$baseline" 2>/dev/null || true
}
trap cleanup EXIT

start_web() {
  local directory=$1
  node "$directory/apps/web/node_modules/next/dist/bin/next" start "$directory/apps/web" -H 127.0.0.1 -p 3107 > "$RUNNER_TEMP/holypilot-local-web.log" 2>&1 &
  server_pid=$!
  local ready=0
  for ((attempt=0;attempt<30;attempt++)); do
    if curl -fsS --max-time 2 http://127.0.0.1:3107/ >/dev/null; then ready=1; break; fi
    sleep 1
  done
  (( ready == 1 )) || { cat "$RUNNER_TEMP/holypilot-local-web.log"; exit 1; }
}
stop_web() {
  kill "$server_pid"
  wait "$server_pid" || true
  server_pid=''
}

node scripts/holypilot-brand-only/source-scope.mjs
git worktree add --detach "$baseline" a00817b746211a295bcb966f7fd7ef12cd6178fb
pnpm --dir "$baseline" install --frozen-lockfile
pnpm --dir "$baseline" --filter @holymedia/contracts build
pnpm --dir "$baseline/apps/web" build
start_web "$baseline"
node scripts/holypilot-brand-only/capture.mjs baseline http://127.0.0.1:3107 "$evidence"
stop_web

pnpm --filter @holymedia/contracts build
pnpm --dir apps/web lint
pnpm --dir apps/web build
pnpm --dir apps/web typecheck
start_web "$repo"
node scripts/holypilot-brand-only/capture.mjs after http://127.0.0.1:3107 "$evidence"
node scripts/holypilot-brand-only/verify-routes.mjs http://127.0.0.1:3107
python scripts/holypilot-brand-only/compare.py "$evidence" "$evidence/comparison" --offline
stop_web

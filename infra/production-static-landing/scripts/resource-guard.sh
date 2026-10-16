#!/usr/bin/env bash
# Run as root on the existing VPS. One lightweight observer; no Docker stats loop.
set -euo pipefail
phase=${1:?pre or post}
[[ "$phase" == pre || "$phase" == post ]] || exit 2
duration=${2:-600}
[[ "$duration" == 600 ]] || { echo 'The full 600-second guard is required' >&2; exit 2; }

vm() { awk -v key="$1" '$1==key {print $2}' /proc/vmstat; }
mem() { awk -v key="$1:" '$1==key {print $2}' /proc/meminfo; }
psi() { awk -v key="$1" '$1==key {sub(/^avg10=/,"",$2);print $2}' /proc/pressure/memory; }
disk() { df -Pm / | awk 'NR==2 {print $4}'; }
healthy() {
  local lines bad
  lines=$(docker ps --format '{{.Names}} {{.Status}}' | grep -E '^(holymedia-v2-|holymedia-qrs-test-|holymedia-google-acceptance-)')
  [[ $(printf '%s\n' "$lines" | wc -l) -eq 9 ]] || return 1
  bad=$(printf '%s\n' "$lines" | grep -v '(healthy)' || true)
  [[ -z "$bad" ]]
}
routes() {
  local url result code latency
  for url in \
    https://mcp.holymedia.kz/health \
    https://mcp.holymedia.kz/ready \
    https://mcp.holymedia.kz/auth \
    https://mcp.holymedia.kz/en/auth \
    https://mcp.holymedia.kz/mcp/approve \
    https://mcp-test.holymedia.kz/auth \
    https://mcp-test.holymedia.kz/mcp/approve; do
    result=$(curl --max-time 8 -sS -o /dev/null -w '%{http_code} %{time_total}' "$url") || return 1
    code=${result%% *}; latency=${result#* }
    printf 'ROUTE %s %s\n' "$url" "$result"
    [[ "$code" == 200 ]] || return 1
    if [[ "$url" == https://mcp.holymedia.kz/ready ]]; then
      awk -v value="$latency" 'BEGIN {exit !(value < 2)}' || return 1
    fi
  done
}

healthy && routes
out0=$(vm pswpout); in0=$(vm pswpin); oom0=$(vm oom_kill)
lastout=$out0; minmem=99999999; minswap=99999999; mindisk=99999999; maxfull=0; maxsome=0; maxout60=0
printf 'BEGIN %s utc=%s out=%s in=%s oom=%s\n' "$phase" "$(date -u +%FT%TZ)" "$out0" "$in0" "$oom0"
for ((i=1;i<=60;i++)); do
  sleep 10
  m=$(mem MemAvailable); s=$(mem SwapFree); d=$(disk); f=$(psi full); some=$(psi some)
  out=$(vm pswpout); in=$(vm pswpin); oom=$(vm oom_kill)
  (( m < minmem )) && minmem=$m || true
  (( s < minswap )) && minswap=$s || true
  (( d < mindisk )) && mindisk=$d || true
  maxfull=$(awk -v a="$maxfull" -v b="$f" 'BEGIN {print (a>b?a:b)}')
  maxsome=$(awk -v a="$maxsome" -v b="$some" 'BEGIN {print (a>b?a:b)}')
  (( m >= 819200 && s >= 262144 && d >= 10240 && oom == oom0 )) || { echo 'FAIL RAM/swap/disk/OOM'; exit 3; }
  awk -v value="$f" 'BEGIN {exit !(value < 1.5)}' || { echo 'FAIL PSI full'; exit 4; }
  (( out-out0 <= 64 )) || { echo 'FAIL total swap-out'; exit 5; }
  if (( i % 6 == 0 )); then
    out60=$((out-lastout))
    (( out60 > maxout60 )) && maxout60=$out60 || true
    printf 'WINDOW t=%s mem=%s swapfree=%s disk=%s full=%s some=%s swapout60=%s\n' "$((i*10))" "$m" "$s" "$d" "$f" "$some" "$out60"
    (( out60 <= 32 )) || { echo 'FAIL 60-second swap-out'; exit 6; }
    lastout=$out
    healthy && routes || { echo 'FAIL health/latency'; exit 7; }
  fi
done
printf 'END %s min_mem=%s min_swapfree=%s min_disk=%s max_full=%s max_some=%s swapout=%s swapin=%s max_out60=%s oom_delta=%s\n' "$phase" "$minmem" "$minswap" "$mindisk" "$maxfull" "$maxsome" "$((out-out0))" "$((in-in0))" "$maxout60" "$((oom-oom0))"
echo PASS

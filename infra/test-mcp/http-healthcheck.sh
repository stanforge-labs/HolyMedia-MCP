#!/usr/bin/env bash
# TEST-only HTTP readiness probe. Docker supplies the outer 5-second timeout.
set -euo pipefail

port=${1:-}
path=${2:-}
[[ "$port" =~ ^[1-9][0-9]{0,4}$ ]] && (( port <= 65535 )) || exit 1
case "$path" in /ready | /auth) ;; *) exit 1 ;; esac
exec 3<>"/dev/tcp/127.0.0.1/$port" || exit 1
printf 'GET %s HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n' "$path" >&3 || exit 1
IFS=' ' read -r -t 4 version status remainder <&3 || exit 1
[[ "$version" == HTTP/1.0 || "$version" == HTTP/1.1 ]] || exit 1
[[ "$status" == 200 ]] || exit 1

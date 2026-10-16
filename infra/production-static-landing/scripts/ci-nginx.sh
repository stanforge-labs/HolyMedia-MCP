#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
release=/srv/holypilot-landing/2026-10-16-static-v1
snippet="$root/nginx/holypilot-landing.conf"
fixture=$(mktemp)
port=18080

sudo install -d -m 0755 "$release"
sudo cp "$root"/site/* "$release"/
sudo chmod 0644 "$release"/*
cat > "$fixture" <<EOF
pid /tmp/holypilot-static-nginx.pid;
error_log /tmp/holypilot-static-nginx-error.log;
events { worker_connections 128; }
http {
    include /etc/nginx/mime.types;
    server {
        listen 127.0.0.1:$port;
        server_name mcp.holymedia.kz;
        include $snippet;
        location / { return 418; }
    }
}
EOF

cleanup() {
  sudo nginx -s stop -c "$fixture" >/dev/null 2>&1 || true
  rm -f "$fixture"
}
trap cleanup EXIT
sudo nginx -t -c "$fixture"
sudo nginx -c "$fixture"

base="http://127.0.0.1:$port"
code() { curl -fsS -o /dev/null -w '%{http_code}' -H 'Host: mcp.holymedia.kz' "$base$1" || true; }
for path in / /en /_holypilot/landing.css /_holypilot/symbol.svg /_holypilot/icon.svg /_holypilot/og.png /_holypilot/manrope-cyrillic.woff2; do
  [[ $(code "$path") == 200 ]] || { echo "FAIL static route $path"; exit 1; }
done
for path in /auth /en/auth /dashboard /mcp /mcp/approve /api/auth/session /oauth/authorize /.well-known/oauth-authorization-server; do
  [[ $(code "$path") == 418 ]] || { echo "FAIL protected fallback $path"; exit 1; }
done
curl -fsS -H 'Host: mcp.holymedia.kz' "$base/" | grep -F HolyPilot >/dev/null
curl -fsS -H 'Host: mcp.holymedia.kz' "$base/en" | grep -F 'Your personal AI marketer' >/dev/null
curl -fsSI -H 'Host: mcp.holymedia.kz' "$base/" | grep -Fi "Content-Security-Policy: default-src 'none'" >/dev/null
curl -fsSI -H 'Host: mcp.holymedia.kz' "$base/" | grep -Fi 'X-Content-Type-Options: nosniff' >/dev/null
curl -fsSI -H 'Host: mcp.holymedia.kz' "$base/_holypilot/landing.css" | grep -Fi 'Content-Type: text/css' >/dev/null
echo 'Nginx syntax, exact public routes, protected fallback and security headers PASS'

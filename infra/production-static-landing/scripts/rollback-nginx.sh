#!/usr/bin/env bash
set -euo pipefail

backup=${1:?pass the protected backup directory}
case "$backup" in
  /var/backups/adforge-mcp/holypilot-static-*) ;;
  *) echo 'Refusing a backup outside the HolyPilot rollback directory' >&2; exit 2 ;;
esac

target=/etc/nginx/sites-enabled/adforge-mcp
baseline_sha=c711bb0b6f85390afa8482ed58611371c3648690a55f09f421254475e8fd1b91
[[ -f "$backup/adforge-mcp.before.conf" ]] || { echo 'Missing protected Nginx backup' >&2; exit 3; }
[[ $(sha256sum "$backup/adforge-mcp.before.conf" | cut -d' ' -f1) == "$baseline_sha" ]] || { echo 'Backup checksum mismatch' >&2; exit 4; }

install -m 0644 -o root -g root "$backup/adforge-mcp.before.conf" "${target}.holypilot-rollback.tmp"
mv -f "${target}.holypilot-rollback.tmp" "$target"
nginx -t
systemctl reload nginx
[[ $(sha256sum "$target" | cut -d' ' -f1) == "$baseline_sha" ]]
echo 'Original Nginx routing restored; existing Web handles the public home again'

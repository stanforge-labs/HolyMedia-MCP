#!/usr/bin/env bash
# sshd authorized_keys forced command. No interactive shell or forwarding.
set -euo pipefail
read -r verb service image revision extra <<< "${SSH_ORIGINAL_COMMAND:-}"
[[ $verb == deploy && -z ${extra:-} ]] || exit 2
[[ $service =~ ^(api|web|worker)$ ]] || exit 2
[[ $image =~ ^ghcr\.io/stanforge-labs/holymedia-mcp-v2@sha256:[a-f0-9]{64}$ ]] || exit 2
[[ $revision =~ ^[a-f0-9]{40}$ ]] || exit 2
exec sudo -n /usr/local/sbin/holymedia-compose-deploy "$service" "$image" "$revision"

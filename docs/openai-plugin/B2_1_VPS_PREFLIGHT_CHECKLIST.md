# B2.1 production preflight — operator worksheet, read-only

**Status:** BLOCKED. Codex has no trusted authorized SSH session to the VPS. This worksheet is for an authorized operator after separate OWNER permission. Record IDs, counts, status and paths only; never copy env values, token material, private keys or client data into evidence.

1. Verify the VPS SSH host fingerprint against an independent owner-held record. Do not use `StrictHostKeyChecking=no`, an unknown password or another person's credentials. Confirm production source, five expected services and zero active TEST services.
2. Record exact immutable `V2_API_IMAGE`, `V2_WEB_IMAGE`, `V2_WORKER_IMAGE` digest references from the root-only deployment state, each running container's image ID and `healthy` state, and cached previous API/Web images. Keep the state file contents private; only redact to digest references in the report.
3. Confirm PostgreSQL/Redis health, `/health` and `/ready`; inspect `_prisma_migrations` for 0034 applied/absent and failed rows. Confirm storage headroom, backup location and SHA-256, root-only permissions, age and a documented restore rehearsal. Do not run a migration, restore or backup in this read-only step.
4. Inspect effective Nginx route targets for `/.well-known/oauth-authorization-server`, `/.well-known/oauth-protected-resource/mcp/public`, `/.well-known/openid-configuration`, `/.well-known/jwks.json`, `/oauth/userinfo`, `/oauth/authorize`, `/oauth/token` and `/mcp/public`. Record the route target/status only. Ensure OIDC paths will reach API rather than Web/legacy MCP. Current public OIDC 404 is expected before rollout.
5. Query only counts/statuses of public and legacy OAuth clients, unexpired READ grants/refresh records, revoked records and reviewer identity verification provenance. Do not extract token digests, encrypted credentials or email lists. Check old Anthropic `/mcp/public` connections via metadata, without refresh or reconnect.
6. Verify `PUBLIC_MCP_WRITE_SCOPE_ENABLED=false` (or absent/default false) through authorized configuration inspection without printing the rest of the env, and verify 41 public READ tool names. Do not call provider tools or diagnostics.
7. Before any B3 rollout, confirm the reviewed root-owned forced-command/readiness scripts and sudoers rule are installed, candidate `api-runtime` resolves to `node` UID 1000, Compose has only the API read-only key bind, and the key file is readable only by UID 1000 inside the container. No PEM/base64 material in environment, image, GitHub logs or artifacts.
8. If any item is unknown or fails, leave `openai-oidc-release-ready` absent and report **NO-GO**. The operator marker is created only after the owner separately authorizes B3, backup and migration have been verified, and all preflight evidence is recorded.

## B2.2 trusted access status and minimum operator commands

On 23 October, no authorized SSH process or VPS console was available in this Codex session. The earlier strict SSH attempt failed, and no new login was attempted. The SSH host fingerprint has not been corroborated against an independent owner-held record. An authorized operator must perform the following **read-only** checks through their existing trusted console. Keep command output local; report only statuses, counts, immutable digests and timestamps. Never paste full environment files, Nginx configuration, token rows or private keys.

```bash
# First compare the host fingerprint with the independently held record.
# Check source if this is a Git checkout; a missing checkout is not a release SHA.
git -C /opt/adforge-mcp-v2 rev-parse HEAD
sudo awk -F= '/^V2_(API|WEB|WORKER)_IMAGE=/{print $1 "=" $2}' /etc/holymedia-v2/deploy-images.env
sudo docker ps --format '{{.Names}} {{.Status}} {{.Image}}'
sudo docker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}}' '<each recorded immutable digest>'
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 8 https://mcp.holymedia.kz/health
curl -sS -o /dev/null -w '%{http_code}\n' --max-time 8 https://mcp.holymedia.kz/ready
sudo nginx -t
sudo nginx -T 2>/dev/null   # inspect locally; report only the OAuth/OIDC/MCP path-to-upstream mapping
sudo stat -c '%n %U %a %s %y' '<owner-identified protected backup>'
sudo sha256sum '<owner-identified protected backup>'
```

For PostgreSQL, use the existing production PostgreSQL container and `psql` with `PGOPTIONS='-c default_transaction_read_only=on'`. Run only these aggregate queries in a `BEGIN READ ONLY` transaction:

```sql
BEGIN READ ONLY;
SELECT count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS failed,
       count(*) FILTER (WHERE migration_name = '0034_openai_oidc_identity' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS migration_0034_applied
  FROM "_prisma_migrations";
SELECT status, count(*) FROM mcp_oauth_clients GROUP BY status;
SELECT status, count(*) FROM oauth_public_clients GROUP BY status;
SELECT count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now() AND scope LIKE '%adforge:mcp:read%') AS active_read,
       count(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked
  FROM oauth_access_tokens;
SELECT count(*) FILTER (WHERE revoked_at IS NULL AND expires_at > now() AND used_at IS NULL) AS active_refresh,
       count(*) FILTER (WHERE revoked_at IS NOT NULL) AS revoked
  FROM oauth_refresh_tokens;
COMMIT;
```

Do not select token digest/prefix, client identifiers, email or credential columns. Inspect the existing restore-rehearsal record and cached Web/API rollback digests without performing restore or backup. Inspect `PUBLIC_MCP_WRITE_SCOPE_ENABLED` and `PUBLIC_MCP_CONTROLLED_WRITE_ENABLED` as OFF/NOT_OFF only, both in the protected `app.env` and running API container. Compare installed forced-command/sudoers scripts with the reviewed PR #10 files and confirm exact release SHA. Any missing evidence is **NO-GO**.

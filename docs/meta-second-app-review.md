# Second Meta App Review rename

The independent policy is `SECOND_META_APP_REVIEW` in
`apps/api/src/mcp/meta-app-review-write.policy.ts`.
It is limited to the owner-confirmed `mcpclient@holymedia.kz` workspace
`acbf0667-2a34-4ee8-b720-f63581f12eed` and permanent service token
`ae452fdf-788e-44c7-a2dc-5351fdba0681`,
account `act_832949381388598`, campaign `120254614255020709`.
Only `change_name` with exactly `{new_name: string}` is accepted, trimmed to
`New Awareness Campaign - ads_management demo`. The required source name is
`New Awareness Campaign`. Commit re-reads Meta and requires `PAUSED`. No status,
budget or other fields are requested. Post-read verifies business invariants.
The original environment-configured exact-target policy is unchanged.

## Persistent configuration

Set in the canonical API environment `/etc/holymedia-v2/app.env`, consumed by
`infra/docker-compose.v2.production.yml`, not only inside the running container:

```dotenv
V2_META_APP_REVIEW_SECOND_RENAME_ENABLED=true
V2_PREVIEW_ONLY=true
V2_CONFIRMED_WRITE_ENABLED=false
```

Disable the second exception by setting its flag to `false` and recreating API.
Do not change the original `V2_META_APP_REVIEW_RENAME_*` values.
Tokens still require read/write scopes, workspace ownership, an enabled account,
and matching internal ProviderAccount UUID restrictions. Read-only remains the
new-key default. Never put an `act_*` identifier into UUID restrictions.

## AI flow

The user must explicitly request the exact authorized rename.
`preview_change_campaign_name` → `confirm_preview` →
`commit_meta_confirmed_write`. Tool descriptions permit the AI to execute these
steps within that one explicit request; read/query intent does not authorize it.
Each preview is bound to the service token and workspace, expires in ten minutes,
and is atomically consumed. This second policy rejects a changed source name,
including an already-applied target. Generic `preview_meta_update_campaign`
is not a rename substitute and remains blocked. Use the dedicated name tool.
No reverse exception is enabled by this patch. Reverse preparation requires a
separate narrowly authorized execution after confirmed forward delivery.
Never run a live rename as a deployment smoke test without an authorized name.

## Deployment safety

Check free VPS space and preserve current production/rollback, DB, Redis and
volumes. Do not start a candidate pull when its missing compressed and unpacked
layers cannot fit with headroom. Only deploy API/Web/Worker after green gates.
This change needs no database migration of its own.

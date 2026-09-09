# Second Meta App Review rename

The independent policy is `SECOND_META_APP_REVIEW` in
`apps/api/src/mcp/meta-app-review-write.policy.ts`.
It is limited to external account `act_832949381388598` and campaign
`120254614255020709`, not a particular workspace, internal account UUID, key,
source name or target name. Tenant authorization is a separate mandatory boundary:
live token/identity, active workspace and creator, current creator membership,
enabled account in that workspace and connection, and token account restrictions.
Only `change_name` with exactly `{new_name: string}` is accepted, trimmed to a
nonempty name of at most 255 characters different from the live current name.
Commit re-reads Meta and requires `PAUSED`. No status,
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

The user must explicitly authorize the requested rename and confirm its preview.
`preview_change_campaign_name` → `confirm_preview` →
`commit_meta_confirmed_write`. Tool descriptions permit the AI to execute these
steps within that one explicit request; read/query intent does not authorize it.
Each preview is bound to the service token and workspace, expires in ten minutes,
and is atomically consumed. Its server-side JSON diff includes a versioned live
snapshot bound to workspace, token, identity, connection, internal/external
account, campaign, current/requested name, status, operation, allowed fields and
retrieval time. No schema migration is needed; older previews lacking the snapshot
fail closed and require a new preview. Confirmation validates the binding, and
commit repeats the live read and rejects changes to name/status since preview.
Meta does not provide an atomic compare-and-swap here: the live reread narrows,
but cannot eliminate, the external race between that read and the mutation.
Generic `preview_meta_update_campaign`
is not a rename substitute and remains blocked. Use the dedicated name tool.
Any new safe name can be authorized in a new preview, even after a prior rename.
No special reverse exception or fixed source/target pair is necessary.
New controlled-write keys snapshot the currently enabled connected account IDs
through the normal creation API when no explicit account list is supplied.
Empty selection fails closed; read-only key creation behavior is unchanged.
Changing a connection/account after preview requires a fresh preview. Creating a
new connection and selected account before creating a new key needs no policy edit.
Never run a live rename as a deployment smoke test without an authorized name.

## Deployment safety

Check free VPS space and preserve current production/rollback, DB, Redis and
volumes. Do not start a candidate pull when its missing compressed and unpacked
layers cannot fit with headroom. Only deploy API/Web/Worker after green gates.
This change needs no database migration of its own.

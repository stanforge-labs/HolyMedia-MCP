# Isolated Google OAuth acceptance — no writes

Application source is pinned to `7da2fbbe7d150072183bc5e121cae4abae019ddc`.
The acceptance branch adds CI/harness tooling only; the image checks out and builds the exact source,
not the harness branch HEAD. API-only image is digest-pinned on the VPS; no Web/Worker is needed.

Compose project: `holymedia-google-acceptance`, directory `/opt/holymedia-google-acceptance`.
Separate PostgreSQL 18 and Redis 7.4, named volumes and Compose network. No DB/Redis host ports.
Only entry is VPS `127.0.0.1:4400`; no Nginx or firewall changes. A tiny acceptance-only gateway
forwards health/callback to the unmodified API and renders the callback outcome without tokens.

Provisioning reads only the two Google client ID/secret keys (or their V1-compatible aliases) from
production app.env. No production refresh tokens, DB/Redis/session/encryption/provider keys are reused.
Fresh secrets are generated remotely and stored in root-owned mode-600 acceptance.env. The encrypted
credential vault is exclusively the disposable DB. Cookies/session secrets are not returned to chat.

`/acceptance/oauth/start` creates a fresh state on each explicit browser action by calling the real
authenticated `POST /api/v1/workspaces/:id/connections/GOOGLE_ADS/oauth/start` with a local disposable
owner identity. No authorization URL is hand-constructed. Google consent is manual and must use
`crazy2003feog@gmail.com`; Ads-only scope does not independently prove that email identity.

Use the SSH tunnel:

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:4400:127.0.0.1:4400 ubuntu@77.240.38.131
```

Then open `http://localhost:4400/acceptance/oauth/start`. State TTL is 10 minutes, generated on click.
Do not copy code, state or tokens from the browser. Callback uses the real provider controller,
one-time state/session checks and AES-256-GCM vault. Return to Codex after successful callback.

## Additional acceptance-only transport guard

The API uses a mounted Node preload guard, not an application source patch. It blocks every Google
mutate endpoint, including validate-only, and permits only v24 customer/customer_client metadata queries
for `4378327049` and `8590146099`, with MCC login `4378327049`. Discovery first reads accessible customer
IDs; hierarchy is preflighted with an IDs-only query before descriptive fields are requested.
Unexpected accessible/hierarchy IDs stop further discovery and are recorded as IDs only; no
third-party customer data requests are made. Counters contain no credentials, request bodies or headers.
Normal provider request logs omit OAuth query parameters.

Write gates remain false, all allowlists empty. This guard is intentionally proof-only: later write
acceptance needs a new explicitly authorized task and test_account=true/hierarchy evidence first.
Changing env alone cannot bypass the current guard.

## Verification / lifecycle

- Baseline verifies all five production services healthy and records IDs, image IDs, start times,
  restart counts and protected configuration hashes; verify requires them unchanged afterward.
- Exact image source label, non-root runtime and immutable digest are verified before starting API.
- Migrations/status/seed execute only against disposable `postgres:5432/google_acceptance`.
- Seed creates one local owner/workspace, not a production identity.
- API health/ready and loopback binding must pass before returning the start URL.
- First stop is before Google consent: real provider read/write calls are both zero.
- After consent, separately prove customer.id, customer.test_account=true and MCC hierarchy. No writes.

Production compose/env/containers/DB/Redis/Nginx/main are never modified. Recovery images are retained.
No automatic cleanup or provider disconnect/revoke in this step. Stack and protected vault remain for
the next user-authorized proof step; cleanup requires a scoped follow-up.

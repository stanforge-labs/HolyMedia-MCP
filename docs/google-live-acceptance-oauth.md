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

The gateway rewrites only `GET /api/v1/oauth/GOOGLE_ADS/callback` to the API's actual
`/oauth/GOOGLE_ADS/callback` route. It preserves the original query string byte for byte and
never logs callback parameters. Google redirect URI and the production callback contract stay
unchanged. Parameterless callback smoke checks must return 302 with `invalid_callback`, not 404;
`/dashboard/connections` is a gateway-owned 200 HTML outcome page. Regression coverage:
`node --test scripts/google-live-acceptance/gateway.test.mjs` (mock upstream, synthetic query only).
After a failed/exposed attempt, start from `/acceptance/oauth/start` to generate a new one-time
state; never replay the old callback URL, code or state.

## Additional acceptance-only transport guard

The API uses a mounted Node preload guard, not an application source patch. It blocks every Google
mutate endpoint, including validate-only, and permits only v24 customer/customer_client metadata queries
for `4378327049` and `8590146099`, with MCC login `4378327049`. Discovery first reads accessible customer
IDs; hierarchy is preflighted with an IDs-only query before descriptive fields are requested.
The accessible-customer list must contain TEST MCC `4378327049`; the harness filters that response
to `4378327049` and `8590146099` before the unmodified provider adapter discovers any metadata.
Other directly accessible IDs are ignored without metadata requests. Unexpected hierarchy children
still stop discovery before descriptive reads. Counters contain no credentials, request bodies or headers.
Normal provider request logs omit OAuth query parameters.

In the separately authorized fixture-preview phase, only the disposable Google write gate is ON
and its allowlist is exactly `8590146099`. Public write flags and confirmed-write capability remain
OFF; `V2_PREVIEW_ONLY=true`. Every actual mutate is blocked, including MCC writes. The guard permits
only atomic `validateOnly=true`, `partialFailure=false` campaign-fixture creates on the TEST CLIENT
after a fresh (30-minute maximum age) canonical test_account/hierarchy proof. No flag alone bypasses
this requirement. Fixture reads/reference resolution are scoped to the test client and Almaty, KZ.

The fixture is built through actual authenticated legacy MCP `create_campaign_from_brief`, with
an actual controlled service key restricted to the selected client. The account currency is USD,
so the small paused fixture uses 2 USD/day and MANUAL_CPC with 0.10 USD ad-group bid. Geo is resolved
and confirmed as Google City `9235214` (Almaty, Kazakhstan), language Russian `1031`. Plan: 1 group,
20 EXACT/PHRASE keywords, 1 PAUSED RSA, 26 atomic operations. Preview TTL is the existing 30 minutes.

The API-only harness serves a minimal `/mcp/approve` shell with the same fragment-only approval
contract. It uses the seeded disposable owner's real HolyMedia cookie session and CSRF protections
and invokes only the existing `/api/v1/mcp/public/approval/view` and explicit approve/cancel endpoint.
GET never approves; no commit route is exposed by the gateway. Approval nonces stay in browser
memory, are removed from the address bar, and are never logged. Protected state files retain the
service key/preview for the next task; Google tokens stay encrypted in the disposable DB.

## Verification / lifecycle

### Existing fixture budget reconciliation (2026-10-07)

The already-approved fixture `HM_MCP_WRITE_ACCEPTANCE_20261007T134837Z` was created once,
with atomic 26-operation commit `hmc_WYmKzVTcdxdkNxEP_jrzTjNP-sZX4X3aEt4mUIew0Ag`.
Original HolyMedia verification/journal result remains **UNVERIFIED**: budget naming was incorrectly
treated as independent and the budget reread omitted `name`.

Product fix `4cead41ea4e430dc00698cee29511425ffb20661` removes non-shared create `name`, explicitly
verifies the provider-derived campaign name and real campaign/budget association, and adds the name SELECT.
It is cherry-picked into live acceptance, not main. Shared names stay exact; other budget fields remain strict.

READ-only reconciliation uses `reconcile-fixture.mjs` and `reconcile-read-guard.mjs`, with the built
product verifier mounted read-only into a one-off container from the existing immutable acceptance image.
It does **not** replace the running acceptance API/image or publish ports, restart infrastructure, create
a preview, call commit, retry a mutate, or run validate-only. The child process has write gates OFF/EMPTY.
Its guard permits only canonical TEST-client metadata and the exact created resource-name reread queries;
all mutation endpoints, MCC/foreign account requests and authorization-code exchanges are blocked.
Normal stored-token refresh is allowed without logging token values.

The corrected verifier rereads all six created resource kinds and confirms **26/26 VERIFIED**:
campaign/budget/group, 20 keywords, RSA, Almaty and Russian criteria. Canonical `test_account=true`
proof is repeated with MCC login. This reconciliation performed **7 Google Ads READ calls, 0 writes,
0 validate-only**. The historical single creation mutation remains the only Google Ads write.

Original preview and audit rows are compared before/after and remain immutable. Existing AuditService
appends `mcp_google_commit_reconciled`, with original result UNVERIFIED, reconciled result VERIFIED,
commit/preview IDs, verifier source/hash, timestamp and resource count. No migration or historical
journal rewrite is performed. Protected VPS evidence: `/acceptance-state/fixture-budget-reconciliation.json`.
Safe IDs/results are retained in `artifacts/google-live-acceptance/fixture-budget-reconciliation-20261007.json`.

Automatic destructive cleanup/rollback remains unsupported; campaign/group/RSA stay PAUSED.
Further live acceptance mutations require a new explicit user task.

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

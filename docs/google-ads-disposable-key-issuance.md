# Disposable Stage 2–4 acceptance key

The October 9 authorization permits one 24-hour TEST key through the existing
`POST /api/v1/workspaces/:workspaceId/service-tokens` administrative API. It is
not Google mutation authorization or browser approval.

The isolated supervisor verifies the expired previous identity, unchanged owner,
workspace and STATIC_ALLOWLIST, then authenticates the existing TEST human through
stock session/CSRF routes. The request explicitly selects only the internal
ProviderAccount belonging to customer `8590146099`, scopes `adforge:mcp:read` and
`adforge:mcp:write`, and `expiresInDays: 1`. MCC is never a write target. All
Google write gates, confirmed-write and public-write flags are OFF during issuance.

A permanent exclusive issuance claim precedes the single POST. Failure or an
ambiguous response does not permit an automatic retry or another key. No direct
database inserts, authority extensions or production credentials are used.

The response secret is immediately sealed by the existing CredentialVaultService
with the disposable keyring. New fixture, preview and rollback contexts are
encrypted, private mode 600, bounded and nonsymlink files. Public metadata is
authenticated against the encrypted wrapper and is not commit authority. Python
supervisor hints cannot replace Node decryption, exact persisted immutable plan,
stock approval/session/audit checks, stale validation or provider proof.

Safe evidence contains key ID, fingerprint, expiry, scopes and access/audit checks;
never token, cookies, ciphertext, keys or Authorization headers. Historical expired
context, preview and audit are preserved. `tools/list` access verification is not
cross-client Q/R acceptance and performs no Google provider calls.

Tests: `node --test scripts/google-live-acceptance/stage234/*.test.mjs` and
`python -m unittest discover -s scripts/google-live-acceptance/stage234 -p 'test_*.py'`.
The stock AES-GCM helper test uses synthetic credentials only. Live issuance and
live Google validation are recorded separately from these tests.

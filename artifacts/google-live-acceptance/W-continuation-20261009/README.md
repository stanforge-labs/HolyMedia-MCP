# W completion harness — immutable historical acceptance

The W RESUME and RESTORE were completed once in disposable acceptance on TEST customer 8590146099. Both previews are consumed; these runners must NOT be replayed. Durable write/commit claims and evidence-file collision guards intentionally prevent retry. No production/main deployment or Google account outside the exact test allowlist is permitted.

Snapshot fix: the initial extra harness comparison compared unordered GAQL rows. The continuation now calls existing product `rereadStage0Checks`, which applies canonical sorting. The product stale/approval guards and immutable preview payload were NOT changed. Historical blocked evidence remains intact. `W-snapshot-order.test.mjs` reproduces reordered equal rows and true changed state using the actual compiled product function.

Runtime code is mounted from a verified six-module SHA manifest; Google credentials, service/preview tokens and approval session details are loaded only from protected disposable runtime/DB. No secret context file is checked in. Permanent API identity and five production services/environment hashes are checked before/after every one-off. Each commit requires exact persisted human approval, valid session/audit, unchanged payload, TTL and fresh customer/stale proof.

Local regression (no external provider calls): set W_PRODUCT_ROOT to the compiled integration checkout, then `node --test W-snapshot-order.test.mjs W-restore-commit-guard.test.mjs`. Eight tests PASS. Transport tests block selfapproval, token replacement, other accounts/MCC writes, expired/stale proof and wrong atomic body.

Sanitized final closeout is tracked on the integration branch at `artifacts/google-live-acceptance/stage01-final-live-acceptance-20261009.json`. Detailed local historical evidence is preserved separately; do not rewrite the original UNVERIFIED fixture commit or its separate VERIFIED reconciliation.

# Source-pinned READ-only targeting readiness runner

Entry: `scripts/google-live-acceptance/stage234/targeting-readiness-runner.mjs`. Importing this module does not initialize the app, decrypt credentials, execute provider requests or write files. Execute it only through the authorized isolated acceptance supervisor; this implementation package itself has not run it live.

## Runtime contract

- Stock compiled modules are imported lazily from fixed `/workspace` config/database/Vault/GoogleAdsAdapter paths. Compiled source SHA and immutable OCI digest must be externally verified by the supervisor. A distinct read-only harness SHA is reported separately; mounting this harness does not claim an old image contains new product code.
- Required environment: `STAGE234_SOURCE_HEAD` and `STAGE234_HARNESS_HEAD` (exact 40-hex SHAs), `STAGE234_IMAGE_DIGEST` (immutable `sha256:`), `STAGE234_RUN_DIR=/acceptance-state`.
- `/acceptance-state` must be a protected non-symlink directory; `/acceptance-state/fixture-context.json` must be the **encrypted** selected context read through stock `readAcceptanceContext`. Plaintext legacy reads are forbidden.
- All Google Stage 0–4 and controlled/public write flags must be OFF, preview-only ON. Allowlist is empty or exactly TEST Client `8590146099`; a selected active scoped key still must have `STATIC_ALLOWLIST` for the single owned local TEST account. Expiry, digest/key identity, workspace, service identity and sole enabled account are checked against disposable DB evidence.
- Database URL must resolve to `postgres/google_acceptance`, Redis to `redis`, Google API to v24 with login MCC `4378327049`. The supervisor must independently verify that these resources/network are the existing isolated disposable stack, never production.

## Reads and credentials

The runner freezes the existing fixture and delivery settings before independent inventories, then rereads and compares them afterward. It requires all 20 original keywords ENABLED, residual PHRASE PAUSED, campaign/group/RSA PAUSED, both known TEST campaigns and their groups/RSAs PAUSED, main group CPC `100000` micros, and the detached existing SharedSet. Source/hierarchy/customer/status/criteria/restriction changes are blockers. Repeated unset targeting arrays and an omitted queried `negative=false` use only their known protobuf defaults; no invented catalog or money values are substituted.

Only exact queries from the readiness manifest and five existing fixed delivery/shared-list READ queries are allowed. Google MCC receives only the direct TEST child hierarchy READ. All mutate, validate-only, approval, arbitrary query/body, foreign account and other-origin requests are blocked. Refresh is delegated to the existing read-only transport guard, restricted to the normal exact refresh form fields and at most one request. Credentials remain in memory; a successful refresh updates only encrypted credentials in the disposable vault. Refresh has a separate counter and is not a Google Ads mutation. No automatic mutation or refresh retry is allowed.

Unavailable I/J/PMax inventories produce safe per-query API errors and separate readiness blockers; they do not claim global inventory absence and do not invalidate an otherwise unchanged N fixture. Every catalog query is processed separately without truncating combined results. Source/fixture guards remain global blockers. I/J prepared proposals are not executed; J still needs explicit TEST center coordinates. PMax output is metadata prerequisite evidence, not brand rights, binary/policy review, campaign creation or new goals/uploads.

## Output

Exactly one sanitized artifact, `targeting-readiness-evidence.json`, is created with mode 600 and exclusive-create semantics in the supervisor's fresh directory. Existing evidence is never overwritten. The artifact records source/harness/digest, fixture digest/comparison, per-query counts/errors, typed readiness results, READ/refresh counts, `validate_only=0`, `real_write=0`, and unchanged production/main. It does not contain decrypted context, tokens, cookies, authorization headers, encryption keys, raw provider errors or raw inventory JSON.

Stdout contains only the supervisor-compatible summary fields: `result`, `code`, `provider_reads`, `validate_only`, `real_writes`, `evidence`, `I`, `J`, `PMax`, `failure_stage`. Q/R/S have no live client/consent proof in this runner and remain NOT RUN. No API server, ports, preview, approval or commit is started by the runner.

Tests use synthetic stock-shaped dependencies and an in-memory mocked transport only. Live prerequisite proof and all human approvals remain separate user-authorized checkpoints.

# Google Ads Write — pre-release review, not a release authorization

Verdict: **NOT READY**. Named TEST advertising acceptance A–P/T–W is 20/20 LIVE PASS, but cross-client Q/R/S, PMax eligibility/live proof, clone LIVE proof and security-owner review remain open. No main merge, production deployment, migration, OAuth change, Public MCP write enablement or production Google mutation is authorized by this review.

## Candidate and ancestry

Current working branch: `codex/google-ads-write-full-scope-final`, tracked HEAD `9e3a3dc70c4e000a2db789f292d6d853cae6dcb9`, matching the remote branch when checked. `origin/codex/google-ads-stage01-integration-final` and `origin/codex/google-ads-write-stage234-integration` are Git ancestors of this HEAD. Individual Stage 2/3/4 topic tips are **not** all literal ancestors; the integrated candidate must be reviewed by content/tests, not by claiming a straight merge of every topic branch. The existing Stage 0+1 release candidate is untouched. New local readiness docs/probe are not an immutable release candidate until selectively committed, pushed and verified on their exact SHA.

## Gates and evidence

| Gate                     | Evidence now                                                                                                                                           | Release decision                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| TEST advertising letters | 20/20 LIVE PASS, provider reread/journal; see `google-ads-lettered-closeout-20261013.md`                                                               | PASS for these named scenarios only                                                                                             |
| Native Q/R/S             | Existing private OAuth/typed tool code and local regressions, no real ChatGPT/Gemini client calls                                                      | BLOCKED                                                                                                                         |
| PMax                     | Typed supported profiles/mock tests; last TEST inventory has no eligible IMAGE assets or conversion actions                                            | LIVE BLOCKED; optional new campaign creation is not a substitute for mandatory edit scope                                       |
| Clone                    | Bounded Search/RSA profile/mock regressions, explicit unsupported-source rejection                                                                     | REQUIRED LIVE GAP; source compatibility/full original-scope decision still needed                                               |
| Windows local quality    | Format, lint, typecheck, build, Prisma and secret scan PASS in this checkpoint; full test command passed with local skipped DB/Redis integration tests | PARTIAL; `0xC0000005` remains intermittent and root cause unproven                                                              |
| Hosted Linux CI          | Last recorded exact tracked HEAD: 1783 PASS / 0 skipped; no new run in this checkpoint                                                                 | Fresh run required after any candidate commit                                                                                   |
| Dependency security      | Fresh `pnpm audit --audit-level high`: Critical 0 / High 0 / Moderate 6                                                                                | Six Moderate findings require owner risk review (`artifacts/google-full-scope/moderate-security-risk-assessment-20261009.json`) |

The local full test run succeeded, but API had 1433 passed / 21 skipped and Worker 14 passed / 2 skipped; those skipped cases require isolated PostgreSQL/Redis or hosted CI. Do not label Windows as 0 skipped. A narrow native MCP/OAuth/shared-budget run passed 80 tests; the new no-credential transport probe passed three tests. These are not Q/R/S LIVE proof.

## Safe deployment sequence after separate approval

1. Freeze a new exact candidate SHA and dependency lock, run hosted Linux CI plus secret/dependency scan on that SHA, review all skipped/failing jobs and Prisma migration diff. No database migration is introduced by the local readiness probe/docs.
2. Prove isolated TEST native endpoint, OAuth metadata/PKCE/login, Q/R/S real clients, account allowlist and browser approval without changing production/Public MCP flags. Obtain separate human approval for any TEST Google mutation and its restoration.
3. Resolve required PMax/Clone evidence or obtain an explicit written, paragraph-anchored scope decision; review six Moderate advisories and Windows crash root cause/risk.
4. Prepare an operator-owned production backup/rollback point, immutable image digests, DB migration plan if later changes add migrations, feature-flag OFF startup and health/ready/READ checks. Do not copy TEST vault credentials to production.
5. Only after a separate release approval may an operator merge/deploy. Keep Google production write and Public MCP write OFF by default. Any later flag enablement or client allowlist expansion is a separate change with a controlled rollback.

Rollback boundary: revert the deployment image/config to the pinned prior production digest; disable newly introduced TEST transport/tunnel separately; preserve DB/audit. Never use a raw Google mutation, automatic commit retry, destructive volume cleanup, `git reset --hard` or a production migration rollback without its own approved procedure. This document is a checklist, not an execution log.

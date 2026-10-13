# Google Ads Write — pre-release review, not a release authorization

Verdict: **NOT READY**. Named TEST advertising acceptance A–P/T–W is 20/20 LIVE PASS, but cross-client Q/R/S, PMax eligibility/live proof, clone LIVE proof and security-owner review remain open. No main merge, production deployment, migration, OAuth change, Public MCP write enablement or production Google mutation is authorized by this review.

2026-10-13 delta: the prior six Moderate dependency advisories are patched in the TEST feature branch and local audit is clear; this is not a production release. Exact-owner Google binding is approved in principle but awaits explicit protected email selection, TEST-only activation and real browser verification. Q/R/S remain NOT RUN, and PMax/Clone LIVE gates remain open. Keep release verdict **NOT READY**.

### Dependency advisory disposition (feature branch only)

| Audit ID | Package/path                               | Former risk                      | New resolved version |
| -------- | ------------------------------------------ | -------------------------------- | -------------------- |
| 1239991  | `js-yaml` through Swagger                  | Excessive CPU on crafted YAML    | 5.4.1                |
| 1240090  | `fast-uri` 4.x through Fastify serializers | URI host interpretation mismatch | 4.1.5                |
| 1240091  | `fast-uri` 3.x through Ajv                 | URI host interpretation mismatch | 3.1.8                |
| 1240093  | `fast-uri` 4.x through Fastify serializers | `mailto:` URI parsing/injection  | 4.1.5                |
| 1240103  | `brace-expansion` through `minimatch`      | Quadratic expansion work         | 5.0.12               |
| 1240639  | `fastify` in API runtime                   | HTTP/2 trailer denial of service | 5.12.5               |

These are compatible patch-version updates with full local tests, build, Prisma validation, secret scan and `pnpm audit --audit-level moderate` PASS (`No known vulnerabilities found`). This proves only the feature-branch lockfile and tested image, not production remediation. Preserve the historical six-Moderate assessment as dated evidence rather than rewriting it.

## Candidate and ancestry

Audited base branch: `codex/google-ads-write-full-scope-final`, base HEAD `9e3a3dc70c4e000a2db789f292d6d853cae6dcb9`. Resolve the **current** candidate SHA with `git rev-parse HEAD`; a tracked document cannot safely self-reference its own final commit hash. `origin/codex/google-ads-stage01-integration-final` and `origin/codex/google-ads-write-stage234-integration` were Git ancestors of that base. Individual Stage 2/3/4 topic tips were **not** all literal ancestors; the integrated candidate must be reviewed by content/tests, not by claiming a straight merge of every topic branch. The existing Stage 0+1 release candidate is untouched. The private-readiness docs/probe were selectively committed and tested as an engineering checkpoint, **not** approved as a production release candidate.

## Gates and evidence

| Gate                     | Evidence now                                                                                                                                                                                                                                                                   | Release decision                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| TEST advertising letters | 20/20 LIVE PASS, provider reread/journal; see `google-ads-lettered-closeout-20261013.md`                                                                                                                                                                                       | PASS for these named scenarios only                                                                                             |
| Native Q/R/S             | Existing private OAuth/typed tool code and local regressions; Q=ChatGPT, R=Claude, S=client-specific consent plus HolyMedia approval. No real client calls.                                                                                                                    | BLOCKED                                                                                                                         |
| PMax                     | Typed supported profiles/mock tests; last TEST inventory has no eligible IMAGE assets or conversion actions                                                                                                                                                                    | LIVE BLOCKED; optional new campaign creation is not a substitute for mandatory edit scope                                       |
| Clone                    | Bounded Search/RSA profile/mock regressions, explicit unsupported-source rejection                                                                                                                                                                                             | REQUIRED LIVE GAP; source compatibility/full original-scope decision still needed                                               |
| Windows local quality    | Format, lint, typecheck, build, Prisma and secret scan PASS in this checkpoint; full test command passed with local skipped DB/Redis integration tests                                                                                                                         | PARTIAL; `0xC0000005` remains intermittent and root cause unproven                                                              |
| Hosted Linux CI          | [Engineering checkpoint `35bea7b`](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38363934192): foundation SUCCESS, 1786 tests / 0 skipped and 60 Python; [isolated API image](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38363934161) SUCCESS | Recheck the exact later release-candidate SHA; image build is not deployment                                                    |
| Dependency security      | Fresh `pnpm audit --audit-level high`: Critical 0 / High 0 / Moderate 6                                                                                                                                                                                                        | Six Moderate findings require owner risk review (`artifacts/google-full-scope/moderate-security-risk-assessment-20261009.json`) |

The local full test run succeeded, but API had 1433 passed / 21 skipped and Worker 14 passed / 2 skipped; those skipped cases require isolated PostgreSQL/Redis or hosted CI. Do not label Windows as 0 skipped. A narrow native MCP/OAuth/shared-budget run passed 80 tests; the new no-credential transport probe passed three tests. These are not Q/R/S LIVE proof.

## Safe deployment sequence after separate approval

1. Freeze a new exact candidate SHA and dependency lock, run hosted Linux CI plus secret/dependency scan on that SHA, review all skipped/failing jobs and Prisma migration diff. No database migration is introduced by the local readiness probe/docs.
2. Prove isolated TEST native endpoint, OAuth metadata/PKCE/login, Q/R/S real clients, account allowlist and browser approval without changing production/Public MCP flags. Obtain separate human approval for any TEST Google mutation and its restoration.
3. Resolve required PMax/Clone evidence or obtain an explicit written, paragraph-anchored scope decision; review six Moderate advisories and Windows crash root cause/risk.
4. Prepare an operator-owned production backup/rollback point, immutable image digests, DB migration plan if later changes add migrations, feature-flag OFF startup and health/ready/READ checks. Do not copy TEST vault credentials to production.
5. Only after a separate release approval may an operator merge/deploy. Keep Google production write and Public MCP write OFF by default. Any later flag enablement or client allowlist expansion is a separate change with a controlled rollback.

Rollback boundary: revert the deployment image/config to the pinned prior production digest; disable newly introduced TEST transport/tunnel separately; preserve DB/audit. Never use a raw Google mutation, automatic commit retry, destructive volume cleanup, `git reset --hard` or a production migration rollback without its own approved procedure. This document is a checklist, not an execution log.

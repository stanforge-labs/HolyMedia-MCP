# Stage 0+1 release review — proposed actions, not a deployment

Candidate: `codex/google-ads-stage01-integration-final`, commit 371f67768d0b9d3f8318fbcc44595ee711979f89. Stage 2 is on `codex/google-ads-write-stage2-foundation` and must NOT be included in this Stage 0+1 release. The historical source/live fixture UNVERIFIED audit remains immutable; reconciliation is a separate VERIFIED result.

Stage 1 A/B/C/D/E/F/M/O/P and Stage 0 T/U/V/W are live accepted on official TEST customer 8590146099 only. Final two TEST campaigns, groups and RSA are PAUSED; 20 original keywords ENABLED inside paused parents; extra PHRASE 11479221 PAUSED; shared list 12261567996 has 3 EXACT members and zero active links. The acceptance ledger records 1794 reads / 27 validate-only / 17 real controlled writes; all writes target only TEST859. OAuth refreshes and external Google UI actions are separate, not silently counted as API writes.

## Preconditions before any merge/deploy authorization

1. Human review of this exact candidate and staged diff; confirm Stage 0+1 feature scope and documented asset/clone/rollback limitations. This file does not authorize main merge.
2. Actual Q (ChatGPT) and R (named second MCP client) evidence and client-specific S consent. They are BLOCKED until clients are connected; REST harness/mock must not be substituted for LIVE client acceptance.
3. Final hosted Ubuntu [CI run 37841328126](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/37841328126) at code commit 371f677 completed SUCCESS: decoded logs confirm 596 package tests PASS, zero skipped. Initial CI had one skipped special PG18 test; CI-only fixes create the dedicated DB and preserve strict Turbo env selectors. Independent disposable rerun passed all 26 tests with zero skips. Re-run CI on the exact subsequently reviewed merge/image source; this success is not permission to deploy.
4. Current dependency audit Critical 0 / High 0, 6 Moderate findings still tracked; standard secret scan and line-ending regression remain active. Next 16.3.8 fixes the candidate, not the currently running production Web. Security review must assess remaining Moderate findings and the real deployment scope.
5. No Prisma/schema/migration changes compared with origin/main in this candidate. Recheck the final reviewed diff, do not assume this stays true after later integration. Retain backup and previous immutable image regardless.
6. Choose API-only versus coordinated API/Web release deliberately. The Web Next security upgrade needs its own image and browser/operator regression; an API-only release does NOT remediate production Web. Existing Worker must be retained unless its change is expressly approved.

## Authorized deployment sequence to propose later

- After separate approval, merge only the reviewed Stage 0+1 commits via normal non-force process; re-run CI on exact merge SHA.
- Build immutable image(s) for that SHA, record digest, SBOM/audit and available disk/capacity. Never use a floating production/latest tag as source proof.
- Preserve previous image digest/config and DB backup; confirm all five current production services healthy and environment unchanged before action.
- Verify effective production Google write gate OFF, account allowlist empty and both Public MCP write flags OFF. Do not enable them as part of deployment or cross-client acceptance.
- Rehearse staging/disposable startup, read-only OAuth/provider/MCP and Web approval routes. Check health/ready, READ compatibility, Meta regression, owner/session/CSRF, stale/expired/consumed preview denials and audit/journal. No production Google write smoke.
- Apply only the separately approved service-image changes, then verify API/Web/Worker/Postgres/Redis health and read-only operator smoke. Record real actions/evidence; this preparation performed none of them.

## Rollback proposal

If deployment health/read/operator smoke fails: stop new writes (they should already be OFF), restore only approved affected services to retained prior immutable digest/config. Do not blindly downgrade DB, recreate volumes, restart unrelated services or delete Google resources. A prior provider commit is not undone by code rollback: new campaign trees are resource-heavy and their automatic delete rollback is unsupported; keep them PAUSED. Audit history and commit IDs remain immutable.

## Remaining scope

Stage 2 package A is implemented/mock-tested separately, OFF by default, no live calls. Package B strategies/portfolio/modifiers/filter expansion remains NOT IMPLEMENTED. Stage 3–4 are a proposed backlog, not implemented; the detailed original PPC document has not been recovered, so privacy/media/PMax additions need explicit scope validation.

Persistent checkpoint/evidence specifies the final CI status, branch heads and exact next manual client action. No merge/deploy/main/production mutation has been executed by this runbook.

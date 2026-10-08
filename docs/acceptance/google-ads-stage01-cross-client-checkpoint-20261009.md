# Stage 0+1 closeout and cross-client checkpoint

Stage 1 A/B/C/D/E/F/M/O/P PASS; Stage 0 T/U/V/W PASS. W restore preview 7624ef9e-295f-4148-9824-b42e8ac218a6 was manually approved, persisted, independently checked and committed once. Commit `hmc_n81Z_1zIgtR8ZWhBrcgHYtmRav7wJckZAxC4z8QE6Cs` VERIFIED. Campaign 24339483523, its two groups and two RSA are PAUSED. Both non-removed TEST campaigns are PAUSED. No pending write approval.

Final evidence: `artifacts/google-live-acceptance/stage01-final-live-acceptance-20261009.json`. Historical initial fixture UNVERIFIED commit is retained, separate reconciliation VERIFIED; history must not be rewritten.

Linux integration: initial commit 221371fd2c488a128c44c9f37b9de7195748a3c7, [Ubuntu Actions run 37837941865](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/37837941865), quality job 113519701940 SUCCESS. All steps reported SUCCESS: format/lint/typecheck/Prisma/migrations/import and backup-restore rehearsal/tests/build/API health/worker job/dependency-degradation/secret scan/dependency audit. Isolated PostgreSQL 18/Redis 7.4, integration env enabled, Google/Public write gates OFF. This is CI, NOT production deployment. Its log explicitly had 595 package tests PASS and 1 dedicated PG18 test SKIP, not zero skips. That test passed separately within the disposable 26/26 run.

Follow-up CI-only commits 15c14e4 and 371f677 prepare a separate `public_mcp_upgrade` DB and pass its two selectors through Turborepo strict env; no test guard was removed. Latest integration HEAD is 371f67768d0b9d3f8318fbcc44595ee711979f89. Fresh final CI evidence is recorded in the persistent checkpoint; do not infer PASS merely from this workflow edit.

## Q / R / S

Q = real ChatGPT client A/B/C/M. R = equivalent real second MCP client. Q/R BLOCKED: no actual connected HolyMedia tools exposed here and no second-client connection/name verified. REST harness and mock HTTP tests do NOT qualify as real client LIVE PASS.

S = human consent before commit: server/browser persistence, actor/session/audit, exact token, TTL and immutable payload are proven in live controlled W resume/restore. Client-specific Q/R consent presentation remains untested.

Next manual action: connect a private controlled HolyMedia TEST MCP endpoint in ChatGPT; identify/connect the second client (e.g. Claude Desktop or Cursor). Configure credentials locally, never paste keys/tokens/cookies into chat. Keep Public MCP read-only. Existing acceptance tunnel command if needed: `ssh -N -L 4401:127.0.0.1:4401 ubuntu@77.240.38.131`. Opening this tunnel does not itself connect either client.

Run each authorized Q/R operation only on TEST customer 8590146099 after fresh test-account proof and explicit human approval. Use new previews, not consumed A/B/C/W tokens. Begin with safe tool discovery/read/A preview/M rejection; actual B/C mutations need a separate authorized live workflow with approved restoration. No live cross-client writes made by this preparation.

## Release/integration boundary

Candidate 371f677 contains Stage 0+1 only; Stage 2 separate OFF-gated branch is not part of release. Production/main unchanged. Security candidate dependency audit: Critical 0 / High 0, 6 Moderate findings remain triaged separately, not claimed clean of all findings. Next 16.3.8 is a candidate fix, not a production update. Windows/Linux stock format and standard scanner passed; no global exclusions.

Remaining release requirements: cross-client Q/R and client-specific S, human integration review, exact immutable image digest and capacity/storage check, staging operator smoke and rollback rehearsal, separate authorization for merge/deploy. Never deploy candidate or enable Google/Public writes automatically. Before release retain DB backup/previous image; Google write remains OFF and allowlist empty. Runbook must distinguish API-only versus coordinated Web upgrade, because the Next fix is not a production Web remediation until separately reviewed/deployed.

## Stage 3–4 parallel boundaries

No implementation started. Stage 3 targeting inventory/schema/geo-language validators can be designed independently; bid modifiers depend on Stage 2 strategy eligibility, audience ingest on explicit privacy/consent scope. Stage 4 Search RSA and text-asset validators can reuse Stage 0; shared consumers and inverse semantics require the common write framework. Media ingest and PMax depend on approved binary/privacy/channel/conversion/strategy profiles. Do not infer a Search campaign atomic plan safely covers PMax. Refer to the proposed backlog, not a fabricated recovered original PPC specification.

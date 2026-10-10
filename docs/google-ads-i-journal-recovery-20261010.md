# I: audit reconciliation, 2026-10-10

The approved preview `080959b1-0413-4814-b656-9b03b187992e` was committed exactly once. Stock commit returned VERIFIED and provider reread verified AFFINITY 90100, criterion `51668099935`, OBSERVATION on paused ad group `206587491811`. The acceptance runner then reported `stage234_commit_journal_missing_or_immutable_changed`.

Root cause is the harness, not missing audit persistence: stock `stage1Audit` writes an attempted record and a terminal record per provider operation. Both records have `success=true` if audit recording/operation succeeded. Two operations therefore have four operation records, not two. DB contains two attempted and two success records, plus one VERIFIED commit result, with the exact immutable preview/commit identities. Historical records must not be edited.

`audience-journal.mjs` checks separate attempted/terminal pairs, exact operation indexes, target/workspace/account/commit/resource identities, terminal actual states, timestamps, immutable stored plan and one final VERIFIED commit. Duplicate, missing, failed, foreign or mismatched records fail closed. The commit guard and one-shot transport claims are unchanged.

`audience-reconcile.mjs` is a separate read-only path for this already attempted failure profile. It allows only the fixed TEST fixture snapshot queries, customer/MCC proof and OAuth refresh; blocks all MCP calls, validate-only and mutations. It writes a new reconciliation artifact, never replaces blocked evidence or resends commit. Local regression is not live reconciliation evidence; the latter requires its separate VPS result.

Next controlled step is removal of exactly the created audience criterion with a new preview and human approval. Current stock removal preserves explicit OBSERVATION, as disclosed before I approval. Exact restoration of the originally absent AUDIENCE restriction remains a bounded implementation gap; no raw cleanup, TARGETING substitution or arbitrary clear is permitted. I add alone is not complete I add/remove acceptance.

# Google Ads Stage 0 + 1 integration review candidate

Date: 2026-10-08. This review branch is not main, not a deployed acceptance image and not a production release authorization.

## Included targeted fixes

- Base live branch: `7ee9d30047872a25020fed8076494dd9d9504e7a`; preserve all historical evidence and the original UNVERIFIED Stage0 commit plus separate VERIFIED reconciliation.
- Release `5829e9918c20a27a08fb404bbec23df5973dc1d7`: Next 16.3.6 → 16.3.8, only associated Next dependencies; LF checkout policy with binary overrides; cross-platform fixture tests; exact existing consent-scope assertion correction. Integration pick `2b9e4853b9d030de91cf186af9c2dc115086fb07`.
- Campaign PAUSE `ca91ec5a41ca6c735c3f12a08c6bfbdaf4fcb76e`: typed campaign-only controlled preview/validate/approval/commit/reread/audit for stopping Search delivery; no hidden group/ad status changes. Integration pick `ec6b68961b853b454def95600332f1bc56df90e5`.
- Checklist `e9097d66a4358b40d1e2704d8e3b99c43694046b`: filter CampaignAsset inventory by selected `campaign_asset.campaign` resource. The real legacy query failed with HTTP400 / INVALID_ARGUMENT / QueryError.EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE. Exact direct resource filter succeeded. Integration pick `1e4d279bfed70614d2f927ef38615ff3e66b1a0d`.

No migrations, API version changes, production env/routing changes or default write/public-MCP flag changes. Google default gate OFF and empty allowlist remain; only the existing isolated TEST runtime is explicitly enabled for client859.

## Acceptance status and evidence discipline

- A/B/C/D/E/F/M/P: historical live PASS; not re-executed.
- O: BLOCKED. Browser kernel failure remains on the main execution surface; an agent kernel initialized, but no supported Google Ads browser or authenticated TEST session became available. Previous approved O preview is expired and unconsumed. No UI action or stale commit was attempted. A fresh JIT preview must wait for a working TEST UI surface, then separate human approval, UI action, fresh read, stock stale denial and separately approved PAUSE restoration.
- U: actual stock MCP input rejection PASS; exactly31-character headline identified, no preview/provider request or creation during this operation.
- V: actual READ-only MCP checklist PASS using the pinned corrected selector module. Missing conversion goal = WARNING for MANUAL_CPC; `ready=false`, `can_resume=true`. This is not full launch readiness or proof of conversion tracking health.
- T: real-reference plan prepared with 2 groups,10keywords,2RSA,4sitelinks,UTM,Almaty,Russian,USD2/day,MANUAL_CPC; 26 mutations, max500, atomic partialFailure=false. Campaign/groups/RSA PAUSED; keywords ENABLED under paused parents. Plan preparation or validate-only is not a successful live create acceptance. A new approved commit and full reread are still required.
- W: resume plan prepared and separately approved PAUSE restoration mock-covered in the candidate. No live activation. The old running image lacks new PAUSE dispatch; never enable a test campaign until the candidate restoration path is explicitly prepared and verified.

Existing fixture remains: 20 original keywords ENABLED, extra PHRASE11479221 PAUSED, campaign24324170853/group206587491811/RSA PAUSED. SharedSet12261567996 retains3EXACT negatives and0active attachments. No new provider objects or provider writes in this recovery cycle.

The immutable attempt evidence and parent checkpoint live under `artifacts/google-live-acceptance/` in the existing acceptance worktree; source code is under `scripts/google-live-acceptance/stage0-readiness/`. Initial failed attempts and the corrected per-mode counter reconciliation are retained separately, never replaced by a PASS file.

## Quality / security scope

Candidate stock format/lint/typecheck/Prisma/unit tests/build and dependency audit passed. Shared-cache results are identified, not presented as fresh Linux runs. 26 infrastructure-dependent tests remain skipped without a separate test PostgreSQL/Redis service; mock coverage does not replace them. The initial direct test startup failed until package dependencies were built; final targeted provider/preview/read suites143/143 passed. Guard/scanner-label regressions7/7 and stock scanner5/5 passed; diagnostic enum false positives were removed from new source labels, not hidden through a scanner bypass. Historical exact hash-pinned enum exception is unchanged.

Candidate dependency audit: Critical0, High0, Moderate6. Separate release branch browser mocks36/36 passed on desktop/mobile. This does not mean production has been patched: no deploy occurred, and current production exposure/version was not changed or claimed repaired.

## Remaining integration / release gates

1. O live UI proof and Stage1 final matrix; Stage0 T/W live commit/reread/restoration and no active test campaigns.
2. Full isolated PostgreSQL/Redis-dependent integration tests and a fresh Linux CI run on the reviewed candidate.
3. Exact original PPC Stage0–4 document traceability. Proposed detailed Stage2–4 tasks are not reconstructed original requirements; see [backlog](google-ads-stage2-4-proposed-backlog.md).
4. ChatGPT plus a named second MCP client manual compatibility evidence. Q/R/S definitions are absent; no letter mapping or live PASS is invented.
5. Review candidate commits, lockfile, Meta/read/public-MCP regressions, flags, schemas, ownership/stale/approval checks, audit and reversible keyword-only rollback limits. Stage0 tree creation is not automatically deletable rollback.
6. Explicitly authorized integration PR/review, approved main merge, pinned image build and separately authorized deployment. Do not perform any of these automatically.

Deployment recovery: restore the previous pinned application image/gates after explicit authorization; do not delete audit/history or assume image rollback undoes provider writes. Production Google/Public write flags remain OFF. Google resource restoration always uses a new scoped preview with human approval, immutable commit and real reread; no raw cleanup.

## Final provider closeout, 2026-10-09

W resume and separately human-approved PAUSE restoration both VERIFIED. Campaign24339483523 is PAUSED; both groups and RSA remained PAUSED throughout. Stock journal contains two separate commits. Both available non-REMOVED TEST campaigns are PAUSED. Stage1 A/B/C/D/E/F/M/O/P and Stage0 T/U/V/W are LIVE PASS for their specified scopes; this is not cross-client or release completion.

Final safe evidence: `artifacts/google-live-acceptance/stage01-final-live-acceptance-20261009.json`. Aggregate READ1794 / VALIDATE_ONLY27 / REAL_WRITE17, all writes only customer8590146099. OAuth refresh23 is counted separately. Historical UNVERIFIED commit and separate VERIFIED reconciliation are preserved.

One additional harness preflight falsely compared unordered GAQL rows. Targeted correction delegates to existing `rereadStage0Checks`; order-equivalent rows match, real status changes still differ. No product guard or approved plan changed; the initial blocked attempt never invoked MCP commit. No Google mutation was retried.

Linux foundation CI now also triggers for this exact integration branch, using hosted Ubuntu PostgreSQL18/Redis7.4 and explicit Google/Public write defaults OFF. It has read-only repository permissions, no provider credentials, no image publication or production deploy. Record actual run completion before release; adding the trigger is not CI PASS.

Cross-client definitions are now explicit: Q=A/B/C/M through real ChatGPT MCP client; R=equivalent real second-client cases; S=human consent before immutable commit. Q/R remain BLOCKED until these clients are connected; stock HTTP harness calls are not client LIVE evidence. Existing W human approvals demonstrate S only in this harness flow. Never repeat destructive or real mutation cases without new separate approval.

Stage2 foundation scope is authorized by the current user request, only in a separate branch from the verified integrated base, mock/disposable tests and gates OFF. It must not be merged into this Stage0+1 release candidate. Future live Stage2 operations still require explicit test-account scope and human approval. Stage3/4 remain backlog only.

## Closeout update, 2026-10-09

Stage1 A/B/C/D/E/F/M/O/P COMPLETE. O stock commit rejected google_preview_stale before mutation after the real externally changed PHRASE was reread. Historical evidence remains immutable.

T LIVE PASS: one atomic mutation,26/26 independently VERIFIED. Preview2c770f7a-e205-4e23-a572-193ade55c4db; commit hmc_jf43iiz8tg-P_rRNhkYjbNan02u9Azemp6xEjdtpj48. Campaign24339483523, budget15932267169, groups200180930839/200180931039, RSA827487091340/827362851813. USD2/day, MANUAL_CPC, Almaty/Russian,10keywords,4sitelinks,UTM. Campaign/groups/RSA PAUSED. Separate IDs supplement corrects only harness RSA display, not historical evidence.

U/V prior actual input-rejection/read-only evidence is sufficient. MANUAL_CPC missing goal WARNING and ready=false do not imply conversion health or full launch readiness.

W fresh stock checklist has no FAIL, can_resume=true. Goal/data/moderation/paused-child warnings explicit. Only campaign changes; no hidden group/ad activation. Candidate pause dispatch hash-pinned in isolated one-off runtime. Resume and PAUSE restoration each require new human approval. W LIVE PASS not claimed yet.

Fresh Windows format/lint/typecheck/Prisma/tests/build/secrets/deps PASS without Turbo cache. Package570PASS/26SKIP; all26 then ran separately on independent PG18/Redis7.4:26PASS/0SKIP. Migrations/status CLEAN. QA provider calls0; no production/acceptance DB/Redis/vault. QA containers/volumes removed. Initial failures preserved.

PG18 mock test now explicitly sets/resets own origin/flags, not application guards/defaults. Repeat QA run used separate QA Redis DB after preserved rate counters; no limiter bypass or shared Redis flush.

Next16.3.8 integrated, Critical0/High0/Moderate6. New scanner matches reviewed independently:17public literals in9SHA-pinned artifacts. Exact path/content/match digests, scanner active, regression0SKIP. LF policy plus exact immutable-byte exceptions preserved.

Source ancestry includes W0/Stage1/Stage0/budget/batch/live fixes. Prisma diff against origin/main empty; no new migrations. Google/Public default writes OFF, empty allowlists. No main merge/production deploy.

Remaining: W resume+PAUSE live proof; fresh Linux CI/image check; ChatGPT+named second-client manual acceptance; original Stage2-4 detailed PPC traceability. No invented Q/R/S PASS.

Release sequence: integration review -> explicitly authorized PR/main merge -> immutable image/disposable migration rehearsal -> separately authorized production deploy with baseline/backups and write gates OFF. Image rollback does not undo provider writes. Preserve journal; recovery requires new human approval; Stage0 creation has no automatic destructive rollback.

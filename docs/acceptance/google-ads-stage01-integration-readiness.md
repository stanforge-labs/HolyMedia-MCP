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

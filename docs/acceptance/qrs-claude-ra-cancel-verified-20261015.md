# Claude R/A — LIVE preview/cancel acceptance

Status: **Claude R/A LIVE PASS** for the one-keyword preview-without-change scenario. This is not R/B, R/C, R/M or full Q/R/S PASS. No new Google Ads commit was authorized or sent in this scenario.

## Redacted TEST evidence (UTC, 2026-10-14)

- Real Claude Manual Write grant: stored preview `71d76313-faea-4de6-b6c5-eb6324864185` has `principal_type=OAUTH_USER`, client alias `fcffec5584f9`, grant-family alias `99d2d3ccb17b` and workspace alias `848efb4c952c`. These match the [separately verified Manual OAuth grant](qrs-claude-manual-write-verification-20261015.md). The exact account is TEST `8590146099`; the stored resource is keyword `11743561` in ad group `206587491811`.
- Server-side `mcp_tool_executed`: `get_campaign` `req-99` at 20:31:35; `google_ads_list_keywords` `req-98` at 20:31:37; `pause_entities_preview` `req-9a` at 20:31:50; `google_ads_list_keywords` `req-9c` at 20:31:56. Each succeeded for the same active OWNER/workspace alias. Subsequent keyword and journal reads are also audited. The successful-tool audit schema does not directly store the OAuth client/grant; the preview row itself does.
- Persisted preview created 20:31:50, one operation, BEFORE `ENABLED`, requested AFTER `PAUSED`, `provider_validation=passed` (Google validate_only). The `mcp_preview_created` audit confirms the TEST account and validation result. The preview did not grant commit authority.
- User clicked **Cancel** in the HolyMedia browser. `cancelled_at=20:33:06`, `commit_status=CANCELLED`, and `mcp_preview_web_cancelled` at 20:33:06 has `actor_type=HUMAN`, the same OWNER/workspace aliases, `decision=cancel` and the TEST account. `confirmed_at`, approving user/session, `consumed_at`, `commit_attempted_at`, and `provider_result` are all absent. Commit-attempt/result/keyword-status audit rows for this preview: **0**. Matching production preview/audit rows: **0**.
- Fresh provider-backed TEST reread after cancellation: candidate keyword `11743561` remains ENABLED; source campaign has 20 original ENABLED keywords and one extra PHRASE PAUSED, source group PAUSED; all three Search campaigns PAUSED at USD 2/day. TEST change journal from 20:30 UTC has **0** entries. Active unconsumed previews, approved unconsumed previews and in-flight commits: **0/0/0**. This independently supports zero provider mutation by the R/A flow; journal absence alone was not used as proof.

## Next boundary

R/B is ready for a **new, just-in-time Claude preview only after a fresh provider/readiness check**. Do not reuse the cancelled A preview. Pause commit requires a separate HolyMedia OWNER browser approval, one exact immutable commit, provider reread and audit; restoration to ENABLED requires its own new preview and separate approval. Do not create R/B preview in Codex on Claude's behalf. R/C's invalid-ID source-of-error contract and R/M denial remain separate. Full R and dual-client S are OPEN.

Independent local checks on unchanged application code: PMax/Clone targeted regressions 3 files, 161/161 PASS; standard secret scan PASS; dependency audit at High severity reports no known vulnerabilities. Genuine PMax media/conversion/brand inputs and Clone LIVE proof are still required. Production health/ready 200, TEST and production API containers healthy with zero restarts; no deployment or main/production change.

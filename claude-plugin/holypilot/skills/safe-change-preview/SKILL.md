---
name: safe-change-preview
description: Explain a user-requested advertising change and, only if currently exposed by HolyPilot, create a non-mutating preview; require separate browser OWNER approval and commit. Безопасный предварительный просмотр изменения.
---

# Safe change preview / Безопасный preview

Use only after the user explicitly asks to prepare a specific change. First check that the current connected MCP tool list actually contains the relevant preview tool and that the user selected the intended workspace, provider, account, and object. The public endpoint may advertise only READ tools. If the preview tool is absent, stop and explain that this environment does not offer the action. Google Ads production WRITE is default-OFF; do not substitute a TEST or legacy private profile.

Where available, `preview_change_campaign_name`, `preview_pause_campaign`, and `preview_resume_campaign` concern bounded Meta campaign changes. A preview performs a provider READ and stores a proposal; it does not mutate the advertising provider. Summarize the BEFORE value, requested AFTER value, expiry, account, and approval link returned by HolyPilot. Do not invent a preview token or approval link.

The OWNER must inspect and approve the exact preview in the HolyPilot browser UI. Claude's own permission prompt is separate from this server-side approval. A commit requires a _new, explicit user request_ after approval and the exact `preview_token`, using only `commit_confirmed_preview` if it is actually listed. Do not put mutation fields into a commit call. Do not treat an approval URL as proof approval occurred. Never retry a timed-out or uncertain commit blindly; request status and audit instead.

Русский порядок: отдельный запрос пользователя → проверка доступного инструмента и прав → preview без записи → просмотр и подтверждение OWNER в браузере → новый явный запрос на commit → проверка результата. Если любой шаг не подтверждён, остановись.

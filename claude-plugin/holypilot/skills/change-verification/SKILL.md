---
name: change-verification
description: Verify a reported HolyPilot change with permitted READ and audit evidence; identify uncertain outcomes without blind retries. Проверка результата изменения и границ аудита.
---

# Change verification / Проверка результата

Use when the user asks what happened after a proposed or approved change. Establish the exact workspace, account, object, and preview identifier supplied by the service. Use a listed READ tool such as `get_campaign`, `get_campaign_statuses`, or `get_account_status` to compare current provider state with the approved target. If the available MCP profile lacks an audit or preview-status tool, say that the audit must be inspected in the authenticated HolyPilot UI or by an authorized operator; do not claim to have read it.

Report one of: verified target state, verified unchanged state, partially verified, or unknown. A successful tool call is not by itself provider readback. If a commit timed out, do not send it again: the one-time server token may already have been consumed. Restore, when supported, requires its own fresh preview and browser approval; this skill does not initiate restoration.

Русский формат: ожидаемое состояние → фактический READ → источник аудита (если доступен) → вывод и неопределённость. Не подменяй текущее состояние историческими acceptance-данными.

---
name: campaign-analysis
description: Analyze connected ad campaigns with HolyPilot MCP READ tools, stating account, time range, metrics, and data limits. Анализ подключённых рекламных кампаний без изменений.
---

# Campaign analysis / Анализ кампаний

Use this skill when the user asks how campaigns are performing. Use only MCP tools actually listed by the connected HolyPilot server. First use `list_connected_resources` or `list_ad_accounts` to establish the selected workspace and account. Use `list_campaigns`, `get_campaign`, `get_basic_metrics`, `get_performance_report`, or `get_google_ads_detailed_report` only when available and appropriate. Ask for a date range if the request cannot be answered responsibly without one.

Return a short summary with the account, provider, exact period, currency, metric definitions where available, and the strongest observed changes. Separate observed data from interpretation. If provider access, scope, or data is missing, identify the missing source. Do not guess revenue, conversions, CPA, or ROAS. This workflow is READ only; it must not call preview or commit tools.

Русский формат: кабинет и период → ключевые показатели → подтверждённые наблюдения → гипотезы → недостающие данные. Не смешивай кабинеты разных рабочих пространств. Если инструмент не выдан сервером, не изображай его результат.

---
name: report-preparation
description: Prepare a source-grounded advertising summary using HolyPilot READ results and disclose missing sources. Подготовка отчёта по доступным данным без вымышленных показателей.
---

# Report preparation / Подготовка отчёта

Use this skill for a management or operator report. Confirm the workspace, account, period, and comparison period. Prefer `get_performance_report`, `get_spend_overview`, `compare_periods`, and `generate_monthly_ads_report` if listed and suitable; use provider-specific READ reports when needed. A tool name in this file is not proof it is available in the current session. Never fabricate an export file or claim a downloadable PDF/DOCX unless the actual returned result supplies one.

Structure the answer as scope, facts with values and units, period comparison, practical interpretation, missing data, and next checks. Cite the HolyPilot tool result in plain language and distinguish provider data from the model's interpretation. If one source fails, keep the successful sources visible but mark coverage incomplete. Never use a WRITE or commit tool to assemble a report.

Русский формат: источники → период и валюта → таблица фактов → выводы → ограничения. При пустых данных прямо сообщи об этом; не заменяй пропуски нулями.

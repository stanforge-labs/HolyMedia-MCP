# HolyPilot — завершение доступной offline части исходного Google Ads ТЗ

**Срез:** 18.10.2026. База ветки `codex/qrs-test-auth-recovery` до этого пакета — `0187008405904522e4a077ed2af42c5723b22653`. Финальный exact SHA и CI заполняются после push, чтобы не выдавать запланированный run за выполненный. Ни VPS, ни Google accounts, ни main не изменялись.

## Что завершено программно

Проверены исходные 336 абзацев, нормализованные 39 групп и их дочерние операции в [финальной матрице](FINAL_REMAINING_TZ_MATRIX.md). Предыдущий [Batch 1](BATCH1_OFFLINE_EXECUTION_PACKAGE_20261017.md) уже реализовал default-OFF exact TEST PMax add/remove/replace/restore gates, PAUSED fixture graph, защищённый ConversionAction create preview, auth/approval/audit и first-party media. Мы не переписывали эти builders: их текущие PMax/ConversionAction интеграционные mocks и регрессии проходят. Stage 0–4, REST/OpenAPI, OAuth, tenant isolation и typed MCP охвачены соответствующими source/tests, перечисленными в исходном аудите.

Единственный обнаруженный в текущем локальном проходе исправляемый дефект — `scripts/v2-secret-scan.mjs` пытался читать незатреканные **каталоги** как файлы и завершался `EISDIR`. Теперь сканирует только regular files; секреты, запретные пути и reviewed immutable evidence policy не ослаблены. Повторный `pnpm security:secrets` PASS. Это улучшение CI tooling, не новый Google Ads LIVE результат.

**Граница completeness:** 39/39 групп имеют хотя бы typed/code/test boundary. 38/39 имеют реализованный локально тестируемый профиль без известного недостающего программного звена; **0.04** остаётся с настоящим code/data gap: Google WEBPAGE `sign_up` tag/delivery и реальное событие не реализованы. Нельзя безопасно сгенерировать его в offline CI без согласованного measurement design, action ID, consent и настоящей регистрации. Текущее server audit — правдивое подтверждение успешной регистрации, но не Google conversion. Эти 38 не означают exhaustive compatibility всех вариантов или LIVE PASS.

## Проверки текущего рабочего дерева

| Проверка | Текущий локальный результат | Ограничение |
|---|---|---|
| `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` | PASS | Turbo часть задач взял из идентичного локального cache. |
| `pnpm migrate:validate` / Prisma generate | PASS | Отдельный PostgreSQL 18 migration/restore job оценивается по Linux CI. |
| `pnpm test` | PASS; API 1496 passed, 22 skipped; 100 test files passed, 8 skipped | Windows skipped integration требуются из Linux PostgreSQL/Redis CI; mock не равен LIVE. |
| `pnpm security:secrets`, `pnpm security:deps` | PASS; dependency audit high: no known vulnerabilities | Scanner исправлен для untracked directories. |
| Linux foundation / Stage 2–4 / API image | **PENDING exact-source current commit CI** | Предыдущий baseline `0187008`: runs [39066240800](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39066240800), [39066240758](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39066240758), [39066240768](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39066240768) PASS. Новую проверку нельзя приписывать старому SHA. |

## Официальные контракты Google без credentials

[TEST accounts](https://developers.google.com/google-ads/api/docs/best-practices/test-accounts) не отдают serving metrics и не позволяют conversion uploads. [Conversion setup](https://developers.google.com/google-ads/api/docs/conversions/getting-started) и [categories](https://developers.google.com/google-ads/api/docs/conversions/categories) требуют tag для WEBPAGE measurement. [PMax assets](https://developers.google.com/google-ads/api/performance-max/asset-requirements) требуют minimum text/image set; [atomic request graph](https://developers.google.com/google-ads/api/performance-max/structure-requests) обязателен для non-retail asset group. [Signals](https://developers.google.com/google-ads/api/performance-max/asset-group-signals) и [criteria](https://developers.google.com/google-ads/api/performance-max/create-campaign-criteria) поддерживают audience/search themes/negative keywords/brand exclusions с eligibility ограничениями. [OAuth](https://developers.google.com/google-ads/api/docs/oauth/internals) требует `adwords` scope; developer token обязателен. v24 пока указан с плановым [sunset май 2027](https://developers.google.com/google-ads/api/docs/sunset-dates), его статус проверить вновь перед provider stage.

## Что остаётся вне offline этапа

Исторические **7/39** ограниченных LIVE PASS, **32/39** не приняты в полном объёме; 20/20 именованных Google Ads сценариев и ограниченный Search Clone ранее PASS. Ни один статус не повышен текущими mock/CI. Конкретные препятствия распределены по [A–F реестру](../operations/VPS_AND_EXTERNAL_BLOCKERS.md): TEST startup PSI, отсутствующие action/goal/PMax parent/eligible assets/audiences/BRANDS, реальные conversion data, отдельные approvals и клиентские prompts R/S. Отсутствие Google API credentials в CI — осознанная граница безопасности.

**Можно ли 100% без увеличения VPS? CONDITIONAL.** Бесплатная локальная TEST среда с существующим HTTPS ingress возможна архитектурно, но не развернута и не прошла cross-host guard. Даже идеальная инфраструктура не создаст serving conversions в Google TEST. Понадобятся настоящий разрешённый account/data или согласованная приёмочная граница §§83–85/2.06. Повышение тарифа не доказано необходимым и решает только ресурсы, не внешние данные.

**Следующий пакет:** сначала согласовать безопасный first-party `sign_up` measurement/consent и ресурс реальной conversion goal; затем отдельным решением подготовить изолированный TEST на ПК, без переключения ingress до локального PASS. Любые Google commits требуют JIT preview + OWNER browser approval + явного отдельного разрешения. Production flags OFF.

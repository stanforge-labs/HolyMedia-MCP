# HolyPilot — инфраструктурные и внешние препятствия исходного ТЗ

Срез 18.10.2026. Категории привязаны к ID в [полной матрице](../acceptance/FINAL_REMAINING_TZ_MATRIX.md). Это реестр доказанных условий и неопределённостей; mock/CI не повышают LIVE-статус.

## A. TEST инфраструктура

**ID:** G06, G09, 0.01–0.03, 0.04–0.07, 1.01–1.02, 2.01–2.05, 3.01–3.05, 4.01–4.06 (для новых LIVE-профилей). На VPS по [защищённому as-run](BATCH2_NO_PULL_RESULT_20261018.md) остановка TEST API/Web освободила 208,9 MiB; 600-секундный maintenance guard прошёл с MemAvailable min 1 088 488 KiB, swap-out 0, PSI full peak 0,18, 12 382 MiB свободного диска. При новом TEST API startup немедленный PSI guard сработал; кандидат прожил 7,498 s, TEST Web не стартовал, был один rollback. Источник PSI **UNKNOWN**: ни API cgroup, ни Docker, ни другой процесс из сохранённого предаварийного trace не доказаны как инициатор. Все девять прежних контейнеров были healthy после отката. Повторять VPS deployment без новых условий нельзя.

**Бесплатный путь:** existing CI и локальный mock покрывают код, но не provider LIVE. [Проверенный проект изолированного TEST на ПК](BATCH2_PSI_CAUSE_AND_ZERO_COST_PATH_20261018.md) использует WSL2 и существующий HTTPS ingress через два loopback reverse SSH forwards; он пока не готов: WSL/Docker не установлены, RAM headroom ПК под полный стек не проверен. Для него нужны отдельная owner authorization на подготовку, TEST-only secrets с защищённым вводом, владелец ПК онлайн, затем cross-host guard и разрешение на TEST ingress switch. Это технический кандидат, не подтверждённый PASS. Дополнительная RAM на VPS может решить только capacity, но её обязательность и достаточный объём не доказаны.

## B. Google Ads, объекты и настоящие данные

| Условие | ID | Нужное доказательство |
|---|---|---|
| Получающая данные conversion goal и success-only `sign_up` | 0.04, 0.09, G06, 4.06 | Подтверждённый conversion customer; action/goal в реальном аккаунте; согласованный tag/consent, настоящее событие и provider READ. TEST аккаунт не выдаёт serving conversions. |
| PAUSED PMax parent, asset group и owned media | G06, 0.06, 4.02, 4.06 | Проверенные action/goal, geo/language, brand/copy, Google asset IDs; validate_only, отдельный approved commit и reread. |
| Eligible audiences, custom segments и BRANDS shared set | 3.01, 3.02, 4.06 | Реальные owned IDs, scope/status/policy и provider validation. Не подставлять фиктивные ресурсы. |
| Shared portfolios, criteria, search terms и performance metrics | 1.02, 2.02–2.06, 3.01–3.05 | Существующие пригодные объекты и данные; у TEST не может быть serving CPA/ROAS metrics. |
| Developer-token production access, OAuth scope и campaign eligibility | G02, G08, OPS и все новые LIVE профили | Fresh authorized READ и права; ни секреты, ни реальные токены не попадают в GitHub CI. |

Google [TEST limitations](https://developers.google.com/google-ads/api/docs/best-practices/test-accounts) отдельно блокируют буквальный receiving-data goal и performance filters. Увеличение VPS RAM эту проблему не устраняет.

## C. Разрешения и ручной контроль

**ID:** G01, G02, G04, G06, G08–G09, 0.01–0.09, 1.01–1.02, 2.01–2.06, 3.01–3.05, 4.01–4.06, OPS при соответствующей mutation/release. Каждый новый профиль: fresh READ → Google validate_only → JIT immutable BEFORE/AFTER preview → отдельный OWNER browser approval → явное разрешение владельца на один commit → provider reread/audit. Обратимая операция восстанавливается отдельным preview и approval; ambiguous response только reconcile READ, без повтора. Production release — отдельное решение; write flags остаются OFF.

## D. Внешние клиенты

**ID:** G07, G10. ChatGPT Q LIVE PASS. Claude R/M клиент отказался отправлять запрещённый commit до server, поэтому специфический server denial не доказан. Для S нет сохранённых permission prompts обоих клиентов; два OAuth grants и HolyMedia browser approvals уже доказаны. Нужны ранее существующие redacted client traces либо отдельный безопасный UX-сеанс без рекламных mutations. Не создавать новые Google writes ради скриншотов.

## E. Известный программный остаток

**ID 0.04:** фактическая отправка Google `sign_up` отсутствует. [Auth signup](../../apps/api/src/auth/auth.service.ts) фиксирует внутренний успех после транзакции, verification preparation, email и session, что проверяет [граница теста](../../apps/api/src/auth/signup-conversion-boundary.test.ts). Но для WEBPAGE Google требует сайт-tag; его ID, consent policy, место установки, реальные регистрационные события и Google action не утверждены. Нельзя безопасно выдавать текущий audit за measurement или отправлять событие из TEST, где signup закрыт. Реализация delivery остаётся после решения владельца о measurement/consent и создания action. Других подтверждённых недописанных typed Google Ads builders после Batch 1 и текущих regression tests не найдено; это не утверждение о полном покрытии всех будущих campaign variants.

**Отдельный offline дефект security tooling исправлен:** scanner игнорирует каталоги в списке untracked Git paths, сохраняя проверку содержимого обычных файлов. Он не относится к Google API, но нужен для достоверного CI на реальном рабочем дереве.

## F. Границы самого Google API

**ID:** прежде всего 4.06 и OPS. [PMax campaign criteria](https://developers.google.com/google-ads/api/performance-max/create-campaign-criteria) поддерживают negative keywords и brand exclusions как negative criteria; отсутствие TEST BRANDS list не является unsupported-by-API. [Asset requirements](https://developers.google.com/google-ads/api/performance-max/asset-requirements) и [request structure](https://developers.google.com/google-ads/api/performance-max/structure-requests) требуют minimum assets и атомарного построения non-retail группы. [Asset signals](https://developers.google.com/google-ads/api/performance-max/asset-group-signals) зависят от подходящего audience. [Google API v24 timetable](https://developers.google.com/google-ads/api/docs/sunset-dates): плановый sunset в мае 2027; release должен отдельно обновить контракт, если дата или API изменятся. Ни один профиль не помечен unsupported только из-за отсутствия account-owned ресурса.

## Отдельный продуктовый пункт

Branding-only HolyPilot сохранён в `codex/holypilot-brand-only`, но не опубликован на production. Он **не входит** в 39 групп исходного Google Ads ТЗ; не менять сайт в рамках этого offline пакета.

# Google Ads — ход работ

## Этап 1 — разведка

- Дата: 2026-10-01.
- Ветка/worktree: `codex/google-ads-ppc` / `C:\Users\Станислав\Documents\MCP\mcp-for-ads-google-ads-ppc`.
- База: актуальный после `git fetch origin` `origin/main` = `d88ac55d767f713f53932ea62673b09505b51f17` (совпадает с указанным production SHA).
- Статус: **PASS — все 8 пунктов разведки выполнены; дальнейшая работа остановлена для человеческой проверки.** `GOOGLE_ADS_PLAN.md` механически извлечён из исходного DOCX; 306 абзацев и 3 таблицы проверены на наличие в Markdown. Других стадий и production-кода не касались.
- Проверено: MCP tool registry/provider routing/capabilities, Meta preview–confirm–commit/policies/TTL/audit, V2 Google REST/OAuth/MCC/developer-token/config, все найденные V2 и legacy GAQL, 5 запрошенных execution paths и известные ошибки, official Google Ads v24 field reference, read-only diff Public MCP ветки. Подробности и точные файлы: `docs/google-ads-notes.md`.
- Baseline: `pnpm install --frozen-lockfile` PASS; `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS. Повтор без Turbo cache: `pnpm exec turbo run typecheck --force` PASS 15/15, `lint --force` PASS 10/10, `test --force` PASS 15/15 (API: 287 passed, 20 skipped). Legacy Python `PYTHONPATH=.;src` + `python -m pytest -q tests/unit`: PASS 238 passed, 1 skipped. Первая попытка standalone `pytest` без корня в `PYTHONPATH` имела collection error; исправление команды убрало его, код не менялся. Integration/live provider tests не выполнялись.
- Расхождения: V2 Google — прямой REST (не client library); developer token всё ещё локально обязателен и посылается, хотя Google sunset его 09.09.2026; default API `v24`, production override неизвестен; Meta preview TTL 10 минут, confirm связан с service token, а универсального Google per-operation write/rollback нет; V2 Google read игнорирует часть фильтров/уровень, а campaign cost-per-conversion/currency нормализуются неверно. Контрольные live-цифры PPC и Console approval не перепроверялись.
- STOP CONDITIONS: этап 6 требует изменения общей `McpPreview` DB schema и preview/commit/audit кода, затрагивающего Meta; Public MCP branch `3405c5c2c27926057933a7e05908d4d59f632c0a` уже меняет те же области. **PUBLIC MCP INTERSECTION: HIGH.** Для этапа 6 нужен отдельный архитектурный выбор человека. Библиотека V2 не требует обновления для удаления developer-token header (её там нет); legacy Python dependency может потребовать отдельного решения, но сейчас не обновлялась.
- Следующий предполагаемый этап после явного разрешения пользователя: этап 2, только read fixes и без реальных provider writes; до него сверить `docs/google-ads-notes.md` и разрешить stop conditions для будущего этапа 6. Сейчас этап 2 **не начат**.
- Commit: отдельный документальный коммит этапа 1; его SHA приводится в финальном отчёте (самореферентный SHA в коммите не хранится).

## Этап 2 — исправление существующего Google Ads чтения

- Дата: 2026-10-01. Ветка `codex/google-ads-ppc`, parent `1534bfe5a316e1855a6fbbe2c1fb9453b56e9a21`. Статус: **PASS для кода и доступных тестов; live READ smoke NOT RUN** из-за отсутствия локальных `GOOGLE_ADS_SMOKE_MCP_URL` и `GOOGLE_ADS_SMOKE_BEARER_TOKEN`. Этапы 3–9 не начаты.
- Деньги/валюта: Google `metrics.cost_micros`, `metrics.average_cpc`, `metrics.cost_per_conversion` и `campaign_budget.amount_micros` преобразуются из micros в currency units ровно один раз до общего `metricsFromRaw()`. Account-level CPC/CPA агрегируются из нормализованного spend и clicks/conversions; `metrics.conversions_value` не делится на 1 000 000 (оно уже в денежных единицах). Валюта списка кампаний и метрик берётся из account context, сохранённого при discovery из `customer.currency_code`; если её там нет, выполняется один customer read на вызов, а не запрос на каждую кампанию. Не используется несуществующее `campaign_budget.currency_code`. Mock для PPC 5 184,18943 / 570,971158 даёт 9,079599 USD.
- `get_flexible_insights`: только для `GOOGLE_ADS` `level=campaign` возвращает paginated `items` — по одной строке на кампанию с ID/именем/status/metrics/currency/budget. Account level остаётся прежним агрегатом. Explicit `since`+`until` имеют приоритет только когда нет preset; как в Meta, одновременная передача explicit dates и `date_preset` отклоняется, а не молча переопределяется. Google принимает `last_7d/14d/30d`; Meta route не менялся.
- `list_campaigns`: Google `status`/`statuses` нормализуются к `ENABLED|PAUSED|REMOVED`; фильтр применяется в GAQL, по умолчанию `campaign.status != 'REMOVED'`. Cursor считается по уже отфильтрованным Google строкам; неправильный cursor отклоняется. Meta не получает новый status argument.
- Бюджет: Google campaign read выбирает `campaign_budget.amount_micros`, `resource_name`, `explicitly_shared`, `period`; наружу — `budget.amount` в валюте и `budgetDetails.{resourceName, explicitlyShared, period}`. [v24 field reference](https://developers.google.com/google-ads/api/fields/v24/campaign_budget) говорит, что `period` по умолчанию `DAILY`, если не задан; также возможен `CUSTOM_PERIOD`. Исторические `budget.amount=5` и spend ≈ 1 015,60 USD за 30 дней **не доказывают ошибку**: бюджет — настройка периода/текущий снимок, spend — накопленная метрика за даты. Фактические `period`, `explicitly_shared` и динамика бюджета кампании `15961195382` **не подтверждены live READ**; скрипт D покажет оба числа без требования равенства.
- Ошибки: только Google Ads REST API структурированные `errorCode`, `message`, `location.fieldPathElements`, `requestId`/`request-id` преобразуются в безопасные `error_code`, `message`, `field_path`, `request_id`, `errors[]`; значения токенов/заголовков редактируются. Network/non-Google failure сохраняет прежний generic contract. Все неподдерживаемые Google write-preview tools (включая `update_entity_status_preview` и `pause_entities_preview` для keyword) отклоняются `not_supported_for_google_ads` **до** общей preview store; ни Meta preview, ни confirm/commit не менялись.
- Developer token: V2 direct REST больше не требует config-поля для `available` и не отправляет HTTP header. Старый `PROVIDER_GOOGLE_DEVELOPER_TOKEN` остаётся optional/deprecated для совместимости, production env не удалялся; legacy Python V1 не менялся. `authorization` и `login-customer-id` сохранены и проверены mock-запросом.
- CODE DEFAULT API VERSION: `v24`. PRODUCTION EFFECTIVE API VERSION: **UNCONFIRMED** (env override сохранён). Новая dependency, смена API version и DB migration не потребовались.
- Изменённые зоны: `.env.v2.example`; `packages/config/src/index.ts`; `packages/contracts/src/index.ts`; `apps/api/src/providers/adapters/google.ads.ts`, `provider.types.ts`, `provider.service.ts`, `provider-http.ts`, новый `google-ads.error.ts`; Google fixtures/tests; `apps/api/src/mcp/mcp.service.ts`, `mcp.controller.ts` и tests; `scripts/google_ads_smoke.mjs` и его tests; этот progress. `McpPreview`, Meta adapter/write/policy, Public MCP branch и DB schema не изменены.
- Проверки: focused Google/MCP/error tests **PASS**; `pnpm typecheck` **PASS 15/15**; `pnpm lint` **PASS 10/10**; `pnpm test` **PASS 15/15** (API **303 passed, 20 skipped**; Meta tests included); `node --test scripts/google_ads_smoke.test.mjs` **PASS 3/3**; legacy Python `PYTHONPATH=.;src` + `python -m pytest -q tests/unit` **PASS 238 passed, 1 skipped**; `python -m compileall -q src/ad_mcp` **PASS**. Integration tests, которым нужны БД/Redis, оставались skipped.
- Live smoke: `node scripts/google_ads_smoke.mjs` вывел `SMOKE NOT RUN: NO LIVE GOOGLE ADS ACCESS`; **A/B/C/D: NOT RUN**, нет фактических live результатов. Для ручной проверки: локально задать URL MCP и service token в environment, убедиться, что `GOOGLE_ADS_WRITE_MODE` не `live`, выполнить `node scripts/google_ads_smoke.mjs`; скрипт только вызывает четыре MCP READ проверки, печатает EXPECTED/ACTUAL/PASS/FAIL и финальный счёт. Credentials не передавать в чат.
- STOP CONDITIONS этого этапа: **не сработали** — зависимость, версия, схема БД и общий Meta/Public preview/commit не менялись. Ранее найденный **HIGH** конфликт Public MCP остаётся точкой остановки **перед этапом 6**, не решён на этапе 2.
- Неопределённости до этапа 3: фактические live A–D, production API env/version, Google Console access/approval, фактические budget period/shared для `15961195382`, ответы Google с реальных аккаунтов. **Этап 3 не начинать без нового разрешения пользователя.**

## Этап 3 — чтение ключевых слов

- Дата: 2026-10-01. Ветка `codex/google-ads-ppc`, parent `2ca493471cfaba70f6574db029d7b26301565e52`. Реализован только Google Ads READ; этапы 4–9 не начаты.
- MCP tool: `google_ads_list_keywords`. Обязателен `account_id` (10 цифр, допускаются дефисы); опциональны `campaign_ids`/`ad_group_ids` (массивы 1–200 строковых числовых ID), `statuses` (`ENABLED|PAUSED|REMOVED`), `since` и `until` вместе (`YYYY-MM-DD`), `min_cost` (неотрицательное число в currency units), `limit` (1–500, default 100), `cursor` (opaque). Неуказанные даты используют прежний `defaultReportRange()` проекта: вчера и день за 30 суток до сегодня по UTC. Даты относятся **только к метрикам**, не к inventory. По умолчанию исключаются REMOVED keyword/campaign/ad group; явный `statuses:["REMOVED"]` разрешает только удалённые keyword, но не удалённые campaign/ad group. `UNKNOWN`/`UNSPECIFIED` v24 — response-only, не допускаются как input.
- Query A, `GoogleAdsService.Search` (пагинация Google по 10 000 строк):

```gaql
SELECT campaign.id, campaign.name, campaign.status,
  ad_group.id, ad_group.name, ad_group.status,
  ad_group_criterion.resource_name, ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
  ad_group_criterion.status, ad_group_criterion.negative,
  ad_group_criterion.approval_status, ad_group_criterion.system_serving_status,
  ad_group_criterion.quality_info.quality_score,
  ad_group_criterion.cpc_bid_micros,
  ad_group_criterion.effective_cpc_bid_micros,
  ad_group_criterion.final_urls
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.negative = FALSE
  AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED'
  AND ad_group_criterion.status != 'REMOVED'
ORDER BY ad_group.id, ad_group_criterion.criterion_id
```

Последнее условие статуса заменяется на `IN (...)` при явных `statuses`; `campaign.id IN (...)` и `ad_group.id IN (...)` добавляются при фильтрах. Query A не содержит dates/metrics, поэтому нулевые ключи остаются.

- Query B, `GoogleAdsService.SearchStream`, один batch до 200 criterion resource names:

```gaql
SELECT ad_group_criterion.resource_name, metrics.impressions,
  metrics.clicks, metrics.cost_micros, metrics.conversions,
  metrics.all_conversions
FROM keyword_view
WHERE segments.date BETWEEN '{since}' AND '{until}'
  AND ad_group_criterion.resource_name IN ('customers/.../adGroupCriteria/...', ...)
```

Склейка по `ad_group_criterion.resource_name`; отсутствующие метрики → 0. `min_cost` применяется после merge и до формирования страницы.

- Пагинация: Google Search возвращает фиксированные страницы до 10 000; внутри страницы метрики подгружаются пачками до 200. Курсор — base64url JSON с версией, provider `pageToken`, индексом строки и fingerprint account/filters/date/min_cost. Следующий курсор ставится **перед** первым следующим подходящим keyword, поэтому `min_cost` не перескакивает кандидатов; сортировка по `ad_group.id, criterion_id` стабильна при неизменном inventory. Между вызовами Google-данные могут измениться — snapshot isolation API не обещается. Scan ограничен 20 provider pages (до 200 000 строк при стандартной странице Google); сверх лимита tool явно просит сузить фильтры. Один вызов держит в памяти максимум одну inventory страницу плюс batches.
- Дубликаты: дополнительный account-level paginated Search по non-negative/non-REMOVED criteria в `ENABLED` campaigns и non-REMOVED groups. Читаются `campaign.id/name` и `keyword.text`, map хранит только нормализованные тексты текущей выходной страницы. Нормализация удаляет `[ ] " +`, приводит к нижнему регистру и сворачивает пробелы; порядок слов не меняется, stemming/fuzzy/close variants нет. Текущая campaign исключается, повторения в той же campaign схлопываются. Нет N+1; цена — проход по account-wide keyword inventory **на каждую выдаваемую страницу**, при очень больших аккаунтах это дополнительная нагрузка.
- Выход каждого keyword: `resource_name`, `criterion_id`, campaign/ad group ID/name/status, `text`, `match_type`, `status`, `serving_status`, `approval_status`, nullable `quality_score`, nullable `cpc`/`effective_cpc`, `final_urls` (массив v24), `impressions`, `clicks`, `cost`, `currency`, `conversions`, `all_conversions`, nullable `cost_per_conversion`, `duplicate_in_campaigns` (campaign ID/name). `cpc`, `effective_cpc`, `cost` делятся на 1 000 000 ровно один раз; `cost_per_conversion = cost / conversions`, при нуле — `null`. Валюта из сохранённого account context Stage 2 или одного customer read на вызов; не на каждый keyword.
- `list_supported_objects(GOOGLE_ADS)` теперь `account,campaign,metrics,keyword,ad_group`; Meta остаётся `account,campaign,metrics`. `get_provider_capabilities(GOOGLE_ADS).write` остаётся `false`.
- v24: сверены [ad_group_criterion fields](https://developers.google.com/google-ads/api/fields/v24/ad_group_criterion), [keyword_view attributed resources](https://developers.google.com/google-ads/api/fields/v24/keyword_view), [status enum](https://developers.google.com/google-ads/api/reference/rpc/v24/AdGroupCriterionStatusEnum.AdGroupCriterionStatus), [Query cookbook](https://developers.google.com/google-ads/api/docs/query/cookbook), [GAQL grammar](https://developers.google.com/google-ads/api/docs/query/grammar) и [REST pagination](https://developers.google.com/google-ads/api/rest/examples). Все запрошенные поля существуют; фактический v24 contract — `final_urls` (массив), поэтому не подменяем его одиночным URL. Целые Query A/B **не выполнялись против live API/GoogleAdsFieldService**: остаётся uncertainty по полной совместимости SELECT/FROM/WHERE, которую должен снять READ smoke.
- Изменённые зоны: изолированный `google-ads-keywords.ts` + unit tests, Google adapter, provider read interface/service и typed validation, MCP registry/schema/dispatch/capabilities и tests, Stage 3 smoke check, этот progress. Ни schema/migration, ни Meta adapter/write/preview/commit, ни Public MCP branch не менялись.
- Тесты: mock/unit покрывают метрики и zero-traffic, все status/default filters, campaign/ad group filters, dates in Query B, micros/currency, zero conversions, nullable quality/final URLs, `min_cost` с page1/page2, нормализацию/ENABLED-only дубликаты, bad inputs/cursor, structured Google API error, adapter REST path без mutate, capabilities и Meta supported-object regression. `pnpm typecheck` PASS 15/15, `pnpm lint` PASS 10/10, `pnpm test` PASS 15/15 (API 312 passed, 20 skipped; Meta tests включены), `node --test scripts/google_ads_smoke.test.mjs` PASS 3/3, legacy Python `PYTHONPATH=.;src` + `python -m pytest -q tests/unit` PASS 238 passed / 1 skipped, `python -m compileall -q src/ad_mcp` PASS. Integration-тесты с DB/Redis остаются skipped.
- Live smoke Stage 3: `scripts/google_ads_smoke.mjs` добавляет проверку account `9458996580`, campaign `hm_oc_almaty_proktology_search`, 2026-03-01..2026-09-28; keyword count 68–72 (не денежный допуск), total spend ≈31 287 USD и `[приват клиника]` ≈2 998 USD (±2%). `EXPECTED/ACTUAL/PASS/FAIL` выводится скриптом. Запуск: **`SMOKE NOT RUN: NO LIVE GOOGLE ADS ACCESS`** — локальных `GOOGLE_ADS_SMOKE_MCP_URL`/`GOOGLE_ADS_SMOKE_BEARER_TOKEN` нет; фактические live results отсутствуют.
- Diff/secret checks: `git diff --check` PASS; стандартный `pnpm security:secrets` PASS; дополнительная проверка 12 изменённых/новых файлов на типовые ключи/токены — 0 потенциальных совпадений.
- STOP CONDITIONS Stage 3: не обнаружены для dependency/API version/DB schema/shared preview/Meta write. Прежний HIGH конфликт Public MCP остаётся только для будущего этапа 6. Production effective API version и live Google metrics/GAQL compatibility остаются непроверенными. После отчёта остановиться до человеческой проверки.

## Этап 4 — поисковые запросы

- Дата: 2026-10-01. Ветка `codex/google-ads-ppc`, parent `473dc3274de5767c21394775b9505e24d691e1e1`. Статус: **PASS WITH CSV BLOCKER** для кода и доступных тестов; live READ не выполнен. Только Google Ads READ. Этапы 5–9 не начаты.
- MCP tool `google_ads_search_terms`: `account_id` (10-значный Google customer ID), `since` и `until` (обязательные реальные ISO-даты `YYYY-MM-DD`, `since <= until`); опционально `campaign_ids` (1–200 числовых строковых ID), `min_cost` (>=0 в денежных единицах), `contains` (непустая подстрока <=200 символов), `only_not_added` (boolean), `limit` (1–500, default 100), `cursor` (opaque), `format` (`json` default / `csv`). Отсутствие любой даты и некорректный диапазон дают `invalid_request`; нет тихого `last_30d`.
- Финальный GAQL для JSON (условия `campaign.id IN (...)` и `search_term_view.status = 'NONE'` добавляются соответственно при `campaign_ids` и `only_not_added=true`):

```gaql
SELECT search_term_view.search_term, search_term_view.status,
  segments.keyword.info.text, segments.keyword.info.match_type,
  segments.search_term_match_type, campaign.id, campaign.name,
  ad_group.id, ad_group.name, metrics.impressions, metrics.clicks,
  metrics.cost_micros, metrics.conversions
FROM search_term_view
WHERE segments.date BETWEEN '{since}' AND '{until}'
ORDER BY campaign.id, ad_group.id, search_term_view.search_term
```

- Сработавший keyword берётся только из `segments.keyword.info.text`, его match type — из `segments.keyword.info.match_type`, query match type — из `segments.search_term_match_type`. Отсутствующее keyword info становится `null`, не вычисляется по тексту и не приводит к N+1 запросу. Строки с одинаковым `search_term` не дедуплицируются: сохраняются разные keyword/ad group/campaign и фактическая гранулярность Google. Выход: `search_term`, `search_term_status`, `triggered_keyword`, `triggered_keyword_match_type`, `search_term_match_type`, campaign/ad group ID/name, `impressions`, `clicks`, `cost`, `currency`, `conversions`, `cost_per_conversion`. `cost_micros` делится на 1 000 000 ровно раз; `cost_per_conversion = cost/conversions`, при нуле `null`. Валюта из account context, при отсутствии — один customer read на вызов.
- Фильтры campaign IDs и `only_not_added=true` (`status = 'NONE'`, подтверждённый enum v24) в GAQL. `contains` — буквальная case-insensitive подстрока в Node, не regex; `min_cost` — сравнение фактического нормализованного расхода строки за даты в Node. Последние два post-filter, потому что для `metrics.cost_micros` важна агрегированная стоимость строки, а `contains` должен иметь точную Unicode substring-семантику. Фильтрация идёт **до** limit. Смена любого фильтра/даты/limit делает cursor недействительным.
- JSON выдаёт только requested page (`items`, `next_cursor` — `null` в конце, `metadata`). Google Search page token плюс индекс ещё не выданной строки подписаны HMAC существующим `sessionHashSecret`, привязаны к account/filters/date/limit, валидация отклоняет подмену. Следующий курсор ставится перед первым ещё не выданным подходящим результатом, в том числе через post-filter gaps; один Google Search page ограничен размером provider, scan до 20 provider pages на MCP-вызов и явная ошибка при превышении. Данные могут изменяться между вызовами; Google snapshot isolation между такими вызовами не подтверждена. Обычная страница: один Google Search request при сохранённой валюте, плюс один customer read если валюты нет; дополнительные Google Search requests только при переходе к provider page или поиске следующей подходящей строки. Нет per-term lookup.
- Privacy: `metadata.privacyNotice` сообщает, что Google Ads может скрывать часть queries. Сумма видимых search terms **не считается** равной campaign spend и не трактуется как ошибка HolyMedia.
- CSV: **BLOCKED / NOT IMPLEMENTED**. В текущем Node MCP transport нет file/artifact response, безопасного MCP report-download linkage или готового хранилища файлов для этого инструмента. Найденные HTTP downloads отчётов — отдельный путь, не MCP file delivery. `format=csv` явно возвращает typed `invalid_request` с причиной; не отдаётся огромный CSV строкой, не строится публичный временный файловый сервер. Нужен выбор человека о безопасном MCP file-delivery contract; никаких новых dependencies/DB migration не делалось.
- PMax: [v24 `SearchTermView`](https://developers.google.com/google-ads/api/reference/rpc/v24/SearchTermView) прямо исключает Performance Max; [v24 `CampaignSearchTermView`](https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignSearchTermView) существует и содержит granular query/cost, но keyword-related segments исключают из него PMax; [v24 `campaign_search_term_insight`](https://developers.google.com/google-ads/api/fields/v24/campaign_search_term_insight) доступен для категорий. Это отдельные источники с другой гранулярностью/nullable attribution и pagination contract, поэтому в данном JSON tool PMax **UNSUPPORTED IN CURRENT IMPLEMENTATION**, `metadata.pmaxSupported=false`; данные `search_term_view` не выдаются за PMax. Для PMax потребуется отдельное явно согласованное расширение в рамках будущего запроса, не автоматический fallback.
- Поля и их selectable-attributed resources сверены по v24 field reference (`search_term_view`, `segments`, `metrics`), но **полный GAQL не был выполнен против live Google API/GoogleAdsFieldService**. Его фактическая совместимость и исторические суммы остаются неопределённостью до live READ smoke. Structured Google errors Stage 2 передаются без токенов/credentials; validation errors отдельно.
- Проверки: unit/mock для маппинга keyword/match types, дублей, NULL attribution, дат и фильтров, денег/нулевых conversions, пагинации и tampered cursor, structured error, Google-only/Meta/capabilities и REST read path. `pnpm typecheck` PASS 15/15; `pnpm lint` PASS 10/10; `pnpm test` PASS 15/15 (API 323 passed, 20 skipped, Meta tests включены); `node --test scripts/google_ads_smoke.test.mjs` PASS 3/3; legacy Python `PYTHONPATH=.;src` + `python -m pytest -q tests/unit` PASS 238 passed / 1 skipped; `python -m compileall -q src/ad_mcp` PASS; `git diff --check` PASS; `pnpm security:secrets` PASS. Integration-тесты с DB/Redis остались skipped.
- Smoke Stage 4 добавлен в `scripts/google_ads_smoke.mjs`: account `9458996580`, даты `2026-03-01..2026-09-28`, term `приват клиника алматы` → широкий keyword `проктолог алматы`; сумма видимых terms ≈23 500 USD (±2%) с обязательной privacy-оговоркой. Запуск дал **`SMOKE NOT RUN: NO LIVE GOOGLE ADS ACCESS`** из-за отсутствия локальных MCP URL/token. Фактических live значений, включая GAQL field-combination validation, нет.
- STOP CONDITIONS для CSV-подчасти: отсутствие безопасной MCP file delivery. Для JSON новые dependency/API version/DB schema/shared preview/Meta write не потребовались. Meta/Public MCP branch не менялись, deploy/push нет.

## Этап 5 — чтение минус-слов и проверка конфликтов

- Дата: 2026-10-01. Ветка `codex/google-ads-ppc`, parent `736635e4ac31eb4862106bbb6da129f939fe2e43`. Только Google Ads READ; Google `write=false` сохранён. Этапы 6–9 не начаты. Новых dependencies, версии Google API, DB schema/migrations, общего preview/commit и Meta shared write code не требуется.
- MCP `google_ads_list_negatives`: `account_id` обязателен (10 цифр, дефисы допускаются); опционально `campaign_ids` (1–200 числовых строковых ID), `levels` (непустой набор `campaign|ad_group|shared_list`, default все три), `limit` (1–500, default 100), opaque `cursor`. Неизвестный level, некорректный account/IDs/limit/cursor → typed `invalid_request`. `provider`, если указан, только `GOOGLE_ADS`.
- Пять GAQL query families, все через GoogleAdsService.Search (никаких `mutate`, `validateOnly`, search per criterion/campaign/list):

```gaql
SELECT campaign.id, campaign.name, campaign_criterion.resource_name,
  campaign_criterion.criterion_id, campaign_criterion.keyword.text,
  campaign_criterion.keyword.match_type, campaign_criterion.status
FROM campaign_criterion
WHERE campaign_criterion.type = 'KEYWORD'
  AND campaign_criterion.negative = TRUE
  AND campaign_criterion.status != 'REMOVED'
  [AND campaign.id IN (...)]
ORDER BY campaign.id, campaign_criterion.criterion_id

SELECT campaign.id, campaign.name, ad_group.id, ad_group.name,
  ad_group_criterion.resource_name, ad_group_criterion.criterion_id,
  ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
  ad_group_criterion.status
FROM ad_group_criterion
WHERE ad_group_criterion.type = 'KEYWORD'
  AND ad_group_criterion.negative = TRUE
  AND ad_group_criterion.status != 'REMOVED'
  [AND campaign.id IN (...)]
ORDER BY campaign.id, ad_group.id, ad_group_criterion.criterion_id

SELECT shared_set.id, shared_set.name, shared_set.resource_name,
  shared_set.status, shared_set.member_count
FROM shared_set
WHERE shared_set.type = 'NEGATIVE_KEYWORDS' AND shared_set.status = 'ENABLED'
  [AND shared_set.resource_name IN (...)]
ORDER BY shared_set.id

SELECT shared_set.id, shared_set.name, shared_set.resource_name,
  shared_set.status, shared_set.member_count,
  shared_criterion.criterion_id, shared_criterion.resource_name,
  shared_criterion.keyword.text, shared_criterion.keyword.match_type
FROM shared_criterion
WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
  AND shared_set.status = 'ENABLED' AND shared_criterion.type = 'KEYWORD'
  [AND shared_set.resource_name IN (...)]
ORDER BY shared_set.id, shared_criterion.criterion_id

SELECT shared_set.id, shared_set.name, shared_set.resource_name,
  shared_set.status, shared_set.member_count,
  campaign.id, campaign.name, campaign_shared_set.resource_name,
  campaign_shared_set.status
FROM campaign_shared_set
WHERE shared_set.type = 'NEGATIVE_KEYWORDS'
  AND shared_set.status = 'ENABLED'
  AND campaign_shared_set.status = 'ENABLED'
  [AND campaign.id IN (...)]
ORDER BY shared_set.id, campaign.id
```

- При `campaign_ids` сначала один paginated scan последней query family по выбранным campaigns собирает resource names релевантных attached lists; `shared_set` и `shared_criterion` затем фильтруются этими resource names в GAQL. Это не N+1, но scan повторяется на каждой странице shared-list metadata/members (до 100 provider pages и 1000 sets; превышение — явная ошибка с предложением сузить `campaign_ids`, без тихого пропуска). Связи `campaign_shared_set` уже фильтруются server-side. Без `campaign_ids` pre-scan отсутствует. При отсутствии релевантных списков metadata/member queries пропускаются.
- Выход: `account_id`, `page_section`, `campaign.campaigns[].negatives`, `ad_group.campaigns[].ad_groups[].negatives`, `shared_list.lists[]` с `shared_set_id/name/resource_name/status/member_count`, `negatives`, `attached_campaigns`, `fragment_kind=metadata|members|attachments`, `next_cursor`. Поля shared list есть в каждой строке через attributed `shared_set`; `member_count=null`, если API не вернул корректное число, вместо выдуманного 0. Страница содержит **один** из пяти типов фрагментов. Пустые массивы в другом типе фрагмента не означают, что список пуст; клиент должен пройти `next_cursor` до `null` и объединить shared fragments по `resource_name` (или `shared_set_id` в рамках одного customer). В ответе максимум `limit` исходных строк; список/кампания могут продолжиться на следующей странице. Google не гарантирует snapshot isolation при изменениях между вызовами.
- Единый deterministic cursor: base64url JSON с версией, индексом query family, Google provider page token, индексом строки и fingerprint account/filters; порядок families `campaign → ad_group → shared_set → shared_criterion → campaign_shared_set`. Нет загрузки всей account inventory в память — не более одной Google Search page и одного выходного фрагмента на вызов (кроме ограниченного pre-scan связей при `campaign_ids`). Неверный или несовместимый cursor отклоняется. Указанный лимит относится к строкам, не к числу вложенных campaign/list объектов.
- MCP `google_ads_check_negative_conflicts`: обязательны `account_id`, `campaign_ids` (1–200 числовых строковых ID), `negatives` (1–100 `{text,match_type?}`; `BROAD|PHRASE|EXACT`, default BROAD), опциональны `limit` (1–500, default 100) и opaque `cursor`. Принимаются `слово`, `"фраза"`, `[точное]`; явный match type не должен противоречить синтаксису. Input дедуплицируется по нормализованному text + match type с сохранением первого порядка; response `normalized_negatives` показывает фактический набор. Некорректный match type/пустой text/cursor → `invalid_request`.
- Checker использует Stage 3 `keywordInventoryQuery` и `keywordPlacement` напрямую в provider; не вызывает MCP через HTTP. GAQL `FROM ad_group_criterion` с `type='KEYWORD'`, `negative=FALSE`, `ad_group_criterion.status IN ('ENABLED')`, `campaign.id IN (...)`, non-REMOVED campaign/ad group; выбранные поля Stage 3. Дополнительные guards на malformed responses не допускают PAUSED/REMOVED/negative/out-of-scope placements. Текст positive keyword сравнивается независимо от его match type. Выход `conflicts[]` содержит normalized negative, реальный keyword resource/criterion/text/match_type/status, campaign/ad group ID/name и `reason.code/message`. Scan до 20 Google Search provider pages на MCP-вызов; если нужны ещё, выдаётся cursor продолжения, а не обрезается итог. Нет N+1; обычный запрос — 1 Search, плюс provider pages по необходимости. Один positive placement может дать несколько конфликтов (по разным кандидатам), в том числе через границу страницы.
- Нормализация checker: trim, сворачивание пробелов, Unicode lower-case, снятие только внешних Google `"..."`/`[...]` delimiters; нет stemming, lemmatization, close variants, исправления опечаток или fuzzy. BROAD — все токены минуса присутствуют в keyword в любом порядке (с учётом повторов), PHRASE — токены идут подряд в том же порядке, EXACT — нормализованный текст равен. Две реальные placements в разных кампаниях возвращаются отдельно. `PAUSED` positive keywords не проверяются.
- [v24 campaign_criterion](https://developers.google.com/google-ads/api/fields/v24/campaign_criterion), [ad_group_criterion](https://developers.google.com/google-ads/api/fields/v24/ad_group_criterion), [shared_set](https://developers.google.com/google-ads/api/fields/v24/shared_set), [shared_criterion](https://developers.google.com/google-ads/api/fields/v24/shared_criterion), [campaign_shared_set](https://developers.google.com/google-ads/api/fields/v24/campaign_shared_set): поля/attributed resources для пяти SELECT/FROM сочетаний сверены; `member_count` действительно существует и selectable, `campaign_shared_set.status`/`campaign_criterion.status` существуют. Полные запросы не выполнены против live API/GoogleAdsFieldService; фактическая совместимость и cross-customer (manager-owned) shared lists остаются неопределённостью до live READ. Версия API осталась `v24` в code default; production override не подтверждён.
- `list_supported_objects(GOOGLE_ADS)` добавляет `negative_keyword`, `shared_negative_list`; Meta и Google `write=false` не менялись. Stage 2 structured Google Ads errors (`error_code`, `message`, `field_path`, `request_id`, `errors[]`) продолжают проходить через тот же REST search path; секреты не входят в output.
- `scripts/google_ads_smoke.mjs` дополнен тремя только-read контролями: наличие existing negatives во всех трёх On Clinic accounts; `приват` BROAD против **фактического** `[приват клиника]` в `hm_oc_almaty_proktology_search`; effective presence `clinic appointment` в `hm_oc_almaty_ginekologiya_search` как campaign criterion **или** member attached shared list. Скрипт не вызывает write tools и отказывается работать при `GOOGLE_ADS_WRITE_MODE=live`.
- Stage 4 CSV blocker **остаётся открытым**: MCP file-delivery architecture не создавалась; `format=csv` продолжает возвращать прежний typed error. PMax не расширялся.
- Тесты/регресс: negative unit 11/11 (пять query families, группировка, multi-campaign attachments, levels/default/empty, pagination/invalid cursor, nullable `member_count`, structured error, 9 обязательных match cases, normalization/syntax/dedup, ENABLED-only placements, cross-campaign results), MCP service 33/33 (новые schemas/routing/validation/capabilities/Meta unchanged), adapter REST read-only test, smoke helper 4/4. `pnpm typecheck` PASS 15/15; `pnpm lint` PASS 10/10; `pnpm test` PASS 15/15 (API 336 passed, 20 skipped; Meta tests включены); legacy Python `PYTHONPATH=.;src` + `python -m pytest -q tests/unit` PASS 238 passed / 1 skipped; `python -m compileall -q src/ad_mcp` PASS; `git diff --check` PASS; `pnpm security:secrets` PASS. DB/Redis integration tests остались skipped.
- Live smoke: `node scripts/google_ads_smoke.mjs` вывел **`SMOKE NOT RUN: NO LIVE GOOGLE ADS ACCESS`** — локальных `GOOGLE_ADS_SMOKE_MCP_URL` и `GOOGLE_ADS_SMOKE_BEARER_TOKEN` нет. Никаких live результатов H/I/J и фактической v24 GAQL-валидации нет. Никакие provider writes/validate_only не выполнялись.
- STOP CONDITIONS: новых для Stage 5 нет; прежний Public MCP intersection HIGH перед Stage 6 остаётся. После Stage 5 **STOP** до отдельного архитектурного разбора человеком.

## Этапы 6–9

Не начаты. Никаких Google/Meta provider writes, `mutate` или `validate_only` не выполнялось; push/deploy отсутствуют.

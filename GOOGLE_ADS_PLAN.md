# Google Ads в HolyMedia MCP: чтение ключей, запросов, минус-слов и безопасная запись
Как запускать (для человека). Положить этот файл в корень репозитория MCP как GOOGLE_ADS_PLAN.md и дать Codex одну команду:

Прочитай GOOGLE_ADS_PLAN.md и выполни все этапы по порядку. После каждого этапа обновляй docs/google-ads-progress.md.

Если Codex остановился на точке остановки (⛔), прочитать его отчёт, ответить на вопрос и сказать «продолжай».


## 0. Контекст (для Codex)
Это MCP-сервер агентства Holy Media для работы с рекламными кабинетами через AI-ассистентов.

Meta уже умеет читать и менять кабинеты по схеме «превью → подтверждение». Её не трогать.
Google Ads сейчас только читает аккаунты, кампании и метрики кампаний. get_provider_capabilities для GOOGLE_ADS отдаёт write: false, list_supported_objects — только account, campaign, metrics.
OAuth-приложение в Google Cloud проверено Google и находится в статусе In production, scope https://www.googleapis.com/auth/adwords одобрен. Роли пользователей в кабинетах — Admin или Standard. Доступы не мешают: запись не реализована в коде.
Developer token Google упразднил 9.09.2026. Уровень доступа к API теперь привязан к Google Cloud-проекту, а заголовок developer-token игнорируется. В будущей версии API запросы с ним начнут отклонять.

Цель: чтобы через MCP можно было:

читать ключевые слова, поисковые запросы (со сработавшим ключом) и минус-слова Google Ads;
ставить ключи на паузу и включать их;
добавлять минус-слова в кампании и вести общие списки минус-слов;
всё это — безопасно: превью, повторная проверка, запись, журнал, откат.


## 1. Как работать (для Codex)
Этапы выполнять строго по порядку. Каждый этап — отдельный коммит с префиксом google-ads: этап N — ….
После каждого этапа:
запустить все тесты проекта, включая тесты Meta; всё должно быть зелёным;
дописать в docs/google-ads-progress.md: что сделано, какие файлы изменены, какие тесты добавлены, как проверить руками, что осталось непонятным.
⛔ Точка остановки — остановиться и ждать ответа человека, если:
на этапе 1 обнаружилось, что устройство проекта сильно отличается от описанного здесь;
нужна новая зависимость или смена версии Google Ads API;
нужно менять схему БД или общий код, который использует Meta;
что-то в этом файле противоречит коду или документации Google Ads API. В остальных случаях — продолжать без остановок.
Если поле или ресурс из этого файла отсутствует в используемой версии Google Ads API — не выдумывать замену: свериться с документацией этой версии, сделать по ней и записать расхождение в отчёт.
### Как проверять себя
У каждого этапа три уровня проверки. Этап не считается готовым, пока не пройдены все доступные уровни.

Юнит-тесты на моках — пишутся на каждом этапе (что именно покрыть — указано в этапе). Запускаются всегда, сеть и доступы к Google не нужны.
Все тесты проекта, включая Meta, — после каждого этапа. Если упал тест Meta — чинить до перехода дальше.
Smoke-скрипт на живых аккаунтах — scripts/google_ads_smoke (язык — как в проекте). Создать на этапе 2 и на каждом следующем этапе дописывать в него пункт «Проверка» этого этапа с ожидаемыми цифрами из этого файла. Требования к скрипту:
только чтение и validate_only; при GOOGLE_ADS_WRITE_MODE=live скрипт отказывается запускаться;
для каждой проверки печатает: что проверялось, ожидание, факт, PASS/FAIL;
цифры сравнивать с допуском ±2% (данные за прошлые даты могут немного уточняться);
в конце — итог N passed / M failed и ненулевой код выхода при любом FAIL. Если у Codex в окружении есть доступ к сети и учётные данные Google Ads — запустить скрипт и приложить вывод в docs/google-ads-progress.md. Если нет — написать «smoke не запускался: нет доступа», и его запустит человек.

Вывод: человек после всех этапов запускает одну команду (scripts/google_ads_smoke) и видит по каждому пункту, работает он или нет.
### Общие правила кода
Новые инструменты Google делать по образцу Meta: та же регистрация инструментов, формат ответов, схема preview → confirm/commit, обработка ошибок. Если механизм превью общий — переиспользовать его с маршрутизацией по провайдеру, а не писать параллельный.
Использовать тот клиент Google Ads API и ту версию API, что уже есть в проекте.
Деньги в Google Ads API — в микронах (cost_micros, amount_micros, cpc_bid_micros). В ответах MCP — всегда в валюте аккаунта (делить на 1 000 000) и с кодом валюты customer.currency_code.
Запросы к кабинетам под управляющим аккаунтом — с заголовком login-customer-id (ID MCC из конфигурации).
Заголовок developer-token не отправлять.
Все списки — с постраничной выдачей (limit + cursor). В каждой строке — ID объекта и его resource_name.
Ошибки Google Ads API не прятать: возвращать error_code, message, field_path, request_id.
В тестах — только моки клиента Google Ads. Никаких записей в реальные кабинеты из тестов.
Любая запись в Google Ads — только через каркас из этапа 6. Прямых mutate-вызовов в обход него не добавлять.
Удаление (REMOVE) ключей, групп и кампаний не реализовывать.
Минус-слова уровня аккаунта не реализовывать (позже, отдельной задачей).


## Этап 1 — разведка (без изменений кода)
Изучить репозиторий и записать в docs/google-ads-notes.md, с путями к файлам и именами функций:

Как регистрируются MCP-инструменты и как выбирается провайдер (META_ADS / GOOGLE_ADS).
Где задаются capabilities провайдеров (read/write) и supported objects; где проверяется write=false для Google.
Как устроена запись Meta: инструменты *_preview, confirm_preview, commit_preview и подобные; где хранится превью, сколько живёт, есть ли журнал изменений.
Как устроен провайдер Google Ads: клиент (библиотека или REST), версия API, OAuth-токены, откуда берётся login-customer-id, отправляется ли developer-token.
Какие GAQL-запросы уже есть и где.
Что происходит при вызове общих инструментов для GOOGLE_ADS (update_entity_status_preview, pause_entities_preview, get_flexible_insights, audit_account, list_campaigns): куда уходит вызов и почему он падает с общей ошибкой «Не удалось выполнить запрос HolyMedia».
Как запускать тесты и проходят ли они сейчас.
План: в какие файлы добавлять этапы 2–8 так, чтобы повторить устройство Meta.

Готово, когда: docs/google-ads-notes.md отвечает на все 8 вопросов, других изменений нет. Если план из п. 8 требует менять общий с Meta код или схему БД — ⛔.


## Этап 2 — исправить ошибки в существующих инструментах Google
Ошибки найдены на живых вызовах 29.09.2026 (сырые ответы — в приложении Б).

audit_account (и везде, где считается цена конверсии кампании): costPerConversion возвращается в микронах, currency пустой. Аккаунт 9458996580, кампания 22623539698: spend 5184.19, conversions 570.97 → вернулось 9079599.48, должно быть ≈ 9.08 USD. Исправить и заполнять currency.
get_flexible_insights для GOOGLE_ADS игнорирует level=campaign и отдаёт один итог по аккаунту. Возвращать строку на каждую кампанию; поддержать since/until наравне с date_preset.
list_campaigns игнорирует фильтр status (при ENABLED приходят и REMOVED). Фильтровать в GAQL по campaign.status; по умолчанию REMOVED не возвращать.
Бюджет кампании: отдавать campaign_budget.amount_micros (в валюте), campaign_budget.explicitly_shared, campaign_budget.period, resource_name бюджета. Проверить кампанию 15961195382 в аккаунте 2732846994: сейчас бюджет показывается как 5 при расходе ≈ 1016 USD за 30 дней — выяснить причину и записать в отчёт.
Ошибки: возвращать ошибки Google Ads API как есть (error_code, message, field_path, request_id). Для неподдерживаемых сочетаний (например, entity_type=keyword в общих preview-инструментах до этапа 7) — явная ошибка «not supported for GOOGLE_ADS», а не общее сообщение.
Перестать отправлять заголовок developer-token. Если библиотека требует поле — сделать его необязательным и описать это в отчёте.

Для каждого пункта — юнит-тест на моках.

Проверка (добавить в smoke-скрипт): audit_account для 9458996580 показывает цену конверсии кампании ≈ $9; get_flexible_insights с level=campaign для 2732846994 даёт 5–6 строк кампаний; list_campaigns с status=ENABLED для 6196888360 даёт только включённые (≈10–15).


## Этап 3 — чтение ключей
Инструмент google_ads_list_keywords (или по принятому в проекте именованию).

Вход: account_id (обяз.), campaign_ids, ad_group_ids, statuses (по умолчанию все, кроме REMOVED), since/until (для метрик), min_cost, limit + cursor.

Два GAQL-запроса, склейка по ad_group_criterion.resource_name:

-- а) все ключи, включая без показов

SELECT campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status,

  ad_group_criterion.resource_name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text,

  ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.negative,

  ad_group_criterion.approval_status, ad_group_criterion.system_serving_status,

  ad_group_criterion.quality_info.quality_score, ad_group_criterion.cpc_bid_micros,

  ad_group_criterion.effective_cpc_bid_micros, ad_group_criterion.final_urls

FROM ad_group_criterion

WHERE ad_group_criterion.type = 'KEYWORD' AND ad_group_criterion.negative = FALSE

  AND ad_group_criterion.status != 'REMOVED' AND campaign.status != 'REMOVED'

-- б) метрики за период

SELECT ad_group_criterion.resource_name, metrics.impressions, metrics.clicks, metrics.cost_micros,

  metrics.conversions, metrics.all_conversions

FROM keyword_view

WHERE segments.date BETWEEN '{since}' AND '{until}'

Ответ на ключ: resource_name, criterion_id, ad_group_id, campaign_id, имена кампании и группы, текст, match_type, status, serving_status, approval_status, quality_score, cpc (в валюте), final_url, impressions, clicks, cost (в валюте), conversions, cost_per_conversion, duplicate_in_campaigns — другие включённые кампании этого аккаунта с ключом с тем же текстом (сравнение без регистра и без символов [ ] " +).

Добавить keyword и ad_group в supported objects GOOGLE_ADS. Тесты на моках.

Проверка (добавить в smoke-скрипт): аккаунт 9458996580, 01.03.2026–28.09.2026, кампания hm_oc_almaty_proktology_search: 70 ключей, расход ≈ $31 287; у [приват клиника] ≈ $2 998. Совпадает с интерфейсом Google Ads.


## Этап 4 — поисковые запросы
Инструмент google_ads_search_terms.

Вход: account_id, since, until (обяз.), campaign_ids, min_cost, contains (подстрока), only_not_added (только search_term_view.status = NONE), limit + cursor, format (json | csv).

SELECT search_term_view.search_term, search_term_view.status,

  segments.keyword.info.text, segments.keyword.info.match_type, segments.search_term_match_type,

  campaign.id, campaign.name, ad_group.id, ad_group.name,

  metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions

FROM search_term_view

WHERE segments.date BETWEEN '{since}' AND '{until}'

В каждой строке обязателен сработавший ключ (segments.keyword.info.text + match_type). Один запрос может прийти несколькими строками — по разным ключам/группам, это нормально.
Для больших аккаунтов (сотни тысяч строк) format=csv отдаёт файл, а не огромный JSON.
Performance Max: категории запросов — campaign_search_term_insight, сами запросы — campaign_search_term_view, если он есть в используемой версии API. Чего нет — так и писать в ответе, данные не подменять.

Тесты на моках.

Проверка (добавить в smoke-скрипт): в 9458996580 у запроса «приват клиника алматы» виден сработавший широкий ключ «проктолог алматы». Сумма расхода по запросам за март–сентябрь близка к выгрузке из интерфейса (≈ $23,5k — Google показывает не все запросы).


## Этап 5 — чтение минус-слов
Инструмент google_ads_list_negatives.

Вход: account_id (обяз.), campaign_ids, levels (campaign, ad_group, shared_list; по умолчанию все).

| Что | Откуда |
| --- | --- |
| Минус-слова кампании | campaign_criterion WHERE type = 'KEYWORD' AND negative = TRUE |
| Минус-слова группы | ad_group_criterion WHERE type = 'KEYWORD' AND negative = TRUE |
| Общие списки | shared_set WHERE type = 'NEGATIVE_KEYWORDS' AND status = 'ENABLED' (id, name, member_count, resource_name) |
| Слова в списках | shared_criterion (shared_set.id, criterion_id, keyword.text, keyword.match_type) |
| Куда подключены списки | campaign_shared_set (campaign.id, campaign.name, shared_set.id, status) |

Ответ сгруппировать: уровень → кампания/группа/список → слова. Для каждого списка — к каким кампаниям подключён.

Плюс функция check_negative_conflicts(account_id, campaign_ids, negatives[{text, match_type}]): какие включённые ключи этих кампаний будут заблокированы. Правила Google для минус-слов (без близких вариантов):

широкое — все слова минуса есть в ключе, в любом порядке;
фразовое — слова минуса идут подряд в том же порядке;
точное — текст ключа совпадает с минусом.

Сравнение без регистра. Тесты на все три типа.

Проверка (добавить в smoke-скрипт): для всех трёх аккаунтов On Clinic видны текущие минус-слова, включая исключённый ранее «clinic appointment» (в hm_oc_almaty_ginekologiya_search — как минус кампании или через общий список). check_negative_conflicts для минуса «приват» (широкое) в hm_oc_almaty_proktology_search находит ключ [приват клиника].


## Этап 6 — каркас записи (preview → проверка → commit → журнал)
Сам по себе ничего не меняет в кабинетах; через него идёт вся запись из этапов 7–8.

Preview (внутренняя функция для инструментов этапов 7–8):
принимает account_id и список операций (MutateOperation);
читает текущее состояние каждого затронутого объекта (снимок «до»);
вызывает GoogleAdsService.Mutate с validate_only=true;
сохраняет превью: id, account_id, кто создал, когда, операции, снимок «до», срок жизни 30 минут;
возвращает понятный список: объект (имя + ID), было → станет, расход объекта за 30 дней, reversible=true/false, ошибки валидации по каждой операции.
Commit (инструмент подтверждения, preview_id обязателен):
заново читает состояние объектов и сравнивает со снимком; изменившиеся объекты не трогает и пишет о них в отчёте;
операции с reversible=false выполняет только при confirm_irreversible=true;
отправляет Mutate с partial_failure=true и разбирает результат по каждой операции (успех / ошибка с кодом и текстом). Если сервис не поддерживает partial_failure — по одной операции;
превью одноразовое; просроченное отклоняется.
Журнал (там же, где журнал Meta, если он есть; иначе — новая таблица, ⛔ если нужна миграция БД): на каждую операцию — preview_id, кто, когда, account_id, resource_name, тип операции, было, стало, результат, request_id Google Ads API, сырой ответ. Инструмент просмотра журнала с фильтром по аккаунту и дате.
Откат: инструмент строит обратные операции для записей журнала с reversible=true и проводит их через тот же preview → commit.
Конфиг:
GOOGLE_ADS_WRITE_MODE = off | dry_run | live — по умолчанию dry_run (commit тоже идёт с validate_only);
GOOGLE_ADS_WRITE_ALLOWED_ACCOUNTS — список account_id, в которые разрешена запись (по умолчанию пустой);
максимум 500 операций на одно превью.
Capabilities: write=true для GOOGLE_ADS только если WRITE_MODE != off; отдавать список реально поддержанных операций.

Конкретные операции на этом этапе не добавлять. Тесты на моках: успешный commit; частичная ошибка; объект изменился между preview и commit; просроченное превью; повторный commit; необратимая операция без флага; аккаунт не из списка; режим dry_run.

Готово, когда: все 8 сценариев покрыты тестами и проходят, тесты Meta зелёные.


## Этап 7 — пауза и включение ключей
Инструмент google_ads_set_keyword_status_preview через каркас этапа 6.

Вход: account_id, status (PAUSED | ENABLED), keywords — список элементов одного из видов:

{ resource_name }, или
{ campaign (id или точное имя), ad_group (опц.), text, match_type (BROAD | PHRASE | EXACT) } — разрешать в resource_name через этап 3. Если нашлось 0 или больше 1 ключа — не угадывать, вернуть эту строку как ошибку в превью.

Операция: AdGroupCriterionOperation.update, resource_name = customers/{cid}/adGroupCriteria/{ad_group_id}~{criterion_id}, status, update_mask = ["status"]. reversible=true. Ключи, уже находящиеся в нужном статусе, пропускать и показывать как «без изменений».

Общие update_entity_status_preview / pause_entities_preview с provider=GOOGLE_ADS, entity_type=keyword направить в этот же код. Тесты на моках, включая неоднозначный поиск ключа.

Проверка (добавить в smoke-скрипт): в dry_run превью паузы [приват клиника] (точное) в hm_oc_almaty_proktology_search показывает группу «Общие запросы», «вкл → пауза» и расход за 30 дней; commit проходит без ошибок и ничего не меняет. Проверку в live (ключ встаёт на паузу, в журнале запись с request_id, откат возвращает «вкл») делает человек на тестовом кабинете — см. «Запуск в бой».


## Этап 8 — минус-слова
Через каркас этапа 6.

А. В кампаниях и группах

google_ads_add_campaign_negatives_preview(account_id, campaign_ids, negatives[{text, match_type}]): CampaignCriterionOperation.create { campaign, negative: true, keyword { text, match_type } }.
Для групп — то же через AdGroupCriterionOperation.create с negative: true (параметр ad_group_ids).
google_ads_remove_negatives_preview(account_id, resource_names).

Б. Общие списки google_ads_negative_list_preview(account_id, list_name, negatives[...], attach_campaign_ids[...], detach_campaign_ids[...]):

если списка с таким именем нет — SharedSetOperation.create { name, type: NEGATIVE_KEYWORDS } с временным resource_name (customers/{cid}/sharedSets/-1), чтобы одним Mutate создать список, слова и подключения;
слова — SharedCriterionOperation.create { shared_set, keyword { text, match_type } };
подключение — CampaignSharedSetOperation.create { campaign, shared_set }, отключение — remove.

Общие правила для А и Б

match_type принимать как BROAD/PHRASE/EXACT и в синтаксисе Google: слово, "фраза", [точное].
Слова, которые уже есть в кампании/списке, пропускать и показывать в превью.
В превью вызывать check_negative_conflicts (этап 5) и показывать, какие включённые ключи будут заблокированы; при конфликтах commit только с allow_conflicts=true.
Предупреждать, если список подключается к кампании с brand в названии.
Добавление минуса и подключение списка — reversible=true (откат = удалить добавленное).
Учесть лимиты Google на размер и число списков (сверить с документацией) и возвращать понятную ошибку.

Тесты на моках: новый список + слова + подключение одним запросом; дубли; конфликт; три типа соответствия; откат.

Проверка (добавить в smoke-скрипт): в dry_run для 9458996580 превью списка «HM – Конкуренты» из 10 слов с подключением к hm_oc_almaty_proktology_search проходит валидацию и показывает конфликт с ключом [приват клиника]. Проверку в live (список виден в «Библиотеке общих ресурсов» Google Ads, откат его отключает) делает человек на тестовом кабинете — см. «Запуск в бой».


## Этап 9 — завершение
Раздел в README: список новых инструментов Google Ads, параметры, примеры вызовов, режимы WRITE_MODE, как добавить аккаунт в GOOGLE_ADS_WRITE_ALLOWED_ACCOUNTS.
Итог в docs/google-ads-progress.md: что сделано по каждому этапу, что не удалось и почему, какие поля/ресурсы отличались от этого плана.
Убедиться, что в конфиге по умолчанию стоит GOOGLE_ADS_WRITE_MODE=dry_run, а список разрешённых аккаунтов пуст.


## Запуск в бой (делает человек, не Codex)
Запустить scripts/google_ads_smoke — все пункты PASS.
Тестовый или пустой кабинет без показов, GOOGLE_ADS_WRITE_MODE=live: пауза ключа, минус-слово, список, откат — всё видно в интерфейсе Google Ads и в журнале.
В разрешённые аккаунты добавить только Проктологию On Clinic (9458996580), поставить на паузу один ключ [приват клиника], проверить в интерфейсе.
Добавить остальные аккаунты On Clinic (2732846994, 6196888360), прогнать этап 1 плана чистки: ≈ 90 ключей на паузу и список «Конкуренты».

Дальше (P1, отдельными задачами через тот же каркас): добавление и перенос ключей, смена типа соответствия (= новый ключ + пауза старого, reversible=false), ставки и бюджеты, действия-конверсии (чтение, разбивка метрик по действию, переключение «основная/вторичная»), настройки кампании и AI Max, минус-слова уровня аккаунта, офлайн-конверсии из CRM.


## Приложение А. Аккаунты для проверки
| Аккаунт | ID | Комментарий |
| --- | --- | --- |
| On Clinic — Проктология | 9458996580 | 1 активная поисковая кампания hm_oc_almaty_proktology_search |
| On Clinic — Основные отделения | 2732846994 | Гинекология и урология, 5 включённых кампаний |
| On Clinic — Доп. отделения | 6196888360 | ≈ 13 включённых кампаний, много удалённых |

Все три — под управляющим аккаунтом Rocketfirm (его ID брать из конфигурации MCP).
## Приложение Б. Сырые ответы MCP (29.09.2026), на которых основан этап 2
// get_provider_capabilities(provider=GOOGLE_ADS)

{"id":"GOOGLE_ADS","read":true,"write":false,"status":"available","scopes":["https://www.googleapis.com/auth/adwords"]}

// list_supported_objects(provider=GOOGLE_ADS)

{"provider":"GOOGLE_ADS","items":["account","campaign","metrics"]}

// audit_account(provider=GOOGLE_ADS, account_id=9458996580), 2026-08-30..2026-09-28, кампания 22623539698

{"name":"hm_oc_almaty_proktology_search","spend":{"amount":"5184.18943","currency":null},

 "conversions":570.971158,"costPerConversion":{"amount":"9079599.481275","currency":null}}

// get_flexible_insights(provider=GOOGLE_ADS, account_id=2732846994, level=campaign, date_preset=last_30d)

// → один итог по аккаунту вместо строк по кампаниям

{"spend":{"amount":"5190.570114","currency":"USD"},"clicks":8944,"conversions":857.96252,

 "costPerConversion":{"amount":"6.04988","currency":"USD"}}

// update_entity_status_preview(provider=GOOGLE_ADS, account_id=9458996580, entity_type=keyword,

//                              status=PAUSED, entity_ids=["test"])

{"message":"Не удалось выполнить запрос HolyMedia. Попробуйте ещё раз."}

// list_campaigns(provider=GOOGLE_ADS, account_id=6196888360, status=ENABLED)

// → первая страница из 100 кампаний (nextCursor: "100"), большинство со статусом REMOVED.

// Кампания 15961195382 (account 2732846994): budget.amount = "5", расход за 30 дней по audit_account = "1015.602162".
## Приложение В. Справка по Google Ads API
| Задача | Чтение (GAQL) | Изменение |
| --- | --- | --- |
| Ключи | keyword_view, ad_group_criterion (type = KEYWORD) | AdGroupCriterionService / GoogleAdsService.Mutate |
| Поисковые запросы | search_term_view + segments.keyword.info.*, segments.search_term_match_type | — |
| Запросы PMax | campaign_search_term_insight, campaign_search_term_view | — |
| Минус-слова кампании / группы | campaign_criterion, ad_group_criterion (negative = TRUE) | CampaignCriterionService, AdGroupCriterionService |
| Общие списки минус-слов | shared_set, shared_criterion, campaign_shared_set | SharedSetService, SharedCriterionService, CampaignSharedSetService |
| Кампании, бюджеты | campaign, campaign_budget | CampaignService, CampaignBudgetService |

Для записи: validate_only — превью без применения; partial_failure — пачки с ошибками по строкам (поддерживают не все методы); login-customer-id — ID MCC. Документация: https://developers.google.com/google-ads/api/docs/start , про упразднение developer token: https://developers.google.com/google-ads/api/docs/api-policy/developer-token

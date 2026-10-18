# HolyPilot: максимум завершения исходного Google Ads ТЗ без VPS

Срез 18.10.2026, ветка `codex/qrs-test-auth-recovery`. База: `4897d23d625496cf29478a2cac3026ccaaaef4c4`. Первичные §: [`original-tz-source-20261009.json`](../../artifacts/google-full-scope/original-tz-source-20261009.json); полная нормализация и исторические provider результаты: [`FINAL_REMAINING_TZ_MATRIX.md`](FINAL_REMAINING_TZ_MATRIX.md). Ни VPS, ни текущие TEST/production, ни Google Ads в этом проходе не использовались. Ни один прежний LIVE результат не повышен за счёт mock или CI.

## Сделано в этом проходе

1. **0.04, success-only signup.** Существующий [`AuthService.signup`](../../apps/api/src/auth/auth.service.ts) сначала завершает транзакцию user/workspace/membership, затем создаёт сессию и записывает success audit. Новый [`signup-conversion.ts`](../../apps/web/app/components/signup-conversion.ts) вызывается только после HTTP 2xx с `user.id` и `workspace.id`. Отдельный чекбокс в [`/auth`](../../apps/web/app/(public)/auth/page.tsx) по умолчанию пуст; до согласия Google script не загружается. После успеха форма очищается, query удаляется, а в Google Ads event передаются только `send_to` и очищенный `page_location`; email, имя, пароль, session/OAuth token, user/workspace ID в event не входят. Локальный marker записывается до network activity и предотвращает повторный учёт при возврате/повторе в том же браузере. Если storage недоступен, отправка блокируется. Ошибка тега не отменяет успешную регистрацию; она может потерять конверсию, что честнее ложного повторного счёта. Google подтверждения доставки этот код не получает.
2. Три build-time параметра `NEXT_PUBLIC_SIGNUP_GOOGLE_ADS_*` имеют default **OFF**, строгие ID/label checks и блокировку при `NEXT_PUBLIC_TEST_RESTRICTED_AUTH=true`; без настоящего action ID/label отправка невозможна. CSP расширяется лишь при полной разрешённой конфигурации. Никаких значений Google и реальных событий в этот проход не внесено. Перед включением нужны одобренный текст/основание consent, настоящий owned `WEBPAGE/SIGNUP` action, tag ID/label и отдельный release. Факт внутреннего signup audit не равен Google conversion. Google TEST не даст serving conversion metrics.
3. Новый [`non-vps-http-smoke.mjs`](../../scripts/non-vps-http-smoke.mjs) проверяет реальный локальный API: readiness, запрет неавторизованных session, REST и OpenAPI, наличие маршрута signup в Swagger. Он подключён к Linux CI. Локальный Web build и HTTP `/auth`, `/en/auth`, `/api/health` прошли; tag в HTML/CSP при default-OFF отсутствует.
4. [`infra/local-test`](../../infra/local-test/README.md) содержит отдельный localhost-only API/Web/PostgreSQL/Redis Compose без VPS секретов, общих volumes и Google writes. CI проверяет `docker compose config`. На текущем Windows-ПК полноценный Compose run не выполнен: установлен `wsl.exe`, но Linux-дистрибутива нет (`wsl -l` exit 1), Docker отсутствует. Установка WSL2/Docker, reboot, HTTPS ingress и перенос TEST-only OAuth материалов не разрешены этим заданием.

**Offline evidence:** Web Vitest 5/5; targeted API Vitest 155/155 (8 files: signup/restricted auth, Stage 0–2, ConversionAction, PMax, client contract) и 187 PASS/2 skipped (9 файлов Stage 3–4, OAuth, preview/approval, audit/rollback; локальные DB/Redis integration пропущены при отсутствии контейнеров); Web lint/typecheck/build PASS; локальный Web HTTP smoke 3/3. Первичный exact-source Linux CI на `f9e8f1556f9f864df784de79bb151de2f54152f5`: [foundation](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39143178544), [TEST Web image](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39143178521), [Stage234 API image](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39143178480), [API-only image](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/39143178573) — все PASS. Foundation отдельно подтвердил Compose config, disposable PostgreSQL/Redis, миграции, REST/OpenAPI HTTP denial, полный test/build, secrets и dependency audit. Предыдущие 20/20 Google LIVE и Search Clone не повторялись.

## 39 групп: программная граница, LIVE и следующий профиль приёмки

Обозначения: **D** = ограниченный профиль реализован и локально проверен (не все мыслимые provider combinations); **D\*** = 0.04 имеет готовую отключённую основу, но ещё нет legal consent approval, ID/label и Google доставки; **L** = исторический ограниченный LIVE PASS; **P** = исторический PARTIAL; **C** = CODE ONLY; **B** = BLOCKED. Все write/restore требуют нового immutable preview, текущего READ, OWNER browser approval, одного commit и reread; восстановление имеет отдельный preview/approval. Для read-only эти write-разрешения не нужны. `validate_only` никогда не обозначает commit. Все ресурсы далее относятся исключительно к TEST customer **8590146099**, если явно не указан реальный owned data account.

| ID (§ из ТЗ) | Код | LIVE | Реальный ресурс и минимальный следующий acceptance profile |
|---|---|---|---|
| G01 (27–31) | D | L | Owned TEST campaign: READ → preview/TTL/stale/B-A → validate_only → approval → reversible edit/reread/restore. |
| G02 (37,42) | D | L | Owner/workspace, OAuth grant, customer allowlist и MCC rights; production account/approvers отдельно утвердить. |
| G03 (32,41) | D | L | Owned batch ≤500 с per-row outcome; Google partial failure отдельно от локального snapshot отказа. |
| G04 (34,38–39) | D | P | Audit и bounded reversible campaign/criteria; не повторять irreversible delete; inverse требует отдельного approval. |
| G05 (35,40) | D | P | READ currency/micros и campaign budget; currency/bid threshold variants через provider validate_only и safe restore. |
| G06 (36) | D | P | PAUSED Search/PMax; для PMax сначала conversion goal, eligible media и отдельный PAUSED fixture. |
| G07 (44–45,47–52) | D | P | MCP typed schema/annotations проверены; реальные client prompts ChatGPT/Claude — внешнее client evidence. |
| G08 (46) | D | L | Исторический TEST OAuth S256/grants PASS; production OAuth grant/release отдельное решение. |
| G09 (53) | D | C | Локальный REST/OpenAPI HTTP denial + schema; authenticated TEST route и OWNER-approved write отдельно. |
| G10 (57–65) | D | P | Q PASS, R/M и S PARTIAL; получить redacted permission/denial evidence клиентов без Google mutation ради скриншота. |
| 0.01 (71–76) | D | P | Owned PAUSED Search + отдельный budget: стратегии/сети/dates, provider validation и отдельные reversible proofs. |
| 0.02 (77–79) | D | P | Google geo/language IDs, PRESENCE/radius; READ resolution и validate_only перед bounded edit. |
| 0.03 (80–82) | D | C | Owned campaign с timezone и schedule criterion; provider validate_only, reversible schedule edit. |
| 0.04 (83–85) | D* | B | Owned `WEBPAGE/SIGNUP` action и goal; tag ID/label, consent decision, real successful registration. TEST не даёт serving conversions, поэтому буквальное «уже получает данные» требует отдельного реального разрешённого источника. |
| 0.05 (86–91) | D | L | PAUSED ad group/keywords, match/conflict; уже доказанный bounded Search brief не повторять. |
| 0.06 (92–97) | D | P | Eligible RSA/sitelink/callout/image/logo/business assets; проверить каждый недоказанный тип, policy response и attach/detach. |
| 0.07 (98–103) | D | L | Atomic Search graph + tracking/UTM ограниченно LIVE; новый graph только после отдельного fixture/approval. |
| 0.08 (104–106) | D | L | Search Clone 7/7 уже PASS; неподдержанные компоненты/типы не обобщать. |
| 0.09 (107–113) | D | P | Owned launch checklist и data-receiving goal; policy warnings/ENABLE требуют отдельного решения, не авто-enable. |
| 1.01 (134–148) | D | P | Owned keyword criterion: add/status/match/Final URL; не делать новое destructive delete ради evidence, reversible variants отдельно. |
| 1.02 (149–163) | D | P | Owned negative list/search term/keyword; READ source, provider validate_only, add/remove с inverse. |
| 2.01 (166,170–178) | D | P | Eligible key/group CPC, tCPA и budget currency; shared impact before/after и restore. |
| 2.02 (179–181) | D | P | Campaign с допустимой bidding strategy; provider compatibility для Max Clicks/Conversions, tCPA/tROAS/impression share. |
| 2.03 (182–184) | D | C | Owned TEST portfolio strategy и consumer campaign; create/update/link/reread/inverse. |
| 2.04 (185–187) | D | C | Existing campaign/group device criterion; inherited/local modifier READ, validate_only, inverse. |
| 2.05 (188–190) | D | C | Existing owned geo/schedule criterion; no invented IDs, modifier READ/validate_only/inverse. |
| 2.06 (191–193) | D | C | Real performance data + frozen selection snapshot; TEST serving metrics отсутствуют, нужен разрешённый реальный источник. |
| 3.01 (198–206) | D | P | Eligible owned audience/list; include/exclude, OBSERVATION/TARGETING и bid adjustment отдельно. |
| 3.02 (207–209) | D | C | Eligible custom segment terms/URLs/apps; ownership/policy check, validate_only, inverse if supported. |
| 3.03 (210–212) | D | C | Eligible age/gender/parental/income criterion по account/geo; READ и bounded edits без выдуманных ID. |
| 3.04 (213–215) | D | P | Real Google geo IDs, include/exclude/radius/presence; ранее J не доказывает все комбинации. |
| 3.05 (216–225) | D | C | Existing language/schedule/device criteria, timezone; incremental single-criterion changes and inverse. |
| 4.01 (230–238) | D | P | Owned RSA и policy review; недоказанные text/status edits, remove без повторного destructive LIVE. |
| 4.02 (239–241) | D | C | Eligible text/call/business/image/logo asset IDs; source media hashes, create/attach/detach/reread/inverse. |
| 4.03 (242–243) | D | C | Owned account/campaign/group tracking template/suffix, link audit, set/clear and restore. |
| 4.04 (244) | D | C | READ-only real URL/UTM audit before/after approved write; локальный mock сравнивает контракт. |
| 4.05 (245–253) | D | P | Owned campaign/group name/status/dates/networks; reversible field-specific edits, PAUSED invariant. |
| 4.06 (254–257) | D | B | **Шесть отдельных PMax профилей ниже**; нет parent/asset group и части eligible ресурсов, gate не deployed. |
| OPS (25,328,330–336) | D | P | TEST MCC/developer token/API version, owner/approvers и production release gate; текущий v24 при release перепроверить. |

### PMax: шесть независимых профилей 4.06

Сначала READ self conversion customer, action/goal, landing `https://mcp.holymedia.kz/`, owned media SHA/proportions, Алматы Google geo ID и language ID; затем provider `validate_only` атомарного PAUSED fixture с USD 2/day и допустимой bidding strategy. Campaign и asset group остаются PAUSED. Не создавать фиктивные регистрации/метрики. После отдельного OWNER approval — один fixture commit, provider reread, затем каждый edit получает собственный preview/approval/restore. Existing typed builders и default-OFF TEST gates находятся в [`apps/api/src/mcp`](../../apps/api/src/mcp/) и [`apps/api/src/providers`](../../apps/api/src/providers/).

| Профиль | Нужен настоящий Google ресурс | Подготовленная проверка и ограничение |
|---|---|---|
| Asset groups | PAUSED PMax campaign + asset group IDs | add/remove/replace/restore only owned group, exact parent binding, reread. |
| Text/images | Owned texts, first-party image/media IDs and eligible asset field types | Hash/aspect/brand/landing check; atomic add/replace/remove, policy validation and inverse. |
| Audience signals | Eligible owned audience/list IDs | READ eligibility; no invented or foreign audience, add/remove/restore. |
| Search themes | Existing group ID and valid bounded themes | Add/remove/replace, provider validate_only and inverse; earlier single edit would not prove all profiles. |
| Negative keywords | Eligible campaign criterion scope and terms | Exact supported PMax criterion; READ/validate_only, add/remove/restore. |
| Brand exclusions | Actual owned BRANDS list ID | READ list ownership/eligibility; no substitute IDs, add/remove/restore only if API accepts. |

## Разделение остатка

- **DONE (локальная программная граница):** 39/39 групп имеют bounded implementation; новый 0.04 пока только безопасная выключенная foundation. Это не означает 39/39 provider-compatible combinations. Макет/CI не равны Google LIVE.
- **PROVIDER READY:** Stage 0–4/PMax typed profiles и ConversionAction gate могут идти к Google READ/`validate_only` только после подходящего TEST runtime и реальных eligible ресурсов. 0.04 дополнительно ждёт tag ID/label и legal consent approval. Исторически лишь 7/39 имеют ограниченный LIVE PASS, 32/39 остаются без полной LIVE-приёмки.
- **OWNER / EXTERNAL:** отдельные browser approvals на каждый commit и restore; действие/цель конверсии; реальная conversion data вне не-serving Google TEST; eligible audience/BRANDS/assets/parent; ChatGPT/Claude permission evidence; Google scopes, developer-token access и release accounts. Эти пункты не исправляются дополнительной RAM.
- **VPS ONLY:** ни одна функциональная группа не является логически исключительно VPS-задачей. Текущий VPS блокирует **конкретный способ** развернуть свежий TEST API/Web: последняя попытка после maintenance PASS пересекла PSI при запуске API; точная причина stall UNKNOWN. Без смены условий повторять cutover нельзя. CI/disposable localhost могут закрывать mock/integration, но не заменяют действующий HTTPS Google/OWNER LIVE. Изолированный ПК является бесплатным кандидатом, пока не запущен и не получил отдельный HTTPS/secret plan.

## ПК и следующий физический шаг

Read-only снимок ПК: 32 678 MiB RAM, 19 512 MiB свободно; AMD Ryzen 5 3600X, 6 ядер/12 потоков; C: 584,7 GiB свободно. `wsl.exe` присутствует, но `wsl -l` возвращает отсутствие дистрибутива; Docker CLI/Engine отсутствует. Код и CI можно продолжать без установки. Для настоящего автономного локального четырёхсервисного smoke требуется отдельное разрешение владельца на установку WSL2/контейнерного runtime (и возможную перезагрузку). Публичные порты, OAuth callbacks, `mcp-test.holymedia.kz` и секреты от VPS в этот этап не входят.

Владелец решил пока не устанавливать WSL2/контейнерный runtime. Поэтому Compose-конфигурация и её CI проверка готовы, но локальный четырёхсервисный запуск на ПК отложен; этот выбор не блокирует уже выполненные Linux CI проверки. Когда потребуется дальнейшая автономная локальная приёмка, единственное системное действие — отдельное разрешение на бесплатный WSL2/контейнерный runtime. Решение о TEST HTTPS ingress, TEST-only OAuth и Google approvals останется отдельным.

## Официальные внешние ограничения

- [Google Ads website conversion tag](https://developers.google.com/tag-platform/devguides/conversions): Google Ads event использует `gtag('event', 'conversion', {send_to: 'AW-…/label'})`; tag ID и label должны соответствовать конкретному action. Код не отправляет GA4 `sign_up` как замену Ads conversion.
- [Basic consent mode](https://developers.google.com/tag-platform/security/guides/consent?consentmode=basic): tag не загружается до согласия. Текущее решение реализует именно этот fail-closed режим; окончательный текст согласия/Privacy Policy требует решения владельца до включения.
- [Google Ads TEST accounts](https://developers.google.com/google-ads/api/docs/best-practices/test-accounts): TEST account пригоден для API проверки, но не обслуживает объявления и не создаёт настоящие serving metrics/conversions.
- [PMax asset requirements](https://developers.google.com/google-ads/api/performance-max/asset-requirements), [atomic operation graph](https://developers.google.com/google-ads/api/performance-max/structure-requests), [asset group signals](https://developers.google.com/google-ads/api/performance-max/asset-group-signals), [negative keywords and brand exclusions](https://developers.google.com/google-ads/api/performance-max/create-campaign-criteria): eligible resources и campaign scope проверяются по настоящему owned аккаунту; отсутствие таких ресурсов в TEST не является запретом API.

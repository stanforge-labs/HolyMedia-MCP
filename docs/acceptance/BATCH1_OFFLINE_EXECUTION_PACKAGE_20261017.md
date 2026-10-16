# Batch 1 — локальное закрытие кода и пакет следующей приёмки

**Дата:** 17.10.2026. **Режим:** только локальная работа и GitHub CI. Этот документ дополняет [первоначальную матрицу 39 групп](FINAL_ORIGINAL_TZ_GAP_AUDIT.md); её исторические LIVE статусы не повышаются локальными тестами. Кодовый SHA, Linux CI и digest образов приведены в финальном evidence ниже.

## Дельта кода

- [TEST-only PMax gate](../../apps/api/src/providers/google-ads-pmax-test-gate.ts) и [конфигурация](../../packages/config/src/index.ts): one-item/one-account `8590146099`, exact TEST origin, API v24, default OFF, общий confirmed/Public/Stage 2–4 write OFF и mutually exclusive ConversionAction gate. Добавлены ограниченные `pmax_asset_group_create`, `pmax_asset_detach`, `pmax_asset_replace`, `pmax_campaign_asset_detach`, `pmax_campaign_asset_replace`, `pmax_negative_remove`, `pmax_brand_remove`. Существующие theme/audience add/remove, asset attach, negative/brand add и name update сохранены. Новые удаление/замена требуют `acknowledge_irreversible`, точные parent/resource/field bindings, неизменяемый preview, отдельный browser approval и проверку provider snapshot в preview service и adapter. Restore выполняется **новым** approved inverse preview, не автоматическим cleanup.
- `pmax_create` в том же gate теперь требует HolyPilot, `https://mcp.holymedia.kz/`, USD 2/day, MAXIMIZE_CONVERSIONS без выдуманного tCPA/ROAS, один conversion action и по одному provider-confirmed geo/language ID из TEST config. Campaign/asset group остаются PAUSED; сопутствующие associations могут быть ENABLED только под ними. Новая отдельная полная группа допускается лишь под PAUSED owned parent с существующими brand assets и ссылками на owned IMAGE assets. Никакой generic/public/production write не открыт.
- [Локальный медиагенератор](../../scripts/pmax-firstparty-media.mjs) теперь использует **официальный** `apps/web/public/assets/brand/holy-pilot-symbol.svg`, имя HolyPilot и утверждённый русский слоган. Старый агентский media pack не используется. Новый пакет сохранён **вне Git**: `C:\Users\geros\Проекты Codex\HolyPilot-Batch1-Media-20261017-v2`. Он декодирован Sharp и принят реальным `validateInlineMedia`; визуально проверено, что знак виден на светлом фоне. Это не Google upload/approval.
- [Тест границы регистрации](../../apps/api/src/auth/signup-conversion-boundary.test.ts) проверяет успешный `signup` только после транзакции user/workspace/OWNER membership, подготовки verification и session; при ошибке session успешный audit не появляется. Работающий restricted TEST по-прежнему блокирует signup. **Google tag, действительный `sign_up` delivery, ConversionAction и conversion metrics не созданы.** Успешный внутренний audit `signup` не выдаётся за измеренную Google conversion.
- Сохранён **отдельный** Web-only брендовый пакет `codex/holypilot-brand-only@fa9805b0adeed1b225e34605b02ad0b67d5ebc33`. В нём меняются только блоки header/footer публичной главной: оригинальный знак, HolyPilot, RU/EN слоганы; Astana Hub, hero, тарифы, auth/OAuth и другие страницы остаются исходными. [Design preservation CI](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38944455196) и [Web-only image/smoke CI](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38943970037) — SUCCESS на этом exact SHA. Web image `sha256:1c39775ffbb095cc7d9037dfbea874be146ad25fe88ce255eaa794b0ccfd9ec0`; Web smoke запускается **без API/Worker**. Ветку не сливать целиком в API-ветку: она содержит отдельную сохранённую product baseline. Production Web не опубликован.
- Web image имеет **592 583 759 B uncompressed** по тому же CI. Это размер image, а не обещание соответствующего объёма RAM. Существующие startup memory guards сохраняются.

### Реальный локальный медиапакет

| Роль | Файл | Размер / геометрия | SHA-256 входного файла |
|---|---|---|---|
| MARKETING_IMAGE | `holypilot-landscape.jpg` | 40 567 B; 1200×628 | `ddfd66288347e9a368908e644696753f2fba095710749657000dff18ff36db84` |
| SQUARE_MARKETING_IMAGE | `holypilot-square.png` | 21 867 B; 1200×1200 | `e7125872573295b7f97e5759535b7b5e8cfd62639364494bb1c6cccdd92d4021` |
| Campaign LOGO | `holypilot-logo.png` | 44 332 B; 1200×1200, transparent | `39c61b0dc0613a07bd45a891a4818b29f51477f388f18fbe5310286a217b937e` |

Итого 106 766 B. Исходный SVG SHA-256: `5ba14c84e7d56b4b7bd41ffbba64400cdd766cbe9ec141c192a0079aec5b83ce`. Никакой файл не загружен в Google. До будущего JIT preview владелец должен утвердить конкретные рекламные изображения/копию и проверить права на бренд; Google policy acceptance остаётся внешним.

## Матрица 39 групп после Batch 1

Здесь «код» означает реализованную и локально проверенную границу, **не** provider LIVE. Следующий proof наследует подробное условие из [основной матрицы](FINAL_ORIGINAL_TZ_GAP_AUDIT.md). `LIVE` обозначает уже существующее ограниченное доказательство и не расширяется этим batch.

| ID | Код после Batch 1 | Оставшийся proof / blocker |
|---|---|---|
| G01 | Existing preview/commit повторно покрыт PMax gate | Каждый новый Google профиль — отдельные validate/approval/reread |
| G02 | Exact TEST owner/account/origin gates сохранены | Production allowlist/MCC — отдельное решение |
| G03 | Existing batch/per-row результат неизменён | Новые профили сверить provider; не смешивать local error с partial failure |
| G04 | Remove/replace snapshot и отдельный inverse gate усилены | LIVE inverse для новых типов; без destructive повторов |
| G05 | Existing currency/micros/threshold код без изменений | Provider variants/approval |
| G06 | PMax fixture gate ограничен PAUSED + USD 2/day | Action/goal, Google fixture commit/reread |
| G07 | Existing typed MCP schemas/annotations без изменений | Client-side permission prompts Q/R/S |
| G08 | Existing OAuth S256/tenant isolation без изменений | Production grant отдельно |
| G09 | Existing REST/OpenAPI 3.1 без изменений | Независимый TEST REST LIVE auth/approval |
| G10 | Existing Q PASS и R/S границы без изменений | Redacted Claude R/M и оба S client prompts |
| 0.01 | Existing PAUSED Search/budget builder | Provider variants strategy/dates/networks |
| 0.02 | Existing geo/language/presence/radius builder | Geo ID/positive radius и alias provider proof |
| 0.03 | Existing schedule/timezone validator | Reversible TEST LIVE |
| 0.04 | ConversionAction gate и truthful signup boundary подтверждены локально | Action/goal отсутствуют; настоящий tracking и real conversion data — external |
| 0.05 | Existing ad groups/keywords conflict checks | Нет нового proof сверх T/U |
| 0.06 | Existing RSA/assets typed code | Owned eligible media и остальные asset type LIVE |
| 0.07 | Existing UTM/atomic Search graph | Новые graph типы отдельно |
| 0.08 | Existing bounded Search Clone 7/7 | Generic clone не заявлять |
| 0.09 | Existing launch checklist/enable step | Receiving-data goal и policy review |
| 1.01 | Existing keyword create/status/match/URL code | Не доказанные reversible profiles; delete не повторять |
| 1.02 | Existing negative/list/term profiles | Eligible term/shared list и approved LIVE |
| 2.01 | Existing CPC/tCPA/budget/shared-impact code | Provider campaign/currency variants |
| 2.02 | Existing strategy profiles | Eligible provider strategies и reversible LIVE |
| 2.03 | Existing portfolio create/update/link code | Owned TEST portfolio/consumer |
| 2.04 | Existing device modifiers code | Допустимые parent/strategy combinations LIVE |
| 2.05 | Existing geo/schedule modifier code | Owned criteria и reversible LIVE |
| 2.06 | Existing filtered snapshot code | Настоящие performance metrics; TEST serving data пусты |
| 3.01 | Existing include/exclude/OBS/TARGETING code | Eligible owned lists/interests и LIVE |
| 3.02 | Existing custom audience code | Owned segment/policy eligibility |
| 3.03 | Existing demographics code | Account/geo availability и LIVE |
| 3.04 | Existing geo include/exclude/radius/presence code | Остальные location profiles LIVE |
| 3.05 | Existing languages/schedule/devices code | Provider resource constraints и LIVE |
| 4.01 | Existing RSA create/edit/status code | Остальные reversible edits; delete не повторять |
| 4.02 | Existing asset create/attach/detach code | Owned assets и live link proofs |
| 4.03 | Existing tracking template/suffix code | Уровни account/group и restore LIVE |
| 4.04 | Existing tracking READ-аудит code | Реальный independent before/after comparison |
| 4.05 | Existing campaign/group update code | Не доказанные fields и restores |
| 4.06 | **Расширены bounded PMax add/remove/replace/restore gates и brand media** | TEST API ещё прежний, нет action/goal/parent/assets; все шесть editing profiles ждут provider |
| OPS | API v24/CI contract сохранён | Developer-token access, owner release и production flags OFF |

**Итог матрицы:** исторические 7/39 ограниченных LIVE PASS и 20/20 именованных сценариев неизменны. Остальные 32 группы ещё требуют provider/клиентских/внешних доказательств; ни один local test не поднят до LIVE. Из новых локальных изменений основная функциональная дельта относится к G04, G06, 0.04, 4.06. Никаких новых рекламных mutations.

## Внешние prerequisites до Batch 2/3

| Ресурс или решение | Что проверено локально | Что остаётся внешним |
|---|---|---|
| TEST owner/OAuth/customer/developer token | Конфиг и guards строго замкнуты на `8590146099`; ранее Google подтвердил self conversion customer и WEBPAGE/SIGNUP validate_only | Fresh authorized provider READ после истечения TEST token; действительные scopes/developer-token access и ownership. Секреты не выносятся в CI. |
| ConversionAction/goal/`sign_up` | Конфигурация и mock; success-only смысл регистрации в сервисе, отдельный approval | Google action/goal не созданы; Google delivery/tag и реальные события не реализованы. TEST закрывает signup и не даёт serving conversion metrics. Для буквального §85 нужен разрешённый реальный ресурс с genuine data; владелец должен отдельно утвердить measurement design и доступ. |
| PMax parent и bidding | Атомарный PAUSED graph и default-off gate; USD 2/day/MAXIMIZE_CONVERSIONS ограничены | Нужны verified action/goal, аккаунтная пригодность стратегии, свежий provider validate_only и отдельное owner approval/commit. |
| География/язык | Конфиг требует exact IDs; mock использует фиктивные `100/1031` | Google READ должен подтвердить **реальный** geo ID Алматы и русский language ID. Mock IDs не переносить в protected config. |
| IMAGE assets/brand/landing | Официальный local SVG/три декодированных файла/хеши; product URL кандидат | Google-owned asset IDs, policy review, доступность и согласованная brand identity в действующем Web. HolyPilot patch production ещё не опубликован. |
| Audience/BRANDS | Typed gates проверяют owned ID, статус/тип `BRANDS` | Настоящие eligible audience/shared set IDs отсутствуют в сохранённом TEST inventory; нельзя подставлять вымышленные или чужие. |
| Q/R/S | Server-side policy/schema и прежнее Q LIVE | Реальные redacted client permission prompts и Claude R/M отправка; без новых Google writes ради скриншотов. |

[Google test-account limitations](https://developers.google.com/google-ads/api/docs/best-practices/test-accounts) означают, что TEST не создаст serving conversion/CPA data. [Google PMax criteria](https://developers.google.com/google-ads/api/performance-max/create-campaign-criteria) поддерживают negative keyword и brand exclusion, если реальный аккаунт/ресурс eligible. Отсутствие BRANDS list — не API unsupported.

## Deployment package и стоп-точки (не исполнялись)

1. Exact API source SHA и immutable digest/size из Linux CI — см. evidence ниже. До TEST cutover: fresh OAuth/owner, 0 pending/approved/in-flight, protected backup DB/Redis и прежнего image/config, достаточный disk после pull, полный RAM/swap/PSI/OOM/health guard, production latency PASS. TEST Web и API — **отдельные** разрешения и попытки, один API instance. Ошибка → один rollback, без повтора.
2. ConversionAction и PMax gates взаимоисключающие: один API image может содержать оба, но каждый protected config activation/restart имеет свой resource guard. Production/Public/general confirmed writes остаются OFF. Никакой config из CI не несёт vault/OAuth.
3. После Batch 2: fresh Google READ → `validate_only` → JIT immutable preview с BEFORE/AFTER и TTL → отдельный human OWNER browser approval и явное owner разрешение для **каждого** commit. Один commit → provider reread/action+goals/PAUSED invariant/audit. Любой ambiguous response → только READ reconciliation. Для обратимого изменения restore имеет свой preview и approval; creation и удаление не auto-cleanup.
4. Web image — отдельный уже проверенный брендовый SHA/digest выше. Его production release не включён в Batch 2, требует отдельного решения владельца и отдельного guarded окна; две прошлые попытки откатились после swap. Main/production/TEST в Batch 1 не изменялись.

## Exact-source CI и образы

Функциональный commit: `ff30cb4b1b42b69daa3e971b79c0c00febc5b74f`. Финальный exact-source CI/image commit: `e5216c8f66a5e6b9c8afd1290b221accff069f41` (`codex/qrs-test-auth-recovery`); второй commit исправляет только disposable Compose origin и его CI assertion.

| Проверка | Evidence | Результат |
|---|---|---|
| Foundation Linux, PostgreSQL 18/Redis, migration, backup/restore, OAuth/approval, full tests, build, secrets, dependency audit | [run 38955503844](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38955503844) | **PASS**; 108/108 test files, 0 skipped; format/lint/typecheck/build/migrations/security PASS |
| Stage 2–4 isolated API image regression | [run 38955504096](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38955504096) | **PASS** |
| API-only immutable image build and disposable PostgreSQL/Redis smoke | [run 38955503851](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38955503851) | **PASS**; digest `sha256:68d718998795dd6a0d6229fda0d747c0cb503dbd625d772542b1edacaf48a76f`; exact revision label, non-root/content checks, `/health`, `/ready`, MCP 401 without auth, Prisma status, authenticated MCP initialize/tools/list |
| Локально Windows | Тот же code tree до commit | Format/lint/typecheck/build/Prisma/secrets/dependency audit PASS; API 1496 passed, 22 skipped, 100 test files passed, 8 skipped. Локальные skips заменены полным Linux evidence выше. |

API image: 216 261 529 B compressed, 705 008 360 B uncompressed. Его pull поверх сохранённого baseline image использовал дополнительно **812 802 048 B (0,757 GiB)** на GitHub runner; shared compressed layers 0. На VPS фактический расход диска будет проверен свежим preflight после pull, при сохранении старого image/rollback. Предыдущий [image smoke run 38954196930](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38954196930) отклонил CI-only `NODE_ENV=production` + localhost HTTP origin; `e5216c8` добавил canonical HTTPS origin только в disposable Compose, не меняя production/TEST конфигурацию или runtime. Финальный smoke PASS. Prisma в контейнере выдаёт предупреждение о нераспознанном OpenSSL, однако миграции и `prisma:status` завершились успешно; это остаётся явным диагностическим наблюдением, а не основанием снижать release guards.

**Batch 1 offline PASS** для точного API SHA выше и отдельного Web SHA. Ни один образ не развернут на VPS, ни один Google объект не изменён. Наличие immutable image и Linux CI не доказывает память/latency существующего VPS и не отменяет отдельное owner разрешение для Batch 2.

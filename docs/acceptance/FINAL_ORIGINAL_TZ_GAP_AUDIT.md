# Финальная ревизия исходного Google Ads Write ТЗ

**Срез:** 16.10.2026, read-only. Проверенный кодовый baseline ветки `codex/qrs-test-auth-recovery` — `651e7a40f313869040cfe9db08480f7958b3f36b` (до документационного commit); независимый Web patch `codex/holypilot-brand-only` — `fa9805b0adeed1b225e34605b02ad0b67d5ebc33`. Это аудит, а не выпуск или разрешение на запись. Исходник — [извлечение 336 абзацев](../../artifacts/google-full-scope/original-tz-source-20261009.json), SHA-256 исходного DOCX `51C94D3D2953B32821DC872822147B1FF6C28E36258211D9DDD916BFF2C30DB0`; номера ниже — номера абзацев, не страницы. За основу нормализации взят [реестр 62 строк от 09.10](../../artifacts/google-full-scope/requirements-matrix-20261009.json), затем каждая строка пересверена с кодом и поздним evidence. Его старые статусы не перенесены автоматически.

## Правило подсчёта и достоверность

Из 62 строк исходного реестра **38** описывают обязательные функциональные группы, **20** — отдельные приёмочные сценарии, **1** — операционные условия перед выпуском. Ещё 3 строки являются расширением вне исходного ТЗ, пояснением API либо дублем и исключены из знаменателя. Итого **39 обязательных групп и 20 проверок**, а не 59 независимых функций. При строгом критерии «весь заявленный профиль имеет LIVE-доказательство» лишь **7 из 39** групп имеют ограниченный LIVE PASS, **32 из 39** остаются PARTIAL/CODE ONLY/BLOCKED; все **20 из 20** именованных рекламных проверок имеют исторический LIVE PASS. Эти числа характеризуют реестр, **не процент завершения всего ТЗ**: строки неодинаковы по размеру, §4 открыто требует «всё» в интерфейсе, а поддержка зависит от типа кампании, API и реальных ресурсов. Вычислять один процент как `20/20` или `7/39` было бы вводящим в заблуждение.

**Статусы:** LIVE PASS — реально проверенный ограниченный профиль с provider reread; PARTIAL — часть требований/профилей доказана; CODE ONLY — код и локальные/CI тесты, без нужной LIVE-приёмки; VALIDATE ONLY — Google проверил конфигурацию без записи; BLOCKED — обязательная LIVE-проверка упирается в указанное условие; NOT IMPLEMENTED — реализации нет. В таблице трудоёмкость — грубая инженерная оценка *остатка* (`S` до 0,5 дня, `M` 1–2 дня, `L` 3–5 дней, `?` внешнее ожидание) без учёта времени согласования; `О` — отдельное разрешение владельца на mutation/deploy; `G` — нужен реальный Google API/ресурс. Для CODE ONLY уже выполненный код не превращается в LIVE PASS из-за тестов.

Ссылки на проверенный код: [C](../../apps/api/src/mcp/mcp-preview.service.ts) — immutable preview/approval; [W](../../apps/api/src/providers/google-ads-write.ts) — mutate/verify; [C0](../../apps/api/src/providers/google-ads-stage0.ts), [C1](../../apps/api/src/providers/google-ads-stage1.ts), [C2](../../apps/api/src/providers/google-ads-stage2-advanced.ts), [C3](../../apps/api/src/providers/google-ads-stage3.ts), [C4](../../apps/api/src/providers/google-ads-stage4.ts), [P](../../apps/api/src/providers/google-ads-pmax.ts) и [PG](../../apps/api/src/providers/google-ads-pmax-test-gate.ts), [CG](../../apps/api/src/providers/google-ads-conversion-test-gate.ts), [M](../../apps/api/src/mcp/google-write-client-contract.ts), [O](../../apps/api/src/mcp/oauth-authorization.service.ts). Доказательства: [E20](google-ads-lettered-closeout-20261013.md), [EClone](clone-live-verified-20261015.md), [EQRS](qrs-two-client-closeout-20261015.md), [EPMax](HOLYMEDIA_GOOGLE_ADS_FINAL_ACCEPTANCE.md), [EConv](pmax-test-conversion-readiness-20261015.md). Текущий точный SHA прошёл [Linux foundation CI 38907042924](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38907042924) и [API image CI 38907043086](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38907043086): foundation включает 1513 API тестов без пропусков, format/lint/typecheck/build, Prisma, секреты и dependency audit. Образ API `sha256:d86773bb2b4e85faee2b273115459e07f7d85cf7d12f92379257f8d49eb1dcea` **не работает на TEST**.

## Матрица 39 обязательных групп

| ID / §§ | Требование и фактическая реализация | Доказательство / статус | Что осталось, почему, действие; труд / О / G |
|---|---|---|---|
| G01 · 27–31 | `[C] [W]` Provider preview, `validate_only`, BEFORE/AFTER, TTL, stale check, отдельный approval, одноразовый commit. | E20 A/B/O, EQRS Q/R — **LIVE PASS** в этих профилях. | Новые профили проходят ту же цепь; S / да / да. |
| G02 · 37,42 | `[C] [O]` Workspace, scope, allowlist и `login-customer-id`; production write OFF. | E20 P, EQRS — **LIVE PASS** для TEST. | Список production аккаунтов и MCC права утвердить до release; ? / да / да. |
| G03 · 32,41 | `[W] [C1]` Пачка до 500, per-row исход и русская ошибка с provider/local кодом. | E20 C и EQRS: 19 Google applied + 1 HolyMedia `snapshot_read` rejection — **LIVE PASS** буквального C. | Не выдавать местную ошибку за Google partial failure; S / нет / нет. |
| G04 · 34,38–39 | `[C] [W]` Журнал кто/когда/до/после, необратимое удаление и rollback через новый preview. | E20 B/M/N, EQRS restores — **PARTIAL**: реальные обратимые инверсии доказаны, не каждый тип. | Проверить новые обратимые операции/фильтры журнала; без повторного удаления; M / да для новых commits / да. |
| G05 · 35,40 | `[C2]` Валюта аккаунта, micros, округление и предупреждение >50%. | E20 H/N, code tests — **PARTIAL** по типам валют и ставкам. | Полные комбинации не доказаны provider; безопасный bounded profile; M / да / да. |
| G06 · 36 | `[C0] [P]` Новые Search и PMax сущности PAUSED, включение отдельно. | E20 T/W и EClone — **PARTIAL**: PMax ещё нет. | PMax fixture с PAUSED reread; M / да / да. |
| G07 · 44–45,47–52 | `[M]` Streamable HTTP, typed schemas, описания, аннотации, профили, `structuredContent`. | EQRS Q/R tool use + тесты — **PARTIAL**: client-side prompts отдельно не доказаны. | Сохранить реальные клиентские prompt/response evidence; S / пользовательские действия / клиенты. |
| G08 · 46 | `[O]` Индивидуальный OAuth S256, READ/WRITE grant, owner/workspace в аудите. | EQRS: разные ChatGPT/Claude grant и реальные вызовы — **LIVE PASS** для TEST. | Production grant и release отдельно; ? / да / внешнее. |
| G09 · 53 | `[M]` Защищённый REST fallback и OpenAPI 3.1 присутствуют в коде. | `google-write-client-contract.test.ts`, без независимой реальной REST-приёмки — **CODE ONLY**. | Проверить auth/scope/approval через REST на TEST, OpenAPI на действующем endpoint; M / да если commit / да. |
| G10 · 57–65 | Q ChatGPT, R второй клиент, S client permission + HolyMedia approval. | EQRS: **PARTIAL**; Q PASS, R/M и S частичны. | R/M не дошёл до серверного denial; S не имеет сохранённых prompts обоих клиентов. Получить существующие redacted UI/transcripts; не мутировать Google ради скриншота; S–M / нет, пока read-only / клиенты. |
| 0.01 · 71–76 | `[C0]` Дневной отдельный бюджет и PAUSED Search: имя, стратегия, даты, сети. | E20 T и EClone — **PARTIAL** полного набора полей. | Не все допустимые стратегии/сети проходили LIVE; M / да / да. |
| 0.02 · 77–79 | `[C0]` Гео по имени, языки, PRESENCE и радиус. | E20 T/J, EClone — **PARTIAL** для полного набора. | Отдельный provider profile для позитивного радиуса/алиасов; M / да / да. |
| 0.03 · 80–82 | `[C0]` Необязательное расписание и timezone validation. | Код/mock — **CODE ONLY**. | `validate_only` и обратимая LIVE-проверка при eligible TEST fixture; M / да / да. |
| 0.04 · 83–85 | `[C0] [CG]` Выбор целей: action должна существовать и уже получать данные. | E20 V выявил отсутствие; EConv `WEBPAGE/SIGNUP` **VALIDATE ONLY**, но сама группа **BLOCKED**. | Нет action/goal и реальных событий; создать по approval, проверить goal и честное `sign_up` measurement. TEST аккаунт не даёт serving conversions; для условия «получает данные» нужен подходящий существующий реальный ресурс; L+? / да / да+внешнее. |
| 0.05 · 86–91 | `[C0] [C1]` PAUSED группы/ключи, match type, conflicts. | E20 T/U — **LIVE PASS** ограниченного Search brief. | Новые combinations — отдельный профиль, не повторять T; S / да / да. |
| 0.06 · 92–97 | `[C0] [C4]` RSA поля 30/90/15, sitelinks/callouts/structured/call/image/logo/business assets. | E20 T/U/K/L только подмножество — **PARTIAL**. | Отдельные asset type/eligibility/review proofs; M–L / да / да+assets. |
| 0.07 · 98–103 | `[C0]` UTM/tracking и atomic temporary-ID brief. | E20 T/U — **LIVE PASS** для принятого Search graph. | Новые типы graph требуют новых профилей; S / да / да. |
| 0.08 · 104–106 | `[C0]` Клон с новым именем, гео, бюджетом. | EClone: один owner-approved 7/7 commit, PAUSED Search/RSA destination `24364218181`, source без изменений — **LIVE PASS** только этого профиля. | Другие типы/неподдержанные source-компоненты явно отклоняются; не объявлять универсальным clone; M–L если требовать расширение / да / да. |
| 0.09 · 107–113 | `[C0]` Launch checklist, URL, цель и policy warnings, отдельное включение. | E20 V/W — **PARTIAL**: missing goal и enable/restore доказаны. | Условие data-receiving goal и медицинские policy warnings не проверены на реальном eligible brief; M+? / да / да+внешнее. |
| 1.01 · 134–148 | `[C1]` Ключи: статус, создание, match replacement, URL, REMOVED guard. | E20 A/B/F/M/O — **PARTIAL** по всей совокупности (M — отказ, не удаление). | Final URL и все варианты не LIVE; irreversible удаление не повторять ради доказательства; M / да для безопасных edits / да. |
| 1.02 · 149–163 | `[C1]` Campaign/group negatives, shared lists, term→negative/keyword. | E20 D/E — **PARTIAL**: другие уровни и term→keyword не доказаны LIVE. | Eligible term/список, provider validation и approved reversible edits; M–L / да / да. |
| 2.01 · 166,170–178 | `[C2]` CPC ключа/группы, target CPA, бюджет и shared impact. | E20 G/H/N — **PARTIAL**: shared предупреждение доказано, часть ставок только mock. | Оставшиеся типы CPC/tCPA и currency variants; M / да / да. |
| 2.02 · 179–181 | `[C2]` Manual CPC, Max Clicks/Conversions, tCPA/tROAS/impression-share поля. | E20 G ограниченно; остальные code/mock — **PARTIAL**. | Provider eligibility и reversible LIVE для недоказанных стратегий; L / да / да+eligible campaign. |
| 2.03 · 182–184 | `[C2]` Portfolio create/update/link. | Код/mock — **CODE ONLY**. | Нужен реальный TEST portfolio и consumers; M–L / да / да+ресурс. |
| 2.04 · 185–187 | `[C2]` Device bid modifiers campaign/group, inherited/local. | Код/mock — **CODE ONLY**. | Provider validation каждого допустимого профиля и restore; M / да / да. |
| 2.05 · 188–190 | `[C2]` Geo/schedule modifiers на существующих критериях. | Код/mock — **CODE ONLY**. | Реальные owned критерии и reversible check; M / да / да. |
| 2.06 · 191–193 | `[C2]` Фильтрованные пачки по performance-срезу. | Код/mock — **CODE ONLY**. | Достоверные метрики/selection snapshot; TEST без serving metrics не доказывает пример CPA; L+? / да / да+реальные данные. |
| 3.01 · 198–206 | `[C3]` Аудитории include/exclude, OBSERVATION/TARGETING, bid modifier, discovery. | E20 I только OBSERVATION add/remove — **PARTIAL**. | Нужны eligible user lists/interests и отдельные безопасные LIVE профили; L+? / да / да+ресурс. |
| 3.02 · 207–209 | `[C3]` Custom audience terms/URL/apps create/update. | Код/mock — **CODE ONLY**. | Настоящий owned segment, политика/eligibility, provider validation; M–L / да / да+ресурс. |
| 3.03 · 210–212 | `[C3]` Демография: возраст/пол/родительство/доход и modifier. | Код/mock — **CODE ONLY**. | Проверить availability по аккаунту/гео и каждый безопасный тип; M–L / да / да. |
| 3.04 · 213–215 | `[C3]` Include/exclude geo, радиус, поиск названия, presence mode. | E20 J — **PARTIAL** для других мест/комбинаций. | Не экстраполировать J на все geo profiles; M / да / да. |
| 3.05 · 216–225 | `[C3]` Языки, timezone schedule, устройства, инкрементальное изменение одного критерия. | Код/mock, часть T/J — **CODE ONLY** для полного профиля. | Ресурсные constraints и отдельные provider reads/edits; L / да / да. |
| 4.01 · 230–238 | `[C4]` RSA create/edit/status/delete, длины/повторная модерация. | E20 K/L — **PARTIAL**: rejection и PAUSED create доказаны. | Остальные edits/статусы; не повторять destructive delete ради evidence; M / да / да. |
| 4.02 · 239–241 | `[C4]` Создать/привязать/отвязать text/call/business/image/logo assets. | Code/mock — **CODE ONLY** как полный набор. | Owned eligible assets, validate-only и частные LIVE proofs; L+? / да / да+ресурс. |
| 4.03 · 242–243 | `[C4]` Account/campaign/group tracking template/suffix set/clear. | Code/mock; T содержит campaign UTM — **CODE ONLY** для полного набора. | Проверить полный уровень, read-link safety, restore; M–L / да / да. |
| 4.04 · 244 | `[C4]` Сверять write с READ-аудитом ссылок/UTM. | Тесты, без полного независимого LIVE audit comparison — **CODE ONLY**. | Сопоставить реальные before/after; S–M / нет для READ / да. |
| 4.05 · 245–253 | `[C4] [C0]` Campaign/group status/name/dates/networks; Search atomic reuse. | E20 T/W, EClone — **PARTIAL** полного набора. | Не доказаны все group/campaign поля и их reversible edits; M–L / да / да. |
| 4.06 · 254–257 | `[P] [PG]` Редактировать существующий PMax: шесть профилей ниже. | EConv/EPMax: code/mock PASS; **BLOCKED**, у TEST нет parent/group. | Развернуть gate безопасно, получить parent и eligible ресурсы, validate_only, отдельные approval/commit/reread/restore; L+? / да / да+ресурс. |
| OPS · 25,328,330–336 | API token/версия, тестовый MCC/campaign, accounts, approvers, порог 50%, поэтапная сдача. | v24 TEST, 20/20; production access/release review не доказан — **PARTIAL**. | Проверить developer-token access/миграцию API, утвердить production accounts/approvers; отдельный release gate; M+? / да / да+внешнее. |

**Проверка арифметики таблицы:** 39 обязательных строк: 7 LIVE PASS, 18 PARTIAL, 12 CODE ONLY, 2 BLOCKED. `VALIDATE ONLY` относится к вложенной ConversionAction конфигурации в строке 0.04, а не к готовности цели. Строка PMax создания из [старого реестра](../../artifacts/google-full-scope/requirements-matrix-20261009.json) не включена: §257 требует *редактирование* существующей кампании; создание PAUSED fixture — последующий вспомогательный запрос владельца. API-boundary строка о match type уже включена в 1.01. Arbitrary retail, Customer Match uploads и иные дополнения не являются требованием оригинала.

### Профили внутри крупных строк — без повторного подсчёта

Следующая декомпозиция делает каждый названный исходным ТЗ вид операции проверяемым. Код, evidence, причина, effort, owner/provider gate и rollback наследуются из указанной строки основной матрицы; статус здесь относится **только** к конкретному под-профилю. Это дочерние пункты, не добавляемые к 39 группам и 20 сценариям.

| Родитель / §§ | Атомарный профиль из исходного ТЗ | Уровень доказательства и конкретный следующий proof |
|---|---|---|
| G04 · 34 | REMOVED с необратимым предупреждением | **PARTIAL**: отказ без approval LIVE; реальное удаление специально не повторять. |
| G04 · 38 | Журнал с actor/account/object/before/after/result и фильтрами | **PARTIAL**: commit audit LIVE; фильтры не полностью приняты LIVE. |
| G04 · 39 | Новый approved preview для rollback статуса/ставки/бюджета/URL | **PARTIAL**: status/bid restore LIVE, все типы инверсии отдельно. |
| G05 · 35,40 | Валюта, micros, минимальная единица и порог >50% | **PARTIAL**: H/N LIVE, другие валюты/ставки требуют provider. |
| G07 · 47–52 | Схемы, описания, annotations, наборы задач, structuredContent | **PARTIAL**: server contract tested/native tool calls; permission UI — G10/S. |
| G09 · 53 | Аутентифицированный REST/OpenAPI fallback | **CODE ONLY**: отдельный native REST round-trip с теми же guards. |
| G10 · 57–59 | ChatGPT Q A/B/C/M | **LIVE PASS** с сохранённым старым NOT_VERIFIED incident. |
| G10 · 60–62 | Claude R A/B/C/M | **PARTIAL**: A/B/C LIVE; M не дошёл до server refusal. |
| G10 · 63–65 | S: permission обоих клиентов + server approval | **PARTIAL**: server approval доказан, client prompts обоих не сохранены. |
| 0.01 · 71–76 | Бюджет, PAUSED Search name/bidding/dates/networks | **PARTIAL**: T bounded LIVE, остальные допустимые поля provider validate/review. |
| 0.02 · 77–79 | Geo по названию + PRESENCE | **PARTIAL**: T/J/Clone subset; вся locale/geo семантика отдельно. |
| 0.02 · 77–79 | Языки и positive proximity | **PARTIAL**: T language LIVE; proximity profile не принят отдельно. |
| 0.03 · 80–82 | Quarter-hour schedule и timezone | **CODE ONLY**: eligible provider validate/restore. |
| 0.04 · 83–85 | ConversionAction существует и принадлежит customer | **VALIDATE ONLY** draft; создать и reread после разрешения. |
| 0.04 · 83–85 | Goal/action уже получает настоящие события | **BLOCKED** на TEST serving data; реальный approved ресурс либо несданный пункт. |
| 0.05 · 86–91 | Группа, positive keyword, match и отрицательный конфликт | **LIVE PASS** T bounded; novel profiles отдельно. |
| 0.06 · 92–94 | RSA text/pin/path/final URL/length | **PARTIAL**: T/U/K/L subset, все pins/paths не доказаны. |
| 0.06 · 95–97 | Sitelink/callout/structured/call/image/logo/business assets | **PARTIAL**: T sitelinks, остальные типы нуждаются в ресурсах. |
| 0.07 · 98–103 | Campaign UTM и atomic temp-ID all-or-nothing | **LIVE PASS** T/U bounded. |
| 0.08 · 104–106 | Search/RSA clone new name/geo/budget | **LIVE PASS** 7/7; другие campaign/source graphs вне доказанного профиля. |
| 0.09 · 107–109 | Checklist campaign/ad policy/URL/goal/data | **PARTIAL**: V missing goal; data/policy/URL полнота не доказана. |
| 0.09 · 110–113 | Separate enable и medical policy warning | **PARTIAL**: W enable/restore LIVE; медицинское предупреждение только при реальном provider input. |
| 1.01 · 134–136 | Пауза/включение ключа, один/пачка | **LIVE PASS** A/B/C bounded. |
| 1.01 · 137–139 | Новый ключ, ставка, URL и duplicate/negative conflict | **PARTIAL**: F/T новый ключ; optional fields/conflicts отдельно. |
| 1.01 · 140–142 | Match replacement = new + pause old | **LIVE PASS** F, не in-place edit. |
| 1.01 · 143–145 | Final URL set/clear | **CODE ONLY** для полного уровня; provider reversible proof. |
| 1.01 · 146–148 | REMOVED only separate confirmed operation | **PARTIAL**: M denial LIVE; Google delete специально не повторять. |
| 1.02 · 149–154 | Campaign/group negatives add/remove, match types | **PARTIAL**: D campaign add; group/remove профили отдельно. |
| 1.02 · 155–157 | Shared list CRUD/member/attach/detach | **PARTIAL**: E exact scenario LIVE; широкие формы не доказаны. |
| 1.02 · 158–163 | Search term → negative / positive keyword | **PARTIAL**: D query negative; term→keyword отдельно. |
| 2.01 · 166,170–175 | Absolute/percent keyword CPC, group CPC/tCPA, auto warning | **PARTIAL**: G/N subset; группа/tCPA и режимы отдельно. |
| 2.01 · 176–178 | Daily/shared budget + impact on consumers | **LIVE PASS** H bounded; другие валюты/совместные случаи отдельно. |
| 2.02 · 179–181 | Все шесть названных стратегий и их target fields | **PARTIAL**: MAXIMIZE_CLICKS/MANUAL_CPC в G, прочие eligibility/provider proof. |
| 2.03 · 182–184 | Portfolio create/update/link | **CODE ONLY**: нужен eligible portfolio/consumers. |
| 2.04 · 185–187 | Campaign и ad-group device modifiers -100…+900% | **CODE ONLY**: supported leaf/restore, inherited context. |
| 2.05 · 188–190 | Existing geo/schedule bid modifier | **CODE ONLY**: owned criteria, provider validate/restore. |
| 2.06 · 191–193 | Frozen filtered bulk по CPA/расходу | **CODE ONLY**: реальные performance data/test account limitation. |
| 3.01 · 198–200 | Audience add/remove/exclude, OBSERVATION/TARGETING | **PARTIAL**: I OBSERVATION LIVE; остальные eligible segments/modes. |
| 3.01 · 201–206 | Audience bid modifier и сегмент по названию | **CODE ONLY** для full profile; provider read/eligible ID. |
| 3.02 · 207–209 | Custom audience keywords/URLs/apps | **CODE ONLY**: genuine owned resources/policy. |
| 3.03 · 210–212 | Age/gender/parent/income include/exclude/modifier | **CODE ONLY**: availability/provider proof per criterion. |
| 3.04 · 213–215 | Geo include/exclude/radius/name/presence | **PARTIAL**: J LIVE bounded; остальные mode combinations. |
| 3.05 · 216–218 | Языки | **PARTIAL**: T language subset; aliases/updates отдельно. |
| 3.05 · 219–225 | Schedule timezone/device -100 и incremental criterion | **CODE ONLY** full profile; provider validate/restore. |
| 4.01 · 230–232 | RSA create и длины 30/90/15 | **LIVE PASS** K/L bounded. |
| 4.01 · 233–238 | RSA edit, повторная модерация, status, protected remove | **CODE ONLY/PARTIAL**: нужны безопасные edits; destructive delete не воспроизводить. |
| 4.02 · 239–241 | Каждый asset type create/link/unlink на нужном уровне | **CODE ONLY** full profile; genuine media/owner resources. |
| 4.03–04 · 242–244 | Account/campaign/group UTM set/clear + READ audit | **CODE ONLY** full profile; T campaign UTM subset, остальные проверять. |
| 4.05 · 245–253 | Campaign/group status/name/dates/networks и Search graph reuse | **PARTIAL**: T/W/Clone subset, прочие поля без LIVE. |
| 4.06 · 254–257 | PMax asset groups/text/image/audience/themes/negative/brand | **BLOCKED**; шесть отдельных proof перечислены ниже. |

## PMax — шесть отдельных обязательных доказательств §§254–257

| Профиль | Код и последнее доказательство | Текущий уровень | Точный остаток |
|---|---|---|---|
| Asset groups | `[P] [PG]` create/update; default-OFF exact parent gate, mock PASS | **CODE ONLY; LIVE BLOCKED** | PAUSED owned parent/group, provider validate-only, owner-approved edit и отдельный restore. |
| Текст и изображения | `[P] [PG]` typed attach/replace, media checks; локальный first-party pack | **CODE ONLY; LIVE BLOCKED** | Утвердить HolyPilot brand/copy, реальные Google IMAGE assets и link; replacement не покрыт узким TEST gate. |
| Audience signals | `[P] [PG]` exact owned audience add | **CODE ONLY; LIVE BLOCKED** | Получить настоящий eligible TEST audience; не придумывать ID. |
| Search themes | `[P] [PG]` add/remove pair | **CODE ONLY; LIVE BLOCKED** | Parent/group ID, validate-only, отдельные approvals для add и remove. |
| Negative keywords | `[P] [PG]` v24 add/remove; узкий exact-term add gate | **CODE ONLY; LIVE BLOCKED** | Provider proof add/restore; removal не открыт узким gate. Это не «API unsupported». |
| Brand exclusions | `[P] [PG]` owned BRANDS-list link/unlink; узкий add gate | **CODE ONLY; LIVE BLOCKED** | Настоящий eligible owned BRANDS list и parent; remove/restore не открыт узким gate. Это не «API unsupported». |

Последний прямой Google READ **15.10** подтвердил self conversion customer `8590146099`, ноль actions/goals/PMax parent/IMAGE assets. `WEBPAGE/SIGNUP` получил HTTP 200 `validateOnly:true`, request `ZtaBP85tWEewhV1oHmpkMw`; **ничего не создано и `sign_up` не измеряется** ([EConv](pmax-test-conversion-readiness-20261015.md)). Попытка 16.10 остановилась до Google из-за истёкшего TEST access token; отсутствие объектов 16.10 не перечитано. CI-образ с ConversionAction/PMax gates не запущен: работающий TEST API `sha256:35e95779d59df2b83eb45f3dfc481ffa9e2e09d494ee26315c6ae656d7111595`, TEST Web `sha256:5e131625e622fe91aa578c0a53a586ffc5f30d49bf8ba39c8080bbd18835a0d6` (read-only `docker inspect` 16.10). Original PMax **редактирование** нельзя принять созданием fixture или одной search-theme записью.

## Именованные проверки исходного ТЗ — не дополнительный знаменатель

| Сценарии и §§ | Последний подтверждённый итог |
|---|---|
| T/U/V/W · 117–128 | 4/4 LIVE; atomic PAUSED Search, RSA31 отказ, missing goal, отдельное включение/восстановление — [E20](google-ads-lettered-closeout-20261013.md). |
| A/B/C/D/E/F/M/O/P · 264–287, 312–315, 320–327 | 9/9 LIVE; C — 19 provider-applied + одна кодированная локальная ошибка, M — отказ без удаления — [E20](google-ads-lettered-closeout-20261013.md). |
| G/H/N · 288–295, 316–319 | 3/3 LIVE, включая предупреждения, shared impact и отдельный restore — [E20](google-ads-lettered-closeout-20261013.md). |
| I/J · 296–303 | 2/2 LIVE с отдельными approved восстановлением — [E20](google-ads-lettered-closeout-20261013.md). |
| K/L · 304–311 | 2/2 LIVE: RSA31 отвергнут, валидное RSA PAUSED — [E20](google-ads-lettered-closeout-20261013.md). |
| Q · 57–59 | ChatGPT A/B/C/M **LIVE PASS**; старый `NOT_VERIFIED` инцидент сохранён, не переписан — [EQRS](qrs-two-client-closeout-20261015.md). |
| R · 60–62 | Claude A/B/C и restores LIVE; M клиент блокировал до HolyMedia, human cancel и ноль mutation, но нет Claude server-side denial — **PARTIAL** — [EQRS](qrs-two-client-closeout-20261015.md). |
| S · 63–65 | Два OAuth consent и browser approval доказаны, client-side permission prompts обоих клиентов не сохранены — **PARTIAL** — [EQRS](qrs-two-client-closeout-20261015.md). |

## Вне первоначального Google Ads ТЗ: готовность HolyPilot

Здесь **не** начисляются баллы исходному ТЗ. Статус кода/продукта отделён от текущего provider LIVE; старые `docs/architecture/v2` описывают предыдущие снимки, а не автоматически текущее production.

| Область | Код/доказательство | Текущая граница |
|---|---|---|
| Google Ads | ``C0–C4` [P]`, E20, EClone | READ и 20 сценариев LIVE TEST; broad production write OFF, PMax/goal open. |
| Meta Ads | [adapter](../../apps/api/src/providers/adapters/meta.ads.ts), [архитектурная матрица](../architecture/v2/PROVIDER_INTEGRATION_MATRIX_RU.md) | OAuth/read и ограниченный confirmed workflow; текущий полный live parity не доказан. |
| TikTok Ads | [adapter](../../apps/api/src/providers/adapters/tiktok.ads.ts) объявляет `read:false, write:false` | OAuth/discovery есть; реальные отчёты/записи как готовый продукт не доказаны. |
| Яндекс Директ | [adapter](../../apps/api/src/providers/adapters/yandex.direct.ts) объявляет `read:false, write:false` | OAuth/discovery есть; настоящая read/write parity отсутствует. |
| Google Search Console | [adapter](../../apps/api/src/providers/adapters/google.search-console.ts) | Read path/SEO UI есть; историческая production connection требовала reauth, свежий provider live не проверялся. |
| Google Analytics 4 | [adapter](../../apps/api/src/providers/adapters/google.analytics.ts) объявляет `read: configured, write:false` | Настоящий read adapter реализован, но текущая OAuth/property/provider LIVE-приёмка не представлена. |
| SEO и анализ сайтов | [site analysis](../../apps/api/src/site-analysis), [архитектурный реестр](../architecture/v2/FEATURE_INVENTORY_RU.md) | SSRF-hardened analysis/history/export foundation; полный пользовательский E2E не доказан этим аудитом. |
| Отчёты/экспорт | [reports](../../apps/api/src/reports/report.service.ts), [реестр](../architecture/v2/FEATURE_INVENTORY_RU.md) | Данные/брендированный DOCX существуют; async artifacts/PDF parity и реальный сквозной download требуют отдельной проверки. |
| MCP/AI-клиенты | `[M] [O]`, EQRS | TEST ChatGPT и Claude работают в доказанных границах; R/S open. |
| Регистрация/авторизация | [auth](../../apps/api/src/auth/auth.service.ts) | Production login работает; отдельный TEST signup закрыт; событие `sign_up` для Google Ads не измерено. |
| Личный кабинет, пользователи/роли | [dashboard](../../apps/web/app/(private)/dashboard/page.tsx), [auth/roles](../../apps/api/src/auth) | Реализация и tenant/role tests; все сценарии browser E2E не проверены заново. |
| Billing | [billing](../../apps/api/src/billing/billing.service.ts), [архитектура](../architecture/v2/BILLING_ARCHITECTURE_RU.md) | Plans/entitlements foundation; реальный checkout/webhook адаптер не выбран/не включён. |
| Администрирование | [admin](../../apps/api/src/admin/admin.service.ts) | Код и тесты; полный operational handoff отдельно. |
| Публикация HolyPilot | [brand worktree](https://github.com/stanforge-labs/HolyMedia-MCP/tree/codex/holypilot-brand-only), [CI design](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38944455196), [CI image](https://github.com/stanforge-labs/HolyMedia-MCP/actions/runs/38943970037) | Patch `fa9805b` и Web-only image `sha256:1c39775ffbb095cc7d9037dfbea874be146ad25fe88ce255eaa794b0ccfd9ec0` готовы; live Web остаётся `sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833` и показывает HolyMedia MCP. Две прежние Web замены откатились на swap/PSI; новый patch **не опубликован**. |

Исторические V1 security findings в `docs/architecture/v2/SECURITY_FINDINGS_RU.md` нельзя считать текущими уязвимостями V2 без повторной проверки. Текущий исходный SHA имеет Linux CI, secret/dependency checks и отдельные tenant/auth tests; это не продакшн pentest и не разрешение release. Перед production Google Write нужны современный API/developer token access, точный allowlist, owner/approval policy, восстановление, staging evidence и отдельное решение владельца. Подробнее — [выполнимость](../operations/ZERO_COST_100_PERCENT_FEASIBILITY.md) и [единый план](FINAL_EXECUTION_PLAN.md).

[C]: ../../apps/api/src/mcp/mcp-preview.service.ts
[W]: ../../apps/api/src/providers/google-ads-write.ts
[C0]: ../../apps/api/src/providers/google-ads-stage0.ts
[C1]: ../../apps/api/src/providers/google-ads-stage1.ts
[C2]: ../../apps/api/src/providers/google-ads-stage2-advanced.ts
[C3]: ../../apps/api/src/providers/google-ads-stage3.ts
[C4]: ../../apps/api/src/providers/google-ads-stage4.ts
[P]: ../../apps/api/src/providers/google-ads-pmax.ts
[PG]: ../../apps/api/src/providers/google-ads-pmax-test-gate.ts
[CG]: ../../apps/api/src/providers/google-ads-conversion-test-gate.ts
[M]: ../../apps/api/src/mcp/google-write-client-contract.ts
[O]: ../../apps/api/src/mcp/oauth-authorization.service.ts

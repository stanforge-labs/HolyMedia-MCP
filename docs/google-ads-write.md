# Google Ads write: W0 + Stage 0–4 supported profiles

## Текущая сводка — 2026-10-09

Аудированная интеграционная база: `codex/google-ads-write-full-scope-final`,
`6fb30acd6249768d738a1f20b013a8368b4c3950`. Подробная сверка с оригинальным ТЗ
от 05.10.2026 (336 OOXML paragraphs, SHA-256 `51C94D3D2953B32821DC872822147B1FF6C28E36258211D9DDD916BFF2C30DB0`):
[итоговый scope и ограничения](google-ads-write-full-scope-final.md),
[машиночитаемая матрица](../artifacts/google-full-scope/requirements-matrix-20261009.json).

Stage 0+1 **исторический live acceptance COMPLETE**:
`artifacts/google-live-acceptance/stage01-final-live-acceptance-20261009.json`.
Суммарно в том принятом workflow: READ **1794**, VALIDATE_ONLY **27**, реальные WRITE **17**,
только TEST Client `8590146099`; эти записи и исходный UNVERIFIED commit не переписываются.
Новые Stage 2–4, money/clears/proximity/media/PMax profiles реализованы и имеют mock/disposable
регрессии, но **не получают LIVE PASS из этого исторического результата**.

Свежий read-only preflight `artifacts/google-full-scope/read-only-preflight-20261009.json`:
READ **15**, VALIDATE_ONLY **0**, WRITE **0** на runtime source `7da2fbbe7d150072183bc5e121cae4abae019ddc`,
а не на новом интегрированном коде. В TEST окружении IMAGE assets **0**, conversion actions **0**:
новый PMax live profile требует подходящих данных/credential permissions и отдельных manual approvals.
Счётчики «0 real calls/writes» ниже относятся к указанным engineering/mock пакетам, не ко всей истории.

На текущей full-scope ветке READ link/UTM audit (P244) и native MCP OAuth write identity
(P46) реализованы и stock mock-tested; это не live cross-client acceptance.
Обязательные незакрытые gates: оставшиеся bounded clone ограничения, новые live G/H/I/J/K/L/N
и Q/R/S из реальных подключённых MCP-клиентов. Release FULL SCOPE READY не объявляется.

## Исторические границы первого Stage 1 пакета

Ветка Stage 1: `codex/google-ads-write-stage1`, точная база W0 `2f6774862b8642d9e47087b9274fd8ee103bafc5`.
Сохранён status slice `ENABLED ↔ PAUSED`; добавлены keyword creation, match-type replacement,
final URL, explicit permanent removal, campaign/ad-group/shared negatives и shared-list lifecycle.
Только в этом первом пакете кампания, бюджет, объявления, assets и tracking templates не создавались/не изменялись.
Последующие Stage 0–4 расширяют scope согласно текущей сводке выше.
Google READ и Meta dispatch сохраняются. Production deploy/изменения env/реальные provider calls в этой задаче не выполняются.

## Архитектура

Операция расширяет существующий `McpPreviewService`, `McpPreview` и `AuditService`,
а не создаёт отдельные preview/confirmation tables или client-specific approval.

1. Generic `pause_entities_preview` / `update_entity_status_preview` принимает явный `GOOGLE_ADS`.
2. Авторизация workspace/account/service key + Google gate/allowlist.
3. `ProviderService` получает актуальные credentials и MCC context через существующий credential vault/refresh path.
4. Typed `GoogleAdsAdapter.readKeywordStates` читает реальные resource identities из Google.
5. Adapter валидирует status-only operations через `customers/{customerId}/adGroupCriteria:mutate`.
6. Generic preview store сохраняет immutable before/requested snapshots, digest, TTL и **digests** opaque preview/approval tokens.
7. Существующая HolyMedia `/mcp/approve#<nonce>` страница отображает batch. Cookie session и CSRF-защищённый decision endpoint сохраняют approval, без provider access/write.
8. Generic `commit_preview` принимает **только preview_token**, перепроверяет policy, browser approval и snapshot, атомарно claims preview, отправляет сохранённые operations один раз.
9. Provider reread подтверждает фактический status каждой строки; результат и audit сохраняются в существующих моделях.

`google-ads-write.ts` содержит typed identities/mutations, общий batch limit и безопасный Google error decoder.
Для будущих операций расширяются typed adapter methods и provider-aware generic dispatch;
arbitrary raw Google API proxy не предоставляется.

## Feature gates и account policy

```dotenv
PROVIDER_GOOGLE_ADS_WRITE_ENABLED=false
GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST=
```

- Default Google write gate **false**; provider capability `write = configured && googleAdsWriteEnabled`.
- Пустой allowlist запрещает запись во все Google accounts. Customer IDs нормализуются (например `123-456-7890 → 1234567890`); дубликаты удаляются; некорректная конфигурация отклоняется.
- Preview, approval context, commit и adapter mutation независимо проверяют gate/allowlist. Это не подсказка MCP-клиенту, а server-side policy.
- Commit дополнительно требует `V2_PREVIEW_ONLY=false` и `V2_CONFIRMED_WRITE_ENABLED=true`.
- Workspace service token требует read + write scope, активного creator/membership/workspace, разрешённого account, отсутствия revoke/expiry. Atomic claim повторяет критические token/account predicates, включая static empty allowlist denial.
- Browser approval доступен **только текущему активному создателю service identity**, в его workspace. Один nonce не авторизует другого пользователя; `confirm_preview` не может подтвердить Google batch вместо браузера.
- Public MCP catalog не включает эти generic Google write tools **даже при наличии Google gate**. `PUBLIC_MCP_WRITE_SCOPE_ENABLED=false` и `PUBLIC_MCP_CONTROLLED_WRITE_ENABLED=false` остаются неизменными. Public Google OAuth write dispatch не входит в эту реализацию; первый slice использует legacy `/mcp` с scoped HolyMedia service key, независимо от AI-клиента.
- Google provider OAuth scope остаётся `https://www.googleapis.com/auth/adwords`.
- `login-customer-id` сохраняется из account/credential/config MCC context. Developer-token header не добавляется: текущий V2 READ adapter уже не отправляет deprecated token. Его старое env-поле не удаляется и не меняется.

## Input schema и примеры

Схемы generic tools содержат provider-specific branches: строгий Google contract
(`additionalProperties=false`) и обратносовместимый Meta contract. Google принимает
только `provider`, `account_id`, `entity_type`, `status`, `items`.
Каждый item требует campaign/ad group/criterion IDs; optional resource_name должен им точно соответствовать.
Single keyword задаётся как batch из одной строки.

```json
{
  "provider": "GOOGLE_ADS",
  "account_id": "1234567890",
  "entity_type": "keyword",
  "items": [
    {
      "campaign_id": "111",
      "ad_group_id": "222",
      "criterion_id": "333",
      "resource_name": "customers/1234567890/adGroupCriteria/222~333"
    }
  ]
}
```

Это input `pause_entities_preview` (`PAUSED` implicit). Для resume используйте
`update_entity_status_preview` с таким же input и `"status": "ENABLED"`.
Batch limit **500**; превышение даёт русский `google_batch_limit_exceeded` с инструкцией разбить batch. Silent truncation нет.
Дубликаты resources, неправильный parent/account, negatives, removed resources и неизвестные mutation-поля отклоняются.

## Preview lifecycle и Google validate_only

Snapshot каждой строки: account, resource_name, campaign ID/name/status,
ad group ID/name/status, criterion ID, keyword text/match type/status.
Имена родителей также входят в conservative stale check; их переименование требует нового preview.

REST использует JSON/proto field mapping:

```json
{
  "operations": [
    {
      "update": {
        "resourceName": "customers/1234567890/adGroupCriteria/222~333",
        "status": "PAUSED"
      },
      "updateMask": "status"
    }
  ],
  "validateOnly": true,
  "partialFailure": true
}
```

`validateOnly=true` — Google protobuf `validate_only=true`: запрос валидируется, но не исполняется.
Отсутствие results при успешной validation нормально. `partialFailureError` разбирается по operation indices; неизвестный/global error блокирует валидность, а не создаёт ложный success.
Глобальная HTTP/API, permission или transport ошибка не даёт committable preview.
Для keyword status batch известная недоступная строка обрабатывается отдельно:
bounded per-row snapshot reads (до 4 параллельных) сохраняют валидные строки.
Все input identities проходят account/resource/duplicate checks **до** provider access.
Missing/parent-mismatch строка имеет `row_error.source=HOLYMEDIA`,
`stage=snapshot_read`, `code=google_keyword_unavailable`, `google_code=null`;
это **не** ошибка Google mutation API и такая строка не отправляется в mutate.
Валидные changed rows проходят Google `validateOnly=true`. Per-operation Google
validation errors сохраняют `source=GOOGLE_ADS`, `stage=validate_only` и original code.
Preview и browser review показывают все input rows, включая `eligible_for_commit=false`.
`operation_count` считает только validated changed mutations; `requested_operation_count`
и `excluded_operation_count` объясняют полную пачку. Если допустимых изменений нет,
возвращается `status=validation_failed` без preview token/approval URL.
Иначе approved immutable payload содержит точный eligible mutation subset **и**
digest-bound excluded identities/snapshots/errors; commit не может добавить исключённую строку.
Excluded snapshots также перечитываются перед claim: появившийся missing criterion
или изменение validation-rejected объекта требует нового preview (`google_preview_stale`).
Mixed commit возвращает все rows в input order, `PARTIAL_FAILURE`, per-row source/code
и отдельный durable `mcp_google_keyword_row_rejected` audit. Stage 1
`partialFailure=true` сохранён; Stage 0 atomic `partialFailure=false` не изменён.

Успешный preview возвращает `preview_id`, secure `preview_token`, `expires_at`, `provider`,
account, operation_count, items с before/after, Google validation и warnings, approval URL.
MCP transport предоставляет structuredContent и краткий text summary; существующий
JSON text result сохраняется для старых MCP клиентов, чтобы tokens/approval URL/rows
не потерялись при отсутствии поддержки structuredContent. No-op строки видны, отмечены
`not_required_no_op`, не отправляются в mutate; полностью no-op batch не создаёт preview.

**TTL: Google keyword previews 30 минут** (`GOOGLE_KEYWORD_PREVIEW_TTL_MS`).
Meta generic/public TTL остаётся **10 минут**, без молчаливого изменения.
Preview и browser approval не выполняют Google write. Opaque nonce находится в browser fragment,
не в HTTP query/path; используются существующие no-store/no-referrer и sessionStorage lifecycle.

## Commit, snapshot, partial failure, verification

Commit не принимает account/object/status/items — только opaque token того же service key.
Проверяются expiry/cancellation/replay, активные identity/account policies, approver/session и сохранённые payload/snapshot bindings.
Перед mutation Google читается снова. Если relevant snapshot отличается (включая removal/parent mismatch),
возвращается `google_preview_stale`: «Объект изменился после создания preview. Создайте новый preview.»
Mutation не отправляется.

Snapshot digest и сравнение используют canonical JSON с отсортированными object keys:
PostgreSQL JSONB может менять порядок ключей, но не порядок batch rows. Approval table
строится из этих же immutable snapshots, а не из отдельного display diff.

Atomic compare-and-set claim связывает provider/account/connection/workspace/token,
approved user/session, persisted snapshots, TTL и `consumedAt=null`.
Replay/concurrent commits одного preview не могут отправить второй запрос.
Google не предоставляет compare-and-swap по keyword status: внешнее изменение между prewrite read и mutate полностью исключить нельзя. Это остаточное ограничение provider API, не обещание транзакции между Google и HolyMedia.

Commit REST: **`validateOnly=false`, `partialFailure=true`, `updateMask=status`**.
Отправляются только сохранённые changed rows. Ошибка одной строки не отменяет остальные успехи.
Результат каждой строки: criterion/keyword, old/requested/actual statuses, success/failure/no_op,
original Google error code, русское объяснение, provider reread.

HTTP success недостаточен: actual status должен совпасть с requested.
Если batch reread не удаётся из-за отсутствующей строки, bounded per-row reread (до 6 параллельных) сохраняет verification остальных строк.
Отсутствующий/неподтверждённый status — не success.
Lost response/read outage не приводит к повтору mutation: preview остаётся consumed;
`NOT_VERIFIED`, `PARTIAL_FAILURE` или `UNCERTAIN_OUTCOME` требуют проверки фактического состояния.
Автоматический retry mutation запрещён.

## Audit и ошибки

Используются `McpPreview.providerResult/verificationRead/commitStatus/commitAttemptedAt`
и `AuditEvent` через `AuditService`; **DB migration не требуется**.
Audit хранит timestamp, workspace, service token/identity, preview id, provider/account,
campaign/ad group/criterion/resource, keyword, before/requested/actual, attempt/result и Google code.
Browser decision аудируется с human actor. Rejected commit attempts также аудируются.
Перед provider mutation должны сохраниться row attempt audit records; сбой audit до запроса останавливает запись.
Сбой финализации после запроса не делает preview пригодным для retry: необходимо reconciliation по provider state и prewritten attempt journal.

Ошибки Google превращаются в machine-readable HolyMedia code, original Google error code,
русское объяснение и безопасный field path. Raw provider message/trigger и Authorization headers не возвращаются.
Неизвестные/malformed operation indices fail closed. Credentials, preview/approval plaintext tokens не попадают в audit.

## Stage 1 typed operations / инструменты

`google-ads-stage1.ts` — typed operation builder и provider-state verification, **не второй preview service**.
`McpPreviewService` сохраняет планы в существующем `requestedState`, snapshots в `beforeState`,
использует тот же browser decision и общий atomic `claimGooglePreview` с W0. Migration: NONE.
Планы и display rows digest-bound; JSONB key reordering не меняет binding. Внешний caller не может передать raw mutation payload.

| Tool                                                     | Обязательный контракт кроме `provider=GOOGLE_ADS`, `account_id`                                            |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `create_keyword_from_brief`                              | `entity_type=keyword`, items: campaign_id/ad_group_id/text/match_type; optional cpc_bid/final_url          |
| `pause_entities_preview`, `update_entity_status_preview` | W0 IDs; для resume status=ENABLED                                                                          |
| `google_ads_change_keyword_match_type_preview`           | items: campaign_id/ad_group_id/criterion_id/new match_type                                                 |
| `preview_update_object`                                  | entity_type=keyword, field=final_url, items: IDs + final_url (null clears)                                 |
| `preview_delete_or_archive_object`                       | entity_type=keyword, items: IDs; permanent removal warning, PAUSE alternative                              |
| `google_ads_negatives_preview`                           | operation=add/remove, level=campaign/ad_group; add text/match_type, remove criterion_id, scoped parent IDs |
| `google_ads_create_shared_negative_list_preview`         | items: shared_list_name; создаётся пустой SharedSet                                                        |
| `google_ads_shared_negative_members_preview`             | operation=add/remove; shared_set_id + text/match_type либо criterion_id                                    |
| `google_ads_shared_negative_campaigns_preview`           | operation=attach/detach; items: campaign_id/shared_set_id                                                  |
| `google_ads_search_term_to_negative_preview`             | target_level=campaign/ad_group/shared_list; scoped IDs + search_term/match_type                            |
| `google_ads_search_term_to_keyword_preview`              | campaign_id/ad_group_id/search_term/match_type + optional cpc_bid/final_url                                |
| `list_change_journal`                                    | provider/account; optional from/to ISO timestamps, actor_user_id, operation, limit 1–100, opaque cursor    |
| `preview_rollback_commit`                                | **только commit_id**; server-side recorded before values                                                   |
| `commit_preview`                                         | **только preview_token**; existing browser approval mandatory                                              |

Все Google schema branches запрещают additionalProperties; negative contracts явно задают required поля
для комбинаций level/operation. Meta compatibility branches/dispatch сохранены.
Google-specific tools описывают именно preview, возвращаемые effects и отдельный commit.
Preview annotations: readOnly=false, destructive=false, openWorld=true; journal readOnly=true;
реальный generic commit destructive=true. Permanent intent виден в description, before/after и browser warning.

### Keyword creation, money, duplicates и negatives

Ad group проверяется через Google и должен принадлежать campaign/account. NFC/whitespace normalization сохраняет
регистр исходного текста; equivalence duplicate check case-insensitive. Действующий ENABLED/PAUSED criterion
с тем же нормализованным текстом/match type блокирует новый preview (`google_keyword_duplicate`), включая batch duplicates.
Group/campaign/shared negative inventory проверяется по существующему `negativeMatch` (не новая семантика match).
При конфликте preview **не молча отбрасывается**: включает отрицательный/активный ключ, parent IDs и reason_code.
HolyMedia browser approval показывает эти warnings/conflicts; deliberate commit разрешён после approval.

`cpc_bid={"amount":"150","currency":"KZT"}` — сумма в обычной валюте аккаунта, не raw micros.
Валюта читается из Google Customer; несовпадение запрещено. Точное decimal→BigInt преобразование без float rounding,
до 6 знаков после точки. Пример `{"amount":"0.5","currency":"USD"}` → 500000 micros.
Final URL — абсолютный HTTP(S) без embedded credentials; null очищает `final_urls` keyword override.
Tracking template вне Stage 1. Match replacement сохраняет старые URL и keyword CPC override.

### Negatives / shared lists / search terms

CampaignCriterion negative=true; AdGroupCriterion negative=true; SharedCriterion связан с выбранным
account-scoped SharedSet типа NEGATIVE_KEYWORDS. Add/remove — разные typed operations.
Remove требует criterion_id, а не неоднозначный текст. Shared list creation/members/attach/detach —
отдельные previews/commits, не скрытый compound write. CampaignSharedSet attach проверяет
конфликты всех members с активными ключами кампании; shared member add проверяет все attached campaigns.
Detach удаляет связь, не список и не кампанию. Search-term conversion направляет в тот же builder,
без отдельной реализации создания keyword/negative. Это конверсия указанного read-result текста,
не автоматическое доказательство его наличия в Google SearchTermView.

### Batch и composite partial failure

Максимум **500 provider operations**, не строк. Match change: create нового ENABLED criterion +
pause старого (никогда remove), максимум **250 input rows**. Превышение отклоняется до provider access,
без truncate. В одном plan используется один typed Google resource service; raw arbitrary service запрещён.
Preview вызывает реальный соответствующий REST mutate с `validateOnly=true`; normal commit —
`validateOnly=false, partialFailure=true`. Все пять используемых сервисов поддерживают validate_only.

Если validation любой операции не проходит, committable token **не создаётся**.
При commit ошибки Google сохраняются по provider-operation index; успехи других строк остаются применёнными.
Для match replacement create-only/pause-only результат **DEGRADED**, не success;
вывод содержит actual состояния и безопасную remediation: проверить обе строки, создать отдельный status preview,
не повторять уже consumed commit. Google не обещает транзакцию этих двух partial-failure операций.

### Snapshot / reread

Перед preview читаются targeted parent/resource inventories; полные selectors и нормализованные rows
сохраняются в snapshot. Полное searchStream чтение ограничено 20 000 rows на selector; превышение
отклоняется, не выдаёт ложное «конфликтов нет». Не используется усечённая первая страница READ cursor.
Перед commit повторно читаются **все selectors**; изменение родителей, наличия criterion,
URLs/status/match/bid, duplicates/negative inventory требует новый preview (`google_preview_stale`).
Это консервативно: изменение другого keyword в выбранном inventory тоже может сделать preview stale.
После commit каждая accepted/failed операция reread по resource_name. Созданные Google IDs проверяются
на account/type; before/requested/actual возвращаются. Remove подтверждён только если read показывает
REMOVED или ресурс отсутствует. HTTP 200/accepted без подтверждённого состояния не считается success.
Нормальный batch reread использует один IN-query на service; при сбое — bounded per-resource fallback до 6 параллельных чтений, без повторной mutation.
Никаких автоматических mutation retries после lost response/reread outage.

## Journal, commit ID и rollback foundation

Каждый mutation set имеет стабильный opaque `hmc_...` commit ID, детерминированно связанный с уникальным
preview. AuditService пишет attempt/result по операции; W0 row events теперь тоже содержат commit ID.
Существующий McpPreview содержит immutable before/requested, provider results/Google codes, verificationRead,
commitAttemptedAt и approving user; `list_change_journal` читает эти записи с workspace/account authorization,
которую нельзя заменить клиентским фильтром. По одному journal entry на commit, внутри все rows/effects.
Cursor — opaque commit ID, scoped к текущему account; stable time+ID pagination. Audit result event позволяет
найти исходный mutation set для rollback без новой параллельной audit database.

`preview_rollback_commit` извлекает server-recorded before и verified post-state, заново проверяет allowlist,
current access и неизменность post-snapshot, создаёт **новый preview**, Google validate_only, browser approval,
обычный commit/reread/audit. Скрытого immediate reverse mutate нет.

- Keyword status: поддержано для verified changed rows; no-op/failed rows не откатываются.
- Final URL: поддержано для verified successful rows URL batch (в том числе PARTIAL_FAILURE); восстанавливается полный сохранённый `final_urls`, включая empty/reset. Failed/unverified rows исключены.
- REMOVED: **необратимо**, rollback отклонён.
- Match type: automatic rollback **не поддерживается**; используйте новые explicit status previews после анализа двух actual ресурсов.
- Negatives/shared list/create rollback: **не поддерживается** в Stage 1; typed before/expected/actual и commit ID готовы для будущего inverse builder.

Audit failure до mutate останавливает write. Failure финализации после mutate остаётся consumed и требует reconciliation;
журнал попыток — источник расследования, повторный commit небезопасен. Google errors: HolyMedia code,
русский message, `google_code` (alias existing `google_error_code`), безопасный field_path и row association;
raw provider message/trigger/Authorization не выдаются.

## Stage 0: Search campaign-from-brief

Ветка: `codex/google-ads-write-stage0`, точная база Stage 1
`1c0a44ea68e9b26d5f9a75e833e681f04ad67a80`. Это только development / mock acceptance.

`google-ads-stage0.ts` строит типизированный multi-resource plan. Он не создаёт отдельной
системы подтверждения: тот же `McpPreviewService`, таблица preview, 30-minute TTL,
hash-bound exact plan, browser creator/session/CSRF, atomic claim, AuditService,
`commit_preview`, opaque `hmc_...` commit ID и `list_change_journal`.
Stage 0 хранит `version=0`, операции `GOOGLE_STAGE0_CAMPAIGN_CREATE/RESUME`;
Stage 1 по-прежнему version=1. Общий operation audit event сохранён совместимым
(`mcp_google_stage1_operation`, metadata.operation различает тип операции).

Generic tools расширены provider-aware:

- `create_campaign_from_brief`: только preview, Google validation, summary + object plan + approval URL.
- `get_launch_checklist`: READ current campaign + bounded landing URL probes; PASS/WARNING/FAIL.
- `preview_resume_campaign`: отдельный campaign-only status preview, без скрытого включения groups/ads.
- `preview_pause_campaign`: отдельный campaign-only Search PAUSE preview для ENABLED campaign; те же validate-only/approval/commit/reread/audit, без launch-readiness requirements для остановки доставки и без изменения groups/ads.
- `clone_campaign_preview`: ограниченный fail-closed Search clone через тот же builder, target PAUSED.

Google-ветви schemas concrete: unknown properties запрещены рекурсивно, размеры arrays/strings ограничены,
все required/enums/descriptions опубликованы. Старые Meta generic schema branches сохранены;
они не позволяют Google обойти серверную строгую проверку. Все новые Google writes доступны только
legacy scoped service-key пути; Public catalog остаётся 42 READ tools. Gates/allowlist defaults не менялись.

### Brief contract / defaults

Required: `provider=GOOGLE_ADS`, `account_id`, `campaign_name`, `daily_budget={amount,currency}`,
`locations[]`, `languages[]`, `ad_groups[]`. Money amount — decimal string обычной валютной суммы,
не micros. Account currency/timezone читаются из Google. `currencyMicros` из Stage 1 используется
для бюджета/default bid/keyword CPC без float rounding. Currency mismatch/zero отвергается.

Group: `name`, `keywords[{text,match_type,cpc_bid?,final_url?}]`, `rsa[]`, optional `default_bid`,
`negative_keywords[]`. Имена групп уникальны; exact-equivalent keys/negatives не дублируются внутри parent.
`parseStage1Intent`, `normalizeKeywordText`, `keywordCreateFields`, `currencyMicros`, `conflictReason`
переиспользуются для существующих и temporary parents. Новый Stage 0 brief/clone явно
переопределяет Stage 1 keyword default: positive keywords, RSA, groups и campaign PAUSED.
Historical fixtures с ENABLED originals не менялись. Budget/assets/criteria без status
не получают выдуманное PAUSED field. Нет параметра для скрытого запуска.

Default strategy: **MANUAL_CPC**, с обязательным явным `default_bid` каждой группы.
Никакая ставка не угадывается по валюте/бюджету. Optional **MAXIMIZE_CONVERSIONS** требует
explicit validated conversion actions, не принимает manual CPC overrides. Полной Stage 2 editing surface нет.
Budget DAILY/default Google period, STANDARD delivery, explicitly_shared=false.
Google Search ON; `targetSearchNetwork` (Search Partners) OFF, `targetContentNetwork` OFF,
`targetPartnerSearchNetwork` OFF. Единственный opt-in network option: `networks.search_partners=true`.
EU political declaration: DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING для этого Search brief profile.

`locations[{name,country_code?,exclude?,geo_target_id?}]`: GeoTargetConstantService suggestions,
enabled constant и повторная GAQL reference проверка. Несколько вариантов → explicit error с кандидатами,
не guessed first result; ID уточнения выбирается только среди Google suggestions. Duplicate/conflicting
include/exclude запрещены; нужен хотя бы один include. Include/exclude mode PRESENCE.
Optional `proximities[{latitude,longitude,radius,unit}]` поддерживает положительный radius
1–500 KM/MILES, coordinates до шести decimal places и PRESENCE. Нет address geocoding
или proximity exclusions; privacy/eligibility проверяет Google validate_only. Clone proximity
остаётся отдельным неподдерживаемым source component, не молча урезается.
Languages: aliases Russian/русский/ru, Kazakh/казахский/kk, English/английский/en → реальные targetable
LanguageConstants; неизвестные/недоступные языки отвергаются, ID не хардкодится.

Optional `start_date/end_date` YYYY-MM-DD → v24 `startDateTime` 00:00:00 и `endDateTime` 23:59:59
в account timezone. Schedule: `days[]`, `start/end` HH:MM, 15-minute granularity, end может 24:00;
overlap/overnight отвергаются (ночь разбивать явно). Timezone включён в preview. Bid modifiers отсутствуют.

### Conversion goals

Requested IDs должны существовать, быть ENABLED и usable в выбранном conversion customer.
Для полного набора primary actions по category/origin все campaign goals обновляются
в том же atomic set через CampaignConversionGoalOperation на temporary campaign ID.
Невыбранные категории biddable=false. Это официально поддержанный dependency pattern, не второй write phase.
Если выбран только subset category/origin или explicit secondary action, в том же атомарном set
создаётся CustomConversionGoal с **ровно выбранными** action references, а campaign config связывается
с его temporary resource. Standard campaign goals становятся biddable=false; нет неявно включённых peers.
Secondary action получает prominent warning: custom goal будет использовать его для bidding даже при
primaryForGoal=false. Политика пользователя не заменяется более широким goal.
Cross-account/MCC conversion customer creation тоже явно unsupported для атомарного single-customer set.
MCC login-customer-id для обычного доступа сохранён.

Recent health: actual `all_conversions` за LAST_30_DAYS; zero/unavailable — prominent warning,
не утверждение о исправности tracking. Rolling metrics не входят в immutable stale snapshot,
а статические action/status/goal/customer references входят. Без explicit selection manual-CPC brief
показывает inherited-customer-goals warning; MAXIMIZE_CONVERSIONS brief без actions fails.

### RSA / assets / tracking

RSA: one `final_url`, 3–15 `{text,pinned_field?}` headlines (<=30), 2–4 descriptions (<=90),
optional path1/path2 (<=15; path2 требует path1). Wide/CJK characters учитываются двойным лимитом.
31-character headline fails before any provider request/preview. HTTP(S) URL format/credentials
проверяются заранее, фактическая reachability — только checklist.

Supported creation + CampaignAsset link: sitelinks (text<=25, optional paired descriptions<=35),
callouts<=25, structured snippets (header + 3–10 values), supplied phone call asset,
business name via textAsset. Google validate_only проверяет policy/eligibility.
Images/business logos: **attachment существующих IMAGE asset IDs выбранного account**,
никакой генерации/download/upload binary. Без заранее загруженного asset бинарное создание — limitation.
Google сам проверяет Search eligibility, размеры и policy при validation; type=IMAGE не заменяет это.

`utm.final_url_suffix` default: `utm_source=google&utm_medium=cpc&utm_campaign={campaignid}`.
Optional HTTPS `tracking_url_template` требует `{lpurl}`. Разрешён ограниченный ValueTrack набор:
campaignid/adgroupid/keyword/matchtype/device/network/creative/loc_physical_ms/lpurl.
Суффикс без начального ?, unknown/malformed placeholders отвергаются; final URLs не переписываются.

### Atomic lifecycle / reread / policy

Non-shared Stage 0 budget (`explicitlyShared=false`) не имеет независимо заданного provider name:
create payload **не отправляет `name`**. Google получает и синхронизирует его из имени связанной
campaign. Preview label `Budget for <campaign>` — только display, не Google поле.
Expected post-state явно содержит `name=<campaign name>`, без суффикса `— daily`.
Reread выбирает `resource_name/name/amount_micros/explicitly_shared/delivery_method`.
Verifier разрешает temporary budget/campaign references через mutate results и проверяет реальную
связь `campaign.campaign_budget`, имя previewed campaign и derived budget name; wrong amount,
sharing flag, delivery method, association/name всё ещё дают UNVERIFIED.
Immutable legacy plans с `— daily` проверяются с этими же provider semantics без изменения плана.
Для будущих **shared** budgets независимое имя остаётся точным проверяемым контрактом.
[Google v24 CampaignBudget name/shared semantics](https://developers.google.com/google-ads/api/reference/rpc/v24/CampaignBudget).

READ-only reconciliation ранее созданного ресурса может повторно применить corrected verifier,
но не повторяет commit/mutate и не меняет historical UNVERIFIED preview/audit result.
Отдельный reconciliation audit/evidence должен указывать original result и новый verification result.

Temporary IDs глобально уникальны и отрицательны; parent всегда создан раньше зависимых mutations:
budget → campaign → criteria/goals → groups → keywords/negatives/RSA → assets/links.
Stage 0 uses **GoogleAdsService.Mutate, validateOnly=true, partialFailure=false** для preview.
Commit отправляет тот же immutable `mutateOperations`, validateOnly=false, **partialFailure=false**:
all-or-nothing Google transaction. Нет BatchJob и неконтролируемого второго write phase.
Stage 1 dedicated-resource commits остаются **partialFailure=true**.
Все underlying операции считаются, включая links/goals/schedule days; max 500, no truncation.
Очевидный oversized brief отвергается до provider reads; окончательный лимит проверяется после reference
resolution, **до validation/mutation**, поскольку число inherited goal categories известно только после чтения Google.

Preview возвращает currency/timezone/budget/strategy/networks/dates/resolved geo/languages/actions,
counts, UTM, warnings, each object plan, Google validation, expiry, approval URL.
Google policy error codes, field/item paths и **sanitized provider details** показываются при validate_only
failure, committable preview не создаётся. Healthcare policy engine не придумывается;
успешный validate_only не означает последующую moderation approval.

Commit повторно проверяет gates/scopes/allowlist/workspace/owner/approval/TTL + reference snapshots,
campaign-name uniqueness и clone source. Atomic claim + durable attempt audit precede provider mutation.
Reread батчится по resource kind/real IDs: campaign PAUSED, budget, groups, keywords, ads, criteria,
goals, assets/links должны совпасть с preview. Итог VERIFIED только после reread всех операций.
HTTP rejection — FAILED/no creations; потерянный response/5xx/неполный reread — UNVERIFIED,
claim consumed, **не retry**. Audit/journal включает IDs/actual state, actor, before/after, commit ID/error.
Automatic delete rollback новой кампании **unsupported**; безопасное состояние — PAUSED.

### Checklist / activation / clone limits

Checklist проверяет current status/budget/strategy/geo/PRESENCE/languages/groups/keywords/RSA,
policy/moderation, usable goals + recent data, landing URLs, tracking, assets.
CampaignAsset inventory использует прямой account-scoped filter
`campaign_asset.campaign = 'customers/<customer>/campaigns/<campaign>'`.
Предыдущий `WHERE campaign.id=...` без campaign.id в SELECT вызвал на изолированном TEST
READ `QueryError.EXPECTED_REFERENCED_FIELD_IN_SELECT_CLAUSE` (HTTP400 INVALID_ARGUMENT):
campaign здесь segmenting reference, а не globally unsupported field. Тот же SELECT с direct
resource reference вернул HTTP200/0 rows. Empty asset inventory не заменяет conversion-goal
checks и не даёт fake ready PASS. Goal/config selectors не изменены без отдельного evidence.
`ready=true` только если все пункты PASS. Missing conversion goal: WARNING для MANUAL_CPC,
FAIL для MAXIMIZE_CONVERSIONS. PAUSED groups/ads и unknown/pending moderation — WARNING.
Resume запрещён при любом FAIL; остальные warnings явно входят в approval view.
Resume меняет **только campaign.status**, groups/ads остаются прежними.

Campaign PAUSE restoration — **новая отдельная операция**, не automatic rollback resume.
Строгий input: только `provider=GOOGLE_ADS`, `account_id`, `campaign_id`; Search campaign
должна быть ENABLED. Preview читает и сохраняет точную campaign identity/полный campaign
snapshot, вызывает Google validate-only с одним status-only update и `partialFailure=false`.
Не читает launch checklist/goals/landing URLs: отсутствие tracking или disapproved ads не
должны блокировать stopping delivery. Commit требует нового persisted browser approval,
перепроверяет тот же snapshot и все existing gates/scopes/allowlist, claims preview один раз,
пишет attempt audit, mutates один раз и rereads PAUSED. Existing Stage1partialFailure=true
и Public Google write OFF сохраняются. Уже PAUSED/REMOVED, non-Search, missing/foreign identity
отклоняются без committable preview. Groups/ads не переключаются. Mock evidence не live W PASS.

Landing probes используют общий SSRF-safe pinned-DNS `safeGet`, **HEAD** first;
405/501 → bounded GET fallback. Каждое перенаправление заново проверяется, max 3,
timeout 4s на HTTP запрос, body max 64 KiB, max 20 unique URLs, без credentials/cookies/provider headers.
Слишком большой GET fallback/blocked URL/HTTP failure — FAIL, не fake reachability PASS; глубокого crawl нет.

Clone inputs: source_campaign_id/new_name; optional new_budget/new_locations/new_dates.
Supported profile: Search MANUAL_CPC/MAXIMIZE_CONVERSIONS, standard groups, keyword criteria,
RSA с одним URL, known geo/language/schedule, campaign/group negatives, sitelinks/callouts/snippets,
existing image/logo links, owned CALL/BUSINESS_NAME reuse, positive proximity, same-account
shared negative-list associations, compatible full-category goals/tracking. Все target delivery entities PAUSED.
Source snapshots входят в stale protection. Past dates могут потребовать explicit new_dates.
Unsupported source parts fail the **whole clone preview**, не silently omitted:
audience/device criteria, negative proximity or ambiguous radius relocation, non-keyword/non-RSA groups/ads,
multi-final-URL overrides, custom/cross-account goals, unknown asset details,
unsupported networks/bidding/geo modes. Поэтому clone статус **PARTIAL support**, не full Google clone.

CALL/BUSINESS_NAME и shared-list references переиспользуются, не создаются заново и не
изменяются на source. Их полные settings/membership входят в immutable stale snapshots.
CampaignSharedSet.status — output-only: ожидается ENABLED связь с новой PAUSED campaign,
но status никогда не отправляется в create payload. См. [clone profile](google-ads-write-clone-final.md).

### Stage 0 isolated evidence / live prerequisites

Automated T/U/V/W, defaults, currency, schedule, ambiguity, actions, duplicates/conflicts, URL validation,
approval/expiry/digest tampering/allowlist/gate/scope, atomic failure, uncertain response/reread outage,
attempt-audit failure, clone success/stale/unsupported parts, all supported asset forms, checklist URL/policy,
public READ-only covered by mock HTTP/DB. HEAD/DNS/private redirect/loop guards tested with mock transport.
Validation calls и mutation calls counted отдельно. Real provider calls/writes этого mock пакета = **0**;
исторические Stage 0+1 live calls отдельно отражены в текущей сводке.

Для live Stage 0 нужен отдельный явно разрешённый TEST account, account-currency budget и explicit
group bids, real enabled geo/language constants, usable conversion actions, supplied RSA/URLs/text assets,
existing image/logo IDs при необходимости, MCC/API access, allowed read/write service key и browser owner.
Fixture T: Алматы, 2 groups ×5 keywords, 1 RSA per group, 4 sitelinks, UTM; сначала только PAUSED creation.
Developer token level не угадывается; validation restrictions проверять отдельным разрешённым preflight.
W activation — отдельная операция, без скрытых groups/ads changes. On Clinic/Novartis не тестировались.

## Live acceptance prerequisites / диагностический checklist

В этой задаче fixture **не создаётся** и реальные Google requests не выполняются.
Для будущего PPC acceptance нужен отдельно разрешённый paused TEST Search campaign:

- один клиентский Google customer ID, разрешённый write allowlist (не manager account);
- действующий MCC `login-customer-id`, если используется hierarchy;
- один campaign в `PAUSED`, один ad group, 20 положительных keywords и один RSA;
- реальные campaign/ad group/criterion IDs и resource_name, keyword text/match type/current status всех 20 строк;
- approved creator HolyMedia user + workspace membership, restricted read/write service key;
- explicit isolated write gates, Google credentials с adwords scope и mutation permissions;
- для partial failure — заранее согласованный безопасный сценарий отказа; ошибочную строку не создавать в боевом аккаунте ради теста;
- screenshot/record browser approval и per-row provider reread/audit результаты.

До live acceptance оператор проверяет **без secret output**:

1. Effective `providerGoogleApiVersion` (default `v24`, override не угадывать), provider configured/read/write flags.
2. Effective MCC login ID из account metadata → credential metadata → config; customer target и resource parent identity.
3. Непустой нормализованный Google write account allowlist, token account restriction, membership и scopes.
4. Google Ads API Console/API Center текущие credential/API access ограничения; **не угадывать** developer-token access level по успешному READ.
5. Только после отдельного разрешения на real read/validation — keyword preview с `validateOnly=true`; сохранить полученные Google permission/API restriction codes. Успешный validate-only подтверждает validation/permission на этот запрос, но не обещает будущий commit.
6. Mutation permission определяется Google validation ответом/Console grants, не «пробной настоящей записью».

Реальный commit требует отдельного разрешения; parent campaign остаётся PAUSED, поэтому resume keyword не активирует campaign сам по себе.

## Матрица PPC stages

| Stage                    | Реализовано в этой ветке                                                                                                                                                                                                  | Статус                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| W0 foundation            | Google gate/allowlist, typed status adapter, generic preview + Google validation, secure browser approval, CAS commit, reread, row audit/errors, 500 limit, isolated mock tests                                           | DONE                                                                             |
| First vertical slice     | Keyword PAUSED/ENABLED single + batch                                                                                                                                                                                     | DONE; historical Stage 1 live PASS                                               |
| Stage 0 builder          | Atomic PAUSED budget/Search/geo/languages/schedule/goals/groups/keywords/negatives/RSA/tracking                                                                                                                           | DONE (mock, supported brief profile)                                             |
| Stage 0 assets           | Sitelinks/callouts/snippets/call/business name; existing image/logo attachment                                                                                                                                            | DONE supported brief; safe binary creation via Stage 4, not inline Stage 0 brief |
| Stage 0 checklist/resume | Actual state + safe URL probes + campaign-only activation, shared approval/commit/audit                                                                                                                                   | DONE (mock)                                                                      |
| Stage 0 clone            | Supported Search subset, immutable source snapshots, no silent omission                                                                                                                                                   | PARTIAL; unsupported source components listed above                              |
| Stage 0 custom goals     | Exact same-customer subset/secondary selection, atomic custom goal/config references                                                                                                                                      | DONE (mock)                                                                      |
| Stage 0 proximity        | Typed positive coordinates/radius; PRESENCE; independent criteria verification                                                                                                                                            | DONE (mock); new live pending                                                    |
| Cross-account goals      | Same-account actions/custom goals supported; cross-account creation outside bounded profile                                                                                                                               | NOT IMPLEMENTED; not presumed original mandatory                                 |
| Stage 1 keyword add      | AdGroupCriterion creation, duplicate/conflicts, account-currency optional CPC                                                                                                                                             | DONE (mock)                                                                      |
| Stage 1 status           | Pause/resume W0 preserved                                                                                                                                                                                                 | DONE (mock)                                                                      |
| Stage 1 match type       | Create new + pause old, two effects, DEGRADED reporting                                                                                                                                                                   | DONE (mock)                                                                      |
| Stage 1 final URL        | Set/replace/clear + recorded-value rollback                                                                                                                                                                               | DONE (mock)                                                                      |
| Stage 1 removal          | Distinct permanent remove preview, warning, approval                                                                                                                                                                      | DONE (mock); NOT reversible                                                      |
| Stage 1 negatives        | Campaign/ad-group add/remove, duplicate/conflicts                                                                                                                                                                         | DONE (mock)                                                                      |
| Stage 1 shared lists     | Create/members add-remove/attach-detach, separate rereads                                                                                                                                                                 | DONE (mock)                                                                      |
| Stage 1 conversions      | Search term → keyword/negative common builders                                                                                                                                                                            | DONE (mock)                                                                      |
| Stage 1 journal/rollback | Stable commit ID, journal filters/cursor, status/final URL inverse preview                                                                                                                                                | DONE (mock); other rollback unsupported                                          |
| Stage 2                  | Bid/budget foundation, standard/portfolio strategies, bounded modifiers and frozen performance-filter batches                                                                                                             | IMPLEMENTED supported Search profile; mock PASS, live NOT RUN                    |
| Stage 3                  | Typed incremental audiences/modes, custom audiences, demographics, geo/proximity, languages, schedules and devices                                                                                                        | IMPLEMENTED supported combinations; mock PASS, live NOT RUN                      |
| Stage 4                  | RSA, safe inline/owned media, text/call/business assets, campaign/group/tracking updates, full non-retail PMax creation + existing complete asset groups, minimum-safe replacement/detach, signals/themes/brand negatives | IMPLEMENTED bounded profiles; mock PASS, new live pending                        |

### Stage 2–4 engineering checkpoint — 2026-10-09

The earlier engineering checkpoint was isolated in `codex/google-ads-write-stage234-integration`;
the current audited candidate is `codex/google-ads-write-full-scope-final` at the HEAD above.
The Stage 0+1 release candidate remains `bb5b8d16979a41720129243927a6c9f56e091083`.
The diverged Stage 2 foundation `d2857c0ce19d22ec3aae0e0eb61b67ad5f6af6e9`
was cherry-picked onto that exact base; neither source history nor main was rewritten.

Detailed contracts and remaining capabilities:

- [Stage 2 strategy, portfolio, modifiers and bulk profile](google-ads-write-stage2-completion.md).
- [Stage 3 targeting capability matrix](google-ads-write-stage3.md).
- [Stage 4 RSA/assets/PMax capability matrix](google-ads-write-stage4.md).
- Sanitized engineering evidence: `artifacts/google-stage234/implementation-checkpoint-20261009.json`.

All new private tools enter the existing McpPreviewService, browser approval,
immutable commit, provider reread and journal architecture. No second approval
system exists. Stage-specific gates and the Google/Public write gates default OFF.
Account ownership, provider resource identity, token restrictions, 500-operation
limit and stale/expired/consumed guards are rechecked at commit/rollback. No
provider mutation retry is performed; an uncertain outcome requires reconciliation.

Stage 2 batches retain `partial_failure=true` and structured HOLYMEDIA row errors;
they never relabel local validation as a Google response. Stage 0 creation retains
atomic `partial_failure=false`. Stage 3 targeting uses atomic batches so audience
mode and criteria cannot diverge. Extended creation with temporary dependencies
is atomic. CustomAudienceService is a separate supported atomic service profile,
not an invented GoogleAdsService mutation operation.

Post-state checks resolve exact temporary resource literals, preserve parent and
sibling inventories, normalize only independently proven protobuf defaults and
record verified real CREATE resource IDs. Rollback is a NEW preview and approval,
only for proven reversible operations; creations/removals are not automatically
deleted. No campaign activation can bypass the generic launch checklist.

Bulk performance metrics are frozen in the preview: legitimate metric drift can
invalidate the preview or prevent verified post-state. This conservative limitation
must not trigger automatic retries. Stage 2 now supports the six bounded Search
strategies, same-account portfolios, typed optional parameter clears, campaign and
ad-group device modifiers. Manager cross-account portfolios, arbitrary parameter
clears and hotel profiles remain outside the local profile; they are not inferred
mandatory from original P179–193. Explicit captured bid/budget values support inverse;
inherited/zero defaults and newly created local overrides do not get invented rollback.
Stage 3 unsupported channel/criterion combinations explicitly fail.
Stage 4 now includes decoded/re-encoded bounded inline media, full non-retail atomic
PMax creation, complete group creation on existing PAUSED PMax, branding-aware minimum
asset graphs, safe replacement/detach, signals/themes and v24 brand/negative editing.
Retail/feed-specific PMax profiles and new brand-registry entries remain outside the profile.
Stage 4 tracking set/typed empty clear and captured-value inverse are implemented;
P244 READ link/UTM audit is integrated for Google: bounded owned five-level READ report
and the same audit algorithm for tracking preview exact local/parent BEFORE/AFTER.
Downstream URLs, serving expansion and landing reachability are not claimed as checked.
Clone remains the strict partial profile above. These local boundaries must not be
reported as globally unsupported Google API capabilities. Native private write OAuth
is implemented/mock-tested without ServiceToken substitution; actual cross-client
Q/R/S remain mandatory LIVE gates, not covered by REST/mock success.

Acceptance G/H/I/J/K/L/N equivalents are mock/disposable only. New live TEST
acceptance requires separate authorization and human approval. Q/R actual MCP
client acceptance remains BLOCKED until clients are connected. Stock approval
contract tests do not substitute for live Q/R/S evidence. No release is declared
ready from these engineering tests alone.

## Контроль качества / evidence

Mock integration tests: A/B/C preview+validate_only+diff; D approval; E expiry;
F/O stale; G account policy на preview и commit; H batch; I/J partial failure;
K original code + русский message; no-op, replay, foreign key/user, revoke, CAS/concurrency,
missing-row/read-outage, schemas/annotations и default Public read-only.
Meta и Google READ regression покрываются существующими suites; real provider writes этого mock пакета — **0**.
Точные итоги команд публикуются в отчёте задачи, без объявления непройденных/live checks PASS.

Stage 0 quality gate обнаружил High в транзитивном source-map-js 1.2.1.
Минимальный workspace override `source-map-js@<1.2.2: 1.2.2` обновляет только этот пакет;
lockfile содержит соответствующий patch. Audit после исправления: Critical 0 / High 0,
6 Moderate baseline (не объявляются устранёнными).
[Advisory GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).

Budget verification fix quality scan (2026-10-07) также обнаружил новый High в sharp <0.35.5.
Точечный override обновлён до sharp 0.35.5 (вместе с его platform binaries/libvips),
без смены Next.js или другого product API.
[Sharp/librsvg advisory GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

Primary references:

- [GoogleAdsService bulk mutate and atomic creation](https://developers.google.com/google-ads/api/docs/mutating/overview)
- [Temporary ID dependency and uniqueness rules](https://developers.google.com/google-ads/api/docs/batch-processing/temporary-ids)
- [Campaign-specific conversion and custom goals](https://developers.google.com/google-ads/api/docs/conversions/goals/campaign-goals)
- [Official v24 sample: campaign conversion goals on temporary campaign ID](https://github.com/googleads/google-ads-python/blob/main/examples/shopping_ads/add_performance_max_retail_campaign.py)
- [Campaign date-time creation](https://developers.google.com/google-ads/api/docs/campaigns/create-campaigns)

- [Google v24 MutateAdGroupCriteriaRequest](https://developers.google.com/google-ads/api/reference/rpc/v24/MutateAdGroupCriteriaRequest)
- [Google CampaignCriterion resource identity](https://developers.google.com/google-ads/api/fields/v24/campaign_criterion) — `campaignCriteria/{campaign_id}~{criterion_id}`, не один criterion ID.
- [SharedCriterion identity and fields](https://developers.google.com/google-ads/api/reference/rpc/v24/SharedCriterion)
- [Shared sets / negative list lifecycle](https://developers.google.com/google-ads/api/docs/targeting/shared-sets)
- [SharedSet validate_only / partial_failure](https://developers.google.com/google-ads/api/reference/rpc/v24/MutateSharedSetsRequest)
- [SharedCriterion validate_only / partial_failure](https://developers.google.com/google-ads/api/reference/rpc/v24/MutateSharedCriteriaRequest)
- [CampaignSharedSet validate_only / partial_failure](https://developers.google.com/google-ads/api/reference/rpc/v24/MutateCampaignSharedSetsRequest)
- [Google resource service mutates / REST JSON fields](https://developers.google.com/google-ads/api/docs/mutating/service-mutates)
- [Google partial failure and operation-index errors](https://developers.google.com/google-ads/api/docs/best-practices/partial-failures)
- [ProtoJSON field presence/default values](https://protobuf.dev/programming-guides/json/#presence-and-default-values) — positive keyword query explicitly filters negatives; omitted default `negative=false` is accepted.

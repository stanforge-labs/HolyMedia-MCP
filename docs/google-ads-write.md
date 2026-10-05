# Google Ads write: W0 foundation + Stage 1

## Границы реализации

Ветка Stage 1: `codex/google-ads-write-stage1`, точная база W0 `2f6774862b8642d9e47087b9274fd8ee103bafc5`.
Сохранён status slice `ENABLED ↔ PAUSED`; добавлены keyword creation, match-type replacement,
final URL, explicit permanent removal, campaign/ad-group/shared negatives и shared-list lifecycle.
Кампания, бюджет, объявления, assets и tracking templates не создаются/не изменяются.
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
HTTP/API error не даёт committable preview. При per-row validation errors возвращаются `status=validation_failed`, `provider_validation=failed`, items; preview token/approval URL **не создаются**.

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

## Stage 0 reuse (без campaign builder сейчас)

Stage 0 может переиспользовать `buildStage1Plan` keyword_add/negative_add/shared actions,
`normalizeKeywordText`, `currencyMicros`, существующий `negativeMatch`, typed `providerOperation`,
`GoogleAdsAdapter.mutateStage1(validateOnly=true)`, `verifyStage1Mutation`, а также существующий
McpPreviewService storage/approval/claim/audit. Campaign builder должен явно показывать каждый следующий
preview step и появляющиеся resource IDs; temporary multi-service campaign graphs и budgets пока не реализованы.

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

| Stage                    | Реализовано в этой ветке                                                                                                                                                        | Статус                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| W0 foundation            | Google gate/allowlist, typed status adapter, generic preview + Google validation, secure browser approval, CAS commit, reread, row audit/errors, 500 limit, isolated mock tests | DONE                                                           |
| First vertical slice     | Keyword PAUSED/ENABLED single + batch                                                                                                                                           | DONE (mock tests; live PPC acceptance NOT RUN)                 |
| Stage 0                  | Campaign-from-brief builder                                                                                                                                                     | NOT DONE                                                       |
| Stage 1 keyword add      | AdGroupCriterion creation, duplicate/conflicts, account-currency optional CPC                                                                                                   | DONE (mock)                                                    |
| Stage 1 status           | Pause/resume W0 preserved                                                                                                                                                       | DONE (mock)                                                    |
| Stage 1 match type       | Create new + pause old, two effects, DEGRADED reporting                                                                                                                         | DONE (mock)                                                    |
| Stage 1 final URL        | Set/replace/clear + recorded-value rollback                                                                                                                                     | DONE (mock)                                                    |
| Stage 1 removal          | Distinct permanent remove preview, warning, approval                                                                                                                            | DONE (mock); NOT reversible                                    |
| Stage 1 negatives        | Campaign/ad-group add/remove, duplicate/conflicts                                                                                                                               | DONE (mock)                                                    |
| Stage 1 shared lists     | Create/members add-remove/attach-detach, separate rereads                                                                                                                       | DONE (mock)                                                    |
| Stage 1 conversions      | Search term → keyword/negative common builders                                                                                                                                  | DONE (mock)                                                    |
| Stage 1 journal/rollback | Stable commit ID, journal filters/cursor, status/final URL inverse preview                                                                                                      | DONE (mock); other rollback unsupported                        |
| Stage 2                  | Дальнейший PPC scope вне этой задачи                                                                                                                                            | NOT DONE; детализация по новому ТЗ перед отдельной реализацией |
| Stage 3                  | Дальнейший PPC scope вне этой задачи                                                                                                                                            | NOT DONE; детализация по новому ТЗ перед отдельной реализацией |
| Stage 4                  | Дальнейший PPC scope вне этой задачи                                                                                                                                            | NOT DONE; детализация по новому ТЗ перед отдельной реализацией |

## Контроль качества / evidence

Mock integration tests: A/B/C preview+validate_only+diff; D approval; E expiry;
F/O stale; G account policy на preview и commit; H batch; I/J partial failure;
K original code + русский message; no-op, replay, foreign key/user, revoke, CAS/concurrency,
missing-row/read-outage, schemas/annotations и default Public read-only.
Meta и Google READ regression покрываются существующими suites; real provider writes — **0**.
Точные итоги команд публикуются в отчёте задачи, без объявления непройденных/live checks PASS.

Primary references:

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

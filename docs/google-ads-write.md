# Google Ads write: W0 foundation и keyword status vertical slice

## Границы реализации

Ветка `codex/google-ads-write-foundation`, база `a00817b746211a295bcb966f7fd7ef12cd6178fb`.
Реализовано только изменение **положительного keyword AdGroupCriterion.status**:
`ENABLED ↔ PAUSED`, один keyword или batch. Кампания и бюджет не изменяются.
`REMOVED`, archive/delete, ставки, объявления, assets, campaign creation и negatives write запрещены.
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

## Future rollback / расширение

Keyword status rollback не реализован как скрытый автоматический reverse mutate.
Будущее восстановление должно быть **новым preview** с актуальным snapshot, validate_only,
browser approval и отдельным audit. Успешные строки partial batch не откатываются автоматически.
Budget/creation/destructive removal будут отдельными typed operations с дополнительными money/destructive policies.

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

| Stage                | Реализовано в этой ветке                                                                                                                                                        | Статус                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| W0 foundation        | Google gate/allowlist, typed status adapter, generic preview + Google validation, secure browser approval, CAS commit, reread, row audit/errors, 500 limit, isolated mock tests | DONE                                                           |
| First vertical slice | Keyword PAUSED/ENABLED single + batch                                                                                                                                           | DONE (mock tests; live PPC acceptance NOT RUN)                 |
| Stage 0              | Campaign-from-brief builder                                                                                                                                                     | NOT DONE                                                       |
| Stage 1              | Negatives/shared lists WRITE                                                                                                                                                    | NOT DONE (существующий READ не считается WRITE)                |
| Stage 2              | Дальнейший PPC scope вне этой задачи                                                                                                                                            | NOT DONE; детализация по новому ТЗ перед отдельной реализацией |
| Stage 3              | Дальнейший PPC scope вне этой задачи                                                                                                                                            | NOT DONE; детализация по новому ТЗ перед отдельной реализацией |
| Stage 4              | Дальнейший PPC scope вне этой задачи                                                                                                                                            | NOT DONE; детализация по новому ТЗ перед отдельной реализацией |

## Контроль качества / evidence

Mock integration tests: A/B/C preview+validate_only+diff; D approval; E expiry;
F/O stale; G account policy на preview и commit; H batch; I/J partial failure;
K original code + русский message; no-op, replay, foreign key/user, revoke, CAS/concurrency,
missing-row/read-outage, schemas/annotations и default Public read-only.
Meta и Google READ regression покрываются существующими suites; real provider writes — **0**.
Точные итоги команд публикуются в отчёте задачи, без объявления непройденных/live checks PASS.

Primary references:

- [Google v24 MutateAdGroupCriteriaRequest](https://developers.google.com/google-ads/api/reference/rpc/v24/MutateAdGroupCriteriaRequest)
- [Google resource service mutates / REST JSON fields](https://developers.google.com/google-ads/api/docs/mutating/service-mutates)
- [Google partial failure and operation-index errors](https://developers.google.com/google-ads/api/docs/best-practices/partial-failures)
- [ProtoJSON field presence/default values](https://protobuf.dev/programming-guides/json/#presence-and-default-values) — positive keyword query explicitly filters negatives; omitted default `negative=false` is accepted.

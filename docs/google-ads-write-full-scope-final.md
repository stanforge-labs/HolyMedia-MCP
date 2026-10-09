# Google Ads Write — итоговая сверка полного scope

Дата аудита: 09.10.2026. Это проверка требований, текущего кода и имеющихся evidence,
не разрешение на provider writes, production merge или deploy.

## Источник и точная база

Оригинал: «ТЗ запись в Google Ads для HolyMedia MCP.docx», дата 05.10.2026.
SHA-256: `51C94D3D2953B32821DC872822147B1FF6C28E36258211D9DDD916BFF2C30DB0`.
Исходный файл не изменялся. В ссылках P1–P336 используются номера OOXML paragraphs,
не выдуманные номера страниц. Полный текст и метаданные:
[original-tz-source-20261009.json](../artifacts/google-full-scope/original-tz-source-20261009.json).

Аудирована ветка `codex/google-ads-write-full-scope-final`, HEAD
`ba0d2059be96624e4d372eb4e548f6716402cd9d` (revision до обновления этой матрицы).
Интегрированы native private OAuth, закрытые profile schemas, tracking clear/default
verification и P244 READ-аудит. Raw provider snapshots/immutable payload не редактируются
ради presentation: media и URL secrets redacted только в response/browser/journal copies.

Построчная матрица 62 областей требований, provider objects, source/test paths и evidence:
[requirements-matrix-20261009.json](../artifacts/google-full-scope/requirements-matrix-20261009.json).

## Как читать статусы

| Класс                  | Значение                                                                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| DONE+TESTED            | Поддерживаемый профиль реализован и имеет локальные/mock tests. Поле live_status отдельно определяет наличие live evidence. |
| DONE+LIVEPENDING       | Реализован и mock/disposable-проверен, но новый профиль ещё требует настоящего TEST live acceptance.                        |
| REQUIREDGAP            | Обязательная часть исходного ТЗ или acceptance gate пока не закрыта.                                                        |
| UNSUPPORTEDbyAPI       | Только доказанное ограничение Google API, не локальная недоработка.                                                         |
| OPTIONALbeyondoriginal | Нет прямого обязательства в оригинале; некоторые расширения отдельно разрешены пользователем и уже реализованы.             |

Количество строк не является процентом готовности: одна строка может объединять
несколько paragraphs. «Имеет тесты» означает наличие соответствующей suite в source;
итоги fresh Linux CI/full quality публикует финальный integration checkpoint, не этот doc-аудит.

## Исторический LIVE и новый код — разные доказательства

[Stage 0+1 final live report](../artifacts/google-live-acceptance/stage01-final-live-acceptance-20261009.json)
подтверждает A/B/C/D/E/F/M/O/P и T/U/V/W в ранее принятом TEST workflow.
Зафиксированы READ **1794**, VALIDATE_ONLY **27**, реальные WRITE **17**, все записи
только в TEST Client `8590146099` под MCC `4378327049`. Refresh учитывался отдельно.
Это не «zero writes all-time» и не live-проверка новых Stage 2–4.

Оба исторических TEST campaigns `24324170853` и `24339483523` — PAUSED.
20 original keywords — ENABLED; дополнительный PHRASE `11479221` — PAUSED.
Campaign/group/RSA — PAUSED. SharedSet `12261567996` содержит 3 EXACT negatives,
активных attachments — 0. Первый fixture commit остаётся historical UNVERIFIED;
отдельный reconciliation — VERIFIED. Эти audit/evidence не изменяются.

[Свежий read-only preflight](../artifacts/google-full-scope/read-only-preflight-20261009.json)
выполнен на runtime source `7da2fbbe7d150072183bc5e121cae4abae019ddc`:
READ **15**, VALIDATE_ONLY **0**, WRITE **0**. Он подтверждает TEST hierarchy и сохранность
fixture, но не runtime нового интеграционного кода. Eligible IMAGE assets — **0**,
conversion actions — **0**. Keyword не имеет explicit CPC override; group CPC — 0.10 USD.
Нельзя подставить group bid как будто это собственный keyword bid для percentage update.

Этот документационный аудит: READ/VALIDATE_ONLY/WRITE **0/0/0**.
Production/main не менялись. Google/Public write flags остаются OFF по умолчанию.

## Реализованные профили

### Общая защита — P27–42

Используются существующие McpPreviewService, browser approval, immutable stored plan,
CAS consumption, provider reread, AuditService и list_change_journal. Второй системы
подтверждения нет. Allowlist, ownership, scopes, TTL, consumed/stale state проверяются
повторно перед commit. Browser approval сохраняет confirmedAt/session/audit; commit
не принимает произвольный новый payload. Local errors не переименовываются в Google errors.

Stage 1/2 independent batches используют partial_failure=true и per-row результаты;
Stage 0 и связанные graph operations — atomic partial_failure=false (P103).
Batch limit 500, duplicate/foreign identities fail closed. Temporary resource IDs
разрешаются точно; verification сохраняет соседние inventories/parent fields.
Неопределённый commit не ретраится: разрешена только read-only reconciliation.

Google currency_constant даёт authoritative currency code/resource/billable_unit_micros;
BigInt conversion и half-up quantization сохраняют requested/effective amount и warning.
Нет FX, Intl-derived precision или придуманных минимальных единиц. Положительная сумма,
округлённая до нуля, и отсутствие независимого currency proof отклоняются.

### Stage 0 — P67–128

Search brief создаёт PAUSED budget/campaign/groups/keywords/RSA, geo/languages,
optional schedule, validated goals/config, negative criteria, supported assets и UTM.
Search Partners и Display expansion OFF; geo default PRESENCE. Non-shared budget name
provider-derived от campaign, а readable display label не является фальшивым provider name.
Positive proximity/radius теперь реализован с typed coordinates и privacy/eligibility validation;
он не был проверен историческим T live и не означает address geocoding.

Stage 0 Search brief использует owned image/logo references. Stage 4 может сначала
создать IMAGE безопасным inline upload; это не означает, что Stage 0 schema принимает binary.
Checklist читает фактические объекты/goals/policy и безопасно проверяет URLs.
Activation отдельная, campaign-only, не включает groups/ads и не обходит FAIL checklist.
Historical T/U/V/W PASS не подтверждает live каждую позднюю feature этого профиля.

Clone P104–106 — обязательный **частично реализованный** профиль:
Search MANUAL_CPC/MAXIMIZE_CONVERSIONS, standard groups, keyword criteria, одно-URL RSA,
known geo/language/schedule, campaign/group negatives, sitelinks/callouts/snippets,
existing image/logo links, совместимые full-category goals/tracking.
Target delivery entities PAUSED; source snapshots входят в stale guard.

Whole clone preview отклоняется, а не молча урезается, при shared-list links,
proximity/audience/device criteria, non-keyword/non-RSA groups/ads, multi-final URLs,
custom/cross-account goals, call/business-name/unknown asset details и неподдерживаемых
networks/bidding/geo modes. Даже поддерживаемый в новом create proximity пока не означает
поддержку clone. Полный clone coverage — REQUIREDGAP, не «Google API не умеет».

### Stage 1 — P134–164

Keyword lifecycle/status/create, match replacement, URLs/clear, irreversible remove,
campaign/group negatives, shared lists и search-term conversion используют common builders.
Mixed status preview показывает HOLYMEDIA snapshot-read error для отсутствующей строки;
валидные rows проходят Google validation, immutable commit не добавляет excluded rows.
Historical live A/B/C/D/E/F/M/O/P закрыты; не требуется повторять их mutations.

In-place смена KeywordInfo запрещена его IMMUTABLE contract в
[официальном v24 AdGroupCriterion proto](https://raw.githubusercontent.com/googleapis/googleapis/master/google/ads/googleads/v24/resources/ad_group_criterion.proto).
Поэтому create-new/pause-old — реализованная семантика, а не недоработка.

### Stage 2 — P166–193

Foundation сохранён: keyword CPC, group CPC/tCPA, daily budget, absolute/percent changes,
shared impact и >50% warnings. Package B уже реализован: шесть Search strategies,
same-account portfolios create/update/attach/detach, поддерживаемые optional clears,
campaign device/geo/schedule/audience modifiers, AdGroupBidModifier local/inherited profile,
performance-filtered bulk с exact money comparisons и замороженной selection.

Auto-bidding совместимость проверяется, а не обещается для всех modifiers. Device0 exclusion
и neutral restore отличаются от ignored bid changes; audience modifier требует OBSERVATION.
Captured explicit positive bid/budget и reversible selected-leaf updates имеют новую inverse
операцию. Для inherited/zero override и создания local device override автоматическое
восстановление наследования/delete inverse не рекламируется. Создания/removals не удаляются
автоматически. G/H/N — mock/disposable PASS equivalents, настоящий live ещё pending.

Manager cross-account portfolios, hotel profiles и arbitrary parameter clears не вытекают
как обязательные из оригинального same-account P182–184. Это явные границы local profile,
не универсальное ограничение Google API.

### Stage 3 — P198–225

Реализованы campaign/group audience add/remove/exclude, named catalog search,
OBSERVATION/TARGETING в preview, contextual custom audiences terms/URLs/apps,
демографические criteria/modifiers, geo name suggestions/include/exclude/proximity,
presence modes, language aliases, timezone schedules и device exclusions.
Updates точечные, без замены соседнего targeting collection.

Отдельный CustomAudienceService не выдаётся за GoogleAdsService operation или fictitious
cross-service transaction. Local channel/criterion incompatibilities явно отклоняются;
фактическую policy/country eligibility проверяет Google validate_only.
Criteria/catalog READ для безопасных writes присутствует. Самостоятельный demographic
performance-report tool не реализован, но P210–212 прямо требуют targeting writes, не такой
отчёт. Customer Match/PII uploads также не являются contextual CustomAudience P207–209.
Live I/J pending.

### Stage 4 — P230–257

RSA create PAUSED/edit через AdService: headlines/descriptions, pins, paths и URLs,
30/90/15 validation, moderation warning; status/remove guard. Text/call/business assets,
owned IMAGE/logo references и safe inline upload, supported customer/campaign/group links;
campaign/group names/dates/networks/status. Campaign ENABLE сохраняет launch-checklist gate.

Inline media только bounded base64 JPEG/PNG: максимум 1MiB/file, 2MiB decoded aggregate,
8 files, 4096 dimension и 16M pixels. Реальные bytes проходят Sharp full decode/reencode,
EXIF/ICC/XMP/trailing bytes не переносятся. Нет arbitrary remote URLs/files/data URIs.
Owned references требуют type/dimensions/ownership proof. Binary остаётся bounded business
data только в immutable transport plan; response/browser/audit/journal summary редактируется
safeMediaSummary, включая embedded image diagnostics. Mock tests не означают live upload PASS.

Tracking account/campaign/group set и typed clear_fields двух известных leaves поддерживаются.
Exact selected field masks сохраняют соседние параметры. Inverse восстанавливает captured
valid value либо typed empty clear, никогда не подставляет выдуманный UTM. Invalid historic
value даёт explicit unsupported inverse. Root normalizer должен принимать omitted empty
protobuf default только для доказанного selected leaf, не менять raw reread.

**P244 implemented/mock-tested:** Google `audit_links_and_utms` / `get_tracking_specs`
подключены к штатному owned ProviderService READ context и private MCP profile. Пять уровней
tracking имеют fixed bounded GAQL, safe redaction и независимое наследование template/suffix.
Tracking preview использует тот же audit algorithm для BEFORE/AFTER exact local/parent
fields; parent snapshots frozen для stale checks. Downstream child URL inventory и landing
reachability не проверяются внутри preview, serving URL/ad context не угадывается.
См. [tracking audit](google-ads-write-tracking-audit.md).

## PMax capability: новый код, не исторический LIVE

Обязательный оригинальный P254–257 профиль теперь включает complete asset-group creation
на existing independently proved PAUSED PMax, texts/images editing, signals/themes и supported
negative/brand exclusions. Дополнительно поздним user authorization разрешён и реализован
full non-retail atomic PAUSED campaign creation; оригинал прямо не требовал retail/feed scope.

| Профиль                         | Реализация и граница                                                                                                                                                                                             |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-retail campaign create      | Atomic budget/campaign/assetgroups/assets/links/goals; PAUSED delivery parents, actual same-account conversion actions, explicit brandGuidelines/EU declaration, authoritative money. Mock-tested; live pending. |
| Complete group on existing PMax | PAUSED parent/owner proof; complete mandatory text/image/logo/business relationships; no campaign/budget/goals mutation. Atomic PAUSED group.                                                                    |
| Branding                        | brandGuidelines=true требует verified campaign LOGO + BUSINESS_NAME; false — full per-group branding. Search BUSINESS_LOGO не подменяет PMax LOGO.                                                               |
| Required assets                 | 3–15 HEADLINE, 1–5 LONG_HEADLINE, 2–5 DESCRIPTION; validated landscape/square/logo bytes or owned refs, exact dimensions/aspect ratio.                                                                           |
| Edit/replace/detach             | Full linked composition snapshot, minimum-remaining checks; atomic text/image replacement; association removal требует warning/ack/manual approval, underlying Asset не удаляется.                               |
| Signals/themes                  | Typed add/remove on owned group with immutable snapshots; no fabricated provider update for immutable signal.                                                                                                    |
| Negatives/brands                | Actual v24 campaign negative criterion and existing owned ENABLED BRANDS SharedSet exclusion. Google validation still controls eligibility. No invented BRAND_HINT enum/new brand registry creation.             |
| Outside profile                 | Retail/Merchant Center feed, travel/local-services special creation; no claim of FULL all-channel PMax. These are not presumed mandatory from P254–257.                                                          |

В текущем TEST client fresh preflight показал IMAGE0 и conversion-actions0. Следовательно
PMax live blocked до valid media/actions и отдельной user-approved TEST preparation;
не разрешено обходить goal/minimum assets ради «live PASS».

## MCP clients и обязательные acceptance gates

Typed private Google write tool profile, annotations/descriptions, structuredContent/text,
REST/OpenAPI fallback реализованы и имеют contract/runtime tests. Внешний /api/v1 routing
не следует путать с внутренним controller route. Tool profile ограничивает registry,
не заменяет authentication/allowlist.

P46 native OAuth Google write identity интегрирован и stock mock-tested: stable
user/client/grant/resource binding, fresh scopes/role/revocation, persisted human approval
session/audit и immutable CAS без ServiceToken подмены. Private issuer требует нового
explicit write consent; existing read-only OAuth не повышается автоматически. Public writes
остаются OFF. См. [native OAuth](google-ads-write-native-oauth.md).

Q — actual ChatGPT, R — actual second MCP client, S — explicit client consent before commit
не закрываются REST/mock tests. Q/R BLOCKED до подключения клиентов; stock human approval
PASS не превращается в cross-client S LIVE PASS. G/H/I/J/K/L/N также имеют только mock
equivalents; новые Stage 2–4 real mutations требуют отдельных approvals.

## Quality, release и оставшиеся шаги

Исторические security/quality evidence не перезаписываются. Pinned source-map/Sharp/Next
remediation остаются в соответствующих датированных документах. Current retained dependency
risk evidence: [moderate-security-risk-assessment-20261009.json](../artifacts/google-full-scope/moderate-security-risk-assessment-20261009.json)
— Critical0/High0, **6 Moderate остаются**; это source audit snapshot, не повторный scan
или production approval этого doc-аудита.

До release: final integrated Linux CI/full tests/format/lint/typecheck/build/Prisma/secret/deps;
реальные native OAuth/client gates; согласованный полный clone profile;
новый TEST live acceptance и реальные Q/R/S. Разделять local code gaps, live gate и Google
eligibility. Не маркировать недоступность TEST данных как отсутствие API capability.

Main/production untouched, flags OFF by default, automatic retries запрещены. После новой
live acceptance оставить campaigns/groups/RSA PAUSED; оставить явно учтённые безопасные
residual test assets/lists, без irreversible cleanup. History сохраняется; каждый reversible
restore — новый preview/validation/human approval/immutable commit/reread/audit.

FULL PPC SCOPE DONE и production RELEASE READY этим отчётом не объявляются.

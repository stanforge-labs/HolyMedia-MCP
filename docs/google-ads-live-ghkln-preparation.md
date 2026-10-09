# G/H/K/L/N: подготовка, не live acceptance

База пакета: `94edb8c3c082bbd8951bf166e8797e83f3b8a5dc`. Этот пакет не создаёт previews, не выдаёт ключи и не вызывает Google. Все intents — план, а не разрешение commit.

Записанная READ-only observation находится в `artifacts/google-full-scope/read-only-preflight-20261009.json`, время `2026-10-09T09:06:01.409Z`. Она выполнена runtime source `7da2fbbe7d150072183bc5e121cae4abae019ddc`, а не новой реализацией Stage 2–4. Нельзя выдавать эту запись за fresh proof нового runtime. Отдельно учитываются её 15 READ / 0 validate_only / 0 writes; подготовительный модуль выполняет 0 вызовов.

Единственный target: TEST Client `8590146099`, MCC для login `4378327049`. Campaign `24324170853`, group `206587491811`. Записаны USD, TEST/hierarchy proof, group CPC `100000`, 20 исходных keywords ENABLED, дополнительный PHRASE PAUSED, campaigns/groups/RSA PAUSED, shared negatives без связей. Fresh canonical v24 reread обязателен перед каждым JIT preview.

## Последовательность и checkpoints

1. Независимая K schema-negative проверка без Google transport.
2. Первый live JIT preview — N. Один scoped key через штатный admin HTTP flow; никакого ручного DB seed. Только после всех prechecks.
3. N: group CPC `0.10 USD → 0.11 USD`, один approved immutable commit. Затем штатный `preview_rollback_commit` по VERIFIED commit ID, новый human approval и отдельный restore до `100000`. До восстановления следующий зависимый write не выполнять.
4. H: DAILY non-shared budget `2 USD → 3.2 USD`, `percent: "60"`. Новый approval, один commit, reread, audit. Затем новый inverse approval и restore до `2000000` micros.
5. L: одна RSA в существующей SEARCH_STANDARD paused group, новый approval. После commit проверить созданный ID, весь текст и PAUSED. Не удалять необратимо автоматически: дополнительный ad остаётся PAUSED и отражается как residual.
6. G возможен только после свежего доказательства подходящего existing keyword; при отсутствии prerequisite — BLOCKED, не переключать стратегию кампании автоматически.

Нельзя держать больше одного pending approval. `preview → validate_only → human approval → immutable commit → provider reread → audit` выполняется последовательно. Перед commit перечитываются persisted confirmedAt, session/audit, TTL, payload digest и stale guards. Ретрай commit, raw cleanup и самостоятельные approvals запрещены. Production/main/deploy не затрагиваются.

## G — +10% keyword CPC при automatic strategy

Из записанной fixture нельзя считать G готовым: explicit keyword override отсутствует; inherited effective CPC нельзя придумывать или использовать как базу процента. Требуются owned positive ENABLED keyword, явный положительный `cpcBidMicros`, `effectiveCpcBidSource = AD_GROUP_CRITERION` с согласованной ставкой и автоматическая/portfolio strategy. Смена MANUAL_CPC → automatic — отдельная операция с отдельным approval, не часть этого пакета.

Typed tool: `google_ads_bid_budget_preview`, поле `keyword_cpc`, `change: {mode:"percent",percent:"10",currency:"USD"}`. Warning обязателен: manual override может не влиять на фактический bid при automatic/portfolio bidding; стратегия не меняется. Exact AFTER micros рассчитывает stock builder по доказанной billable unit, без скрытого FX/rounding. После live проверки нужен отдельный approved inverse. Сейчас conditional intent помечен NOT AUTHORIZED, G — BLOCKED.

## H — +60%, consumer impact

`2000000 → 3200000` micros — план исторической non-shared fixture, не новое provider evidence. Fresh reread должен подтвердить amount, `period=DAILY`, `explicitlyShared=false`, правильную связь с campaign и полный список consumers. Warning `>50%` требуется даже для non-shared budget. Impact не должен молча обрезаться.

Non-shared fixture не доказывает LIVE shared-budget impact. Mock regression отдельно проверяет shared consumers и warning; это не LIVE PASS. Для real shared variant нужна подходящая отдельная TEST fixture/authorization, без превращения текущего budget в shared в этом пакете.

## K и L — RSA contracts

Typed tool: `google_ads_ads_assets_preview`, `action:"rsa_create"`, один item с campaign/group и `rsa`.

K: первый headline ровно 31 ASCII-символ. Ожидается stock closed-schema отказ `google_brief_invalid`, source HOLYMEDIA, field `brief.items[0].rsa.headlines[0].text`, без Google errors/previews/calls. Gate/auth rejection не заменяет acceptance K.

L: 3 headlines <=30, 2 descriptions <=90, публичный HTTPS final URL, безопасный generic TEST copy. Вход не содержит ENABLED/status: builder создаёт RSA PAUSED. Перед preview нужны SEARCH / SEARCH_STANDARD proof, paused parents и current inventory duplicate check. Google validate_only и policy/moderation warnings обязательны. После commit сверить identity, copy, final URL, PAUSED и journal; родители/20 original keywords должны остаться неизменны.

## Encrypted acceptance context

Новый MCP secret хранится только в ciphertext-envelope существующего disposable CredentialVaultService, не в plaintext mode600 JSON. `context-vault.mjs` использует stock AES-256-GCM и тот же disposable key ring; новой криптоархитектуры нет. Preview token и approval URL также находятся внутри ciphertext. Public hints — только безопасные ID/status/expiry/count; не authority. Runtime после decrypt заново проверяет owned key/account/preview binding. Plain legacy read допускается только явно для подтверждённо expired historical preview; новые контексты всегда encrypted. Не печатать decoded payload или ciphertext.

Node mock tests исполняют actual stock vault class с synthetic key ring, проверяют tamper/public redaction и boundaries. POSIX600 runtime reader на Windows ACL-файлах fail-closed; успешное private-file чтение дополнительно проверяется на Linux CI. Ни эти tests, ни scenario plans не являются Google LIVE acceptance.

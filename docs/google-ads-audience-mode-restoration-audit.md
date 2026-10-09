# I: аудит восстановления отсутствующего AUDIENCE restriction

Проверено 2026-10-10: source/code + официальные документы; **provider calls = 0, implementation/live validation = NOT RUN**. Это предложение будущего bounded профиля, не новый разрешённый write surface.

## API поддерживает incremental REMOVE

В [v24 targeting_setting.proto](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/common/targeting_setting.proto) `TargetRestrictionOperation.Operator.REMOVE` существует; `value` содержит удаляемый TargetRestriction. ADD заменяет существующую запись той же targeting dimension. [Официальное руководство](https://developers.google.com/google-ads/api/docs/targeting/targeting-settings) подтверждает операции над отдельными restrictions без передачи всей коллекции. Значит, отсутствие typed REMOVE в HolyMedia — bounded implementation gap, **не ограничение Google API**.

Документы не доказывают, что REMOVE сопоставляет только dimension, игнорируя bid_only. Для безопасного будущего профиля надо отправлять полную фактически прочитанную запись `{targetingDimension: AUDIENCE, bidOnly: true}`; точное поведение, пустой список, missing-entry rejection и preservation соседних dimensions необходимо проверить mock/validate_only и затем отдельно approved TEST live.

## Текущий честный контракт

В `google-ads-stage3.ts` audienceMode записывает ADD с mask `targeting_setting.target_restriction_operations`. Если исходный AUDIENCE отсутствовал либо bid_only не был explicit boolean, automatic inverse не обещается. `audience_remove` удаляет только exact criterion и явно предупреждает, что режим parent остаётся. Closed schema не содержит operation для удаления mode. Нельзя подменять это TARGETING: explicit false не эквивалентен отсутствию собственной restriction/inherited setting.

Предупреждение перед human I approval:

> Будет добавлена аудитория в OBSERVATION (`AUDIENCE bid_only=true`) на уровне TEST ad group. Режим применяется ко всем аудиториям этой группы. После отдельно подтверждённого удаления созданной аудитории критерий исчезнет из активного targeting, но explicit OBSERVATION останется в настройках группы. Точное исходное отсутствие AUDIENCE restriction не восстанавливается текущим stock flow. Другие dimensions и campaign/group/RSA статусы не изменяются.

При пустом audience inventory остаточный OBSERVATION не добавляет новую аудиторию и не сужает охват, но остаётся значимым состоянием для будущих audience additions/модификаторов. Нельзя объявлять exact baseline restoration. Это не произвольный residual object: resource parent уже существовал, изменена его targeting setting. Исторические criterion/audit записи удаления сохраняются.

## Предлагаемый узкий будущий inverse

Только server-created rollback по сохранённому VERIFIED I commit, не публичный arbitrary clear:

1. Сохранить approved parent snapshot, отсутствие собственного AUDIENCE, отсутствие campaign-owned/inherited audience restrictions и исходное пустое audience inventory; exact созданный criterion resource/commit identity. Иные исходные profiles отклонять, не угадывать режим.
2. Новый preview заново доказывает owner/account/association, parent/channel/strategy, полный restrictions snapshot и audience inventory: единственное отличие от исходного — exact созданный criterion и собственный AUDIENCE bid_only=true. Любые дополнительные audience criteria или изменённые neighbors дают stale/unsupported, без тихого пропуска.
3. Atomic plan из exact criterion REMOVE и parent UPDATE с единственной `targetRestrictionOperations: [{operator: REMOVE, value: {targetingDimension: AUDIENCE, bidOnly: true}}]`; leaf mask `targeting_setting.target_restriction_operations`, partial_failure=false. Не заменять целый targetRestrictions array.
4. Новый validate_only, отдельный human approval (criterion removal acknowledgement), persisted session/audit/TTL/stale, immutable commit без retries. При ambiguous result только READ reconciliation.
5. Reread подтверждает criterion REMOVED/отсутствие активной association, AUDIENCE отсутствует, соседние restrictions неизменны, все fixture statuses сохранены. Сравнение empty repeated field omitted/[] допустимо лишь локально для подтверждённого v24 read поля; нельзя глобально ослаблять verifier.

Необходимые регрессии: zero baseline → add OBSERVATION → exact remove+mode restore; соседние dimensions; foreign account/parent; наследование; omitted bid_only; дополнительные audience criteria; changed snapshot; duplicate REMOVE; approved immutable payload; expiry/consumed/session rejection; Google structured error/atomic failure; audit и zero writes при любом guard failure. Для текущего I эта функциональность **не реализована и не LIVE PASS**.

Исходное PPC-ТЗ I требует add/remove в OBSERVATION с явно показанным режимом. Точное восстановление отсутствующего mode — дополнительное требование выбранного recovery workflow; его нельзя объявить выполненным лишь после удаления criterion.

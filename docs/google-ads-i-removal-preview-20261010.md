# I: отдельный controlled removal preview

После VERIFIED add/reconciliation удалять можно только созданный USER_INTEREST criterion `51668099935` в TEST group `206587491811`, campaign `24324170853`, Client `8590146099`. Positive keywords, в том числе `11743561`, не являются removal target.

`run-audience-remove.py` и `audience-remove-runner.mjs` сначала проверяют immutable image/source, protected reconciliation SHA, original consumed VERIFIED preview, DB pending-preview count, owner/key/allowlist, TEST hierarchy и полный свежий snapshot. Только после доказательства consumed state освобождается старый disposable loopback approval gateway; его исторические state/audit files сохраняются. Production, acceptance.env, существующий key/OAuth не изменяются.

Stock Stage 3 build и HTTP MCP preview используют typed `audience_remove` с обязательным `acknowledge_irreversible=true`. Транспорт принимает только одну exact Google validation-only операцию удаления указанного resource и одну stock preview-команду. Все commits, self-approval, actual mutations и другие accounts запрещены. Plan/checks frozen, preview token хранится только encrypted VPS vault. Reread после preview обязан быть идентичен before. Browser UI/session проверяются до JIT preview.

Удаление criterion необратимо в смысле resource identity: пересоздание получит новый ID. Поэтому новое ручное browser approval обязательно. BEFORE — один созданный AFFINITY 90100 criterion ENABLED в OBSERVATION; AFTER — criterion removed, остальные criteria/status/bids сохранены. Parent explicit OBSERVATION остаётся. Нельзя объявлять exact первоначальный absent-mode восстановленным.

Preview implementation/mock regression не равны Google validate_only или LIVE remove PASS. До отдельного persisted human approval реальный removal не разрешён. Перед будущим commit проверяются exact preview/key/session/audit/TTL/stale/payload, используется отдельный one-shot commit transport, без повторной отправки consumed add commit. При любой ambiguity — только read-only reconciliation.

# READ readiness после подтверждённого Acceptance L

Это только READ harness: никаких preview, validate_only, approval, commit или Google mutations. Все write gates остаются OFF. Без opt-in прежняя fixture из трёх delivery RSA остаётся обязательной.

Для единственного исторически VERIFIED L разрешён параметр supervisor:

`--verified-l-context state/stage234-l-commit-20261009T202050Z-lc1/l-verified-evidence.json`

Путь не произвольный. Supervisor проверяет исходный защищённый файл и SHA-256; копирует его в собственный новый private state с mode 600/uid 1000, монтирует read-only `/verified-l/l-verified-evidence.json`. Node повторно проверяет hash, ownership, permissions, отсутствие symlink, exact source/harness/preview/commit/account и VERIFIED result/approval/audit. Неподтверждённый обычный объект не заменяет branded proof.

Исторические source `c11f14c263b8e3a27418d87146b1894c7d9107dc` и harness `9f267cf73d43047aef050a5e54006b6431fa6496` не обязаны совпадать с текущим runtime: это разные честные source pins. Текущий stock API image/revision по-прежнему проверяются отдельно штатным supervisor.

Расширение допускает только original RSA `827349040712` и L RSA `827463920328` в группе `206587491811` campaign `24324170853`. Delivery snapshot содержит ровно четыре известные association, все PAUSED/RSA, с точными resource names и parents. Foreign/extra/duplicate/ENABLED/ad type mismatch запрещены. Только после этого pure I/J scenario view проецируется на original RSA; полный raw fixture digest сохраняет оба и все четыре delivery RSA. Это не произвольное ослабление count/ownership guards.

## Контракт evidence и повторного READ

Файл `/acceptance-state/targeting-readiness-evidence.json` имеет `timestamp`, `result: PASS_READ_ONLY` либо `BLOCKED`, текущие `source_head`, `harness_head`, `image_digest`. Evidence не содержит credentials, raw provider payload либо произвольную metadata.

Экспорт `READINESS_SNAPSHOT_QUERIES` задаёт ровно 11 stock query projections: campaign, group, keywords, ads, groupAudiences, campaignCriteria, deliveryCampaigns, deliveryGroups, deliveryAds, sharedSet, attachments. После самостоятельного READ этих же queries `readinessSnapshotDigest(snapshot)` проверяет наличие массивов, сортирует каждую строку массива по canonical JSON (locale en), сортирует ключи каждого объекта лексически и считает SHA-256. Порядок вложенных массивов сохранён. `snapshot_attestation.sha256` и `verified_l_residual.full_snapshot_digest` используют этот же контракт. Проекции не удаляют L или соседние настройки из full digest.

`fixture_digest` верхнего уровня относится к normalized scenario view; candidate fixture digest использует внутренний контракт соответствующего pure planner. Для будущего I JIT prerequisite необходимо использовать **полный snapshot_attestation** и собственные provider/approval/stale guards, а не подменять full digest этими двумя digest.

G/I/J/PMax диагностика сохраняет существующие bounded READ manifests. Отсутствие подходящего объекта в ограниченной выборке — не доказательство глобального отсутствия. H прежний fixture snapshot не является полным account-wide shared-budget inventory. Этот пакет ничего не создаёт для устранения prerequisite gaps и не объявляет I/J/PMax LIVE PASS.

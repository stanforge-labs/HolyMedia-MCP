# Batch 2 TEST-only maintenance: protected rollback

**Дата:** 17.10.2026 UTC. **Итог: ROLLED BACK, Batch 2 не пройден.** Единственное разрешённое окно использовало план [6ed8c05](BATCH2_TEST_ONLY_MAINTENANCE_EXECUTION_PLAN_20261017.md). TEST Web/API были один раз остановлены и восстановлены на прежних образах. Новые образы не загружались и не запускались; production, Nginx, main, Google Ads, ConversionAction/PMax gates не изменялись. Повтора не было.

## До остановки

- 9/9 контейнеров healthy, restart/OOM flags 0; production `/health` и `/ready` 200, TEST API ready/Web auth/approval 200.
- TEST preview pending/approved/in-flight `0/0/0`, живых OAuth transactions/codes `0/0`, долгих TEST DB transactions `0`.
- Старые immutable TEST API/Web IDs `sha256:35e95779…` / `sha256:5e131625…`; protected Compose SHA-256 `4dab03f890eb4d27a0f42776ec7ac152806ffe6b7e96f877c8d8f265497e51ec`, clone override SHA-256 `bd643bc374c04db473f195976128431966e57e79388f3baebd780cc691e74877`.
- Диск 11 871 MiB free перед остановкой. Локально, без VPS pull, потоково проверены OCI layers: API **623,63 MiB новых распакованных +179,30 MiB compressed**; Web **411,61 +137,23 MiB**. Совокупный консервативный бюджет новых слоёв **≈1 352 MiB** плюс 128 MiB резерв; свежие TEST DB/Redis backup заняли 349 470 B. При подготовке старые образы/конфиги сохранены.
- Свежие root-only backup прошли header, SHA-256 и `pg_restore -l`. Первая проверка `pg_restore -l -` завершилась кодом 1 из-за неверного аргумента `-`; до любой остановки исправлена на чтение stdin без имени файла, **существующий backup повторно проверен без удаления/перезаписи**. Это была ошибка подготовительного инструмента, не сбой DB.

## Единственная остановка и guard

| Показатель | Перед stop, 17:38:28 UTC | После stop, 17:38:31 UTC | Maintenance trace, 17:38:31–33 UTC |
|---|---:|---:|---:|
| MemAvailable | 802 044 KiB | **1 110 544 KiB** | 1 107 264→1 109 028 KiB |
| Изменение RAM | — | **+308 500 KiB = +301,3 MiB** | запас около 281 MiB над 800 MiB floor |
| pswpout | 1 348 078 | 1 348 083 | **0 новых страниц** |
| pswpin | 802 346 | 802 361 | **+251 страниц за 1,1 с** |
| pgmajfault | 680 448 | 680 561 | **+184 за 1,1 с** |
| PSI full / some avg10 | 0,02 / 0,02 | 0,01 / 0,19 | 0,19 / 0,70 |
| OOM | 0 | 0 | 0 |
| Production ready | 200 | 200 | 200, max 0,062 s |

Численные RAM, free swap, disk, PSI full, OOM, production health/latency и strict API `pswpout=0` **не нарушились** в доступном коротком trace. Наблюдатель завершил maintenance-state интервал через 1,1 с: дополнительные rolling caps Web-only профиля (`pswpin >32/60 s`, `pgmajfault >64/60 s`) сработали на `+251/+184`. Trace неполный и по правилу fail-closed имеет статус **FAIL**, а не 600-секундный PASS.

**Ограничение интерпретации:** эти caps проектировались для Web-only trial с работающим полным стеком, а исполнитель применил их также при остановленных TEST API/Web. План maintenance-state требовал контролировать swap-in/faults и отклонять серьёзное *устойчивое* давление, но не утверждал эти Web-only лимиты для этой фазы. Их превышение при PSI full 0,19, нулевом swap-out и неизменной production latency не доказывает опасную нехватку RAM после stop; инициатор page-in неизвестен. Это консервативная ошибка фазового применения политики. Несмотря на неё, сработавший fail-closed guard был соблюдён: **один rollback и STOP**, без трактовки неполного trace как PASS и без второго окна.

## Восстановление

- Автоматический rollback завершился 17:39:04 UTC. Прежние TEST API/Web images снова running/healthy; TEST PostgreSQL/Redis и все пять production контейнеров оставались running/healthy. Проверка production container IDs/images/restart counts относительно protected manifest прошла.
- 17:39:32 UTC: **9/9 healthy**, OOM flags false, restart counts 0; production health `200 / 0,099 s`, ready `200 / 0,158 s`; TEST API/Web/approval `200/200/200`; approvals `0/0/0`.
- После rollback: `MemAvailable 897 708 KiB` (≈876,7 MiB), `SwapFree 1 612 912 KiB`, PSI full avg10 `0,04`, OOM 0, disk free **12 566 MiB**. `pswpout` вырос до 1 348 533 (+450 страниц от after-stop) во время восстановления прежнего полного стека; значит **после rollback нет доказанного full-stack no-swap PASS**. Диск вырос на 695 MiB относительно перед остановкой без удаления image/backup; точный вклад Docker container storage не устанавливался.
- Candidate images отсутствовали до/после окна. Полный 600-секундный post-start guard для новых образов **не запускался**, поскольку до pull сработал maintenance guard. Batch 3, ConversionAction и PMax LIVE остаются заблокированы.

## Evidence и граница следующего решения

Protected evidence остаётся на VPS в `/opt/holymedia-qrs-test/rollback/batch2-maintenance-20261017-once/` (директория 0700, backups/manifest/trace/result 0600): `events.jsonl`, `maintenance-trace.jsonl`, `maintenance-result.json`, `manifest.json`, свежие TEST DB/Redis dumps, сохранённые Compose/override/env, as-run scripts и marker `ROLLED_BACK`. Исполнение было запущено как systemd one-shot с записью evidence на диск; unit завершился `ExecMainStatus=1` после подтверждённого отката. As-run скрипты: `batch2_test_maintenance_once.py` SHA-256 `8c6b61a8dc5c29c924ed69be9ecba8f49d55cf73f298f68247aa0da925942d33`; `batch2_test_maintenance_guard.py` SHA-256 `64c539baf8e2dba4e9280f91fdb950e865599311ea4953b079cc750da7700939`. Эти версии сохранены в репозитории **только как as-run evidence; не переиспользовать без исправления фазовой политики и нового CI**.

Для другой попытки нужен новый отдельный owner decision: определить и проверить maintenance-state критерий для swap-in/major faults без переноса Web-only caps на выключенный TEST, сохранить strict `pswpout=0`, RAM/disk/PSI/OOM/production floors и полный 600-секундный post-start guard. Текущая санкция на одну попытку израсходована. Доказанное освобождение ~301 MiB поддерживает жизнеспособность TEST-only паузы, но **не** доказывает возможность устойчивого полного TEST+production стека на 2 GiB.

# Batch 2 — read-only resource preflight существующего VPS

**Дата:** 17.10.2026 (Asia/Qyzylorda). **Source HEAD на старте:** `729bac97e0c03d5b44a9147e06512d0b2296c6bf`. **Решение: FAIL; cutover не начинать.** Ни один image не загружался, контейнер не останавливался, конфигурация, БД, OAuth и Google Ads не менялись.

## Фактический срез

| Показатель | 16.10 19:58 UTC | 17.10 16:35 UTC / поздний короткий интервал | Guard |
|---|---:|---:|---:|
| MemAvailable | 893 472 KiB | **817 276 KiB**; через ~30 с 820 596→842 264 KiB | минимум 819 200 KiB; один свежий снимок ниже на 1 924 KiB |
| Free swap | 1 602 296 KiB | 1 611 120 KiB | минимум 262 144 KiB — PASS на снимках |
| Free disk | 12 371 MiB | **11 881 MiB** | минимум 10 240 MiB; запас только 1 641 MiB до любого pull |
| PSI memory full avg10 | 0,00 | 0,00 | <1,5 — PASS на снимках |
| OOM kill | 0 | 0 | нет нового OOM |
| Swap I/O за отдельные 30 с | — | **pswpout +21, pswpin +20 страниц**, major faults +22; direct reclaim 0 | исходный TEST API no-swap guard не проходит |
| Production | /health 200, /ready 200 за 0,040 с | 200/200; /ready 0,019 с | health и разовая latency PASS |
| TEST | API ready, Web auth и approval 200 | те же маршруты 200 | все девять обязательных контейнеров running/healthy, OOM flags false, restarts 0 |
| Approval/commit | 0/0/0 | 0/0/0 | pending/approved/in-flight отсутствуют |

Полный 600-секундный read-only observer был начат **один раз** с 2-секундным интервалом и без Docker CLI в цикле. Соединение инструмента оборвалось, итоговый trace/output не получен; позднее процесс наблюдателя уже отсутствовал. Этот интервал **не имеет доказанного PASS**, и второй полный цикл не запускался. Независимый свежий снимок ниже RAM floor и короткая активность swap-out достаточны для решения FAIL. Числа между двумя датированными снимками нельзя интерпретировать как единый 600-секундный delta или приписывать одному процессу.

## Источник давления и бесплатные варианты

На втором снимке `system.slice` занимал около **1 651 MiB**, `user.slice` около **42 MiB**; сохранённый cold swap system.slice около **472 MiB** не равен текущему swap-out. TEST API/Web cgroups занимали около **199,5/130,5 MiB**; production API/Web/Worker около **150,6/107,4/131,1 MiB**. Docker daemon и containerd — примерно **112/111 MiB**, journald — **73 MiB**. Эти величины включают cgroup page cache и не суммируются как независимый RSS; наблюдение показывает конкуренцию полного обязательного стека на ~2 GiB host, но **не устанавливает инициатора** 21 page-out. Активных systemd jobs не было; виден лишь idle `unattended-upgrade-shutdown --wait-for-signal`.

Подготовленная бесплатная TEST Web Bash-healthcheck замена имеет ранее измеренную экономию **приблизительно 54–65 MiB только на кратковременном probe**; снижение постоянного PSS или исчезновение swap-out на VPS не доказано, поскольку candidate не развёрнут. Безопасный вариант после нового полного PASS — последовательно заменить только TEST Web, измерить полный post-start интервал, затем отдельно рассматривать TEST API. Во время pull/start не держать два экземпляра одного TEST сервиса; использовать уже собранные CI images. Адресная очистка *только доказанно неиспользуемого* TEST/Docker build cache могла бы увеличить диск, но RAM не исправляет и в этом read-only batch не выполнялась. Ни cache drop, ни swap cycling, ни ослабление guard, ни остановка production не являются решением.

## Image и rollback capacity

- TEST Web Bash candidate: source `6b212d4bdebd1dcfc191de27a03ad4963c09b7d3`, digest `sha256:3e8b44908bc9f6752ea996aa699da49b91a85953a98f5c41638811719c888669`; реальный OCI manifest содержит **224 723 934 B compressed layers**. Это не отдельный HolyPilot production brand-only image.
- TEST API candidate: source `e5216c8f66a5e6b9c8afd1290b221accff069f41`, digest `sha256:68d718998795dd6a0d6229fda0d747c0cb503dbd625d772542b1edacaf48a76f`; API-only image **705 008 360 B uncompressed**. Его фактический incremental pull на CI runner составил **812 802 048 B ≈775 MiB**. На текущем VPS это оставило бы лишь ~**866 MiB** сверх disk floor *до* Web pull, временной распаковки и новых backup. Shared layers и фактический расход VPS не измерены; резерв нельзя считать подтверждённым.
- Старые TEST API/Web образы продолжают работать, Compose `/opt/holymedia-qrs-test/docker-compose.yml` имеет сохранённый SHA-256 `4dab03f890eb4d27a0f42776ec7ac152806ffe6b7e96f877c8d8f265497e51ec`, mode 0600. В rollback каталоге восемь сохранённых директорий и mode-0600 DB dumps/Compose; последние найденные dump/Redis копии исторические (14.10), **не fresh backup для нового cutover**. Их существование не заменяет проверку нового restore-list/rollback перед разрешённым deployment.

## Точный порядок только для будущего отдельного разрешения

1. Fresh full-stack Web-only profile и отдельно строгий TEST API no-swap profile должны пройти со стабильным запасом RAM/диска, без OOM, с production latency и approvals 0/0/0. Проверить нужный размер temp/unpack, старые image digest/config, создать и проверить свежие TEST-only DB/Redis backup. На текущих данных этот пункт FAIL.
2. После отдельного разрешения на TEST Web: pull pinned Web image, повторить полный post-pull guard; остановить старый Web до единственного нового; проверить login/consent/CSRF/`/auth`/`/mcp/approve` и API connectivity; полный post-start guard. Любая ошибка → один rollback старого Web, без повтора.
3. Только после отдельного разрешения на TEST API: pull pinned API image, повторить **строгий** no-swap guard, остановить старый API до нового, проверить DB/Redis/OAuth/approval. ConversionAction и PMax default-OFF gates взаимоисключающие и требуют **отдельных guarded config activations/restarts**. Каждое нарушение → один rollback; production не меняется. Google writes/Batch 3 требуют собственных JIT approvals.

**Вердикт:** deployment на имеющемся VPS без дополнительных расходов остаётся **CONDITIONAL**, но **небезопасен сейчас**. Даже если будущий тихий интервал даст PASS, последовательная замена требует новых отдельных owner permissions и post-pull/post-start guards; этот документ их не даёт.

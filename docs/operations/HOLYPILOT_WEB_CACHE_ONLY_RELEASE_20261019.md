# HolyPilot: Web release из локального Docker cache

Статус: **одна cache-only попытка выполнена и откатилась на startup guard; новый бренд не опубликован**. Точный результат и protected evidence приведены в `HOLYPILOT_WEB_RELEASE_ATTEMPT_20261016.md`. Повторная загрузка image была исключена; прежний release/recovery механизм сохранён.

## Проверенные исходные данные

- Branding-only source: `fa9805b0adeed1b225e34605b02ad0b67d5ebc33`; candidate RepoDigest и локальный image ID: `sha256:1c39775ffbb095cc7d9037dfbea874be146ad25fe88ce255eaa794b0ccfd9ec0`. Docker `image inspect` на VPS подтвердил этот RepoDigest и OCI revision. Образ уже распакован; новый pull не требуется.
- Текущий production Web: image ID `sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833`, source `a00817b746211a295bcb966f7fd7ef12cd6178fb`; точная старая image reference с digest также доступна локально. Это обязательный rollback.
- Исходный 600-секундный guard остаётся SHA-256 `6f256d9b68bc6c909a6a4754bfda003333fe01ab80027e4c0d5db799374a5fa4`, с прежними RAM, swap, PSI, OOM, disk, health и latency порогами.
- Последний read-only `df`: **11 774 МиБ** свободно. Владелец отдельно утвердил для cache-only release дополнительный immediate preflight **11 500 МиБ**: запас **274 МиБ**. Исходный guard требует **10 240 МиБ**, текущий запас над ним **1 534 МиБ**. Перед исполнением свободный диск проверяется заново.

## Изменённый путь

`scripts/ops/holypilot_web_release_once.py --from-cache <protected-run-dir>` требует явного cache-only режима. До остановки TEST он read-only проверяет оба локальных image через Docker inspect: точные image ID, RepoDigest и OCI source revision. Отсутствующий либо неверный image немедленно блокирует выполнение. Команды `docker pull` и сборки в этом пути отсутствуют. Запуск нового Web и rollback старого Web используют `docker compose up --no-build --pull never`, а оба Web override задают `pull_policy: never`. Поэтому отсутствие cache не вызывает скрытую загрузку.

Исходный release-one script и startup watchdog сверяются по SHA перед подготовкой защищённых копий. Watchdog запускается **до остановки старого Web** и читает host RAM, free swap, PSI, OOM, swap-in/out и major faults каждую секунду через `/proc`. Дополнительно он пишет посекундный защищённый trace с фазами `before`, `starting`, `running`. Если старт нового Web не закончился до окончания 180-секундного watchdog, операция считается FAIL. Это прямое наблюдение в момент `docker compose up`; host-счётчики сами по себе не атрибутируют каждую страницу конкретному контейнеру. Затем выполняются неизменённые 600-секундные post-Web и full-stack guards.

Защита восстановления: прежний production image, исходные container IDs и image IDs, Compose/env/Nginx hashes, защищённые копии и однократный `ExecStopPost` backstop. TEST API/Web останавливаются лишь после отдельного approval, отсутствия активных операций и успешного immediate preflight. Старый и новый Web не работают одновременно. При любом FAIL после начала cutover — один rollback; TEST API/Web восстанавливаются в любом исходе. API, Worker, PostgreSQL, Redis, Nginx, OAuth и Google Ads Write не меняются.

## Локальная проверка и диск

Локальные unit-тесты cache inspect, несовпадений digest/revision/ID, missing image, границы 11 500 МиБ, неполного guard, `--pull never`, rollback override и startup trace — **10/10 PASS**. Исходные защищённые release-one/watchdog файлы были считаны с VPS без записи на него, сверены по SHA и успешно преобразованы в локальной копии; shell syntax и Python compile PASS. На локальном Docker Compose missing-image smoke с `--pull never` завершился отказом `No such image`, контейнер не создавался. Эти проверки не являются production deployment или 600-секундным LIVE PASS.

Read-only Docker accounting: BuildKit cache **0 Б**, APT archives **16 КиБ**, `/tmp` **7,7 МиБ**. Docker показывает 4,518 ГБ reclaimable images, но это не список разрешённых к удалению объектов. В сохранённом storage audit крупные незадействованные images помечены как возможные rollback/evidence; предыдущие очищаемые TEST-кандидаты уже удалены. **Ни один объект на ≥226 МиБ сейчас не доказан безопасно удаляемым.** Никакая очистка не проводилась. Более глубокий `du` или широкая инвентаризация могут сами вызвать memory pressure и не требуются для данного решения.

## Решение и исход попытки

Владелец утвердил 11 500 МиБ исключительно для дополнительного cache-only preflight. Исходный 10 240-МиБ guard, все RAM/swap/PSI/OOM/health пороги и запрет pull остаются неизменными. Снижение дополнительного порога не является разрешением на остановку TEST или production cutover.

Отдельное разрешение на одну остановку TEST API/Web и один guarded production Web cutover было получено и использовано. Exact-source Linux CI для `a25570e92135b5667cf4f85459f23b5114cce1ad` прошёл. Полный pre-cutover guard PASS; startup watchdog обнаружил swap-in +631 страниц за 1 секунду до запуска нового Web и вызвал один защищённый rollback. TEST восстановлен, все девять контейнеров healthy, production Web работает на исходном image. Post-Web и full-stack guards не запускались, поскольку startup guard остановил операцию. Разрешение исчерпано, автоматических повторов не будет.

Production API/Worker/DB, TEST DB/Redis, Compose/env/Nginx и исходный guard не менялись. Production Web был пересоздан при rollback из прежнего image; TEST API/Web восстановлены с прежними container IDs и images. Кандидатный Web не был запущен.

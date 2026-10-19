# HolyPilot: Web release из локального Docker cache

Статус: **код подготовлен; production cutover не разрешён и не выполнялся**. Это продолжение неудавшейся попытки, записанной в `HOLYPILOT_WEB_RELEASE_ATTEMPT_20261016.md`. Повторная загрузка image исключена из нового пути; прежний release/recovery механизм сохранён.

## Проверенные исходные данные

- Branding-only source: `fa9805b0adeed1b225e34605b02ad0b67d5ebc33`; candidate RepoDigest и локальный image ID: `sha256:1c39775ffbb095cc7d9037dfbea874be146ad25fe88ce255eaa794b0ccfd9ec0`. Docker `image inspect` на VPS подтвердил этот RepoDigest и OCI revision. Образ уже распакован; новый pull не требуется.
- Текущий production Web: image ID `sha256:09c08234278a6eee22c866bd260d5c6ddc66806a977afc2e6b51077c0677a833`, source `a00817b746211a295bcb966f7fd7ef12cd6178fb`; точная старая image reference с digest также доступна локально. Это обязательный rollback.
- Исходный 600-секундный guard остаётся SHA-256 `6f256d9b68bc6c909a6a4754bfda003333fe01ab80027e4c0d5db799374a5fa4`, с прежними RAM, swap, PSI, OOM, disk, health и latency порогами.
- Последний read-only `df`: **11 774 МиБ** свободно. Дополнительный immediate preflight в release runner требует **12 000 МиБ**; дефицит **226 МиБ**. Исходный guard требует **10 240 МиБ**, текущий запас над ним **1 534 МиБ**. Эти два порога не смешиваются.

## Изменённый путь

`scripts/ops/holypilot_web_release_once.py --from-cache <protected-run-dir>` требует явного cache-only режима. До остановки TEST он read-only проверяет оба локальных image через Docker inspect: точные image ID, RepoDigest и OCI source revision. Отсутствующий либо неверный image немедленно блокирует выполнение. Команды `docker pull` и сборки в этом пути отсутствуют. Запуск нового Web и rollback старого Web используют `docker compose up --no-build --pull never`, а оба Web override задают `pull_policy: never`. Поэтому отсутствие cache не вызывает скрытую загрузку.

Исходный release-one script и startup watchdog сверяются по SHA перед подготовкой защищённых копий. Watchdog запускается **до остановки старого Web** и читает host RAM, free swap, PSI, OOM, swap-in/out и major faults каждую секунду через `/proc`. Дополнительно он пишет посекундный защищённый trace с фазами `before`, `starting`, `running`. Если старт нового Web не закончился до окончания 180-секундного watchdog, операция считается FAIL. Это прямое наблюдение в момент `docker compose up`; host-счётчики сами по себе не атрибутируют каждую страницу конкретному контейнеру. Затем выполняются неизменённые 600-секундные post-Web и full-stack guards.

Защита восстановления: прежний production image, исходные container IDs и image IDs, Compose/env/Nginx hashes, защищённые копии и однократный `ExecStopPost` backstop. TEST API/Web останавливаются лишь после отдельного approval, отсутствия активных операций и успешного immediate preflight. Старый и новый Web не работают одновременно. При любом FAIL после начала cutover — один rollback; TEST API/Web восстанавливаются в любом исходе. API, Worker, PostgreSQL, Redis, Nginx, OAuth и Google Ads Write не меняются.

## Локальная проверка и диск

Локальные unit-тесты cache inspect, несовпадений digest/revision/ID, missing image, 12 000-МиБ gate, неполного guard, `--pull never`, rollback override и startup trace — **10/10 PASS**. Исходные защищённые release-one/watchdog файлы были считаны с VPS без записи на него, сверены по SHA и успешно преобразованы в локальной копии; shell syntax и Python compile PASS. На локальном Docker Compose missing-image smoke с `--pull never` завершился отказом `No such image`, контейнер не создавался. Эти проверки не являются production deployment или 600-секундным LIVE PASS.

Read-only Docker accounting: BuildKit cache **0 Б**, APT archives **16 КиБ**, `/tmp` **7,7 МиБ**. Docker показывает 4,518 ГБ reclaimable images, но это не список разрешённых к удалению объектов. В сохранённом storage audit крупные незадействованные images помечены как возможные rollback/evidence; предыдущие очищаемые TEST-кандидаты уже удалены. **Ни один объект на ≥226 МиБ сейчас не доказан безопасно удаляемым.** Никакая очистка не проводилась. Более глубокий `du` или широкая инвентаризация могут сами вызвать memory pressure и не требуются для данного решения.

## Решение перед owner approval

При текущих 11 774 МиБ runner остановится до TEST maintenance на дополнительном 12 000-МиБ preflight. Нужен **отдельный выбор владельца**:

1. Сохранить 12 000 МиБ и разрешить только адресную очистку после нового доказательства, что конкретный image не используется для rollback/evidence; либо
2. Отдельно утвердить для cache-only Web release меньший *дополнительный* preflight, например 11 500 МиБ. Исходный 10 240-МиБ guard, все RAM/swap/PSI/OOM/health пороги и запрет pull остаются неизменными. Это решение о запасе диска, а не автоматическое изменение кода или разрешение на cutover.

После выбранного и проверенного решения по диску требуется **новое явное разрешение** на одну временную остановку только TEST API/Web и один guarded production Web cutover. Непосредственно перед ним вновь проверяются cache, source/digests, исходные конфигурации, zero pending operations, health и все immediate guards. После остановки TEST — полный исходный 600-секундный pre-cutover guard без дополнительных SSH/diagnostics. Затем один Web-only cutover, 180-секундный startup watchdog, полный post-Web guard, восстановление TEST, полный 600-секундный guard всех девяти контейнеров и проверка RU/EN, логотипа, слоганов, Astana Hub, auth/OAuth/MCP маршрутов. Любой FAIL — защищённый rollback и STOP без повторов.

Production, TEST, VPS-конфигурации и guard в рамках подготовки этого пакета не изменялись.

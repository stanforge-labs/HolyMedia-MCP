# Локальный Google Ads TEST: повторное использование OAuth-клиента

Дата: 2026-10-19. Source: `88cedba9abce061d42b491d9fe6a51b75309056a`. Это проверка кода, прежних evidence и localhost runtime. Google Cloud Console, VPS и Google Ads API не изменялись и не запрашивались.

## Установлено

1. Исторические Google Ads TEST provider READ и `validate_only` подтверждают, что в TEST раньше существовали работоспособные Google Ads credentials/grant. Это не раскрывает тип OAuth-клиента, Cloud project, список разрешённых callback, текущую пригодность или наличие доступной владельцу копии secret. Нужна проверка в Google Cloud Console.
2. Отдельный Google Login Web client для `https://mcp-test.holymedia.kz/auth/google/callback` подтверждён в [`qrs-test-login-recovery-20261013.md`](qrs-test-login-recovery-20261013.md). Его `openid email profile` относятся к входу пользователя. Этот client нельзя автоматически считать Google Ads client с `adwords`; прежний TEST план специально разделял эти назначения.
3. Google Ads adapter формирует серверный authorization-code flow с `https://www.googleapis.com/auth/adwords` из [`google.ads.ts`](../../apps/api/src/providers/adapters/google.ads.ts). Он передаёт заданный `redirect_uri` и использует Web client secret на сервере. Compose задаёт `http://127.0.0.1:24404/oauth/google/callback`; API callback обработал отрицательный локальный тест и перенаправил браузер на локальный Web `http://127.0.0.1:23300` без вызова Google. Это **точный правильный callback для текущего localhost-профиля**, а не callback Google Login `/auth/google/callback` и не порт Web.
4. Изолированный Compose project `holypilot-google-test-local` на source SHA выше имеет четыре healthy контейнера: Web `127.0.0.1:23300`, API `127.0.0.1:24404`, отдельные PostgreSQL/Redis `127.0.0.1:25432/26379`. Локальный конфигурационный файл защищён режимом `0600`; Google client ID/secret в нём пока отсутствуют. Google OAuth и provider READ **не выполнялись**; writes OFF, allowlist пуст.

## Ответ о повторном использовании

**Условно возможно без создания нового клиента**, если исторический именно Google Ads client является **Web application** в отдельном TEST/nonproduction Cloud project, доступном владельцу, и проект имеет необходимый Google Ads API access. Google разрешает добавлять несколько authorized redirect URI к Web client, включая HTTP loopback IP; значение запроса обязано посимвольно совпадать с зарегистрированным URI. Следовательно, существующий TEST HTTPS callback можно сохранить и **после отдельного разрешения владельца** добавить к этому же клиенту `http://127.0.0.1:24404/oauth/google/callback`. Изменения OAuth-настроек Google могут вступать в силу не сразу. Для используемого здесь серверного flow отдельный JavaScript origin не требуется: браузер открывает страницу согласия, а code обменивает API.

**Нельзя рекомендовать добавление localhost к production OAuth client/project.** Google требует разделять тестовые и production проекты и прямо исключает тестовые redirect URI из production OAuth clients. Если исторический Ads client окажется production, Desktop, неизвестного владельца или его секрет недоступен из разрешённого источника, reuse этого клиента для текущего профиля не подтверждён. Создание другого клиента в этом задании запрещено.

Google Ads TEST customer `8590146099` дополнительно требует: владелец OAuth grant должен иметь доступ к TEST customer либо его TEST manager; при доступе через manager нужен проверенный 10-значный `login-customer-id`; Cloud project/client должен иметь Google Ads API access. Google прямо разрешает повторно использовать OAuth credentials проекта для TEST-аккаунтов. `adwords` scope не является read-only scope; READ-only достигается запретом write в приложении, а не отдельным узким Google scope. TEST аккаунт не генерирует serving conversions/CPA.

## Самый короткий безопасный путь

1. Владелец открывает **Google Auth Platform → Clients** в Cloud project, использовавшемся для Google Ads TEST, и передаёт только несекретные сведения: имя/ID проекта, назначение проекта TEST или production, имя и тип клиента, текущие authorized redirect URI, Google Ads API access и способ доступа его Google пользователя к TEST customer/manager. **Client secret, refresh token, screenshots с ними и файлы VPS не передавать.** Также проверить, что это Ads OAuth client, а не отдельный Google Login client.
2. Если это существующий TEST Web client и localhost URI отсутствует, подготовить точное добавление только указанного URI, сохранив действующий HTTPS callback. Перед этой правкой получить отдельное разрешение владельца. Если URI уже есть, правка Cloud не нужна.
3. Только после подтверждения клиента и разрешения на работу с его credentials владелец вводит действующие client ID/secret из разрешённого источника непосредственно в защищённый локальный WSL-файл, без чата, Git, CI или переноса из VPS. Использовать обычный системный браузер для OAuth, затем выполнить разрешённый READ только по TEST customer. `validate_only` и Google mutations остаются отдельными стоп-точками.

## Проверяемые источники

- [Google Cloud: Web client и правила redirect URI](https://support.google.com/cloud/answer/15549257?hl=en) — localhost HTTP допустим, redirect должен совпадать.
- [Google OAuth: Web server flow](https://developers.google.com/identity/protocols/oauth2/web-server) — точное совпадение URI, authorization-code flow и `state`.
- [Google OAuth: отдельные тестовые и production проекты](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance) — не добавлять тестовые callback в production client.
- [Google Ads TEST accounts](https://developers.google.com/google-ads/api/docs/best-practices/test-accounts) — reuse credentials, доступ пользователя к TEST manager/customer, `login-customer-id`.

Итог: инфраструктура localhost **готова**; существование подходящего **именно TEST Ads Web client не доказано** без read-only Cloud Console metadata. Следующее действие владельца — предоставить эту несекретную метаинформацию. До этого Google OAuth и API-запросы не запускать.

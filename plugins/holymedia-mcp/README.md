# HolyPilot for ChatGPT and Codex

HolyPilot от Holy Media помогает анализировать данные подключённых рекламных кабинетов и веб-аналитики. Публичный MCP предоставляет **41 инструмент чтения**. Наличие данных зависит от подключений и прав вашего workspace; это не обещание LIVE-доступа к каждому провайдеру. Изменение рекламных кампаний через этот публичный коннектор недоступно.

HolyPilot by Holy Media analyzes advertising and web analytics available to your workspace. The public MCP offers **41 read tools**. Results depend on your connected providers and permissions. Public advertising writes are unavailable.

## Install / Установка

Install the portable plugin ZIP in a supported OpenAI plugin client. The root contains `plugin.json`, `mcp.json` and `assets/icon.svg`; there are no hooks, executables, static tokens or local server dependencies. Connect the remote server `https://mcp.holymedia.kz/mcp/public` with OAuth. Approve the requested workspace and read/identity scopes in HolyPilot. The client must use Authorization Code with PKCE S256 and the exact public resource URL. CIMD is preferred; the server also advertises DCR.

Установите ZIP в поддерживаемом клиенте OpenAI, затем подключите удалённый MCP через OAuth. Выберите нужный workspace и подтвердите запрошенные разрешения в HolyPilot. Email передаётся клиенту только при разрешении `email`; неподтверждённый адрес обозначается `email_verified=false`.

The v0.1.1 ZIP is a **draft** until the OIDC code and additive database migration are deployed and signing keys are configured. Do not upload it to the OpenAI portal against the older production OAuth server: production currently returns 404 for OIDC discovery. Existing `/mcp` integrations remain separate.

## Example prompts / Примеры

- «Покажи доступные рекламные кабинеты и источники данных» / “List the ad accounts and data sources I can access.”
- «Сравни расходы и конверсии за два периода и покажи ограничения данных» / “Compare spend and conversions across two periods and explain data limitations.”
- «Покажи поисковые запросы и минус-слова Google Ads в моём клиентском аккаунте» / “Show Google Ads search terms and negatives for my authorized client account.”

Google Ads manager (MCC) accounts cannot return client campaign metrics directly. Choose a client account yourself; HolyPilot does not choose another account automatically. Analytical responses should show dates, currency, source/provenance and relevant data gaps. Demo data is synthetic and must never be described as a live provider result.

## Privacy and support / Конфиденциальность и поддержка

- [Privacy Policy](https://mcp.holymedia.kz/privacy)
- [Terms](https://mcp.holymedia.kz/terms)
- [Support](https://mcp.holymedia.kz/support), mcp@holymedia.kz

The operator keeps OAuth/OIDC and submission checklists outside the portable ZIP in the source repository's `docs/openai-plugin/` directory.

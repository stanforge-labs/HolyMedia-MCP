# HolyPilot for Claude

HolyPilot helps a marketer or business owner ask grounded questions about connected advertising and analytics accounts. The plugin combines the existing HolyPilot remote MCP connector with workflow skills. HolyMedia runs the remote service; this bundle contains no server binary, credentials, customer data, or local executable. The **HolyPilot** brand and circular mark belong to HolyMedia. This is a third-party plugin, not an Anthropic product or an Anthropic endorsement.

## What it does

- Discover accounts and connected sources permitted to your HolyPilot workspace.
- Read campaigns, status, spend, performance, keywords, search terms, GA4 and Search Console data when the relevant provider is connected and its MCP tool is available.
- Build a source-cited analysis or report from returned data. If a source is absent or a tool fails, say so rather than inventing numbers.
- Explain a possible change before any action. The public production MCP profile may expose only READ tools. A skill never turns a missing WRITE tool into an available operation.

**Current boundary:** production Google Ads WRITE remains default-OFF. Historical Google Ads TEST write acceptance does not make Google Ads WRITE available from this public plugin endpoint. The public endpoint's Meta change preview/commit tools are also gated and may be absent. When any controlled WRITE tool is available in a separately authorized environment, the user must review a server-created preview in HolyPilot, grant separate OWNER browser approval, and then make a new explicit commit request. Claude's own tool permission prompt is additional and does not replace HolyPilot approval. Never retry an uncertain commit blindly.

## Install and connect / Установка и подключение

1. In Claude Pro or another supported paid plan, open **Customize → Plugins → Add → Upload plugin** and select the ZIP of this folder. Uploading a plugin to your own account does not publish it in the directory.
2. Open the HolyPilot plugin's **Connectors** tab, add the HolyPilot connector if shown as **Not added**, then select **Connect**. Sign in to your own HolyPilot account in the browser. Review the workspace and requested READ scope before consenting. Never paste an OAuth token into Claude or this ZIP.
3. Confirm the connector is **Connected**. Ask: “Which advertising accounts are connected to my workspace?” The answer must come from a HolyPilot MCP READ result. If there is no connected provider or the remote endpoint is unavailable, stop and report that state.
4. Ask for a campaign summary for a selected account and time range. Verify the account name, period, units, and source before acting on the result.
5. To inspect write permissions, ask which tools the connected MCP session actually exposes. Do not request an advertising change unless a preview tool is listed, the correct account and OWNER role are confirmed, and the user explicitly requests that change. Preview itself does not change the provider. The browser approval and a separate commit are required for a change.

Русский старт: откройте **Настроить → Плагины → Добавить → Загрузить плагин**, загрузите ZIP, затем подключите HolyPilot через вкладку **Коннекторы**. В браузере войдите в HolyPilot, выберите своё рабочее пространство и подтвердите показанные права. Первый безопасный запрос: «Какие рекламные кабинеты подключены к моему рабочему пространству?» Если подключения или данных нет, HolyPilot не должен придумывать ответ.

## Example requests / Примеры запросов

1. “Show campaigns and spend for the connected account over the last 30 days. Identify the period and currency.” / «Покажи кампании и расходы подключённого кабинета за 30 дней; укажи период и валюту».
2. “Compare this month with the preceding period and identify changes supported by the returned metrics.” / «Сравни этот месяц с предыдущим периодом и выдели подтверждённые метриками изменения».
3. “Review Google Ads search terms for an account I can access; propose negatives as suggestions only.” / «Разбери поисковые запросы Google Ads и предложи минус-слова только как рекомендации».
4. “Prepare a concise management report from the available READ results, listing missing sources and caveats.” / «Подготовь отчёт для руководителя по доступным данным, перечисли недостающие источники».
5. “Explain what a pause preview would change and whether the server currently offers that tool; do not commit.” / «Объясни возможное изменение статуса и наличие preview-инструмента; ничего не применяй».

## Data and access

The remote connector is `https://mcp.holymedia.kz/mcp/public`, operated by HolyMedia. It receives authenticated MCP requests and may return account, campaign, performance, analytics, and report data in the connected workspace. The plugin sends no data to another endpoint and runs no local program. Its skills contain instructions only. Use the public [Privacy Policy](https://mcp.holymedia.kz/privacy), [Terms](https://mcp.holymedia.kz/terms), and [Support](https://mcp.holymedia.kz/support) for service details. Provider availability and account rights determine which READ calls succeed.

## Installation limits and support

The bundle is prepared for manual upload. Compatibility in a real Claude Pro account, its OAuth consent screens, client-side permission prompts, and directory review require separate owner action and have not been asserted by local validation. The directory submission also requires a GitHub repository containing only this publishable folder, a linked GitHub account with push access, portal validation and review. No repository or listing is created by this package.

If the connector shows **Not connected**, complete browser OAuth. If the server returns an access error, verify your workspace and provider connection in HolyPilot; do not replace OAuth with a service key. For help use [HolyPilot Support](https://mcp.holymedia.kz/support).

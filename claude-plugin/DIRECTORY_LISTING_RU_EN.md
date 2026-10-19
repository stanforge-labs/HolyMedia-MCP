# HolyPilot — directory listing draft

This is editable submission copy, not a live Anthropic listing. The portal reads final name/description and README from the reviewed GitHub commit. Confirm the final wording before publishing.

## English

- **Name:** HolyPilot
- **Publisher:** HolyMedia
- **Short description:** Analyze connected advertising and analytics data in Claude with workspace-aware HolyPilot MCP tools and guided workflows.
- **Long description:** HolyPilot helps marketers, agencies, and business owners inspect authorized advertising accounts, compare performance, review search terms, and prepare source-grounded reports. Skills guide the sequence; the HolyPilot MCP connector supplies the actual data. Available operations depend on each connected provider, workspace rights, and the live tool list. The public production profile is read-oriented; Google Ads WRITE remains default-OFF. Any separately enabled controlled action requires a server preview, HolyPilot OWNER browser approval, and a distinct commit request. No tool or skill can bypass those gates.
  **Example prompts:**

1. “List the advertising accounts available in my workspace and summarize campaigns for the selected account.”
2. “Compare campaign performance for these two periods, stating the source, currency, and missing metrics.”
3. “Review available Google Ads search terms and propose optimization hypotheses without making changes.”
4. “Create a concise management report from available READ data; identify unavailable providers.”

- **Category suggestion:** Marketing / Analytics.
- **Homepage:** https://mcp.holymedia.kz/
- **Support:** https://mcp.holymedia.kz/support
- **Privacy:** https://mcp.holymedia.kz/privacy
- **Terms:** https://mcp.holymedia.kz/terms

## Русский

- **Название:** HolyPilot
- **Разработчик:** HolyMedia
- **Краткое описание:** Анализ рекламных и аналитических данных в Claude через инструменты HolyPilot MCP с проверкой прав рабочего пространства.
- **Полное описание:** HolyPilot помогает маркетологам, агентствам и владельцам бизнеса изучать доступные рекламные кабинеты, сравнивать показатели, анализировать поисковые запросы и готовить отчёты по фактическим данным. Skills объясняют порядок работы; данные поступают только из подключённого HolyPilot MCP. Набор операций зависит от прав workspace, подключённых платформ и текущего списка инструментов. Публичный production-профиль ориентирован на чтение; Google Ads WRITE по умолчанию выключен. Если отдельное контролируемое изменение доступно, требуются preview, подтверждение OWNER в браузере HolyPilot и отдельный commit-запрос.
  **Примеры запросов:**

1. «Покажи доступные кабинеты и кампании выбранного аккаунта».
2. «Сравни эффективность двух периодов, укажи источник, валюту и недостающие метрики».
3. «Изучи поисковые запросы Google Ads и предложи гипотезы без изменений кабинета».
4. «Подготовь краткий отчёт по доступным READ-данным и отметь отсутствующие источники».

- **Категория:** Маркетинг / Аналитика. Публичные ссылки те же, что в английской карточке.

## Data handling answers to prepare with the owner

- HolyPilot may read workspace membership, connected account metadata, advertising/analytics results, and OAuth grant state needed for the requested task. It stores service-side accounts, connection metadata, audit and approvals according to the public Privacy Policy; confirm exact retention periods with the owner before portal submission.
- The plugin contains no local process, static secret, or customer dataset. It communicates only with `https://mcp.holymedia.kz/mcp/public`. Authorized provider requests happen server-side through HolyPilot; Claude receives the resulting data that the user requested.
- It is not designed for children. The owner must confirm the portal's precise age/use wording and all legal acknowledgements.

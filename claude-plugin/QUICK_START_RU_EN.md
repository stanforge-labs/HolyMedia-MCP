# HolyPilot Claude Plugin — quick start / быстрый старт

## RU

1. В Claude Pro откройте **Customize → Plugins → Add → Upload plugin** и выберите `HolyPilot-Claude-Plugin-0.1.0.zip`.
2. Откройте HolyPilot → **Connectors**. Добавьте коннектор, если он отмечен «Not added», затем нажмите **Connect**. Пройдите личный вход и OAuth-согласие в браузере HolyPilot; проверьте рабочее пространство и запрашиваемые READ-права. Не передавайте токены в чат.
3. Спросите: «Какие рекламные кабинеты доступны моему workspace?» Ответ должен опираться на MCP READ-вызов. Затем запросите кампании выбранного кабинета за точный период.
4. Если хотите проверить возможное изменение, сначала попросите перечислить фактически доступные MCP-инструменты. При отсутствии preview-инструмента изменение недоступно. Если preview доступен и пользователь отдельно запросил действие, проверьте BEFORE/AFTER и TTL, затем сами откройте HolyPilot browser approval. Только после этого возможен новый отдельный запрос на commit. Claude permission prompt не заменяет browser approval.
5. Для публикации откройте [developer portal](https://claude.ai/directory/manage): потребуется отдельно представить MCP connector и Plugin Bundle, исходный минимальный GitHub-репозиторий, сведения об обработке данных, контакты и подтверждение условий. Никакая подача в каталог в рамках этого пакета не выполнена.

## EN

1. In Claude Pro, open **Customize → Plugins → Add → Upload plugin** and select `HolyPilot-Claude-Plugin-0.1.0.zip`.
2. Open HolyPilot → **Connectors**. Add the connector if marked **Not added**, then **Connect**. Complete your own HolyPilot browser sign-in and OAuth consent. Check the workspace and READ scope; never paste tokens into chat.
3. Ask: “Which advertising accounts can my workspace access?” Require a grounded MCP READ answer. Then ask for campaigns in a selected account and explicit period.
4. Before any possible change, inspect the tools actually exposed in this session. If there is no preview tool, the action is unavailable. If one is exposed and the user separately requests a change, inspect BEFORE/AFTER and expiry, complete HolyPilot browser approval yourself, and make a separate commit request. Claude's tool prompt is not HolyPilot browser approval.
5. For directory submission, use the [developer portal](https://claude.ai/directory/manage). Anthropic asks for the remote MCP connector and Plugin Bundle as separate submissions, a minimal GitHub repository, data-handling answers, a contact, and policy acknowledgements. This package has not been submitted.

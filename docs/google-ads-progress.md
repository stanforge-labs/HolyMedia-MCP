# Google Ads — ход работ

## Этап 1 — разведка

- Дата: 2026-10-01.
- Ветка/worktree: `codex/google-ads-ppc` / `C:\Users\Станислав\Documents\MCP\mcp-for-ads-google-ads-ppc`.
- База: актуальный после `git fetch origin` `origin/main` = `d88ac55d767f713f53932ea62673b09505b51f17` (совпадает с указанным production SHA).
- Статус: **PASS — все 8 пунктов разведки выполнены; дальнейшая работа остановлена для человеческой проверки.** `GOOGLE_ADS_PLAN.md` механически извлечён из исходного DOCX; 306 абзацев и 3 таблицы проверены на наличие в Markdown. Других стадий и production-кода не касались.
- Проверено: MCP tool registry/provider routing/capabilities, Meta preview–confirm–commit/policies/TTL/audit, V2 Google REST/OAuth/MCC/developer-token/config, все найденные V2 и legacy GAQL, 5 запрошенных execution paths и известные ошибки, official Google Ads v24 field reference, read-only diff Public MCP ветки. Подробности и точные файлы: `docs/google-ads-notes.md`.
- Baseline: `pnpm install --frozen-lockfile` PASS; `pnpm typecheck` PASS; `pnpm lint` PASS; `pnpm test` PASS. Повтор без Turbo cache: `pnpm exec turbo run typecheck --force` PASS 15/15, `lint --force` PASS 10/10, `test --force` PASS 15/15 (API: 287 passed, 20 skipped). Legacy Python `PYTHONPATH=.;src` + `python -m pytest -q tests/unit`: PASS 238 passed, 1 skipped. Первая попытка standalone `pytest` без корня в `PYTHONPATH` имела collection error; исправление команды убрало его, код не менялся. Integration/live provider tests не выполнялись.
- Расхождения: V2 Google — прямой REST (не client library); developer token всё ещё локально обязателен и посылается, хотя Google sunset его 09.09.2026; default API `v24`, production override неизвестен; Meta preview TTL 10 минут, confirm связан с service token, а универсального Google per-operation write/rollback нет; V2 Google read игнорирует часть фильтров/уровень, а campaign cost-per-conversion/currency нормализуются неверно. Контрольные live-цифры PPC и Console approval не перепроверялись.
- STOP CONDITIONS: этап 6 требует изменения общей `McpPreview` DB schema и preview/commit/audit кода, затрагивающего Meta; Public MCP branch `3405c5c2c27926057933a7e05908d4d59f632c0a` уже меняет те же области. **PUBLIC MCP INTERSECTION: HIGH.** Для этапа 6 нужен отдельный архитектурный выбор человека. Библиотека V2 не требует обновления для удаления developer-token header (её там нет); legacy Python dependency может потребовать отдельного решения, но сейчас не обновлялась.
- Следующий предполагаемый этап после явного разрешения пользователя: этап 2, только read fixes и без реальных provider writes; до него сверить `docs/google-ads-notes.md` и разрешить stop conditions для будущего этапа 6. Сейчас этап 2 **не начат**.
- Commit: отдельный документальный коммит этапа 1; его SHA приводится в финальном отчёте (самореферентный SHA в коммите не хранится).

## Этапы 2–9

Не начаты по прямому ограничению задачи. Никаких Google/Meta provider calls, `mutate` или `validate_only` не выполнялось; push/deploy отсутствуют.

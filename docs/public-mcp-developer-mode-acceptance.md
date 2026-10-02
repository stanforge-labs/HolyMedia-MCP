# Public MCP Developer Mode acceptance (disposable run)

This checklist is for the manual, read-only ChatGPT Developer Mode acceptance run. It is not a production or staging deployment. The workflow uses an isolated GitHub runner, PostgreSQL 18, Redis, a disposable user, and a temporary HTTPS tunnel. It does not connect provider accounts. Do not paste the acceptance email, password, OAuth codes, tokens, or screenshots containing them into issues, logs, or chat.

## Disposable network topology

- API: `0.0.0.0:4000` **inside the disposable GitHub-hosted runner only**. This is the application's existing bind; it is not the public endpoint.
- Web: `127.0.0.1:3000` inside the runner.
- Acceptance gateway: `127.0.0.1:8787` inside the runner.
- Public: temporary ngrok HTTPS URL → **gateway only** → local API/Web routes. The workflow verifies ngrok's actual upstream target from its local metadata and rejects any target other than `127.0.0.1:8787`.

Do not test the runner's public IP or forward ngrok directly to ports 4000 or 3000. [Official OpenAI documentation](https://developers.openai.com/plugins/deploy/connect-chatgpt) requires a reachable public HTTPS MCP endpoint or supported tunnel for Developer Mode testing; it does not prescribe the internal API listener address.

## Before starting

1. Add `NGROK_AUTHTOKEN`, `PUBLIC_MCP_ACCEPTANCE_EMAIL`, and `PUBLIC_MCP_ACCEPTANCE_PASSWORD` in Repository → Settings → Secrets and variables → Actions → New repository secret. Do not put their values in workflow inputs or chat.
2. Once all three are set, tell the operator `SECRETS READY`. Only then, as a **separate action**, refresh origin, verify the integration HEAD, create `codex/public-mcp-developer-mode-run` from that exact HEAD, add one empty commit (`ci: start disposable Public MCP developer-mode run`), and push that branch. Do not add more commits to it during acceptance. The workflow's `push` filter does not match `main`, the integration branch, or other feature branches.
3. Confirm the workflow run is on `codex/public-mcp-developer-mode-run`, its source-integrity job and public preflight step passed, and it is descended from the prepared integration commit. Do not use the production MCP URL.
4. Copy only `PUBLIC MCP DEVELOPER URL` from the run summary. The URL is ephemeral. The environment stays alive for 60 minutes after preflight; cancellation or expiry destroys it.
5. In ChatGPT, open Settings → Security and login → Developer mode, turn it on, then Plugins → +. Enter the public `/mcp/public` URL and create the connection. Log in using the credentials whose values were added as repository secrets. Never record those values in the results below.

Do not create the temporary run branch before human confirmation that the secrets are ready. The workflow also fails early with only a missing secret's **name** if one is absent. `workflow_dispatch` remains in the file for future use but is not needed for this push-triggered run; GitHub's [manual workflow rule](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) still requires default-branch registration for manual dispatch. Do not add this workflow to `main` or merge the integration branch.

## Connection and safety checklist

For each item, record PASS/FAIL and a brief, non-sensitive observation. Do not mark a step PASS from the automated preflight alone.

| ID  | Manual observation                                                                                                                                                                               | PASS/FAIL and safe note |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| A   | MCP connection is created successfully.                                                                                                                                                          |                         |
| B   | OAuth linking starts.                                                                                                                                                                            |                         |
| C   | HolyMedia login opens on the same temporary tunnel origin.                                                                                                                                       |                         |
| D   | The disposable acceptance user can log in.                                                                                                                                                       |                         |
| E   | Consent displays READ access.                                                                                                                                                                    |                         |
| F   | Consent does **not** offer write access.                                                                                                                                                         |                         |
| G   | OAuth callback completes.                                                                                                                                                                        |                         |
| H   | The plugin status becomes Connected.                                                                                                                                                             |                         |
| I   | Tool discovery includes reviewed Public MCP read tools, including `google_ads_list_keywords`, `google_ads_search_terms`, `google_ads_list_negatives`, and `google_ads_check_negative_conflicts`. |                         |
| J   | “Покажи доступные возможности Google Ads” selects an appropriate read capability/tool path.                                                                                                      |                         |
| K   | Reading account data without a provider connection gives an understandable empty/not-connected result, not HTTP 500 or invented data.                                                            |                         |
| L   | “Поставь кампанию на паузу” performs **no** provider write; write is unavailable, insufficiently scoped, or disabled.                                                                            |                         |
| M   | Legacy `/mcp` remains available for its existing auth boundary; do not link or exercise it using the Public MCP token.                                                                           |                         |
| N   | RU and EN auth/approval pages open (`/auth`, `/en/auth`, `/mcp/approve`, `/en/mcp/approve`).                                                                                                     |                         |

Do not enable the write scope or controlled-write flags, connect a real provider, create a real Meta preview, or confirm a write. An empty/not-connected provider result is expected; it is not a live provider result.

## Tool-selection evaluation

Record the selected tool, arguments (redact identifiers and all tokens), result, and PASS/FAIL for every prompt. A good result selects a suitable read tool or clearly explains why data is unavailable. Do not interpret tool discovery alone as proof that ChatGPT selects the right tool.

| Type          | Prompt                                                                  | Selected tool | Sanitized arguments | Result | PASS/FAIL |
| ------------- | ----------------------------------------------------------------------- | ------------- | ------------------- | ------ | --------- |
| Direct 1      | Покажи доступные возможности Google Ads.                                |               |                     |        |           |
| Direct 2      | Покажи ключевые слова Google Ads в подключённом аккаунте.               |               |                     |        |           |
| Direct 3      | Найди поисковые запросы Google Ads за последние 7 дней.                 |               |                     |        |           |
| Direct 4      | Покажи минус-слова и проверь конфликты с ключевыми словами.             |               |                     |        |           |
| Indirect 1    | Какие запросы тратят бюджет, но не приносят конверсий?                  |               |                     |        |           |
| Indirect 2    | Не мешают ли мои минус-слова показам по нужным запросам?                |               |                     |        |           |
| Unsupported   | Предскажи точный ROAS на следующий год без данных и доступа к аккаунту. |               |                     |        |           |
| Write request | Поставь кампанию на паузу.                                              |               |                     |        |           |

The prompts are selection and argument-schema checks, not requests for live Google Ads data. The unsupported prompt should not fabricate a forecast. The write prompt must not mutate anything.

## After acceptance

1. Mark the connection and evaluation rows. Record only non-sensitive findings, the workflow run URL, and the tested run-branch commit SHA. Do not save token-bearing screenshots.
2. Check the sanitized gateway/API artifact, if present, for `Bearer`, `Authorization`, `Cookie`, `CSRF`, `oauth code`, `access_token`, `refresh_token`, `hmap_`, and preview tokens. The artifact intentionally contains only allowlisted method, coarse pathname, status, and duration fields. Never publish raw runner logs.
3. Cancel the run if finished early, or let its 60-minute window expire. Confirm the tunnel is no longer usable. The runner and its disposable database/services are then torn down. Delete the temporary run branch only in a later, separately authorized cleanup step; preserve the integration branch.

OpenAI's [Developer Mode deployment guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) describes the plugin connection flow and prompt-based evaluation. GitHub's [manual workflow guide](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow) documents the default-branch registration requirement.

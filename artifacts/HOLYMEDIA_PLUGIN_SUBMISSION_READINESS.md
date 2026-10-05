# HOLYMEDIA MCP PLUGIN SUBMISSION READINESS

Checked: 2026-10-05. Final read-only pre-production preparation passed. Review cases are prepared, not executed against advertising providers. Support and transport results below are local checks, not production acceptance.

| Field                                   | Result                                                                                                   |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| SOURCE HEAD                             | `a00817b746211a295bcb966f7fd7ef12cd6178fb`                                                               |
| PACKAGE BRANCH                          | `codex/holymedia-plugin-package`                                                                         |
| PACKAGE FORMAT                          | Portable Agent Plugins                                                                                   |
| PLUGIN VERSION                          | 0.1.0                                                                                                    |
| PLUGIN.JSON                             | PASS: valid UTF-8 JSON and official portable JSON Schema                                                 |
| MCP.JSON                                | PASS: valid UTF-8 JSON and official portable JSON Schema                                                 |
| MCP URL                                 | https://mcp.holymedia.kz/mcp/public                                                                      |
| MCP SERVER KEY / TRANSPORT              | `holymedia` / `streamable-http`                                                                          |
| OPENAI METADATA                         | PASS against documented field names and final listing text limits; support URL present                   |
| SUPPORT                                 | READY: RU/EN code and local browser checks passed; requires separate production deployment               |
| SUPPORT URL                             | https://mcp.holymedia.kz/support                                                                         |
| PLUGIN PACKAGE                          | READY for the configured future production endpoint, not final submission                                |
| NGROK REFERENCES                        | 0 in package and ZIP                                                                                     |
| STAGING REFERENCES                      | 0 in package and ZIP                                                                                     |
| SECRETS FOUND                           | 0 in package and ZIP                                                                                     |
| POSITIVE TEST CASES                     | 5                                                                                                        |
| NEGATIVE TEST CASES                     | 3                                                                                                        |
| STARTER PROMPTS                         | 3                                                                                                        |
| LOGO                                    | READY: official repository SVG, square 120 by 120 viewBox                                                |
| DEMO VIDEO                              | MISSING: DEMO RECORDING REQUIRED                                                                         |
| REVIEWER CREDENTIALS                    | NOT CONFIGURED; NOT IN ZIP; enter separately in the secure dashboard form                                |
| BUSINESS VERIFICATION                   | EXTERNAL BLOCKER; verification status was not accessed                                                   |
| PRODUCTION PUBLIC MCP                   | NOT DEPLOYED; no production acceptance performed in this task                                            |
| CONTROLLED WRITE TOOLS VISIBLE          | NO with write scope disabled; local inventory and HTTP tests verified                                    |
| VISIBLE PUBLIC MCP TOOLS                | 42, actual compiled registry result with scope OFF                                                       |
| SCAN TOOLS                              | NOT RUN                                                                                                  |
| DOMAIN VERIFICATION                     | NOT RUN                                                                                                  |
| PUBLICATION COUNTRIES                   | USER DECISION REQUIRED; omitted from manifest                                                            |
| ZIP ROOT STRUCTURE                      | PASS                                                                                                     |
| ZIP CRC / SOURCE BYTE MATCH             | PASS                                                                                                     |
| ZIP                                     | `artifacts/holymedia-mcp-plugin-0.1.0.zip`                                                               |
| ZIP SIZE                                | 2810 bytes                                                                                               |
| ZIP SHA256                              | `caa62fc3abd94ef7581e2165b4d8734bdc86d469ead13ae8153aed112b419670`                                       |
| PRODUCTION DEPLOY                       | NO                                                                                                       |
| PRODUCTION CHANGED                      | NO                                                                                                       |
| PROVIDER CALLS                          | 0                                                                                                        |
| PROVIDER WRITES                         | 0                                                                                                        |
| OPENAI UPLOAD / SUBMISSION              | NOT PERFORMED                                                                                            |
| FINAL SUBMISSION READY                  | NO                                                                                                       |
| FINAL ZIP READY FOR PRODUCTION ENDPOINT | YES as a prepared draft targeting the future production endpoint; deployment and submission gates remain |
| FINAL STATUS                            | READ-ONLY CODE AND DRAFT PACKAGE READY                                                                   |

## Legal and product URLs

| Purpose    | URL                                 | HTTP result and content                                                  |
| ---------- | ----------------------------------- | ------------------------------------------------------------------------ |
| Website    | https://mcp.holymedia.kz/           | Existing product URL; not rechecked live in this task                    |
| Support RU | https://mcp.holymedia.kz/support    | Local production build: HTTP 200, RU heading, canonical and contact PASS |
| Support EN | https://mcp.holymedia.kz/en/support | Local production build: HTTP 200, EN heading, canonical and contact PASS |
| Privacy    | https://mcp.holymedia.kz/privacy    | RU/EN local HTTP 200; existing route and policy content unchanged        |
| Terms      | https://mcp.holymedia.kz/terms      | RU/EN local HTTP 200; existing route and terms content unchanged         |

Support is implemented using the existing public legal layout, with five concise sections, localized footer and legal links, and the confirmed contact `mcp@holymedia.kz`. That email already appears in `apps/web/app/components/privacy-copy.ts` and `legal-content.tsx`; no contact or SLA was invented. Desktop/mobile RU/EN Playwright checks passed 4/4, including canonical URLs, locale, headings, mailto, legal links, absence of horizontal overflow, and zero axe violations in the support article. This does not establish production reachability or legal sufficiency.

The publisher name `Holy Media` is present in existing project copy in `apps/web/app/components/tariff-catalog.tsx` (the Holy Media team). No legal entity name was invented. Business verification required before publishing under Holy Media business identity is an external OpenAI account step.

## Package contents and validation

The ZIP has exactly these files at its root:

```text
plugin.json
mcp.json
assets/icon.svg
```

No enclosing package directory, app references, compatibility manifest, lifecycle hooks, screenshots, source code, internal documents, environment files, credentials, logs, migrations, tests, or development files are included. This readiness report is outside the ZIP. The archive is retained locally and is not committed to Git.

Both manifests were validated with `jsonschema` against the current schemas fetched from:

- https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
- https://agent-plugins.org/schemas/1.0.0/mcp.schema.json

The portable schema treats extension data generically, so OpenAI extension field names and limits were also checked against the [official submission documentation](https://developers.openai.com/plugins/deploy/submission), refreshed in this task. `extensions.com.openai.interface.supportURL` now contains the HTTPS support page URL. The short description remains `Read connected ad data`, within the 30-character final listing limit. Exactly five positive and three negative cases use the documented review fields; negative expectations are recorded in each case description. The pause request explicitly expects write operations to be unavailable in this read-only release and does not mention hidden implementation. Demo URL and publication countries are omitted. Release notes remain under `extensions.com.openai.publication.release_notes`.

The manifest lists only verified public read capabilities for Google Ads, Meta Ads, Google Analytics 4 and Search Console. It does not claim that provider writes are available.

`assets/icon.svg` is an unchanged submission copy of `apps/web/app/icon.svg`. It contains only SVG/group/path elements, has a square 120 by 120 viewBox, and contains no scripts, external image references, embedded metadata, or credentials. Both `logo` and `composerIcon` point to `./assets/icon.svg`. No artwork was generated.

Recursive package and archive scans found zero occurrences of the prohibited development origins and credential markers listed in the brief. Archive entries match the source package bytes and pass ZIP integrity checks.

## Public MCP tool annotation audit

Audit basis: compiled integration source at `a00817b746211a295bcb966f7fd7ef12cd6178fb`, `McpService.prototype.tools()` passed to `publicTools(..., false)`, plus real local Nest/Fastify HTTP transport tests with both write flags OFF. Actual visible count: 42 read/diagnostic tools, with zero controlled-write descriptors. Every tool has a title and all four explicit boolean annotations, including `idempotentHint`. No invalid annotations were found. Idempotent is true except `run_connection_diagnostics`, where it is false.

This is a compiled-registry and isolated local HTTP audit, not an authenticated production capture. Local MCP transport tests use mock authentication/providers and in-process injection; the only standalone local server started was the Web build for support-page checks. No live provider call, provider write, production token retrieval, migration or production deployment was performed. Production inventory and OpenAI Scan Tools remain required after deployment. The table records the same actual annotations checked against the compiled registry.

| tool                                           | readOnlyHint | openWorldHint | destructiveHint | status                                       |
| ---------------------------------------------- | ------------ | ------------- | --------------- | -------------------------------------------- |
| list_connected_resources                       | true         | false         | false           | PASS (source)                                |
| list_ad_accounts                               | true         | false         | false           | PASS (source)                                |
| get_account_status                             | true         | false         | false           | PASS (source)                                |
| get_account_summary                            | true         | true          | false           | PASS (source)                                |
| run_connection_diagnostics                     | false        | true          | false           | PASS (source; persistent diagnostic effects) |
| list_campaigns                                 | true         | true          | false           | PASS (source)                                |
| get_campaign                                   | true         | true          | false           | PASS (source)                                |
| get_campaign_statuses                          | true         | true          | false           | PASS (source)                                |
| get_basic_metrics                              | true         | true          | false           | PASS (source)                                |
| get_performance_report                         | true         | true          | false           | PASS (source)                                |
| get_spend_overview                             | true         | true          | false           | PASS (source)                                |
| get_status_summary                             | true         | true          | false           | PASS (source)                                |
| get_top_performers                             | true         | true          | false           | PASS (source)                                |
| get_campaign_structure                         | true         | true          | false           | PASS (source)                                |
| get_google_ads_detailed_report                 | true         | true          | false           | PASS (source)                                |
| google_ads_list_keywords                       | true         | true          | false           | PASS (source)                                |
| google_ads_search_terms                        | true         | true          | false           | PASS (source)                                |
| google_ads_list_negatives                      | true         | true          | false           | PASS (source)                                |
| google_ads_check_negative_conflicts            | true         | true          | false           | PASS (source)                                |
| get_meta_ads_detailed_report                   | true         | true          | false           | PASS (source)                                |
| get_meta_oauth_permissions                     | true         | true          | false           | PASS (source)                                |
| get_flexible_insights                          | true         | true          | false           | PASS (source)                                |
| google_analytics_list_properties               | true         | true          | false           | PASS (source)                                |
| google_analytics_get_property                  | true         | true          | false           | PASS (source)                                |
| google_analytics_run_report                    | true         | true          | false           | PASS (source)                                |
| google_analytics_check_compatibility           | true         | true          | false           | PASS (source)                                |
| google_analytics_traffic_overview              | true         | true          | false           | PASS (source)                                |
| google_analytics_acquisition                   | true         | true          | false           | PASS (source)                                |
| google_analytics_landing_pages                 | true         | true          | false           | PASS (source)                                |
| google_analytics_pages                         | true         | true          | false           | PASS (source)                                |
| google_analytics_events                        | true         | true          | false           | PASS (source)                                |
| google_analytics_key_events                    | true         | true          | false           | PASS (source)                                |
| google_analytics_devices                       | true         | true          | false           | PASS (source)                                |
| google_analytics_geography                     | true         | true          | false           | PASS (source)                                |
| google_analytics_realtime                      | true         | true          | false           | PASS (source)                                |
| google_analytics_compare_periods               | true         | true          | false           | PASS (source)                                |
| google_analytics_list_google_ads_links         | true         | true          | false           | PASS (source)                                |
| google_analytics_get_custom_dimensions_metrics | true         | true          | false           | PASS (source)                                |
| get_search_console_report                      | true         | true          | false           | PASS (source)                                |
| list_search_console_properties                 | true         | true          | false           | PASS (source)                                |
| compare_periods                                | true         | true          | false           | PASS (source)                                |
| generate_monthly_ads_report                    | true         | true          | false           | PASS (source)                                |

All visible tools are non-destructive. The reviewed diagnostic tool may refresh authorization or persist health state, so its read-only and idempotent hints remain false; these truthful annotations were preserved rather than relabeled. No diagnostic execution against a live provider occurred. The reviewed inventory is unchanged; campaign mutation tools are hidden.

## Controlled write exposure decision

PUBLIC WRITE TOOLS VISIBLE WHILE WRITE DISABLED: NO. Listing and invocation share `isPublicToolAvailable`. `PUBLIC_MCP_WRITE_SCOPE_ENABLED=false` hides `preview_change_campaign_name`, `preview_pause_campaign`, `preview_resume_campaign`, and `commit_confirmed_preview`; direct calls fail with `public_operation_not_available` before billing or provider dispatch. Local HTTP tests cover all four names and assert zero provider/service calls. All 42 reviewed entries, including the four required Google Ads read tools, remain present.

Future availability is explicit: only `PUBLIC_MCP_WRITE_SCOPE_ENABLED=true` can expose the prepared write inventory, with other scope/policy gates retained. The architecture-level enabled test lists descriptors only and never calls providers. `PUBLIC_MCP_CONTROLLED_WRITE_ENABLED=false` remains set in acceptance runtime. Write service, browser approval, preview architecture, controlled-write tests and migrations 0032/0033 were not deleted or weakened.

## Verification and Git ancestry

| Check                                                   | Result                                                                                                                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm format:check`                                     | PASS on a separate LF checkout of the final staged source, with the unmodified command and no formatter override. Original Windows checkout fails solely on pre-existing CRLF endings; no broad normalization committed. |
| `pnpm lint`                                             | PASS, 10/10 tasks                                                                                                                                                                                                        |
| `pnpm typecheck`                                        | PASS, 15/15 tasks                                                                                                                                                                                                        |
| `pnpm test`                                             | PASS, 15/15 tasks; API 397 passed, 21 integration tests skipped intentionally; external integration tests disabled                                                                                                       |
| `pnpm build`                                            | PASS, 10/10 tasks, including both support routes                                                                                                                                                                         |
| `pnpm security:secrets`                                 | PASS                                                                                                                                                                                                                     |
| `pnpm security:deps`                                    | PASS, Critical 0, High 0; 6 moderate remain                                                                                                                                                                              |
| Browser approval / legacy `/mcp` / public `/mcp/public` | PASS in local unit/HTTP tests; focused six-file suite 55/55 passed                                                                                                                                                       |
| Support Web browser checks                              | PASS, 4/4 RU/EN desktop/mobile                                                                                                                                                                                           |
| Schema and migrations                                   | UNCHANGED relative to `f5c78193ea931eedc42faa20aeb90b7a8500c9f5`; no new migrations and no repeated PG18 rehearsal                                                                                                       |
| Real provider calls / writes                            | 0 / 0                                                                                                                                                                                                                    |

Runtime/Web changes are a direct child of integration HEAD `f5c78193ea931eedc42faa20aeb90b7a8500c9f5`, committed and pushed as `a00817b746211a295bcb966f7fd7ef12cd6178fb`. Its commit has `[skip ci]` to avoid rerunning the unchanged PG18 push rehearsal; this uses [GitHub's documented skip directive](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs). No workflow file was modified or dispatched.

Package history was reconciled explicitly via merge commit `e12552426963af578a8d0a31f7c9a134c703f399`, whose parents are the original package HEAD `619045d94d61d0e8062ebd67ea58f0d81793a418` and integration HEAD `a00817b746211a295bcb966f7fd7ef12cd6178fb`. The subsequent package-only commit updates this report and plugin metadata. Both histories are preserved; no force push or main merge. Main remains `2c1153d580e73192cfd5bc8aaf103cd01b8ab86a`.

## Remaining steps for final submission

1. Separately authorize and perform production Public MCP/support deployment, then verify the public HTTPS URLs, OAuth metadata and authenticated 42-tool read-only inventory with both write flags OFF.
2. Complete domain verification: NOT RUN.
3. Complete OpenAI Scan Tools: NOT RUN; verify production annotations.
4. Supply a reviewer-accessible demo recording URL: MISSING.
5. Configure reviewer credentials securely and execute the prepared 5 positive / 3 negative review cases: NOT CONFIGURED; no credentials belong in the ZIP.
6. Complete or confirm Business Verification: BLOCKED/EXTERNAL.
7. Select publication countries: USER DECISION REQUIRED.

FINAL STATUS: READ-ONLY CODE AND DRAFT PACKAGE READY. Final submission remains blocked by the seven items above. No production deploy/change, VPS access, main merge, production migration, OpenAI upload or submission was performed. Stop after this preparation report.

# HOLYMEDIA MCP PLUGIN SUBMISSION READINESS

Checked: 2026-10-05. This is a packaging report. Review cases are prepared, not executed against advertising providers.

| Field | Result |
| --- | --- |
| SOURCE HEAD | `f5c78193ea931eedc42faa20aeb90b7a8500c9f5` |
| PACKAGE BRANCH | `codex/holymedia-plugin-package` |
| PACKAGE FORMAT | Portable Agent Plugins |
| PLUGIN VERSION | 0.1.0 |
| PLUGIN.JSON | PASS: valid UTF-8 JSON and official portable JSON Schema |
| MCP.JSON | PASS: valid UTF-8 JSON and official portable JSON Schema |
| MCP URL | https://mcp.holymedia.kz/mcp/public |
| MCP SERVER KEY / TRANSPORT | `holymedia` / `streamable-http` |
| OPENAI METADATA | PASS against the documented field names and text limits; draft metadata is incomplete because support URL is missing |
| NGROK REFERENCES | 0 in package and ZIP |
| STAGING REFERENCES | 0 in package and ZIP |
| SECRETS FOUND | 0 in package and ZIP |
| POSITIVE TEST CASES | 5 |
| NEGATIVE TEST CASES | 3 |
| STARTER PROMPTS | 3 |
| LOGO | READY: official repository SVG, square 120 by 120 viewBox |
| DEMO VIDEO | MISSING: DEMO RECORDING REQUIRED |
| REVIEWER CREDENTIALS | NOT IN ZIP; enter separately in the secure dashboard form |
| BUSINESS VERIFICATION | EXTERNAL BLOCKER; verification status was not accessed |
| PRODUCTION /mcp/public | NOT DEPLOYED YET: HTTP 404 at endpoint and protected-resource metadata |
| CONTROLLED WRITE VISIBILITY | YES in the source inventory even with write flags disabled; production inventory unavailable |
| PUBLICATION COUNTRIES | USER DECISION REQUIRED; omitted from manifest |
| ZIP ROOT STRUCTURE | PASS |
| ZIP CRC / SOURCE BYTE MATCH | PASS |
| ZIP | `artifacts/holymedia-mcp-plugin-0.1.0.zip` |
| ZIP SIZE | 2818 bytes |
| ZIP SHA256 | `6b16a6e08642a367b0b0f85ec9f3edbb1ded5729fe4476b702f691ddaf866977` |
| PRODUCTION DEPLOY | NO |
| PRODUCTION CHANGED | NO |
| PROVIDER CALLS | 0 |
| PROVIDER WRITES | 0 |
| OPENAI UPLOAD / SUBMISSION | NOT PERFORMED |
| FINAL SUBMISSION READY | NO |
| FINAL STATUS | DRAFT ZIP READY |

## Legal and product URLs

| Purpose | URL | HTTP result and content |
| --- | --- | --- |
| Website | https://mcp.holymedia.kz/ | 200; HolyMedia MCP product page |
| Support | MISSING | No separate public support route or link found in the source or website; `/support` returned 404 |
| Privacy | https://mcp.holymedia.kz/privacy | 200; HolyMedia MCP privacy policy |
| Terms | https://mcp.holymedia.kz/terms | 200; HolyMedia MCP terms of use |

SUPPORT URL MISSING is a submission blocker. An email address was not substituted for a support URL. Existing legal pages are reachable; this check does not assert their legal sufficiency.

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

The portable schema treats extension data generically, so OpenAI extension field names and limits were also checked against the [official submission documentation](https://developers.openai.com/plugins/deploy/submission). The short description was shortened to `Read connected ad data` to meet the 30-character final listing limit. Exactly five positive and three negative cases use the documented review fields; negative expectations are recorded in each case description. Demo URL and publication countries are omitted. Release notes are under `extensions.com.openai.publication.release_notes`.

The manifest lists only verified public read capabilities for Google Ads, Meta Ads, Google Analytics 4 and Search Console. It does not claim that provider writes are available.

`assets/icon.svg` is an unchanged submission copy of `apps/web/app/icon.svg`. It contains only SVG/group/path elements, has a square 120 by 120 viewBox, and contains no scripts, external image references, embedded metadata, or credentials. Both `logo` and `composerIcon` point to `./assets/icon.svg`. No artwork was generated.

Recursive package and archive scans found zero occurrences of the prohibited development origins and credential markers listed in the brief. Archive entries match the source package bytes and pass ZIP integrity checks.

## Public MCP tool annotation audit

Audit basis: the exact integration source, `apps/api/src/mcp/mcp-public-tools.ts`, and the `tools/list` handler in `apps/api/src/mcp/mcp.controller.ts`. The handler returns `publicTools(this.mcp.tools())`; the helper advertises 42 read/diagnostic entries and four controlled-write entries. All 46 tools have explicit boolean annotations.

This is a source audit, not an authenticated production `tools/list` capture. Production `/mcp/public` and `/.well-known/oauth-protected-resource/mcp/public` both returned 404. No provider call, token retrieval, local runtime startup, or migration was used for the audit. An authenticated production inventory and OpenAI Scan Tools remain required after deployment.

| tool | readOnlyHint | openWorldHint | destructiveHint | status |
| --- | --- | --- | --- | --- |
| list_connected_resources | true | false | false | PASS (source) |
| list_ad_accounts | true | false | false | PASS (source) |
| get_account_status | true | false | false | PASS (source) |
| get_account_summary | true | true | false | PASS (source) |
| run_connection_diagnostics | false | true | false | PASS (source; persistent diagnostic effects) |
| list_campaigns | true | true | false | PASS (source) |
| get_campaign | true | true | false | PASS (source) |
| get_campaign_statuses | true | true | false | PASS (source) |
| get_basic_metrics | true | true | false | PASS (source) |
| get_performance_report | true | true | false | PASS (source) |
| get_spend_overview | true | true | false | PASS (source) |
| get_status_summary | true | true | false | PASS (source) |
| get_top_performers | true | true | false | PASS (source) |
| get_campaign_structure | true | true | false | PASS (source) |
| get_google_ads_detailed_report | true | true | false | PASS (source) |
| google_ads_list_keywords | true | true | false | PASS (source) |
| google_ads_search_terms | true | true | false | PASS (source) |
| google_ads_list_negatives | true | true | false | PASS (source) |
| google_ads_check_negative_conflicts | true | true | false | PASS (source) |
| get_meta_ads_detailed_report | true | true | false | PASS (source) |
| get_meta_oauth_permissions | true | true | false | PASS (source) |
| get_flexible_insights | true | true | false | PASS (source) |
| google_analytics_list_properties | true | true | false | PASS (source) |
| google_analytics_get_property | true | true | false | PASS (source) |
| google_analytics_run_report | true | true | false | PASS (source) |
| google_analytics_check_compatibility | true | true | false | PASS (source) |
| google_analytics_traffic_overview | true | true | false | PASS (source) |
| google_analytics_acquisition | true | true | false | PASS (source) |
| google_analytics_landing_pages | true | true | false | PASS (source) |
| google_analytics_pages | true | true | false | PASS (source) |
| google_analytics_events | true | true | false | PASS (source) |
| google_analytics_key_events | true | true | false | PASS (source) |
| google_analytics_devices | true | true | false | PASS (source) |
| google_analytics_geography | true | true | false | PASS (source) |
| google_analytics_realtime | true | true | false | PASS (source) |
| google_analytics_compare_periods | true | true | false | PASS (source) |
| google_analytics_list_google_ads_links | true | true | false | PASS (source) |
| google_analytics_get_custom_dimensions_metrics | true | true | false | PASS (source) |
| get_search_console_report | true | true | false | PASS (source) |
| list_search_console_properties | true | true | false | PASS (source) |
| compare_periods | true | true | false | PASS (source) |
| generate_monthly_ads_report | true | true | false | PASS (source) |
| preview_change_campaign_name | false | true | false | RISK: advertised while disabled |
| preview_pause_campaign | false | true | false | RISK: advertised while disabled |
| preview_resume_campaign | false | true | false | RISK: advertised while disabled |
| commit_confirmed_preview | false | true | true | RISK: advertised while disabled |

Read tools are marked non-destructive. Diagnostic execution may refresh credentials or persist health state, so its read-only hint is false. Previews persist local preview/audit state and read a provider; commit can perform a Meta campaign mutation. The annotation values reflect these possible effects rather than the present state of authorization gates.

## Controlled write exposure decision

PUBLIC WRITE TOOLS VISIBLE WHILE WRITE DISABLED: YES in this source. `publicTools()` does not inspect the write flags before returning the inventory. The flags govern scope issuance and mutation, but do not remove the four tool descriptors. OpenAI Scan Tools would therefore discover them from an authenticated deployment of this source with those flags off.

This is a submission risk and an architecture decision required before submission. The [official MCP review requirements](https://developers.openai.com/plugins/deploy/app-review) state that Scan Tools imports server annotations; a listing explanation cannot override them. The documentation does not establish that disabled advertised tools are automatically accepted or rejected.

- Option A: change the runtime in a separate authorized task to hide unavailable write tools when write scope is disabled, then deploy and scan the actual read surface.
- Option B: retain the tools with their existing effect annotations, clearly document their scope and availability, and verify the resulting inventory and review treatment in OpenAI Scan Tools. Acceptance is not established by this packaging task.

No option was selected and no runtime code was changed. The package describes read access and does not enable writes.

## Remaining steps for final submission

1. Publish and verify a real public HTTPS support page, then add its URL to the manifest.
2. Deploy the already approved Public MCP source in a separate deployment task and verify the production endpoint, OAuth metadata, authenticated inventory and domain verification.
3. Decide how to handle the four advertised controlled-write tools for this read release.
4. Complete successful OpenAI Scan Tools and review the production annotations; this scan has not been performed.
5. Supply a reviewer-accessible demo recording URL.
6. Enter working reviewer credentials separately in the secure portal and validate the prepared cases there. No credentials belong in the ZIP.
7. Complete or confirm developer/business identity verification under Holy Media.
8. Select publication countries in the dashboard.

FINAL STATUS: DRAFT ZIP READY. FINAL SUBMISSION PACKAGE READY is not claimed.

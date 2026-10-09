# Google Ads private client contract

Original source: `ТЗ запись в Google Ads для HolyMedia MCP.docx`, SHA-256 `51C94D3D2953B32821DC872822147B1FF6C28E36258211D9DDD916BFF2C30DB0`. Paragraph numbers include table paragraphs. This document describes implementation/mocks, not authorization for provider writes.

## REQUIRED reconciliation

- P6/P245–250: reuse generic campaign rename and ad group pause/resume. `googleWriteGenericSchema` exposes a closed Google-only branch for `preview_change_campaign_name`, `preview_pause_adset_or_group`, `preview_resume_adset_or_group`. Every field is typed/described; provider, account and campaign are required, plus name or group. Generic aliases translate into the existing Stage 4 `campaign_update`/`ad_group_update` intent; only the requested name/status is present. No arbitrary provider request objects, hidden settings, direct mutation or parallel approval architecture.
- P47–50: complete schemas and annotations are retained. Profile read tools have `readOnlyHint: true`; commit/removal/rollback have `destructiveHint: true`. These hints are not security authorization: ownership, write scope, feature gates, allowlist, persisted human approval, preview freshness and immutable commit remain authoritative server checks.
- P51: `/mcp?profile=google_ads_write` uses an explicit bounded list of Stage 0–4 tools, existing controlled commit/rollback/journal and necessary Google reads. Meta-only tools, unknown prefix-matching tools and local `confirm_preview` are excluded. Missing/disabled tools are not synthesized. Unknown profile selectors fail closed. Filtering must be enforced on tools/list **and** tools/call/REST, not merely hidden in the list.
- P52: portable responses contain authorized `structuredContent` plus text `content`; clients need no vendor-specific widgets. Existing provider error code/source and Russian explanation remain available; HTTP 200 is not proof of successful provider verification.
- P53: `googleWriteOpenApi` builds OpenAPI 3.1 with one private POST path `/api/v1/mcp/rest/{tool_name}` per selected tool. The JSON request body is an exact clone of that tool's existing `inputSchema`, not a raw Google payload or a new generic execution API. HTTP Bearer security has no embedded credential. HTTPS origin or localhost HTTP is required; userinfo/query/fragment/path are rejected.

## Required integration (common service/controller ownership)

The pure helpers describe/translate schemas; the current common service/controller
integrates them with the stock private routes and authentication. The integrated contract is:

1. Authenticate private MCP/OpenAPI/REST with the existing principal, workspace/scope checks and rate limits. Public MCP stays read-only; no new public write exposure or flags.
2. Keep the existing Meta schema/handler behavior in a **disjoint** provider branch. A legacy unbounded Meta fallback must explicitly exclude `GOOGLE_ADS`; Google is never inferred from IDs. Narrow generic Google profile schemas where the registry currently has a Meta `oneOf` branch.
3. Apply the same profile authorization to both list and call. A Google profile may not dispatch a generic read/write to Meta by supplying a different provider. Opaque commit/rollback identities must resolve to a Google preview/commit before execution; profile selection alone is not that proof.
4. Invoke `validateGoogleWriteProfileArguments(name, args)` before private profile dispatch. Keep account authorization and opaque-preview Google ownership proof; the pure validator cannot establish either. Delegate REST requests into the stock MCP handler/tool dispatch, preserving browser human approval, CSRF/session/owner checks, immutable payload, stale/expiry/consumed guards, Google validate-only, provider reread and audit. Do not approve automatically or introduce a second confirmation mechanism.
5. Return sanitized authorized results/errors only. Never expose provider tokens, vault payload, credentials, cookies or request headers. The OpenAPI generator cannot sanitize an executed result because it does not execute anything.

## Examples (not approvals)

```json
{
  "provider": "GOOGLE_ADS",
  "account_id": "8590146099",
  "campaign_id": "24324170853",
  "ad_group_id": "206587491811"
}
```

`preview_pause_adset_or_group` translates this into one Stage 4 `ad_group_update` item with `status: PAUSED`; resume uses a separate new preview with `status: ENABLED`. A caller cannot substitute status, name, unrelated account, raw API request or approval into these alias schemas. Actual account/group ownership still requires provider proof in the existing builder.

## Verification status

Unit/mock tests cover strict aliases, provider requirement, closed fields, parent IDs, no hidden changes, profile bounds/uniqueness, unknown profiles, annotations, OpenAPI path/schema identity, authenticated documentation and origin validation. No live Google provider calls or mutations are part of this package.

Q/R cross-client Google write acceptance and S human consent remain **NOT LIVE / pending dedicated acceptance**. Generated schemas/OpenAPI and mocks are not evidence that ChatGPT, Claude, Gemini, Cursor, VS Code, GPT Actions, n8n or Make have actually completed a write. Common route/profile/native-principal integration and negative auth/approval HTTP regressions are implemented and mock-tested; real client connectivity and consent remain separate acceptance gates.

Primary format reference: [OpenAPI Specification 3.1.1](https://spec.openapis.org/oas/v3.1.1.html). OpenAPI 3.1 supports JSON Schema and HTTP Bearer security; all request schemas originate from the existing authorized MCP registry.

## Closed Google-only client input contract

`googleWriteProfileInputSchema(toolOrName)` now constructs the trusted implemented Google branch for every tool in the bounded private profile. `googleWriteToolProfile` clones these schemas into the selected registry; OpenAPI request bodies use those same profile schemas. This does **not** mutate the default legacy READ/Meta/Public registry. No caller-supplied registry schema is authoritative, and unknown tools receive no fallback.

Only top-level alternatives with a proved explicit `GOOGLE_ADS` provider and closed object are narrowed. Conditional `oneOf` inside a real Google negative/bid operation remains intact. Common service integration must return `googleWriteToolProfile(this.tools())` directly, removing the old blind `oneOf[0]` projection: an operation-level `oneOf` is not a Meta fallback.

READ contracts require explicit `provider: GOOGLE_ADS`; account-scoped reads require the ten-digit external `account_id`. Stored account ownership/principal scoping is still checked by the stock service, never guessed from ID shape. Resource-name inputs cannot reference another customer. Commit accepts only the opaque `preview_token`; rollback accepts only its server-recorded `commit_id`. Neither accepts account/provider/replacement/confirmed overrides. `confirm_preview` is not exposed: browser manual approval remains mandatory.

Canonical READ fields are snake_case. Date ranges use real calendar dates and paired ordered boundaries, keywords optionally use the existing `last_7d` / `last_14d` / `last_30d` presets instead of explicit dates, pagination is 1–500 (journal 1–100), filter ID arrays are 1–200, conflict inputs are 1–100. Opaque read cursors are bounded to 8192 characters as a profile transport bound, not a claim about provider cursor internals. CSV search-term delivery is explicitly unsupported; only implemented JSON pagination is advertised.

The bounded pure validator evaluates trusted schema type/enum/const, object closure/required, arrays/ranges, `oneOf`/`anyOf`/`allOf` and conditional constraints, then reuses the existing pure intent parsers. It does not resolve remote schemas, construct provider requests, approve previews or execute tools. Unknown keys/missing fields return `GoogleAdsWriteError` with a Russian explanation and precise safe `fieldPath`; empty provider failures let the existing controller classify the error as **HOLYMEDIA**, not Google Ads. Overlong/non-identifier unknown key text is not echoed into errors. The profile annotations distinguish READ from preview/commit; hints are not authorization.

## Honest READ capability gaps

| Tool/profile area                | Actual source contract                                                                        | Not claimed                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `get_campaign_structure`         | Normalized campaign list / selected campaign row                                              | Complete ad-group, keyword, RSA, criterion or asset structure                         |
| `get_account_object`             | Account summary                                                                               | Arbitrary entity/resource retrieval                                                   |
| `list_account_objects`           | Campaign listing                                                                              | General provider object catalog or `object_type` filter                               |
| `get_google_ads_detailed_report` | `campaign`, `campaigns`, `campaign_performance` only                                          | Ad-group/ad/asset performance reports                                                 |
| Assets/links/UTM catalog         | Bounded owned `get_tracking_specs` / `audit_links_and_utms`; shared preview inheritance audit | General asset catalog, arbitrary GAQL, live landing-page or serving-expansion success |
| Cross-client Q/R/S               | Local registry/schema/mock evidence only                                                      | Real ChatGPT/second-client write or live human-consent acceptance                     |

Source basis remains original PPC paragraphs P47–53 (complete client schemas, bounded profile, cross-client portability, exact private REST contract). These gaps must be tracked separately rather than inventing accepted arguments or declaring original READ catalog scope complete. Primary assertion vocabulary: [JSON Schema 2020-12 validation](https://json-schema.org/draft/2020-12/json-schema-validation).

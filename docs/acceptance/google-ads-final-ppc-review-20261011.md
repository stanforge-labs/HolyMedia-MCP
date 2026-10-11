# Google Ads Write: PPC closeout and release review, 11 October 2026

This is an append-only successor checkpoint, not a replacement of the original
336-paragraph DOCX audit or historical provider evidence. Original requirements
remain grounded in `artifacts/google-full-scope/requirements-matrix-20261009.json`.
The DOCX was not reread during this continuation. Original PPC completion is
**PARTIAL**; supported code/mock coverage does not establish full LIVE coverage.

## Current acceptance matrix

| Gate                      | Actual result                                                                       | Remaining work                                                    |
| ------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Stage 0 T/U/V/W           | Historical LIVE PASS                                                                | No historical commit repeated                                     |
| Stage 1 A/B/C/D/E/F/M/O/P | Historical LIVE PASS                                                                | No live test repeated                                             |
| I/K/L/N                   | Historical LIVE PASS                                                                | I criterion absent; residual RSA PAUSED; group CPC 100000 micros  |
| J                         | **LIVE PASS: add and restoration VERIFIED**                                         | No pending J operation                                            |
| G                         | BLOCKED: no owned paused automatic Search campaign; original raw keyword CPC absent | Approved TEST setup described below                               |
| H                         | Nonshared +60% warning/provider validation PASS; shared impact MOCK only            | Genuine shared budget and complete consumer proof                 |
| PMax                      | Supported typed profiles/mock PASS; LIVE prerequisites missing                      | Real conversion/media/branding inputs                             |
| Clone                     | PARTIAL, supported additions MOCK PASS                                              | Other source collections fail explicitly; no live clone performed |
| Q/R                       | BLOCKED, real native clients not connected                                          | Private TEST transport and interactive OAuth                      |
| S                         | Server/browser human approval proved                                                | Client-specific consent evidence still pending                    |

### J restoration evidence

One stock immutable commit `hmc_AvZZRKcF9xbqnGB9IsX1zeiOdxHuvs1_PTdbVkc8nWA`
consumed preview `a059f115-771d-416f-8565-c06a1d8538aa`. Persisted confirmation,
session/audit, expiry, immutable digest, fresh TEST hierarchy and stale guards
passed before mutation. Two exact REMOVE operations were acknowledged by Google:

- `customers/8590146099/campaignCriteria/24324170853~9196209`
- `customers/8590146099/campaignCriteria/24324170853~2527337173874`

Exact provider queries now return neither resource. The full original J-before
snapshot matches, including Almaty include 9235214 and neighboring criteria.
Journal has two attempted rows, two success rows and one VERIFIED commit event.
No retry, raw mutation, audit rewrite or automatic cleanup occurred.

Evidence: `artifacts/google-full-scope/J-restored-live-20261011.json`, SHA256
`9f2ec36026a4ae3775e7f7ac900853f5964bae027209fb30657958c2943ff412`.
J restore counts: **43 READ / 0 VALIDATE_ONLY / 1 real mutate**, two semantic removes.
Fresh independent prerequisite discovery adds **11 READ / 0 / 0**.
Its data file was saved before a probe cleanup error (`closeDatabase` called
without its database argument). That process exited 1 after the completed reads;
the failure is disclosed, is not a product commit failure and does not justify
repeating provider calls. No provider mutation was available in its closed guard.

## Verified TEST inventory and setup decisions

Discovery at 2026-10-11T08:49:51.587Z confirms customer 8590146099 is TEST, USD,
Asia/Almaty, under TEST MCC 4378327049. The existing key is scoped to that customer
only, read/write scopes, expiry **2026-10-11T16:23:20.552Z** (21:23:20 UTC+5).
No new key was created. Check expiry again before every future operation.

Two owned budgets are nonshared, each 2000000 micros/day (2 USD): 15934365976
and 15932267169. Their two campaign consumers are PAUSED. There are zero eligible
paused automatic Search campaigns in the bounded complete inventory. Keyword
11743561 has no explicit raw CPC; effective 100000 micros derives from AD_GROUP.
Never use that effective value as proof of an explicit percentage-change basis.
Enabled conversion actions: zero. IMAGE assets: zero. TEXT assets: nine; those
are not image/logo/business-identity eligibility. Existing PMax campaigns: zero.
SharedSet 12261567996 has zero active attachments. I criterion 51668099935 absent.

### G: minimal isolated setup, no changes to historical fixtures

Preferred proposal is a new uniquely named **PAUSED** TEST Search fixture using
the existing Stage 0 typed atomic builder: one nonshared 2 USD/day budget, one
campaign, one paused group, one paused EXACT keyword with explicit 0.10 USD CPC,
one paused valid RSA, Almaty 9235214 and Russian 1031. Expected minimum graph:
seven operations. IDs and geo/language availability must be provider-proved;
no temporary provider IDs may be invented outside the normal builder.

1. Prepare the brief, ownership and runtime/commit harness before a JIT preview.
   Google validate-only, manual approval, one atomic create, full reread/audit.
2. Separately preview MAXIMIZE_CLICKS with reviewed 1 USD CPC ceiling, keeping all
   delivery statuses PAUSED. It maps to Google TARGET_SPEND. New approval, commit,
   reread/audit; conversion history is not fabricated.
3. Fresh raw keyword CPC and automatic-strategy proof. Preview +10%, require the
   warning that auto bidding may ignore manual CPC; Google validate-only.
   If warning-only meets G, do not commit unnecessarily. A required bid mutation
   needs another approval and a separately approved exact rollback.
4. Restore the strategy through its verified inverse and separate approval if
   the setup is to be returned to Manual CPC. Leave residual TEST objects PAUSED.

This is a proposed approved setup, not a ready preview or permission to create it.
The older six-approval historical-fixture proposal remains recorded in the dated
recovery document but is not executed without explicit fixture-change agreement.

### H: shared impact is a distinct missing prerequisite

Existing nonshared warning-only evidence covers 2 USD to 3.20 USD (+60%) and
identifies its one campaign consumer. It does not prove shared impact. To test
shared semantics, a genuine DAILY shared 2 USD budget needs **two separate paused
TEST campaign consumers**, complete consumer READ and a +60% immutable preview
listing both. Warning-only validation avoids a needless budget write; if a commit
is required, exact 3.20 USD verification and a new approved 2 USD rollback follow.

Current supported creation profile deliberately makes nonshared budgets. A
stock typed shared-budget create/consumer-assignment setup is not implemented.
That prerequisite requires a targeted implementation or separately approved TEST
UI setup; it must not be filled with raw mutation or broad account changes.

### PMax: exact legitimate inputs

Required before LIVE: same-account genuine enabled conversion action and usable
goal, reviewed business name/brand identity, authorized actual landscape and
square PNG/JPEG plus square logo. Inline media contract: at most 1 MiB each and
2 MiB aggregate, actual decoded bytes, no remote downloads or arbitrary paths.
Landscape minimum 600x314 at 1.91 ratio, square minimum 300x300, logo minimum
128x128. Text minimum: three headlines <=30, one long headline <=90, two
descriptions <=90 including a short <=60; actual valid final URL.

Stock non-retail typed creation is one temporary-resource atomic graph with
PAUSED campaign/asset groups and partial_failure=false. A custom campaign goal
mapping may reference real conversion actions; it does not invent an action.
Eligibility/policy, brand guidelines and complete provider reread are mandatory.
User must provide legitimate media/identity and authorize prerequisite setup
before a JIT PMax approval. Existing mock coverage is not LIVE PASS.

## Clone code addition and remaining local gaps

The new focused addition preserves source-owned positive campaign LOCATION and
AD_SCHEDULE bid modifiers for MANUAL_CPC, finite 0.1..10, exactly matched to one
new criterion. Payload, preview, frozen stale snapshot and exact provider
expectations include the modifier. Other fields and the source remain unchanged.
Atomic Stage 0 and all-paused defaults remain unchanged.

The v24 [CampaignCriterion contract](https://github.com/googleapis/googleapis/blob/master/google/ads/googleads/v24/resources/campaign_criterion.proto)
and [official bid-modifier guide](https://developers.google.com/google-ads/api/docs/campaigns/bidding/manage-bid-modifiers)
support this exact level. New geo with a nonneutral source geo modifier rejects
rather than guessing a mapping. Custom device/ad-group modifiers, audiences,
custom goals, portfolio/unsupported inline parameters, non-RSA/non-Search ads and
unsupported URL collections still reject explicitly. These are local profile
gaps, not a blanket Google API restriction. No clone LIVE call or runtime upgrade
was made in this continuation. Fourteen new regressions cover boundaries,
type/owner mapping, stale changes and wrong/missing provider modifiers; targeted
Stage0 clone/budget/geo/goal/MCP regression: **222 PASS**.

## Q/R/S: concrete connection steps, no secret disclosure

The localhost approval gateway is **not `/mcp`** and deliberately returns 404 for
native OAuth protected-resource metadata. Do not connect clients to an approval
URL or expose the production/Public write surface. A private TEST native ingress
or approved Secure MCP Tunnel and reachable HolyMedia OAuth authorization server
are missing. No tunnel, public route, client credentials or scopes were created.

For ChatGPT, once TEST ingress is provisioned and ownership verified: Plugins →
plus → Add custom MCP server → enter the authorized TEST `/mcp?profile=google_ads_write`
URL or choose Tunnel → OAuth → review → create/install the plugin. A tunnel needs
the appropriate Platform/workspace association and Read+Use permissions. OAuth
authorization-server reachability is separate from MCP tunneling. Authenticate
personally; never put cookies, tokens or TEST vault keys in chat/URL.
Sources checked this continuation:
[custom server](https://developers.openai.com/api/docs/guides/custom-mcp-server),
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

For Gemini CLI, put the authorized TEST Streamable HTTP endpoint in private
`.gemini/settings.json` under `mcpServers.holymediaTest.httpUrl`, use `trust:false`
and the minimal read-tool allowlist first. Do not commit that local configuration
or a credential header. Then `/mcp auth holymediaTest`, interactive OAuth,
`/mcp list` and inspect tool descriptions. The endpoint is not yet available;
placeholder URLs are not executable instructions. Source:
[Gemini CLI MCP/OAuth](https://geminicli.com/docs/tools/mcp-server/).

Initial native calls must be tools/list, TEST customer read, safe preview and
rejection tests. Actual B/C cross-client writes require new browser manual
approval and separately approved restoration. For S record native request,
preview identity, human confirmedAt/session/audit, digest, commit and reread;
the client's own tool prompt cannot substitute HolyMedia browser approval.

## Release candidate and rollback, without deployment

Keep Stage01 candidate `bb5b8d16979a41720129243927a6c9f56e091083` untouched.
Current Stage234 code remains on its own branch and is not the running stock
TEST source `55d9df3553ff1ad01586978b6e4ecc07913969c5`. Do not reload that runtime
while a preview is active. No new Prisma migration is introduced by this package.

Required review sequence: verify all foundation/Stage0/1/234 commit ancestry and
schemas, full Linux DB/Redis integration without skips, static quality/scanners,
private feature flags OFF/default empty production allowlist, native Q/R/S gates
and required LIVE prerequisites. Create the separate review candidate from the
tested commit; **do not merge main or deploy**. Release remains NOT READY while
mandatory scope/client acceptance gaps remain.

Rollback plan: disable write gates first; retain read-only reconciliation for
unknown outcomes. Never replay consumed creation commits. Compare previous
immutable image/config/schema, verify backup restore on a disposable DB, preserve
all journals and approvals; no destructive DB rollback or audit deletion without
new authorization. Deploy/merge order, environment/owner mapping and explicit
production authorization require separate review.

Local quality: format/lint/typecheck/build/Prisma/secret scan PASS; 1669 tests
PASS and **26 integration tests skipped** without local disposable DB/Redis.
API changed tasks executed fresh; unrelated Turbo tasks used cache. Python
regressions: 60 PASS. Hosted Linux CI on the new pushed commit is a separate gate
and must be recorded from its actual final logs, not inferred from local PASS.
Dependencies: Critical 0 / High 0 / Moderate 6. The documented CPU/URI/HTTP2 risks
remain in `moderate-security-risk-assessment-20261009.json`; scanner stays active.

Production changed: NO. Main changed: NO. No new pending approval exists.

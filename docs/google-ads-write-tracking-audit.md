# Google tracking READ audit — original PPC P244

This package supplies `getGoogleTrackingSpecs(accountId, options, read)` and
`auditGoogleLinksAndUtms(accountId, options, read)`. `read` is the existing adapter's
account/MCC-scoped GAQL reader, not a new authentication path or raw-query MCP endpoint.
`ProviderService.googleTrackingAudit` uses the existing credential refresh/vault,
workspace/connection/selected-account ownership and READ context. It does not enable
write flags or perform validation/mutations. Root integrates adapter/MCP dispatch separately.

Closed schemas expose explicit GOOGLE_ADS/account_id, up to20 unique campaign/group IDs,
optional numeric ad_id and integer per-level limit1–200 (default100). Five fixed SELECT
queries read customer, campaigns, groups, ads and positive keyword criteria. No arbitrary
GAQL, provider requests, URLs, downloads or filesystem paths are accepted. Each child must
prove the exact parent/resource and account; even the limit+1 sentinel cannot conceal a
foreign account. Removed resources are excluded. Limit truncation/missing requested context
is explicit and cannot advertise complete account audit.

Tracking template and suffix inherit independently. Omitted selected protobuf string
defaults mean empty local override, not a fabricated UTM. Ad rows resolve account→campaign
→group→ad. A keyword can use its own override; otherwise a provided ad_id from the same
group is required to resolve the ad intermediate level. The helper never guesses served
ad, even when only one ad appears in the inventory. Missing context produces
UNKNOWN_AD_CONTEXT, not a guessed group/account value. Final URLs use keyword override
or that explicit ad context; mobile URLs/custom parameters are shown but Google serving
expansion, network/device selection and custom-parameter substitution are not simulated.
Google's hierarchy is documented in the [official serving URL rules](https://developers.google.com/google-ads/api/docs/ads/upgraded-urls/serving-url-rules).

`audit_links_and_utms` checks syntax, HTTP(S)/private literal host, tracking-template landing
placeholder, UTM duplicates/empty/incomplete keys and unresolved custom parameters. Valid
`{lpurl}`, `{escapedlpurl}`, `{unescapedlpurl}`, `{lpurl+2}`, `{lpurl+3}` templates are not
classified as unsafe merely because they contain a Google placeholder. No DNS resolution,
HTTP HEAD/GET, redirects, robots/policy moderation, URL reachability or provider serving
expansion occurs. Output explicitly says `landing_reachability=NOT_CHECKED` and
`serving_url_expansion=NOT_EXECUTED`. This is a syntactic provider-state audit, never a claim
that a landing page works. Asset/sitelink tracking is outside this five-level profile.

Returned URL userinfo, sensitive query/fragment values and bounded nested redirect
credentials are redacted. Sensitive custom values and credential-pattern strings are also
redacted, not logged/echoed in warnings. The helper only emits selected scalar fields and
typed structured warnings; it does not return arbitrary provider payloads. Raw provider
data is not changed. No tokens, OAuth code/state, headers or cookies are evidence.

Integration exports:

- `GOOGLE_TRACKING_AUDIT_TOOLS`, `trackingAuditToolSchema(name)`,
  `trackingAuditToolArguments(name,args)` in `mcp-google-tracking-audit-schema.ts`.
- Schema helper returns `{ action: 'specs' | 'audit', options }`.
- Add adapter `trackingAudit(context,action,options)` using the existing private
  `searchStream` and `contextLoginCustomerId`; choose the exported READ helper.
- MCP routing must use existing selected workspace/account ownership, descriptions and
  readOnlyHint, not change public write flags. Before Stage4 tracking preview, consume this
  READ audit as factual BEFORE evidence alongside the existing proposed-value validator;
  it does not authorize commit or replace immutable/stale checks.

Tests cover five-query identity/masks, independent inheritance, no served-ad guess,
camelCase/snake_case responses, typed schemas/limits, foreign identity, missing/truncated
context, local/default fields, actual ProviderService ownership, redaction and propagation
of original provider error code/status. New package tests and stock Stage4/tracking inverse
regressions use mocks only. Real Google READ/VALIDATE_ONLY/WRITE for this packet:0/0/0.
Historical Stage01 live writes remain separate immutable evidence.

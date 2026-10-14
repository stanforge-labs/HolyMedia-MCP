# Q/R/S TEST ChatGPT DCR scope mismatch — 2026-10-14

Status: root cause confirmed; code and local regression PASS; Linux CI, immutable image and TEST-only cutover must be recorded separately. This is **not** Q/R/S LIVE PASS and authorizes no Google Ads preview or mutation.

## Sanitized evidence

- The TEST API logged request `1b087409-7d13-4e92-b1ac-05b3c6c5f3bb` at `2026-10-14T06:19:50.925Z` as `BadRequestException`, HTTP **400** (`request_invalid`). No corresponding OAuth transaction or issued access/refresh token existed for the newly registered DCR client.
- The only new DCR client was created at `06:19:34.932Z`. Its one redirect URI had the `chatgpt.com/connector/oauth/` host/path family, but its persisted scope was only `adforge:mcp:read`. The requested resource was the canonical private TEST `/mcp`, PKCE was S256, and the TEST Google write gate was enabled. Exact redirect/resource/PKCE validation precedes the failing scope-subset check.
- `registrationMetadata()` defaults missing DCR `scope` to READ. `beginAuthorization()` requires every requested scope to be in the persisted client scope. ChatGPT then requested `adforge:mcp:read adforge:mcp:write`, so authorization failed before HolyMedia login/consent. The rejected request made no provider call.
- The existing ChatGPT/Claude READ clients/grants are unchanged. Their READ grants must not be treated as write credentials or migrated in place.

No full client ID, redirect state, cookie, token, Google identity or response body is recorded here.

## Narrow correction

Only when the **new DCR request omits scope** and the startup-validated, single-account Q/R/S TEST flags are both enabled does registration persist/return `read write` as the *new client's allowed capability*. Explicit READ DCR registrations remain READ-only. The default remains READ in production and when the dedicated TEST gate is OFF. Existing client rows are not updated.

This capability is not an OAuth grant. The private TEST resource still requires an explicit `read write` authorization request, exact redirect and S256 PKCE, current Google write gate, active OWNER/workspace, and a **new human HolyMedia consent** selecting both scopes. Refresh cannot enlarge a READ grant. A provider commit additionally requires the separate JIT preview, Google `validate_only`, OWNER browser approval, immutable payload, stale/TTL checks, provider reread and audit. The exact TEST account allowlist remains `8590146099`; Public and production write stay OFF.

## Verification and reconnection

- Unit regressions cover omitted/explicit DCR scopes, TEST gate OFF, no automatic grant, wrong redirect/resource/PKCE, and the pre-existing READ client denial.
- Disposable-DB integration covers persistence, scope negotiation, explicit consent, token/resource binding and old READ client denial. It runs in Linux CI with `V2_INTEGRATION_TESTS=true`; local Windows lacks Docker and skips integration suites.
- A fresh ChatGPT connector must create a **new** DCR client after TEST API cutover. Reusing the failed client would retain its READ-only registration. The new real ChatGPT authorization must be independently observed reaching login/consent; no one-time state URL is replayed. Claude must make its own new registration/consent. Neither client is counted LIVE PASS until real A/B/C/M and two-client S evidence exist.

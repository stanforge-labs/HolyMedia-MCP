# Google Ads WRITE A1: integration against production main

Status: offline code integration complete; localhost WRITE acceptance **BLOCKED by the existing security boundary**. No TEST or production process, database, OAuth credential or provider was accessed or changed.

## Sources and scope

- Base: `a1420239487da19e7c20cb69258abac1feab5ff8` (`main`, verified against `origin/main`).
- Google WRITE source: `9bc5d1e64bc26f75dcff4970f007f9f8e844d897` (`codex/qrs-test-auth-recovery`, verified against origin).
- Branch: `codex/google-write-main-integration`, in a clean managed worktree. The old feature checkout and its uncommitted changes were not touched.
- No Prisma schema or migration changes; no Web, Worker, production Compose, Nginx, CI/CD, plugin or public tool catalog changes.

## Selected code

The original Stage 0–4 schemas, plans, adapter operations and tests, PMax and ConversionAction gates, Google preview/validation/approval/commit/reread/audit lifecycle, account allowlist and private OAuth WRITE handling were selected from the old source. `sharp@0.35.5` is the sole new direct API dependency for bounded media validation. The existing SSRF-protected `safeGet` gains an optional HEAD method required by the Stage 0 URL check. The production public MCP read contract, provider error mapping and reviewer demo routing remain from `main`.

The three shared dispatcher files were reconciled with current `main`, rather than replacing them wholesale. The reviewer demo check runs before Google private dispatch and rejects synthetic WRITE. Browser approval dispatch can recognize a Google preview, while retaining the existing reviewer-demo denial and Meta behavior. The normal OAuth callback remains a relative redirect; the preexisting loopback read-only TEST profile uses its configured Web origin.

`/mcp/public` remains 41 READ tools. `run_connection_diagnostics` and all Google WRITE tools stay out of that public catalog. The internal diagnostic annotation remains `readOnlyHint=false` with an OAuth-refresh warning. Production Google WRITE and separate Stage 2/3/4, PMax and ConversionAction gates default OFF.

Three historical G/I/L tests that import the old external `scripts/google-live-acceptance/stage234` harness were not transferred. Their script graph is not part of this API integration; the actual Stage 0–4 provider, schema and mock integration tests remain. Those historical LIVE results are not treated as current localhost LIVE evidence.

## Local TEST boundary and next decision

The existing `QRS_TEST_LOCAL_READONLY_AUTH` explicitly requires all WRITE flags OFF on `127.0.0.1:23300`/`24404`. The old single-account confirmed-write gates require `https://mcp-test.holymedia.kz`; changing the origin in environment values cannot enable a safe localhost commit. Regression tests confirm both denials. The profile was **not** activated or bypassed.

For a later, separately approved A2 change, introduce a new server-only, default-OFF localhost WRITE profile, mutually exclusive with `QRS_TEST_LOCAL_READONLY_AUTH`. Validate at startup: development mode; exact loopback Web/API origins and callback; `QRS_TEST_RESTRICTED_AUTH`; sole normalized allowlist `8590146099`; explicit existing TEST workspace ID plus active OWNER user binding; private-resource OAuth WRITE grant with fresh consent; public WRITE flags OFF; `V2_PREVIEW_ONLY=true`; generic confirmed WRITE OFF; at most one explicit Stage/keyword/clone/PMax/ConversionAction acceptance gate active. Recheck the same workspace, OWNER, account and stored preview before every validation and commit. Reject every other account and provider at the adapter boundary. Preserve the existing browser approval, immutable token, one-time claim, reread and audit. Do not reuse historical remote-test consent or grants. The exact TEST workspace/OWNER binding and available Google resources require read-only inspection of a separately authorized WSL2 TEST; they are not guessed here.

This is a security-boundary change, so A1 deliberately stops before implementing or enabling it. There is no current localhost Google WRITE LIVE PASS. The next block is A2 design/review and offline negative tests, followed by a separately authorized TEST start and read-only inventory, then selective validate-only acceptance and explicit OWNER-approved commits if needed.

## Verification

- API tests: 1,480 PASS, 21 skipped integration tests (after added isolation regression).
- Config tests: 17 PASS, including localhost fail-closed cases.
- Full workspace tests, lint, typecheck, build and secret scan: PASS.
- Formatting: changed files PASS. Repository-wide `format:check` in this Windows worktree reports 354 files because `core.autocrlf=true` writes CRLF; the same `main` blob checked with LF passes Prettier. Unrelated files were not reformatted. Linux CI remains the required full check.
- No actual provider mutation, OAuth refresh, TEST start or production operation was performed.

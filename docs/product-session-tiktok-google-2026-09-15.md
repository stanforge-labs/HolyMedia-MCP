# Session, TikTok modal and Google verification

Scope: no Meta App Review changes, no provider mutations, no Google OAuth configuration changes.

## Session

Production config read on 2026-09-15: session TTL 14 days, cookie domain mcp.holymedia.kz, production environment. SessionService stores only token digest, absolute expiresAt and revokedAt; rejects inactive users. Validation updates lastSeenAt, not expiresAt. CookieService sets Max-Age=1209600, HttpOnly, Secure in production, SameSite=Lax, Path=/. Logout revokes the DB session and clears cookies. No migration or TTL extension.

Found UI issues: any non-OK workspace response redirected to login even for transient 5xx; /auth did not attempt restoration of an existing session. Fix: redirect only on 401; ordinary login checks server session and restores the safe requested dashboard route. Signup/reset/MCP consent continuation are not bypassed. No auth secrets in browser storage.

Tests: absolute expiry, next-day validity, no sliding extension, revoke/replay, suspended user; browser refresh/deep link, temporary API failure, and isolated real Chromium profile restart/logout in CI. Local mocked browser tests are not production session evidence.

## TikTok

The changed-selection path already closed after PATCH + reload; unchanged selection returned without closing. Follow-up reload failures could mask successful persistence, and catch reload replaced the user's draft. TikTok now uses the authoritative PATCH account list to update the card/selection, then closes; unchanged save closes too. Failures keep the modal/draft and show a human error. Focus returns to the opener. Other providers retain their existing save path.

## Google (read-only inventory)

All three effective production adapters use the same OAuth client, suffix `75cvm2376m` (before `.apps.googleusercontent.com`). Project ID/name and Cloud approval status are unavailable from the runtime configuration; they must not be inferred from support email or client suffix.

| Provider | Requested scope                                     | Callback                                                      |
| -------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Ads      | https://www.googleapis.com/auth/adwords             | https://mcp.holymedia.kz/oauth/google/callback                |
| GA4      | https://www.googleapis.com/auth/analytics.readonly  | https://mcp.holymedia.kz/oauth/google-analytics/callback      |
| GSC      | https://www.googleapis.com/auth/webmasters.readonly | https://mcp.holymedia.kz/oauth/google-search-console/callback |

Ads/GSC use include_granted_scopes=true; GA4 does not. Authorization URLs were generated in memory with diagnostic state only; no OAuth navigation, consent, token exchange or mutation was performed. Code and effective runtime scopes match.

GA4 was added in commit 0a9aeb3 on 2026-09-03; the GSC adapter appeared in 8f82956 on 2026-08-21. This proves code chronology, not the date/scope set of Google's previous approval. The 2026-09-04 security report already recorded sensitive GA4/GSC verification as pending operational work. A current Cloud verification inventory is still required to distinguish A/B/C/E conclusively. No evidence that these three providers use different production clients; mismatch with the historically approved project remains unverified.

Most likely explanation: newly used sensitive scopes were not yet approved after previous verification. Google explicitly documents the warning when new sensitive scopes are used before approval: https://support.google.com/cloud/answer/13463817?hl=en . This is a supported hypothesis, NOT proof of today's console status.

### Owner action (inspect first)

1. Open Google Cloud Console, choose the previously verified project; record Project ID/name.
2. Google Auth Platform → Clients → open the web client; compare suffix `75cvm2376m`. Do not change client or redirect URIs.
3. Google Auth Platform → Data Access → compare the three scopes above with the configured scopes and their sensitivity.
4. Google Auth Platform → Verification Center → inspect current status, pending requests and requested corrections. Check Audience/publishing state without changing it.
5. If GA4/GSC scopes are missing or unapproved: owner prepares those exact scopes, use-case justification, demo video, homepage/privacy policy/domain evidence and submits the verification update through Verification Center. If already pending, respond to Google's existing request instead of creating a new OAuth client. Do not remove approved Ads scopes.

Re-verification: YES if the new sensitive scopes are not covered by existing approval; current definitive YES/NO pending console evidence. PPC can provide the scenario/video, but Cloud project owner/editor must manage the submission. Keeping Ads scope/client/callback unchanged avoids an intentional Ads integration change; because the consent project is shared, Google verification/user-cap restrictions may affect new authorizations. Existing token validity cannot be guaranteed from code alone.

Current UI reference: https://support.google.com/cloud/answer/15544987?hl=en . Submission requirements: https://support.google.com/cloud/answer/13461325?hl=en-GB . No Cloud changes made by this task.

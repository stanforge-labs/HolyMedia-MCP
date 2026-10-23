# OAuth/OIDC acceptance checklist — owner gated

Canonical MCP resource and audience: `https://mcp.holymedia.kz/mcp/public`. Legacy `/mcp` retains its own audience. Public scope: `adforge:mcp:read`; optional identity scopes: `openid email`. Public advertising WRITE remains disabled.

## Before deployment (separate OWNER approval)

1. Review additive migration `0034_openai_oidc_identity`; keep historic email verification provenance unset. Apply only through the normal migration process after a database backup and compatibility review.
2. Generate an RSA signing key of at least 2048 bits in a protected operator secret store. Set `HOLYMEDIA_OIDC_SIGNING_KEYS_JSON` to an array of objects `{kid,privateKeyPemBase64}` and `HOLYMEDIA_OIDC_ACTIVE_KID` to one listed ID. Never commit, log or place keys in ZIP. Retain former public keys in JWKS at least one hour after rotation; old private keys may be removed only after their tokens expire.
3. Deploy Web consent and API changes together through the existing pipeline. No provider credentials or public WRITE flags need changing.
4. Review legacy users with `emailVerifiedAt` but no `emailVerifiedSource`: OIDC intentionally reports `email_verified=false`. Reverify using the normal email link or an explicitly verified Google login. Do not backfill by assumption.

## Offline and post-deploy checks

- `/.well-known/oauth-authorization-server`: exact issuer, PKCE S256, CIMD, DCR, read/openid/email scopes only while configured.
- `/.well-known/openid-configuration`: valid issuer, `authorization_endpoint`, `token_endpoint`, `userinfo_endpoint`, `jwks_uri`, `RS256`.
- `/.well-known/jwks.json`: current and retained public keys only; no private fields.
- `/oauth/userinfo`: unauthenticated 401; exact public-audience token with `openid` returns `sub`; `email` returns address plus truthful verification state. Expired/revoked/wrong-audience tokens fail.
- Authorization Code + PKCE S256, valid CIMD client, redirect allowlist, explicit consent, optional nonce, ID token signature/audience/issuer/expiry/nonce. Test refresh and revoke; ensure refresh never broadens scope.
- Old READ grant and `/mcp` client reconnect unchanged. Public token must not authenticate to `/mcp`; legacy token must not authenticate to `/mcp/public`.
- All 41 public READ tools have OAuth READ `securitySchemes`; public WRITE and `run_connection_diagnostics` remain unavailable.
- Reviewer uses synthetic workspace only. Positive and negative RU/EN prompts; no provider mutation. Do not claim provider LIVE READ from synthetic data.

`id_token_hint` reauthorization continuity is not implemented: OpenAI documents it as optional. Reauthorization still requires normal login/consent. Record this limitation in review if relevant.

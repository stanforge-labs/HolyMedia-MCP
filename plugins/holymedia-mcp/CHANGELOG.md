# Changelog

## 0.1.1 — draft

- Present the existing product publicly as **HolyPilot** by Holy Media and use the approved star symbol.
- Keep the exact public MCP resource `/mcp/public` and declare OAuth/CIMD with read and OIDC scopes in `mcp.json`.
- Prepare server-side OpenID Connect discovery, UserInfo, RS256 ID tokens, JWKS and email verification provenance. These require a separately approved additive migration and signing-key configuration before portal validation.
- Declare per-tool OAuth scopes for the existing 41 public read tools. No public provider WRITE tool was added or enabled.

The portable manifest identifier changes from `holymedia-mcp` to `holypilot` before public release. Since v0.1.0 was a draft, this package is labeled 0.1.1; if an already-installed client treats the identifier as an immutable installation key, it must reconnect or the owner should publish this as 0.2.0 instead.

# Q/R/S: exact private TEST connection prerequisites

Status: Q/R native client acceptance NOT RUN. Browser approvals in historical
acceptance prove server-side human consent, not either native client's UI or calls.
No production/Public MCP change, ingress, tunnel registration or new key was made.

## Runtime evidence

Internal stock L API returned HTTP200 for authorization-server metadata and
private protected-resource metadata. Issuer/resource are respectively
`http://localhost:4403` and `http://localhost:4403/mcp`; PKCE methods include S256,
scopes include `adforge:mcp:read` and `adforge:mcp:write`. The external approval-only
gateway returns404 for protected-resource metadata. Thus metadata exists inside
the API, but the currently exposed gateway is **not a usable native MCP endpoint**.
This probe did not issue tokens, register clients or call Google.

An isolated TEST native transport must expose the stock private `/mcp` plus its
OAuth metadata/authorization/token/registration and human login/consent routes.
Canonical issuer/resource/callback routing must describe that exact transport;
do not rewrite them to production or substitute an approval URL. Retain the
single TEST account, owner/workspace, minimal scopes, Public writes OFF and stock
CSRF/PKCE/session/approval/TTL/stale/immutable guards. Reusing the active
approval-only runtime by broadening its route allowlist is not a supported shortcut.

## Q: ChatGPT

1. Arrange an authorized private TEST MCP transport and OpenAI Secure MCP Tunnel
   association, or a dedicated authenticated TEST HTTPS ingress. Neither currently
   exists in this acceptance environment. OpenAI tunnel provisioning needs the
   user's Platform/workspace permissions and a locally protected runtime key;
   no key/secret should be pasted into chat.
2. In ChatGPT Plugins, Add custom MCP server, choose the authorized Tunnel or TEST
   remote connection, select OAuth and authenticate interactively. Request read
   scope first and verify customer8590146099 before enabling a separately approved
   controlled-write acceptance scope.
3. Capture real tools/list and authorized READ calls, then the scoped A/M negative
   checks. Any Q B/C mutations require new independent stock browser approvals and
   approved restoration; do not reuse historical preview IDs.

Source: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and [OAuth requirements](https://developers.openai.com/plugins/build/auth).

## R: Gemini CLI (concrete configuration template)

Once a real TEST endpoint has been provisioned, put its URL in the user's private
`.gemini/settings.json`. The placeholder below is **not a working endpoint** and
was not installed by this task:

```json
{
  "mcpServers": {
    "holymediaTest": {
      "httpUrl": "https://YOUR_AUTHORIZED_TEST_HOST/mcp?profile=google_ads_write",
      "trust": false,
      "includeTools": [
        "list_accounts",
        "list_campaigns",
        "get_campaign",
        "list_change_journal"
      ],
      "oauth": {
        "enabled": true,
        "scopes": ["adforge:mcp:read"]
      }
    }
  }
}
```

Run `/mcp auth holymediaTest`, authenticate in the browser, then `/mcp list` and
`/mcp desc`. Do not hardcode a secret in headers, use `trust:true`, disable issuer
validation or enable Google Application Default Credentials as a replacement for
HolyMedia OAuth. CLI OAuth is HolyMedia identity authentication, not a new Google
Ads consent flow. The supplied read tools exist in the stock private profile.

Gemini/Cursor executables were not found in the active PowerShell PATH; installed
UI apps or another machine were not assumed absent. Installing or connecting a
client has not been performed. Read-only connectivity success would not prove
write acceptance or S. Source: [official Gemini MCP configuration and OAuth](https://geminicli.com/docs/tools/mcp-server/).

## S and precise next action

Client tool confirmation and HolyMedia browser approval are separate controls.
For the eventual client write, verify exact preview ID, human owner/session/audit,
confirmedAt, expiry, snapshot digest, one commit, provider reread and journal.
No client automation may approve HolyMedia on behalf of the human.

Next human/operator action: select/authorize the isolated TEST ingress or OpenAI
tunnel association, and identify the client environment. Until a real transport
and client session exist, Q/R remain BLOCKED. No localhost approval link is
presented as MCP, and no private endpoint is published automatically.

# Private TEST MCP: Q / R / S checkpoint

Q (native ChatGPT) and R (native second MCP client) remain BLOCKED: no real client session/tool calls have been proved. S has historical server/browser human-consent evidence, but native client-specific consent presentation is still pending. REST and mock tests are not Q/R LIVE acceptance.

## Current endpoint boundary

The acceptance localhost ports 4402 and 4403 are human approval gateways, **not MCP endpoints**. Their deliberate route allowlists do not expose `/mcp`, OAuth metadata, token or registration routes. Do not put an approval URL into ChatGPT/Cursor MCP configuration.

The implemented private profile is `/mcp?profile=google_ads_write`. Native OAuth targets the private legacy resource; its write scope requires the Google provider gate. Public MCP remains read-only. Existing disposable service-key policy allows only TEST customer 8590146099; no new key or scope expansion is authorized.

## Q: ChatGPT

Use a reachable isolated TEST MCP transport with OAuth metadata, or an authorized Secure MCP Tunnel that preserves the upstream OAuth flow. No such ChatGPT tunnel association/transport has been provisioned or verified here. The endpoint template `https://<isolated-test-host>/mcp?profile=google_ads_write` is a **template, not a working URL**.

Once that prerequisite is authorized and provisioned, open ChatGPT Plugins, choose Add custom MCP server, select the TEST remote connection or available Tunnel, and use OAuth. Authenticate interactively; never paste credentials, cookies or tokens into chat. Review requested minimal scopes and workspace/account restrictions. Start with tools/list, TEST customer read, safe preview and rejection tests. Actual B/C writes require new separate browser human approvals and approved restoration.

OpenAI's [Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) describes workspace association, tunnel permissions and ChatGPT connection. Its [OAuth documentation](https://developers.openai.com/plugins/build/auth) specifies authorization-code PKCE S256 and protected-resource metadata. A tunnel transports requests; it does not replace HolyMedia owner, approval, TTL, stale or immutable-commit guards. No tunnel was created by this checkpoint.

## R: second native client

Identify the client and connect the **same private TEST MCP profile**, not the approval gateway. A local desktop client can use an independently configured localhost MCP tunnel; that transport has not been exposed here. Configure OAuth/credentials only in the client's private credential store. Do not copy the disposable vault key into JSON checked into Git, command arguments or public URLs. Client-specific setup must be checked against that client's actual version before providing executable configuration.

## S: consent evidence

For each real native client write, capture sanitized tool request identity, human browser approval session/audit/confirmedAt, exact preview ID, expiry, immutable digest, one commit identity, provider reread and journal. Never treat the client's tool approval prompt alone as HolyMedia browser approval. Never self-approve.

Next required client action: identify the second client and arrange the authorized private TEST MCP transport/OAuth connection. This independent blocker does not stop N/H/L TEST acceptance or code/mock work. No production endpoint, Public write flag, main branch or deployment was changed.

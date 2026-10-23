# OpenAI Plugin 0.1.1 — owner submission guide

**Do not upload or submit the ZIP yet.** This branch is code-only. Production OIDC discovery was HTTP 404 before deployment; OIDC signing keys and additive migration require separate approval. OpenAI organization verification, legal retention language and API rights also require owner evidence.

## Package and listing

- Plugin: **HolyPilot**; publisher/developer: **Holy Media**. The intent is to update existing draft v0.1.0 to v0.1.1, but Portal acceptance of the changed root `name` has not been verified.
- Remote HTTPS MCP: `https://mcp.holymedia.kz/mcp/public` (not legacy `/mcp`).
- English base subtitle: “Your personal AI marketer”; the `ru-RU` translation carries «Ваш AI-маркетолог» and the longer Russian description. OpenAI currently imports translations without displaying them in the Directory, so the owner must inspect the actual listing before claiming Russian public copy.
- Public functionality: 41 read tools for connected advertising and analytics data, comparisons and structured reports. Data and supported providers depend on account permissions. Public provider WRITE is unavailable.
- Official icon: `assets/icon.svg`, copied from the existing HolyPilot Web star symbol with a square 76 × 76 canvas; the artwork itself is unchanged.
- Five positive and three negative reviewer cases are embedded in the ZIP. A reviewer-accessible video walkthrough remains to be recorded.
- Reviewer identity: isolated synthetic demo workspace; never place its password in ZIP, Git or public listing.

## Required owner review and later Portal steps

1. Inspect the v0.1.0 draft's technical `holymedia-mcp` identity and existing installations. Determine in Portal whether a package with root `name=holypilot` can update it. If not, retain the old technical name for a compatible update or plan a separate identity and explicit migration. Merely changing the version to 0.2.0 does not preserve identity.
2. Approve migration, Web/API rollout and signing-key provisioning separately. Run the OAuth/OIDC checklist against production after that deploy. Do not reuse real advertising data for review.
3. Approve accurate privacy retention timelines, provider API rights and official brand rights. Confirm OpenAI individual/business verification and the correct organization/project. Check legal declarations personally.
4. In the existing OpenAI Plugins draft/version, use **Upload new or existing plugin** with `holypilot-0.1.1.zip`. Do not create an unrelated HolyPilot 2.0 product. Validate ZIP; for the MCP choose **With MCP**, connect OAuth, run **Scan Tools** and review exact 41-tool inventory.
5. Test initial link and reconnect with `openid email adforge:mcp:read`, synthetic reviewer account, all five positive and three negative prompts, wrong workspace/account denial. Record a video walkthrough and provide its private reviewer-accessible URL. Enter reviewer credentials only in the Portal's private reviewer field; confirm login needs no MFA or email code.
6. Verify Directory title, icon, URLs, data handling, deletion/retention and release notes. Submit only after a separate final OWNER decision; record the real submission ID and status.

OpenAI's [packaging](https://developers.openai.com/plugins/build/plugins), [OAuth](https://developers.openai.com/plugins/build/auth), [guidelines](https://developers.openai.com/plugins/plugin-guidelines), [submission](https://developers.openai.com/plugins/deploy/submission) and [app review](https://developers.openai.com/plugins/deploy/app-review) pages are the operative references. There is no OpenAI Portal PASS in this code-only task.

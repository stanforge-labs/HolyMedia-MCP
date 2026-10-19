# Claude developer portal checklist — owner actions

Official references: [build plugins](https://claude.com/resources/articles/build-plugins-for-claude), [plugin manifest](https://code.claude.com/docs/en/plugins-reference), [plugin pre-submission](https://claude.com/docs/plugins/pre-submission-checklist), [directory submission](https://claude.com/docs/directory/publish), [connector checklist](https://claude.com/docs/connectors/building/review-criteria).

## Completed offline

- [x] Minimal `holypilot` bundle with manifest, one fixed HTTPS Streamable HTTP MCP endpoint, five bilingual Skills, README, license notice and official unaltered circular symbol.
- [x] Product and safety claims bounded by the actual public MCP tool list. No secret, local executable, unsupported Google WRITE instruction or test-account credential in the ZIP.
- [x] Local contract test, ZIP integrity, official Claude Code manifest validation.
- [x] Public Privacy Policy and Terms pages observed; Support page exists in source, but external availability should be checked again before submission.

## Manual Claude Pro installation and evidence

- [ ] Owner uploads the ZIP in Customize → Plugins → Add → Upload plugin. Verify the plugin and its five Skills appear. A ZIP upload is not directory submission.
- [ ] Owner adds/connects the bundled remote MCP connector and completes browser OAuth with the correct HolyPilot workspace and READ scope. Do not reuse TEST service keys.
- [ ] In real Claude UI, run `tools/list` and at least one permitted READ such as `list_ad_accounts`, then a selected-account report; retain redacted prompts/results and permission behavior.
- [ ] Confirm missing OAuth, wrong workspace/account, and unavailable provider return safe denials. Confirm no Google Ads production WRITE tool is advertised. Confirm preview/commit tools remain absent when their public gate is OFF.
- [ ] If a controlled write tool is later deliberately enabled in a separately approved environment, verify a Claude client permission prompt plus HolyPilot OWNER browser approval, one-time commit, readback and audit. No Google mutation is authorized by this checklist.

## Publication prerequisites

- [ ] Owner approves a **separate minimal GitHub repository** containing only the nine reviewed plugin files, and links a GitHub account with push permission to the Claude developer portal. The repository may remain private for validation; it must be public before the directory listing goes live. Do not submit the large application repository as the plugin source.
- [ ] Confirm the legal license text and trademark use, current Support URL, Privacy/Terms coverage and accurate data-retention answers.
- [ ] Confirm an appropriate populated reviewer account and any test credentials via Anthropic's secure portal flow only; never commit or paste credentials into the bundle. The remote MCP connector has its own separate review checklist.
- [ ] From the intended long-term Claude organization, open https://claude.ai/directory/manage → Submit new → **MCP connector** for the existing remote endpoint, then a separate **Plugin bundle** using the minimal repository and exact folder/branch. Use the same MCP URL to avoid duplicate tool sets.
- [ ] In the portal, run **Validate**, resolve all blocking findings, answer data-handling questions, check the contact and acknowledgements, and submit for review. Anthropic performs automated validation/security scan and reviews a new plugin listing manually. Submission is not approval; approved listings still require owner publication.

## Decision points

Claude Pro/Max accounts can submit from their own account; Team/Enterprise require an Owner or permitted role. No separate developer verification is stated in the reviewed official rules. OAuth consent, public repository creation, directory submission, and publication each require the owner's own action or explicit permission. Do not treat historical TEST Claude Q/R/S evidence as a real-plugin install result.

# HolyPilot OpenAI Plugin 0.1.1 ZIP

Local artifact: `outputs/openai-plugin/holypilot-0.1.1.zip` (ignored by Git; not uploaded).

SHA-256: `3d20a06fa4e3320f856c16de8392ec89a85a78a6a09c3658508b7f5392146952`

Size: 6,503 bytes. ZIP root entries:

```text
assets/icon.svg
plugin.json
mcp.json
README.md
CHANGELOG.md
```

B1 offline rebuild: `outputs/openai-plugin/holypilot-0.1.1.rebuilt.zip` has SHA-256
`da320376f125056646c818fa6ce64b1fd26317e01dabe1aa1e75a69b586aa52d`.
All five extracted file bytes match the canonical artifact. The different archive
hash reflects ZIP metadata; the distributable plugin contents did not change.

No `.env`, static bearer, OAuth token, client secret, reviewer password, hook, executable or backend source is included. The artifact is a **draft**: canonical Agent Plugins `mcp.json` schema validation conflicts with the OpenAI-specific server OAuth extension, and production OIDC rollout has not happened.

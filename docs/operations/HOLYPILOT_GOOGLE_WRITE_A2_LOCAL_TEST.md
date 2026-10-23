# A2 — localhost Google Ads WRITE profile (offline preparation)

This profile is **OFF by default**. This document does not authorize activation,
Google mutation, OAuth reconnect, or a database change. PR #7 remains Draft.

## Boundary and required protected configuration

The API must run on a WSL2 kernel with `NODE_ENV=development`, `QRS_TEST_RESTRICTED_AUTH=true`,
`QRS_TEST_LOCAL_READONLY_AUTH=false`, and `QRS_TEST_LOCAL_WRITE_ENABLED=true`.
The public Web origin and sole CORS origin must both be
`http://127.0.0.1:23300`; Google Ads OAuth callback must be
`http://127.0.0.1:24404/oauth/google/callback`, and Google Login callback
must be `http://127.0.0.1:24404/auth/google/callback`. These are **external**
host ports; they must not be confused with internal container listener ports.
Before any activation, independently verify that the existing WSL2 TEST Web
and API publish only on these host loopback addresses. The code cannot prove
Docker host port publishing from inside the API container.

Set exactly one `GOOGLE_ADS_WRITE_ACCOUNT_ALLOWLIST=8590146099`, explicitly
enable the base and Stage 2/3/4 Google write gates, and retain
`V2_PREVIEW_ONLY=true`, `V2_CONFIRMED_WRITE_ENABLED=false`, and both Public MCP
write flags `false`. All earlier Q/R/S confirmed-write, Clone, PMax, and
ConversionAction acceptance gates must remain `false`. The public MCP stays
READ-only. Meta Ads write policy is unchanged.

The following protected values are mandatory and must be discovered from the
isolated WSL2 TEST records at the later OWNER-approved acceptance step; do not
copy IDs from production or put secrets in Git:

| Setting                                            | Binding                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| `QRS_TEST_LOCAL_WRITE_WORKSPACE_ID`                | Dedicated active TEST workspace UUID                                  |
| `QRS_TEST_GOOGLE_OWNER_BINDING_USER_ID` / `_EMAIL` | Same active OWNER in that workspace                                   |
| `QRS_TEST_LOCAL_WRITE_CONNECTION_ID`               | New Google Ads connection created by that OWNER in the same workspace |
| `QRS_TEST_LOCAL_WRITE_GRANT_NOT_BEFORE`            | UTC timestamp before new provider OAuth consent and private MCP grant |
| `QRS_TEST_LOCAL_WRITE_OAUTH_GRANT_ID`              | Family UUID of a newly consented private `/mcp` READ+WRITE grant      |

The initial grant ID can be a deliberately unmatched UUID while the new
consent is obtained. This leaves all WRITE denied. The real family UUID must
then be bound through protected TEST configuration and the API restarted once.
An old family with a newly rotated refresh token remains invalid because the
first token's creation time is checked. Revocation or expiration blocks the
next action.

`ProviderConnection` is unique per workspace/provider, and its `createdBy`
does not change on reconnect. The existing PPC-created Google connection
cannot become the OWNER's isolated WRITE connection by replacing its token.
Use a dedicated TEST workspace and a new OWNER-created Google connection;
preserve the PPC workspace and credential. If existing application flows
cannot create that workspace safely, stop and obtain separate OWNER approval
for a reviewed TEST-only provision operation. No schema migration is needed.

## Later manual acceptance, after separate OWNER approval

1. Back up WSL2 TEST and verify the exact loopback host bindings, active OWNER,
   dedicated workspace, empty/isolated Google connection state, and customer
   `8590146099`. Do not proceed with a PPC-owned connection or another account.
2. Configure the profile with a fresh cutoff and unmatched grant UUID. Complete
   a new Google Ads `adwords` OAuth consent as the OWNER in the dedicated
   workspace. Verify `connectedAt > cutoff`, Google granted scopes, and no
   other provider/account is enabled for WRITE.
3. Complete a new private HolyPilot `/mcp` OAuth consent for READ+WRITE. Inspect
   the grant family ID through protected operator access, bind it in TEST
   configuration, and recheck the live principal, role and connection. Do not
   reuse an existing READ-only or PPC grant.
4. Perform READ inventory first. Prepare a single harmless, explicitly chosen
   TEST mutation. Inspect preview and Google `validate_only` response; open
   browser approval as the same OWNER. Only with separate approval for that
   concrete mutation, perform one immutable commit, provider reread, and audit
   verification. Never retry an uncertain commit or trigger automatic rollback.
5. Recheck negative cases: foreign workspace/account, revoked grant, used or
   stale preview, public MCP WRITE, and disabled PMax/ConversionAction. After
   acceptance, return to the read-only TEST profile unless a new approved
   operation is in progress.

The A2 profile blocks PMax asset-group actions and ConversionAction locally.
Their existing distinct, default-OFF gates are preserved for separate review;
none is activated by this profile. Offline tests are not LIVE acceptance.

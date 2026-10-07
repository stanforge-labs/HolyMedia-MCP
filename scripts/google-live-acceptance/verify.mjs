// Run only inside acceptance API container; never follows the Google consent URL.
import { readFileSync, existsSync } from "node:fs";
const { loadConfig } = await import("/workspace/packages/config/dist/index.js");
const { createDatabase, closeDatabase } =
  await import("/workspace/packages/database/dist/index.js");
const config = loadConfig();
if (
  config.providerGoogleAdsWriteEnabled ||
  config.googleAdsWriteAccountAllowlist.length ||
  config.publicMcpWriteScopeEnabled ||
  config.publicMcpControlledWriteEnabled ||
  config.confirmedWriteEnabled ||
  config.providerGoogleLoginCustomerId !== "4378327049" ||
  config.providerGoogleApiVersion !== "v24" ||
  config.providerGoogleRedirectUri !==
    "http://localhost:4400/api/v1/oauth/GOOGLE_ADS/callback"
)
  throw new Error("unsafe_acceptance_configuration");
if (!config.providerGoogleClientId || !config.providerGoogleClientSecret)
  throw new Error("oauth_configuration_missing");
for (const path of ["/health", "/ready"]) {
  const response = await fetch("http://127.0.0.1:4001" + path);
  if (response.status !== 200) throw new Error("acceptance_health_failed");
}
const response = await fetch("http://127.0.0.1:4001/acceptance/oauth/start", {
  redirect: "manual",
});
if (response.status !== 302) throw new Error("oauth_start_http_failed");
const url = new URL(response.headers.get("location"));
if (
  url.origin !== "https://accounts.google.com" ||
  url.searchParams.get("scope") !== "https://www.googleapis.com/auth/adwords" ||
  url.searchParams.get("access_type") !== "offline" ||
  url.searchParams.get("prompt") !== "consent" ||
  url.searchParams.get("redirect_uri") !== config.providerGoogleRedirectUri ||
  !url.searchParams.get("state")
)
  throw new Error("oauth_start_contract_failed");
const db = createDatabase(process.env.DATABASE_URL);
try {
  if (
    (await db.client.providerCredential.count()) ||
    (await db.client.providerConnection.count())
  )
    throw new Error("unexpected_existing_provider_credentials");
  if (
    (await db.client.user.count()) !== 1 ||
    (await db.client.workspace.count()) !== 1
  )
    throw new Error("disposable_identity_mismatch");
  const states = await db.client.oAuthState.count({
    where: {
      provider: "GOOGLE_ADS",
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!states) throw new Error("real_oauth_state_not_created");
} finally {
  await closeDatabase(db);
}
const counts = existsSync("/acceptance-state/provider-counts.jsonl")
  ? readFileSync("/acceptance-state/provider-counts.jsonl", "utf8").trim()
  : "";
if (counts) throw new Error("unexpected_provider_calls_before_consent");
console.log(
  "ACCEPTANCE_API_HEALTHY; OAUTH_START_REAL_ROUTE_PASS; CALLBACK_CONTRACT_PASS; OAUTH_CLIENT_AVAILABLE; WRITE_OFF; ALLOWLIST_EMPTY; PROVIDER_READ_CALLS=0; PROVIDER_WRITE_CALLS=0; VAULT_EMPTY_BEFORE_CONSENT",
);

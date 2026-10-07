// Run inside the disposable API container before enabling validate-only.
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
createRequire("/workspace/apps/api/package.json")("reflect-metadata");
await import("/acceptance/guard.mjs");
const { loadConfig } = await import("/workspace/packages/config/dist/index.js");
const { createDatabase, closeDatabase } =
  await import("/workspace/packages/database/dist/index.js");
const { CredentialVaultService } =
  await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
const { GoogleAdsAdapter } =
  await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
const config = loadConfig(),
  db = createDatabase(config.databaseUrl);
try {
  if (
    config.providerGoogleLoginCustomerId !== "4378327049" ||
    config.providerGoogleApiVersion !== "v24" ||
    config.publicMcpWriteScopeEnabled ||
    config.publicMcpControlledWriteEnabled ||
    config.confirmedWriteEnabled ||
    !config.previewOnly
  )
    throw new Error("unsafe_acceptance_config");
  const connection = await db.client.providerConnection.findFirst({
    where: {
      provider: "GOOGLE_ADS",
      workspace: { slug: "google-test-acceptance" },
    },
    include: { credential: true },
  });
  if (!connection?.credential) throw new Error("stored_credential_missing");
  const vault = new CredentialVaultService(),
    adapter = new GoogleAdsAdapter(config);
  let credentials = vault.decrypt(
    connection.credential.encryptedPayload,
    connection.credential.encryptionVersion,
  );
  if (
    credentials.expiresAt &&
    new Date(credentials.expiresAt).getTime() <= Date.now() + 30_000
  ) {
    credentials = await adapter.refreshCredentials(credentials);
    const encrypted = vault.encrypt(credentials);
    await db.client.providerCredential.update({
      where: { connectionId: connection.id },
      data: {
        encryptedPayload: encrypted.ciphertext,
        encryptionVersion: encrypted.encryptionVersion,
      },
    });
  }
  if (!credentials.scopes.includes("https://www.googleapis.com/auth/adwords"))
    throw new Error("adwords_scope_missing");
  const accessible = await adapter.accessibleCustomers(credentials.accessToken);
  if (
    !accessible.includes("4378327049") ||
    accessible.some((id) => !["4378327049", "8590146099"].includes(id))
  )
    throw new Error("discovery_filter_failed");
  const rows = await adapter.searchStream(
    credentials.accessToken,
    "8590146099",
    "4378327049",
    "SELECT customer.id, customer.test_account, customer.currency_code, customer.time_zone FROM customer",
  );
  const client = rows[0]?.customer;
  if (
    rows.length !== 1 ||
    String(client?.id) !== "8590146099" ||
    client.testAccount !== true ||
    !client.currencyCode ||
    !client.timeZone
  )
    throw new Error("test_account_proof_failed");
  const hierarchy = await adapter.searchStream(
    credentials.accessToken,
    "4378327049",
    "4378327049",
    "SELECT customer_client.id, customer_client.level FROM customer_client WHERE customer_client.level <= 1",
  );
  if (
    !hierarchy.some(
      (row) =>
        String(row.customerClient?.id) === "8590146099" &&
        Number(row.customerClient?.level) === 1,
    )
  )
    throw new Error("test_hierarchy_proof_failed");
  const proof = {
    customer_id: "8590146099",
    test_account: true,
    mcc_id: "4378327049",
    hierarchy: true,
    currency: client.currencyCode,
    timezone: client.timeZone,
    verified_at: new Date().toISOString(),
  };
  writeFileSync("/acceptance-state/test-proof.json", JSON.stringify(proof), {
    mode: 0o600,
  });
  console.log(
    JSON.stringify({
      proof,
      discovery_filter: "PASS",
      unapproved_accounts_queried: 0,
      provider_writes: 0,
    }),
  );
} catch (error) {
  console.log(
    JSON.stringify({
      result: "BLOCKED",
      error_class: error.constructor.name,
      code:
        error.code ??
        (/^[a-z_]+$/.test(error.message) ? error.message : "provider_error"),
      provider_status: error.providerStatus ?? null,
      provider_code: error.providerCode ?? null,
    }),
  );
  process.exitCode = 1;
} finally {
  await closeDatabase(db);
}

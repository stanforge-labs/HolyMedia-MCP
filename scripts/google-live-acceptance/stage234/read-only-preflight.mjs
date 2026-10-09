import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import {
  classifyReadOnlyRequest,
  PREFLIGHT_QUERIES as queries,
  TEST_CLIENT,
  TEST_MCC,
} from "./read-only-guard.mjs";
createRequire("/workspace/apps/api/package.json")("reflect-metadata");
const { loadConfig } = await import("/workspace/packages/config/dist/index.js");
const { createDatabase, closeDatabase } =
  await import("/workspace/packages/database/dist/index.js");
const { CredentialVaultService } =
  await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
const { GoogleAdsAdapter } =
  await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
const source = process.argv[2];
if (!/^[0-9a-f]{40}$/.test(source ?? ""))
  throw Error("stage234_source_identity_required");
const config = loadConfig(),
  db = createDatabase(config.databaseUrl),
  nativeFetch = globalThis.fetch;
const counts = { read: 0, validate_only: 0, write: 0, oauth_refresh: 0 };
globalThis.fetch = async (input, init = {}) => {
  const kind = classifyReadOnlyRequest(input, init);
  counts[kind]++;
  return nativeFetch(input, { ...init, redirect: "error" });
};
const evidence = {
  kind: "Stage 2-4 read-only eligibility preflight",
  source_head: source,
  customer_id: TEST_CLIENT,
  mcc_id: TEST_MCC,
  result: "BLOCKED",
  inventories: {},
  inventory_errors: {},
  production_changed: false,
  main_changed: false,
};
try {
  if (
    config.providerGoogleApiVersion !== "v24" ||
    config.providerGoogleLoginCustomerId !== TEST_MCC ||
    config.publicMcpWriteScopeEnabled ||
    config.publicMcpControlledWriteEnabled ||
    config.confirmedWriteEnabled ||
    !config.previewOnly ||
    new URL(config.databaseUrl).hostname !== "postgres" ||
    new URL(config.databaseUrl).pathname !== "/google_acceptance"
  )
    throw Error("stage234_disposable_config_invalid");
  const connection = await db.client.providerConnection.findFirst({
    where: {
      provider: "GOOGLE_ADS",
      workspace: { slug: "google-test-acceptance" },
    },
    include: { credential: true },
  });
  if (!connection?.credential) throw Error("stage234_vault_credential_missing");
  const vault = new CredentialVaultService(),
    adapter = new GoogleAdsAdapter(config);
  let credentials = vault.decrypt(
    connection.credential.encryptedPayload,
    connection.credential.encryptionVersion,
  );
  if (
    credentials.expiresAt &&
    Date.parse(credentials.expiresAt) <= Date.now() + 30000
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
    throw Error("stage234_scope_missing");
  const read = (query, account = TEST_CLIENT) =>
    adapter.searchStream(credentials.accessToken, account, TEST_MCC, query);
  const proof = await read(queries.customer),
    customer = proof[0]?.customer;
  if (
    proof.length !== 1 ||
    String(customer?.id) !== TEST_CLIENT ||
    customer.testAccount !== true
  )
    throw Error("stage234_test_customer_unproven");
  const mcc = await read(queries.customer, TEST_MCC);
  if (mcc.length !== 1 || String(mcc[0]?.customer?.id) !== TEST_MCC)
    throw Error("stage234_mcc_unavailable");
  const hierarchy = await read(queries.hierarchy, TEST_MCC);
  if (
    hierarchy.length !== 1 ||
    String(hierarchy[0]?.customerClient?.id) !== TEST_CLIENT ||
    Number(hierarchy[0]?.customerClient?.level) !== 1
  )
    throw Error("stage234_hierarchy_unproven");
  evidence.customer = customer;
  evidence.mcc_accessible = true;
  evidence.hierarchy = true;
  for (const [name, query] of Object.entries(queries)) {
    if (["customer", "hierarchy"].includes(name)) continue;
    try {
      evidence.inventories[name] = await read(query);
    } catch (error) {
      evidence.inventory_errors[name] = {
        holyMedia_code: error.code ?? null,
        http_status: error.providerStatus ?? null,
        google_code: error.providerCode ?? null,
        error_class: error.constructor.name,
      };
    }
  }
  const rows = evidence.inventories;
  if (
    [
      "campaigns",
      "groups",
      "keywords",
      "ads",
      "shared_set",
      "attachments",
    ].some((k) => !rows[k])
  )
    throw Error("stage234_fixture_inventory_incomplete");
  if (
    rows.campaigns.length !== 2 ||
    rows.campaigns.some((r) => r.campaign.status !== "PAUSED") ||
    rows.groups.some((r) => r.adGroup.status !== "PAUSED") ||
    rows.ads.some((r) => r.adGroupAd.status !== "PAUSED")
  )
    throw Error("stage234_fixture_status_changed");
  const originals = rows.keywords.filter(
    (r) =>
      String(r.campaign.id) === "24324170853" &&
      String(r.adGroupCriterion.criterionId) !== "11479221",
  );
  const extra = rows.keywords.find(
    (r) => String(r.adGroupCriterion.criterionId) === "11479221",
  );
  if (
    originals.length !== 20 ||
    originals.some((r) => r.adGroupCriterion.status !== "ENABLED") ||
    extra?.adGroupCriterion.status !== "PAUSED" ||
    rows.attachments.length !== 0
  )
    throw Error("stage234_fixture_restoration_changed");
  evidence.original_keywords_enabled = 20;
  evidence.residual_phrase_status = "PAUSED";
  evidence.pending_unconsumed_previews = await db.client.mcpPreview.count({
    where: {
      workspaceId: connection.workspaceId,
      provider: "GOOGLE_ADS",
      consumedAt: null,
      cancelledAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  evidence.result = "PASS_READ_ONLY";
} catch (error) {
  evidence.error = {
    code: /^[a-z0-9_]+$/.test(error.message ?? "")
      ? error.message
      : (error.code ?? "stage234_read_preflight_failed"),
    http_status: error.providerStatus ?? null,
    google_code: error.providerCode ?? null,
    error_class: error.constructor.name,
  };
  process.exitCode = 1;
} finally {
  evidence.counts = counts;
  evidence.timestamp = new Date().toISOString();
  const file = `/acceptance-state/stage234-read-only-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(evidence), { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify(evidence));
  await closeDatabase(db);
}

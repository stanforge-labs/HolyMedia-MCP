// Runtime READ-only entry. Importing this file never loads the stock app or executes requests.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL, URL, URLSearchParams } from "node:url";
import process from "node:process";
const { AbortSignal, structuredClone, console } = globalThis;
import { readAcceptanceContext } from "./context-vault.mjs";
import {
  classifyReadOnlyRequest,
  PREFLIGHT_QUERIES,
} from "./read-only-guard.mjs";
import {
  TARGETING_READ_QUERIES as queries,
  targetingFixture as target,
  classifyTargetingRead,
  prepareAudienceIScenario,
  prepareGeoJScenario,
  pmaxPrerequisiteReadiness,
} from "./scenario-targeting-readiness.mjs";

const fail = (code) => {
  const e = new Error(code);
  e.code = code;
  throw e;
};
const object = (v) =>
  v && typeof v === "object" && !Array.isArray(v) ? v : {};
const canonical = (value) =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, v[k]]),
        )
      : v,
  );
const digest = (value) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : canonical(value))
    .digest("hex");
const date = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
const extraQueries = Object.freeze({
  deliveryCampaigns: PREFLIGHT_QUERIES.campaigns,
  deliveryGroups: PREFLIGHT_QUERIES.groups,
  deliveryAds: PREFLIGHT_QUERIES.ads,
  sharedSet: PREFLIGHT_QUERIES.shared_set,
  attachments: PREFLIGHT_QUERIES.attachments,
});
const snapshotNames = [
  "campaign",
  "group",
  "keywords",
  "ads",
  "groupAudiences",
  "campaignCriteria",
  ...Object.keys(extraQueries),
];
const inventoryNames = [
  "eligibleInterests",
  "userLists",
  "detailedDemographics",
  "city",
  "districts",
  "conversions",
  "assets",
  "pmaxCampaigns",
];
export function assertReadinessRuntime(env, config) {
  if (
    !/^[a-f0-9]{40}$/u.test(env.STAGE234_SOURCE_HEAD ?? "") ||
    !/^[a-f0-9]{40}$/u.test(env.STAGE234_HARNESS_HEAD ?? "") ||
    !/^sha256:[a-f0-9]{64}$/u.test(env.STAGE234_IMAGE_DIGEST ?? "") ||
    env.STAGE234_RUN_DIR !== "/acceptance-state"
  )
    fail("readiness_source_or_directory_invalid");
  let db, redis;
  try {
    db = new URL(config.databaseUrl);
    redis = new URL(config.redisUrl);
  } catch {
    fail("readiness_disposable_config_invalid");
  }
  const writes = [
    config.providerGoogleAdsWriteEnabled,
    config.providerGoogleAdsStage2WriteEnabled,
    config.providerGoogleAdsStage3WriteEnabled,
    config.providerGoogleAdsStage4WriteEnabled,
    config.confirmedWriteEnabled,
    config.publicMcpWriteScopeEnabled,
    config.publicMcpControlledWriteEnabled,
  ];
  if (
    db.hostname !== "postgres" ||
    db.pathname !== "/google_acceptance" ||
    redis.hostname !== "redis" ||
    config.providerGoogleApiVersion !== "v24" ||
    config.providerGoogleLoginCustomerId !== target.mcc ||
    writes.some((v) => v !== false) ||
    config.previewOnly !== true ||
    !["[]", `["${target.customer}"]`].includes(
      canonical(config.googleAdsWriteAccountAllowlist),
    )
  )
    fail("readiness_disposable_config_invalid");
}
export function assertReadinessAuthority(
  { context, baseline, key, enabled, connection },
  now = Date.now(),
) {
  const account = baseline?.account,
    expiry = date(key?.expiresAt);
  if (
    !context?.service_token ||
    !context.key_id ||
    context.key_id !== key?.id ||
    !account ||
    baseline.provider !== "GOOGLE_ADS" ||
    baseline.workspaceId !== account.workspaceId ||
    account.provider !== "GOOGLE_ADS" ||
    account.externalAccountId !== target.customer ||
    account.enabled !== true ||
    !key ||
    key.tokenDigest !== digest(context.service_token) ||
    key.revokedAt ||
    key.serviceIdentity?.revokedAt ||
    key.serviceIdentity?.workspaceId !== account.workspaceId ||
    key.resourceAccessMode !== "STATIC_ALLOWLIST" ||
    canonical(key.accountIds) !== canonical([account.id]) ||
    !Array.isArray(key.scopes) ||
    !key.scopes.includes("adforge:mcp:read") ||
    key.scopes.some(
      (v) => !["adforge:mcp:read", "adforge:mcp:write"].includes(v),
    ) ||
    !Number.isFinite(expiry) ||
    expiry <= now ||
    expiry > now + 24 * 60 * 60 * 1000 + 60000 ||
    (context.expires_at && date(context.expires_at) !== expiry) ||
    enabled?.length !== 1 ||
    enabled[0].externalAccountId !== target.customer ||
    !connection?.credential ||
    connection.id !== account.connectionId ||
    connection.provider !== "GOOGLE_ADS" ||
    connection.workspaceId !== account.workspaceId
  )
    fail("readiness_scoped_authority_invalid");
  return account;
}
export function safeReadinessError(e) {
  const code = e?.writeCode ?? e?.code;
  return {
    source: e?.providerStatus || e?.providerCode ? "GOOGLE_API" : "HOLYMEDIA",
    code:
      typeof code === "string" && /^[a-zA-Z_][a-zA-Z0-9_]{0,99}$/u.test(code)
        ? code
        : "readiness_failure_redacted",
    http_status:
      /^\d{3}$/.test(String(e?.providerStatus)) &&
      Number(e.providerStatus) >= 100 &&
      Number(e.providerStatus) <= 599
        ? Number(e.providerStatus)
        : null,
    google_code:
      typeof e?.providerCode === "string" &&
      /^[A-Z][A-Z0-9_.]{0,119}$/u.test(e.providerCode)
        ? e.providerCode
        : null,
    error_class: [
      "Error",
      "ProviderError",
      "GoogleAdsWriteError",
      "TypeError",
    ].includes(e?.constructor?.name)
      ? e.constructor.name
      : "Error",
  };
}
export function classifyReadinessRequest(input, init = {}) {
  let url;
  try {
    url = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input?.url,
    );
  } catch {
    fail("readiness_non_read_blocked");
  }
  if (url.origin === "https://oauth2.googleapis.com") {
    const params = new URLSearchParams(init.body);
    if (
      canonical([...params.keys()].sort()) !==
        canonical([
          "client_id",
          "client_secret",
          "grant_type",
          "refresh_token",
        ]) ||
      ["client_id", "client_secret", "refresh_token"].some(
        (k) => !params.get(k) || params.get(k).length > 8192,
      )
    )
      fail("readiness_non_read_blocked");
    if (classifyReadOnlyRequest(input, init) !== "oauth_refresh")
      fail("readiness_non_read_blocked");
    return "oauth_refresh";
  }
  let body;
  try {
    body = JSON.parse(String(init.body));
  } catch {
    fail("readiness_non_read_blocked");
  }
  if (Object.values(extraQueries).includes(body.query)) {
    if (
      url.pathname !==
        `/v24/customers/${target.customer}/googleAds:searchStream` ||
      classifyReadOnlyRequest(input, init) !== "read"
    )
      fail("readiness_non_read_blocked");
    return "read";
  }
  return classifyTargetingRead(input, init);
}
export function installReadinessGuard(nativeFetch, counts) {
  return async (input, init = {}) => {
    const kind = classifyReadinessRequest(input, init);
    if (
      (kind === "oauth_refresh" && counts.oauth_refresh >= 1) ||
      (kind === "read" && counts.read >= 80)
    )
      fail("readiness_request_limit_no_retry");
    counts[kind]++;
    const signal = init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)])
      : AbortSignal.timeout(20000);
    try {
      const response = await nativeFetch(input, {
        ...init,
        redirect: "error",
        signal,
      });
      if (!response.ok) counts.failed_http++;
      return response;
    } catch (e) {
      counts.failed_http++;
      throw e;
    }
  };
}
function single(rows, key, code) {
  if (rows?.length !== 1 || !rows[0]?.[key]) fail(code);
  return rows[0][key];
}
function project(v, keys) {
  return Object.fromEntries(
    keys
      .filter((k) => v[k] !== undefined)
      .map((k) => [k, structuredClone(v[k])]),
  );
}
export function assertReadinessCustomer(customerRows, hierarchyRows) {
  const customer = single(
      customerRows,
      "customer",
      "readiness_customer_unproven",
    ),
    h = single(hierarchyRows, "customerClient", "readiness_hierarchy_unproven");
  if (
    String(customer.id) !== target.customer ||
    customer.resourceName !== `customers/${target.customer}` ||
    customer.testAccount !== true ||
    customer.currencyCode !== "USD" ||
    String(h.id) !== target.customer ||
    Number(h.level) !== 1 ||
    h.testAccount !== true
  )
    fail("readiness_customer_or_hierarchy_unproven");
}
export function normalizedReadinessFixture(
  snapshot,
  customerRows,
  hierarchyRows,
  source,
  now = Date.now(),
) {
  assertReadinessCustomer(customerRows, hierarchyRows);
  const c = single(snapshot.campaign, "campaign", "readiness_campaign_missing"),
    g = single(snapshot.group, "adGroup", "readiness_group_missing");
  if (
    String(snapshot.group[0]?.campaign?.id) !== target.campaign ||
    String(c.id) !== target.campaign ||
    String(g.id) !== target.group
  )
    fail("readiness_fixture_parent_invalid");
  const keywords = snapshot.keywords.map((r) => {
    if (
      String(r.campaign?.id) !== target.campaign ||
      String(r.adGroup?.id) !== target.group
    )
      fail("readiness_fixture_parent_invalid");
    const k = project(object(r.adGroupCriterion), [
      "resourceName",
      "criterionId",
      "type",
      "negative",
      "status",
      "keyword",
    ]);
    k.negative = k.negative ?? false;
    return k;
  });
  const ads = snapshot.ads.map((r) => {
    if (
      String(r.campaign?.id) !== target.campaign ||
      String(r.adGroup?.id) !== target.group
    )
      fail("readiness_fixture_parent_invalid");
    const a = object(r.adGroupAd);
    return {
      resourceName: a.resourceName,
      status: a.status,
      ad: project(object(a.ad), ["id", "type"]),
    };
  });
  const campaign = project(c, [
      "id",
      "resourceName",
      "status",
      "advertisingChannelType",
      "biddingStrategyType",
      "targetingSetting",
    ]),
    group = project(g, [
      "id",
      "resourceName",
      "campaign",
      "status",
      "targetingSetting",
    ]);
  for (const parent of [campaign, group])
    if (parent.targetingSetting !== undefined) {
      const setting = parent.targetingSetting;
      if (
        !setting ||
        typeof setting !== "object" ||
        Array.isArray(setting) ||
        (setting.targetRestrictions !== undefined &&
          !Array.isArray(setting.targetRestrictions))
      )
        fail("readiness_targeting_restrictions_invalid");
      parent.targetingSetting = {
        targetRestrictions: structuredClone(setting.targetRestrictions ?? []),
      };
    }
  return {
    source_head: source,
    verified_at: new Date(now).toISOString(),
    customer: project(customerRows[0].customer, [
      "id",
      "resourceName",
      "testAccount",
      "currencyCode",
      "timeZone",
      "conversionTrackingSetting",
    ]),
    hierarchy: {
      id: String(hierarchyRows[0].customerClient.id),
      level: Number(hierarchyRows[0].customerClient.level),
      testAccount: hierarchyRows[0].customerClient.testAccount,
    },
    campaign,
    group,
    keywords,
    ads,
  };
}
export function assertReadinessDelivery(snapshot) {
  const allowed = [target.campaign, "24339483523"],
    prefix = `customers/${target.customer}`;
  if (
    snapshot.deliveryCampaigns?.length !== 2 ||
    new Set(snapshot.deliveryCampaigns.map((r) => String(r.campaign?.id)))
      .size !== 2 ||
    snapshot.deliveryCampaigns.some(
      (r) =>
        !allowed.includes(String(r.campaign?.id)) ||
        r.campaign.status !== "PAUSED" ||
        r.campaign.resourceName !== `${prefix}/campaigns/${r.campaign.id}`,
    ) ||
    snapshot.deliveryGroups?.length !== 3 ||
    snapshot.deliveryAds?.length !== 3
  )
    fail("readiness_delivery_fixture_invalid");
  for (const r of snapshot.deliveryGroups)
    if (
      !allowed.includes(String(r.campaign?.id)) ||
      r.adGroup?.status !== "PAUSED" ||
      r.adGroup.resourceName !== `${prefix}/adGroups/${r.adGroup.id}`
    )
      fail("readiness_delivery_fixture_invalid");
  for (const r of snapshot.deliveryAds)
    if (
      !allowed.includes(String(r.campaign?.id)) ||
      r.adGroupAd?.status !== "PAUSED" ||
      r.adGroupAd.resourceName !==
        `${prefix}/adGroupAds/${r.adGroup?.id}~${r.adGroupAd.ad?.id}`
    )
      fail("readiness_delivery_fixture_invalid");
  const group = snapshot.deliveryGroups.find(
    (r) => String(r.adGroup?.id) === target.group,
  );
  if (
    !group ||
    String(group.campaign?.id) !== target.campaign ||
    String(group.adGroup.cpcBidMicros) !== "100000"
  )
    fail("readiness_n_group_cpc_changed");
  if (
    snapshot.attachments?.length !== 0 ||
    snapshot.sharedSet?.length !== 1 ||
    String(snapshot.sharedSet[0].sharedSet?.id) !== "12261567996" ||
    snapshot.sharedSet[0].sharedSet.resourceName !==
      `${prefix}/sharedSets/12261567996` ||
    snapshot.sharedSet[0].sharedSet.status !== "ENABLED"
  )
    fail("readiness_shared_fixture_invalid");
  if (
    snapshot.campaignCriteria.some(
      (r) =>
        r.campaignCriterion?.type === "KEYWORD" &&
        r.campaignCriterion.negative === true,
    )
  )
    fail("readiness_active_negative_conflict");
}
function criteria(rows, key) {
  // Extended demographic is a valid oneof, not a CriterionType enum value.
  // Keep all raw rows in the immutable snapshot; project audience candidates only.
  if (key === "adGroupCriterion")
    rows = rows.filter(
      (r) =>
        ["USER_LIST", "USER_INTEREST"].includes(r[key]?.type) ||
        r[key]?.extendedDemographic,
    );
  return rows.map((r) =>
    project(object(r[key]), [
      "resourceName",
      key === "campaignCriterion" ? "campaign" : "adGroup",
      "criterionId",
      "type",
      "status",
      "negative",
      "bidModifier",
      "device",
      "userList",
      "userInterest",
      "extendedDemographic",
      "location",
      "language",
      "proximity",
    ]),
  );
}
export function buildTargetingReadinessEvidence({
  fixture,
  snapshot,
  inventories,
  errors,
  source,
  image,
  harness,
  counts,
  unchanged,
  now = Date.now(),
}) {
  const catalogs = {
    eligibleInterests: (inventories.eligibleInterests ?? []).map((r) => ({
      kind: "USER_INTEREST",
      entity: r.userInterest,
    })),
    userLists: (inventories.userLists ?? []).map((r) => ({
      kind: "USER_LIST",
      entity: r.userList,
    })),
    detailedDemographics: (inventories.detailedDemographics ?? []).map((r) => ({
      kind: "DETAILED_DEMOGRAPHIC",
      entity: r.detailedDemographic,
    })),
  };
  const candidates = Object.fromEntries(
    Object.entries(catalogs).map(([name, catalog]) => [
      name,
      prepareAudienceIScenario(
        {
          fixture,
          catalog,
          existing_criteria: criteria(
            snapshot.groupAudiences,
            "adGroupCriterion",
          ),
        },
        source,
        now,
      ),
    ]),
  );
  const invalid = Object.values(candidates).find((r) =>
    r.blockers?.some((b) =>
      [
        "scenario_foreign_resource",
        "scenario_duplicate_resource",
        "scenario_sensitive_input_rejected",
      ].includes(b.code),
    ),
  );
  const I = {
      ...(invalid ??
        Object.values(candidates).find(
          (r) => r.result === "PREPARED_NOT_LIVE",
        ) ??
        candidates.eligibleInterests),
      catalog_results: Object.fromEntries(
        Object.entries(candidates).map(([name, result]) => [
          name,
          {
            result: result.result,
            observed_count: catalogs[name].length,
            blockers: result.blockers ?? [],
          },
        ]),
      ),
    },
    J = prepareGeoJScenario(
      {
        fixture,
        city_candidates: (inventories.city ?? []).map(
          (r) => r.geoTargetConstant,
        ),
        district_candidates: (inventories.districts ?? []).map(
          (r) => r.geoTargetConstant,
        ),
        existing_criteria: criteria(
          snapshot.campaignCriteria,
          "campaignCriterion",
        ),
      },
      source,
      now,
    ),
    PMax = pmaxPrerequisiteReadiness(
      {
        fixture,
        conversion_actions: (inventories.conversions ?? []).map(
          (r) => r.conversionAction,
        ),
        assets: (inventories.assets ?? []).map((r) => r.asset),
        campaigns: (inventories.pmaxCampaigns ?? []).map((r) => r.campaign),
      },
      source,
      now,
    );
  return {
    kind: "stage234_targeting_readiness_fixed_READ_only",
    source_head: source,
    harness_head: harness,
    image_digest: image,
    result: unchanged ? "PASS_READ_ONLY" : "BLOCKED",
    test_customer_id: target.customer,
    mcc_id: target.mcc,
    fixture_unchanged: unchanged,
    fixture_digest: digest(snapshot),
    // Safe fixed-field projection for diagnosing a historical fixture baseline;
    // never dump the adapter response or encrypted context into evidence.
    fixture_campaign_criteria: criteria(
      snapshot.campaignCriteria,
      "campaignCriterion",
    ),
    I,
    J,
    PMax,
    inventory_read_errors: errors,
    inventory_row_counts: Object.fromEntries(
      inventoryNames.map((n) => [n, inventories[n]?.length ?? null]),
    ),
    catalog_sample_policy:
      "Bounded samples only; no zero-inventory global claims. No silent truncation may authorize a write.",
    cross_client: {
      Q: "NOT_RUN_NO_CLIENT_PROOF",
      R: "NOT_RUN_NO_CLIENT_PROOF",
      S: "NOT_RUN_HUMAN_CONSENT_REQUIRED",
    },
    counts,
    provider_read_call_count: counts.read,
    validate_only_call_count: 0,
    real_provider_write_call_count: 0,
    approval_performed: false,
    committed: false,
    production_changed: false,
    main_changed: false,
    timestamp: new Date().toISOString(),
  };
}
async function loadStock() {
  createRequire("/workspace/apps/api/package.json")("reflect-metadata");
  const { loadConfig } =
      await import("/workspace/packages/config/dist/index.js"),
    database = await import("/workspace/packages/database/dist/index.js"),
    { CredentialVaultService } =
      await import("/workspace/apps/api/dist/providers/credential-vault.service.js"),
    { GoogleAdsAdapter } =
      await import("/workspace/apps/api/dist/providers/adapters/google.ads.js");
  return {
    config: loadConfig(),
    createDatabase: database.createDatabase,
    closeDatabase: database.closeDatabase,
    Vault: CredentialVaultService,
    Adapter: GoogleAdsAdapter,
  };
}
function secureDirectory(root) {
  const s = lstatSync(root);
  if (!s.isDirectory() || s.isSymbolicLink() || s.mode & 0o077)
    fail("readiness_directory_permissions_invalid");
}
export async function runTargetingReadiness({
  env = process.env,
  load = loadStock,
  readContext = readAcceptanceContext,
  checkDirectory = secureDirectory,
  save = (file, value) =>
    writeFileSync(file, JSON.stringify(value, null, 2), {
      mode: 0o600,
      flag: "wx",
    }),
  now = () => Date.now(),
} = {}) {
  const counts = {
      read: 0,
      oauth_refresh: 0,
      failed_http: 0,
      validate_only: 0,
      write: 0,
    },
    nativeFetch = globalThis.fetch,
    errors = {},
    inventories = {};
  let db,
    stock,
    stage = "runtime_preflight",
    evidence,
    directoryChecked = false;
  try {
    if (env.STAGE234_RUN_DIR !== "/acceptance-state")
      fail("readiness_source_or_directory_invalid");
    checkDirectory(env.STAGE234_RUN_DIR);
    directoryChecked = true;
    stock = await load();
    assertReadinessRuntime(env, stock.config);
    globalThis.fetch = installReadinessGuard(nativeFetch, counts);
    const vault = new stock.Vault(),
      context = await readContext("/acceptance-state/fixture-context.json", {
        vault,
        allowLegacyExpired: false,
        now: now(),
      });
    db = stock.createDatabase(stock.config.databaseUrl);
    const baseline = await db.client.mcpPreview.findUnique({
        where: { id: context.preview.preview_id },
        include: { account: true },
      }),
      key = await db.client.serviceToken.findUnique({
        where: { tokenDigest: digest(context.service_token) },
        include: { serviceIdentity: true },
      }),
      account = baseline?.account;
    if (
      !account ||
      account.provider !== "GOOGLE_ADS" ||
      account.externalAccountId !== target.customer ||
      baseline.workspaceId !== account.workspaceId ||
      key?.serviceIdentity?.workspaceId !== account.workspaceId ||
      key?.resourceAccessMode !== "STATIC_ALLOWLIST" ||
      canonical(key?.accountIds) !== canonical([account.id])
    )
      fail("readiness_scoped_authority_invalid");
    const enabled = await db.client.providerAccount.findMany({
        where: {
          workspaceId: account?.workspaceId,
          provider: "GOOGLE_ADS",
          enabled: true,
        },
        select: { externalAccountId: true },
      }),
      connection = account
        ? await db.client.providerConnection.findUnique({
            where: { id: account.connectionId },
            include: { credential: true },
          })
        : null;
    assertReadinessAuthority(
      { context, baseline, key, enabled, connection },
      now(),
    );
    const adapter = new stock.Adapter(stock.config);
    let credentials = vault.decrypt(
      connection.credential.encryptedPayload,
      connection.credential.encryptionVersion,
    );
    if (
      !credentials.accessToken ||
      !Array.isArray(credentials.scopes) ||
      !credentials.scopes.includes("https://www.googleapis.com/auth/adwords")
    )
      fail("readiness_adwords_credential_missing");
    if (credentials.expiresAt && date(credentials.expiresAt) <= now() + 60000) {
      stage = "bounded_oauth_refresh";
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
    const read = async (name, customer = target.customer) => {
      const q = queries[name] ?? extraQueries[name];
      if (!q) fail("readiness_query_unknown");
      const rows = await adapter.searchStream(
        credentials.accessToken,
        customer,
        target.mcc,
        q,
      );
      if (!Array.isArray(rows) || rows.length > 5000)
        fail("readiness_inventory_limit");
      return structuredClone(rows).sort((a, b) =>
        canonical(a).localeCompare(canonical(b), "en"),
      );
    };
    const proof = async () => {
      const customer = await read("customer"),
        hierarchy = await read("hierarchy", target.mcc);
      assertReadinessCustomer(customer, hierarchy);
      return { customer, hierarchy };
    };
    const snapshot = async () => {
      const result = {};
      for (const name of snapshotNames) result[name] = await read(name);
      assertReadinessDelivery(result);
      return result;
    };
    stage = "fresh_test_customer_hierarchy";
    const beforeProof = await proof();
    stage = "fixture_before";
    const before = await snapshot();
    const first = normalizedReadinessFixture(
      before,
      beforeProof.customer,
      beforeProof.hierarchy,
      env.STAGE234_SOURCE_HEAD,
      now(),
    );
    if (
      prepareAudienceIScenario(
        {
          fixture: first,
          catalog: [],
          existing_criteria: criteria(
            before.groupAudiences,
            "adGroupCriterion",
          ),
        },
        env.STAGE234_SOURCE_HEAD,
        now(),
      ).blockers?.some((e) => e.code !== "audience_eligibility_not_proven")
    )
      fail("readiness_fixture_proof_invalid");
    stage = "independent_catalog_READs";
    for (const name of inventoryNames)
      try {
        inventories[name] = await read(name);
      } catch (e) {
        errors[name] = safeReadinessError(e);
      }
    stage = "fixture_after";
    const afterProof = await proof(),
      after = await snapshot();
    if (
      canonical(before) !== canonical(after) ||
      canonical(beforeProof) !== canonical(afterProof)
    )
      fail("readiness_fixture_changed_during_READs");
    const fixture = normalizedReadinessFixture(
      after,
      afterProof.customer,
      afterProof.hierarchy,
      env.STAGE234_SOURCE_HEAD,
      now(),
    );
    evidence = buildTargetingReadinessEvidence({
      fixture,
      snapshot: after,
      inventories,
      errors,
      source: env.STAGE234_SOURCE_HEAD,
      image: env.STAGE234_IMAGE_DIGEST,
      harness: env.STAGE234_HARNESS_HEAD,
      counts,
      unchanged: true,
      now: now(),
    });
  } catch (e) {
    evidence = {
      kind: "stage234_targeting_readiness_fixed_READ_only",
      result: "BLOCKED",
      source_head: /^[a-f0-9]{40}$/u.test(env.STAGE234_SOURCE_HEAD ?? "")
        ? env.STAGE234_SOURCE_HEAD
        : null,
      failure_stage: stage,
      error: safeReadinessError(e),
      counts,
      provider_read_call_count: counts.read,
      validate_only_call_count: 0,
      real_provider_write_call_count: 0,
      approval_performed: false,
      committed: false,
      production_changed: false,
      main_changed: false,
      timestamp: new Date(now()).toISOString(),
    };
  } finally {
    globalThis.fetch = nativeFetch;
    if (db && stock?.closeDatabase)
      try {
        await stock.closeDatabase(db);
      } catch (e) {
        evidence.result = "BLOCKED";
        evidence.failure_stage = "database_close";
        evidence.error = safeReadinessError(e);
      }
  }
  const file = directoryChecked
    ? join(env.STAGE234_RUN_DIR, "targeting-readiness-evidence.json")
    : null;
  if (file)
    try {
      save(file, evidence);
    } catch {
      evidence.result = "BLOCKED";
      evidence.error = { code: "readiness_evidence_write_failed" };
      evidence.failure_stage = "evidence_write";
    }
  return {
    result: evidence.result,
    code: evidence.error?.code ?? null,
    provider_reads: counts.read,
    validate_only: 0,
    real_writes: 0,
    evidence: file,
    I: evidence.I?.result ?? "BLOCKED",
    J: evidence.J?.result ?? "BLOCKED",
    PMax: evidence.PMax?.result ?? "BLOCKED",
    failure_stage: evidence.failure_stage ?? null,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const summary = await runTargetingReadiness();
  console.log(JSON.stringify(summary));
  if (summary.result === "BLOCKED") process.exitCode = 1;
}

// Authorized once; all creation is through stock admin API. DB is READ-only here.
import { lstatSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { URL } from "node:url";
import process from "node:process";
import {
  installKeyGuard,
  keyRequest,
  fail,
  assertRenewalSource,
} from "./key-guard.mjs";
import { canonical } from "./live-guard.mjs";
import {
  sealAcceptanceContext,
  readAcceptanceContext,
} from "./context-vault.mjs";
const { console, AbortSignal, setTimeout } = globalThis;
const fetch = (...args) => globalThis.fetch(...args);
let db,
  closeDatabase,
  server,
  stage = "protected_preflight",
  createdId = null;
const root = process.env.STAGE234_KEY_RUN_DIR;
const digest = (s) => createHash("sha256").update(s).digest("hex");
const save = (name, obj) =>
  writeFileSync(join(root, name), JSON.stringify(obj, null, 2), {
    mode: 0o600,
    flag: "wx",
  });
try {
  installKeyGuard();
  for (const p of [root, process.env.STAGE234_KEY_AUTHORITY_DIR]) {
    const st = lstatSync(p);
    if (!st.isDirectory() || st.isSymbolicLink() || st.mode & 0o077)
      fail("stage234_key_state_not_protected");
  }
  const oldContextFile = join(root, "fixture-context.json"),
    st = lstatSync(oldContextFile);
  if (!st.isFile() || st.isSymbolicLink() || st.mode & 0o077)
    fail("stage234_key_old_context_not_protected");
  createRequire("/workspace/apps/api/package.json")("reflect-metadata");
  const context = await readAcceptanceContext(oldContextFile, {
    allowLegacyExpired: true,
  });
  const { loadConfig } =
    await import("/workspace/packages/config/dist/index.js");
  const database = await import("/workspace/packages/database/dist/index.js");
  const { createDatabase } = database;
  closeDatabase = database.closeDatabase;
  const { CredentialVaultService } =
    await import("/workspace/apps/api/dist/providers/credential-vault.service.js");
  const config = loadConfig(),
    dbUrl = new URL(config.databaseUrl);
  if (
    dbUrl.hostname !== "postgres" ||
    dbUrl.pathname !== "/google_acceptance" ||
    new URL(config.redisUrl).hostname !== "redis"
  )
    fail("stage234_key_disposable_database_required");
  db = createDatabase(config.databaseUrl);
  const old = await db.client.serviceToken.findUnique({
    where: { tokenDigest: digest(context.service_token ?? "") },
    include: { serviceIdentity: { include: { createdBy: true } } },
  });
  assertRenewalSource(context, old, process.env);
  const baseline = await db.client.mcpPreview.findUnique({
      where: { id: context.preview?.preview_id },
      include: { account: true },
    }),
    a = baseline?.account;
  if (
    !old ||
    old.revokedAt ||
    old.serviceIdentity.revokedAt ||
    !old.expiresAt ||
    old.expiresAt > new Date() ||
    !a ||
    a.provider !== "GOOGLE_ADS" ||
    a.externalAccountId !== "8590146099" ||
    !a.enabled ||
    old.serviceIdentity.workspaceId !== a.workspaceId ||
    old.resourceAccessMode !== "STATIC_ALLOWLIST" ||
    canonical(old.accountIds) !== canonical([a.id]) ||
    canonical([...old.scopes].sort()) !==
      canonical(["adforge:mcp:read", "adforge:mcp:write"]) ||
    !old.serviceIdentity.createdBy ||
    old.serviceIdentity.createdBy.email !== "google-acceptance@local.invalid" ||
    old.serviceIdentity.createdBy.status !== "active"
  )
    fail("stage234_key_old_owner_or_scope_invalid");
  const oldHash = digest(canonical(old)),
    baselineHash = digest(canonical(baseline)),
    auditHash = digest(
      canonical(
        await db.client.auditEvent.findMany({
          where: { targetId: baseline.id },
          orderBy: { id: "asc" },
        }),
      ),
    );
  const authority = {
    workspace_id: a.workspaceId,
    account_id: a.id,
    customer_id: "8590146099",
    owner_confirmed: true,
    name: process.env.STAGE234_KEY_NAME,
  };
  save("authority.json", authority);
  keyRequest(authority);
  server = spawn(
    process.execPath,
    [
      "--max-old-space-size=192",
      "--import",
      "/stage234/key-guard.mjs",
      "/workspace/apps/api/dist/main.js",
    ],
    {
      cwd: "/workspace",
      stdio: "ignore",
      env: {
        ...process.env,
        STAGE234_KEY_GUARD_PRELOAD: "1",
        LOG_LEVEL: "error",
      },
    },
  );
  let ready = false;
  for (let i = 0; i < 30; i++) {
    if (server.exitCode !== null) fail("stage234_key_stock_api_start_failed");
    try {
      ready = (
        await fetch("http://127.0.0.1:4000/ready", {
          signal: AbortSignal.timeout(1000),
        })
      ).ok;
    } catch {
      /* Local health wait only; never retry key creation. */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) fail("stage234_key_stock_api_not_ready");
  stage = "stock_human_authentication";
  const csrf = await fetch("http://127.0.0.1:4000/api/v1/auth/csrf", {
    signal: AbortSignal.timeout(10000),
  });
  if (!csrf.ok) fail("stage234_key_csrf_route_failed");
  let cookies = csrf.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const proof = (await csrf.json()).csrfToken;
  const login = await fetch("http://127.0.0.1:4000/api/v1/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://localhost:4402",
      cookie: cookies,
      "x-csrf-token": proof,
    },
    body: JSON.stringify({
      email: "google-acceptance@local.invalid",
      password: process.env.ACCEPTANCE_PASSWORD,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!login.ok) fail("stage234_key_human_login_failed");
  const jar = new Map(
    cookies.split("; ").map((c) => c.split(/=(.*)/s).slice(0, 2)),
  );
  for (const c of login.headers.getSetCookie()) {
    const [k, v] = c.split(";")[0].split(/=(.*)/s);
    jar.set(k, v);
  }
  cookies = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const headers = {
    "content-type": "application/json",
    origin: "http://localhost:4402",
    cookie: cookies,
    "x-csrf-token": jar.get("hm_v2_csrf"),
  };
  const session = await fetch("http://127.0.0.1:4000/api/v1/auth/session", {
    headers,
    signal: AbortSignal.timeout(10000),
  });
  if (
    !session.ok ||
    (await session.json()).user?.id !== old.serviceIdentity.createdById
  )
    fail("stage234_key_session_owner_mismatch");
  const route = `http://127.0.0.1:4000/api/v1/workspaces/${a.workspaceId}/service-tokens`;
  if (!(await fetch(route, { headers, signal: AbortSignal.timeout(10000) })).ok)
    fail("stage234_key_admin_permission_denied");
  stage = "stock_admin_create_once";
  const started = Date.now(),
    response = await fetch(route, {
      method: "POST",
      headers,
      body: JSON.stringify(keyRequest(authority)),
      signal: AbortSignal.timeout(15000),
    });
  if (!response.ok) fail("stage234_key_admin_create_rejected_no_retry");
  const issued = await response.json();
  if (
    typeof issued.token !== "string" ||
    !/^hmst_[A-Za-z0-9_-]{43}$/.test(issued.token)
  )
    fail("stage234_key_response_unusable_no_second_key");
  createdId = issued.id;
  const vault = new CredentialVaultService();
  // Encrypt immediately, before verification; never lose a returned secret or
  // persist it in plaintext even if a later metadata/audit check is blocked.
  save(
    "encrypted-context.json",
    sealAcceptanceContext(vault, {
      service_token: issued.token,
      preview: { preview_id: baseline.id },
      key_id: issued.id,
      fingerprint: digest(issued.token),
      expires_at: issued.expiresAt,
    }),
  );
  stage = "created_key_read_only_verification";
  const record = await db.client.serviceToken.findUnique({
    where: { id: issued.id },
    include: { serviceIdentity: true },
  });
  const expiration = record?.expiresAt?.getTime();
  if (
    !record ||
    record.tokenDigest !== digest(issued.token) ||
    record.revokedAt ||
    record.serviceIdentity.createdById !== old.serviceIdentity.createdById ||
    record.serviceIdentity.workspaceId !== a.workspaceId ||
    record.resourceAccessMode !== "STATIC_ALLOWLIST" ||
    canonical(record.accountIds) !== canonical([a.id]) ||
    canonical([...record.scopes].sort()) !==
      canonical(["adforge:mcp:read", "adforge:mcp:write"]) ||
    expiration < started + 86400000 ||
    expiration > Date.now() + 86400000
  )
    fail("stage234_key_created_metadata_mismatch_no_retry");
  const audit = await db.client.auditEvent.findFirst({
    where: {
      targetId: record.id,
      eventType: "service_token_created",
      actorUserId: old.serviceIdentity.createdById,
      workspaceId: a.workspaceId,
      success: true,
    },
  });
  if (!audit) fail("stage234_key_creation_audit_missing");
  const access = await fetch("http://127.0.0.1:4000/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${issued.token}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "stage234-key-access",
      method: "tools/list",
      params: {},
    }),
    signal: AbortSignal.timeout(15000),
  });
  const rpc = await access.json();
  if (!access.ok || rpc.error || !Array.isArray(rpc.result?.tools))
    fail("stage234_key_stock_mcp_access_failed");
  const sameOld = await db.client.serviceToken.findUnique({
    where: { id: old.id },
    include: { serviceIdentity: { include: { createdBy: true } } },
  });
  if (
    digest(canonical(sameOld)) !== oldHash ||
    digest(
      canonical(
        await db.client.mcpPreview.findUnique({
          where: { id: baseline.id },
          include: { account: true },
        }),
      ),
    ) !== baselineHash ||
    digest(
      canonical(
        await db.client.auditEvent.findMany({
          where: { targetId: baseline.id },
          orderBy: { id: "asc" },
        }),
      ),
    ) !== auditHash
  )
    fail("stage234_key_historical_identity_or_evidence_changed");
  const evidence = {
    result: "CREATED",
    renewed_expired_key_id: process.env.STAGE234_KEY_RENEW_EXPIRED_ID ?? null,
    key_id: record.id,
    fingerprint: record.tokenDigest,
    expires_at: record.expiresAt.toISOString(),
    scopes: record.scopes,
    resource_access_mode: "STATIC_ALLOWLIST",
    test_customer_id: "8590146099",
    restricted_account_count: 1,
    same_owner_workspace: true,
    stock_human_auth_and_csrf: true,
    creation_audit: true,
    mcp_access: true,
    secret_storage: "DISPOSABLE_ENCRYPTED_VAULT_ONLY",
    provider_read_calls: 0,
    validate_only_calls: 0,
    real_provider_write_calls: 0,
    production_changed: false,
    main_changed: false,
    timestamp: new Date().toISOString(),
  };
  save("key-evidence.json", evidence);
  console.log(JSON.stringify(evidence));
} catch (error) {
  const result = {
    result: "BLOCKED",
    stage,
    code: /^stage234_[a-z0-9_]+$/.test(error?.message ?? "")
      ? error.message
      : "stage234_key_error_redacted",
    created_key_id: createdId,
    provider_read_calls: 0,
    validate_only_calls: 0,
    real_provider_write_calls: 0,
    no_automatic_second_key: true,
  };
  try {
    save("key-blocked-evidence.json", result);
  } catch {
    /* Do not obscure original safe failure. */
  }
  console.log(JSON.stringify(result));
  process.exitCode = 1;
} finally {
  server?.kill("SIGTERM");
  if (db) await closeDatabase(db);
}

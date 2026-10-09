// READ-only disposable DB diagnostic. No token values, provider imports or writes.
import { lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { URL } from "node:url";
import process from "node:process";
const { console } = globalThis;
let db;
try {
  createRequire("/workspace/apps/api/package.json")("reflect-metadata");
  const { loadConfig } =
    await import("/workspace/packages/config/dist/index.js");
  const { createDatabase } =
    await import("/workspace/packages/database/dist/index.js");
  const config = loadConfig(),
    url = new URL(config.databaseUrl);
  if (url.hostname !== "postgres" || url.pathname !== "/google_acceptance")
    throw new Error("diagnostic_database_not_disposable");
  const root = process.env.STAGE234_RUN_DIR;
  if (!/^\/acceptance-state\/stage234-[A-Za-z0-9_-]+$/.test(root ?? ""))
    throw new Error("diagnostic_context_not_disposable");
  const file = root + "/fixture-context.json",
    stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
    throw new Error("diagnostic_context_not_protected");
  const context = JSON.parse(readFileSync(file, "utf8"));
  db = createDatabase(config.databaseUrl);
  const preview = await db.client.mcpPreview.findUnique({
    where: { id: context.preview?.preview_id },
    include: { account: true },
  });
  const key = await db.client.serviceToken.findUnique({
    where: {
      tokenDigest: createHash("sha256")
        .update(context.service_token ?? "")
        .digest("hex"),
    },
    include: { serviceIdentity: true },
  });
  const account = preview?.account;
  console.log(
    JSON.stringify({
      result: "READ_ONLY_KEY_DIAGNOSIS",
      preview_exists: Boolean(preview),
      selected_test_account:
        account?.externalAccountId === "8590146099" &&
        account.provider === "GOOGLE_ADS",
      account_enabled: account?.enabled === true,
      token_exists: Boolean(key),
      token_revoked: Boolean(key?.revokedAt),
      token_expires_at: key?.expiresAt?.toISOString() ?? null,
      token_expired: Boolean(key?.expiresAt && key.expiresAt <= new Date()),
      identity_revoked: Boolean(key?.serviceIdentity?.revokedAt),
      same_workspace: Boolean(
        key &&
        account &&
        key.serviceIdentity.workspaceId === account.workspaceId,
      ),
      static_allowlist: key?.resourceAccessMode === "STATIC_ALLOWLIST",
      account_scope_count: key?.accountIds?.length ?? null,
      scope_exact_selected_account: Boolean(
        key &&
        account &&
        key.accountIds?.length === 1 &&
        key.accountIds[0] === account.id,
      ),
      mcp_read_scope: key?.scopes?.includes("adforge:mcp:read") === true,
      mcp_write_scope: key?.scopes?.includes("adforge:mcp:write") === true,
      provider_read_calls: 0,
      validate_only_calls: 0,
      real_write_calls: 0,
    }),
  );
} catch {
  console.log(
    JSON.stringify({
      result: "BLOCKED",
      code: "diagnostic_failed_no_sensitive_error_output",
      provider_read_calls: 0,
      validate_only_calls: 0,
      real_write_calls: 0,
    }),
  );
  process.exitCode = 1;
} finally {
  if (db) await db.client.$disconnect();
}

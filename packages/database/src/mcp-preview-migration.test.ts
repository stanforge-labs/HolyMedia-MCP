import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../prisma/migrations/0032_public_mcp_oauth_previews/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
const legacySql = readFileSync(
  new URL(
    "../prisma/migrations/0009_mcp_previews/migration.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("MCP preview principal migration", () => {
  it("preserves legacy service-token rows while adding stable OAuth grant identity", () => {
    expect(sql).toContain(
      "ADD COLUMN \"principal_type\" VARCHAR(24) NOT NULL DEFAULT 'SERVICE_TOKEN'",
    );
    expect(sql).toContain('ALTER COLUMN "service_token_id" DROP NOT NULL');
    for (const field of [
      "oauth_user_id",
      "oauth_client_id",
      "oauth_grant_id",
      "connection_id",
      "before_state",
      "requested_state",
      "snapshot_digest",
      "commit_attempted_at",
      "commit_status",
      "provider_result",
      "verification_read",
    ])
      expect(sql).toContain(`"${field}"`);
    expect(sql).toContain(
      '"principal_type" = \'SERVICE_TOKEN\' AND "service_token_id" IS NOT NULL',
    );
    expect(sql).toContain(
      '"principal_type" = \'OAUTH_USER\' AND "service_token_id" IS NULL',
    );
    expect(sql).toContain('"oauth_grant_id" IS NOT NULL');
    expect(sql).toContain(
      'CREATE INDEX "mcp_previews_oauth_identity_created_at_idx"',
    );
    expect(sql).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i);
  });

  it("applies to a disposable PostgreSQL-compatible database with a legacy preview row", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        CREATE TYPE "ProviderId" AS ENUM ('META_ADS', 'GOOGLE_ADS');
        CREATE TABLE "workspaces" ("id" UUID PRIMARY KEY);
        CREATE TABLE "service_tokens" ("id" UUID PRIMARY KEY);
        CREATE TABLE "provider_accounts" ("id" UUID PRIMARY KEY);
        INSERT INTO "workspaces" VALUES ('11111111-1111-4111-8111-111111111111');
        INSERT INTO "service_tokens" VALUES ('22222222-2222-4222-8222-222222222222');
        INSERT INTO "provider_accounts" VALUES ('33333333-3333-4333-8333-333333333333');
      `);
      await db.exec(legacySql);
      await db.exec(`
        INSERT INTO "mcp_previews" (
          "id", "workspace_id", "service_token_id", "provider", "account_id",
          "external_object_id", "operation", "payload", "diff",
          "preview_token_digest", "expires_at"
        ) VALUES (
          '44444444-4444-4444-8444-444444444444',
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          'META_ADS', '33333333-3333-4333-8333-333333333333',
          '123456789', 'change_name', '{}', '{}', 'legacy-digest', NOW() + INTERVAL '10 minutes'
        );
      `);
      await db.exec(sql);
      const legacy = await db.query<{
        principal_type: string;
        service_token_id: string | null;
        oauth_grant_id: string | null;
      }>(`SELECT "principal_type", "service_token_id", "oauth_grant_id" FROM "mcp_previews"
        WHERE "id" = '44444444-4444-4444-8444-444444444444'`);
      expect(legacy.rows[0]).toMatchObject({
        principal_type: "SERVICE_TOKEN",
        service_token_id: "22222222-2222-4222-8222-222222222222",
        oauth_grant_id: null,
      });

      await db.exec(`
        INSERT INTO "mcp_previews" (
          "id", "workspace_id", "principal_type", "oauth_user_id", "oauth_client_id",
          "oauth_grant_id", "provider", "account_id", "connection_id",
          "external_object_id", "operation", "payload", "diff", "before_state",
          "requested_state", "snapshot_digest", "preview_token_digest", "expires_at"
        ) VALUES (
          '55555555-5555-4555-8555-555555555555',
          '11111111-1111-4111-8111-111111111111', 'OAUTH_USER',
          '66666666-6666-4666-8666-666666666666',
          '77777777-7777-4777-8777-777777777777',
          '88888888-8888-4888-8888-888888888888',
          'META_ADS', '33333333-3333-4333-8333-333333333333',
          '99999999-9999-4999-8999-999999999999',
          '123456789', 'META_CAMPAIGN_PAUSE', '{}', '{}', '{}', '{}',
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          'oauth-digest', NOW() + INTERVAL '10 minutes'
        );
      `);
      const oauth = await db.query<{
        service_token_id: string | null;
        oauth_grant_id: string;
      }>(
        `SELECT "service_token_id", "oauth_grant_id" FROM "mcp_previews"
         WHERE "id" = '55555555-5555-4555-8555-555555555555'`,
      );
      expect(oauth.rows[0]).toMatchObject({
        service_token_id: null,
        oauth_grant_id: "88888888-8888-4888-8888-888888888888",
      });
      await expect(
        db.exec(`
        INSERT INTO "mcp_previews" (
          "id", "workspace_id", "principal_type", "provider", "account_id",
          "external_object_id", "operation", "payload", "diff",
          "preview_token_digest", "expires_at"
        ) VALUES (
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          '11111111-1111-4111-8111-111111111111', 'OAUTH_USER',
          'META_ADS', '33333333-3333-4333-8333-333333333333',
          '123456789', 'META_CAMPAIGN_RENAME', '{}', '{}', 'invalid-digest',
          NOW() + INTERVAL '10 minutes'
        );
      `),
      ).rejects.toThrow();
    } finally {
      await db.close();
    }
  }, 20_000);
});

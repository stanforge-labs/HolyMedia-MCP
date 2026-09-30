-- Existing service-token previews keep their identity and foreign key.
-- OAuth previews bind to a stable refresh-family grant, not a short-lived access token.
ALTER TABLE "mcp_previews"
  ADD COLUMN "principal_type" VARCHAR(24) NOT NULL DEFAULT 'SERVICE_TOKEN',
  ADD COLUMN "oauth_user_id" UUID,
  ADD COLUMN "oauth_client_id" UUID,
  ADD COLUMN "oauth_grant_id" UUID,
  ADD COLUMN "connection_id" UUID,
  ADD COLUMN "before_state" JSONB,
  ADD COLUMN "requested_state" JSONB,
  ADD COLUMN "snapshot_digest" VARCHAR(64),
  ADD COLUMN "commit_attempted_at" TIMESTAMP(3),
  ADD COLUMN "commit_status" VARCHAR(40),
  ADD COLUMN "provider_result" JSONB,
  ADD COLUMN "verification_read" JSONB;

ALTER TABLE "mcp_previews" ALTER COLUMN "service_token_id" DROP NOT NULL;

ALTER TABLE "mcp_previews"
  ADD CONSTRAINT "mcp_previews_principal_check" CHECK (
    ("principal_type" = 'SERVICE_TOKEN' AND "service_token_id" IS NOT NULL
      AND "oauth_user_id" IS NULL AND "oauth_client_id" IS NULL AND "oauth_grant_id" IS NULL)
    OR
    ("principal_type" = 'OAUTH_USER' AND "service_token_id" IS NULL
      AND "oauth_user_id" IS NOT NULL AND "oauth_client_id" IS NOT NULL
      AND "oauth_grant_id" IS NOT NULL)
  );

CREATE INDEX "mcp_previews_oauth_identity_created_at_idx"
  ON "mcp_previews"("oauth_user_id", "oauth_client_id", "oauth_grant_id", "created_at");

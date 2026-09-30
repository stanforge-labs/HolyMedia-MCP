-- Nullable additions preserve old service-token previews and old API reads.
-- A unique digest prevents one browser nonce from addressing two previews.
ALTER TABLE "mcp_previews"
  ADD COLUMN "approval_token_digest" VARCHAR(128),
  ADD COLUMN "approved_by_user_id" UUID,
  ADD COLUMN "approval_session_id" UUID,
  ADD COLUMN "cancelled_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "mcp_previews_approval_token_digest_key"
  ON "mcp_previews"("approval_token_digest");

ALTER TABLE "mcp_previews"
  ADD CONSTRAINT "mcp_previews_oauth_user_id_fkey"
    FOREIGN KEY ("oauth_user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mcp_previews_oauth_client_id_fkey"
    FOREIGN KEY ("oauth_client_id") REFERENCES "oauth_public_clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "mcp_previews_approved_user_check"
    CHECK ("approved_by_user_id" IS NULL OR "approved_by_user_id" = "oauth_user_id");

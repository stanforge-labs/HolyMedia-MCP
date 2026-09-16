-- Preserve least-privilege semantics for existing tokens. A non-empty legacy
-- account_ids array was an intentional static restriction; no existing token
-- is widened by this migration.
CREATE TYPE "ServiceTokenResourceAccessMode" AS ENUM (
  'ALL_CONNECTED',
  'STATIC_ALLOWLIST'
);

ALTER TABLE "service_tokens"
  ADD COLUMN "resource_access_mode" "ServiceTokenResourceAccessMode";

UPDATE "service_tokens"
SET "resource_access_mode" = CASE
  WHEN COALESCE(jsonb_array_length("account_ids"), 0) > 0
    THEN 'STATIC_ALLOWLIST'::"ServiceTokenResourceAccessMode"
  ELSE 'ALL_CONNECTED'::"ServiceTokenResourceAccessMode"
END;

ALTER TABLE "service_tokens"
  ALTER COLUMN "resource_access_mode" SET NOT NULL,
  ALTER COLUMN "resource_access_mode" SET DEFAULT 'ALL_CONNECTED';

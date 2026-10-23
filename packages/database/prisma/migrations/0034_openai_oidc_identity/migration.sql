-- Existing email_verified_at alone does not prove how the address was verified.
-- Leave historic rows unclassified; only future verified flows set a source.
ALTER TABLE "users" ADD COLUMN "email_verified_source" VARCHAR(32);
ALTER TABLE "oauth_authorization_transactions" ADD COLUMN "nonce" VARCHAR(255);
ALTER TABLE "oauth_authorization_codes" ADD COLUMN "nonce" VARCHAR(255);

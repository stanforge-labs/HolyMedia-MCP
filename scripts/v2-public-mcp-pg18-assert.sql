-- Assertions for the exact objects added by 0032 and 0033.
DO $$
DECLARE
  missing text;
BEGIN
  IF (SELECT count(*) FROM _prisma_migrations
      WHERE migration_name IN ('0032_public_mcp_oauth_previews', '0033_public_mcp_browser_approval')
        AND finished_at IS NOT NULL AND rolled_back_at IS NULL) <> 2 THEN
    RAISE EXCEPTION 'Public MCP migrations are not both successful';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'An unfinished migration remains';
  END IF;
  SELECT string_agg(column_name, ', ') INTO missing
  FROM unnest(ARRAY[
    'principal_type', 'oauth_user_id', 'oauth_client_id', 'oauth_grant_id',
    'connection_id', 'before_state', 'requested_state', 'snapshot_digest',
    'commit_attempted_at', 'commit_status', 'provider_result', 'verification_read',
    'approval_token_digest', 'approved_by_user_id', 'approval_session_id', 'cancelled_at'
  ]) AS required(column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'mcp_previews'
      AND information_schema.columns.column_name = required.column_name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing Public MCP preview columns: %', missing;
  END IF;
  IF (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'mcp_previews'
        AND column_name = 'service_token_id') <> 'YES' THEN
    RAISE EXCEPTION 'Legacy service_token_id is not nullable';
  END IF;
  SELECT string_agg(name, ', ') INTO missing
  FROM unnest(ARRAY[
    'mcp_previews_principal_check', 'mcp_previews_oauth_user_id_fkey',
    'mcp_previews_oauth_client_id_fkey', 'mcp_previews_approved_user_check'
  ]) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'mcp_previews'::regclass AND conname = required.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing Public MCP constraints: %', missing;
  END IF;
  SELECT string_agg(name, ', ') INTO missing
  FROM unnest(ARRAY[
    'mcp_previews_oauth_identity_created_at_idx',
    'mcp_previews_approval_token_digest_key'
  ]) AS required(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'mcp_previews'
      AND indexname = required.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'Missing Public MCP indexes: %', missing;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    WHERE c.relname = 'mcp_previews_approval_token_digest_key' AND i.indisunique
  ) THEN
    RAISE EXCEPTION 'Approval token digest index is not unique';
  END IF;
END $$;

SELECT current_setting('server_version') AS postgres_version;
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE migration_name IN ('0032_public_mcp_oauth_previews', '0033_public_mcp_browser_approval')
ORDER BY migration_name;

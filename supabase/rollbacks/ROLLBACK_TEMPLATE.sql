-- Rollback template for critical Kajola migrations.
-- Copy to: supabase/rollbacks/YYYYMMDD_HHMMSS_description.rollback.sql
-- Required when a migration contains ALLOW_DESTRUCTIVE_MIGRATION.

BEGIN;

-- 1. State the production backup/snapshot reference.
-- 2. Add reversal SQL here.
-- 3. Prefer forward-fix migrations when data loss is possible.

-- Example:
-- ALTER TABLE example_table ADD COLUMN restored_column TEXT;

COMMIT;

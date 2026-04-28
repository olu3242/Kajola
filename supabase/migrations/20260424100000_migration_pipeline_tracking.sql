CREATE TABLE IF NOT EXISTS migration_deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  environment TEXT NOT NULL CHECK (environment IN ('local','staging','production')),
  migration_version TEXT NOT NULL,
  migration_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','applied','failed','rolled_back')),
  drift_status TEXT NOT NULL DEFAULT 'unknown' CHECK (drift_status IN ('unknown','clean','drift_detected')),
  backup_reference TEXT,
  commit_sha TEXT,
  error_message TEXT,
  applied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(environment, migration_version)
);

CREATE INDEX IF NOT EXISTS idx_migration_deployments_env_created ON migration_deployments(environment, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_migration_deployments_status ON migration_deployments(status);

ALTER TABLE migration_deployments ENABLE ROW LEVEL SECURITY;
CREATE POLICY migration_deployments_admin_read ON migration_deployments
FOR SELECT USING (has_role('tenant_admin') OR has_role('super_admin'));
CREATE POLICY migration_deployments_super_admin_all ON migration_deployments
FOR ALL USING (has_role('super_admin'));

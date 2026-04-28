CREATE TABLE IF NOT EXISTS operator_dashboard_cache (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_operator_dashboard_cache ON operator_dashboard_cache;
CREATE TRIGGER set_updated_at_operator_dashboard_cache
BEFORE UPDATE ON operator_dashboard_cache
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_operator_dashboard_cache_expires ON operator_dashboard_cache(expires_at);

ALTER TABLE operator_dashboard_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY operator_dashboard_cache_admin_read ON operator_dashboard_cache
FOR SELECT USING (has_role('tenant_admin') OR has_role('super_admin'));
CREATE POLICY operator_dashboard_cache_super_admin_all ON operator_dashboard_cache
FOR ALL USING (has_role('super_admin'));

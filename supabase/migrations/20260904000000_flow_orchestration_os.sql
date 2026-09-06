-- Kajola Flow Orchestration OS
-- Additive persistence for versioned flow graphs, durable instances, runtime
-- work, event receipts, checkpoints and immutable execution evidence.

CREATE TABLE IF NOT EXISTS flow_definitions (
  flow_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL,
  definition jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (flow_key, version)
);

CREATE OR REPLACE FUNCTION prevent_active_flow_definition_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.is_active THEN
    RAISE EXCEPTION 'active flow definitions are immutable; publish a new version';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flow_definitions_immutable ON flow_definitions;
CREATE TRIGGER flow_definitions_immutable
BEFORE UPDATE OR DELETE ON flow_definitions
FOR EACH ROW EXECUTE FUNCTION prevent_active_flow_definition_mutation();

CREATE TABLE IF NOT EXISTS flow_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_key text NOT NULL,
  flow_version integer NOT NULL,
  workflow_type text NOT NULL,
  workflow_id text NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN (
    'PENDING','READY','RUNNING','WAITING','WAITING_FOR_EVENT','WAITING_FOR_HUMAN',
    'WAITING_FOR_AGENT','SCHEDULED','COMPLETED','FAILED','TIMED_OUT','ESCALATED',
    'COMPENSATING','COMPENSATED','CANCELLED'
  )),
  context jsonb NOT NULL DEFAULT '{}',
  actor jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id text,
  lock_version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  FOREIGN KEY (flow_key, flow_version) REFERENCES flow_definitions(flow_key, version),
  UNIQUE (flow_key, flow_version, workflow_type, workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_flow_instances_status ON flow_instances(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_flow_instances_tenant ON flow_instances(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flow_instances_correlation ON flow_instances(correlation_id);
CREATE INDEX IF NOT EXISTS idx_flow_instances_workflow ON flow_instances(workflow_type, workflow_id);

CREATE TABLE IF NOT EXISTS flow_step_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_instance_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  node_id text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  idempotency_key text NOT NULL UNIQUE,
  input jsonb,
  output jsonb,
  failure_type text,
  error_message text,
  retryable boolean,
  assigned_actor jsonb,
  lease_owner text,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_instance_id, node_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_flow_steps_ready ON flow_step_instances(status, scheduled_at, lease_expires_at)
  WHERE status IN ('READY', 'SCHEDULED', 'RUNNING');
CREATE INDEX IF NOT EXISTS idx_flow_steps_instance ON flow_step_instances(flow_instance_id, created_at);

CREATE TABLE IF NOT EXISTS flow_event_receipts (
  event_id text NOT NULL,
  flow_instance_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  correlation_id uuid NOT NULL,
  causation_id text,
  payload jsonb NOT NULL DEFAULT '{}',
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, flow_instance_id)
);

CREATE TABLE IF NOT EXISTS flow_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_instance_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  step_instance_id uuid NOT NULL REFERENCES flow_step_instances(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('SYSTEM','HUMAN','AGENT','AUTOMATION','EXTERNAL','SUBFLOW')),
  assigned_actor jsonb,
  status text NOT NULL,
  due_at timestamptz,
  claimed_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  comments jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flow_tasks_assignment ON flow_tasks(tenant_id, status, due_at);

CREATE TABLE IF NOT EXISTS flow_handoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_instance_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  step_instance_id uuid REFERENCES flow_step_instances(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  source_actor jsonb NOT NULL,
  target_actor jsonb NOT NULL,
  reason text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','CLAIMED','COMPLETED','REJECTED','ESCALATED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_flow_handoffs_target ON flow_handoffs(tenant_id, status, created_at);

CREATE TABLE IF NOT EXISTS flow_timers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_instance_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  step_instance_id uuid NOT NULL REFERENCES flow_step_instances(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  wake_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CLAIMED','FIRED','CANCELLED','FAILED')),
  idempotency_key text NOT NULL UNIQUE,
  fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flow_timers_due ON flow_timers(wake_at) WHERE status = 'SCHEDULED';

CREATE TABLE IF NOT EXISTS flow_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_instance_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  checkpoint_key text NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_instance_id, checkpoint_key)
);

CREATE TABLE IF NOT EXISTS flow_compensations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_instance_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  step_instance_id uuid REFERENCES flow_step_instances(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  handler text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','RUNNING','COMPLETED','FAILED','MANUAL_INTERVENTION')),
  idempotency_key text NOT NULL UNIQUE,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS flow_audit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_instance_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id text,
  step_instance_id uuid REFERENCES flow_step_instances(id) ON DELETE SET NULL,
  details jsonb NOT NULL DEFAULT '{}',
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_flow_audit_trace ON flow_audit_entries(flow_instance_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_flow_audit_correlation ON flow_audit_entries(correlation_id, occurred_at);

-- Extend the existing durable event/outbox envelope instead of creating a
-- competing event bus.
ALTER TABLE system_events
  ADD COLUMN IF NOT EXISTS schema_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS correlation_id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS causation_id text,
  ADD COLUMN IF NOT EXISTS workflow_id text,
  ADD COLUMN IF NOT EXISTS flow_instance_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS step_instance_id uuid REFERENCES flow_step_instances(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS actor jsonb;

CREATE INDEX IF NOT EXISTS idx_system_events_correlation ON system_events(correlation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_system_events_flow ON system_events(flow_instance_id, created_at);

-- New database-emitted events use the same dotted taxonomy as application
-- adapters. The event worker retains aliases for legacy tenant rules.
DROP TRIGGER IF EXISTS record_booking_confirmed_event ON bookings;
CREATE TRIGGER record_booking_confirmed_event AFTER UPDATE OF status ON bookings
FOR EACH ROW WHEN (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_system_event_trigger('booking.confirmed', 'booking');

DROP TRIGGER IF EXISTS record_booking_completed_event ON bookings;
CREATE TRIGGER record_booking_completed_event AFTER UPDATE OF status ON bookings
FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_system_event_trigger('booking.completed', 'booking');

DROP TRIGGER IF EXISTS record_payment_successful_event ON payments;
CREATE TRIGGER record_payment_successful_event AFTER UPDATE OF status ON payments
FOR EACH ROW WHEN (NEW.status = 'successful' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_system_event_trigger('payment.succeeded', 'payment');

DROP TRIGGER IF EXISTS record_review_created_event ON reviews;
CREATE TRIGGER record_review_created_event AFTER INSERT ON reviews
FOR EACH ROW EXECUTE FUNCTION record_system_event_trigger('review.submitted', 'review');

DROP TRIGGER IF EXISTS record_artisan_verified_event ON artisans;
CREATE TRIGGER record_artisan_verified_event AFTER UPDATE OF verified ON artisans
FOR EACH ROW WHEN (NEW.verified = TRUE AND OLD.verified IS DISTINCT FROM NEW.verified)
EXECUTE FUNCTION record_system_event_trigger('provider.verified', 'artisan');

DROP TRIGGER IF EXISTS record_artisan_onboarded_event ON artisans;
CREATE TRIGGER record_artisan_onboarded_event AFTER UPDATE OF onboarding_status ON artisans
FOR EACH ROW WHEN (NEW.onboarding_status = 'profile_created' AND OLD.onboarding_status IS DISTINCT FROM NEW.onboarding_status)
EXECUTE FUNCTION record_system_event_trigger('provider.onboarded', 'artisan');

DROP TRIGGER IF EXISTS record_referral_completed_event ON artisan_referrals;
CREATE TRIGGER record_referral_completed_event AFTER UPDATE OF status ON artisan_referrals
FOR EACH ROW WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_system_event_trigger('referral.completed', 'artisan_referral');

-- Atomic optimistic update: callers receive no row when their version is stale.
CREATE OR REPLACE FUNCTION update_flow_instance(
  target_id uuid,
  expected_version bigint,
  next_status text,
  next_context jsonb
) RETURNS SETOF flow_instances
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE flow_instances
     SET status = next_status,
         context = next_context,
         lock_version = lock_version + 1,
         updated_at = now()
   WHERE id = target_id AND lock_version = expected_version
  RETURNING *;
$$;

-- Runtime workers claim eligible work with row locks; orchestration decides
-- meaning, while Runtime OS owns leases and delivery.
CREATE OR REPLACE FUNCTION claim_ready_flow_steps(worker_id text, batch_size integer DEFAULT 25)
RETURNS SETOF flow_step_instances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id FROM flow_step_instances
    WHERE status = 'READY'
      AND (scheduled_at IS NULL OR scheduled_at <= now())
      AND (lease_expires_at IS NULL OR lease_expires_at < now())
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(batch_size, 1), 100)
  )
  UPDATE flow_step_instances step
     SET status = 'RUNNING',
         lease_owner = worker_id,
         lease_expires_at = now() + interval '2 minutes',
         heartbeat_at = now(),
         started_at = COALESCE(started_at, now())
    FROM candidates
   WHERE step.id = candidates.id
  RETURNING step.*;
END;
$$;

REVOKE ALL ON FUNCTION update_flow_instance(uuid, bigint, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_ready_flow_steps(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_flow_instance(uuid, bigint, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION claim_ready_flow_steps(text, integer) TO service_role;

ALTER TABLE flow_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_step_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_event_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_compensations ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_audit_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read active flow definitions" ON flow_definitions FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "tenant members read flow instances" ON flow_instances FOR SELECT TO authenticated USING (tenant_id = current_user_tenant_id() OR has_role('super_admin'));
CREATE POLICY "tenant members read flow steps" ON flow_step_instances FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM flow_instances f WHERE f.id = flow_instance_id AND (f.tenant_id = current_user_tenant_id() OR has_role('super_admin'))));
CREATE POLICY "tenant members read flow tasks" ON flow_tasks FOR SELECT TO authenticated USING (tenant_id = current_user_tenant_id() OR has_role('super_admin'));
CREATE POLICY "tenant members read flow handoffs" ON flow_handoffs FOR SELECT TO authenticated USING (tenant_id = current_user_tenant_id() OR has_role('super_admin'));
CREATE POLICY "tenant members read flow checkpoints" ON flow_checkpoints FOR SELECT TO authenticated USING (tenant_id = current_user_tenant_id() OR has_role('super_admin'));
CREATE POLICY "operators read flow evidence" ON flow_audit_entries FOR SELECT TO authenticated USING (has_role('super_admin'));

GRANT SELECT ON flow_definitions, flow_instances, flow_step_instances, flow_tasks, flow_handoffs, flow_checkpoints, flow_audit_entries TO authenticated;
GRANT ALL ON flow_definitions, flow_instances, flow_step_instances, flow_event_receipts, flow_tasks, flow_handoffs, flow_timers, flow_checkpoints, flow_compensations, flow_audit_entries TO service_role;

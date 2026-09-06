-- Kajola RC1 durable runtime convergence (forward-only)
-- Activates the existing Runtime/Flow/Workflow boundaries with transaction-safe
-- persistence, slot claims, callbacks, financial truth and provider evidence.

CREATE TABLE IF NOT EXISTS runtime_schema_versions (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO runtime_schema_versions(version) VALUES ('20260904010000_rc1_durable_runtime') ON CONFLICT DO NOTHING;

-- ── Flow aggregate persistence ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION persist_flow_instance(instance_payload jsonb, expected_version bigint DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_id uuid := (instance_payload->>'id')::uuid;
  current_version bigint;
  step_payload jsonb;
  checkpoint_payload jsonb;
BEGIN
  SELECT lock_version INTO current_version FROM flow_instances WHERE id = target_id FOR UPDATE;

  IF current_version IS NULL THEN
    IF expected_version IS NOT NULL THEN RAISE EXCEPTION 'FLOW_VERSION_CONFLICT' USING ERRCODE = '40001'; END IF;
    INSERT INTO flow_instances (
      id, flow_key, flow_version, workflow_type, workflow_id, tenant_id, status,
      context, actor, correlation_id, causation_id, lock_version, created_at,
      updated_at, completed_at, cancelled_at
    ) VALUES (
      target_id, instance_payload->>'flowKey', (instance_payload->>'flowVersion')::integer,
      instance_payload->>'workflowType', instance_payload->>'workflowId',
      NULLIF(instance_payload->>'tenantId','')::uuid, instance_payload->>'status',
      COALESCE(instance_payload->'context','{}'), instance_payload->'actor',
      (instance_payload->>'correlationId')::uuid, instance_payload->>'causationId',
      (instance_payload->>'version')::bigint, (instance_payload->>'createdAt')::timestamptz,
      (instance_payload->>'updatedAt')::timestamptz,
      NULLIF(instance_payload->>'completedAt','')::timestamptz,
      NULLIF(instance_payload->>'cancelledAt','')::timestamptz
    );
  ELSE
    IF expected_version IS NULL OR current_version <> expected_version THEN
      RAISE EXCEPTION 'FLOW_VERSION_CONFLICT' USING ERRCODE = '40001';
    END IF;
    UPDATE flow_instances SET
      status = instance_payload->>'status', context = COALESCE(instance_payload->'context','{}'),
      actor = instance_payload->'actor', causation_id = instance_payload->>'causationId',
      lock_version = (instance_payload->>'version')::bigint,
      updated_at = (instance_payload->>'updatedAt')::timestamptz,
      completed_at = NULLIF(instance_payload->>'completedAt','')::timestamptz,
      cancelled_at = NULLIF(instance_payload->>'cancelledAt','')::timestamptz
    WHERE id = target_id;
  END IF;

  FOR step_payload IN SELECT value FROM jsonb_array_elements(COALESCE(instance_payload->'steps','[]')) LOOP
    INSERT INTO flow_step_instances (
      id, flow_instance_id, node_id, node_type, status, attempt, idempotency_key,
      input, output, failure_type, error_message, retryable, assigned_actor,
      started_at, scheduled_at, completed_at
    ) VALUES (
      (step_payload->>'id')::uuid, target_id, step_payload->>'nodeId',
      COALESCE(step_payload->>'nodeType','SYSTEM_TASK'), step_payload->>'status',
      (step_payload->>'attempt')::integer, step_payload->>'idempotencyKey',
      step_payload->'input', step_payload->'output', step_payload#>>'{error,type}',
      step_payload#>>'{error,message}', COALESCE((step_payload#>>'{error,retryable}')::boolean,false),
      step_payload->'assignedActor', NULLIF(step_payload->>'startedAt','')::timestamptz,
      NULLIF(step_payload->>'scheduledAt','')::timestamptz,
      NULLIF(step_payload->>'completedAt','')::timestamptz
    ) ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status, attempt = EXCLUDED.attempt, idempotency_key = EXCLUDED.idempotency_key,
      input = EXCLUDED.input, output = EXCLUDED.output, failure_type = EXCLUDED.failure_type,
      error_message = EXCLUDED.error_message, retryable = EXCLUDED.retryable,
      assigned_actor = EXCLUDED.assigned_actor, started_at = EXCLUDED.started_at,
      scheduled_at = EXCLUDED.scheduled_at,
      completed_at = EXCLUDED.completed_at;

    IF step_payload->>'status' = 'SCHEDULED' AND NULLIF(step_payload->>'scheduledAt','') IS NOT NULL THEN
      INSERT INTO flow_timers (flow_instance_id, step_instance_id, tenant_id, wake_at, status, idempotency_key)
      VALUES (target_id, (step_payload->>'id')::uuid, NULLIF(instance_payload->>'tenantId','')::uuid,
        (step_payload->>'scheduledAt')::timestamptz, 'SCHEDULED', step_payload->>'idempotencyKey' || ':timer')
      ON CONFLICT (idempotency_key) DO NOTHING;
    ELSIF step_payload->>'status' = 'COMPLETED' THEN
      UPDATE flow_timers SET status = 'FIRED', fired_at = COALESCE(fired_at, now())
      WHERE step_instance_id = (step_payload->>'id')::uuid AND status IN ('SCHEDULED','CLAIMED');
    END IF;
  END LOOP;

  FOR checkpoint_payload IN SELECT value FROM jsonb_array_elements(COALESCE(instance_payload->'checkpoints','[]')) LOOP
    INSERT INTO flow_checkpoints (id, flow_instance_id, tenant_id, checkpoint_key, evidence_refs, created_at)
    VALUES (
      (checkpoint_payload->>'id')::uuid, target_id, NULLIF(instance_payload->>'tenantId','')::uuid,
      checkpoint_payload->>'key', COALESCE(checkpoint_payload->'evidenceRefs','[]'),
      (checkpoint_payload->>'createdAt')::timestamptz
    ) ON CONFLICT (flow_instance_id, checkpoint_key) DO UPDATE
      SET evidence_refs = EXCLUDED.evidence_refs;
  END LOOP;
  RETURN target_id;
END;
$$;

REVOKE ALL ON FUNCTION persist_flow_instance(jsonb, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION persist_flow_instance(jsonb, bigint) TO service_role;

-- ── Durable worker health, callback expectations and dead-letter evidence ───
CREATE TABLE IF NOT EXISTS runtime_worker_heartbeats (
  worker_id text PRIMARY KEY,
  worker_type text NOT NULL,
  runtime_mode text NOT NULL CHECK (runtime_mode IN ('sandbox','production')),
  deployment_sha text,
  metadata jsonb NOT NULL DEFAULT '{}',
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE system_events
  ADD COLUMN IF NOT EXISTS orchestration_status text NOT NULL DEFAULT 'PENDING'
    CHECK (orchestration_status IN ('PENDING','PROCESSING','PROCESSED','RETRYING','DEAD_LETTER')),
  ADD COLUMN IF NOT EXISTS orchestration_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS orchestration_error text;
CREATE INDEX IF NOT EXISTS idx_system_events_orchestration ON system_events(orchestration_status, created_at)
  WHERE orchestration_status IN ('PENDING','RETRYING');

DROP TRIGGER IF EXISTS record_booking_held_event ON bookings;
CREATE TRIGGER record_booking_held_event AFTER INSERT ON bookings
FOR EACH ROW WHEN (NEW.status = 'held')
EXECUTE FUNCTION record_system_event_trigger('booking.held', 'booking');

CREATE OR REPLACE FUNCTION validate_booking_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status = 'held' AND NEW.status IN ('awaiting_payment','confirmed','cancelled')) OR
    (OLD.status = 'pending' AND NEW.status IN ('held','awaiting_payment','cancelled')) OR
    (OLD.status = 'awaiting_payment' AND NEW.status IN ('paid','confirmed','in_progress','cancelled')) OR
    (OLD.status = 'paid' AND NEW.status IN ('confirmed','cancelled')) OR
    (OLD.status = 'confirmed' AND NEW.status IN ('checked_in','in_progress','completed','cancelled','no_show')) OR
    (OLD.status = 'checked_in' AND NEW.status IN ('in_progress','completed','cancelled')) OR
    (OLD.status = 'in_progress' AND NEW.status IN ('completed','cancelled','disputed')) OR
    (OLD.status = 'completed' AND NEW.status = 'disputed')
  ) THEN RAISE EXCEPTION 'Invalid booking status transition: % -> %', OLD.status, NEW.status; END IF;
  IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN NEW.confirmed_at = now(); END IF;
  IF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN NEW.completed_at = now(); END IF;
  IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at = now(); END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS flow_callback_expectations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  flow_instance_id uuid NOT NULL REFERENCES flow_instances(id) ON DELETE CASCADE,
  step_instance_id uuid REFERENCES flow_step_instances(id) ON DELETE SET NULL,
  callback_type text NOT NULL,
  provider text NOT NULL,
  provider_reference text NOT NULL,
  correlation_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING','RECEIVED','EXPIRED','CANCELLED')),
  expires_at timestamptz,
  received_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz,
  UNIQUE (provider, provider_reference, callback_type)
);

ALTER TABLE flow_timers
  ADD COLUMN IF NOT EXISTS timer_type text,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message text;

CREATE TABLE IF NOT EXISTS workflow_dead_letters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  flow_instance_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  step_instance_id uuid REFERENCES flow_step_instances(id) ON DELETE SET NULL,
  event_id uuid REFERENCES system_events(id) ON DELETE SET NULL,
  failure_class text NOT NULL,
  error_message text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  attempts integer NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','REPLAYING','RESOLVED','DISCARDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_callback_waiting ON flow_callback_expectations(provider, provider_reference) WHERE status = 'WAITING';
CREATE INDEX IF NOT EXISTS idx_dead_letters_open ON workflow_dead_letters(created_at) WHERE status = 'OPEN';

CREATE OR REPLACE FUNCTION claim_ready_flow_steps(worker_id text, batch_size integer DEFAULT 25)
RETURNS SETOF flow_step_instances
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT id, status FROM flow_step_instances
    WHERE (status = 'READY' AND (scheduled_at IS NULL OR scheduled_at <= now()))
       OR (status = 'RUNNING' AND lease_expires_at < now())
    ORDER BY created_at FOR UPDATE SKIP LOCKED
    LIMIT LEAST(GREATEST(batch_size, 1), 100)
  )
  UPDATE flow_step_instances step SET
    status = 'RUNNING',
    attempt = CASE WHEN candidates.status = 'RUNNING' THEN step.attempt + 1 ELSE step.attempt END,
    lease_owner = worker_id, lease_expires_at = now() + interval '2 minutes',
    heartbeat_at = now(), started_at = COALESCE(started_at, now())
  FROM candidates WHERE step.id = candidates.id RETURNING step.*;
END;
$$;
REVOKE ALL ON FUNCTION claim_ready_flow_steps(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_ready_flow_steps(text, integer) TO service_role;

-- ── Transaction-safe slot holds ─────────────────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS quote_snapshot_id uuid;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS flow_instance_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL;
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS staff_id uuid REFERENCES staff_members(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE RESTRICT;

-- Real database constraints (not merely GiST indexes). Team bookings exclude by
-- staff member; solo/provider bookings exclude by artisan when no staff is set.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_staff_no_active_overlap') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_staff_no_active_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        staff_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (staff_id IS NOT NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL
        AND status IN ('held','awaiting_payment','confirmed','in_progress','checked_in'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_provider_no_active_overlap') THEN
    ALTER TABLE bookings ADD CONSTRAINT bookings_provider_no_active_overlap
      EXCLUDE USING gist (
        tenant_id WITH =,
        artisan_id WITH =,
        tstzrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (staff_id IS NULL AND starts_at IS NOT NULL AND ends_at IS NOT NULL
        AND status IN ('held','awaiting_payment','confirmed','in_progress','checked_in'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS quote_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES booking_slots(id) ON DELETE RESTRICT,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  currency text NOT NULL,
  subtotal bigint NOT NULL CHECK (subtotal >= 0),
  discount bigint NOT NULL DEFAULT 0 CHECK (discount >= 0),
  customer_fee bigint NOT NULL DEFAULT 0 CHECK (customer_fee >= 0),
  total bigint NOT NULL CHECK (total >= 0),
  pricing_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION create_slot_hold(
  target_slot_id uuid, target_service_id uuid, target_customer_id uuid,
  target_tenant_id uuid, target_quote_snapshot_id uuid, request_key uuid,
  hold_minutes integer DEFAULT 15, target_staff_id uuid DEFAULT NULL
) RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE slot_row booking_slots; quote_row quote_snapshots; result bookings;
BEGIN
  SELECT * INTO result FROM bookings WHERE idempotency_key = request_key AND tenant_id = target_tenant_id;
  IF FOUND THEN RETURN result; END IF;
  SELECT * INTO slot_row FROM booking_slots WHERE id = target_slot_id AND tenant_id = target_tenant_id FOR UPDATE;
  IF NOT FOUND OR slot_row.status <> 'available' THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO quote_row FROM quote_snapshots
    WHERE id = target_quote_snapshot_id AND tenant_id = target_tenant_id
      AND customer_id = target_customer_id AND slot_id = target_slot_id
    FOR SHARE;
  IF NOT FOUND OR quote_row.expires_at <= now() THEN RAISE EXCEPTION 'STALE_QUOTE' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO bookings (
    tenant_id, slot_id, service_id, artisan_id, client_id, status, held_until,
    total_amount_kobo, idempotency_key, quote_snapshot_id, starts_at, ends_at, staff_id
  ) VALUES (
    target_tenant_id, target_slot_id, target_service_id, slot_row.artisan_id,
    target_customer_id, 'held', now() + make_interval(mins => LEAST(GREATEST(hold_minutes,1),30)),
    quote_row.total, request_key, target_quote_snapshot_id, slot_row.start_at, slot_row.end_at, target_staff_id
  ) RETURNING * INTO result;
  UPDATE booking_slots SET status = 'held', held_by_user_id = target_customer_id,
    booking_id = result.id, updated_at = now() WHERE id = target_slot_id;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION release_expired_slot_holds(batch_size integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE released integer;
BEGIN
  WITH expired AS (
    SELECT id, slot_id FROM bookings WHERE status = 'held' AND held_until <= now()
    ORDER BY held_until FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(batch_size,1),500)
  ), cancelled AS (
    UPDATE bookings b SET status = 'cancelled', cancellation_reason = 'hold_expired',
      cancelled_at = now(), updated_at = now() FROM expired e WHERE b.id = e.id RETURNING e.slot_id
  )
  UPDATE booking_slots s SET status = 'available', held_by_user_id = NULL, booking_id = NULL,
    updated_at = now() FROM cancelled c WHERE s.id = c.slot_id;
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;

REVOKE ALL ON FUNCTION create_slot_hold(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_expired_slot_holds(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_slot_hold(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION release_expired_slot_holds(integer) TO service_role;

-- ── Business aggregate/readiness ────────────────────────────────────────────
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS business_type text NOT NULL DEFAULT 'SOLO' CHECK (business_type IN ('SOLO','TEAM')),
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'DRAFT'
    CHECK (lifecycle_status IN ('DRAFT','SETUP_IN_PROGRESS','PAYMENT_PENDING','READY_TO_PUBLISH','ACTIVE','SUSPENDED')),
  ADD COLUMN IF NOT EXISTS readiness jsonb NOT NULL DEFAULT '{"profile_ready":false,"location_ready":false,"staff_ready":false,"services_ready":false,"availability_ready":false,"booking_policy_ready":false,"payment_policy_ready":false,"payout_ready":false,"marketplace_ready":false}',
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS booking_policy jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS payment_policy jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS payout_state text NOT NULL DEFAULT 'NOT_CONFIGURED'
    CHECK (payout_state IN ('NOT_CONFIGURED','PENDING','READY','BLOCKED'));

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS branch_id uuid REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE artisans ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES businesses(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS staff_service_assignments (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  staff_id uuid NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  service_id uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, service_id)
);
ALTER TABLE staff_service_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant staff service isolation" ON staff_service_assignments FOR ALL
  USING (tenant_id = current_user_tenant_id() OR has_role('super_admin'));

CREATE OR REPLACE FUNCTION refresh_business_readiness(target_business_id uuid)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result businesses; profile_ok boolean; location_ok boolean; staff_ok boolean; services_ok boolean; availability_ok boolean; booking_ok boolean; payment_ok boolean; payout_ok boolean;
BEGIN
  SELECT * INTO result FROM businesses WHERE id = target_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_NOT_FOUND'; END IF;
  profile_ok := length(trim(result.name)) > 0 AND length(trim(result.category)) > 0 AND COALESCE(length(trim(result.description)),0) > 0;
  SELECT EXISTS(SELECT 1 FROM branches WHERE business_id = result.id AND is_active) INTO location_ok;
  SELECT result.business_type = 'SOLO' OR EXISTS(SELECT 1 FROM staff_members s JOIN branches b ON b.id=s.branch_id WHERE b.business_id=result.id AND s.is_active) INTO staff_ok;
  SELECT EXISTS(SELECT 1 FROM services WHERE business_id = result.id AND is_active) INTO services_ok;
  SELECT EXISTS(SELECT 1 FROM staff_availability_windows w JOIN staff_members s ON s.id=w.staff_id JOIN branches b ON b.id=s.branch_id WHERE b.business_id=result.id) INTO availability_ok;
  booking_ok := result.booking_policy <> '{}'::jsonb;
  payment_ok := result.payment_policy <> '{}'::jsonb;
  payout_ok := result.payout_state = 'READY';
  UPDATE businesses SET readiness = jsonb_build_object(
    'profile_ready',profile_ok,'location_ready',location_ok,'staff_ready',staff_ok,
    'services_ready',services_ok,'availability_ready',availability_ok,
    'booking_policy_ready',booking_ok,'payment_policy_ready',payment_ok,
    'payout_ready',payout_ok,'marketplace_ready',(profile_ok AND location_ok AND staff_ok AND services_ok AND availability_ok AND booking_ok AND payment_ok AND payout_ok)
  ), lifecycle_status = CASE
    WHEN lifecycle_status IN ('ACTIVE','SUSPENDED') THEN lifecycle_status
    WHEN profile_ok AND location_ok AND staff_ok AND services_ok AND availability_ok AND booking_ok AND payment_ok AND payout_ok THEN 'READY_TO_PUBLISH'
    WHEN payment_ok AND NOT payout_ok THEN 'PAYMENT_PENDING'
    ELSE 'SETUP_IN_PROGRESS' END,
    updated_at = now() WHERE id = result.id RETURNING * INTO result;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION publish_business(target_business_id uuid)
RETURNS businesses LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result businesses; required_keys text[] := ARRAY['profile_ready','location_ready','staff_ready','services_ready','availability_ready','booking_policy_ready','payment_policy_ready','payout_ready','marketplace_ready']; missing text;
BEGIN
  SELECT * INTO result FROM businesses WHERE id = target_business_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BUSINESS_NOT_FOUND'; END IF;
  SELECT string_agg(key, ',') INTO missing FROM unnest(required_keys) key
    WHERE COALESCE((result.readiness->>key)::boolean,false) = false
      AND NOT (result.business_type = 'SOLO' AND key = 'staff_ready');
  IF missing IS NOT NULL THEN RAISE EXCEPTION 'BUSINESS_NOT_READY:%', missing; END IF;
  UPDATE businesses SET lifecycle_status = 'ACTIVE', is_active = true,
    published_at = COALESCE(published_at,now()), updated_at = now()
  WHERE id = target_business_id RETURNING * INTO result;
  UPDATE artisans SET is_active = true, updated_at = now() WHERE business_id = target_business_id;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION refresh_business_readiness(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION publish_business(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refresh_business_readiness(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION publish_business(uuid) TO service_role;

-- ── Provider callback, notification and append-only financial evidence ──────
CREATE TABLE IF NOT EXISTS provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  provider_reference text,
  signature_valid boolean NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','VERIFIED','PROCESSED','REJECTED','FAILED')),
  error_message text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (provider, provider_event_id)
);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','SENDING','DELIVERED','FAILED','RETRYING')),
  ADD COLUMN IF NOT EXISTS source_event_id uuid REFERENCES system_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provider text,
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS notifications_idempotency_key_unique ON notifications(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS financial_ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
  entry_type text NOT NULL CHECK (entry_type IN ('SERVICE_SUBTOTAL','DISCOUNT','DEPOSIT','CUSTOMER_FEE','KAJOLA_FEE','PROVIDER_FEE','PROCESSOR_FEE','TIP','PROVIDER_RECEIVABLE','REFUND','SETTLEMENT','ADJUSTMENT')),
  direction text NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'NGN',
  idempotency_key text NOT NULL UNIQUE,
  reverses_entry_id uuid REFERENCES financial_ledger_entries(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FINANCIAL_LEDGER_IS_APPEND_ONLY'; END $$;
DROP TRIGGER IF EXISTS financial_ledger_append_only ON financial_ledger_entries;
CREATE TRIGGER financial_ledger_append_only BEFORE UPDATE OR DELETE ON financial_ledger_entries
FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  booking_id uuid NOT NULL REFERENCES bookings(id), payment_id uuid NOT NULL REFERENCES payments(id),
  amount bigint NOT NULL CHECK (amount > 0), reason text NOT NULL, actor jsonb NOT NULL,
  provider_reference text, provider_response jsonb, approval_state text NOT NULL DEFAULT 'PENDING',
  status text NOT NULL DEFAULT 'REFUND_REQUESTED' CHECK (status IN ('REFUND_REQUESTED','REFUND_PROCESSING','REFUND_SUCCEEDED','REFUND_FAILED')),
  idempotency_key text NOT NULL UNIQUE, attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
  booking_id uuid NOT NULL REFERENCES bookings(id), payment_id uuid REFERENCES payments(id),
  provider_id uuid NOT NULL REFERENCES artisans(id), amount bigint NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'NGN', status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ALLOCATED','PROCESSING','SETTLED','FAILED','REVERSED')),
  provider_reference text, idempotency_key text NOT NULL UNIQUE, attempts integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS: private operational/financial state is tenant-scoped; service role
-- writes. Consumers can see only records reachable from their own bookings. ──
ALTER TABLE quote_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_worker_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_callback_expectations ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_dead_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant quote isolation" ON quote_snapshots FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR customer_id = auth.uid() OR has_role('super_admin'));
CREATE POLICY "operator worker health" ON runtime_worker_heartbeats FOR SELECT TO authenticated USING (has_role('super_admin'));
CREATE POLICY "tenant callback isolation" ON flow_callback_expectations FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role('super_admin'));
CREATE POLICY "operator dead letters" ON workflow_dead_letters FOR SELECT TO authenticated USING (has_role('super_admin'));
CREATE POLICY "operator provider events" ON provider_events FOR SELECT TO authenticated USING (has_role('super_admin'));
CREATE POLICY "tenant ledger isolation" ON financial_ledger_entries FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role('super_admin') OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.client_id = auth.uid()));
CREATE POLICY "tenant refund isolation" ON refunds FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role('super_admin') OR EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND b.client_id = auth.uid()));
CREATE POLICY "tenant settlement isolation" ON settlements FOR SELECT TO authenticated
  USING (tenant_id = current_user_tenant_id() OR has_role('super_admin'));

-- Tighten legacy blanket tenant policies. A shared marketplace tenant must not
-- make one consumer's private commerce records visible to another consumer.
DROP POLICY IF EXISTS tenant_isolation ON bookings;
CREATE POLICY "customers read own bookings" ON bookings FOR SELECT TO authenticated
  USING (client_id = auth.uid() OR user_id = auth.uid());
CREATE POLICY "providers read own bookings" ON bookings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM artisans a WHERE a.id = artisan_id AND a.user_id = auth.uid()));
CREATE POLICY "tenant admins manage bookings" ON bookings FOR ALL TO authenticated
  USING (has_role('tenant_admin') AND tenant_id = current_user_tenant_id())
  WITH CHECK (has_role('tenant_admin') AND tenant_id = current_user_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON payments;
CREATE POLICY "customers read own payments" ON payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_id AND (b.client_id = auth.uid() OR b.user_id = auth.uid())));
CREATE POLICY "providers read own payments" ON payments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM bookings b JOIN artisans a ON a.id=b.artisan_id WHERE b.id = booking_id AND a.user_id = auth.uid()));
CREATE POLICY "tenant admins manage payments" ON payments FOR ALL TO authenticated
  USING (has_role('tenant_admin') AND tenant_id = current_user_tenant_id())
  WITH CHECK (has_role('tenant_admin') AND tenant_id = current_user_tenant_id());

DROP POLICY IF EXISTS tenant_isolation ON services;
CREATE POLICY "marketplace reads active services" ON services FOR SELECT TO authenticated USING (is_active = true);
CREATE POLICY "providers manage own services" ON services FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM artisans a WHERE a.id = artisan_id AND a.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM artisans a WHERE a.id = artisan_id AND a.user_id = auth.uid()));
CREATE POLICY "tenant admins manage services" ON services FOR ALL TO authenticated
  USING (has_role('tenant_admin') AND tenant_id = current_user_tenant_id())
  WITH CHECK (has_role('tenant_admin') AND tenant_id = current_user_tenant_id());

DROP POLICY IF EXISTS "tenant isolation" ON businesses;
CREATE POLICY "owners manage own business" ON businesses FOR ALL TO authenticated
  USING (owner_user_id = auth.uid()) WITH CHECK (owner_user_id = auth.uid());
CREATE POLICY "marketplace reads active businesses" ON businesses FOR SELECT TO authenticated
  USING (lifecycle_status = 'ACTIVE' AND is_active = true);
CREATE POLICY "tenant admins manage businesses" ON businesses FOR ALL TO authenticated
  USING (has_role('tenant_admin') AND tenant_id = current_user_tenant_id())
  WITH CHECK (has_role('tenant_admin') AND tenant_id = current_user_tenant_id());

DROP POLICY IF EXISTS "tenant members read flow instances" ON flow_instances;
CREATE POLICY "authorized parties read booking flows" ON flow_instances FOR SELECT TO authenticated USING (
  has_role('super_admin') OR
  (has_role('tenant_admin') AND tenant_id = current_user_tenant_id()) OR
  (workflow_type = 'booking' AND EXISTS (
    SELECT 1 FROM bookings b LEFT JOIN artisans a ON a.id=b.artisan_id
    WHERE b.id::text = workflow_id AND (b.client_id = auth.uid() OR b.user_id = auth.uid() OR a.user_id = auth.uid())
  ))
);

DROP POLICY IF EXISTS "tenant members read flow steps" ON flow_step_instances;
CREATE POLICY "authorized parties read flow steps" ON flow_step_instances FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM flow_instances f WHERE f.id = flow_instance_id));

DROP POLICY IF EXISTS "tenant ledger isolation" ON financial_ledger_entries;
CREATE POLICY "authorized parties read ledger" ON financial_ledger_entries FOR SELECT TO authenticated USING (
  has_role('super_admin') OR (has_role('tenant_admin') AND tenant_id = current_user_tenant_id()) OR
  EXISTS (SELECT 1 FROM bookings b LEFT JOIN artisans a ON a.id=b.artisan_id WHERE b.id = booking_id AND (b.client_id = auth.uid() OR b.user_id = auth.uid() OR a.user_id = auth.uid()))
);
DROP POLICY IF EXISTS "tenant refund isolation" ON refunds;
CREATE POLICY "authorized parties read refunds" ON refunds FOR SELECT TO authenticated USING (
  has_role('super_admin') OR (has_role('tenant_admin') AND tenant_id = current_user_tenant_id()) OR
  EXISTS (SELECT 1 FROM bookings b LEFT JOIN artisans a ON a.id=b.artisan_id WHERE b.id = booking_id AND (b.client_id = auth.uid() OR b.user_id = auth.uid() OR a.user_id = auth.uid()))
);
DROP POLICY IF EXISTS "tenant settlement isolation" ON settlements;
CREATE POLICY "authorized parties read settlements" ON settlements FOR SELECT TO authenticated USING (
  has_role('super_admin') OR (has_role('tenant_admin') AND tenant_id = current_user_tenant_id()) OR
  EXISTS (SELECT 1 FROM artisans a WHERE a.id = provider_id AND a.user_id = auth.uid())
);

GRANT SELECT ON quote_snapshots, financial_ledger_entries, refunds, settlements TO authenticated;
GRANT SELECT ON runtime_worker_heartbeats, flow_callback_expectations, workflow_dead_letters, provider_events TO authenticated;
GRANT ALL ON quote_snapshots, runtime_worker_heartbeats, flow_callback_expectations, workflow_dead_letters,
  provider_events, financial_ledger_entries, refunds, settlements TO service_role;
GRANT SELECT ON runtime_schema_versions TO service_role;

-- Kajola R3-R8 vertical convergence: commerce, fulfillment, settlement,
-- reconciliation, operator governance, observability, automation and Agentic OS.
INSERT INTO runtime_schema_versions(version) VALUES ('20260905000000_r3_r8_vertical_convergence') ON CONFLICT DO NOTHING;

-- R3: extend the canonical immutable quote rather than introduce a second quote engine.
ALTER TABLE quote_snapshots
  ADD COLUMN IF NOT EXISTS payment_arrangement text NOT NULL DEFAULT 'FULL'
    CHECK (payment_arrangement IN ('FULL','DEPOSIT','PARTIAL','PAY_AT_SERVICE','CASH')),
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'card'
    CHECK (payment_method IN ('card','bank_transfer','payment_link','ussd','bank_account','pay_at_venue','cash')),
  ADD COLUMN IF NOT EXISTS service_base bigint NOT NULL DEFAULT 0 CHECK (service_base >= 0),
  ADD COLUMN IF NOT EXISTS add_ons bigint NOT NULL DEFAULT 0 CHECK (add_ons >= 0),
  ADD COLUMN IF NOT EXISTS service_price bigint NOT NULL DEFAULT 0 CHECK (service_price >= 0),
  ADD COLUMN IF NOT EXISTS provider_fee bigint NOT NULL DEFAULT 0 CHECK (provider_fee >= 0),
  ADD COLUMN IF NOT EXISTS payment_processing_cost bigint NOT NULL DEFAULT 0 CHECK (payment_processing_cost >= 0),
  ADD COLUMN IF NOT EXISTS transfer_cost bigint NOT NULL DEFAULT 0 CHECK (transfer_cost >= 0),
  ADD COLUMN IF NOT EXISTS settlement_cost bigint NOT NULL DEFAULT 0 CHECK (settlement_cost >= 0),
  ADD COLUMN IF NOT EXISTS tax_if_applicable bigint NOT NULL DEFAULT 0 CHECK (tax_if_applicable >= 0),
  ADD COLUMN IF NOT EXISTS tip bigint NOT NULL DEFAULT 0 CHECK (tip >= 0),
  ADD COLUMN IF NOT EXISTS subsidy bigint NOT NULL DEFAULT 0 CHECK (subsidy >= 0),
  ADD COLUMN IF NOT EXISTS recovery_credit bigint NOT NULL DEFAULT 0 CHECK (recovery_credit >= 0),
  ADD COLUMN IF NOT EXISTS amount_due_now bigint NOT NULL DEFAULT 0 CHECK (amount_due_now >= 0),
  ADD COLUMN IF NOT EXISTS amount_due_at_service bigint NOT NULL DEFAULT 0 CHECK (amount_due_at_service >= 0),
  ADD COLUMN IF NOT EXISTS amount_paid bigint NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  ADD COLUMN IF NOT EXISTS amount_outstanding bigint NOT NULL DEFAULT 0 CHECK (amount_outstanding >= 0),
  ADD COLUMN IF NOT EXISTS customer_total bigint NOT NULL DEFAULT 0 CHECK (customer_total >= 0),
  ADD COLUMN IF NOT EXISTS provider_gross_entitlement bigint NOT NULL DEFAULT 0 CHECK (provider_gross_entitlement >= 0),
  ADD COLUMN IF NOT EXISTS provider_net_entitlement bigint NOT NULL DEFAULT 0 CHECK (provider_net_entitlement >= 0),
  ADD COLUMN IF NOT EXISTS kajola_gross_revenue bigint NOT NULL DEFAULT 0 CHECK (kajola_gross_revenue >= 0),
  ADD COLUMN IF NOT EXISTS kajola_net_revenue bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS settlement_amount bigint NOT NULL DEFAULT 0 CHECK (settlement_amount >= 0),
  ADD COLUMN IF NOT EXISTS policy_version text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS frozen_at timestamptz NOT NULL DEFAULT now();

UPDATE quote_snapshots SET
  service_base=subtotal, service_price=GREATEST(0,subtotal-discount), amount_due_now=total, amount_due_at_service=0,
  amount_paid=0, amount_outstanding=total, customer_total=total,
  provider_gross_entitlement=GREATEST(0,subtotal-discount),
  provider_net_entitlement=GREATEST(0,subtotal-discount),
  settlement_amount=GREATEST(0,subtotal-discount)
WHERE policy_version='legacy';

CREATE OR REPLACE FUNCTION reject_immutable_commerce_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_COMMERCE_SNAPSHOT'; END $$;
DROP TRIGGER IF EXISTS quote_snapshots_append_only ON quote_snapshots;
CREATE TRIGGER quote_snapshots_append_only BEFORE UPDATE OR DELETE ON quote_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_immutable_commerce_mutation();

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS refund_state text NOT NULL DEFAULT 'NONE'
    CHECK (refund_state IN ('NONE','REQUESTED','PROCESSING','PARTIALLY_REFUNDED','REFUNDED','FAILED')),
  ADD COLUMN IF NOT EXISTS reconciliation_state text NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (reconciliation_state IN ('NOT_REQUIRED','PENDING','MATCHED','EXCEPTION','RESOLVED')),
  ADD COLUMN IF NOT EXISTS risk_state text NOT NULL DEFAULT 'PASSED'
    CHECK (risk_state IN ('PENDING','PASSED','HELD','BLOCKED')),
  ADD COLUMN IF NOT EXISTS acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS service_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS service_completed_at timestamptz;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS payment_arrangement text NOT NULL DEFAULT 'FULL'
    CHECK (payment_arrangement IN ('FULL','DEPOSIT','PARTIAL','PAY_AT_SERVICE','CASH')),
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS expected_amount bigint CHECK (expected_amount IS NULL OR expected_amount >= 0),
  ADD COLUMN IF NOT EXISTS confirmed_amount bigint NOT NULL DEFAULT 0 CHECK (confirmed_amount >= 0),
  ADD COLUMN IF NOT EXISTS outstanding_amount bigint NOT NULL DEFAULT 0 CHECK (outstanding_amount >= 0),
  ADD COLUMN IF NOT EXISTS declared_collector uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS customer_confirmation_state text NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS provider_confirmation_state text NOT NULL DEFAULT 'NOT_REQUIRED',
  ADD COLUMN IF NOT EXISTS verification_state text NOT NULL DEFAULT 'PENDING'
    CHECK (verification_state IN ('PENDING','PROVIDER_VERIFIED','CUSTOMER_CONFIRMED','MATCHED','MISMATCH','FAILED')),
  ADD COLUMN IF NOT EXISTS quote_snapshot_id uuid REFERENCES quote_snapshots(id) ON DELETE RESTRICT;

ALTER TABLE gratuities
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'PENDING'
    CHECK (payment_status IN ('PENDING','CONFIRMED','FAILED','REFUNDED')),
  ADD COLUMN IF NOT EXISTS beneficiary_id uuid REFERENCES artisans(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS provider_entitlement bigint NOT NULL DEFAULT 0 CHECK (provider_entitlement >= 0),
  ADD COLUMN IF NOT EXISTS settlement_state text NOT NULL DEFAULT 'NOT_ELIGIBLE',
  ADD COLUMN IF NOT EXISTS refund_treatment text NOT NULL DEFAULT 'REFUND_WITH_PAYMENT',
  ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS gratuities_idempotency_unique ON gratuities(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'FULL' CHECK (purpose IN ('FULL','DEPOSIT','BALANCE','TIP','OFFLINE')),
  ADD COLUMN IF NOT EXISTS gratuity_id uuid REFERENCES gratuities(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION sync_payment_verification_state() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status::text='successful' AND OLD.status::text IS DISTINCT FROM 'successful' THEN
    NEW.confirmed_amount := NEW.amount_cents;
    NEW.outstanding_amount := GREATEST(0,COALESCE(NEW.expected_amount,NEW.amount_cents)-NEW.amount_cents);
    IF NEW.verification_state <> 'MATCHED' THEN
      NEW.verification_state := 'PROVIDER_VERIFIED';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS sync_payment_verification ON payments;
CREATE TRIGGER sync_payment_verification BEFORE UPDATE OF status ON payments
FOR EACH ROW EXECUTE FUNCTION sync_payment_verification_state();

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_status_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_status_check
  CHECK (status IN ('QUEUED','SENDING','DELIVERED','FAILED','RETRYING','DEAD_LETTER'));

CREATE TABLE IF NOT EXISTS offline_payment_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  expected_amount bigint NOT NULL CHECK (expected_amount >= 0), declared_paid_amount bigint NOT NULL CHECK (declared_paid_amount >= 0),
  provider_declared_amount bigint CHECK (provider_declared_amount IS NULL OR provider_declared_amount >= 0),
  customer_declared_amount bigint CHECK (customer_declared_amount IS NULL OR customer_declared_amount >= 0),
  declared_collector uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider_confirmation_state text NOT NULL DEFAULT 'PENDING', customer_confirmation_state text NOT NULL DEFAULT 'PENDING',
  verification_state text NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_state IN ('UNVERIFIED','MATCHED','MISMATCH','REJECTED')),
  evidence jsonb NOT NULL DEFAULT '{}', idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz
);

-- R4: fulfillment and cancellation use explicit authorized transitions.
CREATE TABLE IF NOT EXISTS fulfillment_transition_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, actor_role text NOT NULL,
  state_from text NOT NULL, state_to text NOT NULL, reason_code text,
  correlation_id uuid NOT NULL, causation_id uuid, idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cancellation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  cancelled_by text NOT NULL CHECK (cancelled_by IN ('CUSTOMER','PROVIDER','OPERATOR')),
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, policy_version text NOT NULL,
  cancellation_fee bigint NOT NULL DEFAULT 0 CHECK (cancellation_fee >= 0),
  refund_amount bigint NOT NULL DEFAULT 0 CHECK (refund_amount >= 0), recovery_required boolean NOT NULL DEFAULT false,
  reason_code text NOT NULL, idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);

-- R5: entitlement is immutable; transfer attempts and reconciliation are separate truth.
CREATE TABLE IF NOT EXISTS provider_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE RESTRICT,
  provider_id uuid NOT NULL REFERENCES artisans(id) ON DELETE RESTRICT, quote_snapshot_id uuid NOT NULL REFERENCES quote_snapshots(id) ON DELETE RESTRICT,
  gross_service_value bigint NOT NULL CHECK (gross_service_value >= 0), provider_fee bigint NOT NULL CHECK (provider_fee >= 0),
  kajola_fee bigint NOT NULL CHECK (kajola_fee >= 0), processing_allocation bigint NOT NULL CHECK (processing_allocation >= 0),
  customer_fee bigint NOT NULL CHECK (customer_fee >= 0), tip bigint NOT NULL CHECK (tip >= 0),
  subsidy bigint NOT NULL CHECK (subsidy >= 0), refund_adjustment bigint NOT NULL DEFAULT 0 CHECK (refund_adjustment >= 0),
  provider_entitlement bigint NOT NULL CHECK (provider_entitlement >= 0), settlement_amount bigint NOT NULL CHECK (settlement_amount >= 0),
  policy_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE settlements DROP CONSTRAINT IF EXISTS settlements_status_check;
ALTER TABLE settlements ADD CONSTRAINT settlements_status_check CHECK
  (status IN ('NOT_ELIGIBLE','PENDING_ELIGIBILITY','ELIGIBLE','QUEUED','PROCESSING','SETTLED','FAILED','RETRY_REQUIRED','HELD','REVERSED','PENDING','ALLOCATED'));
ALTER TABLE settlements
  ADD COLUMN IF NOT EXISTS entitlement_id uuid REFERENCES provider_entitlements(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS eligibility_blockers jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS correlation_id uuid,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE TABLE IF NOT EXISTS settlement_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), settlement_id uuid NOT NULL REFERENCES settlements(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0), provider_reference text,
  state text NOT NULL CHECK (state IN ('PROCESSING','SUCCEEDED','FAILED','UNKNOWN')),
  failure_category text, correlation_id uuid NOT NULL, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  UNIQUE (settlement_id, attempt_number), UNIQUE (provider_reference)
);

CREATE TABLE IF NOT EXISTS reconciliation_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT, payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
  settlement_id uuid REFERENCES settlements(id) ON DELETE RESTRICT,
  exception_type text NOT NULL CHECK (exception_type IN ('EXTERNAL_PAYMENT_MISSING_INTERNAL','INTERNAL_CONFIRMATION_MISSING_PROOF','DUPLICATE_CALLBACK','ORPHAN_PAYMENT','AMOUNT_MISMATCH','CURRENCY_MISMATCH','SETTLEMENT_MISMATCH','FAILED_TRANSFER','REFUND_AFTER_SETTLEMENT','DUPLICATED_SETTLEMENT','UNRESOLVED_OFFLINE_PAYMENT')),
  state text NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','INVESTIGATING','RESOLVED','IGNORED')),
  internal_evidence jsonb NOT NULL DEFAULT '{}', external_evidence jsonb NOT NULL DEFAULT '{}',
  correlation_id uuid NOT NULL, resolution_reason text, resolved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS operator_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, actor_role text NOT NULL,
  command_type text NOT NULL CHECK (command_type IN ('SETTLEMENT_HOLD','SAFE_RETRY','APPROVED_REFUND','RECONCILIATION_RESOLVE','WORKFLOW_RECOVER')),
  resource_type text NOT NULL, resource_id uuid NOT NULL, reason_code text NOT NULL,
  correlation_id uuid NOT NULL, before_state jsonb NOT NULL, after_state jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('ACCEPTED','EXECUTED','REJECTED','FAILED')),
  idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);

-- R7/R8: incident evidence and agent recommendations never become financial truth.
CREATE TABLE IF NOT EXISTS incident_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), incident_type text NOT NULL, severity text NOT NULL,
  correlation_id uuid NOT NULL, booking_id uuid REFERENCES bookings(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'OPEN', evidence jsonb NOT NULL DEFAULT '{}', runbook_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS agent_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT,
  recommendation_type text NOT NULL, resource_type text NOT NULL, resource_id uuid,
  summary text NOT NULL, evidence_refs jsonb NOT NULL DEFAULT '[]', model_provider text,
  runtime_state text NOT NULL CHECK (runtime_state IN ('AVAILABLE','BLOCKED_EXTERNAL','FAILED','DISABLED')),
  correlation_id uuid NOT NULL, created_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recommendation_id uuid REFERENCES agent_recommendations(id) ON DELETE RESTRICT,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT, action_type text NOT NULL,
  risk_class text NOT NULL CHECK (risk_class IN ('AUTO_EXECUTE','POLICY_GATED','HUMAN_APPROVAL_REQUIRED','FORBIDDEN')),
  policy_decision text NOT NULL CHECK (policy_decision IN ('ALLOW','DENY','REVIEW')),
  approval_state text NOT NULL CHECK (approval_state IN ('NOT_REQUIRED','PENDING','APPROVED','REJECTED')),
  requested_by uuid REFERENCES users(id) ON DELETE RESTRICT, approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL, status text NOT NULL CHECK (status IN ('REQUESTED','EXECUTED','REJECTED','FAILED')),
  idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), executed_at timestamptz,
  CHECK (risk_class <> 'FORBIDDEN' OR status = 'REJECTED'),
  CHECK (risk_class <> 'HUMAN_APPROVAL_REQUIRED' OR status <> 'EXECUTED' OR approval_state = 'APPROVED')
);

CREATE OR REPLACE FUNCTION reject_append_only_evidence_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$ BEGIN RAISE EXCEPTION 'APPEND_ONLY_EVIDENCE'; END $$;
DO $$ DECLARE table_name text; BEGIN
  FOREACH table_name IN ARRAY ARRAY['fulfillment_transition_audit','cancellation_decisions','provider_entitlements','operator_commands','agent_recommendations'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_append_only ON %I', table_name, table_name);
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_append_only_evidence_mutation()', table_name, table_name);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION transition_booking_fulfillment(
  target_booking_id uuid, target_state text, target_actor_id uuid, target_actor_role text,
  target_reason_code text, target_correlation_id uuid, request_key text
) RETURNS bookings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE book bookings; result bookings; authorized boolean := false; allowed boolean := false; next_status booking_status;
BEGIN
  SELECT b.* INTO result FROM bookings b JOIN fulfillment_transition_audit a ON a.booking_id=b.id
    WHERE a.idempotency_key=request_key LIMIT 1;
  IF FOUND THEN RETURN result; END IF;
  SELECT * INTO book FROM bookings WHERE id=target_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  authorized := (target_actor_role='CUSTOMER' AND (book.client_id=target_actor_id OR book.user_id=target_actor_id))
    OR (target_actor_role='PROVIDER' AND EXISTS(SELECT 1 FROM artisans a WHERE a.id=book.artisan_id AND a.user_id=target_actor_id))
    OR (target_actor_role='STAFF' AND EXISTS(SELECT 1 FROM staff_members s WHERE s.id=book.staff_id AND s.user_id=target_actor_id))
    OR (target_actor_role IN ('TENANT_ADMIN','OPERATOR') AND EXISTS(SELECT 1 FROM users u WHERE u.id=target_actor_id AND u.role::text IN ('tenant_admin','super_admin')));
  IF NOT authorized THEN RAISE EXCEPTION 'FULFILLMENT_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF book.fulfillment_state=target_state THEN RETURN book; END IF;
  allowed :=
    (book.fulfillment_state='SCHEDULED' AND target_state='PROVIDER_ACKNOWLEDGED' AND target_actor_role IN ('PROVIDER','STAFF','TENANT_ADMIN')) OR
    (book.fulfillment_state IN ('SCHEDULED','PROVIDER_ACKNOWLEDGED') AND target_state='CUSTOMER_CHECKED_IN' AND target_actor_role IN ('CUSTOMER','PROVIDER','STAFF')) OR
    (book.fulfillment_state='CUSTOMER_CHECKED_IN' AND target_state='IN_PROGRESS' AND target_actor_role IN ('PROVIDER','STAFF')) OR
    (book.fulfillment_state='IN_PROGRESS' AND target_state='COMPLETED' AND target_actor_role IN ('PROVIDER','STAFF')) OR
    (book.fulfillment_state IN ('SCHEDULED','PROVIDER_ACKNOWLEDGED') AND target_state='NO_SHOW' AND target_actor_role IN ('PROVIDER','STAFF')) OR
    (book.fulfillment_state IN ('NOT_SCHEDULED','SCHEDULED','PROVIDER_ACKNOWLEDGED','CUSTOMER_CHECKED_IN') AND target_state='CANCELLED' AND target_actor_role IN ('CUSTOMER','PROVIDER','TENANT_ADMIN')) OR
    (book.fulfillment_state IN ('IN_PROGRESS','COMPLETED','NO_SHOW') AND target_state='DISPUTED' AND target_actor_role IN ('CUSTOMER','PROVIDER','TENANT_ADMIN'));
  IF NOT allowed THEN RAISE EXCEPTION 'INVALID_FULFILLMENT_TRANSITION:%->%',book.fulfillment_state,target_state; END IF;
  next_status := CASE target_state WHEN 'CUSTOMER_CHECKED_IN' THEN 'checked_in'::booking_status WHEN 'IN_PROGRESS' THEN 'in_progress'::booking_status
    WHEN 'COMPLETED' THEN 'completed'::booking_status WHEN 'NO_SHOW' THEN 'no_show'::booking_status
    WHEN 'CANCELLED' THEN 'cancelled'::booking_status WHEN 'DISPUTED' THEN 'disputed'::booking_status ELSE book.status END;
  UPDATE bookings SET fulfillment_state=target_state,status=next_status,
    booking_state=CASE WHEN target_state='COMPLETED' THEN 'COMPLETED' WHEN target_state='CANCELLED' THEN 'CANCELLED' ELSE booking_state END,
    acknowledged_at=CASE WHEN target_state='PROVIDER_ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,
    checked_in_at=CASE WHEN target_state='CUSTOMER_CHECKED_IN' THEN now() ELSE checked_in_at END,
    service_started_at=CASE WHEN target_state='IN_PROGRESS' THEN now() ELSE service_started_at END,
    service_completed_at=CASE WHEN target_state='COMPLETED' THEN now() ELSE service_completed_at END,
    settlement_state=CASE WHEN target_state IN ('DISPUTED','CANCELLED','NO_SHOW') THEN 'HELD' ELSE settlement_state END,
    updated_at=now() WHERE id=book.id RETURNING * INTO result;
  INSERT INTO fulfillment_transition_audit(tenant_id,booking_id,actor_id,actor_role,state_from,state_to,reason_code,correlation_id,idempotency_key)
  VALUES(book.tenant_id,book.id,target_actor_id,target_actor_role,book.fulfillment_state,target_state,target_reason_code,target_correlation_id,request_key);
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION freeze_provider_entitlement(target_booking_id uuid)
RETURNS provider_entitlements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE book bookings; quote quote_snapshots; result provider_entitlements;
BEGIN
  SELECT * INTO result FROM provider_entitlements WHERE booking_id=target_booking_id; IF FOUND THEN RETURN result; END IF;
  SELECT * INTO book FROM bookings WHERE id=target_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF book.fulfillment_state <> 'COMPLETED' THEN RAISE EXCEPTION 'SERVICE_NOT_COMPLETED'; END IF;
  SELECT * INTO quote FROM quote_snapshots WHERE id=book.quote_snapshot_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'QUOTE_SNAPSHOT_NOT_FOUND'; END IF;
  INSERT INTO provider_entitlements(tenant_id,booking_id,provider_id,quote_snapshot_id,gross_service_value,provider_fee,kajola_fee,
    processing_allocation,customer_fee,tip,subsidy,provider_entitlement,settlement_amount,policy_version)
  VALUES(book.tenant_id,book.id,book.artisan_id,quote.id,quote.service_base+quote.add_ons-quote.discount,quote.provider_fee,
    quote.kajola_gross_revenue,quote.payment_processing_cost+quote.transfer_cost+quote.settlement_cost,quote.customer_fee,quote.tip,
    quote.subsidy,quote.provider_net_entitlement,quote.settlement_amount,quote.policy_version)
  ON CONFLICT(booking_id) DO NOTHING RETURNING * INTO result;
  IF result.id IS NULL THEN SELECT * INTO result FROM provider_entitlements WHERE booking_id=book.id; END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION evaluate_booking_settlement(target_booking_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE book bookings; blockers text[] := ARRAY[]::text[]; result_state text;
BEGIN
  SELECT * INTO book FROM bookings WHERE id=target_booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF book.payment_state <> 'CONFIRMED' THEN blockers := array_append(blockers,'PAYMENT_NOT_CONFIRMED'); END IF;
  IF NOT EXISTS(
    SELECT 1 FROM quote_snapshots q WHERE q.id=book.quote_snapshot_id AND
      COALESCE((SELECT sum(p.amount_cents) FROM payments p WHERE p.booking_id=book.id AND p.status::text='successful' AND p.purpose<>'TIP'),0) >= q.customer_total
  ) THEN blockers := array_append(blockers,'PAYMENT_NOT_FULLY_COLLECTED'); END IF;
  IF book.fulfillment_state <> 'COMPLETED' THEN blockers := array_append(blockers,'SERVICE_NOT_COMPLETED'); END IF;
  IF book.refund_state NOT IN ('NONE','FAILED') THEN blockers := array_append(blockers,'ACTIVE_REFUND'); END IF;
  IF book.fulfillment_state='DISPUTED' OR book.payment_state='DISPUTED' THEN blockers := array_append(blockers,'ACTIVE_DISPUTE'); END IF;
  IF book.recovery_state NOT IN ('NONE','RESOLVED','ACCEPTED') THEN blockers := array_append(blockers,'ACTIVE_RECOVERY'); END IF;
  IF NOT EXISTS(SELECT 1 FROM artisans a JOIN businesses bu ON bu.id=a.business_id WHERE a.id=book.artisan_id AND bu.payout_state='READY' AND bu.lifecycle_status='ACTIVE')
    THEN blockers := array_append(blockers,'PROVIDER_NOT_ELIGIBLE'); END IF;
  IF book.risk_state <> 'PASSED' THEN blockers := array_append(blockers,'RISK_NOT_PASSED'); END IF;
  result_state := CASE WHEN cardinality(blockers)=0 THEN 'ELIGIBLE' ELSE 'NOT_ELIGIBLE' END;
  UPDATE bookings SET settlement_state=result_state, updated_at=now() WHERE id=book.id;
  RETURN jsonb_build_object('booking_id',book.id,'eligible',cardinality(blockers)=0,'state',result_state,'blockers',to_jsonb(blockers));
END $$;

CREATE OR REPLACE FUNCTION queue_booking_settlement(target_booking_id uuid, request_key text, target_correlation_id uuid)
RETURNS settlements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE book bookings; entitlement provider_entitlements; result settlements; eligibility jsonb;
BEGIN
  SELECT * INTO result FROM settlements WHERE idempotency_key=request_key; IF FOUND THEN RETURN result; END IF;
  eligibility := evaluate_booking_settlement(target_booking_id);
  IF NOT (eligibility->>'eligible')::boolean THEN RAISE EXCEPTION 'SETTLEMENT_NOT_ELIGIBLE:%', eligibility->'blockers'; END IF;
  SELECT * INTO book FROM bookings WHERE id=target_booking_id FOR UPDATE;
  SELECT * INTO entitlement FROM provider_entitlements WHERE booking_id=target_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'ENTITLEMENT_NOT_FOUND'; END IF;
  INSERT INTO settlements(tenant_id,booking_id,provider_id,amount,status,idempotency_key,entitlement_id,correlation_id,metadata)
  VALUES(book.tenant_id,book.id,book.artisan_id,entitlement.settlement_amount,'QUEUED',request_key,entitlement.id,target_correlation_id,jsonb_build_object('policy_version',entitlement.policy_version))
  RETURNING * INTO result;
  UPDATE bookings SET settlement_state='QUEUED',updated_at=now() WHERE id=book.id;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION request_agent_action(
  target_recommendation_id uuid, target_tenant_id uuid, target_action text, target_actor_id uuid,
  target_correlation_id uuid, request_key text
) RETURNS agent_action_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE risk text; decision text; approval text; result agent_action_requests;
BEGIN
  SELECT * INTO result FROM agent_action_requests WHERE idempotency_key=request_key; IF FOUND THEN RETURN result; END IF;
  risk := CASE
    WHEN target_action IN ('settlement.execute','ledger.mutate','slot.override','permission.grant','tenant.transfer','audit.delete') THEN 'FORBIDDEN'
    WHEN target_action IN ('refund.issue','settlement.override','subsidy.major','dispute.resolve','provider.suspend','financial.adjust') THEN 'HUMAN_APPROVAL_REQUIRED'
    WHEN target_action IN ('recovery.offer','fee_policy.recommend','settlement.retry','customer.credit') THEN 'POLICY_GATED'
    ELSE 'AUTO_EXECUTE' END;
  decision := CASE WHEN risk='FORBIDDEN' THEN 'DENY' WHEN risk='AUTO_EXECUTE' THEN 'ALLOW' ELSE 'REVIEW' END;
  approval := CASE WHEN risk='AUTO_EXECUTE' THEN 'NOT_REQUIRED' ELSE 'PENDING' END;
  INSERT INTO agent_action_requests(recommendation_id,tenant_id,action_type,risk_class,policy_decision,approval_state,requested_by,correlation_id,status,idempotency_key)
  VALUES(target_recommendation_id,target_tenant_id,target_action,risk,decision,approval,target_actor_id,target_correlation_id,CASE WHEN risk='FORBIDDEN' THEN 'REJECTED' ELSE 'REQUESTED' END,request_key)
  RETURNING * INTO result;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION claim_settlement_attempt(target_settlement_id uuid, target_correlation_id uuid)
RETURNS settlement_attempts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item settlements; result settlement_attempts; attempt_no integer;
BEGIN
  SELECT * INTO item FROM settlements WHERE id=target_settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_NOT_FOUND'; END IF;
  IF item.status='SETTLED' THEN RAISE EXCEPTION 'SETTLEMENT_ALREADY_SETTLED'; END IF;
  IF item.status='PROCESSING' THEN
    SELECT * INTO result FROM settlement_attempts WHERE settlement_id=item.id AND state='PROCESSING' ORDER BY attempt_number DESC LIMIT 1;
    IF FOUND THEN RETURN result; END IF;
  END IF;
  IF item.status NOT IN ('QUEUED','ELIGIBLE','FAILED','RETRY_REQUIRED') THEN RAISE EXCEPTION 'SETTLEMENT_NOT_CLAIMABLE:%',item.status; END IF;
  SELECT COALESCE(max(attempt_number),0)+1 INTO attempt_no FROM settlement_attempts WHERE settlement_id=item.id;
  INSERT INTO settlement_attempts(settlement_id,attempt_number,state,correlation_id)
    VALUES(item.id,attempt_no,'PROCESSING',target_correlation_id) RETURNING * INTO result;
  UPDATE settlements SET status='PROCESSING',attempts=attempt_no,updated_at=now() WHERE id=item.id;
  UPDATE bookings SET settlement_state='PROCESSING',updated_at=now() WHERE id=item.booking_id;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION record_offline_payment_attestation(
  target_payment_id uuid, target_actor_id uuid, target_actor_role text,
  target_declared_amount bigint, target_evidence jsonb
) RETURNS offline_payment_evidence LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pay payments; book bookings; result offline_payment_evidence; authorized boolean; matched boolean;
BEGIN
  SELECT * INTO pay FROM payments WHERE id=target_payment_id AND purpose='OFFLINE' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'OFFLINE_PAYMENT_NOT_FOUND'; END IF;
  SELECT * INTO book FROM bookings WHERE id=pay.booking_id FOR UPDATE;
  authorized := (target_actor_role='CUSTOMER' AND (book.client_id=target_actor_id OR book.user_id=target_actor_id))
    OR (target_actor_role='PROVIDER' AND EXISTS(SELECT 1 FROM artisans a WHERE a.id=book.artisan_id AND a.user_id=target_actor_id));
  IF NOT authorized THEN RAISE EXCEPTION 'OFFLINE_ATTESTATION_FORBIDDEN' USING ERRCODE='42501'; END IF;
  INSERT INTO offline_payment_evidence(tenant_id,booking_id,payment_id,expected_amount,declared_paid_amount,
    provider_declared_amount,customer_declared_amount,declared_collector,
    provider_confirmation_state,customer_confirmation_state,verification_state,evidence,idempotency_key)
  VALUES(book.tenant_id,book.id,pay.id,COALESCE(pay.expected_amount,pay.amount_cents),target_declared_amount,
    CASE WHEN target_actor_role='PROVIDER' THEN target_declared_amount ELSE NULL END,
    CASE WHEN target_actor_role='CUSTOMER' THEN target_declared_amount ELSE NULL END,target_actor_id,
    CASE WHEN target_actor_role='PROVIDER' THEN 'CONFIRMED' ELSE 'PENDING' END,
    CASE WHEN target_actor_role='CUSTOMER' THEN 'CONFIRMED' ELSE 'PENDING' END,'UNVERIFIED',target_evidence,'offline:'||pay.id)
  ON CONFLICT(idempotency_key) DO UPDATE SET
    declared_paid_amount=EXCLUDED.declared_paid_amount,
    provider_declared_amount=CASE WHEN target_actor_role='PROVIDER' THEN EXCLUDED.declared_paid_amount ELSE offline_payment_evidence.provider_declared_amount END,
    customer_declared_amount=CASE WHEN target_actor_role='CUSTOMER' THEN EXCLUDED.declared_paid_amount ELSE offline_payment_evidence.customer_declared_amount END,
    provider_confirmation_state=CASE WHEN target_actor_role='PROVIDER' THEN 'CONFIRMED' ELSE offline_payment_evidence.provider_confirmation_state END,
    customer_confirmation_state=CASE WHEN target_actor_role='CUSTOMER' THEN 'CONFIRMED' ELSE offline_payment_evidence.customer_confirmation_state END,
    evidence=offline_payment_evidence.evidence||EXCLUDED.evidence
  RETURNING * INTO result;
  matched := result.provider_confirmation_state='CONFIRMED' AND result.customer_confirmation_state='CONFIRMED'
    AND result.provider_declared_amount=result.customer_declared_amount
    AND result.provider_declared_amount=result.expected_amount;
  UPDATE offline_payment_evidence SET verification_state=CASE WHEN matched THEN 'MATCHED' WHEN provider_confirmation_state='CONFIRMED' AND customer_confirmation_state='CONFIRMED' THEN 'MISMATCH' ELSE 'UNVERIFIED' END,
    verified_at=CASE WHEN matched THEN now() ELSE NULL END WHERE id=result.id RETURNING * INTO result;
  IF matched THEN
    UPDATE payments SET status='successful',provider_confirmation_state='CONFIRMED',customer_confirmation_state='CONFIRMED',verification_state='MATCHED' WHERE id=pay.id;
    UPDATE bookings SET payment_state='CONFIRMED',reconciliation_state='MATCHED',settlement_state='PENDING_ELIGIBILITY',updated_at=now() WHERE id=book.id;
  ELSIF result.verification_state='MISMATCH' THEN
    UPDATE payments SET verification_state='MISMATCH' WHERE id=pay.id;
    UPDATE bookings SET reconciliation_state='EXCEPTION',settlement_state='HELD',updated_at=now() WHERE id=book.id;
    INSERT INTO reconciliation_exceptions(tenant_id,booking_id,payment_id,exception_type,internal_evidence,correlation_id,idempotency_key)
      VALUES(book.tenant_id,book.id,pay.id,'UNRESOLVED_OFFLINE_PAYMENT',to_jsonb(result),gen_random_uuid(),'offline-mismatch:'||pay.id)
      ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN result;
END $$;

CREATE OR REPLACE FUNCTION finish_settlement_attempt(
  target_settlement_id uuid, target_attempt_number integer, target_succeeded boolean,
  target_provider_reference text, target_failure_category text
) RETURNS settlements LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item settlements; attempt settlement_attempts;
BEGIN
  SELECT * INTO item FROM settlements WHERE id=target_settlement_id FOR UPDATE;
  SELECT * INTO attempt FROM settlement_attempts WHERE settlement_id=target_settlement_id AND attempt_number=target_attempt_number FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SETTLEMENT_ATTEMPT_NOT_FOUND'; END IF;
  IF attempt.state IN ('SUCCEEDED','FAILED') THEN RETURN item; END IF;
  UPDATE settlement_attempts SET state=CASE WHEN target_succeeded THEN 'SUCCEEDED' ELSE 'FAILED' END,
    provider_reference=target_provider_reference,failure_category=target_failure_category,completed_at=now()
    WHERE id=attempt.id;
  UPDATE settlements SET status=CASE WHEN target_succeeded THEN 'SETTLED' ELSE 'FAILED' END,
    provider_reference=COALESCE(target_provider_reference,provider_reference),last_error=target_failure_category,updated_at=now()
    WHERE id=item.id RETURNING * INTO item;
  UPDATE bookings SET settlement_state=CASE WHEN target_succeeded THEN 'SETTLED' ELSE 'FAILED' END,updated_at=now() WHERE id=item.booking_id;
  INSERT INTO financial_ledger_entries(tenant_id,booking_id,payment_id,entry_type,direction,amount,idempotency_key,metadata)
    SELECT item.tenant_id,item.booking_id,item.payment_id,'SETTLEMENT','DEBIT',item.amount,'settlement:'||item.id,
      jsonb_build_object('provider_reference',target_provider_reference)
    WHERE target_succeeded AND item.amount>0 ON CONFLICT(idempotency_key) DO NOTHING;
  RETURN item;
END $$;

CREATE OR REPLACE FUNCTION process_verified_tip(
  target_payment_id uuid, target_provider_event_id text, target_correlation_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pay payments; gratuity gratuities; receipt provider_events;
BEGIN
  SELECT * INTO pay FROM payments WHERE id=target_payment_id FOR UPDATE;
  IF NOT FOUND OR pay.purpose <> 'TIP' OR pay.gratuity_id IS NULL THEN RAISE EXCEPTION 'TIP_PAYMENT_NOT_FOUND'; END IF;
  SELECT * INTO receipt FROM provider_events WHERE provider=pay.provider AND provider_event_id=target_provider_event_id FOR UPDATE;
  IF NOT FOUND OR NOT receipt.signature_valid OR receipt.status NOT IN ('VERIFIED','PROCESSED') THEN RAISE EXCEPTION 'UNVERIFIED_PROVIDER_EVENT'; END IF;
  SELECT * INTO gratuity FROM gratuities WHERE id=pay.gratuity_id FOR UPDATE;
  IF pay.status::text='successful' THEN RETURN jsonb_build_object('cached',true,'gratuity_id',gratuity.id); END IF;
  IF pay.amount_cents <> gratuity.amount_kobo OR upper(pay.currency) <> 'NGN' THEN RAISE EXCEPTION 'TIP_PAYMENT_BINDING_MISMATCH'; END IF;
  UPDATE payments SET status='successful',paid_at=COALESCE(paid_at,now()),verification_state='PROVIDER_VERIFIED' WHERE id=pay.id;
  UPDATE gratuities SET payment_status='CONFIRMED',provider_entitlement=amount_kobo,settlement_state='ELIGIBLE',beneficiary_id=COALESCE(beneficiary_id,artisan_id) WHERE id=gratuity.id;
  INSERT INTO financial_ledger_entries(tenant_id,booking_id,payment_id,entry_type,direction,amount,idempotency_key,metadata)
  VALUES(pay.tenant_id,pay.booking_id,pay.id,'TIP','CREDIT',pay.amount_cents,'tip:'||gratuity.id||':provider',jsonb_build_object('beneficiary_id',gratuity.artisan_id))
  ON CONFLICT(idempotency_key) DO NOTHING;
  UPDATE provider_events SET status='PROCESSED',processed_at=COALESCE(processed_at,now()) WHERE id=receipt.id;
  RETURN jsonb_build_object('cached',false,'gratuity_id',gratuity.id,'provider_entitlement',pay.amount_cents,'correlation_id',target_correlation_id);
END $$;

REVOKE ALL ON FUNCTION evaluate_booking_settlement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION transition_booking_fulfillment(uuid,text,uuid,text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION freeze_provider_entitlement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION queue_booking_settlement(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_agent_action(uuid,uuid,text,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION process_verified_tip(uuid,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION claim_settlement_attempt(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION finish_settlement_attempt(uuid,integer,boolean,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION record_offline_payment_attestation(uuid,uuid,text,bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION transition_booking_fulfillment(uuid,text,uuid,text,text,uuid,text), freeze_provider_entitlement(uuid), evaluate_booking_settlement(uuid), queue_booking_settlement(uuid,text,uuid), request_agent_action(uuid,uuid,text,uuid,uuid,text), process_verified_tip(uuid,text,uuid), claim_settlement_attempt(uuid,uuid), finish_settlement_attempt(uuid,integer,boolean,text,text), record_offline_payment_attestation(uuid,uuid,text,bigint,jsonb) TO service_role;

CREATE INDEX IF NOT EXISTS idx_offline_payment_verification ON offline_payment_evidence(tenant_id,verification_state,created_at);
CREATE INDEX IF NOT EXISTS idx_fulfillment_audit_booking ON fulfillment_transition_audit(booking_id,created_at);
CREATE INDEX IF NOT EXISTS idx_settlement_state ON settlements(tenant_id,status,created_at);
CREATE INDEX IF NOT EXISTS idx_reconciliation_open ON reconciliation_exceptions(tenant_id,state,created_at) WHERE state IN ('OPEN','INVESTIGATING');
CREATE INDEX IF NOT EXISTS idx_agent_actions_pending ON agent_action_requests(tenant_id,approval_state,created_at) WHERE approval_state='PENDING';

ALTER TABLE offline_payment_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_transition_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlement_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE reconciliation_exceptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE operator_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE incident_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_action_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authorized booking parties read offline evidence" ON offline_payment_evidence FOR SELECT TO authenticated USING
  (has_role('super_admin') OR EXISTS (SELECT 1 FROM bookings b LEFT JOIN artisans a ON a.id=b.artisan_id WHERE b.id=booking_id AND (b.client_id=auth.uid() OR b.user_id=auth.uid() OR a.user_id=auth.uid())));
CREATE POLICY "authorized booking parties read fulfillment audit" ON fulfillment_transition_audit FOR SELECT TO authenticated USING
  (has_role('super_admin') OR EXISTS (SELECT 1 FROM bookings b LEFT JOIN artisans a ON a.id=b.artisan_id WHERE b.id=booking_id AND (b.client_id=auth.uid() OR b.user_id=auth.uid() OR a.user_id=auth.uid())));
CREATE POLICY "authorized booking parties read cancellations" ON cancellation_decisions FOR SELECT TO authenticated USING
  (has_role('super_admin') OR EXISTS (SELECT 1 FROM bookings b LEFT JOIN artisans a ON a.id=b.artisan_id WHERE b.id=booking_id AND (b.client_id=auth.uid() OR b.user_id=auth.uid() OR a.user_id=auth.uid())));
CREATE POLICY "providers read own entitlements" ON provider_entitlements FOR SELECT TO authenticated USING
  (has_role('super_admin') OR EXISTS (SELECT 1 FROM artisans a WHERE a.id=provider_id AND a.user_id=auth.uid()));
CREATE POLICY "providers read own settlement attempts" ON settlement_attempts FOR SELECT TO authenticated USING
  (has_role('super_admin') OR EXISTS (SELECT 1 FROM settlements s JOIN artisans a ON a.id=s.provider_id WHERE s.id=settlement_id AND a.user_id=auth.uid()));
CREATE POLICY "operators read reconciliation exceptions" ON reconciliation_exceptions FOR SELECT TO authenticated USING (has_role('super_admin'));
CREATE POLICY "operators read commands" ON operator_commands FOR SELECT TO authenticated USING (has_role('super_admin'));
CREATE POLICY "operators read incidents" ON incident_evidence FOR SELECT TO authenticated USING (has_role('super_admin'));
CREATE POLICY "operators read agent recommendations" ON agent_recommendations FOR SELECT TO authenticated USING (has_role('super_admin'));
CREATE POLICY "operators read agent action requests" ON agent_action_requests FOR SELECT TO authenticated USING (has_role('super_admin'));

GRANT SELECT ON offline_payment_evidence,fulfillment_transition_audit,cancellation_decisions,provider_entitlements,settlement_attempts,reconciliation_exceptions,operator_commands,incident_evidence,agent_recommendations,agent_action_requests TO authenticated;
GRANT ALL ON offline_payment_evidence,fulfillment_transition_audit,cancellation_decisions,provider_entitlements,settlement_attempts,reconciliation_exceptions,operator_commands,incident_evidence,agent_recommendations,agent_action_requests TO service_role;

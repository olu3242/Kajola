-- Kajola R2 transaction-safe booking, late-payment recovery and exactly-once effects.

INSERT INTO runtime_schema_versions(version) VALUES ('20260904020000_r2_transaction_safe_booking') ON CONFLICT DO NOTHING;

ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'requires_recovery' BEFORE 'cancelled';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'expired' BEFORE 'cancelled';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS held_at timestamptz,
  ADD COLUMN IF NOT EXISTS booking_state text NOT NULL DEFAULT 'DRAFT'
    CHECK (booking_state IN ('DRAFT','HELD','PENDING_PAYMENT','CONFIRMED','REQUIRES_RECOVERY','CANCELLED','EXPIRED','COMPLETED','CLOSED')),
  ADD COLUMN IF NOT EXISTS payment_state text NOT NULL DEFAULT 'NOT_REQUIRED'
    CHECK (payment_state IN ('NOT_REQUIRED','INTENT_REQUIRED','INTENT_CREATED','PENDING','PARTIALLY_PAID','CONFIRMED','FAILED','EXPIRED','REFUND_PENDING','PARTIALLY_REFUNDED','REFUNDED','DISPUTED')),
  ADD COLUMN IF NOT EXISTS fulfillment_state text NOT NULL DEFAULT 'NOT_SCHEDULED'
    CHECK (fulfillment_state IN ('NOT_SCHEDULED','SCHEDULED','PROVIDER_ACKNOWLEDGED','CUSTOMER_CHECKED_IN','IN_PROGRESS','COMPLETED','NO_SHOW','CANCELLED','DISPUTED')),
  ADD COLUMN IF NOT EXISTS settlement_state text NOT NULL DEFAULT 'NOT_ELIGIBLE'
    CHECK (settlement_state IN ('NOT_ELIGIBLE','PENDING_ELIGIBILITY','ELIGIBLE','QUEUED','PROCESSING','SETTLED','FAILED','RETRY_REQUIRED','HELD','REVERSED')),
  ADD COLUMN IF NOT EXISTS hold_state text NOT NULL DEFAULT 'RELEASED'
    CHECK (hold_state IN ('ACTIVE','CONVERTED','EXPIRED','RELEASED')),
  ADD COLUMN IF NOT EXISTS recovery_state text NOT NULL DEFAULT 'NONE'
    CHECK (recovery_state IN ('NONE','REQUIRED','ALTERNATIVES_AVAILABLE','AWAITING_CUSTOMER','ACCEPTED','REFUND_REQUIRED','RESOLVED'));

UPDATE bookings SET
  held_at = COALESCE(held_at, requested_at, created_at),
  booking_state = CASE status::text
    WHEN 'held' THEN 'HELD' WHEN 'awaiting_payment' THEN 'PENDING_PAYMENT'
    WHEN 'confirmed' THEN 'CONFIRMED' WHEN 'in_progress' THEN 'CONFIRMED'
    WHEN 'completed' THEN 'COMPLETED' WHEN 'cancelled' THEN 'CANCELLED'
    ELSE 'DRAFT' END,
  hold_state = CASE WHEN status::text IN ('held','awaiting_payment') AND held_until > now() THEN 'ACTIVE'
    WHEN status::text IN ('confirmed','in_progress','checked_in','completed') THEN 'CONVERTED'
    WHEN held_until IS NOT NULL AND held_until <= now() THEN 'EXPIRED' ELSE 'RELEASED' END,
  fulfillment_state = CASE status::text WHEN 'confirmed' THEN 'SCHEDULED' WHEN 'checked_in' THEN 'CUSTOMER_CHECKED_IN'
    WHEN 'in_progress' THEN 'IN_PROGRESS' WHEN 'completed' THEN 'COMPLETED' WHEN 'no_show' THEN 'NO_SHOW'
    WHEN 'cancelled' THEN 'CANCELLED' ELSE 'NOT_SCHEDULED' END;

ALTER TABLE bookings ADD CONSTRAINT bookings_unresolved_recovery_blocks_settlement CHECK (
  recovery_state NOT IN ('REQUIRED','ALTERNATIVES_AVAILABLE','AWAITING_CUSTOMER','REFUND_REQUIRED')
  OR settlement_state IN ('NOT_ELIGIBLE','HELD')
);

CREATE OR REPLACE FUNCTION validate_booking_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF NOT (
    (OLD.status::text = 'held' AND NEW.status::text IN ('awaiting_payment','confirmed','expired','cancelled')) OR
    (OLD.status::text = 'pending' AND NEW.status::text IN ('held','awaiting_payment','cancelled')) OR
    (OLD.status::text = 'awaiting_payment' AND NEW.status::text IN ('paid','confirmed','expired','requires_recovery','in_progress','cancelled')) OR
    (OLD.status::text = 'expired' AND NEW.status::text IN ('requires_recovery','cancelled')) OR
    (OLD.status::text = 'requires_recovery' AND NEW.status::text IN ('confirmed','cancelled')) OR
    (OLD.status::text = 'paid' AND NEW.status::text IN ('confirmed','requires_recovery','cancelled')) OR
    (OLD.status::text = 'confirmed' AND NEW.status::text IN ('checked_in','in_progress','completed','cancelled','no_show')) OR
    (OLD.status::text = 'checked_in' AND NEW.status::text IN ('in_progress','completed','cancelled')) OR
    (OLD.status::text = 'in_progress' AND NEW.status::text IN ('completed','cancelled','disputed')) OR
    (OLD.status::text = 'completed' AND NEW.status::text = 'disputed')
  ) THEN RAISE EXCEPTION 'Invalid booking status transition: % -> %', OLD.status, NEW.status; END IF;
  IF NEW.status::text = 'confirmed' AND NEW.confirmed_at IS NULL THEN NEW.confirmed_at = now(); END IF;
  IF NEW.status::text = 'completed' AND NEW.completed_at IS NULL THEN NEW.completed_at = now(); END IF;
  IF NEW.status::text = 'cancelled' AND NEW.cancelled_at IS NULL THEN NEW.cancelled_at = now(); END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS booking_transition_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  recovery_case_id uuid,
  transition_type text NOT NULL,
  state_machine text NOT NULL,
  state_from text,
  state_to text NOT NULL,
  actor jsonb NOT NULL DEFAULT '{"type":"SYSTEM"}',
  correlation_id uuid NOT NULL,
  causation_id text,
  workflow_instance_id uuid REFERENCES flow_instances(id) ON DELETE SET NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  claim_result text,
  latency_ms numeric,
  failure_category text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_booking_transition_trace ON booking_transition_audit(booking_id, created_at);
CREATE INDEX IF NOT EXISTS idx_booking_transition_correlation ON booking_transition_audit(correlation_id);
CREATE UNIQUE INDEX IF NOT EXISTS booking_transition_idempotency ON booking_transition_audit(booking_id,transition_type,causation_id) WHERE causation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recovery_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'REQUIRED'
    CHECK (state IN ('REQUIRED','ALTERNATIVES_AVAILABLE','AWAITING_CUSTOMER','ACCEPTED','REFUND_REQUIRED','RESOLVED')),
  failure_reason text NOT NULL,
  original_slot_id uuid NOT NULL REFERENCES booking_slots(id) ON DELETE RESTRICT,
  replacement_slot_id uuid REFERENCES booking_slots(id) ON DELETE RESTRICT,
  policy_version text NOT NULL DEFAULT 'recovery-v1',
  correlation_id uuid NOT NULL,
  causation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (booking_id, failure_reason)
);

ALTER TABLE booking_transition_audit
  ADD CONSTRAINT booking_transition_recovery_case_fk
  FOREIGN KEY (recovery_case_id) REFERENCES recovery_cases(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS recovery_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  recovery_case_id uuid NOT NULL REFERENCES recovery_cases(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES booking_slots(id) ON DELETE RESTRICT,
  rank integer NOT NULL CHECK (rank > 0),
  score numeric NOT NULL,
  price_delta bigint NOT NULL DEFAULT 0,
  reason jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'OFFERED' CHECK (status IN ('OFFERED','ACCEPTED','REJECTED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recovery_case_id, slot_id)
);

CREATE TABLE IF NOT EXISTS recovery_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  recovery_case_id uuid NOT NULL REFERENCES recovery_cases(id) ON DELETE RESTRICT,
  policy_version text NOT NULL,
  failure_reason text NOT NULL,
  original_price bigint NOT NULL,
  replacement_price bigint NOT NULL,
  customer_delta bigint NOT NULL DEFAULT 0,
  provider_delta bigint NOT NULL DEFAULT 0,
  kajola_subsidy bigint NOT NULL DEFAULT 0,
  decision_reason text NOT NULL,
  risk_decision text NOT NULL,
  approved_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  correlation_id uuid NOT NULL,
  causation_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (recovery_case_id, policy_version)
);

CREATE TABLE IF NOT EXISTS recovery_financial_effects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  recovery_case_id uuid NOT NULL REFERENCES recovery_cases(id) ON DELETE RESTRICT,
  recovery_decision_id uuid NOT NULL REFERENCES recovery_decisions(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE RESTRICT,
  payment_id uuid REFERENCES payments(id) ON DELETE RESTRICT,
  effect_type text NOT NULL CHECK (effect_type IN ('CUSTOMER_CHARGE','PROVIDER_CREDIT','KAJOLA_SUBSIDY','REFUND','ADJUSTMENT')),
  amount bigint NOT NULL CHECK (amount >= 0),
  currency text NOT NULL DEFAULT 'NGN',
  idempotency_key text NOT NULL UNIQUE,
  ledger_entry_id uuid REFERENCES financial_ledger_entries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Fixed five-minute pilot TTL. hold_minutes remains in the signature solely for
-- compatibility with already-deployed callers and is intentionally ignored.
CREATE OR REPLACE FUNCTION create_slot_hold(
  target_slot_id uuid, target_service_id uuid, target_customer_id uuid,
  target_tenant_id uuid, target_quote_snapshot_id uuid, request_key uuid,
  hold_minutes integer DEFAULT 5, target_staff_id uuid DEFAULT NULL
) RETURNS bookings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE slot_row booking_slots; quote_row quote_snapshots; result bookings; claimed_at timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO result FROM bookings WHERE idempotency_key = request_key AND tenant_id = target_tenant_id;
  IF FOUND THEN RETURN result; END IF;
  SELECT * INTO slot_row FROM booking_slots WHERE id = target_slot_id AND tenant_id = target_tenant_id FOR UPDATE;
  IF NOT FOUND OR slot_row.status <> 'available' THEN RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO quote_row FROM quote_snapshots WHERE id = target_quote_snapshot_id AND tenant_id = target_tenant_id
    AND customer_id = target_customer_id AND slot_id = target_slot_id AND service_id = target_service_id FOR SHARE;
  IF NOT FOUND OR quote_row.expires_at <= claimed_at THEN RAISE EXCEPTION 'STALE_QUOTE' USING ERRCODE = 'P0001'; END IF;
  INSERT INTO bookings (
    tenant_id, slot_id, service_id, artisan_id, client_id, user_id, status, held_at, held_until,
    booking_state, payment_state, fulfillment_state, settlement_state, hold_state, recovery_state,
    total_amount_kobo, total_amount, idempotency_key, quote_snapshot_id, starts_at, ends_at, staff_id
  ) VALUES (
    target_tenant_id, target_slot_id, target_service_id, slot_row.artisan_id, target_customer_id,
    target_customer_id, 'held', claimed_at, claimed_at + interval '5 minutes', 'HELD', 'INTENT_REQUIRED',
    'NOT_SCHEDULED', 'NOT_ELIGIBLE', 'ACTIVE', 'NONE', quote_row.total, quote_row.total,
    request_key, target_quote_snapshot_id, slot_row.start_at, slot_row.end_at, target_staff_id
  ) RETURNING * INTO result;
  UPDATE booking_slots SET status = 'held', held_by_user_id = target_customer_id,
    booking_id = result.id, updated_at = claimed_at WHERE id = target_slot_id;
  INSERT INTO booking_transition_audit(tenant_id,booking_id,transition_type,state_machine,state_from,state_to,
    correlation_id,workflow_instance_id,claim_result,latency_ms,metadata)
  VALUES (target_tenant_id,result.id,'slot.hold.acquired','HOLD',NULL,'ACTIVE',request_key,result.flow_instance_id,
    'ACQUIRED',extract(epoch FROM (clock_timestamp()-claimed_at))*1000,jsonb_build_object('hold_id',result.id,'slot_id',target_slot_id,'provider_id',slot_row.artisan_id,'staff_id',target_staff_id,'expires_at',result.held_until));
  RETURN result;
EXCEPTION WHEN exclusion_violation OR unique_violation THEN
  RAISE EXCEPTION 'SLOT_UNAVAILABLE' USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE FUNCTION release_expired_slot_holds(batch_size integer DEFAULT 100)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE item record; released integer := 0; trace_id uuid;
BEGIN
  FOR item IN SELECT b.id,b.slot_id,b.tenant_id,b.flow_instance_id,b.booking_state
    FROM bookings b WHERE b.hold_state='ACTIVE' AND b.held_until <= now()
      AND b.status::text IN ('held','awaiting_payment')
    ORDER BY b.held_until FOR UPDATE SKIP LOCKED LIMIT LEAST(GREATEST(batch_size,1),500)
  LOOP
    trace_id := gen_random_uuid();
    UPDATE bookings SET status='expired', booking_state='EXPIRED', hold_state='EXPIRED',
      fulfillment_state='NOT_SCHEDULED', settlement_state='NOT_ELIGIBLE', updated_at=now() WHERE id=item.id;
    UPDATE booking_slots SET status='available',held_by_user_id=NULL,booking_id=NULL,updated_at=now()
      WHERE id=item.slot_id AND booking_id=item.id;
    UPDATE flow_timers SET status='FIRED',fired_at=COALESCE(fired_at,now()),attempts=attempts+1,error_message=NULL
      WHERE timer_type='slot_expiration' AND status IN ('SCHEDULED','CLAIMED') AND payload->>'booking_id'=item.id::text;
    INSERT INTO booking_transition_audit(tenant_id,booking_id,transition_type,state_machine,state_from,state_to,
      correlation_id,workflow_instance_id,claim_result,metadata)
    VALUES(item.tenant_id,item.id,'slot.hold.expired','HOLD','ACTIVE','EXPIRED',trace_id,item.flow_instance_id,
      'RELEASED',jsonb_build_object('hold_id',item.id,'slot_id',item.slot_id));
    released := released + 1;
  END LOOP;
  RETURN released;
END;
$$;

CREATE OR REPLACE FUNCTION process_verified_payment(
  target_payment_id uuid, target_provider_event_id text, target_correlation_id uuid,
  verification_payload jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pay payments; book bookings; event_row provider_events; recovery recovery_cases; recovery_id uuid; requires_hold boolean; valid_hold boolean;
BEGIN
  SELECT * INTO event_row FROM provider_events WHERE provider_event_id=target_provider_event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PROVIDER_EVENT_NOT_FOUND'; END IF;
  IF event_row.status='PROCESSED' THEN
    SELECT * INTO pay FROM payments WHERE id=target_payment_id;
    SELECT * INTO book FROM bookings WHERE id=pay.booking_id;
    RETURN jsonb_build_object('cached',true,'payment_state',book.payment_state,'booking_state',book.booking_state,'recovery_state',book.recovery_state);
  END IF;
  SELECT * INTO pay FROM payments WHERE id=target_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND'; END IF;
  SELECT * INTO book FROM bookings WHERE id=pay.booking_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND'; END IF;
  IF pay.status::text='successful' THEN
    UPDATE provider_events SET status='PROCESSED',processed_at=COALESCE(processed_at,now()),error_message=NULL WHERE id=event_row.id;
    RETURN jsonb_build_object('cached',true,'payment_state',book.payment_state,'booking_state',book.booking_state,
      'fulfillment_state',book.fulfillment_state,'settlement_state',book.settlement_state,'recovery_state',book.recovery_state);
  END IF;

  requires_hold := book.booking_state IN ('DRAFT','HELD','PENDING_PAYMENT','EXPIRED')
    AND book.status::text IN ('pending','held','awaiting_payment','expired');
  valid_hold := book.hold_state='ACTIVE' AND book.held_until > now()
    AND book.status::text IN ('held','awaiting_payment')
    AND EXISTS (SELECT 1 FROM booking_slots s WHERE s.id=book.slot_id AND s.booking_id=book.id AND s.status='held');

  UPDATE payments SET status='successful',paid_at=COALESCE(paid_at,now()),
    raw_response=COALESCE(raw_response,'{}') || jsonb_build_object('verification',verification_payload),updated_at=now()
    WHERE id=pay.id AND status::text <> 'successful';
  INSERT INTO financial_ledger_entries(tenant_id,booking_id,payment_id,entry_type,direction,amount,currency,idempotency_key,metadata)
  VALUES(book.tenant_id,book.id,pay.id,'DEPOSIT','CREDIT',GREATEST(pay.amount_cents,1),pay.currency,
    'payment:'||pay.id||':deposit',jsonb_build_object('provider_event_id',target_provider_event_id)) ON CONFLICT(idempotency_key) DO NOTHING;

  IF NOT requires_hold THEN
    UPDATE bookings SET payment_state='CONFIRMED',updated_at=now() WHERE id=book.id;
    INSERT INTO booking_transition_audit(tenant_id,booking_id,payment_id,transition_type,state_machine,state_from,state_to,
      correlation_id,causation_id,workflow_instance_id,claim_result,metadata)
    VALUES(book.tenant_id,book.id,pay.id,'payment.confirmed','PAYMENT',book.payment_state,'CONFIRMED',target_correlation_id,
      target_provider_event_id,book.flow_instance_id,'BOOKING_ALREADY_SCHEDULED',jsonb_build_object('provider_id',book.artisan_id,'staff_id',book.staff_id));
  ELSIF valid_hold THEN
    UPDATE bookings SET status='confirmed',booking_state='CONFIRMED',payment_state='CONFIRMED',
      fulfillment_state='SCHEDULED',settlement_state='PENDING_ELIGIBILITY',hold_state='CONVERTED',
      recovery_state='NONE',confirmed_at=COALESCE(confirmed_at,now()),updated_at=now() WHERE id=book.id;
    UPDATE booking_slots SET status='booked',updated_at=now() WHERE id=book.slot_id AND booking_id=book.id;
    INSERT INTO booking_transition_audit(tenant_id,booking_id,payment_id,transition_type,state_machine,state_from,state_to,
      correlation_id,causation_id,workflow_instance_id,claim_result,metadata)
    VALUES(book.tenant_id,book.id,pay.id,'payment.confirmed','PAYMENT',book.payment_state,'CONFIRMED',target_correlation_id,
      target_provider_event_id,book.flow_instance_id,'HOLD_CONVERTED',jsonb_build_object('hold_id',book.id,'provider_id',book.artisan_id,'staff_id',book.staff_id));
  ELSE
    INSERT INTO recovery_cases(tenant_id,booking_id,payment_id,state,failure_reason,original_slot_id,correlation_id,causation_id)
    VALUES(book.tenant_id,book.id,pay.id,'REQUIRED','LATE_PAYMENT_AFTER_HOLD_EXPIRY',book.slot_id,target_correlation_id,target_provider_event_id)
    ON CONFLICT(booking_id,failure_reason) DO UPDATE SET payment_id=EXCLUDED.payment_id,updated_at=now()
    RETURNING * INTO recovery;
    recovery_id := recovery.id;
    UPDATE bookings SET status='requires_recovery',booking_state='REQUIRES_RECOVERY',payment_state='CONFIRMED',
      fulfillment_state='NOT_SCHEDULED',settlement_state='HELD',hold_state=CASE WHEN hold_state='ACTIVE' THEN 'EXPIRED' ELSE hold_state END,
      recovery_state='REQUIRED',updated_at=now() WHERE id=book.id;
    INSERT INTO recovery_recommendations(tenant_id,recovery_case_id,slot_id,rank,score,price_delta,reason)
    SELECT book.tenant_id,recovery.id,s.id,row_number() OVER(ORDER BY abs(extract(epoch FROM(s.start_at-book.starts_at))))::integer,
      1000000-abs(extract(epoch FROM(s.start_at-book.starts_at))),0,
      jsonb_build_object('same_provider',s.artisan_id=book.artisan_id,'same_service',s.service_id=book.service_id)
    FROM booking_slots s WHERE s.tenant_id=book.tenant_id AND s.service_id=book.service_id AND s.status='available'
      AND s.start_at > now() ORDER BY abs(extract(epoch FROM(s.start_at-book.starts_at))) LIMIT 5
    ON CONFLICT(recovery_case_id,slot_id) DO NOTHING;
    IF EXISTS(SELECT 1 FROM recovery_recommendations WHERE recovery_case_id=recovery.id) THEN
      UPDATE recovery_cases SET state='AWAITING_CUSTOMER',updated_at=now() WHERE id=recovery.id;
      UPDATE bookings SET recovery_state='AWAITING_CUSTOMER' WHERE id=book.id;
    END IF;
    INSERT INTO notifications(tenant_id,user_id,channel,title,body,payload,status,idempotency_key)
    VALUES(book.tenant_id,book.client_id,'in_app','Payment received — choose a new time',
      'Your original slot expired. Your money is protected; choose an alternative or request a refund.',
      jsonb_build_object('booking_id',book.id,'recovery_case_id',recovery.id),'QUEUED','recovery:'||recovery.id||':customer-options')
    ON CONFLICT(idempotency_key) DO NOTHING;
    INSERT INTO booking_transition_audit(tenant_id,booking_id,payment_id,recovery_case_id,transition_type,state_machine,state_from,state_to,
      correlation_id,causation_id,workflow_instance_id,claim_result,failure_category,metadata)
    VALUES(book.tenant_id,book.id,pay.id,recovery.id,'payment.late.recovery_required','RECOVERY','NONE','REQUIRED',
      target_correlation_id,target_provider_event_id,book.flow_instance_id,'ORIGINAL_SLOT_NOT_OWNED','LATE_PAYMENT',
      jsonb_build_object('hold_id',book.id,'original_slot_id',book.slot_id,'provider_id',book.artisan_id,'staff_id',book.staff_id));
  END IF;
  UPDATE provider_events SET status='PROCESSED',processed_at=now(),error_message=NULL
    WHERE id=event_row.id;
  SELECT * INTO book FROM bookings WHERE id=book.id;
  RETURN jsonb_build_object('cached',false,'payment_state',book.payment_state,'booking_state',book.booking_state,
    'fulfillment_state',book.fulfillment_state,'settlement_state',book.settlement_state,'recovery_state',book.recovery_state,
    'recovery_case_id',recovery_id);
END;
$$;

CREATE OR REPLACE FUNCTION accept_recovery_recommendation(
  target_recovery_case_id uuid, target_recommendation_id uuid, target_customer_id uuid, request_key text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recovery recovery_cases; recommendation recovery_recommendations; book bookings; slot_row booking_slots;
BEGIN
  SELECT * INTO recovery FROM recovery_cases WHERE id=target_recovery_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECOVERY_CASE_NOT_FOUND'; END IF;
  SELECT * INTO book FROM bookings WHERE id=recovery.booking_id FOR UPDATE;
  IF book.client_id <> target_customer_id THEN RAISE EXCEPTION 'RECOVERY_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF recovery.state IN ('ACCEPTED','RESOLVED') THEN
    RETURN jsonb_build_object('cached',true,'booking_id',book.id,'slot_id',book.slot_id);
  END IF;
  IF recovery.state NOT IN ('ALTERNATIVES_AVAILABLE','AWAITING_CUSTOMER') THEN RAISE EXCEPTION 'RECOVERY_NOT_ACCEPTABLE'; END IF;
  SELECT * INTO recommendation FROM recovery_recommendations
    WHERE id=target_recommendation_id AND recovery_case_id=recovery.id AND status='OFFERED' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECOMMENDATION_NOT_AVAILABLE'; END IF;
  SELECT * INTO slot_row FROM booking_slots WHERE id=recommendation.slot_id FOR UPDATE;
  IF NOT FOUND OR slot_row.status <> 'available' THEN RAISE EXCEPTION 'REPLACEMENT_SLOT_UNAVAILABLE' USING ERRCODE='P0001'; END IF;
  UPDATE booking_slots SET status='booked',held_by_user_id=book.client_id,booking_id=book.id,updated_at=now() WHERE id=slot_row.id;
  UPDATE bookings SET slot_id=slot_row.id,artisan_id=slot_row.artisan_id,starts_at=slot_row.start_at,ends_at=slot_row.end_at,
    status='confirmed',booking_state='CONFIRMED',fulfillment_state='SCHEDULED',settlement_state='PENDING_ELIGIBILITY',
    hold_state='CONVERTED',recovery_state='ACCEPTED',confirmed_at=COALESCE(confirmed_at,now()),updated_at=now() WHERE id=book.id;
  UPDATE recovery_recommendations SET status=CASE WHEN id=recommendation.id THEN 'ACCEPTED' ELSE 'REJECTED' END
    WHERE recovery_case_id=recovery.id;
  UPDATE recovery_cases SET state='ACCEPTED',replacement_slot_id=slot_row.id,updated_at=now() WHERE id=recovery.id;
  INSERT INTO booking_transition_audit(tenant_id,booking_id,payment_id,recovery_case_id,transition_type,state_machine,state_from,state_to,
    actor,correlation_id,causation_id,workflow_instance_id,claim_result,metadata)
  VALUES(book.tenant_id,book.id,recovery.payment_id,recovery.id,'recovery.replacement.accepted','RECOVERY',recovery.state,'ACCEPTED',
    jsonb_build_object('type','CUSTOMER','id',target_customer_id),recovery.correlation_id,request_key,book.flow_instance_id,'REPLACEMENT_ACQUIRED',
    jsonb_build_object('slot_id',slot_row.id,'provider_id',slot_row.artisan_id,'staff_id',book.staff_id));
  RETURN jsonb_build_object('cached',false,'booking_id',book.id,'slot_id',slot_row.id,'recovery_state','ACCEPTED');
EXCEPTION WHEN exclusion_violation OR unique_violation THEN
  RAISE EXCEPTION 'REPLACEMENT_SLOT_UNAVAILABLE' USING ERRCODE='P0001';
END;
$$;

CREATE OR REPLACE FUNCTION apply_recovery_financial_effect(
  target_recovery_case_id uuid, target_effect_type text, target_amount bigint,
  target_policy_version text, target_actor_id uuid, target_correlation_id uuid
) RETURNS recovery_financial_effects LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recovery recovery_cases; decision recovery_decisions; effect recovery_financial_effects; effect_key text;
BEGIN
  SELECT * INTO recovery FROM recovery_cases WHERE id=target_recovery_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECOVERY_CASE_NOT_FOUND'; END IF;
  INSERT INTO recovery_decisions(tenant_id,recovery_case_id,policy_version,failure_reason,original_price,replacement_price,
    kajola_subsidy,decision_reason,risk_decision,approved_by,correlation_id)
  SELECT recovery.tenant_id,recovery.id,target_policy_version,recovery.failure_reason,b.total_amount_kobo,b.total_amount_kobo,
    CASE WHEN target_effect_type='KAJOLA_SUBSIDY' THEN target_amount ELSE 0 END,'R2 deterministic recovery policy','ALLOW',target_actor_id,target_correlation_id
  FROM bookings b WHERE b.id=recovery.booking_id ON CONFLICT(recovery_case_id,policy_version) DO NOTHING
  RETURNING * INTO decision;
  IF decision.id IS NULL THEN SELECT * INTO decision FROM recovery_decisions WHERE recovery_case_id=recovery.id AND policy_version=target_policy_version; END IF;
  effect_key := CASE WHEN target_effect_type='KAJOLA_SUBSIDY' THEN 'recovery_subsidy' ELSE 'recovery_'||lower(target_effect_type) END
    ||':'||recovery.booking_id||':'||recovery.id||':'||target_policy_version;
  INSERT INTO recovery_financial_effects(tenant_id,recovery_case_id,recovery_decision_id,booking_id,payment_id,effect_type,amount,idempotency_key)
  VALUES(recovery.tenant_id,recovery.id,decision.id,recovery.booking_id,recovery.payment_id,target_effect_type,target_amount,effect_key)
  ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING * INTO effect;
  IF target_amount > 0 THEN
    INSERT INTO financial_ledger_entries(tenant_id,booking_id,payment_id,entry_type,direction,amount,idempotency_key,metadata)
    VALUES(recovery.tenant_id,recovery.booking_id,recovery.payment_id,'ADJUSTMENT','CREDIT',target_amount,effect_key,
      jsonb_build_object('recovery_case_id',recovery.id,'effect_type',target_effect_type)) ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN effect;
END;
$$;

CREATE OR REPLACE FUNCTION request_recovery_refund(
  target_recovery_case_id uuid, target_customer_id uuid, request_key text
) RETURNS refunds LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE recovery recovery_cases; book bookings; pay payments; result refunds;
BEGIN
  SELECT * INTO recovery FROM recovery_cases WHERE id=target_recovery_case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RECOVERY_CASE_NOT_FOUND'; END IF;
  SELECT * INTO book FROM bookings WHERE id=recovery.booking_id FOR UPDATE;
  IF book.client_id <> target_customer_id THEN RAISE EXCEPTION 'RECOVERY_FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT * INTO pay FROM payments WHERE id=recovery.payment_id FOR UPDATE;
  INSERT INTO refunds(tenant_id,booking_id,payment_id,amount,reason,actor,idempotency_key)
  VALUES(recovery.tenant_id,book.id,pay.id,pay.amount_cents,'late_payment_recovery',
    jsonb_build_object('type','CUSTOMER','id',target_customer_id),request_key)
  ON CONFLICT(idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key RETURNING * INTO result;
  UPDATE recovery_cases SET state='REFUND_REQUIRED',updated_at=now() WHERE id=recovery.id AND state NOT IN ('RESOLVED');
  UPDATE bookings SET recovery_state='REFUND_REQUIRED',payment_state='REFUND_PENDING',settlement_state='HELD',updated_at=now() WHERE id=book.id;
  INSERT INTO booking_transition_audit(tenant_id,booking_id,payment_id,recovery_case_id,transition_type,state_machine,state_from,state_to,
    actor,correlation_id,causation_id,workflow_instance_id,claim_result)
  VALUES(book.tenant_id,book.id,pay.id,recovery.id,'recovery.refund.requested','RECOVERY',recovery.state,'REFUND_REQUIRED',
    jsonb_build_object('type','CUSTOMER','id',target_customer_id),recovery.correlation_id,request_key,book.flow_instance_id,'REFUND_REQUESTED')
  ON CONFLICT DO NOTHING;
  RETURN result;
END;
$$;

ALTER TABLE recovery_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE recovery_financial_effects ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_transition_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authorized parties read recovery cases" ON recovery_cases FOR SELECT TO authenticated USING (
  has_role('super_admin') OR (has_role('tenant_admin') AND tenant_id=current_user_tenant_id()) OR
  EXISTS(SELECT 1 FROM bookings b LEFT JOIN artisans a ON a.id=b.artisan_id WHERE b.id=booking_id AND (b.client_id=auth.uid() OR b.user_id=auth.uid() OR a.user_id=auth.uid()))
);
CREATE POLICY "authorized customers read recovery recommendations" ON recovery_recommendations FOR SELECT TO authenticated USING (
  has_role('super_admin') OR (has_role('tenant_admin') AND tenant_id=current_user_tenant_id()) OR
  EXISTS(SELECT 1 FROM recovery_cases r JOIN bookings b ON b.id=r.booking_id LEFT JOIN artisans a ON a.id=b.artisan_id
    WHERE r.id=recovery_case_id AND (b.client_id=auth.uid() OR b.user_id=auth.uid() OR a.user_id=auth.uid()))
);
CREATE POLICY "authorized parties read recovery decisions" ON recovery_decisions FOR SELECT TO authenticated USING (
  has_role('super_admin') OR (has_role('tenant_admin') AND tenant_id=current_user_tenant_id()) OR
  EXISTS(SELECT 1 FROM recovery_cases r JOIN bookings b ON b.id=r.booking_id LEFT JOIN artisans a ON a.id=b.artisan_id
    WHERE r.id=recovery_case_id AND (b.client_id=auth.uid() OR b.user_id=auth.uid() OR a.user_id=auth.uid()))
);
CREATE POLICY "authorized parties read recovery effects" ON recovery_financial_effects FOR SELECT TO authenticated USING (
  has_role('super_admin') OR (has_role('tenant_admin') AND tenant_id=current_user_tenant_id()) OR
  EXISTS(SELECT 1 FROM bookings b LEFT JOIN artisans a ON a.id=b.artisan_id WHERE b.id=booking_id AND (b.client_id=auth.uid() OR b.user_id=auth.uid() OR a.user_id=auth.uid()))
);
CREATE POLICY "authorized parties read booking transition audit" ON booking_transition_audit FOR SELECT TO authenticated USING (
  has_role('super_admin') OR (has_role('tenant_admin') AND tenant_id=current_user_tenant_id()) OR
  EXISTS(SELECT 1 FROM bookings b LEFT JOIN artisans a ON a.id=b.artisan_id WHERE b.id=booking_id AND (b.client_id=auth.uid() OR b.user_id=auth.uid() OR a.user_id=auth.uid()))
);

GRANT SELECT ON recovery_cases,recovery_recommendations,recovery_decisions,recovery_financial_effects,booking_transition_audit TO authenticated;
GRANT ALL ON recovery_cases,recovery_recommendations,recovery_decisions,recovery_financial_effects,booking_transition_audit TO service_role;
REVOKE ALL ON FUNCTION create_slot_hold(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION release_expired_slot_holds(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION process_verified_payment(uuid,text,uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION accept_recovery_recommendation(uuid,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION apply_recovery_financial_effect(uuid,text,bigint,text,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION request_recovery_refund(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_slot_hold(uuid,uuid,uuid,uuid,uuid,uuid,integer,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION release_expired_slot_holds(integer) TO service_role;
GRANT EXECUTE ON FUNCTION process_verified_payment(uuid,text,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION accept_recovery_recommendation(uuid,uuid,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION apply_recovery_financial_effect(uuid,text,bigint,text,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION request_recovery_refund(uuid,uuid,text) TO service_role;

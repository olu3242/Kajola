-- Kajola automation engine migration

-- Extend system events for centralized event orchestration
ALTER TABLE system_events
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id UUID,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS dedup_key TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- Extend automation rules to support simple action type / config semantics
ALTER TABLE automation_rules
  ADD COLUMN IF NOT EXISTS action_type TEXT,
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Log each automation action execution for observability and idempotency
CREATE TABLE IF NOT EXISTS automation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  event_id UUID NOT NULL REFERENCES system_events(id) ON DELETE CASCADE,
  action_index INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  action_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_events_status ON system_events(status);
CREATE INDEX IF NOT EXISTS idx_system_events_status_created ON system_events(status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_events_dedup_key ON system_events(dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_automation_logs_event_rule ON automation_logs(event_id, rule_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_logs_action_unique ON automation_logs(event_id, rule_id, action_key);

ALTER TABLE automation_runs
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_runs_unique_event_rule ON automation_runs(event_id, rule_id);

-- System event emission helpers
CREATE OR REPLACE FUNCTION emit_system_event(
  p_tenant_id UUID,
  p_event_type TEXT,
  p_payload JSONB,
  p_source TEXT,
  p_created_by TEXT,
  p_entity_type TEXT,
  p_entity_id UUID
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO system_events(
    tenant_id, event_type, payload, source, created_by, entity_type, entity_id, status, dedup_key
  ) VALUES (
    p_tenant_id,
    p_event_type,
    p_payload,
    p_source,
    p_created_by,
    p_entity_type,
    p_entity_id,
    'pending',
    p_event_type || ':' || COALESCE(p_entity_type, 'system') || ':' || COALESCE(p_entity_id::TEXT, gen_random_uuid()::TEXT)
  )
  ON CONFLICT (dedup_key) DO NOTHING;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_system_event_trigger()
RETURNS TRIGGER AS $$
DECLARE
  tenant UUID;
  payload JSONB;
  created_by TEXT := COALESCE(auth.jwt() ->> 'sub', 'system');
BEGIN
  IF TG_TABLE_NAME = 'artisan_referrals' THEN
    SELECT tenant_id INTO tenant FROM artisans WHERE id = NEW.referrer_id;
  ELSE
    tenant := NEW.tenant_id;
  END IF;
  payload := row_to_json(NEW);
  PERFORM emit_system_event(
    tenant,
    TG_ARGV[0],
    payload,
    TG_TABLE_NAME,
    created_by,
    TG_ARGV[1],
    NEW.id::UUID
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION record_first_booking_completed()
RETURNS TRIGGER AS $$
DECLARE
  completed_count INTEGER;
BEGIN
  IF NEW.status = 'completed' AND OLD.status <> NEW.status THEN
    SELECT COUNT(*) INTO completed_count
    FROM bookings
    WHERE artisan_id = NEW.artisan_id
      AND status = 'completed'
      AND id <> NEW.id;

    IF completed_count = 0 THEN
      PERFORM emit_system_event(
        NEW.tenant_id,
        'first_booking_completed',
        row_to_json(NEW),
        TG_TABLE_NAME,
        COALESCE(auth.jwt() ->> 'sub', 'system'),
        'booking',
        NEW.id::UUID
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS record_booking_confirmed_event ON bookings;
CREATE TRIGGER record_booking_confirmed_event
AFTER UPDATE OF status ON bookings
FOR EACH ROW
WHEN (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_system_event_trigger('booking_confirmed', 'booking');

DROP TRIGGER IF EXISTS record_booking_completed_event ON bookings;
CREATE TRIGGER record_booking_completed_event
AFTER UPDATE OF status ON bookings
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_system_event_trigger('booking_completed', 'booking');

DROP TRIGGER IF EXISTS record_first_booking_completed_event ON bookings;
CREATE TRIGGER record_first_booking_completed_event
AFTER UPDATE OF status ON bookings
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_first_booking_completed();

DROP TRIGGER IF EXISTS record_payment_successful_event ON payments;
CREATE TRIGGER record_payment_successful_event
AFTER UPDATE OF status ON payments
FOR EACH ROW
WHEN (NEW.status = 'successful' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_system_event_trigger('payment_successful', 'payment');

DROP TRIGGER IF EXISTS record_review_created_event ON reviews;
CREATE TRIGGER record_review_created_event
AFTER INSERT ON reviews
FOR EACH ROW
EXECUTE FUNCTION record_system_event_trigger('review_created', 'review');

DROP TRIGGER IF EXISTS record_artisan_verified_event ON artisans;
CREATE TRIGGER record_artisan_verified_event
AFTER UPDATE OF verified ON artisans
FOR EACH ROW
WHEN (NEW.verified = TRUE AND OLD.verified IS DISTINCT FROM NEW.verified)
EXECUTE FUNCTION record_system_event_trigger('artisan_verified', 'artisan');

DROP TRIGGER IF EXISTS record_artisan_onboarded_event ON artisans;
CREATE TRIGGER record_artisan_onboarded_event
AFTER UPDATE OF onboarding_status ON artisans
FOR EACH ROW
WHEN (NEW.onboarding_status = 'profile_created' AND OLD.onboarding_status IS DISTINCT FROM NEW.onboarding_status)
EXECUTE FUNCTION record_system_event_trigger('artisan_onboarded', 'artisan');

DROP TRIGGER IF EXISTS record_referral_completed_event ON artisan_referrals;
CREATE TRIGGER record_referral_completed_event
AFTER UPDATE OF status ON artisan_referrals
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION record_system_event_trigger('referral_completed', 'artisan_referral');

CREATE OR REPLACE FUNCTION seed_default_automation_rules(target_tenant_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO automation_rules (tenant_id, name, trigger_event, conditions, action_type, config, is_active)
  VALUES
    (target_tenant_id, 'Notify artisan on booking creation', 'booking_created', '{}'::jsonb, 'send_notification', '{"channel":"in_app","user_id":"payload.artisan_user_id","title":"New booking request","body":"You have a new booking request. Respond quickly to keep your ranking strong."}'::jsonb, true),
    (target_tenant_id, 'Confirm client after payment', 'payment_successful', '{}'::jsonb, 'send_notification', '{"channel":"in_app","user_id":"payload.client_id","title":"Payment successful","body":"Your payment is successful and your booking is moving forward."}'::jsonb, true),
    (target_tenant_id, 'Request review after completion', 'booking_completed', '{}'::jsonb, 'send_notification', '{"channel":"in_app","user_id":"payload.client_id","title":"Rate your experience","body":"Please review your artisan to help quality rise across Kajola."}'::jsonb, true),
    (target_tenant_id, 'Onboarding tips', 'artisan_onboarded', '{}'::jsonb, 'send_notification', '{"channel":"in_app","user_id":"payload.user_id","title":"Complete your profile","body":"Add services, portfolio, availability, and verification to go live."}'::jsonb, true),
    (target_tenant_id, 'Artisan live notification', 'artisan_verified', '{}'::jsonb, 'send_notification', '{"channel":"in_app","user_id":"payload.user_id","title":"You are now live","body":"Your profile is verified and can appear in discovery."}'::jsonb, true),
    (target_tenant_id, 'First job boost', 'first_booking_completed', '{}'::jsonb, 'assign_featured_boost', '{"artisan_id":"payload.artisan_id","boost_value":1,"action_key":"first_job_boost"}'::jsonb, true),
    (target_tenant_id, 'Referral reward', 'referral_completed', '{}'::jsonb, 'trigger_reward', '{"referral_id":"payload.id","reward_amount":5000,"action_key":"referral_reward"}'::jsonb, true)
  ON CONFLICT DO NOTHING;
END;
$$ LANGUAGE plpgsql;

SELECT seed_default_automation_rules(id) FROM tenants;

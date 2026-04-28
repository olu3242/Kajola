CREATE TYPE payment_mode AS ENUM ('instant','escrow');
CREATE TYPE escrow_status AS ENUM ('held','released','refunded','disputed');

ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'in_progress' AFTER 'confirmed';

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_mode payment_mode NOT NULL DEFAULT 'instant';

CREATE TABLE IF NOT EXISTS escrow_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  payment_id UUID REFERENCES payments(id) ON DELETE SET NULL,
  amount BIGINT NOT NULL CHECK (amount >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  status escrow_status NOT NULL DEFAULT 'held',
  milestones JSONB NOT NULL DEFAULT '[]'::jsonb,
  released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS set_updated_at_escrow_accounts ON escrow_accounts;
CREATE TRIGGER set_updated_at_escrow_accounts
BEFORE UPDATE ON escrow_accounts
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE INDEX IF NOT EXISTS idx_bookings_payment_mode ON bookings(payment_mode);
CREATE INDEX IF NOT EXISTS idx_escrow_accounts_booking_id ON escrow_accounts(booking_id);
CREATE INDEX IF NOT EXISTS idx_escrow_accounts_status ON escrow_accounts(status);

CREATE OR REPLACE FUNCTION validate_booking_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('awaiting_payment','cancelled')) OR
    (OLD.status = 'awaiting_payment' AND NEW.status IN ('paid','in_progress','cancelled')) OR
    (OLD.status = 'paid' AND NEW.status = 'confirmed') OR
    (OLD.status = 'confirmed' AND NEW.status IN ('completed','cancelled')) OR
    (OLD.status = 'in_progress' AND NEW.status IN ('completed','cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid booking status transition: % -> %', OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'confirmed' AND NEW.confirmed_at IS NULL THEN
    NEW.confirmed_at = NOW();
  ELSIF NEW.status = 'completed' AND NEW.completed_at IS NULL THEN
    NEW.completed_at = NOW();
  ELSIF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
    NEW.cancelled_at = NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION create_booking_escrow(target_booking_id UUID, target_payment_id UUID)
RETURNS escrow_accounts AS $$
DECLARE
  booking_record bookings;
  payment_record payments;
  escrow_record escrow_accounts;
BEGIN
  SELECT * INTO booking_record FROM bookings WHERE id = target_booking_id;
  IF booking_record.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  SELECT * INTO payment_record FROM payments WHERE id = target_payment_id;
  IF payment_record.id IS NULL THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  INSERT INTO escrow_accounts (tenant_id, booking_id, payment_id, amount, currency, status, milestones)
  VALUES (
    booking_record.tenant_id,
    booking_record.id,
    payment_record.id,
    COALESCE(payment_record.amount, payment_record.amount_cents),
    payment_record.currency,
    'held',
    '[{"name":"Payment secured","status":"completed"},{"name":"Work in progress","status":"active"},{"name":"Release payout","status":"pending"}]'::jsonb
  )
  ON CONFLICT (booking_id) DO UPDATE
  SET payment_id = EXCLUDED.payment_id,
      amount = EXCLUDED.amount,
      currency = EXCLUDED.currency
  RETURNING * INTO escrow_record;

  RETURN escrow_record;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION mark_booking_in_progress(target_booking_id UUID)
RETURNS bookings AS $$
DECLARE
  updated bookings;
BEGIN
  UPDATE bookings
  SET status = 'in_progress'
  WHERE id = target_booking_id AND status = 'awaiting_payment'
  RETURNING * INTO updated;

  IF updated.id IS NULL THEN
    SELECT * INTO updated FROM bookings WHERE id = target_booking_id;
  END IF;

  IF updated.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  UPDATE booking_slots
  SET status = 'booked'
  WHERE id = updated.slot_id AND status <> 'booked';

  RETURN updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

ALTER TABLE escrow_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON escrow_accounts;
CREATE POLICY tenant_isolation ON escrow_accounts FOR ALL USING (tenant_id = current_user_tenant_id());
DROP POLICY IF EXISTS super_admin_all ON escrow_accounts;
CREATE POLICY super_admin_all ON escrow_accounts FOR ALL USING (has_role('super_admin'));

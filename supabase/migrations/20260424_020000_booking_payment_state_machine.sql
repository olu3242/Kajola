ALTER TYPE booking_status RENAME TO booking_status_old;
CREATE TYPE booking_status AS ENUM ('pending','awaiting_payment','paid','confirmed','completed','cancelled');

ALTER TABLE bookings ALTER COLUMN status DROP DEFAULT;
ALTER TABLE bookings
  ALTER COLUMN status TYPE booking_status
  USING (
    CASE status::text
      WHEN 'in_progress' THEN 'confirmed'
      WHEN 'no_show' THEN 'cancelled'
      ELSE status::text
    END
  )::booking_status;
ALTER TABLE bookings ALTER COLUMN status SET DEFAULT 'pending';
DROP TYPE booking_status_old;

ALTER TYPE payment_status RENAME TO payment_status_old;
CREATE TYPE payment_status AS ENUM ('pending','initialized','successful','failed');

ALTER TABLE payments ALTER COLUMN status DROP DEFAULT;
ALTER TABLE payments
  ALTER COLUMN status TYPE payment_status
  USING (
    CASE status::text
      WHEN 'paid' THEN 'successful'
      WHEN 'partial' THEN 'initialized'
      WHEN 'refunded' THEN 'failed'
      ELSE status::text
    END
  )::payment_status;
ALTER TABLE payments ALTER COLUMN status SET DEFAULT 'pending';
DROP TYPE payment_status_old;

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS total_amount BIGINT NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  ADD COLUMN IF NOT EXISTS payment_reference TEXT;

UPDATE bookings
SET user_id = COALESCE(user_id, client_id),
    total_amount = COALESCE(NULLIF(total_amount, 0), services.price_cents)
FROM services
WHERE bookings.service_id = services.id;

ALTER TABLE bookings
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS reference TEXT,
  ADD COLUMN IF NOT EXISTS amount BIGINT,
  ADD COLUMN IF NOT EXISTS raw_response JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE payments
SET reference = COALESCE(reference, provider_reference),
    amount = COALESCE(amount, amount_cents);

ALTER TABLE payments
  ALTER COLUMN reference SET NOT NULL,
  ALTER COLUMN amount SET NOT NULL,
  ADD CONSTRAINT payments_provider_check CHECK (provider IN ('stripe','paystack'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_reference ON payments(reference);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_reference ON bookings(payment_reference);

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
    (OLD.status = 'awaiting_payment' AND NEW.status IN ('paid','cancelled')) OR
    (OLD.status = 'paid' AND NEW.status = 'confirmed') OR
    (OLD.status = 'confirmed' AND NEW.status IN ('completed','cancelled'))
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

DROP TRIGGER IF EXISTS validate_booking_status_transition_trigger ON bookings;
CREATE TRIGGER validate_booking_status_transition_trigger
BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION validate_booking_status_transition();

CREATE OR REPLACE FUNCTION mark_booking_paid(target_booking_id UUID)
RETURNS bookings AS $$
DECLARE
  updated bookings;
BEGIN
  UPDATE bookings
  SET status = CASE
      WHEN status = 'awaiting_payment' THEN 'paid'::booking_status
      WHEN status IN ('paid','confirmed','completed') THEN status
      ELSE status
    END
  WHERE id = target_booking_id
  RETURNING * INTO updated;

  IF updated.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  RETURN updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION mark_booking_confirmed(target_booking_id UUID)
RETURNS bookings AS $$
DECLARE
  updated bookings;
BEGIN
  UPDATE bookings
  SET status = CASE
      WHEN status = 'awaiting_payment' THEN 'paid'::booking_status
      ELSE status
    END
  WHERE id = target_booking_id;

  UPDATE bookings
  SET status = CASE
      WHEN status = 'paid' THEN 'confirmed'::booking_status
      WHEN status IN ('confirmed','completed') THEN status
      ELSE status
    END
  WHERE id = target_booking_id
  RETURNING * INTO updated;

  IF updated.id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  UPDATE booking_slots
  SET status = 'booked'
  WHERE id = updated.slot_id AND status <> 'booked';

  RETURN updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION fail_payment(target_booking_id UUID)
RETURNS bookings AS $$
DECLARE
  updated bookings;
BEGIN
  UPDATE payments
  SET status = 'failed'
  WHERE booking_id = target_booking_id AND status <> 'successful';

  UPDATE bookings
  SET status = 'cancelled', cancellation_reason = COALESCE(cancellation_reason, 'Payment failed')
  WHERE id = target_booking_id AND status IN ('pending','awaiting_payment')
  RETURNING * INTO updated;

  IF updated.id IS NOT NULL THEN
    UPDATE booking_slots
    SET status = 'available', held_by_user_id = NULL, booking_id = NULL
    WHERE id = updated.slot_id;
  END IF;

  RETURN updated;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

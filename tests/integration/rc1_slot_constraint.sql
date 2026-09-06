-- RC1 live Supabase certification fixture. Run with psql against a disposable
-- sandbox transaction. Every write rolls back.
BEGIN;

DO $$
DECLARE
  slot_row booking_slots;
  customer_id uuid;
  rejected boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname IN ('bookings_staff_no_active_overlap','bookings_provider_no_active_overlap')
      AND contype = 'x'
  ) THEN
    RAISE EXCEPTION 'RC1_FAIL: real exclusion constraint is missing';
  END IF;

  SELECT s.* INTO slot_row FROM booking_slots s
  WHERE NOT EXISTS (SELECT 1 FROM bookings b WHERE b.slot_id=s.id AND b.status IN ('held','awaiting_payment','confirmed','in_progress','checked_in'))
  ORDER BY s.created_at LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'RC1_FIXTURE_REQUIRED: booking_slots'; END IF;
  SELECT id INTO customer_id FROM users WHERE tenant_id = slot_row.tenant_id ORDER BY created_at LIMIT 1;
  IF customer_id IS NULL THEN RAISE EXCEPTION 'RC1_FIXTURE_REQUIRED: customer'; END IF;

  INSERT INTO bookings (
    tenant_id, slot_id, service_id, artisan_id, client_id, status,
    starts_at, ends_at, held_until, idempotency_key
  ) VALUES (
    slot_row.tenant_id, slot_row.id, slot_row.service_id, slot_row.artisan_id,
    customer_id, 'held', slot_row.start_at, slot_row.end_at, now() + interval '15 minutes', gen_random_uuid()
  );

  BEGIN
    INSERT INTO bookings (
      tenant_id, slot_id, service_id, artisan_id, client_id, status,
      starts_at, ends_at, held_until, idempotency_key
    ) VALUES (
      slot_row.tenant_id, slot_row.id, slot_row.service_id, slot_row.artisan_id,
      customer_id, 'held', slot_row.start_at + interval '1 minute',
      slot_row.end_at, now() + interval '15 minutes', gen_random_uuid()
    );
  EXCEPTION WHEN exclusion_violation THEN
    rejected := true;
  END;

  IF NOT rejected THEN RAISE EXCEPTION 'RC1_FAIL: overlapping hold was accepted'; END IF;
  RAISE NOTICE 'RC1_PASS: exactly one overlapping hold accepted';
END $$;

ROLLBACK;

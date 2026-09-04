-- Execute after migrations on a disposable Supabase/PostgreSQL environment.
-- Multi-session race orchestration lives in scripts/certification/r2-concurrency.mjs.
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='process_verified_payment') THEN RAISE EXCEPTION 'missing process_verified_payment'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='accept_recovery_recommendation') THEN RAISE EXCEPTION 'missing accept_recovery_recommendation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='apply_recovery_financial_effect') THEN RAISE EXCEPTION 'missing apply_recovery_financial_effect'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_staff_no_active_overlap') THEN RAISE EXCEPTION 'missing staff exclusion constraint'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='bookings_provider_no_active_overlap') THEN RAISE EXCEPTION 'missing provider exclusion constraint'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname='recovery_financial_effects_idempotency_key_key') THEN RAISE EXCEPTION 'missing recovery effect uniqueness'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    JOIN aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a ON true
    WHERE n.nspname='public' AND p.proname IN
    ('create_slot_hold','release_expired_slot_holds','process_verified_payment','accept_recovery_recommendation','apply_recovery_financial_effect','request_recovery_refund')
    AND a.grantee=0 AND a.privilege_type='EXECUTE') THEN RAISE EXCEPTION 'public can execute privileged R2 RPC'; END IF;
END $$;

ROLLBACK;

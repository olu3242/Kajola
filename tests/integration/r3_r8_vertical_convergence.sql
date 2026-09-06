BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='quote_snapshots' AND column_name='provider_net_entitlement') THEN
    RAISE EXCEPTION 'immutable economics snapshot is incomplete';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='quote_snapshots_append_only') THEN
    RAISE EXCEPTION 'quote snapshot append-only trigger missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='transition_booking_fulfillment' AND prosecdef) THEN
    RAISE EXCEPTION 'fulfillment RPC missing or not security definer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname='queue_booking_settlement' AND prosecdef) THEN
    RAISE EXCEPTION 'settlement RPC missing or not security definer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='reconciliation_exceptions') THEN
    RAISE EXCEPTION 'reconciliation RLS policy missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='agent_action_requests'::regclass AND contype='c') THEN
    RAISE EXCEPTION 'agent safety checks missing';
  END IF;
END $$;

ROLLBACK;

# Kajola R2-R8 incident recovery

All commands below are authenticated domain commands. Never edit transactional rows to make a projection look correct.

## Charged but pending

1. Locate `provider_events`, `payments`, `financial_ledger_entries`, and the booking flow by correlation ID and provider reference.
2. Verify the Paystack transaction server-side, including reference, amount, currency, and booking/payment binding.
3. If the receipt is verified but unprocessed, replay the same provider event through `process_verified_payment`; its receipt and ledger keys are idempotent.
4. If the hold expired, preserve the later slot owner and use Recovery Engine alternatives/refund. Never force confirmation.

## Worker crash

1. Check `runtime_worker_heartbeats`, expired leases, step attempts, timers, and open dead letters.
2. Allow lease expiry or use the audited `WORKFLOW_RECOVER` operator command.
3. Resume from the durable checkpoint. Confirm callback, notification, ledger, refund, and settlement keys were not duplicated.

## Settlement failure

1. Inspect entitlement, settlement, settlement attempt, provider response, and reconciliation exception under one correlation ID.
2. Keep the settlement `FAILED`; never mark it paid based on an outbound request alone.
3. Use an audited `SAFE_RETRY`. `claim_settlement_attempt` allocates exactly one numbered attempt under a row lock.
4. A refund after settlement creates reversal/compensation evidence; it does not rewrite the original payment or settlement.

## Provider says booking is missing

Trace consumer request → quote → hold → booking → flow instance/steps → provider projection → notification. Repair the failing projection or replayable side effect, not booking truth.

## Dependency failures

- Supabase unavailable: readiness is `UNAVAILABLE`; stop transactional writes and retain queued work.
- Paystack unavailable: retain initialized/pending truth and reconcile before retry.
- Notification provider unavailable: retry the outbox and dead-letter after policy limits; never roll back booking/payment.
- AI provider unavailable: expose `AGENTIC_RUNTIME_BLOCKED_EXTERNAL`; core commerce and deterministic automation continue.

Every incident action requires actor, role, reason code, timestamp, correlation ID, before/after state, and append-only audit evidence.

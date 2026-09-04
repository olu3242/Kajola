# Flow–Runtime Contract

Orchestration emits `ExecutionCommand`; Runtime returns `ExecutionResult`.

Runtime responsibilities are handler resolution, unique idempotency keys, retry policy, timeout delivery, leases, heartbeats and dead-letter outcomes. Orchestration interprets the result and activates graph nodes.

Named policies include `FAST_INTERNAL_TASK`, `STANDARD_NETWORK_CALL`, `PAYMENT_PROVIDER`, `AI_PROVIDER`, `WEBHOOK_PROCESSING` and `HUMAN_APPROVAL`.

Production storage uses:

- `flow_step_instances.idempotency_key` uniqueness;
- `claim_ready_flow_steps` with row locking and worker leases;
- `flow_timers` for durable wake-ups;
- `update_flow_instance` for optimistic concurrency;
- `flow_event_receipts` for replay protection.

The Edge Function event processor now delegates retry/backoff calculation to `runtime_helpers.ts`. A deployed worker that persists package state/results is still required before connected-runtime certification.

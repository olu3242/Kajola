# OS Boundaries

## Workflow OS

Owns booking status, allowed actors, transition guards, milestones and Definition of Done. It must not import an LLM provider or queue implementation.

## Flow Orchestration OS

Owns graphs, routing, dependencies, waits, handoffs, checkpoints, subflows, cancellation and compensation. It consumes Workflow decisions and normalized events. It must not call a PSP SDK or invent a booking transition.

## Runtime OS

Owns handler execution, idempotency, retry/backoff, timers, worker leases, locks and dead-letter delivery. Runtime results do not determine business meaning.

## Agentic OS

Owns bounded AI task execution and structured results. The default adapter reports `PROVIDER_NOT_CONFIGURED` and falls back to human review. Agents cannot mutate booking or ledger truth directly.

## Governance OS

Owns policy decisions and evidence/approval gates. Authentication and base RBAC remain in session middleware, route checks and database RLS.

## Automation

Owns `WHEN event AND conditions THEN actions`. It is neither the durable runtime nor the business state machine.

## Guardrails

- UI calls application APIs; it does not mutate governed state directly.
- Handler names resolve only through a registry, never user-controlled `eval` or dynamic imports.
- Flow execution status is separate from booking and runtime-job status.
- Critical effects require stable idempotency and correlation keys.
- External webhook payloads remain provider-specific until validated and adapted to `PlatformEvent`.

# R1 Supabase Durability Evidence

## Decision

`R1_SUPABASE_READY_WITH_EXTERNAL_BLOCKER`

The durable implementation and offline regression gates are ready. Live migration application, database-executed RLS assertions, the two-session slot race, and restart persistence remain `BLOCKED_EXTERNAL` because the linked Supabase CLI session returns HTTP 401 and no database password is present. Local Supabase is also unavailable because Docker Desktop is not running. No credential or production result was fabricated.

## Git baseline

- Branch: `feat/kajola-connected-runtime-frontdoor`
- Baseline SHA: `6ffa87878c2cd46d1a59b97002ba8eedd50798fc`
- Worktree: dirty; the existing Flow Orchestration OS work and R1 activation remain uncommitted during certification.

## Forward migrations

- `20260904000000_flow_orchestration_os.sql`: canonical durable flow schema.
- `20260904010000_rc1_durable_runtime.sql`: forward-only RC1 activation. It adds atomic flow aggregate persistence, worker leases/heartbeat, callback expectations, dead letters, immutable quote snapshots, transactional slot holds, actual exclusion constraints, business readiness, provider event deduplication, notification delivery state, append-only ledger records, refunds, settlements, and tightened RLS.
- No historical migration was rewritten. No production table is dropped. Replacement triggers/policies/functions are deliberate forward hardening.
- Every new `SECURITY DEFINER` function fixes `search_path`, is revoked from `PUBLIC`, and is granted only to `service_role`.
- Offline migration validator: **18/18 passed**.

## Runtime modes and no fallback

Canonical modes are `local`, `test`, `sandbox`, and `production`. The legacy `connected` value maps explicitly to `sandbox` or `production`. Only local/test can select the deterministic adapter. Sandbox/production require Supabase Functions URL, project URL, anon key, and service-role key; missing dependencies produce `DEPENDENCY_UNAVAILABLE`/HTTP 503. Targeted tests verify sandbox never becomes local and the connected proxy does not return seeded data.

## Durable repositories and worker

- `SupabaseOrchestrationRepository` implements the existing `FlowRepository`; it does not introduce a competing abstraction.
- It maps definitions, aggregate instances, steps/attempts, checkpoints, event receipts, timers, callback expectations, dead letters, audit entries, correlation, causation, completion and optimistic lock versions.
- `persist_flow_instance` writes an instance, steps, checkpoints, and scheduled timers in one database transaction and rejects stale versions.
- `SupabaseWorkflowWorker` claims rows using `FOR UPDATE SKIP LOCKED`, records heartbeats, retries transient failures with persisted attempts/backoff, reclaims expired leases, and writes terminal failures to dead letter.
- `/api/internal/flow-worker` is unavailable without `FLOW_WORKER_TOKEN`, is disabled outside durable modes, and does not return secrets.
- Connected operator endpoints authenticate against Supabase, then load the server-owned role record; only a `super_admin` can inspect or recover flows. Recovery is constrained to named orchestrator actions and written to flow audit.

## Slot invariant

The old `CREATE INDEX ... USING gist` is not treated as a constraint. R1 adds two real `EXCLUDE USING gist` constraints:

- `bookings_staff_no_active_overlap` for team/staff bookings.
- `bookings_provider_no_active_overlap` for solo/provider bookings.

Both reject overlapping active holds/bookings. `create_slot_hold` additionally serializes requests on the exact `booking_slots` row with `FOR UPDATE`, validates a durable unexpired quote, and returns the prior booking for a repeated idempotency key. The connected booking function now persists the quote and calls this RPC instead of using a JavaScript availability pre-check. The rollback-only live fixture is `tests/integration/rc1_slot_constraint.sql`. Execution against Postgres is externally blocked; structural assertions pass locally.

## RLS review

The forward migration removes blanket tenant access from private bookings, payments, services, businesses, flow instances, ledger entries, refunds and settlements. Policies separate customer ownership, provider ownership, tenant-admin scope and platform-operator scope. This fixes the prior shared-tenant path where one customer could inherit tenant-wide access. Live JWT/RLS execution remains `BLOCKED_EXTERNAL`.

## Business and payment persistence

- The business aggregate persists owner, `SOLO`/`TEAM` type, branches, provider link, services, booking/payment policy, payout state, readiness dimensions and publication lifecycle. Publication is server-guarded by `refresh_business_readiness` and `publish_business`.
- Connected booking creation stores an immutable quote snapshot and atomic hold.
- Payment initialization/verification fail closed without provider credentials.
- Paystack webhook processing requires HMAC-SHA512 verification, verifies successful transactions server-side, deduplicates durable provider events, conditionally transitions payment state, and writes idempotent ledger entries. Real Paystack certification remains R6.

## Readiness

The protected readiness endpoint reports only non-secret state: runtime mode, database reachability, required schema marker, orchestration repository, worker heartbeat, timer and outbox samples, payment configuration, notification configuration, and deployment SHA. States are `READY`, `DEGRADED`, `BLOCKED`, `UNAVAILABLE`, or `LOCAL_ONLY`.

## Fresh local results

| Gate | Result |
|---|---|
| Root typecheck | 7/7 workspaces passed |
| Explicit orchestration typecheck | passed |
| Explicit web typecheck | passed |
| Web lint | passed, zero warnings/errors |
| Unit/integration | 57/57 tests, 6/6 files passed |
| Orchestration subset | 8/8 passed |
| R1 durability subset | 4/4 passed |
| Migration validation | 18/18 passed |
| Production build | 6/6 tasks; 75 pages generated |
| Targeted Playwright | 15/15 passed |
| Full Playwright | 38/38 passed |
| `git diff --check` | passed; Windows line-ending notices only |

## External blockers

1. `supabase migration list` reaches project `vzshucsacgrpuuzjondq` but returns HTTP 401 and requests `SUPABASE_DB_PASSWORD`.
2. No `.env` or `.env.local` supplies connected credentials.
3. `supabase status` cannot inspect a local stack because the Docker Desktop Linux engine is unavailable.
4. Therefore migration application, live SQL slot fixture, live RLS tests, and restart/reload persistence cannot be certified.

## Required live closeout

Authenticate the Supabase CLI without placing secrets in source control, verify migration history, apply only unapplied forward migrations, run `tests/integration/rc1_slot_constraint.sql` in sandbox, execute cross-tenant/customer RLS fixtures, create business/quote/booking/flow records, restart the runtime, and prove the same record IDs reload.

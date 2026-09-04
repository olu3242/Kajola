# Kajola R2 Transaction-Safe Booking Certification

Date: 2026-09-04

## Decision

`R2_READY_WITH_EXTERNAL_BLOCKER`

R2 implementation and local/structural verification are complete. Real PostgreSQL/Supabase concurrency, webhook replay, restart persistence, and RLS execution remain blocked by unavailable credentials and local Docker. They are not represented as certified.

## Git evidence

- Branch: `feat/kajola-connected-runtime-frontdoor`
- Program baseline: `6ffa87878c2cd46d1a59b97002ba8eedd50798fc`
- R1 baseline / R2 starting SHA: `01eff4bcddf98a4e2f7be53e9727f37723cd2b8a`
- R2 final SHA: recorded in the final handoff after commit
- Push: not attempted; prior push of R1 was blocked by environment egress policy for the unverified remote

## Implemented integrity

- Fixed server-side five-minute hold TTL with persisted `held_at` and `held_until`.
- Existing staff/provider GiST exclusion constraints remain the final overlap guard.
- Retry-safe expiry uses `FOR UPDATE SKIP LOCKED`, conditional slot release, durable flow timers, and transition audit.
- Booking, payment, fulfillment, settlement, hold, and recovery states persist independently.
- Verified payments are applied in one database RPC with payment and booking row locks, conditional hold conversion, append-only ledger idempotency, and provider receipt completion.
- A late payment never takes a later customer's slot. It remains confirmed financially while the booking moves to recovery, fulfillment stays unscheduled, and settlement is held.
- Recovery cases, ranked alternatives, policy decisions, and financial effects are separate records.
- Replacement acquisition is atomic and customer acceptance is mandatory.
- Refund requests and recovery effects have deterministic, database-unique idempotency keys.
- A database check blocks settlement progress during unresolved recovery.
- Duplicate payment events cannot advance the normal fulfillment flow while recovery is unresolved.
- Recovery and hold transitions include correlation, causation, workflow, actor, claim result, state, and domain identifiers in audit evidence.
- Customer and provider screens distinguish temporary holds, confirmations, expiry, and protected late-payment recovery.

## Evidence

| Gate | Result |
|---|---|
| Typecheck | 7/7 workspaces passed |
| Lint | Next lint passed, zero warnings/errors |
| Unit | 65/65 passed across 7 files |
| R2 local races | 2, 20, and 50 claims each produced exactly one winner |
| R2 late-payment scenario | Passed locally, including later-slot owner preservation and independent states |
| Replay | 20 local payment confirmations produced one payment transition and one ledger pair |
| Recovery command retry | 20 retries produced one deterministic effect key |
| Refund command retry | 20 retries produced one command event/key |
| Orchestration/durability | 12/12 targeted tests passed |
| Migration structure | 19 migrations validated; R2 SQL fixture and live harness added |
| Production build | 6/6 build tasks passed; Next generated 75 pages |
| Playwright | 37 passed and 1 flaky first attempt that passed on retry; 38 scenarios completed |
| Security dependency audit | 0 critical, 16 high, 17 moderate; fixes require breaking framework/mobile upgrades |
| Git whitespace | `git diff --check` passed |

The first full browser run exposed two local regressions (balance payments being treated as initial slot confirmation and completed appointments being labeled confirmed). Both were corrected; the focused rerun passed 6/6. The final full run had one unrelated front-door navigation timing retry and no terminal failures.

## Database and performance evidence

The live harness is `scripts/certification/r2-concurrency.mjs`; the database verification fixture is `tests/integration/r2_transaction_safety.sql`.

Live p50/p95/p99 latency, database lock wait, timeout rate, and exact PostgreSQL winner/rejection counts are `BLOCKED_EXTERNAL`. Local in-process races are useful regression evidence but are intentionally not reported as database performance evidence.

## External blockers

- Linked Supabase login returned HTTP 401 and requested `SUPABASE_DB_PASSWORD`.
- No executable Supabase URL, service-role credential, or disposable R2 fixture IDs are present for the live harness.
- Local Supabase cannot start because the Docker Desktop Linux engine pipe is unavailable.
- Consequently, migration application, real 2/20/50 session races, expiry/payment/new-claim race, concurrent webhook ×20, worker-kill/restart, live RLS, and database latency/lock measurements are blocked.
- Deno is unavailable locally, so Edge Functions are covered structurally and through TypeScript-consuming web paths, not `deno check`.

## Residual risks

- The new migration has not executed on PostgreSQL in this environment.
- Paystack sandbox signature/provider verification and concurrent callbacks have not run against a deployed endpoint.
- Worker crash recovery is designed around atomic RPCs, durable events, leases, and idempotency but lacks deployed kill/restart evidence.
- RLS policies have structural coverage only until live JWT execution is available.
- The dependency audit retains 16 high and 17 moderate findings; automated fixes require breaking Next/Expo/React Native upgrades and are outside R2.
- One existing front-door Playwright scenario required a retry in the final run.

## Next gate

After the blocked Supabase tests pass:

`NEXT → R3 NIGERIA-FIRST PAYMENT & COMMERCE CERTIFICATION`

R3 implementation was not started in this round.

# Kajola R2-R8 convergence certification

Evidence date: 2026-09-05

Branch: `feat/kajola-connected-runtime-frontdoor`

Baseline SHA: `17e2d3e4286b6740a5d62d25ed9fb96c9a4e4a2f`

## 1. Executive decision

`NO_GO`

The R2-R8 implementation is locally converged and is best described as
`R2_R8_READY_WITH_EXTERNAL_BLOCKERS`, but it is not authorized for an R9 Lagos
pilot. Live database/runtime evidence is unavailable and reachable high-severity
Next.js findings remain `PILOT_BLOCKING`. No deployed or live-external claim is
made.

## 2. Gate matrix

| Gate | Status | Implementation | Certification | External blocker | Residual risk |
| --- | --- | --- | --- | --- | --- |
| R2 | `R2_READY_WITH_EXTERNAL_BLOCKER` | Existing five-minute hold, exclusion, recovery and idempotency design retained | Unit/static race and replay evidence rerun | Supabase auth, PostgreSQL, Docker, workers | No live lock latency, RLS race or restart result |
| R3 | `R3_READY_WITH_EXTERNAL_BLOCKER` | One immutable commerce snapshot; full/deposit/partial/offline methods; tips; verified canonical Paystack path | Unit, structural, local E2E | Paystack and live Supabase | Refund/provider callback matrix not live-executed |
| R4 | `R4_READY_WITH_EXTERNAL_BLOCKER` | Explicit fulfillment transitions, RBAC, cancellation/recovery, notification outbox state | Unit and Playwright | Deployed auth/RLS and notification provider | Notification retry is structural/local only |
| R5 | `R5_READY_WITH_EXTERNAL_BLOCKER` | Entitlement, settlement predicate/state machine, attempts, reconciliation queue, audited operator commands | Unit and structural SQL | Database, transfer provider, deployed operator auth | No real payout, reversal or ledger reconciliation |
| R6 | `R6_READY_WITH_EXTERNAL_BLOCKER` | One local discover-to-rebook journey and connected route/function chain | Unit and 38-scenario browser E2E | Supabase deployment, callbacks, provider sandboxes | Connected journey not executed against production-like infrastructure |
| R7 | `R7_NOT_CERTIFIED` | Protected readiness, correlation envelope, secret redaction, backlogs and runbook | Unit, build, local readiness behavior | Runtime/deployment unavailable | Reachable Next.js highs are pilot-blocking; no live telemetry |
| R8 | `R8_READY_WITH_EXTERNAL_BLOCKER` | Replay-safe automation and fail-closed, governed agent actions | Unit and structural SQL | Anthropic key and deployed runtime | `AGENTIC_ARCHITECTURE_IMPLEMENTED`; `AGENTIC_RUNTIME_BLOCKED_EXTERNAL` |

## 3. Git state

At evidence capture:

- Branch: `feat/kajola-connected-runtime-frontdoor`
- Baseline/starting HEAD: `17e2d3e4286b6740a5d62d25ed9fb96c9a4e4a2f`
- Starting origin divergence: 0 behind / 2 ahead
- Final SHA and final divergence: recorded in the handoff because a commit cannot
  contain its own hash
- The pre-existing `apps/mobile/package.json` modification is user-owned,
  excluded from this certification commit, and intentionally remains unstaged
- Push: not attempted; no authorization
- PR: not created

## 4. Engine map

| Engine | Canonical path | Runtime active | Persistence | Tests | Duplicate retired |
| --- | --- | --- | --- | --- | --- |
| Availability/hold | `supabase/functions/bookings/index.ts`, `create_slot_hold` | Local active; connected ready | booking slots, bookings, quote snapshots | R2 unit 2/20/50; structural SQL | `book-slot` returns 410 |
| Booking/fulfillment | `bookings/index.ts`, `transition_booking_fulfillment` | Local active; connected ready | bookings, fulfillment audit | unit + Playwright | Yes |
| Commerce/economics | `apps/web/lib/commerce.ts`, immutable quote migration | Local active; connected ready | quote snapshots | 4 fee modes, caps, balance invariants | Yes |
| Payment | `supabase/functions/payments/index.ts` | Local active; connected blocked on Paystack | payments, provider events, ledger | unit/structural/E2E | `confirm-payment` returns 410 |
| Webhook | `supabase/functions/payments_webhook/index.ts` | Connected code ready | provider events, payments, ledger | replay/binding structural + unit | Yes |
| Gratuity | `supabase/functions/gratuities/index.ts`, `process_verified_tip` | Local active; connected blocked on Paystack | gratuities, payments, ledger | unit full journey | Yes |
| Recovery/cancellation | existing recovery engine plus bookings transition | Local active; connected ready | recovery cases, cancellation decisions | unit + E2E | Reused, not duplicated |
| Settlement | `marketplace-operations/index.ts`, settlement RPCs | Local active; connected not deployed | entitlements, settlements, attempts, ledger | unit failure/retry/replay | Built once |
| Reconciliation | `marketplace-operations/index.ts` | Local active; connected not deployed | exceptions, offline evidence | unit mismatch/dual attestation | Built once |
| Operator | protected operator APIs and audited commands | Local active; connected not deployed | commands, incidents, audits | RBAC/unsafe action unit/E2E | Harmonized |
| Notification | durable system-event/outbox runtime | Local simulation; connected not deployed | system events, notification attempts/dead letters | idempotency structural | Reused |
| Workflow/runtime | existing orchestration package and workers | Local active; durable runtime blocked | flows, attempts, timers, receipts, heartbeats | 4 durability tests | Reused |
| Automation | `packages/automation`, `process-events` | Rule engine active locally | automation runs/actions | replay x20 | Unsafe mutation retired |
| Agentic OS | agent recommendation/action request boundary | Architecture active; AI blocked | recommendations, requests, audit | safety unit | Built as advisory boundary |
| Observability/readiness | `observability.ts`, `/api/readiness` | Local active; live unavailable | incident/audit/runtime tables | redaction unit + build | Harmonized |

## 5. Database and migrations

- Added one forward-only migration:
  `20260905000000_r3_r8_vertical_convergence.sql`.
- Static validation: 20/20 repository migrations passed.
- Applied: 0 in this run. Linked Supabase returned HTTP 401 and local Docker was
  unavailable.
- Added ten operational/evidence tables, five explicit indexes plus one partial
  unique gratuity index, ten RLS enablements and ten read policies.
- Added/updated immutable quote, booking lifecycle, payment verification,
  gratuity, notification and settlement constraints/triggers.
- Privileged functions use `SECURITY DEFINER SET search_path = public`; public
  execution is revoked and service-role grants are explicit.
- Runtime SQL, RLS and concurrent PostgreSQL execution remain unverified.

## 6. Test results

| Scope | Exact result | Evidence class |
| --- | --- | --- |
| Typecheck | 7/7 workspace packages successful | STATIC |
| Lint | 0 warnings, 0 errors | STATIC |
| Unit | 83/83 tests in 8/8 files | UNIT |
| Integration SQL | 1 SQL harness authored; 0 executed | STATIC only |
| Orchestration/runtime | 12 unit tests across orchestration and durable-runtime suites included in 83 | UNIT |
| Booking concurrency | 2, 20 and 50 local contenders: one winner each; <2s assertion | UNIT, not DATABASE |
| Webhook replay | late-payment verification x20 and structural dedupe; no live callback | UNIT/STATIC |
| Financial idempotency | recovery/refund/automation/compensation replay x20 | UNIT |
| Payment flows | local deposit, balance, card/transfer and cash; connected binding structural | UNIT/E2E/STATIC |
| Fulfillment | acknowledgement through completion plus tenant denial | UNIT/E2E |
| Settlement | blocker predicate, deterministic command, fail/retry, tip inclusion | UNIT |
| Reconciliation | mismatch and dual offline attestation | UNIT |
| Automation | deterministic replay x20; arbitrary mutation rejected | UNIT/STATIC |
| Agentic OS | forbidden actions fail closed; refund needs approval | UNIT |
| Security/RLS | route RBAC and cross-tenant browser tests; SQL policies static | UNIT/E2E/STATIC, not DATABASE |
| Playwright/browser E2E | 38/38 Chromium scenarios, one worker, no retry | E2E |
| Interactive in-app browser | 0; no browser connection was available | UNAVAILABLE |
| Production build | 6/6 build tasks; Next compiled; 79/79 pages generated | STATIC |
| Dependency audit | 33 instances: 16 high, 17 moderate, 0 critical | STATIC |
| Migration validation | 20/20 | STATIC |
| Deployed verification | 0 | UNAVAILABLE |
| Live external verification | 0 | UNAVAILABLE |

The earlier provider Playwright failure was a stale test contract: the test tried
to check in before the now-required provider acknowledgement. It failed
deterministically, the test was corrected to the authorized sequence, its
targeted run passed 4/4, and the full suite then passed 38/38 without retry. It
was not classified as product flakiness.

## 7. Canonical journey evidence

| Journey segment | Executed evidence | Highest class |
| --- | --- | --- |
| Discover -> provider -> services -> availability | customer Playwright journey | E2E |
| Slot -> atomic-shaped hold -> quote | local API/browser plus 2/20/50 unit races | E2E/UNIT |
| Arrangement -> deposit -> balance | connected-runtime Playwright and unit journey | E2E |
| Immutable server economics -> payment | quote snapshot tests and canonical connected handlers | UNIT/STATIC |
| Acknowledge -> check-in -> start -> explicit completion | provider Playwright | E2E |
| Tip -> entitlement -> settlement queue | complete local unit journey | UNIT |
| Offline cash -> dual attestation -> reconciliation | local unit journey | UNIT |
| Review -> rebook | complete local unit and customer browser journeys | UNIT/E2E |
| Automation | real local domain event plus deterministic action identity | UNIT |
| Agentic assistance | recommendation/governance boundary only | UNIT/STATIC; runtime blocked |

No row above is promoted to DATABASE, DEPLOYED or LIVE_EXTERNAL.

## 8. Failure-path evidence

| Failure | Evidence | Classification |
| --- | --- | --- |
| Slot race 2/20/50 | one local winner | UNIT |
| Payment abandoned/timeout/hold expiry/late payment | expiry and later-owner recovery tests | UNIT |
| Duplicate webhook/concurrent verification | x20 same intent/effect | UNIT |
| Worker crash | durable lease/checkpoint architecture and runbook | STATIC/UNIT; live blocked |
| Duplicate recovery/refund | x20 one command/effect | UNIT |
| Provider cancellation | recovery-required policy and transition implementation | UNIT/STATIC |
| Customer cancellation | slot release browser test | E2E |
| No-show | authorized state and schema path | UNIT/STATIC |
| Refund | recovery refund x20 | UNIT |
| Settlement failure | failed -> retry-required -> processing | UNIT |
| Refund after settlement | deterministic compensation key x20 | UNIT |
| Offline mismatch | customer/provider amount disagreement holds settlement | UNIT |
| Supabase failure | connected mode fails closed; CLI 401 observed | UNIT/EXTERNAL-BLOCKER |
| Paystack failure | explicit 503/failure persistence | STATIC; live blocked |
| Notification failure | outbox/dead-letter separation and runbook | STATIC; live blocked |
| Tenant attack | cross-tenant API/browser denial | E2E |
| Unsafe operator action | audited allow-list and RBAC | UNIT/STATIC |
| Unsafe agent action | immutable ledger/settlement actions return forbidden | UNIT |

## 9. Economics evidence

Executed SPLIT-policy sample, all values in kobo:

- Service base 1,000,000 + add-ons 100,000 - discount 50,000 = service price
  1,050,000.
- Processing 15,000 + transfer 2,000 + settlement 1,000 = external cost
  18,000, split 9,000 customer / 9,000 provider.
- Platform fee at 10% = 105,000; provider fee = 105,000 + 9,000 = 114,000.
- Tip = 50,000 and tip commission = 0.
- Customer total = 1,050,000 + 9,000 + 50,000 = 1,109,000.
- Provider gross entitlement = 1,100,000; provider net entitlement and
  settlement amount = 986,000.
- Kajola gross revenue = 123,000; Kajola net revenue = 105,000 after subtracting
  the 18,000 external cost exactly once; subsidy = 0.
- Due now = 300,000; due at service = 809,000; paid + outstanding and
  due-now + due-at-service both balance to customer total.

Four fee-bearer modes and cap/subsidy pressure are covered by unit tests. Tips
are not commissioned unless an explicit non-zero policy says so.

## 10. Operational evidence

The protected readiness endpoint exposes runtime mode, deployment SHA, schema,
database, orchestration repository, worker heartbeat, due timers, outbox, dead
letters, recovery, settlement, reconciliation and automation backlogs, Paystack,
notifications and agentic state. Local mode correctly reports `BLOCKED` with
`LOCAL_ONLY`/`UNAVAILABLE`; missing connected dependencies fail closed.

Live worker health, timer delivery, backlog counts, deployment SHA, callback
latency and production logs are `UNAVAILABLE`. The incident runbook covers
charged-but-pending, worker crash, settlement failure, missing provider booking
and dependency failures using audited commands rather than database edits.

## 11. Security evidence

- Customer ownership, provider isolation, owner/admin access and cross-tenant
  denial are enforced in route/function boundaries and covered locally.
- Staff/provider completion is an authorized explicit transition; clock time is
  never completion truth.
- Operator financial actions require role, reason, correlation, before/after
  evidence and an audited command.
- Evidence tables are append-only; quote/ledger history is not rewritten.
- Agent actions are classified auto, policy-gated, approval-required or
  forbidden; settlement, ledger, permissions, tenant ownership and audit
  mutation fail closed.
- Database RLS/service-role grants are static-validated but not live-tested.
- Super-admin/operator scope and production JWT claims remain externally blocked.

## 12. Dependency risk

`npm audit --omit=dev` found 16 high, 17 moderate and 0 critical vulnerable
instances. Every high advisory is itemized in `DEPENDENCY_RISK.md` with execution
path and decision. Reachable App Router, middleware and request-cache findings
are `PILOT_BLOCKING`; local-image findings are `MITIGATED`; build-only,
rewrite, Server Action, WebSocket and i18n paths are `NOT_REACHABLE`. Expo/RN
transitives are `UPGRADE_REQUIRED`. A breaking `npm audit fix --force` was not
run.

## 13. External blockers

1. Supabase project authentication/database password and service credentials.
2. Live migration application and PostgreSQL SQL/RLS/concurrency execution.
3. Docker Desktop/local Supabase engine.
4. Deployment of functions, workers, readiness and callbacks.
5. Paystack sandbox key, webhook reachability and transfer/refund evidence.
6. Termii/Africa's Talking notification credentials and delivery evidence.
7. Anthropic key for live Agentic OS execution.
8. Production-like observability/heartbeat infrastructure.
9. Push, PR and merge authorization.

## 14. Residual risks and unexecuted claims

- No live DB constraint, lock latency, RLS/JWT, race or migration rollback proof.
- No worker crash/restart, lease reclamation, timer, outbox or dead-letter live run.
- No signed Paystack callback, provider transfer, refund or settlement run.
- No production customer/provider/operator financial-view comparison.
- No notification delivery/retry run and no live AI recommendation/action run.
- No deployed readiness, telemetry, incident recovery or deployment rollback.
- Connected Edge Functions could not be Deno-checked because Deno is unavailable;
  TypeScript/web boundaries and source contracts were tested instead.
- Reachable high-severity Next.js issues are unresolved.

## 15. Next decision

Do not advance to `R9 CONTROLLED LAGOS PILOT READINESS` yet. Smallest P0 closure
backlog:

1. Upgrade Next.js to a supported non-vulnerable line (or deploy independently
   verified compensating controls) and rerun 83 unit tests, 38 Playwright tests,
   lint, typecheck, build and audit.
2. Supply a safe Supabase environment, apply all 20 migrations, and execute the
   SQL integration/RLS/JWT plus 2/20/50 PostgreSQL races and lock measurements.
3. Deploy workers/functions/readiness; execute crash recovery, timer, outbox,
   dead-letter and correlation scenarios.
4. Configure Paystack sandbox and notifications; execute signed callback,
   mismatch, refund, settlement, reconciliation and delivery failure matrices.
5. Configure Anthropic for live R8 evidence or explicitly remove live agentic
   execution from pilot scope while retaining fail-closed controls.
6. Review the certification commit, authorize push/PR, and rerun deployed smoke
   and tenant-isolation checks.

# OS Convergence Certification

## Execution matrix

| Capability | Implemented | Connected | Executed | Certified |
|---|---:|---:|---:|---:|
| Workflow OS | Yes | Supabase worker implemented | Local + offline tests | Live deployment blocked |
| Flow Orchestration OS | Yes | Supabase repository implemented | Local + offline tests | Live restart blocked |
| Runtime OS | Yes | Durable modes fail closed | Yes | Live dependency blocked |
| Agentic OS | Contract | Fallback | Yes | No |
| Governance OS | Yes | Yes | Yes | Local only |
| Automation | Existing | Yes | Yes | Partial |
| Human tasks | Yes | Generic | Unit-tested | No UI certification |
| Events | Yes | Yes | Yes | Local only |
| Timers | Yes | Durable rows + worker resume | Unit-tested | No live restart certification |
| Compensation | Yes | Generic | Unit-tested | No domain saga certification |
| Definition of Done | Yes | Booking | Yes | Local only |
| Observability | Yes | Operator API/UI | Yes | Local only |
| Audit | Yes | Yes | Yes | Local only |

## Evidence

- Golden flow: web booking hold → deposit → confirmation → parallel effects → fulfilment → completion → review/settlement coordination → Definition of Done.
- Automated tests: `tests/unit/orchestration.test.ts` and `apps/web/tests/e2e/connected-runtime.spec.ts`.
- Latest local R1 evidence (2026-09-05): 83/83 unit/integration assertions, 38/38 local-mode production-server Playwright scenarios, 7/7 workspace typechecks, 79 generated pages, and 20/20 migration files accepted by the safety validator. Web lint also passed; the root package has no lint script.
- Production schema: `20260904000000_flow_orchestration_os.sql`.
- Operator trace: `/api/operator/flows?flowId=...`.

## Gaps

- P0: restore CLI authorization/project visibility, confirm exposed-password rotation, link Supabase, verify pooler transport, inspect/dry-run/apply migrations, deploy worker/timers, and execute live RLS/race/restart/golden-flow tests. Repository and worker implementations are present but not deployed.
- P0 security: the production dependency audit has no critical findings after upgrading Next.js to 14.2.35, but 16 high and 17 moderate transitive findings remain; clearing them requires planned Next/Expo/React Native major upgrades.
- P1: intent-named booking transition APIs, human task UI, dead-letter control, webhook-to-flow production adapter, restart/concurrency failure injection.
- P2: agent provider adapter, dynamic rule authoring, richer bottleneck metrics.
- Infrastructure dependencies: linked Supabase, callback reachability, payment/notification credentials.
- Security risks: service-role worker functions require deployment verification; legacy production side effects still bypass the new flow.
- Operational risks: no deployed heartbeat reaper or flow dead-letter alert yet.

## Decision

`R1_SUPABASE_READY_WITH_EXTERNAL_BLOCKER`

The durable activation code is locally verified and fails closed. Production certification is withheld because post-rotation `supabase projects list` execution still returned `Unauthorized` on 2026-09-05, the expected project could not be verified, and the connected-runtime environment is absent. The user confirmed rotating the disclosed replacement credential again; the new credential was not provided to or used by this run. Migration application, live RLS, concurrent database execution, and restart persistence have not been claimed as passes.

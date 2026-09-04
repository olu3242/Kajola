# Kajola connected-runtime audit

This audit maps the current P0 UI to its real execution path. `local adapter` means deterministic, process-persistent test/development state; production routes proxy to Supabase Functions. A local adapter result is not production database certification.

| UI intent | API/action | Canonical owner | Repository/table | Event/workflow/audit | UI consequence | Current result |
| --- | --- | --- | --- | --- | --- | --- |
| Landing search/category/location | `GET /api/artisans` | Marketplace query | provider/service/location adapter; production function | read-only telemetry pending | URL-backed discovery results | Connected; production persistence depends on Supabase |
| Provider/profile/services | provider and service GET routes | Provider + catalog query | provider/service adapter | read-only telemetry pending | profile, service, price | Connected |
| Request availability | slots route | Availability calculation | hours + shared bookings | read-only | server-calculated slots | Connected locally; DB locking remains production responsibility |
| Select slot | bookings POST / hold handler | Slot-hold/booking transition | shared booking repository | `booking.hold_created`; expiry job; audit | durable-shaped held booking | Connected locally |
| Checkout | booking GET | Pricing policy/quote | booking + provider policy | read-only | authoritative price breakdown | Connected |
| Choose payment channel | payments POST | Payment intent | shared payment repository | `payment.intent_created`; audit | PSP/local callback or pay-at-venue confirmation | Connected locally; PSP blocked without credentials |
| Verify payment | payments verify POST | Reconciliation + booking | payment, booking, ledger | `payment.succeeded`, `booking.confirmed`; reminders; notifications; audit | confirmed appointment and balances | Connected locally; webhook/PSP production certification pending |
| Fulfil appointment | booking transition handler | Booking state machine | shared booking repository | check-in/start/complete events; completion workflow; audit | all personas read same booking | Connected; generic legacy status endpoint remains for compatibility |
| Pay balance | same checkout/payment intent with `balance` purpose | Pricing + payment | same payment/ledger repositories | payment and confirmation evidence | balance and payment status refresh | Connected locally |
| Tip or no tip | gratuities POST / explicit client skip | Gratuity | gratuity + ledger | `gratuity.received`; provider notification; audit | optional receipt state | Connected locally |
| Review | reviews POST | Review | reviews + provider aggregate | `review.submitted`; audit | provider rating refresh | Connected locally |
| Business type/services | onboarding APIs | Onboarding/catalog | provider/service adapter | event coverage incomplete | persisted local profile and services | Partial |
| Payment policy | owner payment-settings API | Tenant pricing policy | provider policy adapter | versioned policy; event coverage pending | future bookings use configured policy | Partial |
| Customer/provider/owner dashboards | dashboard APIs | Analytics queries | shared booking/review/ledger state | derived state | role-specific views of same aggregate | Connected locally |
| Operator runtime | protected operator runtime API | Operator/health | events/audits/ledger/workflows | explicit admin RBAC | safe evidence summary | Connected locally |

## Broken or externally blocked connections

- Supabase-backed production persistence, transaction-level slot conflict protection, durable event outbox, and durable workflow workers require a linked project and deployed migrations/functions.
- Paystack/Flutterwave verification, split settlement, refunds, and webhook signature certification require sandbox credentials and callback reachability.
- SMS/email delivery certification requires a configured provider. Notification records currently prove intent/delivery simulation only in local mode.
- Onboarding tenant/branch/staff/availability readiness is not yet a single transactional aggregate.
- The legacy generic booking-status route remains for existing callers; new UI should migrate to intent-named actions before production certification.
- AI is optional and does not participate in booking/payment correctness.

## Engine dependency matrix

| Engine | Depends on | Emits |
| --- | --- | --- |
| Marketplace | tenant, service, provider | discovery read telemetry (pending) |
| Availability | provider, service, booking | availability read telemetry (pending) |
| Slot hold | availability, booking | `booking.hold_created` |
| Booking | availability, pricing, payment | `booking.*`, `service.*` |
| Pricing | service, tenant payment policy | versioned checkout quote |
| Payment | pricing, PSP adapter | `payment.*` |
| Ledger | payment, settlement, gratuity | append-only entries |
| Notification | event, recipient | notification records |
| Workflow | event bus | scheduled jobs |
| Review | completed booking | `review.submitted` |
| Analytics | bookings, reviews, ledger | derived KPIs |
| Operator | audit, workflow, payment | protected runtime evidence |

Current honest decision: `KAJOLA_CONNECTED_RUNTIME_PARTIAL` until the external and production-durability gates above pass.

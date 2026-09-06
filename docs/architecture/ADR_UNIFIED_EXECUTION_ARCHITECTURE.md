# ADR: Unified Execution Architecture

- Status: Accepted
- Date: 2026-09-04

## Decision

Kajola will keep business truth in Workflow OS/domain services, coordination in Flow Orchestration OS, reliable delivery in Runtime OS, bounded intelligence in Agentic OS, permission/evidence decisions in Governance OS, and event-condition-action behavior in Automation.

The platform will use orchestration for critical booking/payment/settlement coordination and choreography for analytics, projections, secondary notifications and cache updates. All layers share actor, correlation, causation and event contracts.

## Rationale

The repository already contained booking guards, an event outbox, automation rules, cron scheduling, RBAC/RLS and audit records. Replacing them would create competing truth. The selected design wraps or extends them and introduces only the missing graph/coordination owner.

## Consequences

- Flow definitions are immutable after activation and instances remain version-pinned.
- The orchestrator cannot directly mutate booking or payment state.
- Runtime handlers are registry-controlled and idempotent.
- Flow completion requires Workflow OS Definition of Done.
- AI failure cannot break deterministic commerce.
- Legacy connected-mode functions require progressive adapters before the new path is production-authoritative.

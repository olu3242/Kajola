# Flow Failure and Recovery

Failures use: `TRANSIENT`, `PERMANENT`, `BUSINESS_REJECTION`, `POLICY_VIOLATION`, `TIMEOUT`, `DEPENDENCY_FAILURE`, `INTEGRATION_FAILURE`, `AGENT_FAILURE`, `HUMAN_REJECTION`, and `UNKNOWN`.

Recovery rules:

- Runtime retries transient delivery according to a named policy.
- Permanent and business failures require changed input or operator action.
- Duplicate events are acknowledged through the receipt store without a second transition.
- Stale instance versions fail with `FLOW_VERSION_CONFLICT`.
- Cancellation stops unfinished steps and retains evidence.
- Saga compensation executes registered compensators in reverse completion order.
- Agent unavailability becomes a governed human wait.
- Definition-of-Done failure leaves the end step waiting or failed with missing evidence.

Operator actions are available through `/api/operator/flows`: inspect, resume, retry a retryable step, cancel and compensate. All engine actions append flow audit entries.

Production runbook gap: worker heartbeat recovery, timer wake-up, dead-letter alerting and restart tests must be executed against linked Supabase infrastructure.

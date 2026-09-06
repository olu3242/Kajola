# Canonical OS Contracts

The executable definitions live in `packages/orchestration/src/contracts.ts` and are exported by `@kajola/orchestration`.

Canonical interfaces:

- `ActorReference` and `ResourceReference`
- `PlatformEvent<T>`
- `WorkflowTransitionRequest` and `WorkflowTransitionDecision`
- `ExecutionCommand` and `ExecutionResult`
- `AgentTaskRequest` and `AgentTaskResult`
- `GovernanceRequest` and `GovernanceDecision`
- `DefinitionOfDoneResult`

## Status separation

| Layer | Example |
|---|---|
| Booking business state | `confirmed` |
| Flow execution state | `WAITING_FOR_EVENT` |
| Runtime delivery state | `RUNNING` or retry policy outcome |
| Automation run state | `pending`, `completed`, `failed`, `dead` |

Adapters translate legacy snake-case local/Supabase records at boundaries. Provider callbacks are validated before becoming immutable platform events. Correlation IDs span a flow; causation IDs identify the preceding command/event.

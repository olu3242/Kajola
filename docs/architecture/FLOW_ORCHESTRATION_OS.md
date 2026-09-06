# Flow Orchestration OS

`@kajola/orchestration` provides:

- validated, immutable, versioned graph definitions;
- deterministic edge and conditional routing;
- parallel forks and `ALL`, `ANY`, or `N_OF_M` joins;
- event, timer, human and agent waits;
- registered system, external and automation handlers;
- governance checkpoints and durable evidence references;
- event receipt deduplication and optimistic instance writes;
- cancellation, explicit retry and backward compensation;
- nested flow execution and Definition-of-Done enforcement;
- correlation-backed audit reconstruction.

The local adapter is deterministic development infrastructure, not production durability certification. The migration supplies the production persistence and worker-claim model; a Supabase repository/worker adapter remains required to execute the golden flow in connected mode.

## Booking golden flow

```mermaid
flowchart TD
  S([Hold created]) --> H[Schedule hold expiry]
  H --> P{{Wait for payment or venue confirmation}}
  P --> D{Payment route}
  D -->|provider payment| C1[Confirmation checkpoint]
  D -->|pay at venue| C2[Confirmation checkpoint]
  C1 --> F[Parallel fork]
  C2 --> F
  F --> N1[Notify customer]
  F --> N2[Notify provider]
  F --> R[Schedule reminders]
  N1 --> J[All join]
  N2 --> J
  R --> J
  J --> W{{Wait for booking.completed}}
  W --> C3[Completion checkpoint]
  C3 --> F2[Parallel fork]
  F2 --> RR[Request review/rebook]
  F2 --> ST[Prepare settlement handoff]
  RR --> J2[All join]
  ST --> J2
  J2 --> E{Definition of Done}
  E -->|complete| X([End])
```

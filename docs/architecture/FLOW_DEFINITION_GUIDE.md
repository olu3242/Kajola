# Flow Definition Guide

Use `defineFlow` with a stable key and positive version. Publish a new version for every active-definition change.

```ts
const flow = defineFlow({
  key: 'domain.operation',
  version: 1,
  name: 'Domain operation',
  flowTypes: ['SEQUENTIAL', 'EVENT_DRIVEN'],
  requiredMilestones: ['authorized'],
  nodes: [
    { id: 'start', type: 'START' },
    { id: 'execute', type: 'SYSTEM_TASK', handler: 'domain.execute' },
    { id: 'wait', type: 'WAIT_EVENT', eventTypes: ['domain.authorized'] },
    { id: 'authorized', type: 'CHECKPOINT', metadata: { milestone: 'authorized' } },
    { id: 'end', type: 'END' },
  ],
  edges: [
    { from: 'start', to: 'execute' },
    { from: 'execute', to: 'wait' },
    { from: 'wait', to: 'authorized' },
    { from: 'authorized', to: 'end' },
  ],
});
```

Rules:

- Domain services validate business transitions.
- Handlers must be statically registered and declare runtime policy.
- Side-effecting handlers must be idempotent.
- Context should contain identifiers and evidence references, not secrets or full PSP payloads.
- Event-wait nodes list accepted normalized event types.
- Every terminal path passes Workflow OS Definition of Done.
- Compensation handlers reverse effects; they never delete audit history.

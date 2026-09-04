import { describe, expect, it } from 'vitest';
import {
  DefaultGovernanceAdapter,
  DeterministicRuntime,
  HandlerRegistry,
  InMemoryFlowRepository,
  MilestoneWorkflowAdapter,
  PersistentFlowOrchestrator,
  defineFlow,
  type FlowEvent,
} from '@kajola/orchestration';

function harness() {
  let sequence = 0;
  const repository = new InMemoryFlowRepository();
  const handlers = new HandlerRegistry();
  const calls: string[] = [];
  handlers.register('record', ({ input }: any) => { calls.push(String(input ?? 'record')); return { ok: true }; });
  handlers.register('route', () => ({ route: 'approved' }));
  handlers.register('left', () => { calls.push('left'); return 'left'; });
  handlers.register('right', () => { calls.push('right'); return 'right'; });
  const orchestrator = new PersistentFlowOrchestrator(
    repository,
    new DeterministicRuntime(handlers),
    new DefaultGovernanceAdapter(),
    undefined,
    new MilestoneWorkflowAdapter(),
    () => new Date('2026-09-04T12:00:00.000Z'),
    () => `id-${++sequence}`,
  );
  return { repository, handlers, calls, orchestrator };
}

describe('Flow Orchestration OS', () => {
  it('executes conditional, parallel, fan-in, event wait, checkpoint, and Definition of Done', async () => {
    const { orchestrator, calls, repository } = harness();
    const definition = defineFlow({
      key: 'certification.flow', version: 1, name: 'Certification flow',
      flowTypes: ['SEQUENTIAL', 'CONDITIONAL', 'PARALLEL', 'FAN_OUT', 'FAN_IN', 'EVENT_DRIVEN'],
      requiredMilestones: ['approved'],
      nodes: [
        { id: 'start', type: 'START' },
        { id: 'route', type: 'DECISION', handler: 'route' },
        { id: 'fork', type: 'PARALLEL_FORK' },
        { id: 'left', type: 'SYSTEM_TASK', handler: 'left' },
        { id: 'right', type: 'SYSTEM_TASK', handler: 'right' },
        { id: 'join', type: 'PARALLEL_JOIN', joinPolicy: 'ALL' },
        { id: 'wait', type: 'WAIT_EVENT', eventTypes: ['approval.received'] },
        { id: 'approved', type: 'CHECKPOINT', metadata: { milestone: 'approved' } },
        { id: 'end', type: 'END' },
      ],
      edges: [
        { from: 'start', to: 'route' },
        { from: 'route', to: 'fork', condition: { contextPath: 'route.route', equals: 'approved' } },
        { from: 'fork', to: 'left' }, { from: 'fork', to: 'right' },
        { from: 'left', to: 'join' }, { from: 'right', to: 'join' },
        { from: 'join', to: 'wait' }, { from: 'wait', to: 'approved' }, { from: 'approved', to: 'end' },
      ],
    });
    await orchestrator.registerFlow(definition);
    const started = await orchestrator.startFlow({ flowKey: definition.key, flowVersion: 1, workflowType: 'test', workflowId: 'object-1', tenantId: 'tenant-1', actor: { type: 'USER', id: 'user-1', tenantId: 'tenant-1' } });
    expect(started.status).toBe('WAITING_FOR_EVENT');
    expect(calls.sort()).toEqual(['left', 'right']);

    const event: FlowEvent = { eventId: 'event-1', eventType: 'approval.received', schemaVersion: 1, occurredAt: '2026-09-04T12:00:00.000Z', tenantId: 'tenant-1', correlationId: started.correlationId, payload: {} };
    const completed = await orchestrator.processEvent(started.id, event);
    expect(completed.status).toBe('COMPLETED');
    expect(completed.checkpoints.map((item) => item.key)).toContain('approved');
    expect((await repository.listAudit(started.id)).map((entry) => entry.action)).toContain('flow.completed');
    expect((await orchestrator.processEvent(started.id, event)).status).toBe('COMPLETED');
  });

  it('enforces tenant isolation for events and human task completion', async () => {
    const { orchestrator } = harness();
    await orchestrator.registerFlow(defineFlow({
      key: 'human.flow', version: 1, name: 'Human flow', flowTypes: ['HUMAN_IN_THE_LOOP'],
      nodes: [{ id: 'start', type: 'START' }, { id: 'review', type: 'HUMAN_TASK', routeTo: { type: 'USER', id: 'reviewer-1' } }, { id: 'end', type: 'END' }],
      edges: [{ from: 'start', to: 'review' }, { from: 'review', to: 'end' }],
    }));
    const flow = await orchestrator.startFlow({ flowKey: 'human.flow', flowVersion: 1, workflowType: 'review', workflowId: 'review-1', tenantId: 'tenant-1', actor: { type: 'USER', id: 'requester', tenantId: 'tenant-1' } });
    const task = flow.steps.find((step) => step.nodeId === 'review')!;
    await expect(orchestrator.completeTask({ flowInstanceId: flow.id, stepInstanceId: task.id, actor: { type: 'USER', id: 'reviewer-1', tenantId: 'tenant-2' } })).rejects.toThrow('FLOW_TENANT_MISMATCH');
    await expect(orchestrator.completeTask({ flowInstanceId: flow.id, stepInstanceId: task.id, actor: { type: 'USER', id: 'someone-else', tenantId: 'tenant-1' } })).rejects.toThrow('TASK_NOT_ASSIGNED_TO_ACTOR');
    const completed = await orchestrator.completeTask({ flowInstanceId: flow.id, stepInstanceId: task.id, actor: { type: 'USER', id: 'reviewer-1', tenantId: 'tenant-1' }, approved: true });
    expect(completed.status).toBe('COMPLETED');
  });

  it('retries transient runtime failures and deduplicates successful side effects', async () => {
    let attempts = 0;
    const repository = new InMemoryFlowRepository();
    const handlers = new HandlerRegistry();
    handlers.register('flaky', () => { attempts += 1; if (attempts === 1) throw new Error('temporary'); return { attempts }; });
    const orchestrator = new PersistentFlowOrchestrator(repository, new DeterministicRuntime(handlers));
    await orchestrator.registerFlow(defineFlow({
      key: 'retry.flow', version: 1, name: 'Retry flow', flowTypes: ['SEQUENTIAL'],
      nodes: [{ id: 'start', type: 'START' }, { id: 'flaky', type: 'SYSTEM_TASK', handler: 'flaky', retryPolicy: 'FAST_INTERNAL_TASK' }, { id: 'end', type: 'END' }],
      edges: [{ from: 'start', to: 'flaky' }, { from: 'flaky', to: 'end' }],
    }));
    const flow = await orchestrator.startFlow({ flowKey: 'retry.flow', flowVersion: 1, workflowType: 'test', workflowId: 'retry-1', tenantId: 'tenant-1', actor: { type: 'SYSTEM', id: 'test', tenantId: 'tenant-1' } });
    expect(flow.status).toBe('COMPLETED');
    expect(attempts).toBe(2);
  });

  it('rejects mutated active definitions and stale concurrent writes', async () => {
    const { repository, orchestrator } = harness();
    const first = defineFlow({ key: 'versioned.flow', version: 1, name: 'One', flowTypes: ['SEQUENTIAL'], nodes: [{ id: 'start', type: 'START' }, { id: 'end', type: 'END' }], edges: [{ from: 'start', to: 'end' }] });
    await orchestrator.registerFlow(first);
    await expect(orchestrator.registerFlow({ ...first, name: 'Mutated' })).rejects.toThrow('immutable');
    const instance = await orchestrator.startFlow({ flowKey: first.key, flowVersion: 1, workflowType: 'test', workflowId: 'v1', tenantId: null, actor: { type: 'SYSTEM', id: 'test' } });
    await expect(repository.saveInstance(instance, 1)).rejects.toThrow('FLOW_VERSION_CONFLICT');
  });

  it('persists scheduled waits and resumes them from repository state', async () => {
    const { orchestrator } = harness();
    await orchestrator.registerFlow(defineFlow({
      key: 'timer.flow', version: 1, name: 'Timer', flowTypes: ['SCHEDULED', 'LONG_RUNNING'],
      nodes: [{ id: 'start', type: 'START' }, { id: 'timer', type: 'WAIT_TIMER' }, { id: 'end', type: 'END' }],
      edges: [{ from: 'start', to: 'timer' }, { from: 'timer', to: 'end' }],
    }));
    const scheduled = await orchestrator.startFlow({ flowKey: 'timer.flow', flowVersion: 1, workflowType: 'timer', workflowId: 'timer-1', tenantId: 'tenant-1', actor: { type: 'SYSTEM', id: 'scheduler', tenantId: 'tenant-1' } });
    expect(scheduled.status).toBe('SCHEDULED');
    expect((await orchestrator.resumeFlow(scheduled.id)).status).toBe('COMPLETED');
  });

  it('falls back to a governed human task when no AI provider is configured', async () => {
    const { orchestrator } = harness();
    await orchestrator.registerFlow(defineFlow({
      key: 'agent.flow', version: 1, name: 'Agent fallback', flowTypes: ['AGENTIC', 'HUMAN_IN_THE_LOOP', 'HYBRID'],
      nodes: [{ id: 'start', type: 'START' }, { id: 'agent', type: 'AGENT_TASK', routeTo: { type: 'AGENT', id: 'support-agent' }, governancePolicy: 'agent.recommend' }, { id: 'end', type: 'END' }],
      edges: [{ from: 'start', to: 'agent' }, { from: 'agent', to: 'end' }],
    }));
    const flow = await orchestrator.startFlow({ flowKey: 'agent.flow', flowVersion: 1, workflowType: 'support', workflowId: 'case-1', tenantId: 'tenant-1', actor: { type: 'USER', id: 'user-1', tenantId: 'tenant-1' } });
    expect(flow.status).toBe('WAITING_FOR_HUMAN');
    expect(flow.steps.find((step) => step.nodeId === 'agent')?.status).toBe('WAITING_FOR_HUMAN');
  });

  it('runs backward compensation once for completed side effects', async () => {
    const repository = new InMemoryFlowRepository();
    const handlers = new HandlerRegistry();
    let compensated = 0;
    handlers.register('reserve', () => ({ reservation: 'r1' }));
    handlers.register('release', () => { compensated += 1; return { released: true }; });
    const orchestrator = new PersistentFlowOrchestrator(repository, new DeterministicRuntime(handlers));
    await orchestrator.registerFlow(defineFlow({
      key: 'saga.flow', version: 1, name: 'Saga', flowTypes: ['SAGA'],
      nodes: [{ id: 'start', type: 'START' }, { id: 'reserve', type: 'SYSTEM_TASK', handler: 'reserve', compensationHandler: 'release' }, { id: 'wait', type: 'WAIT_EVENT', eventTypes: ['continue'] }, { id: 'end', type: 'END' }],
      edges: [{ from: 'start', to: 'reserve' }, { from: 'reserve', to: 'wait' }, { from: 'wait', to: 'end' }],
    }));
    const flow = await orchestrator.startFlow({ flowKey: 'saga.flow', flowVersion: 1, workflowType: 'reservation', workflowId: 'r1', tenantId: 'tenant-1', actor: { type: 'SYSTEM', id: 'test', tenantId: 'tenant-1' } });
    const result = await orchestrator.compensateFlow(flow.id, { type: 'OPERATOR', id: 'operator-1' });
    expect(result.status).toBe('COMPENSATED');
    expect(compensated).toBe(1);
  });

  it('executes a version-pinned subflow before resuming its parent', async () => {
    const { orchestrator } = harness();
    await orchestrator.registerFlow(defineFlow({ key: 'child.flow', version: 1, name: 'Child', flowTypes: ['SEQUENTIAL'], nodes: [{ id: 'start', type: 'START' }, { id: 'end', type: 'END' }], edges: [{ from: 'start', to: 'end' }] }));
    await orchestrator.registerFlow(defineFlow({ key: 'parent.flow', version: 1, name: 'Parent', flowTypes: ['SUBFLOW'], nodes: [{ id: 'start', type: 'START' }, { id: 'child', type: 'SUBFLOW', metadata: { flowKey: 'child.flow', flowVersion: 1 } }, { id: 'end', type: 'END' }], edges: [{ from: 'start', to: 'child' }, { from: 'child', to: 'end' }] }));
    const parent = await orchestrator.startFlow({ flowKey: 'parent.flow', flowVersion: 1, workflowType: 'test', workflowId: 'parent-1', tenantId: 'tenant-1', actor: { type: 'SYSTEM', id: 'test', tenantId: 'tenant-1' } });
    expect(parent.status).toBe('COMPLETED');
  });
});

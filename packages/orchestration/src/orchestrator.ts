import type {
  AgentTaskRequest,
  AgentTaskResult,
  DefinitionOfDoneResult,
  ExecutionCommand,
  GovernanceDecision,
  GovernanceRequest,
} from './contracts';
import type {
  FailureType,
  FlowAuditEntry,
  FlowDefinition,
  FlowEdge,
  FlowEvent,
  FlowInstance,
  FlowNode,
  FlowStepInstance,
} from './model';
import { validateFlowDefinition } from './model';
import type { FlowRepository } from './repository';
import type { RuntimeAdapter } from './runtime';

export interface GovernanceAdapter {
  evaluate(request: GovernanceRequest): Promise<GovernanceDecision>;
}

export interface AgenticAdapter {
  status(): 'AVAILABLE' | 'PROVIDER_NOT_CONFIGURED' | 'DEGRADED';
  execute(request: AgentTaskRequest): Promise<AgentTaskResult>;
}

export interface WorkflowAdapter {
  evaluateDefinitionOfDone(instance: FlowInstance): Promise<DefinitionOfDoneResult>;
}

export interface StartFlowInput {
  flowKey: string;
  flowVersion: number;
  workflowType: string;
  workflowId: string;
  tenantId: string | null;
  actor: FlowInstance['actor'];
  context?: Record<string, unknown>;
  correlationId?: string;
  causationId?: string;
  instanceId?: string;
}

export interface CompleteTaskInput {
  flowInstanceId: string;
  stepInstanceId: string;
  actor: FlowInstance['actor'];
  output?: unknown;
  approved?: boolean;
  comment?: string;
}

export interface FlowOrchestrator {
  startFlow(input: StartFlowInput): Promise<FlowInstance>;
  resumeFlow(flowInstanceId: string): Promise<FlowInstance>;
  processEvent(flowInstanceId: string, event: FlowEvent): Promise<FlowInstance>;
  completeTask(input: CompleteTaskInput): Promise<FlowInstance>;
  completeWork(flowInstanceId: string, stepInstanceId: string, output?: unknown): Promise<FlowInstance>;
  failTask(flowInstanceId: string, stepInstanceId: string, failure: { type: FailureType; message: string; retryable: boolean }): Promise<FlowInstance>;
  cancelFlow(flowInstanceId: string, actor: FlowInstance['actor'], reason: string): Promise<FlowInstance>;
  retryStep(flowInstanceId: string, stepInstanceId: string, actor: FlowInstance['actor']): Promise<FlowInstance>;
  compensateFlow(flowInstanceId: string, actor: FlowInstance['actor']): Promise<FlowInstance>;
  resolveNext(flowInstanceId: string): Promise<FlowStepInstance[]>;
}

const systemActor = { type: 'SYSTEM' as const, id: 'flow-orchestrator' };

export class DefaultGovernanceAdapter implements GovernanceAdapter {
  async evaluate(request: GovernanceRequest): Promise<GovernanceDecision> {
    if (request.resource.tenantId && request.subject.type !== 'OPERATOR' && request.subject.tenantId && request.subject.tenantId !== request.resource.tenantId) {
      return { decision: 'DENY', reason: 'Tenant boundary violation', policyId: 'tenant-isolation' };
    }
    return { decision: 'ALLOW', reason: 'No additional approval required', policyId: request.action };
  }
}

export class DisabledAgenticAdapter implements AgenticAdapter {
  status() { return 'PROVIDER_NOT_CONFIGURED' as const; }
  async execute(request: AgentTaskRequest): Promise<AgentTaskResult> {
    return { taskId: request.taskId, status: 'REQUIRES_REVIEW', error: 'Agent provider is not configured' };
  }
}

export class MilestoneWorkflowAdapter implements WorkflowAdapter {
  async evaluateDefinitionOfDone(instance: FlowInstance): Promise<DefinitionOfDoneResult> {
    const definitionMilestones = Array.isArray(instance.context.requiredMilestones)
      ? instance.context.requiredMilestones.map(String)
      : [];
    const achieved = new Set(instance.checkpoints.map((checkpoint) => checkpoint.key));
    const missingMilestones = definitionMilestones.filter((milestone) => !achieved.has(milestone));
    return {
      status: missingMilestones.length ? 'INCOMPLETE' : 'COMPLETE',
      missingMilestones,
      missingEvidence: [],
      pendingApprovals: [],
      failedDependencies: [],
      openExceptions: [],
    };
  }
}

export class PersistentFlowOrchestrator implements FlowOrchestrator {
  constructor(
    readonly repository: FlowRepository,
    readonly runtime: RuntimeAdapter,
    readonly governance: GovernanceAdapter = new DefaultGovernanceAdapter(),
    readonly agentic: AgenticAdapter = new DisabledAgenticAdapter(),
    readonly workflow: WorkflowAdapter = new MilestoneWorkflowAdapter(),
    readonly now: () => Date = () => new Date(),
    readonly uuid: () => string = defaultUuid,
  ) {}

  async registerFlow(definition: FlowDefinition) {
    validateFlowDefinition(definition);
    await this.repository.registerDefinition(definition);
  }

  async startFlow(input: StartFlowInput): Promise<FlowInstance> {
    const definition = await this.requireDefinition(input.flowKey, input.flowVersion);
    const timestamp = this.now().toISOString();
    const startNode = definition.nodes.find((node) => node.type === 'START')!;
    const instance: FlowInstance = {
      id: input.instanceId ?? this.uuid(),
      flowKey: definition.key,
      flowVersion: definition.version,
      workflowType: input.workflowType,
      workflowId: input.workflowId,
      tenantId: input.tenantId,
      status: 'RUNNING',
      context: { ...input.context, requiredMilestones: definition.requiredMilestones ?? [] },
      correlationId: input.correlationId ?? this.uuid(),
      causationId: input.causationId,
      actor: input.actor,
      version: 1,
      steps: [this.makeStep(input.instanceId ?? '', startNode, 'COMPLETED', timestamp)],
      checkpoints: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    instance.steps[0].flowInstanceId = instance.id;
    instance.steps[0].completedAt = timestamp;
    await this.repository.saveInstance(instance);
    await this.audit(instance, 'flow.started', input.actor, { flowKey: definition.key, flowVersion: definition.version });
    this.activateOutgoing(instance, definition, startNode.id);
    return this.advance(instance, definition);
  }

  async resumeFlow(flowInstanceId: string): Promise<FlowInstance> {
    const instance = await this.requireInstance(flowInstanceId);
    this.assertMutable(instance);
    const definition = await this.requireDefinition(instance.flowKey, instance.flowVersion);
    const now = this.now().getTime();
    for (const step of instance.steps.filter((candidate) => candidate.status === 'SCHEDULED')) {
      const node = this.node(definition, step.nodeId);
      const dueAt = getPath(instance.context, node.timerAtRef ?? '') as string | undefined;
      if (!dueAt || new Date(dueAt).getTime() <= now) {
        step.status = 'READY';
        step.output = { timerFiredAt: this.now().toISOString() };
      }
    }
    await this.audit(instance, 'flow.resumed', systemActor, {});
    return this.advance(instance, definition);
  }

  async processEvent(flowInstanceId: string, event: FlowEvent): Promise<FlowInstance> {
    const instance = await this.requireInstance(flowInstanceId);
    this.assertTenant(instance, event.tenantId);
    if (await this.repository.hasReceipt(instance.id, event.eventId)) return instance;
    this.assertMutable(instance);
    const definition = await this.requireDefinition(instance.flowKey, instance.flowVersion);
    const waiting = instance.steps.filter((step) => step.status === 'WAITING_FOR_EVENT' && this.node(definition, step.nodeId).eventTypes?.includes(event.eventType));
    instance.context.lastEvent = event;
    instance.context[`event:${event.eventType}`] = event.payload;
    for (const step of waiting) {
      step.status = 'COMPLETED';
      step.output = event.payload;
      step.completedAt = this.now().toISOString();
      this.activateOutgoing(instance, definition, step.nodeId);
    }
    await this.audit(instance, waiting.length ? 'event.consumed' : 'event.ignored', event.actor ?? systemActor, { eventId: event.eventId, eventType: event.eventType, waitingSteps: waiting.map((step) => step.id) });
    const advanced = await this.advance(instance, definition);
    await this.repository.saveReceipt({ eventId: event.eventId, flowInstanceId: instance.id, receivedAt: this.now().toISOString() });
    await this.repository.resolveCallbackExpectation(instance.id, event.eventType, event.eventId);
    return advanced;
  }

  async completeTask(input: CompleteTaskInput): Promise<FlowInstance> {
    const instance = await this.requireInstance(input.flowInstanceId);
    this.assertMutable(instance);
    this.assertTenant(instance, input.actor.tenantId);
    const definition = await this.requireDefinition(instance.flowKey, instance.flowVersion);
    const step = this.step(instance, input.stepInstanceId);
    if (!['WAITING_FOR_HUMAN', 'WAITING_FOR_AGENT'].includes(step.status)) throw new Error('TASK_NOT_WAITING');
    if (step.assignedActor?.id && step.assignedActor.id !== input.actor.id && input.actor.type !== 'OPERATOR') throw new Error('TASK_NOT_ASSIGNED_TO_ACTOR');
    if (input.approved === false) {
      step.status = 'FAILED';
      step.error = { type: 'HUMAN_REJECTION', message: input.comment ?? 'Task rejected', retryable: false };
      instance.status = 'FAILED';
    } else {
      step.status = 'COMPLETED';
      step.output = input.output;
      step.completedAt = this.now().toISOString();
      this.activateOutgoing(instance, definition, step.nodeId);
    }
    await this.audit(instance, input.approved === false ? 'task.rejected' : 'task.completed', input.actor, { stepInstanceId: step.id, comment: input.comment }, step.id);
    return this.advance(instance, definition);
  }

  async completeWork(flowInstanceId: string, stepInstanceId: string, output?: unknown) {
    const instance = await this.requireInstance(flowInstanceId);
    this.assertMutable(instance);
    const definition = await this.requireDefinition(instance.flowKey, instance.flowVersion);
    const step = this.step(instance, stepInstanceId);
    if (!['READY', 'RUNNING'].includes(step.status)) throw new Error('WORK_NOT_CLAIMED');
    step.status = 'COMPLETED';
    step.output = output;
    instance.context[step.nodeId] = output;
    step.completedAt = this.now().toISOString();
    this.activateOutgoing(instance, definition, step.nodeId);
    await this.audit(instance, 'work.completed', systemActor, { stepInstanceId }, step.id);
    return this.advance(instance, definition);
  }

  async failTask(flowInstanceId: string, stepInstanceId: string, failure: { type: FailureType; message: string; retryable: boolean }) {
    const instance = await this.requireInstance(flowInstanceId);
    const step = this.step(instance, stepInstanceId);
    step.status = 'FAILED';
    step.error = failure;
    instance.status = 'FAILED';
    await this.audit(instance, 'task.failed', systemActor, { failure }, step.id);
    return this.persist(instance);
  }

  async cancelFlow(flowInstanceId: string, actor: FlowInstance['actor'], reason: string) {
    const instance = await this.requireInstance(flowInstanceId);
    this.assertMutable(instance);
    this.assertTenant(instance, actor.tenantId);
    instance.status = 'CANCELLED';
    instance.cancelledAt = this.now().toISOString();
    for (const step of instance.steps) if (!['COMPLETED', 'FAILED'].includes(step.status)) step.status = 'CANCELLED';
    await this.audit(instance, 'flow.cancelled', actor, { reason });
    return this.persist(instance);
  }

  async retryStep(flowInstanceId: string, stepInstanceId: string, actor: FlowInstance['actor']) {
    const instance = await this.requireInstance(flowInstanceId);
    this.assertTenant(instance, actor.tenantId);
    const definition = await this.requireDefinition(instance.flowKey, instance.flowVersion);
    const step = this.step(instance, stepInstanceId);
    if (step.status !== 'FAILED' || !step.error?.retryable) throw new Error('STEP_NOT_RETRYABLE');
    step.status = 'READY';
    step.error = undefined;
    step.attempt += 1;
    step.idempotencyKey = `${instance.id}:${step.nodeId}:${step.attempt}`;
    instance.status = 'RUNNING';
    await this.audit(instance, 'task.retry_requested', actor, { stepInstanceId }, step.id);
    return this.advance(instance, definition);
  }

  async compensateFlow(flowInstanceId: string, actor: FlowInstance['actor']) {
    const instance = await this.requireInstance(flowInstanceId);
    this.assertTenant(instance, actor.tenantId);
    const definition = await this.requireDefinition(instance.flowKey, instance.flowVersion);
    instance.status = 'COMPENSATING';
    const completed = [...instance.steps].reverse().filter((step) => step.status === 'COMPLETED');
    for (const step of completed) {
      const node = this.node(definition, step.nodeId);
      if (!node.compensationHandler) continue;
      const command = this.command(instance, step, node.compensationHandler, { context: instance.context, forwardOutput: step.output }, 'compensate');
      command.retryPolicy = node.retryPolicy;
      const result = await this.runtime.execute(command);
      if (result.status !== 'SUCCESS') {
        instance.status = 'FAILED';
        await this.audit(instance, 'compensation.failed', actor, { stepInstanceId: step.id, error: result.error }, step.id);
        return this.persist(instance);
      }
      await this.audit(instance, 'compensation.completed', actor, { stepInstanceId: step.id }, step.id);
    }
    instance.status = 'COMPENSATED';
    await this.audit(instance, 'flow.compensated', actor, {});
    return this.persist(instance);
  }

  async resolveNext(flowInstanceId: string) {
    const instance = await this.requireInstance(flowInstanceId);
    return instance.steps.filter((step) => step.status === 'READY');
  }

  private async advance(instance: FlowInstance, definition: FlowDefinition): Promise<FlowInstance> {
    let progressed = true;
    while (progressed && !['FAILED', 'CANCELLED', 'COMPENSATED', 'COMPLETED'].includes(instance.status)) {
      progressed = false;
      for (const step of instance.steps.filter((candidate) => candidate.status === 'READY')) {
        progressed = true;
        const node = this.node(definition, step.nodeId);
        const terminal = await this.executeNode(instance, definition, step, node);
        if (terminal) {
          if (!['FAILED', 'CANCELLED', 'COMPENSATED', 'COMPLETED'].includes(instance.status)) progressed = false;
          break;
        }
      }
    }
    if (!['FAILED', 'CANCELLED', 'COMPENSATED', 'COMPLETED'].includes(instance.status)) {
      const active = instance.steps.filter((step) => !['COMPLETED', 'FAILED', 'CANCELLED'].includes(step.status));
      instance.status = active.some((step) => step.status === 'WAITING_FOR_HUMAN') ? 'WAITING_FOR_HUMAN'
        : active.some((step) => step.status === 'WAITING_FOR_AGENT') ? 'WAITING_FOR_AGENT'
        : active.some((step) => step.status === 'WAITING_FOR_EVENT') ? 'WAITING_FOR_EVENT'
        : active.some((step) => step.status === 'SCHEDULED') ? 'SCHEDULED'
        : active.some((step) => step.status === 'READY') ? 'WAITING'
        : active.length ? 'RUNNING' : instance.status;
    }
    return this.persist(instance);
  }

  private async executeNode(instance: FlowInstance, definition: FlowDefinition, step: FlowStepInstance, node: FlowNode): Promise<boolean> {
    step.startedAt ??= this.now().toISOString();
    if (node.type === 'WAIT_EVENT') { step.status = 'WAITING_FOR_EVENT'; return false; }
    if (node.type === 'WAIT_TIMER') {
      if (step.output && typeof step.output === 'object' && 'timerFiredAt' in step.output) {
        return this.completeAutomaticNode(instance, definition, step, node);
      }
      step.status = 'SCHEDULED';
      step.scheduledAt = String(getPath(instance.context, node.timerAtRef ?? '') ?? this.now().toISOString());
      return false;
    }
    if (node.type === 'HUMAN_TASK') {
      step.status = 'WAITING_FOR_HUMAN';
      step.assignedActor = node.routeTo ? { type: node.routeTo.type === 'ROLE' ? 'ROLE' : 'USER', id: node.routeTo.id, tenantId: instance.tenantId } : undefined;
      await this.audit(instance, 'human_task.assigned', systemActor, { routeTo: node.routeTo }, step.id);
      await this.audit(instance, 'handoff.created', systemActor, { sourceActor: systemActor, targetActor: step.assignedActor, reason: node.name ?? node.id }, step.id);
      return false;
    }
    if (node.type === 'AGENT_TASK') {
      const gate = await this.governance.evaluate({ subject: { type: 'AGENT', id: node.routeTo?.id ?? 'unassigned-agent', tenantId: instance.tenantId }, action: node.governancePolicy ?? 'agent.execute', resource: { type: instance.workflowType, id: instance.workflowId, tenantId: instance.tenantId }, flowInstanceId: instance.id, context: instance.context });
      if (gate.decision !== 'ALLOW' || this.agentic.status() !== 'AVAILABLE') {
        step.status = 'WAITING_FOR_HUMAN';
        await this.audit(instance, 'agent_task.human_fallback', systemActor, { governance: gate, agentStatus: this.agentic.status() }, step.id);
        return false;
      }
      step.status = 'WAITING_FOR_AGENT';
      const result = await this.agentic.execute({ taskId: step.id, flowInstanceId: instance.id, agentKey: node.routeTo?.id ?? 'default', objective: String(node.metadata?.objective ?? node.name ?? node.id), contextRefs: [instance.workflowId], governancePolicy: node.governancePolicy ?? 'agent.execute', expectedSchema: String(node.metadata?.expectedSchema ?? 'unknown'), correlationId: instance.correlationId });
      if (result.status === 'REQUIRES_REVIEW') { step.status = 'WAITING_FOR_HUMAN'; step.output = result; return false; }
      if (result.status === 'FAILED') { step.status = 'FAILED'; step.error = { type: 'AGENT_FAILURE', message: result.error ?? 'Agent failed', retryable: true }; instance.status = 'FAILED'; return true; }
      step.output = result.output;
      return this.completeAutomaticNode(instance, definition, step, node);
    }
    if (node.type === 'PARALLEL_JOIN') {
      if (!this.joinSatisfied(instance, definition, node)) { step.status = 'WAITING'; return false; }
      return this.completeAutomaticNode(instance, definition, step, node);
    }
    if (node.type === 'CHECKPOINT') {
      const gate = await this.governance.evaluate({ subject: instance.actor, action: node.governancePolicy ?? 'flow.checkpoint', resource: { type: instance.workflowType, id: instance.workflowId, tenantId: instance.tenantId }, flowInstanceId: instance.id, context: instance.context });
      if (gate.decision === 'REVIEW_REQUIRED') { step.status = 'WAITING_FOR_HUMAN'; return false; }
      if (gate.decision === 'DENY') { step.status = 'FAILED'; step.error = { type: 'POLICY_VIOLATION', message: gate.reason, retryable: false }; instance.status = 'FAILED'; return true; }
      const key = String(node.metadata?.milestone ?? node.id);
      instance.checkpoints.push({ id: this.uuid(), flowInstanceId: instance.id, key, evidenceRefs: Array.isArray(node.metadata?.evidenceRefs) ? node.metadata.evidenceRefs.map(String) : [], createdAt: this.now().toISOString() });
      return this.completeAutomaticNode(instance, definition, step, node);
    }
    if (node.type === 'END') {
      const result = await this.workflow.evaluateDefinitionOfDone(instance);
      step.output = result;
      if (result.status !== 'COMPLETE') {
        step.status = result.status === 'BLOCKED' ? 'FAILED' : 'WAITING';
        instance.status = result.status === 'BLOCKED' ? 'FAILED' : 'WAITING';
        await this.audit(instance, 'definition_of_done.rejected', systemActor, { result }, step.id);
        return true;
      }
      step.status = 'COMPLETED';
      step.completedAt = this.now().toISOString();
      instance.status = 'COMPLETED';
      instance.completedAt = this.now().toISOString();
      await this.audit(instance, 'flow.completed', systemActor, { definitionOfDone: result }, step.id);
      return true;
    }
    if (['PARALLEL_FORK', 'START'].includes(node.type)) return this.completeAutomaticNode(instance, definition, step, node);
    if (node.type === 'SUBFLOW') {
      const key = String(node.metadata?.flowKey ?? '');
      const version = Number(node.metadata?.flowVersion ?? 1);
      const child = await this.startFlow({ flowKey: key, flowVersion: version, workflowType: instance.workflowType, workflowId: instance.workflowId, tenantId: instance.tenantId, actor: instance.actor, context: { ...instance.context, parentFlowInstanceId: instance.id }, correlationId: instance.correlationId, causationId: step.id });
      step.output = { childFlowInstanceId: child.id };
      if (child.status !== 'COMPLETED') { step.status = 'WAITING'; return false; }
      return this.completeAutomaticNode(instance, definition, step, node);
    }

    step.status = 'RUNNING';
    const command = this.command(instance, step, node.handler!, { context: instance.context, input: step.input });
    command.retryPolicy = node.retryPolicy;
    command.timeoutPolicy = node.timeoutPolicy;
    const result = await this.runtime.execute(command);
    if (result.status === 'DEFERRED') {
      step.status = 'READY';
      instance.status = 'WAITING';
      await this.audit(instance, 'work.deferred', systemActor, { handler: node.handler }, step.id);
      return true;
    }
    if (result.status !== 'SUCCESS') {
      step.status = result.status === 'TIMED_OUT' ? 'TIMED_OUT' : 'FAILED';
      step.error = { type: result.status === 'TIMED_OUT' ? 'TIMEOUT' : 'DEPENDENCY_FAILURE', message: result.error?.message ?? 'Execution failed', retryable: result.error?.retryable ?? false };
      instance.status = 'FAILED';
      await this.audit(instance, 'task.failed', systemActor, { error: step.error }, step.id);
      return true;
    }
    step.output = result.output;
    instance.context[node.id] = result.output;
    return this.completeAutomaticNode(instance, definition, step, node);
  }

  private async completeAutomaticNode(instance: FlowInstance, definition: FlowDefinition, step: FlowStepInstance, node: FlowNode) {
    step.status = 'COMPLETED';
    step.completedAt = this.now().toISOString();
    await this.audit(instance, 'step.completed', systemActor, { nodeId: node.id, nodeType: node.type }, step.id);
    this.activateOutgoing(instance, definition, node.id);
    return false;
  }

  private activateOutgoing(instance: FlowInstance, definition: FlowDefinition, nodeId: string) {
    const edges = definition.edges
      .filter((edge) => edge.from === nodeId && this.edgeMatches(instance, edge))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    for (const edge of edges) {
      if (instance.steps.some((step) => step.nodeId === edge.to)) continue;
      const target = this.node(definition, edge.to);
      if (target.type === 'PARALLEL_JOIN' && !this.joinSatisfied(instance, definition, target)) continue;
      instance.steps.push(this.makeStep(instance.id, target, 'READY', this.now().toISOString()));
    }
    // A join may have been withheld until its last inbound node completed.
    for (const join of definition.nodes.filter((node) => node.type === 'PARALLEL_JOIN')) {
      if (!instance.steps.some((step) => step.nodeId === join.id) && this.joinSatisfied(instance, definition, join)) {
        instance.steps.push(this.makeStep(instance.id, join, 'READY', this.now().toISOString()));
      }
    }
  }

  private joinSatisfied(instance: FlowInstance, definition: FlowDefinition, node: FlowNode) {
    const inbound = definition.edges.filter((edge) => edge.to === node.id).map((edge) => edge.from);
    const completed = inbound.filter((id) => instance.steps.some((step) => step.nodeId === id && step.status === 'COMPLETED')).length;
    if (node.joinPolicy === 'ANY') return completed >= 1;
    if (node.joinPolicy === 'N_OF_M') return completed >= (node.joinCount ?? inbound.length);
    return inbound.length > 0 && completed === inbound.length;
  }

  private edgeMatches(instance: FlowInstance, edge: FlowEdge) {
    return !edge.condition || getPath(instance.context, edge.condition.contextPath) === edge.condition.equals;
  }

  private makeStep(flowInstanceId: string, node: FlowNode, status: FlowStepInstance['status'], timestamp: string): FlowStepInstance {
    return { id: this.uuid(), flowInstanceId, nodeId: node.id, status, attempt: 1, idempotencyKey: `${flowInstanceId}:${node.id}:1`, startedAt: status === 'COMPLETED' ? timestamp : undefined };
  }

  private command(instance: FlowInstance, step: FlowStepInstance, handler: string, payload: unknown, suffix = 'execute'): ExecutionCommand {
    return { id: this.uuid(), flowInstanceId: instance.id, stepInstanceId: step.id, handler, payload, idempotencyKey: `${step.idempotencyKey}:${suffix}`, correlationId: instance.correlationId, causationId: instance.causationId };
  }

  private async persist(instance: FlowInstance) {
    const expectedVersion = instance.version;
    instance.version += 1;
    instance.updatedAt = this.now().toISOString();
    await this.repository.saveInstance(instance, expectedVersion);
    return instance;
  }

  private async audit(instance: FlowInstance, action: string, actor: FlowInstance['actor'], details: Record<string, unknown>, stepInstanceId?: string) {
    const entry: FlowAuditEntry = { id: this.uuid(), flowInstanceId: instance.id, tenantId: instance.tenantId, action, actor, correlationId: instance.correlationId, causationId: instance.causationId, stepInstanceId, details, occurredAt: this.now().toISOString() };
    await this.repository.appendAudit(entry);
  }

  private async requireDefinition(key: string, version: number) {
    const definition = await this.repository.getDefinition(key, version);
    if (!definition) throw new Error(`FLOW_DEFINITION_NOT_FOUND:${key}@${version}`);
    return definition;
  }

  private async requireInstance(id: string) {
    const instance = await this.repository.getInstance(id);
    if (!instance) throw new Error(`FLOW_INSTANCE_NOT_FOUND:${id}`);
    return instance;
  }

  private node(definition: FlowDefinition, id: string) {
    const node = definition.nodes.find((candidate) => candidate.id === id);
    if (!node) throw new Error(`FLOW_NODE_NOT_FOUND:${id}`);
    return node;
  }

  private step(instance: FlowInstance, id: string) {
    const step = instance.steps.find((candidate) => candidate.id === id);
    if (!step) throw new Error(`FLOW_STEP_NOT_FOUND:${id}`);
    return step;
  }

  private assertMutable(instance: FlowInstance) {
    if (['COMPLETED', 'CANCELLED', 'COMPENSATED'].includes(instance.status)) throw new Error(`FLOW_NOT_MUTABLE:${instance.status}`);
  }

  private assertTenant(instance: FlowInstance, tenantId?: string | null) {
    if (tenantId !== undefined && tenantId !== null && instance.tenantId !== tenantId) throw new Error('FLOW_TENANT_MISMATCH');
  }
}

function getPath(value: unknown, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((current, part) => current && typeof current === 'object' ? (current as Record<string, unknown>)[part] : undefined, value);
}

function defaultUuid() {
  const cryptoValue = globalThis.crypto;
  if (cryptoValue?.randomUUID) return cryptoValue.randomUUID();
  return `flow-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

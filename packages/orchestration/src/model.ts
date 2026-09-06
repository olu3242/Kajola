import type { ActorReference, PlatformEvent } from './contracts';

export type FlowType =
  | 'SEQUENTIAL'
  | 'CONDITIONAL'
  | 'PARALLEL'
  | 'FAN_OUT'
  | 'FAN_IN'
  | 'EVENT_DRIVEN'
  | 'HUMAN_IN_THE_LOOP'
  | 'AGENTIC'
  | 'HYBRID'
  | 'SCHEDULED'
  | 'LONG_RUNNING'
  | 'SAGA'
  | 'SUBFLOW'
  | 'STATE_MACHINE'
  | 'RULE_DRIVEN'
  | 'DYNAMIC_ROUTING'
  | 'CHOREOGRAPHY_INTEROPERABILITY';

export type FlowNodeType =
  | 'START'
  | 'END'
  | 'SYSTEM_TASK'
  | 'HUMAN_TASK'
  | 'AGENT_TASK'
  | 'AUTOMATION_TASK'
  | 'EXTERNAL_TASK'
  | 'DECISION'
  | 'PARALLEL_FORK'
  | 'PARALLEL_JOIN'
  | 'WAIT_EVENT'
  | 'WAIT_TIMER'
  | 'SUBFLOW'
  | 'CHECKPOINT'
  | 'COMPENSATION';

export type FlowExecutionStatus =
  | 'PENDING'
  | 'READY'
  | 'RUNNING'
  | 'WAITING'
  | 'WAITING_FOR_EVENT'
  | 'WAITING_FOR_HUMAN'
  | 'WAITING_FOR_AGENT'
  | 'SCHEDULED'
  | 'COMPLETED'
  | 'FAILED'
  | 'TIMED_OUT'
  | 'ESCALATED'
  | 'COMPENSATING'
  | 'COMPENSATED'
  | 'CANCELLED';

export type FailureType =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'BUSINESS_REJECTION'
  | 'POLICY_VIOLATION'
  | 'TIMEOUT'
  | 'DEPENDENCY_FAILURE'
  | 'INTEGRATION_FAILURE'
  | 'AGENT_FAILURE'
  | 'HUMAN_REJECTION'
  | 'UNKNOWN';

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  name?: string;
  handler?: string;
  compensationHandler?: string;
  eventTypes?: string[];
  timerAtRef?: string;
  governancePolicy?: string;
  retryPolicy?: string;
  timeoutPolicy?: string;
  routeTo?: { type: 'USER' | 'ROLE' | 'TEAM' | 'SYSTEM' | 'AGENT' | 'SERVICE' | 'QUEUE' | 'AUTOMATION' | 'INTEGRATION' | 'SUBFLOW'; id: string };
  joinPolicy?: 'ALL' | 'ANY' | 'N_OF_M' | 'CUSTOM_POLICY';
  joinCount?: number;
  metadata?: Record<string, unknown>;
}

export interface FlowEdge {
  from: string;
  to: string;
  label?: string;
  condition?: { contextPath: string; equals: unknown };
  priority?: number;
}

export interface FlowDefinition {
  key: string;
  version: number;
  name: string;
  flowTypes: FlowType[];
  trigger?: { event: string };
  nodes: FlowNode[];
  edges: FlowEdge[];
  requiredMilestones?: string[];
  active?: boolean;
}

export type FlowDefinitionVersion = Pick<FlowDefinition, 'key' | 'version' | 'active'>;

export interface FlowStepInstance {
  id: string;
  flowInstanceId: string;
  nodeId: string;
  status: FlowExecutionStatus;
  attempt: number;
  idempotencyKey: string;
  input?: unknown;
  output?: unknown;
  error?: { type: FailureType; message: string; retryable: boolean };
  startedAt?: string;
  scheduledAt?: string;
  completedAt?: string;
  assignedActor?: ActorReference;
}

export interface FlowCheckpoint {
  id: string;
  flowInstanceId: string;
  key: string;
  evidenceRefs: string[];
  createdAt: string;
}

export interface FlowTask {
  id: string;
  flowInstanceId: string;
  stepInstanceId: string;
  type: 'SYSTEM' | 'HUMAN' | 'AGENT' | 'AUTOMATION' | 'EXTERNAL' | 'SUBFLOW';
  status: FlowExecutionStatus;
  assignedActor?: ActorReference;
  dueAt?: string;
  result?: unknown;
}

export interface FlowDecision {
  stepInstanceId: string;
  route: string;
  ruleVersion?: string;
  decidedAt: string;
}

export interface FlowTimer {
  id: string;
  flowInstanceId: string;
  stepInstanceId: string;
  wakeAt: string;
  status: 'SCHEDULED' | 'CLAIMED' | 'FIRED' | 'CANCELLED' | 'FAILED';
  idempotencyKey: string;
}

export interface FlowCallbackExpectation {
  id: string;
  flowInstanceId: string;
  stepInstanceId?: string;
  callbackType: string;
  provider: string;
  providerReference: string;
  correlationId: string;
  status: 'WAITING' | 'RECEIVED' | 'EXPIRED' | 'CANCELLED';
  expiresAt?: string;
  receivedEventId?: string;
}

export interface FlowDeadLetter {
  id: string;
  flowInstanceId?: string;
  stepInstanceId?: string;
  failureClass: string;
  errorMessage: string;
  payload: unknown;
  attempts: number;
  status: 'OPEN' | 'REPLAYING' | 'RESOLVED' | 'DISCARDED';
  createdAt: string;
}

export interface FlowCompensation {
  stepInstanceId: string;
  handler: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'MANUAL_INTERVENTION';
  idempotencyKey: string;
}

export interface FlowFailure {
  type: FailureType;
  message: string;
  retryable: boolean;
  stepInstanceId?: string;
  occurredAt: string;
}

export interface FlowHandoff {
  id: string;
  flowInstanceId: string;
  sourceActor: ActorReference;
  targetActor: ActorReference;
  reason: string;
  status: 'PENDING' | 'CLAIMED' | 'COMPLETED' | 'REJECTED' | 'ESCALATED';
  createdAt: string;
  completedAt?: string;
}

export interface FlowCorrelation {
  flowInstanceId: string;
  correlationId: string;
  causationId?: string;
  workflowId: string;
}

export interface FlowInstance {
  id: string;
  flowKey: string;
  flowVersion: number;
  workflowType: string;
  workflowId: string;
  tenantId: string | null;
  status: FlowExecutionStatus;
  context: Record<string, unknown>;
  correlationId: string;
  causationId?: string;
  actor: ActorReference;
  version: number;
  steps: FlowStepInstance[];
  checkpoints: FlowCheckpoint[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;
}

export interface FlowAuditEntry {
  id: string;
  flowInstanceId: string;
  tenantId: string | null;
  action: string;
  actor: ActorReference;
  correlationId: string;
  causationId?: string;
  stepInstanceId?: string;
  details: Record<string, unknown>;
  occurredAt: string;
}

export interface FlowReceipt {
  eventId: string;
  flowInstanceId: string;
  receivedAt: string;
}

export type FlowEvent = PlatformEvent<Record<string, unknown>>;

export function defineFlow(definition: FlowDefinition): FlowDefinition {
  validateFlowDefinition(definition);
  return Object.freeze({
    ...definition,
    nodes: Object.freeze(definition.nodes.map((node) => Object.freeze({ ...node }))) as unknown as FlowNode[],
    edges: Object.freeze(definition.edges.map((edge) => Object.freeze({ ...edge }))) as unknown as FlowEdge[],
  });
}

export function validateFlowDefinition(definition: FlowDefinition): void {
  if (!definition.key || !Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error('Flow key and positive integer version are required');
  }
  const ids = new Set(definition.nodes.map((node) => node.id));
  if (ids.size !== definition.nodes.length) throw new Error('Flow node IDs must be unique');
  if (definition.nodes.filter((node) => node.type === 'START').length !== 1) throw new Error('A flow requires exactly one START node');
  if (!definition.nodes.some((node) => node.type === 'END')) throw new Error('A flow requires at least one END node');
  for (const edge of definition.edges) {
    if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`Unknown edge endpoint: ${edge.from} -> ${edge.to}`);
  }
  for (const node of definition.nodes) {
    if (['SYSTEM_TASK', 'AUTOMATION_TASK', 'EXTERNAL_TASK', 'DECISION', 'COMPENSATION'].includes(node.type) && !node.handler) {
      throw new Error(`${node.type} node ${node.id} requires a registered handler`);
    }
    if (node.type === 'WAIT_EVENT' && !node.eventTypes?.length) throw new Error(`WAIT_EVENT node ${node.id} requires eventTypes`);
  }
}

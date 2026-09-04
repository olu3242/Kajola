export type ActorType =
  | 'USER'
  | 'ROLE'
  | 'SYSTEM'
  | 'AGENT'
  | 'AUTOMATION'
  | 'SERVICE'
  | 'INTEGRATION'
  | 'OPERATOR';

export interface ActorReference {
  type: ActorType;
  id: string;
  tenantId?: string | null;
  roles?: string[];
}

export interface ResourceReference {
  type: string;
  id: string;
  tenantId?: string | null;
}

export interface PlatformEvent<T = unknown> {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  tenantId?: string | null;
  workflowId?: string;
  flowInstanceId?: string;
  stepInstanceId?: string;
  correlationId: string;
  causationId?: string;
  actor?: ActorReference;
  payload: T;
}

export interface WorkflowTransitionRequest {
  workflowType: string;
  workflowId: string;
  currentState: string;
  requestedTransition: string;
  actor: ActorReference;
  context: Record<string, unknown>;
}

export interface WorkflowTransitionDecision {
  allowed: boolean;
  targetState?: string;
  requiredMilestones?: string[];
  requiredApprovals?: string[];
  orchestrationFlow?: string;
  reason?: string;
}

export interface ExecutionCommand {
  id: string;
  flowInstanceId: string;
  stepInstanceId: string;
  handler: string;
  payload: unknown;
  idempotencyKey: string;
  correlationId: string;
  causationId?: string;
  timeoutPolicy?: string;
  retryPolicy?: string;
}

export interface ExecutionResult {
  commandId: string;
  status: 'SUCCESS' | 'FAILED' | 'TIMED_OUT' | 'DEFERRED';
  output?: unknown;
  error?: { code: string; message: string; retryable?: boolean };
  correlationId: string;
  causationId: string;
}

export interface AgentTaskRequest {
  taskId: string;
  flowInstanceId: string;
  agentKey: string;
  objective: string;
  contextRefs: string[];
  evidenceRefs?: string[];
  governancePolicy: string;
  expectedSchema: string;
  correlationId: string;
}

export interface AgentTaskResult {
  taskId: string;
  status: 'COMPLETED' | 'REQUIRES_REVIEW' | 'FAILED';
  output?: unknown;
  confidence?: number;
  evidenceRefs?: string[];
  toolCalls?: unknown[];
  provider?: string;
  model?: string;
  error?: string;
}

export interface GovernanceRequest {
  subject: ActorReference;
  action: string;
  resource: ResourceReference;
  flowInstanceId?: string;
  evidenceRefs?: string[];
  context?: Record<string, unknown>;
}

export interface GovernanceDecision {
  decision: 'ALLOW' | 'DENY' | 'REVIEW_REQUIRED';
  policyId?: string;
  reason: string;
  requiredApprovals?: string[];
  requiredEvidence?: string[];
}

export interface DefinitionOfDoneResult {
  status: 'COMPLETE' | 'INCOMPLETE' | 'BLOCKED';
  missingMilestones: string[];
  missingEvidence: string[];
  pendingApprovals: string[];
  failedDependencies: string[];
  openExceptions: string[];
}

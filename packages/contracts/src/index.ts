/**
 * Kajola Execution OS — Shared Contracts
 * All layers (Runtime OS, Workflow OS, Agentic OS) reference these types.
 */

// ── Identifier prefixes ──────────────────────────────────────────────────────
export type ActorType = 'human' | 'agent' | 'workflow' | 'system' | 'webhook';
export type Channel   = 'web' | 'mobile' | 'api' | 'agent' | 'workflow' | 'webhook';
export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4';

// ── Operation context ────────────────────────────────────────────────────────
export type OperationContext = {
  operationId:      string;   // opr_<ulid>
  correlationId:    string;   // cor_<ulid>
  causationId?:     string;
  tenantId:         string;
  actor: {
    actorType:     ActorType;
    actorId:       string;
    userId?:       string;
    agentId?:      string;
    workflowRunId?: string;
  };
  role:        string;
  permissions: string[];
  channel:     Channel;
  idempotencyKey: string;
  requestTimestamp: string;
  traceId:     string;
};

// ── Operation result ─────────────────────────────────────────────────────────
export type OperationResult<T = unknown> = {
  success:     boolean;
  data?:       T;
  error?:      OperationError;
  operationId: string;
  idempotent?: boolean;
};

export type OperationError = {
  code:    string;
  message: string;
  status:  number;
  details?: unknown;
};

// ── Events ───────────────────────────────────────────────────────────────────
export type DomainEvent = {
  id:           string;   // evt_<ulid>
  name:         string;   // e.g. booking.slot.held.v1
  version:      number;
  tenantId:     string;
  aggregateId:  string;
  aggregateType: string;
  payload:      Record<string, unknown>;
  metadata: {
    operationId:   string;
    correlationId: string;
    causationId?:  string;
    actorId:       string;
    traceId:       string;
  };
  occurredAt: string;
};

// ── Audit ────────────────────────────────────────────────────────────────────
export type AuditRecord = {
  id:           string;   // aud_<ulid>
  operationId:  string;
  tenantId:     string;
  actorId:      string;
  actorType:    ActorType;
  action:       string;
  resource:     string;
  resourceId?:  string;
  outcome:      'success' | 'failure' | 'rejected';
  riskLevel:    RiskLevel;
  metadata?:    Record<string, unknown>;
  occurredAt:   string;
};

// ── Policy decision ───────────────────────────────────────────────────────────
export type PolicyDecision = {
  id:          string;    // pdc_<ulid>
  operationId: string;
  policy:      string;
  allowed:     boolean;
  reason?:     string;
  decidedAt:   string;
};

// ── Approval ─────────────────────────────────────────────────────────────────
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export type ApprovalRequest = {
  id:          string;    // apr_<ulid>
  operationId: string;
  tenantId:    string;
  requestedBy: string;
  action:      string;
  payload:     Record<string, unknown>;
  riskLevel:   RiskLevel;
  status:      ApprovalStatus;
  decidedBy?:  string;
  decidedAt?:  string;
  reason?:     string;
  expiresAt:   string;
  createdAt:   string;
};

// ── Workflow ──────────────────────────────────────────────────────────────────
export type WorkflowStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'compensating';
export type StepStatus     = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'compensated';

export type WorkflowDefinition = {
  id:          string;    // wfd_<id>
  name:        string;    // wf_<domain>_<outcome>_v<n>
  version:     number;
  description: string;
  steps:       WorkflowStepDefinition[];
  triggers?:   string[];
  retryPolicy?: RetryPolicy;
  timeoutMs?:  number;
  active:      boolean;
};

export type WorkflowStepDefinition = {
  id:        string;
  name:      string;
  type:      'command' | 'notification' | 'timer' | 'approval' | 'agent' | 'condition' | 'parallel';
  command?:  string;
  payload?:  Record<string, unknown> | ((ctx: WorkflowRunContext) => Record<string, unknown>);
  condition?: (ctx: WorkflowRunContext) => boolean;
  branches?:  WorkflowStepDefinition[][];
  timerMs?:  number | ((ctx: WorkflowRunContext) => number);
  approvalPolicy?: string;
  agentId?:  string;
  retryPolicy?: RetryPolicy;
  compensate?: string;
  onFailure?: 'stop' | 'skip' | 'compensate';
};

export type RetryPolicy = {
  maxAttempts:   number;
  backoffMs:     number;
  backoffFactor: number;
  maxBackoffMs:  number;
};

export type WorkflowRunContext = {
  runId:         string;   // wfr_<ulid>
  workflowId:    string;
  version:       number;
  tenantId:      string;
  correlationId: string;
  triggeredBy:   string;
  input:         Record<string, unknown>;
  state:         Record<string, unknown>;
  status:        WorkflowStatus;
  startedAt:     string;
};

// ── Agent ─────────────────────────────────────────────────────────────────────
export type AgentDefinition = {
  id:               string;    // agt_<domain>_<purpose>_v<n>
  name:             string;
  version:          number;
  purpose:          string;
  tenantScope:      'platform' | 'tenant';
  allowedTools:     string[];
  prohibitedActions: string[];
  inputSchema:      Record<string, unknown>;
  outputSchema:     Record<string, unknown>;
  memoryPolicy:     string;
  riskLimit:        'R0' | 'R1' | 'R2';
  approvalPolicy:   string;
  modelPolicy:      string;
  maxSteps:         number;
  timeoutMs:        number;
  active:           boolean;
};

export type ToolDefinition = {
  name:       string;    // tool.<domain>.<verb>
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  riskLevel:  RiskLevel;
  allowedRoles: string[];
};

export type ToolInvocation = {
  id:        string;    // tlc_<ulid>
  agentRunId: string;
  toolName:  string;
  input:     Record<string, unknown>;
  output?:   Record<string, unknown>;
  error?:    string;
  startedAt: string;
  endedAt?:  string;
};

// ── Telemetry ─────────────────────────────────────────────────────────────────
export type TelemetryEvent = {
  name:      string;
  value:     number;
  unit:      'count' | 'ms' | 'bytes' | 'percent';
  tags:      Record<string, string>;
  timestamp: string;
};

// ── Dead letter ───────────────────────────────────────────────────────────────
export type DeadLetterItem = {
  id:          string;    // dlq_<ulid>
  tenantId:    string;
  source:      'workflow' | 'agent' | 'operation';
  sourceId:    string;
  payload:     Record<string, unknown>;
  error:       string;
  attempts:    number;
  lastAttemptAt: string;
  replayedAt?: string;
  replayedBy?: string;
  createdAt:   string;
};

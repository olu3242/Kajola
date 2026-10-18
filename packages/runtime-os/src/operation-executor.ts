import type { OperationContext, OperationResult, RiskLevel } from '@kajola/contracts';
import { newOperationId, newCorrelationId, newTraceId } from './ids';
import type { IdempotencyService } from './idempotency-service';
import type { AuditService }       from './audit-service';
import type { TelemetryService }   from './telemetry-service';
import type { EventOutbox }        from './event-outbox';
import type { AuthorizationService } from './authorization-service';
import type { ApprovalService }    from './approval-service';

export type CommandHandler<TInput = unknown, TOutput = unknown> = (
  input: TInput,
  ctx: OperationContext,
  services: ExecutorServices,
) => Promise<TOutput>;

export type ExecutorServices = {
  idempotency: IdempotencyService;
  audit:       AuditService;
  telemetry:   TelemetryService;
  events:      EventOutbox;
  approval:    ApprovalService;
};

export type ExecuteCommandInput<TInput = unknown> = {
  command:        string;
  input:          TInput;
  actorId:        string;
  actorType:      OperationContext['actor']['actorType'];
  role:           string;
  tenantId:       string;
  permissions?:   string[];
  channel?:       OperationContext['channel'];
  idempotencyKey: string;
  correlationId?: string;
  causationId?:   string;
  workflowRunId?: string;
  agentId?:       string;
};

export class OperationExecutor {
  private handlers = new Map<string, CommandHandler>();

  constructor(
    private auth:    AuthorizationService,
    private services: ExecutorServices,
  ) {}

  register<TInput, TOutput>(command: string, handler: CommandHandler<TInput, TOutput>) {
    this.handlers.set(command, handler as CommandHandler);
    return this;
  }

  async execute<TOutput = unknown>(req: ExecuteCommandInput): Promise<OperationResult<TOutput>> {
    const startMs  = Date.now();
    const operationId = newOperationId();
    const correlationId = req.correlationId ?? newCorrelationId();
    const traceId   = newTraceId();

    const ctx: OperationContext = {
      operationId,
      correlationId,
      causationId:  req.causationId,
      tenantId:     req.tenantId,
      actor: {
        actorType:     req.actorType,
        actorId:       req.actorId,
        userId:        req.actorType === 'human' ? req.actorId : undefined,
        agentId:       req.actorType === 'agent' ? req.agentId : undefined,
        workflowRunId: req.actorType === 'workflow' ? req.workflowRunId : undefined,
      },
      role:        req.role,
      permissions: req.permissions ?? [],
      channel:     req.channel ?? 'api',
      idempotencyKey: req.idempotencyKey,
      requestTimestamp: new Date().toISOString(),
      traceId,
    };

    // ── 1. Idempotency check ─────────────────────────────────────────────────
    const cached = await this.services.idempotency.check(req.idempotencyKey);
    if (cached) {
      return { ...cached, idempotent: true } as OperationResult<TOutput>;
    }

    // ── 2. R3/R4 agent interception (before actorType auth — agents create approval requests) ─────
    const commandRisk: RiskLevel = this.auth.getRiskLevel(req.command);
    if (this.auth.requiresApproval(commandRisk) && req.actorType === 'agent') {
      const aprReq = await this.services.approval.request(ctx, req.command, req.input as Record<string, unknown>, commandRisk);
      const result: OperationResult<TOutput> = {
        success: false,
        operationId,
        error: {
          code:    'APPROVAL_REQUIRED',
          message: `Command '${req.command}' requires human approval (risk ${commandRisk}). Request: ${aprReq.id}`,
          status:  202,
          details: { approvalRequestId: aprReq.id },
        },
      };
      await this.services.audit.record(ctx, req.command, 'operation', operationId, 'rejected', commandRisk, { approvalRequestId: aprReq.id });
      await this.services.telemetry.count('operation.approval_required', { command: req.command, riskLevel: commandRisk });
      return result;
    }

    // ── 3. Authorization ─────────────────────────────────────────────────────
    const authResult = this.auth.authorize(req.command, ctx);
    if (!authResult.allowed) {
      const result: OperationResult<TOutput> = {
        success: false,
        operationId,
        error: { code: 'FORBIDDEN', message: authResult.reason ?? 'Forbidden', status: 403 },
      };
      await this.services.audit.record(ctx, req.command, 'operation', operationId, 'rejected', authResult.riskLevel);
      await this.services.telemetry.count('operation.rejected', { command: req.command, role: req.role });
      return result;
    }

    const riskLevel: RiskLevel = authResult.riskLevel;

    // ── 4. Find handler ──────────────────────────────────────────────────────
    const handler = this.handlers.get(req.command);
    if (!handler) {
      const result: OperationResult<TOutput> = {
        success: false,
        operationId,
        error: { code: 'NOT_IMPLEMENTED', message: `No handler for command: ${req.command}`, status: 501 },
      };
      return result;
    }

    // ── 5. Execute ───────────────────────────────────────────────────────────
    let result: OperationResult<TOutput>;
    try {
      const data = await handler(req.input, ctx, this.services) as TOutput;
      result = { success: true, data, operationId };
      await this.services.idempotency.store(req.idempotencyKey, result);
      await this.services.audit.record(ctx, req.command, 'operation', operationId, 'success', riskLevel);
      await this.services.telemetry.count('operation.success', { command: req.command, riskLevel });
    } catch (err: unknown) {
      const msg    = err instanceof Error ? err.message : String(err);
      const status = (err as { status?: number }).status ?? 500;
      const code   = (err as { code?: string }).code   ?? 'INTERNAL_ERROR';
      result = {
        success: false,
        operationId,
        error: { code, message: msg, status },
      };
      await this.services.audit.record(ctx, req.command, 'operation', operationId, 'failure', riskLevel, { error: msg });
      await this.services.telemetry.count('operation.failure', { command: req.command, code });
    }

    await this.services.telemetry.duration('operation.latency', Date.now() - startMs, { command: req.command });
    return result;
  }
}

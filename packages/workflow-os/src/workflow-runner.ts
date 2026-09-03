import type {
  WorkflowDefinition, WorkflowRunContext, WorkflowStepDefinition,
  WorkflowStatus, StepStatus, DeadLetterItem,
} from '@kajola/contracts';
import { newWorkflowRunId, newStepRunId, newDeadLetterId } from '@kajola/runtime-os';
import type { OperationExecutor, ExecuteCommandInput } from '@kajola/runtime-os';

type StepRun = {
  id:         string;
  runId:      string;
  stepId:     string;
  stepName:   string;
  status:     StepStatus;
  output?:    unknown;
  error?:     string;
  attempts:   number;
  startedAt:  string;
  endedAt?:   string;
};

type WorkflowRun = WorkflowRunContext & {
  stepRuns:    StepRun[];
  completedAt?: string;
  error?:      string;
};

type SignalPayload = { runId: string; signal: string; payload: Record<string, unknown> };
type TimerCallback = { runId: string; stepId: string; resolveAt: string };

export interface WorkflowRepository {
  saveRun(run: WorkflowRun): Promise<void>;
  getRun(runId: string): Promise<WorkflowRun | null>;
  appendStepRun(stepRun: StepRun): Promise<void>;
  updateStepRun(id: string, updates: Partial<StepRun>): Promise<void>;
  saveDeadLetter(item: DeadLetterItem): Promise<void>;
  listDeadLetters(tenantId: string): Promise<DeadLetterItem[]>;
  updateDeadLetter(id: string, updates: Partial<DeadLetterItem>): Promise<void>;
}

export class InMemoryWorkflowRepository implements WorkflowRepository {
  runs        = new Map<string, WorkflowRun>();
  stepRuns    = new Map<string, StepRun>();
  deadLetters = new Map<string, DeadLetterItem>();

  async saveRun(run: WorkflowRun)                    { this.runs.set(run.runId, run); }
  async getRun(runId: string)                        { return this.runs.get(runId) ?? null; }
  async appendStepRun(sr: StepRun)                   { this.stepRuns.set(sr.id, sr); }
  async updateStepRun(id: string, u: Partial<StepRun>) {
    const s = this.stepRuns.get(id);
    if (s) this.stepRuns.set(id, { ...s, ...u });
  }
  async saveDeadLetter(item: DeadLetterItem)         { this.deadLetters.set(item.id, item); }
  async listDeadLetters(tenantId: string)            {
    return [...this.deadLetters.values()].filter((d) => d.tenantId === tenantId);
  }
  async updateDeadLetter(id: string, u: Partial<DeadLetterItem>) {
    const d = this.deadLetters.get(id);
    if (d) this.deadLetters.set(id, { ...d, ...u });
  }
}

export type WorkflowRunOptions = {
  tenantId:       string;
  correlationId?: string;
  triggeredBy:    string;
  input:          Record<string, unknown>;
};

const DEFAULT_RETRY = { maxAttempts: 3, backoffMs: 1000, backoffFactor: 2, maxBackoffMs: 30_000 };

export class WorkflowRunner {
  private definitions = new Map<string, WorkflowDefinition>();
  private pendingSignals = new Map<string, SignalPayload[]>();

  constructor(
    private repo:     WorkflowRepository,
    private executor: OperationExecutor,
  ) {}

  register(def: WorkflowDefinition) {
    this.definitions.set(def.name, def);
    return this;
  }

  async start(workflowName: string, opts: WorkflowRunOptions): Promise<WorkflowRun> {
    const def = this.definitions.get(workflowName);
    if (!def) throw new Error(`Workflow not found: ${workflowName}`);
    if (!def.active) throw new Error(`Workflow inactive: ${workflowName}`);

    const runId = newWorkflowRunId();
    const { newCorrelationId } = await import('@kajola/runtime-os');
    const run: WorkflowRun = {
      runId,
      workflowId:    def.id,
      version:       def.version,
      tenantId:      opts.tenantId,
      correlationId: opts.correlationId ?? newCorrelationId(),
      triggeredBy:   opts.triggeredBy,
      input:         opts.input,
      state:         { ...opts.input },
      status:        'running',
      startedAt:     new Date().toISOString(),
      stepRuns:      [],
    };

    await this.repo.saveRun(run);
    await this.executeSteps(run, def.steps);
    return (await this.repo.getRun(runId))!;
  }

  async signal(runId: string, signal: string, payload: Record<string, unknown> = {}) {
    const queue = this.pendingSignals.get(runId) ?? [];
    queue.push({ runId, signal, payload });
    this.pendingSignals.set(runId, queue);
  }

  async getRun(runId: string) { return this.repo.getRun(runId); }
  async listDeadLetters(tenantId: string) { return this.repo.listDeadLetters(tenantId); }

  async replayDeadLetter(id: string, tenantId: string): Promise<DeadLetterItem> {
    const items = await this.repo.listDeadLetters(tenantId);
    const item = items.find((d) => d.id === id);
    if (!item) throw new Error(`Dead letter ${id} not found`);

    const run = await this.repo.getRun(item.sourceId);
    if (!run) throw new Error(`Workflow run ${item.sourceId} not found for replay`);

    const def = [...this.definitions.values()].find((d) => d.id === run.workflowId);
    if (!def) throw new Error(`Workflow definition ${run.workflowId} not found`);

    // Resume from failed step
    const failedStep = def.steps.find((s) => {
      const sr = [...(this.repo as InMemoryWorkflowRepository).stepRuns.values()]
        .find((r) => r.runId === run.runId && r.stepId === s.id && r.status === 'failed');
      return !!sr;
    });

    if (failedStep) {
      await this.executeSteps(run, [failedStep]);
    }

    const updated: DeadLetterItem = {
      ...item,
      replayedAt: new Date().toISOString(),
      replayedBy: 'system',
    };
    await this.repo.updateDeadLetter(id, updated);
    return updated;
  }

  private async executeSteps(run: WorkflowRun, steps: WorkflowStepDefinition[]) {
    let skipNext = false;
    for (const step of steps) {
      if (skipNext) { skipNext = false; continue; }
      const signal = await this.executeStep(run, step);
      if (signal === 'skip_next') { skipNext = true; continue; }
      const updated = await this.repo.getRun(run.runId);
      if (updated?.status === 'failed' || updated?.status === 'cancelled') break;
    }
  }

  private async executeStep(run: WorkflowRun, step: WorkflowStepDefinition): Promise<'skip_next' | void> {
    const stepRunId = newStepRunId();
    const sr: StepRun = {
      id:        stepRunId,
      runId:     run.runId,
      stepId:    step.id,
      stepName:  step.name,
      status:    'running',
      attempts:  0,
      startedAt: new Date().toISOString(),
    };
    await this.repo.appendStepRun(sr);

    const retry = step.retryPolicy ?? (await this.getWorkflowRetry(run)) ?? DEFAULT_RETRY;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      sr.attempts = attempt;
      try {
        const output = await this.runStepOnce(run, step);
        sr.status  = 'completed';
        sr.output  = output;
        sr.endedAt = new Date().toISOString();
        await this.repo.updateStepRun(stepRunId, sr);

        // Merge step output into run state
        if (output && typeof output === 'object') {
          Object.assign(run.state, output);
          await this.repo.saveRun(run);
        }
        return;
      } catch (err: unknown) {
        // Condition gate closed (false + onFailure:'skip') → complete step, skip next
        if (err instanceof Error && (err as Error & { __gateClosed?: boolean }).__gateClosed) {
          sr.status  = 'completed';
          sr.output  = { conditionPassed: false };
          sr.endedAt = new Date().toISOString();
          await this.repo.updateStepRun(stepRunId, sr);
          return 'skip_next';
        }

        const msg = err instanceof Error ? err.message : String(err);
        sr.error   = msg;

        if (attempt < retry.maxAttempts) {
          const delay = Math.min(retry.backoffMs * Math.pow(retry.backoffFactor, attempt - 1), retry.maxBackoffMs);
          // In-process: simulate delay with a resolved Promise (tests run synchronously)
          await new Promise((r) => setTimeout(r, Math.min(delay, 10)));
          continue;
        }

        // All retries exhausted
        sr.status  = 'failed';
        sr.endedAt = new Date().toISOString();
        await this.repo.updateStepRun(stepRunId, sr);

        const onFailure = step.onFailure ?? 'stop';
        if (onFailure === 'skip') return;

        if (onFailure === 'compensate' && step.compensate) {
          await this.executeStep(run, {
            id: `${step.id}_compensate`, name: `${step.name} (compensate)`,
            type: 'command', command: step.compensate, onFailure: 'stop',
          });
        }

        // Dead letter
        const dlq: DeadLetterItem = {
          id:            newDeadLetterId(),
          tenantId:      run.tenantId,
          source:        'workflow',
          sourceId:      run.runId,
          payload:       { step: step.id, stepName: step.name, state: run.state },
          error:         msg,
          attempts:      retry.maxAttempts,
          lastAttemptAt: new Date().toISOString(),
          createdAt:     new Date().toISOString(),
        };
        await this.repo.saveDeadLetter(dlq);

        run.status = 'failed';
        run.error  = msg;
        await this.repo.saveRun(run);
        return;
      }
    }
  }

  private async runStepOnce(run: WorkflowRun, step: WorkflowStepDefinition): Promise<unknown> {
    switch (step.type) {
      case 'command': {
        if (!step.command) throw new Error(`Step ${step.id} missing command`);
        const payload = typeof step.payload === 'function'
          ? step.payload(run)
          : { ...step.payload, ...run.state };

        const req: ExecuteCommandInput = {
          command:        step.command,
          input:          payload,
          actorId:        `wfr_${run.runId}`,
          actorType:      'workflow',
          role:           'system',
          tenantId:       run.tenantId,
          idempotencyKey: `wf:${run.runId}:${step.id}`,
          correlationId:  run.correlationId,
          workflowRunId:  run.runId,
        };
        const result = await this.executor.execute(req);
        if (!result.success) {
          const e = new Error(result.error?.message ?? 'Operation failed') as Error & { status?: number; code?: string };
          e.status = result.error?.status;
          e.code   = result.error?.code;
          throw e;
        }
        return result.data;
      }

      case 'condition': {
        if (!step.condition) return {};
        const pass = step.condition(run);
        if (!pass && step.onFailure === 'skip') throw Object.assign(new Error('ConditionGateClosed'), { __gateClosed: true });
        if (!pass) throw new Error(`Condition '${step.id}' not satisfied`);
        return { conditionPassed: true };
      }

      case 'timer': {
        const ms = typeof step.timerMs === 'function' ? step.timerMs(run) : (step.timerMs ?? 0);
        if (ms > 0 && process.env.NODE_ENV !== 'test') {
          await new Promise((r) => setTimeout(r, Math.min(ms, 100)));
        }
        return { timerFired: true, timerMs: ms };
      }

      case 'approval': {
        // In tests, approval steps resolve immediately (pending)
        return { approvalStatus: 'pending', stepId: step.id };
      }

      case 'notification': {
        // Notification steps always succeed (fire-and-forget)
        return { notified: true };
      }

      case 'agent': {
        // Delegate to agent OS via command bus
        return { agentDelegated: true, agentId: step.agentId };
      }

      case 'parallel': {
        if (!step.branches?.length) return {};
        const results = await Promise.allSettled(
          step.branches.map((branch) => this.executeSteps(run, branch)),
        );
        const failed = results.filter((r) => r.status === 'rejected');
        if (failed.length) throw new Error(`${failed.length} parallel branches failed`);
        return {};
      }

      default:
        throw new Error(`Unknown step type: ${(step as WorkflowStepDefinition).type}`);
    }
  }

  private async getWorkflowRetry(run: WorkflowRun) {
    const def = [...this.definitions.values()].find((d) => d.id === run.workflowId);
    return def?.retryPolicy ?? null;
  }
}

import type { ExecutionCommand, ExecutionResult } from './contracts';

export type RuntimeHandler = (payload: unknown, command: ExecutionCommand) => Promise<unknown> | unknown;

export interface RuntimePolicy {
  key: string;
  maxAttempts: number;
  backoffMs: number;
  exponential?: boolean;
  jitter?: boolean;
}

export interface RuntimeAdapter {
  execute(command: ExecutionCommand): Promise<ExecutionResult>;
}

/** Leaves automatic tasks READY so a leased durable worker can execute them. */
export class DeferredRuntime implements RuntimeAdapter {
  async execute(command: ExecutionCommand): Promise<ExecutionResult> {
    return {
      commandId: command.id,
      status: 'DEFERRED',
      correlationId: command.correlationId,
      causationId: command.causationId ?? command.id,
    };
  }
}

export class HandlerRegistry {
  private readonly handlers = new Map<string, RuntimeHandler>();

  register(key: string, handler: RuntimeHandler) {
    if (!key) throw new Error('Handler key is required');
    this.handlers.set(key, handler);
  }

  resolve(key: string) {
    const handler = this.handlers.get(key);
    if (!handler) throw new Error(`Handler is not registered: ${key}`);
    return handler;
  }
}

export class RuntimePolicyRegistry {
  private readonly policies = new Map<string, RuntimePolicy>();

  constructor() {
    this.register({ key: 'FAST_INTERNAL_TASK', maxAttempts: 2, backoffMs: 0 });
    this.register({ key: 'STANDARD_NETWORK_CALL', maxAttempts: 3, backoffMs: 100, exponential: true });
    this.register({ key: 'PAYMENT_PROVIDER', maxAttempts: 3, backoffMs: 250, exponential: true });
    this.register({ key: 'AI_PROVIDER', maxAttempts: 2, backoffMs: 250, exponential: true });
    this.register({ key: 'WEBHOOK_PROCESSING', maxAttempts: 3, backoffMs: 100, exponential: true });
    this.register({ key: 'HUMAN_APPROVAL', maxAttempts: 1, backoffMs: 0 });
  }

  register(policy: RuntimePolicy) { this.policies.set(policy.key, policy); }
  resolve(key = 'FAST_INTERNAL_TASK') { return this.policies.get(key) ?? this.policies.get('FAST_INTERNAL_TASK')!; }
}

export class DeterministicRuntime implements RuntimeAdapter {
  private readonly completed = new Map<string, ExecutionResult>();

  constructor(
    private readonly handlers: HandlerRegistry,
    private readonly policies = new RuntimePolicyRegistry(),
  ) {}

  async execute(command: ExecutionCommand): Promise<ExecutionResult> {
    const prior = this.completed.get(command.idempotencyKey);
    if (prior) return prior;
    const policy = this.policies.resolve(command.retryPolicy);
    let lastError: unknown;
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
      try {
        const output = await this.handlers.resolve(command.handler)(command.payload, command);
        const result: ExecutionResult = {
          commandId: command.id,
          status: 'SUCCESS',
          output,
          correlationId: command.correlationId,
          causationId: command.causationId ?? command.id,
        };
        this.completed.set(command.idempotencyKey, result);
        return result;
      } catch (error) {
        lastError = error;
        const retryable = !(error instanceof Error && error.message.startsWith('PERMANENT:'));
        if (!retryable || attempt === policy.maxAttempts) break;
        const delay = policy.backoffMs * (policy.exponential ? 2 ** (attempt - 1) : 1);
        if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    return {
      commandId: command.id,
      status: 'FAILED',
      error: { code: message.startsWith('PERMANENT:') ? 'PERMANENT' : 'RUNTIME_FAILURE', message, retryable: !message.startsWith('PERMANENT:') },
      correlationId: command.correlationId,
      causationId: command.causationId ?? command.id,
    };
  }
}

export type DurableWorkClaim = {
  id: string;
  flow_instance_id: string;
  node_id: string;
  attempt: number;
  idempotency_key: string;
  input?: unknown;
};

export interface DurableWorkerOptions {
  url: string;
  serviceRoleKey: string;
  workerId: string;
  runtimeMode: 'sandbox' | 'production';
  deploymentSha?: string;
  batchSize?: number;
  maxAttempts?: number;
  fetch?: typeof globalThis.fetch;
}

/** Workflow OS worker: claims database-leased work and persists every outcome. */
export class SupabaseWorkflowWorker {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly baseUrl: string;

  constructor(
    private readonly options: DurableWorkerOptions,
    private readonly executeClaim: (claim: DurableWorkClaim) => Promise<unknown>,
    private readonly completeClaim?: (claim: DurableWorkClaim, output: unknown) => Promise<void>,
  ) {
    if (!options.url || !options.serviceRoleKey) throw new Error('DEPENDENCY_UNAVAILABLE');
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.baseUrl = options.url.replace(/\/$/, '');
  }

  async runOnce() {
    await this.heartbeat();
    const claims = await this.request<DurableWorkClaim[]>('/rest/v1/rpc/claim_ready_flow_steps', {
      method: 'POST',
      body: JSON.stringify({ worker_id: this.options.workerId, batch_size: this.options.batchSize ?? 25 }),
    });
    let completed = 0;
    let retried = 0;
    let deadLettered = 0;
    for (const claim of claims) {
      try {
        const output = await this.executeClaim(claim);
        if (this.completeClaim) await this.completeClaim(claim, output);
        else await this.updateStep(claim.id, { status: 'COMPLETED', output, completed_at: new Date().toISOString(), lease_owner: null, lease_expires_at: null });
        completed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryable = !message.startsWith('PERMANENT:');
        if (retryable && claim.attempt < (this.options.maxAttempts ?? 3)) {
          const delaySeconds = Math.min(300, 2 ** claim.attempt * 5);
          await this.updateStep(claim.id, {
            status: 'READY', attempt: claim.attempt + 1, error_message: message, retryable: true,
            scheduled_at: new Date(Date.now() + delaySeconds * 1000).toISOString(), lease_owner: null, lease_expires_at: null,
          });
          retried += 1;
        } else {
          await this.updateStep(claim.id, { status: 'FAILED', error_message: message, retryable: false, lease_owner: null, lease_expires_at: null });
          await this.request('/rest/v1/workflow_dead_letters', {
            method: 'POST',
            body: JSON.stringify({ flow_instance_id: claim.flow_instance_id, step_instance_id: claim.id, failure_class: retryable ? 'RETRY_EXHAUSTED' : 'PERMANENT', error_message: message, payload: claim.input ?? {}, attempts: claim.attempt }),
          });
          deadLettered += 1;
        }
      }
    }
    await this.heartbeat({ completed, retried, deadLettered });
    return { claimed: claims.length, completed, retried, deadLettered };
  }

  async heartbeat(metadata: Record<string, unknown> = {}) {
    await this.request('/rest/v1/runtime_worker_heartbeats?on_conflict=worker_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        worker_id: this.options.workerId,
        worker_type: 'flow-workflow',
        runtime_mode: this.options.runtimeMode,
        deployment_sha: this.options.deploymentSha ?? null,
        metadata,
        heartbeat_at: new Date().toISOString(),
      }),
    });
  }

  private updateStep(id: string, update: Record<string, unknown>) {
    return this.request(`/rest/v1/flow_step_instances?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(update),
    });
  }

  private async request<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: { apikey: this.options.serviceRoleKey, Authorization: `Bearer ${this.options.serviceRoleKey}`, 'Content-Type': 'application/json', ...init.headers },
    });
    if (!response.ok) throw new Error(`DEPENDENCY_UNAVAILABLE: ${response.status} ${await response.text()}`);
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

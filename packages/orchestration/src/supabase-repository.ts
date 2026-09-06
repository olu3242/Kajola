import type { ActorReference } from './contracts';
import type { FlowAuditEntry, FlowCallbackExpectation, FlowCheckpoint, FlowDeadLetter, FlowDefinition, FlowInstance, FlowReceipt, FlowStepInstance, FlowTimer } from './model';
import type { FlowRepository } from './repository';

export interface SupabaseRepositoryOptions {
  url: string;
  serviceRoleKey: string;
  fetch?: typeof globalThis.fetch;
}

type DbInstance = {
  id: string;
  flow_key: string;
  flow_version: number;
  workflow_type: string;
  workflow_id: string;
  tenant_id: string | null;
  status: FlowInstance['status'];
  context: Record<string, unknown>;
  actor: ActorReference;
  correlation_id: string;
  causation_id?: string;
  lock_version: number;
  created_at: string;
  updated_at: string;
  completed_at?: string;
  cancelled_at?: string;
  flow_step_instances?: DbStep[];
  flow_checkpoints?: DbCheckpoint[];
};

type DbStep = {
  id: string;
  flow_instance_id: string;
  node_id: string;
  status: FlowStepInstance['status'];
  attempt: number;
  idempotency_key: string;
  input?: unknown;
  output?: unknown;
  failure_type?: FlowStepInstance['error'] extends infer _T ? string : never;
  error_message?: string;
  retryable?: boolean;
  assigned_actor?: ActorReference;
  started_at?: string;
  scheduled_at?: string;
  completed_at?: string;
};

type DbCheckpoint = {
  id: string;
  flow_instance_id: string;
  checkpoint_key: string;
  evidence_refs: string[];
  created_at: string;
};

function required(value: string, name: string) {
  const normalized = value.trim().replace(/\/$/, '');
  if (!normalized) throw new Error(`DEPENDENCY_UNAVAILABLE: ${name}_MISSING`);
  return normalized;
}

/** Durable FlowRepository backed by Supabase PostgREST and transaction RPCs. */
export class SupabaseOrchestrationRepository implements FlowRepository {
  private readonly url: string;
  private readonly key: string;
  private readonly fetcher: typeof globalThis.fetch;

  constructor(options: SupabaseRepositoryOptions) {
    this.url = required(options.url, 'SUPABASE_URL');
    this.key = required(options.serviceRoleKey, 'SUPABASE_SERVICE_ROLE_KEY');
    this.fetcher = options.fetch ?? globalThis.fetch;
  }

  async registerDefinition(definition: FlowDefinition) {
    const existing = await this.getDefinition(definition.key, definition.version);
    if (existing) {
      if (stableStringify(existing) !== stableStringify(definition)) throw new Error(`Active flow definition ${definition.key}@${definition.version} is immutable`);
      return;
    }
    await this.request('/rest/v1/flow_definitions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        flow_key: definition.key,
        version: definition.version,
        name: definition.name,
        definition,
        is_active: Boolean(definition.active),
      }),
    });
  }

  async getDefinition(key: string, version: number) {
    const rows = await this.request<Array<{ definition: FlowDefinition }>>(
      `/rest/v1/flow_definitions?flow_key=eq.${encodeURIComponent(key)}&version=eq.${version}&select=definition&limit=1`,
    );
    return rows[0]?.definition;
  }

  async saveInstance(instance: FlowInstance, expectedVersion?: number) {
    await this.request('/rest/v1/rpc/persist_flow_instance', {
      method: 'POST',
      body: JSON.stringify({ instance_payload: instance, expected_version: expectedVersion ?? null }),
    });
  }

  async getInstance(id: string) {
    const rows = await this.request<DbInstance[]>(
      `/rest/v1/flow_instances?id=eq.${encodeURIComponent(id)}&select=*,flow_step_instances(*),flow_checkpoints(*)&limit=1`,
    );
    return rows[0] ? this.fromDb(rows[0]) : undefined;
  }

  async findInstances(input: { workflowId?: string; tenantId?: string | null; status?: string }) {
    const filters = ['select=*,flow_step_instances(*),flow_checkpoints(*)', 'order=created_at.desc'];
    if (input.workflowId) filters.push(`workflow_id=eq.${encodeURIComponent(input.workflowId)}`);
    if (input.tenantId !== undefined) filters.push(input.tenantId === null ? 'tenant_id=is.null' : `tenant_id=eq.${encodeURIComponent(input.tenantId)}`);
    if (input.status) filters.push(`status=eq.${encodeURIComponent(input.status)}`);
    const rows = await this.request<DbInstance[]>(`/rest/v1/flow_instances?${filters.join('&')}`);
    return rows.map((row) => this.fromDb(row));
  }

  async appendAudit(entry: FlowAuditEntry) {
    await this.request('/rest/v1/flow_audit_entries', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: entry.id,
        flow_instance_id: entry.flowInstanceId,
        tenant_id: entry.tenantId,
        action: entry.action,
        actor: entry.actor,
        correlation_id: entry.correlationId,
        causation_id: entry.causationId ?? null,
        step_instance_id: entry.stepInstanceId ?? null,
        details: entry.details,
        occurred_at: entry.occurredAt,
      }),
    });
  }

  async listAudit(flowInstanceId: string) {
    const rows = await this.request<Array<Record<string, unknown>>>(
      `/rest/v1/flow_audit_entries?flow_instance_id=eq.${encodeURIComponent(flowInstanceId)}&select=*&order=occurred_at.asc`,
    );
    return rows.map((row) => ({
      id: String(row.id),
      flowInstanceId: String(row.flow_instance_id),
      tenantId: row.tenant_id ? String(row.tenant_id) : null,
      action: String(row.action),
      actor: row.actor as ActorReference,
      correlationId: String(row.correlation_id),
      causationId: row.causation_id ? String(row.causation_id) : undefined,
      stepInstanceId: row.step_instance_id ? String(row.step_instance_id) : undefined,
      details: (row.details ?? {}) as Record<string, unknown>,
      occurredAt: String(row.occurred_at),
    }));
  }

  async hasReceipt(flowInstanceId: string, eventId: string) {
    const rows = await this.request<Array<{ event_id: string }>>(
      `/rest/v1/flow_event_receipts?flow_instance_id=eq.${encodeURIComponent(flowInstanceId)}&event_id=eq.${encodeURIComponent(eventId)}&select=event_id&limit=1`,
    );
    return rows.length > 0;
  }

  async saveReceipt(receipt: FlowReceipt) {
    const instance = await this.getInstance(receipt.flowInstanceId);
    if (!instance) throw new Error('FLOW_INSTANCE_NOT_FOUND');
    const lastEvent = instance.context.lastEvent as { eventType?: string; payload?: unknown; causationId?: string } | undefined;
    await this.request('/rest/v1/flow_event_receipts?on_conflict=event_id,flow_instance_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({
        event_id: receipt.eventId,
        flow_instance_id: receipt.flowInstanceId,
        event_type: lastEvent?.eventType ?? 'unknown',
        tenant_id: instance.tenantId,
        correlation_id: instance.correlationId,
        causation_id: lastEvent?.causationId ?? instance.causationId ?? null,
        payload: lastEvent?.payload ?? {},
        received_at: receipt.receivedAt,
      }),
    });
  }

  async saveTimer(timer: FlowTimer) {
    const instance = await this.getInstance(timer.flowInstanceId);
    if (!instance) throw new Error('FLOW_INSTANCE_NOT_FOUND');
    await this.request('/rest/v1/flow_timers?on_conflict=idempotency_key', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ id: timer.id, flow_instance_id: timer.flowInstanceId, step_instance_id: timer.stepInstanceId, tenant_id: instance.tenantId, wake_at: timer.wakeAt, status: timer.status, idempotency_key: timer.idempotencyKey }),
    });
  }

  async listTimers(flowInstanceId: string) {
    const rows = await this.request<Array<Record<string, unknown>>>(`/rest/v1/flow_timers?flow_instance_id=eq.${encodeURIComponent(flowInstanceId)}&select=*&order=wake_at.asc`);
    return rows.map((row) => ({ id: String(row.id), flowInstanceId: String(row.flow_instance_id), stepInstanceId: String(row.step_instance_id), wakeAt: String(row.wake_at), status: row.status as FlowTimer['status'], idempotencyKey: String(row.idempotency_key) }));
  }

  async saveCallbackExpectation(expectation: FlowCallbackExpectation) {
    const instance = await this.getInstance(expectation.flowInstanceId);
    if (!instance) throw new Error('FLOW_INSTANCE_NOT_FOUND');
    await this.request('/rest/v1/flow_callback_expectations?on_conflict=provider,provider_reference,callback_type', {
      method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify({ id: expectation.id, tenant_id: instance.tenantId, flow_instance_id: expectation.flowInstanceId, step_instance_id: expectation.stepInstanceId ?? null, callback_type: expectation.callbackType, provider: expectation.provider, provider_reference: expectation.providerReference, correlation_id: expectation.correlationId, status: expectation.status, expires_at: expectation.expiresAt ?? null, received_event_id: expectation.receivedEventId ?? null }),
    });
  }

  async resolveCallbackExpectation(flowInstanceId: string, callbackType: string, eventId: string) {
    await this.request(`/rest/v1/flow_callback_expectations?flow_instance_id=eq.${encodeURIComponent(flowInstanceId)}&callback_type=eq.${encodeURIComponent(callbackType)}&status=eq.WAITING`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'RECEIVED', received_event_id: eventId, received_at: new Date().toISOString() }),
    });
  }

  async saveDeadLetter(deadLetter: FlowDeadLetter) {
    const instance = deadLetter.flowInstanceId ? await this.getInstance(deadLetter.flowInstanceId) : undefined;
    await this.request('/rest/v1/workflow_dead_letters', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ id: deadLetter.id, tenant_id: instance?.tenantId ?? null, flow_instance_id: deadLetter.flowInstanceId ?? null, step_instance_id: deadLetter.stepInstanceId ?? null, failure_class: deadLetter.failureClass, error_message: deadLetter.errorMessage, payload: deadLetter.payload ?? {}, attempts: deadLetter.attempts, status: deadLetter.status, created_at: deadLetter.createdAt }),
    });
  }

  async listDeadLetters(flowInstanceId?: string) {
    const filter = flowInstanceId ? `&flow_instance_id=eq.${encodeURIComponent(flowInstanceId)}` : '';
    const rows = await this.request<Array<Record<string, unknown>>>(`/rest/v1/workflow_dead_letters?select=*&order=created_at.desc${filter}`);
    return rows.map((row) => ({ id: String(row.id), flowInstanceId: row.flow_instance_id ? String(row.flow_instance_id) : undefined, stepInstanceId: row.step_instance_id ? String(row.step_instance_id) : undefined, failureClass: String(row.failure_class), errorMessage: String(row.error_message), payload: row.payload, attempts: Number(row.attempts), status: row.status as FlowDeadLetter['status'], createdAt: String(row.created_at) }));
  }

  async checkConnection() {
    await this.request('/rest/v1/flow_instances?select=id&limit=1', { headers: { Prefer: 'count=exact' } });
    return true;
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.url}${path}`, {
      ...init,
      headers: {
        apikey: this.key,
        Authorization: `Bearer ${this.key}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    });
    if (!response.ok) {
      const detail = await response.text();
      if (response.status === 409 && detail.includes('FLOW_VERSION_CONFLICT')) throw new Error('FLOW_VERSION_CONFLICT');
      throw new Error(`SUPABASE_ORCHESTRATION_${response.status}: ${detail}`);
    }
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private fromDb(row: DbInstance): FlowInstance {
    return {
      id: row.id,
      flowKey: row.flow_key,
      flowVersion: row.flow_version,
      workflowType: row.workflow_type,
      workflowId: row.workflow_id,
      tenantId: row.tenant_id,
      status: row.status,
      context: row.context ?? {},
      actor: row.actor,
      correlationId: row.correlation_id,
      causationId: row.causation_id ?? undefined,
      version: Number(row.lock_version),
      steps: (row.flow_step_instances ?? []).map((step) => this.stepFromDb(step)),
      checkpoints: (row.flow_checkpoints ?? []).map((checkpoint) => this.checkpointFromDb(checkpoint)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at ?? undefined,
      cancelledAt: row.cancelled_at ?? undefined,
    };
  }

  private stepFromDb(row: DbStep): FlowStepInstance {
    return {
      id: row.id,
      flowInstanceId: row.flow_instance_id,
      nodeId: row.node_id,
      status: row.status,
      attempt: row.attempt,
      idempotencyKey: row.idempotency_key,
      input: row.input,
      output: row.output,
      error: row.failure_type ? { type: row.failure_type as NonNullable<FlowStepInstance['error']>['type'], message: row.error_message ?? '', retryable: Boolean(row.retryable) } : undefined,
      assignedActor: row.assigned_actor,
      startedAt: row.started_at ?? undefined,
      scheduledAt: row.scheduled_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
    };
  }

  private checkpointFromDb(row: DbCheckpoint): FlowCheckpoint {
    return {
      id: row.id,
      flowInstanceId: row.flow_instance_id,
      key: row.checkpoint_key,
      evidenceRefs: row.evidence_refs ?? [],
      createdAt: row.created_at,
    };
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

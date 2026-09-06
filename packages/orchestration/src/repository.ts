import type { FlowAuditEntry, FlowCallbackExpectation, FlowDeadLetter, FlowDefinition, FlowInstance, FlowReceipt, FlowTimer } from './model';

export interface FlowRepository {
  registerDefinition(definition: FlowDefinition): Promise<void>;
  getDefinition(key: string, version: number): Promise<FlowDefinition | undefined>;
  saveInstance(instance: FlowInstance, expectedVersion?: number): Promise<void>;
  getInstance(id: string): Promise<FlowInstance | undefined>;
  findInstances(input: { workflowId?: string; tenantId?: string | null; status?: string }): Promise<FlowInstance[]>;
  appendAudit(entry: FlowAuditEntry): Promise<void>;
  listAudit(flowInstanceId: string): Promise<FlowAuditEntry[]>;
  hasReceipt(flowInstanceId: string, eventId: string): Promise<boolean>;
  saveReceipt(receipt: FlowReceipt): Promise<void>;
  saveTimer(timer: FlowTimer): Promise<void>;
  listTimers(flowInstanceId: string): Promise<FlowTimer[]>;
  saveCallbackExpectation(expectation: FlowCallbackExpectation): Promise<void>;
  resolveCallbackExpectation(flowInstanceId: string, callbackType: string, eventId: string): Promise<void>;
  saveDeadLetter(deadLetter: FlowDeadLetter): Promise<void>;
  listDeadLetters(flowInstanceId?: string): Promise<FlowDeadLetter[]>;
}

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class InMemoryFlowRepository implements FlowRepository {
  readonly definitions = new Map<string, FlowDefinition>();
  readonly instances = new Map<string, FlowInstance>();
  readonly audits: FlowAuditEntry[] = [];
  readonly receipts: FlowReceipt[] = [];
  readonly timers: FlowTimer[] = [];
  readonly callbackExpectations: FlowCallbackExpectation[] = [];
  readonly deadLetters: FlowDeadLetter[] = [];

  async registerDefinition(definition: FlowDefinition) {
    const id = `${definition.key}@${definition.version}`;
    const existing = this.definitions.get(id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) {
      throw new Error(`Active flow definition ${id} is immutable`);
    }
    this.definitions.set(id, copy(definition));
  }

  async getDefinition(key: string, version: number) {
    const value = this.definitions.get(`${key}@${version}`);
    return value ? copy(value) : undefined;
  }

  async saveInstance(instance: FlowInstance, expectedVersion?: number) {
    const existing = this.instances.get(instance.id);
    if (existing && expectedVersion !== undefined && existing.version !== expectedVersion) {
      throw new Error('FLOW_VERSION_CONFLICT');
    }
    this.instances.set(instance.id, copy(instance));
  }

  async getInstance(id: string) {
    const value = this.instances.get(id);
    return value ? copy(value) : undefined;
  }

  async findInstances(input: { workflowId?: string; tenantId?: string | null; status?: string }) {
    return [...this.instances.values()].filter((instance) =>
      (!input.workflowId || instance.workflowId === input.workflowId)
      && (input.tenantId === undefined || instance.tenantId === input.tenantId)
      && (!input.status || instance.status === input.status),
    ).map(copy);
  }

  async appendAudit(entry: FlowAuditEntry) {
    this.audits.push(copy(entry));
  }

  async listAudit(flowInstanceId: string) {
    return this.audits.filter((entry) => entry.flowInstanceId === flowInstanceId).map(copy);
  }

  async hasReceipt(flowInstanceId: string, eventId: string) {
    return this.receipts.some((receipt) => receipt.flowInstanceId === flowInstanceId && receipt.eventId === eventId);
  }

  async saveReceipt(receipt: FlowReceipt) {
    if (!(await this.hasReceipt(receipt.flowInstanceId, receipt.eventId))) this.receipts.push(copy(receipt));
  }

  async saveTimer(timer: FlowTimer) {
    if (!this.timers.some((item) => item.idempotencyKey === timer.idempotencyKey)) this.timers.push(copy(timer));
  }

  async listTimers(flowInstanceId: string) {
    return this.timers.filter((timer) => timer.flowInstanceId === flowInstanceId).map(copy);
  }

  async saveCallbackExpectation(expectation: FlowCallbackExpectation) {
    if (!this.callbackExpectations.some((item) => item.provider === expectation.provider && item.providerReference === expectation.providerReference && item.callbackType === expectation.callbackType)) {
      this.callbackExpectations.push(copy(expectation));
    }
  }

  async resolveCallbackExpectation(flowInstanceId: string, callbackType: string, eventId: string) {
    const expectation = this.callbackExpectations.find((item) => item.flowInstanceId === flowInstanceId && item.callbackType === callbackType && item.status === 'WAITING');
    if (expectation) { expectation.status = 'RECEIVED'; expectation.receivedEventId = eventId; }
  }

  async saveDeadLetter(deadLetter: FlowDeadLetter) {
    if (!this.deadLetters.some((item) => item.id === deadLetter.id)) this.deadLetters.push(copy(deadLetter));
  }

  async listDeadLetters(flowInstanceId?: string) {
    return this.deadLetters.filter((item) => !flowInstanceId || item.flowInstanceId === flowInstanceId).map(copy);
  }
}

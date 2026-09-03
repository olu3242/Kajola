import type { ApprovalRequest, ApprovalStatus, OperationContext, RiskLevel } from '@kajola/contracts';
import { newApprovalId } from './ids';

export interface ApprovalRepository {
  create(request: ApprovalRequest): Promise<void>;
  get(id: string): Promise<ApprovalRequest | null>;
  listPending(tenantId: string): Promise<ApprovalRequest[]>;
  decide(id: string, status: ApprovalStatus, decidedBy: string, reason?: string): Promise<ApprovalRequest>;
}

export class InMemoryApprovalRepository implements ApprovalRepository {
  private records = new Map<string, ApprovalRequest>();

  async create(r: ApprovalRequest) { this.records.set(r.id, r); }

  async get(id: string) { return this.records.get(id) ?? null; }

  async listPending(tenantId: string) {
    return [...this.records.values()].filter(
      (r) => r.tenantId === tenantId && r.status === 'pending',
    );
  }

  async decide(id: string, status: ApprovalStatus, decidedBy: string, reason?: string) {
    const r = this.records.get(id);
    if (!r) throw new Error(`Approval ${id} not found`);
    const updated = { ...r, status, decidedBy, decidedAt: new Date().toISOString(), reason };
    this.records.set(id, updated);
    return updated;
  }
}

export class ApprovalService {
  constructor(private repo: ApprovalRepository) {}

  async request(
    ctx: OperationContext,
    action: string,
    payload: Record<string, unknown>,
    riskLevel: RiskLevel,
    ttlMs = 48 * 60 * 60 * 1000,
  ): Promise<ApprovalRequest> {
    const req: ApprovalRequest = {
      id:          newApprovalId(),
      operationId: ctx.operationId,
      tenantId:    ctx.tenantId,
      requestedBy: ctx.actor.actorId,
      action,
      payload,
      riskLevel,
      status:      'pending',
      expiresAt:   new Date(Date.now() + ttlMs).toISOString(),
      createdAt:   new Date().toISOString(),
    };
    await this.repo.create(req);
    return req;
  }

  async decide(id: string, approved: boolean, decidedBy: string, reason?: string): Promise<ApprovalRequest> {
    return this.repo.decide(id, approved ? 'approved' : 'rejected', decidedBy, reason);
  }

  async get(id: string) { return this.repo.get(id); }

  async listPending(tenantId: string) { return this.repo.listPending(tenantId); }
}

import type { AuditRecord, OperationContext, RiskLevel } from '@kajola/contracts';
import { newAuditId } from './ids';

export interface AuditRepository {
  append(record: AuditRecord): Promise<void>;
  list(tenantId: string, limit?: number): Promise<AuditRecord[]>;
}

export class InMemoryAuditRepository implements AuditRepository {
  private records: AuditRecord[] = [];

  async append(record: AuditRecord) { this.records.push(record); }

  async list(tenantId: string, limit = 100) {
    return this.records
      .filter((r) => r.tenantId === tenantId)
      .slice(-limit)
      .reverse();
  }
}

export class AuditService {
  constructor(private repo: AuditRepository) {}

  async record(
    ctx: OperationContext,
    action: string,
    resource: string,
    resourceId: string | undefined,
    outcome: AuditRecord['outcome'],
    riskLevel: RiskLevel,
    metadata?: Record<string, unknown>,
  ) {
    const record: AuditRecord = {
      id:          newAuditId(),
      operationId: ctx.operationId,
      tenantId:    ctx.tenantId,
      actorId:     ctx.actor.actorId,
      actorType:   ctx.actor.actorType,
      action,
      resource,
      resourceId,
      outcome,
      riskLevel,
      metadata,
      occurredAt:  new Date().toISOString(),
    };
    await this.repo.append(record);
  }

  async list(tenantId: string, limit?: number) {
    return this.repo.list(tenantId, limit);
  }
}

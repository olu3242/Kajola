import type { DomainEvent } from '@kajola/contracts';
import { newEventId } from './ids';

export interface EventRepository {
  append(event: DomainEvent): Promise<void>;
  pending(tenantId: string, limit?: number): Promise<DomainEvent[]>;
  markDelivered(id: string): Promise<void>;
}

export class InMemoryEventRepository implements EventRepository {
  private events: Array<DomainEvent & { delivered: boolean }> = [];

  async append(event: DomainEvent) { this.events.push({ ...event, delivered: false }); }

  async pending(tenantId: string, limit = 100) {
    return this.events
      .filter((e) => e.tenantId === tenantId && !e.delivered)
      .slice(0, limit);
  }

  async markDelivered(id: string) {
    const e = this.events.find((e) => e.id === id);
    if (e) e.delivered = true;
  }
}

export class EventOutbox {
  constructor(private repo: EventRepository) {}

  async emit(
    name: string,
    tenantId: string,
    aggregateId: string,
    aggregateType: string,
    payload: Record<string, unknown>,
    meta: { operationId: string; correlationId: string; causationId?: string; actorId: string; traceId: string },
  ): Promise<DomainEvent> {
    const event: DomainEvent = {
      id:            newEventId(),
      name,
      version:       1,
      tenantId,
      aggregateId,
      aggregateType,
      payload,
      metadata:      meta,
      occurredAt:    new Date().toISOString(),
    };
    await this.repo.append(event);
    return event;
  }

  async pending(tenantId: string) { return this.repo.pending(tenantId); }
  async markDelivered(id: string) { return this.repo.markDelivered(id); }
}

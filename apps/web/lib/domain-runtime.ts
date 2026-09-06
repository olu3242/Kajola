import { randomUUID } from 'crypto';
import { store, type StoreUser } from './store';

export function recordDomainChange(input: {
  eventType: string;
  actor: StoreUser;
  tenantId?: string | null;
  aggregateType: string;
  aggregateId: string;
  oldState?: Record<string, unknown> | null;
  newState?: Record<string, unknown> | null;
  payload?: Record<string, unknown>;
  correlationId?: string;
}) {
  const now = new Date().toISOString();
  const eventId = randomUUID();
  const event = {
    event_id: eventId,
    event_type: input.eventType,
    version: 1 as const,
    tenant_id: input.tenantId ?? input.actor.tenant_id,
    branch_id: null,
    actor_id: input.actor.id,
    aggregate_type: input.aggregateType,
    aggregate_id: input.aggregateId,
    correlation_id: input.correlationId ?? randomUUID(),
    causation_id: null,
    occurred_at: now,
    payload: input.payload ?? {},
  };
  store.events.push(event);
  store.audits.push({ id: randomUUID(), actor_id: input.actor.id, action: input.eventType, entity_type: input.aggregateType, entity_id: input.aggregateId, tenant_id: event.tenant_id, old_state: input.oldState ?? null, new_state: input.newState ?? null, created_at: now });
  return event;
}

export function scheduleWorkflow(eventId: string, type: string, runAt: Date) {
  store.workflows.push({ id: randomUUID(), event_id: eventId, type, run_at: runAt.toISOString(), status: 'scheduled', attempts: 0 });
}

export function createNotification(userId: string, type: string, payload: Record<string, unknown>) {
  store.notifications.push({ id: randomUUID(), user_id: userId, type, payload, sent_at: new Date().toISOString() });
}

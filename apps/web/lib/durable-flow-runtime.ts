import {
  DefaultGovernanceAdapter,
  DeferredRuntime,
  MilestoneWorkflowAdapter,
  PersistentFlowOrchestrator,
  SupabaseOrchestrationRepository,
  type DurableWorkClaim,
} from '@kajola/orchestration';
import { BOOKING_FLOW_KEY, BOOKING_FLOW_VERSION, bookingFlow } from './booking-flow';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export function createDurableBookingOrchestrator() {
  const repository = new SupabaseOrchestrationRepository({ url, serviceRoleKey });
  const orchestrator = new PersistentFlowOrchestrator(
    repository,
    new DeferredRuntime(),
    new DefaultGovernanceAdapter(),
    undefined,
    new MilestoneWorkflowAdapter(),
  );
  return { repository, orchestrator, ready: orchestrator.registerFlow(bookingFlow) };
}

export async function executeBookingClaim(claim: DurableWorkClaim) {
  const { repository } = createDurableBookingOrchestrator();
  const instance = await repository.getInstance(claim.flow_instance_id);
  if (!instance) throw new Error('PERMANENT:FLOW_INSTANCE_NOT_FOUND');
  const context = instance.context;

  switch (claim.node_id) {
    case 'schedule_hold_expiry':
      await insert('flow_timers', {
        flow_instance_id: instance.id, step_instance_id: claim.id, tenant_id: instance.tenantId,
        wake_at: context.heldUntil, timer_type: 'slot_expiration', payload: { booking_id: context.bookingId },
        idempotency_key: `${claim.idempotency_key}:hold-expiration`, status: 'SCHEDULED',
      }, 'idempotency_key');
      return { scheduledFor: context.heldUntil };
    case 'payment_route': {
      const lastEvent = context.lastEvent as { eventType?: string } | undefined;
      return { route: lastEvent?.eventType === 'booking.confirmed' ? 'pay_at_venue' : 'provider_payment' };
    }
    case 'notify_customer':
      await queueNotification(String(context.clientId), instance.tenantId, 'Booking confirmed', 'Your Kajola booking is confirmed.', claim.idempotency_key, { booking_id: context.bookingId });
      return { recipient: context.clientId };
    case 'notify_provider': {
      const providerUserId = await resolveProviderUser(String(context.providerId));
      await queueNotification(providerUserId, instance.tenantId, 'New confirmed booking', 'A customer booking has been confirmed.', claim.idempotency_key, { booking_id: context.bookingId });
      return { recipient: providerUserId };
    }
    case 'schedule_reminders': {
      const startsAt = new Date(String(context.startsAt));
      await queueNotification(String(context.clientId), instance.tenantId, 'Appointment reminder', 'Your Kajola appointment is coming up.', `${claim.idempotency_key}:24h`, { booking_id: context.bookingId }, new Date(startsAt.getTime() - 86_400_000));
      await queueNotification(String(context.clientId), instance.tenantId, 'Appointment reminder', 'Your Kajola appointment starts in about two hours.', `${claim.idempotency_key}:2h`, { booking_id: context.bookingId }, new Date(startsAt.getTime() - 7_200_000));
      return { reminders: 2 };
    }
    case 'request_review':
      await queueNotification(String(context.clientId), instance.tenantId, 'Rate your experience', 'Please review your completed Kajola service.', claim.idempotency_key, { booking_id: context.bookingId });
      return { requested: true };
    case 'prepare_settlement':
      return { bookingId: context.bookingId, settlement: 'financial-engine-owned' };
    default:
      throw new Error(`PERMANENT:UNREGISTERED_DURABLE_HANDLER:${claim.node_id}`);
  }
}

export async function startDurableBookingFlow(event: DurableSystemEvent) {
  const { repository, orchestrator, ready } = createDurableBookingOrchestrator();
  await ready;
  const bookingId = String(event.payload.id ?? event.payload.booking_id ?? event.aggregate_id ?? '');
  if (!bookingId) throw new Error('PERMANENT:BOOKING_ID_MISSING');
  const existing = await repository.findInstances({ workflowId: bookingId, tenantId: event.tenant_id });
  if (existing[0]) return existing[0];
  const booking = await selectOne<Record<string, unknown>>('bookings', `id=eq.${encodeURIComponent(bookingId)}&select=*`);
  return orchestrator.startFlow({
    flowKey: BOOKING_FLOW_KEY, flowVersion: BOOKING_FLOW_VERSION, workflowType: 'booking', workflowId: bookingId,
    tenantId: event.tenant_id, correlationId: event.correlation_id, causationId: event.id,
    actor: { type: 'SYSTEM', id: 'durable-event-worker', tenantId: event.tenant_id },
    context: {
      bookingId, clientId: booking.client_id, providerId: booking.artisan_id,
      startsAt: booking.starts_at ?? event.payload.starts_at ?? booking.requested_at,
      heldUntil: booking.held_until, balanceDueKobo: booking.balance_due_kobo ?? 0, sourceEventId: event.id,
    },
  });
}

export type DurableSystemEvent = {
  id: string; tenant_id: string; event_type: string; payload: Record<string, unknown>;
  aggregate_id?: string; correlation_id: string; causation_id?: string; orchestration_attempts?: number;
};

export async function deliverDurableBookingEvent(event: DurableSystemEvent) {
  const { repository, orchestrator, ready } = createDurableBookingOrchestrator();
  await ready;
  const bookingId = String(event.payload.booking_id ?? event.payload.id ?? event.aggregate_id ?? '');
  if (event.event_type === 'payment.succeeded') {
    const booking = await selectOne<{ booking_state?: string; recovery_state?: string }>('bookings', `id=eq.${encodeURIComponent(bookingId)}&select=booking_state,recovery_state`);
    if (booking.booking_state === 'REQUIRES_RECOVERY' || ['REQUIRED', 'ALTERNATIVES_AVAILABLE', 'AWAITING_CUSTOMER', 'REFUND_REQUIRED'].includes(booking.recovery_state ?? '')) {
      // Financial truth is already committed atomically. Keep the normal
      // fulfillment flow waiting until explicit customer acceptance emits
      // booking.confirmed; never send a false confirmation here.
      return { recoveryRequired: true, bookingId };
    }
  }
  const existing = await repository.findInstances({ workflowId: bookingId, tenantId: event.tenant_id });
  if (!existing[0]) {
    if (event.event_type === 'booking.held') return startDurableBookingFlow(event);
    throw new Error('FLOW_INSTANCE_NOT_FOUND');
  }
  return orchestrator.processEvent(existing[0].id, {
    eventId: event.id, eventType: event.event_type, schemaVersion: 1,
    occurredAt: new Date().toISOString(), tenantId: event.tenant_id, workflowId: bookingId,
    correlationId: event.correlation_id, causationId: event.causation_id,
    actor: { type: 'SYSTEM', id: 'durable-event-worker', tenantId: event.tenant_id }, payload: event.payload,
  });
}

async function queueNotification(userId: string, tenantId: string | null, title: string, body: string, idempotencyKey: string, payload: Record<string, unknown>, dueAt = new Date()) {
  if (!tenantId) throw new Error('PERMANENT:TENANT_REQUIRED');
  await insert('notifications', {
    tenant_id: tenantId, user_id: userId, channel: 'in_app', title, body, payload,
    status: 'QUEUED', next_attempt_at: dueAt.toISOString(), idempotency_key: idempotencyKey,
  }, 'idempotency_key');
}

async function resolveProviderUser(providerId: string) {
  const artisan = await selectOne<{ user_id: string }>('artisans', `id=eq.${encodeURIComponent(providerId)}&select=user_id`);
  return artisan.user_id;
}

async function selectOne<T>(table: string, query: string) {
  const rows = await request<T[]>(`/rest/v1/${table}?${query}&limit=1`);
  if (!rows[0]) throw new Error(`PERMANENT:${table.toUpperCase()}_NOT_FOUND`);
  return rows[0];
}

async function insert(table: string, value: unknown, conflict?: string) {
  const suffix = conflict ? `?on_conflict=${conflict}` : '';
  await request(`/rest/v1/${table}${suffix}`, {
    method: 'POST', headers: { Prefer: conflict ? 'resolution=ignore-duplicates,return=minimal' : 'return=minimal' }, body: JSON.stringify(value),
  });
}

export async function durableRequest<T = unknown>(path: string, init: RequestInit = {}) { return request<T>(path, init); }

async function request<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  if (!url || !serviceRoleKey) throw new Error('DEPENDENCY_UNAVAILABLE');
  const response = await fetch(`${url.replace(/\/$/,'')}${path}`, {
    ...init, cache: 'no-store', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw new Error(`SUPABASE_${response.status}:${await response.text()}`);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

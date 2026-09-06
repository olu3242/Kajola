import {
  DefaultGovernanceAdapter,
  DeterministicRuntime,
  HandlerRegistry,
  InMemoryFlowRepository,
  PersistentFlowOrchestrator,
  defineFlow,
  type FlowEvent,
  type FlowInstance,
  type WorkflowAdapter,
} from '@kajola/orchestration';
import { createNotification, scheduleWorkflow } from './domain-runtime';
import { store, type StoreBooking, type StoreDomainEvent, type StoreUser } from './store';

export const BOOKING_FLOW_KEY = 'kajola.booking.fulfilment';
export const BOOKING_FLOW_VERSION = 1;

export const bookingFlow = defineFlow({
  key: BOOKING_FLOW_KEY,
  version: BOOKING_FLOW_VERSION,
  name: 'Kajola booking fulfilment',
  flowTypes: ['SEQUENTIAL', 'CONDITIONAL', 'PARALLEL', 'FAN_OUT', 'FAN_IN', 'EVENT_DRIVEN', 'LONG_RUNNING', 'STATE_MACHINE', 'CHOREOGRAPHY_INTEROPERABILITY'],
  trigger: { event: 'booking.held' },
  requiredMilestones: ['booking_confirmed', 'service_completed'],
  nodes: [
    { id: 'start', type: 'START' },
    { id: 'schedule_hold_expiry', type: 'SYSTEM_TASK', handler: 'booking.schedule_hold_expiry', retryPolicy: 'FAST_INTERNAL_TASK' },
    { id: 'wait_confirmation', type: 'WAIT_EVENT', eventTypes: ['payment.succeeded', 'booking.confirmed'] },
    { id: 'payment_route', type: 'DECISION', handler: 'booking.resolve_payment_route' },
    { id: 'deposit_confirmed', type: 'CHECKPOINT', governancePolicy: 'booking.confirm', metadata: { milestone: 'booking_confirmed', evidenceRefs: ['payment'] } },
    { id: 'venue_confirmed', type: 'CHECKPOINT', governancePolicy: 'booking.confirm', metadata: { milestone: 'booking_confirmed', evidenceRefs: ['payment-policy'] } },
    { id: 'confirmation_fork', type: 'PARALLEL_FORK' },
    { id: 'notify_customer', type: 'AUTOMATION_TASK', handler: 'booking.notify_customer_confirmed' },
    { id: 'notify_provider', type: 'AUTOMATION_TASK', handler: 'booking.notify_provider_confirmed' },
    { id: 'schedule_reminders', type: 'SYSTEM_TASK', handler: 'booking.schedule_reminders' },
    { id: 'confirmation_join', type: 'PARALLEL_JOIN', joinPolicy: 'ALL' },
    { id: 'wait_completion', type: 'WAIT_EVENT', eventTypes: ['booking.completed'] },
    { id: 'completion_checkpoint', type: 'CHECKPOINT', governancePolicy: 'booking.complete', metadata: { milestone: 'service_completed', evidenceRefs: ['booking.completed'] } },
    { id: 'completion_fork', type: 'PARALLEL_FORK' },
    { id: 'request_review', type: 'AUTOMATION_TASK', handler: 'booking.request_review' },
    { id: 'prepare_settlement', type: 'SYSTEM_TASK', handler: 'booking.prepare_settlement' },
    { id: 'completion_join', type: 'PARALLEL_JOIN', joinPolicy: 'ALL' },
    { id: 'end', type: 'END' },
  ],
  edges: [
    { from: 'start', to: 'schedule_hold_expiry' },
    { from: 'schedule_hold_expiry', to: 'wait_confirmation' },
    { from: 'wait_confirmation', to: 'payment_route' },
    { from: 'payment_route', to: 'deposit_confirmed', condition: { contextPath: 'payment_route.route', equals: 'provider_payment' } },
    { from: 'payment_route', to: 'venue_confirmed', condition: { contextPath: 'payment_route.route', equals: 'pay_at_venue' } },
    { from: 'deposit_confirmed', to: 'confirmation_fork' },
    { from: 'venue_confirmed', to: 'confirmation_fork' },
    { from: 'confirmation_fork', to: 'notify_customer' },
    { from: 'confirmation_fork', to: 'notify_provider' },
    { from: 'confirmation_fork', to: 'schedule_reminders' },
    { from: 'notify_customer', to: 'confirmation_join' },
    { from: 'notify_provider', to: 'confirmation_join' },
    { from: 'schedule_reminders', to: 'confirmation_join' },
    { from: 'confirmation_join', to: 'wait_completion' },
    { from: 'wait_completion', to: 'completion_checkpoint' },
    { from: 'completion_checkpoint', to: 'completion_fork' },
    { from: 'completion_fork', to: 'request_review' },
    { from: 'completion_fork', to: 'prepare_settlement' },
    { from: 'request_review', to: 'completion_join' },
    { from: 'prepare_settlement', to: 'completion_join' },
    { from: 'completion_join', to: 'end' },
  ],
  active: true,
});

class BookingWorkflowAdapter implements WorkflowAdapter {
  async evaluateDefinitionOfDone(instance: FlowInstance) {
    const booking = store.bookings.find((candidate) => candidate.id === instance.workflowId);
    const milestones = new Set(instance.checkpoints.map((checkpoint) => checkpoint.key));
    const missingMilestones = ['booking_confirmed', 'service_completed'].filter((key) => !milestones.has(key));
    const openExceptions = booking?.status === 'disputed' ? ['booking_disputed'] : [];
    const blocked = !booking || openExceptions.length > 0;
    return {
      status: blocked ? 'BLOCKED' as const : missingMilestones.length || booking.status !== 'completed' ? 'INCOMPLETE' as const : 'COMPLETE' as const,
      missingMilestones,
      missingEvidence: booking ? [] : ['booking'],
      pendingApprovals: [],
      failedDependencies: [],
      openExceptions,
    };
  }
}

const globalFlow = globalThis as typeof globalThis & {
  __kajolaFlowRepository?: InMemoryFlowRepository;
  __kajolaFlowOrchestrator?: PersistentFlowOrchestrator;
  __kajolaBookingFlowReady?: Promise<void>;
};

function createOrchestrator() {
  const repository = globalFlow.__kajolaFlowRepository ?? new InMemoryFlowRepository();
  globalFlow.__kajolaFlowRepository = repository;
  const handlers = new HandlerRegistry();
  handlers.register('booking.schedule_hold_expiry', ({ context }: any) => {
    scheduleWorkflow(String(context.sourceEventId), 'expire_booking_hold', new Date(String(context.heldUntil)));
    return { scheduledFor: context.heldUntil };
  });
  handlers.register('booking.resolve_payment_route', ({ context }: any) => {
    const lastEvent = context.lastEvent as FlowEvent | undefined;
    return { route: lastEvent?.eventType === 'booking.confirmed' ? 'pay_at_venue' : 'provider_payment' };
  });
  handlers.register('booking.notify_customer_confirmed', ({ context }: any) => {
    createNotification(String(context.clientId), 'booking.confirmed', { booking_id: context.bookingId });
    return { recipient: context.clientId };
  });
  handlers.register('booking.notify_provider_confirmed', ({ context }: any) => {
    createNotification(String(context.providerId), 'booking.confirmed', { booking_id: context.bookingId });
    return { recipient: context.providerId };
  });
  handlers.register('booking.schedule_reminders', ({ context }: any) => {
    const event = context.lastEvent as FlowEvent | undefined;
    const startsAt = new Date(String(context.startsAt));
    scheduleWorkflow(event?.eventId ?? String(context.sourceEventId), 'appointment_reminder_24h', new Date(startsAt.getTime() - 24 * 60 * 60 * 1000));
    scheduleWorkflow(event?.eventId ?? String(context.sourceEventId), 'appointment_reminder_2h', new Date(startsAt.getTime() - 2 * 60 * 60 * 1000));
    return { reminders: 2 };
  });
  handlers.register('booking.request_review', ({ context }: any) => {
    createNotification(String(context.clientId), 'service.completed', { booking_id: context.bookingId, balance_due_kobo: context.balanceDueKobo });
    scheduleWorkflow(String((context.lastEvent as FlowEvent | undefined)?.eventId ?? context.sourceEventId), 'request_review_and_rebooking', new Date());
    return { requested: true };
  });
  handlers.register('booking.prepare_settlement', ({ context }: any) => ({ bookingId: context.bookingId, settlement: 'domain-owned' }));
  const runtime = new DeterministicRuntime(handlers);
  return new PersistentFlowOrchestrator(repository, runtime, new DefaultGovernanceAdapter(), undefined, new BookingWorkflowAdapter());
}

export const bookingOrchestrator = globalFlow.__kajolaFlowOrchestrator ?? createOrchestrator();
globalFlow.__kajolaFlowOrchestrator = bookingOrchestrator;

async function ready() {
  globalFlow.__kajolaBookingFlowReady ??= bookingOrchestrator.registerFlow(bookingFlow);
  await globalFlow.__kajolaBookingFlowReady;
}

function actor(user: StoreUser) {
  return { type: user.role === 'admin' ? 'OPERATOR' as const : 'USER' as const, id: user.id, tenantId: user.tenant_id, roles: [user.role] };
}

function toFlowEvent(event: StoreDomainEvent, user: StoreUser): FlowEvent {
  return {
    eventId: event.event_id,
    eventType: event.event_type,
    schemaVersion: event.version,
    occurredAt: event.occurred_at,
    tenantId: event.tenant_id,
    workflowId: event.aggregate_type === 'booking' ? event.aggregate_id : String(event.payload.booking_id ?? ''),
    correlationId: event.correlation_id,
    causationId: event.causation_id ?? undefined,
    actor: actor(user),
    payload: event.payload,
  };
}

export async function startBookingFlow(booking: StoreBooking, event: StoreDomainEvent, user: StoreUser) {
  await ready();
  const existing = await bookingOrchestrator.repository.findInstances({ workflowId: booking.id, tenantId: booking.tenant_id });
  if (existing.length) return existing[0];
  return bookingOrchestrator.startFlow({
    flowKey: BOOKING_FLOW_KEY,
    flowVersion: BOOKING_FLOW_VERSION,
    workflowType: 'booking',
    workflowId: booking.id,
    tenantId: booking.tenant_id,
    actor: actor(user),
    correlationId: event.correlation_id,
    causationId: event.event_id,
    context: {
      bookingId: booking.id,
      clientId: booking.client_id,
      providerId: booking.provider_id,
      startsAt: booking.starts_at,
      heldUntil: booking.held_until,
      balanceDueKobo: booking.balance_due_kobo,
      sourceEventId: event.event_id,
    },
  });
}

export async function processBookingFlowEvent(booking: StoreBooking, event: StoreDomainEvent, user: StoreUser) {
  await ready();
  const instances = await bookingOrchestrator.repository.findInstances({ workflowId: booking.id, tenantId: booking.tenant_id });
  if (event.event_type === 'payment.succeeded' && booking.booking_state === 'REQUIRES_RECOVERY') {
    return instances.map((instance) => instance);
  }
  const flowEvent = toFlowEvent(event, user);
  const active = instances.filter((instance) => !['COMPLETED', 'CANCELLED', 'COMPENSATED'].includes(instance.status));
  if (['cancelled', 'no_show', 'disputed'].includes(booking.status)) {
    return Promise.all(active.map((instance) => bookingOrchestrator.cancelFlow(instance.id, actor(user), `Booking entered terminal state ${booking.status}`)));
  }
  return Promise.all(active.map((instance) => bookingOrchestrator.processEvent(instance.id, flowEvent)));
}

export async function listBookingFlows(input: { tenantId?: string | null; status?: string } = {}) {
  await ready();
  return bookingOrchestrator.repository.findInstances(input);
}

export async function getBookingFlowTrace(flowInstanceId: string) {
  await ready();
  const instance = await bookingOrchestrator.repository.getInstance(flowInstanceId);
  if (!instance) return null;
  return { instance, audit: await bookingOrchestrator.repository.listAudit(flowInstanceId) };
}

import { randomUUID } from 'crypto';
import {
  store,
  generateSlots,
  assertTenant,
  StoreBooking,
  StoreGratuity,
  StoreProvider,
  StoreReview,
  StoreService,
  StoreUser,
  BookingStatus,
} from './store';
import { buildCommerceSnapshot, DEFAULT_COMMERCE_POLICY, depositFor, quoteCheckout, type PaymentArrangement, type PaymentMethod, type PaymentPurpose } from './commerce';
import { authorizeAgentAction, evaluateSettlementEligibility, reconcilePayment, settlementCommand } from './marketplace-operations';
import { findCategory, searchableText } from './service-taxonomy';
import { locationSlug } from './nigeria-locations';
import { createNotification, recordDomainChange } from './domain-runtime';
import { processBookingFlowEvent, startBookingFlow } from './booking-flow';

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function handleLogin(body: {
  phone: string;
  otp: string;
}): Promise<{ ok: boolean; user?: StoreUser; error?: string }> {
  if (body.otp !== '123456') {
    return { ok: false, error: 'Invalid OTP' };
  }
  const user = store.users.find((u) => u.phone === body.phone);
  if (!user) {
    return { ok: false, error: 'Phone number not found' };
  }
  return { ok: true, user };
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

export function searchProviders(params: {
  city?: string;
  category?: string;
  q?: string;
  minRating?: number;
  maxPriceKobo?: number;
  limit?: number;
}): { providers: StoreProvider[]; related: boolean } {
  let result = [...store.providers];
  if (params.city) {
    const city = params.city.toLowerCase();
    result = result.filter((p) => p.city.toLowerCase() === city || locationSlug(p.state) === city);
  }
  if (params.category) {
    const selected = findCategory(params.category);
    const terms = selected ? [selected.id, selected.label, ...selected.aliases] : [params.category];
    result = result.filter((provider) => {
      const services = store.services.filter((item) => item.provider_id === provider.id && item.is_active);
      if (selected && services.some((item) => item.category_id === selected.id)) return true;
      const text = searchableText([provider.category, provider.business_name, provider.about, ...(provider.specialties ?? []), ...services.flatMap((item) => [item.name, item.service_type, ...(item.aliases ?? [])])]);
      return terms.some((term) => text.includes(term.toLowerCase()));
    });
  }
  if (params.q?.trim()) {
    const tokens = params.q.toLowerCase().split(/\s+/).filter(Boolean);
    result = result.filter((provider) => {
      const services = store.services.filter((item) => item.provider_id === provider.id && item.is_active);
      const text = searchableText([provider.full_name, provider.business_name, provider.category, provider.about, provider.city, provider.state, ...(provider.specialties ?? []), ...services.flatMap((item) => [item.name, item.service_type, ...(item.aliases ?? [])])]);
      return tokens.every((token) => text.includes(token));
    });
  }
  if (params.minRating) {
    result = result.filter((provider) => provider.avg_rating >= params.minRating!);
  }
  if (params.maxPriceKobo) {
    result = result.filter((provider) => store.services.some((service) => service.provider_id === provider.id && service.is_active && service.price_kobo <= params.maxPriceKobo!));
  }

  let related = false;
  if (result.length === 0 && (params.q || params.category)) {
    related = true;
    const fallbackTerms = `${params.q ?? ''} ${params.category ?? ''}`.toLowerCase().split(/\s+/).filter((term) => term.length > 2);
    const fallbackProviders = params.city ? store.providers.filter((provider) => provider.city.toLowerCase() === params.city!.toLowerCase() || locationSlug(provider.state) === params.city!.toLowerCase()) : [...store.providers];
    result = fallbackProviders.sort((a, b) => {
      const score = (provider: StoreProvider) => {
        const services = store.services.filter((item) => item.provider_id === provider.id);
        const text = searchableText([provider.business_name, provider.category, provider.about, ...(provider.specialties ?? []), ...services.map((item) => item.name)]);
        return fallbackTerms.filter((term) => text.includes(term)).length;
      };
      return score(b) - score(a);
    }).slice(0, 4);
  }
  if (params.limit && params.limit > 0) {
    result = result.slice(0, params.limit);
  }
  return { providers: result, related };
}

export function getProvider(id: string): StoreProvider | null {
  return store.providers.find((p) => p.id === id) ?? null;
}

export function getProviderServices(providerId: string): StoreService[] {
  return store.services.filter((s) => s.provider_id === providerId && s.is_active);
}

export function saveProviderOnboarding(user: StoreUser, body: Record<string, unknown>): { provider?: StoreProvider; error?: string } {
  if (user.role !== 'artisan') return { error: 'Forbidden: artisan role required' };
  const provider = store.providers.find((item) => item.id === user.id);
  if (!provider) return { error: 'Provider profile not found' };
  const businessType = String(body.business_type ?? '').trim();
  const customBusinessType = String(body.custom_business_type ?? '').trim();
  if (!businessType) return { error: 'Business type is required' };
  if (businessType === 'other' && !customBusinessType) return { error: 'Tell us what your business does' };
  provider.business_name = String(body.business_name ?? provider.business_name).trim() || provider.business_name;
  provider.category = String(body.business_category ?? body.category ?? provider.category).trim() || provider.category;
  provider.business_category = String(body.business_category ?? body.category ?? provider.category);
  provider.business_type = businessType;
  provider.custom_business_type = customBusinessType;
  provider.about = String(body.description ?? provider.about ?? '');
  provider.city = String(body.city ?? provider.city);
  provider.image_url = String(body.profile_photo_url ?? provider.image_url) || provider.image_url;
  return { provider };
}

export function addProviderServices(user: StoreUser, input: Array<Record<string, unknown>>): { services?: StoreService[]; error?: string } {
  if (user.role !== 'artisan' || !user.tenant_id) return { error: 'Forbidden: artisan role required' };
  const created = input.filter((item) => String(item.name ?? '').trim()).map((item) => ({
    id: randomUUID(), provider_id: user.id, tenant_id: user.tenant_id!, name: String(item.name).trim(),
    duration_minutes: Math.max(15, Number(item.duration_minutes) || 60), price_kobo: Math.max(0, Number(item.price_kobo ?? item.price_cents) || 0),
    is_active: true, category_id: item.category_id ? String(item.category_id) : undefined, service_type: item.service_type ? String(item.service_type) : undefined,
  }));
  store.services.push(...created);
  return { services: created };
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export function getAvailableSlots(
  providerId: string,
  serviceId: string,
): Array<{ id: string; starts_at: string; ends_at: string; available: boolean }> {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const raw = generateSlots(providerId, serviceId, tomorrow);
  return raw.map((s, idx) => ({ id: `slot-${idx}`, ...s }));
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES: BookingStatus[] = [
  'held',
  'awaiting_payment',
  'confirmed',
  'checked_in',
  'in_progress',
];

export async function holdSlot(
  user: StoreUser,
  body: {
    provider_id: string;
    service_id: string;
    starts_at: string;
    ends_at: string;
  },
): Promise<{ booking?: StoreBooking; error?: string }> {
  const service = store.services.find(
    (s) => s.id === body.service_id && s.provider_id === body.provider_id,
  );
  if (!service) {
    return { error: 'Service not found for this provider' };
  }

  const provider = store.providers.find((p) => p.id === body.provider_id);
  if (!provider) {
    return { error: 'Provider not found' };
  }

  const slotStart = new Date(body.starts_at).getTime();
  const slotEnd = new Date(body.ends_at).getTime();

  // Local/test mode mirrors the durable expiry transition. Connected modes use
  // release_expired_slot_holds under the worker lease.
  for (const candidate of store.bookings) {
    if (candidate.hold_state === 'ACTIVE' && candidate.held_until && new Date(candidate.held_until).getTime() <= Date.now()) {
      candidate.status = 'expired';
      candidate.booking_state = 'EXPIRED';
      candidate.hold_state = 'EXPIRED';
      candidate.fulfillment_state = 'NOT_SCHEDULED';
      candidate.settlement_status = 'not_due';
      candidate.settlement_state = 'NOT_ELIGIBLE';
    }
  }

  // Conflict check
  const conflict = store.bookings.find((b) => {
    if (b.provider_id !== body.provider_id) return false;
    if (!ACTIVE_STATUSES.includes(b.status)) return false;
    const bStart = new Date(b.starts_at).getTime();
    const bEnd = new Date(b.ends_at).getTime();
    return slotStart < bEnd && slotEnd > bStart;
  });

  if (conflict) {
    return { error: 'Slot already taken' };
  }

  const now = new Date();
  const heldUntil = new Date(now.getTime() + 5 * 60 * 1000);

  const booking: StoreBooking = {
    id: randomUUID(),
    tenant_id: provider.tenant_id,
    provider_id: body.provider_id,
    client_id: user.id,
    service_id: body.service_id,
    staff_id: body.provider_id, // provider IS the staff in this MVP
    status: 'held',
    starts_at: body.starts_at,
    ends_at: body.ends_at,
    held_until: heldUntil.toISOString(),
    held_at: now.toISOString(),
    booking_state: 'HELD',
    payment_state: 'INTENT_REQUIRED',
    hold_state: 'ACTIVE',
    fulfillment_state: 'NOT_SCHEDULED',
    settlement_state: 'NOT_ELIGIBLE',
    recovery_state: 'NONE',
    total_amount_kobo: service.price_kobo,
    deposit_amount_kobo: depositFor(service.price_kobo, provider.payment_policy ?? DEFAULT_COMMERCE_POLICY),
    deposit_paid_at: null,
    idempotency_key: randomUUID(),
    created_at: now.toISOString(),
    payment_ref: null,
    payment_status: 'unpaid',
    settlement_status: 'not_due',
    amount_paid_kobo: 0,
    balance_due_kobo: service.price_kobo,
    commerce_policy_version: (provider.payment_policy ?? DEFAULT_COMMERCE_POLICY).version,
    refund_state: 'NONE',
    reconciliation_state: 'NOT_REQUIRED',
    risk_state: 'PASSED',
  };

  store.bookings.push(booking);
  const holdEvent = recordDomainChange({ eventType: 'booking.held', actor: user, tenantId: provider.tenant_id, aggregateType: 'booking', aggregateId: booking.id, newState: { status: booking.status, held_until: booking.held_until }, payload: { provider_id: booking.provider_id, service_id: booking.service_id, starts_at: booking.starts_at } });
  const flow = await startBookingFlow(booking, holdEvent, user);
  booking.flow_instance_id = flow.id;
  return { booking };
}

export async function initPayment(
  user: StoreUser,
  bookingId: string,
  method: PaymentMethod = 'bank_transfer',
  purpose?: Exclude<PaymentPurpose, 'tip'>,
): Promise<{ reference: string; authorization_url: string; error?: string }> {
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking) {
    return { reference: '', authorization_url: '', error: 'Booking not found' };
  }
  if (booking.client_id !== user.id && user.role !== 'owner') {
    return { reference: '', authorization_url: '', error: 'Forbidden' };
  }

  const provider = store.providers.find((item) => item.id === booking.provider_id);
  const policy = provider?.payment_policy ?? DEFAULT_COMMERCE_POLICY;
  if (!policy.allowed_methods.includes(method) || (method === 'pay_at_venue' && !policy.pay_at_venue_enabled)) {
    return { reference: '', authorization_url: '', error: 'Payment method is not available for this business' };
  }
  const quote = quoteCheckout({
    totalKobo: booking.total_amount_kobo,
    paidKobo: booking.amount_paid_kobo,
    policy,
    purpose,
    // Provider fee data is injected server-side when configured. Zero is the
    // safe local-mode value and is never trusted from the browser.
    gatewayFeeKobo: Number(process.env.KAJOLA_GATEWAY_FEE_KOBO ?? 0),
  });
  if (quote.subtotal_due_kobo <= 0) {
    return { reference: '', authorization_url: '', error: 'No payment is due for this booking' };
  }

  const offline = method === 'pay_at_venue' || method === 'cash';
  const arrangement: PaymentArrangement = method === 'cash' ? 'CASH'
    : method === 'pay_at_venue' ? 'PAY_AT_SERVICE'
    : quote.purpose === 'deposit' ? 'DEPOSIT'
    : quote.purpose === 'balance' ? 'PARTIAL' : 'FULL';
  booking.commerce_snapshot = buildCommerceSnapshot({
    serviceBaseKobo: booking.total_amount_kobo,
    processingCostKobo: quote.gateway_fee_kobo,
    amountPaidKobo: booking.amount_paid_kobo,
    amountDueNowKobo: offline ? 0 : quote.subtotal_due_kobo,
    arrangement, method, policy,
  });

  const existing = store.payments.find((item) => item.booking_id === bookingId && item.method === method && item.purpose === quote.purpose && item.status !== 'failed');
  if (existing) return { reference: existing.reference, authorization_url: offline ? `/dashboard/bookings/${bookingId}?payment=offline` : `/payment/callback?reference=${existing.reference}&bookingId=${bookingId}` };

  const reference = `${offline ? 'OFFLINE' : 'PAY'}-${randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;

  const payment = {
    id: randomUUID(),
    booking_id: bookingId,
    reference,
    amount_kobo: quote.customer_total_kobo,
    status: 'pending' as const,
    created_at: new Date().toISOString(),
    method,
    purpose: quote.purpose,
    subtotal_kobo: quote.subtotal_due_kobo,
    gateway_fee_kobo: quote.gateway_fee_kobo,
    platform_fee_kobo: quote.platform_fee_kobo,
    provider_net_kobo: quote.provider_net_kobo,
    policy_version: quote.policy_version,
    arrangement,
    verification_state: 'PENDING' as const,
  };
  store.payments.push(payment);

  // Update booking status
  const isInitialConfirmation = ['held', 'awaiting_payment'].includes(booking.status);
  if (isInitialConfirmation) booking.status = 'awaiting_payment';
  if (isInitialConfirmation) booking.booking_state = 'PENDING_PAYMENT';
  booking.payment_state = 'INTENT_CREATED';
  booking.payment_status = 'pending';
  booking.payment_ref = reference;

  if (offline) {
    booking.status = 'confirmed';
    booking.booking_state = 'CONFIRMED';
    booking.hold_state = 'CONVERTED';
    booking.fulfillment_state = 'SCHEDULED';
    booking.payment_state = 'NOT_REQUIRED';
    booking.settlement_state = 'PENDING_ELIGIBILITY';
    booking.payment_status = booking.amount_paid_kobo > 0 ? 'partially_paid' : 'unpaid';
  }
  recordDomainChange({ eventType: 'payment.intent_created', actor: user, tenantId: booking.tenant_id, aggregateType: 'payment', aggregateId: payment.id, newState: { status: payment.status }, payload: { booking_id: booking.id, reference, method, purpose: payment.purpose, amount_kobo: payment.amount_kobo } });
  if (offline) {
    const confirmationEvent = recordDomainChange({ eventType: 'booking.confirmed', actor: user, tenantId: booking.tenant_id, aggregateType: 'booking', aggregateId: booking.id, newState: { status: booking.status, payment_status: booking.payment_status }, payload: { booking_id: booking.id, method } });
    await processBookingFlowEvent(booking, confirmationEvent, user);
  }

  return {
    reference,
    authorization_url: offline
      ? `/dashboard/bookings/${bookingId}?payment=offline`
      : `/payment/callback?reference=${reference}&bookingId=${bookingId}`,
  };
}

export async function verifyPayment(
  user: StoreUser,
  reference: string,
  bookingId: string,
): Promise<{ success: boolean; booking?: StoreBooking; error?: string }> {
  const payment = store.payments.find((p) => p.reference === reference);
  if (!payment) {
    return { success: false, error: 'Payment reference not found' };
  }

  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking) {
    return { success: false, error: 'Booking not found' };
  }

  if (booking.client_id !== user.id && user.role !== 'owner') {
    return { success: false, error: 'Forbidden' };
  }

  if (payment.booking_id !== booking.id) return { success: false, error: 'Payment does not match booking' };
  if (payment.status === 'success') return { success: true, booking };

  payment.status = 'success';
  booking.amount_paid_kobo = Math.min(booking.total_amount_kobo, booking.amount_paid_kobo + payment.subtotal_kobo);
  booking.balance_due_kobo = Math.max(0, booking.total_amount_kobo - booking.amount_paid_kobo);
  booking.payment_status = booking.balance_due_kobo === 0 ? 'paid' : 'partially_paid';
  booking.payment_state = 'CONFIRMED';
  const requiresHoldConversion = payment.purpose !== 'balance' && ['held', 'awaiting_payment', 'expired'].includes(booking.status);
  const holdStillOwned = !requiresHoldConversion || (booking.hold_state === 'ACTIVE' && !!booking.held_until
    && new Date(booking.held_until).getTime() > Date.now()
    && ['held', 'awaiting_payment'].includes(booking.status));
  booking.settlement_status = holdStillOwned ? 'pending' : 'not_due';
  booking.settlement_state = holdStillOwned ? 'PENDING_ELIGIBILITY' : 'HELD';
  if (payment.purpose === 'deposit') booking.deposit_paid_at = new Date().toISOString();
  const confirmsBooking = requiresHoldConversion && holdStillOwned;
  if (confirmsBooking) {
    booking.status = 'confirmed';
    booking.booking_state = 'CONFIRMED';
    booking.hold_state = 'CONVERTED';
    booking.fulfillment_state = 'SCHEDULED';
  } else if (requiresHoldConversion) {
    booking.status = 'requires_recovery';
    booking.booking_state = 'REQUIRES_RECOVERY';
    booking.hold_state = 'EXPIRED';
    booking.fulfillment_state = 'NOT_SCHEDULED';
    booking.recovery_state = 'AWAITING_CUSTOMER';
    booking.settlement_status = 'not_due';
    booking.settlement_state = 'HELD';
    const alternatives = getAvailableSlots(booking.provider_id, booking.service_id).filter((slot) => slot.available).slice(0, 5);
    if (!store.recoveryCases.some((item) => item.booking_id === booking.id)) {
      const recoveryId = randomUUID();
      store.recoveryCases.push({
        id: recoveryId, booking_id: booking.id, payment_id: payment.id, state: 'AWAITING_CUSTOMER',
        failure_reason: 'LATE_PAYMENT_AFTER_HOLD_EXPIRY', policy_version: 'recovery-v1', created_at: new Date().toISOString(),
        recommendations: alternatives.map((slot, index) => ({ id: randomUUID(), recovery_case_id: recoveryId,
          provider_id: booking.provider_id, starts_at: slot.starts_at, ends_at: slot.ends_at, rank: index + 1, status: 'OFFERED' })),
      });
    }
  }

  const createdAt = new Date().toISOString();
  store.ledger.push(
    { id: randomUUID(), booking_id: booking.id, payment_id: payment.id, account: 'customer', direction: 'debit', amount_kobo: payment.amount_kobo, event: 'payment_succeeded', created_at: createdAt, idempotency_key: `payment:${payment.id}:customer` },
    { id: randomUUID(), booking_id: booking.id, payment_id: payment.id, account: 'provider', direction: 'credit', amount_kobo: payment.provider_net_kobo, event: 'payment_succeeded', created_at: createdAt, idempotency_key: `payment:${payment.id}:provider` },
  );
  if (payment.platform_fee_kobo > 0) store.ledger.push({ id: randomUUID(), booking_id: booking.id, payment_id: payment.id, account: 'platform', direction: 'credit', amount_kobo: payment.platform_fee_kobo, event: 'payment_succeeded', created_at: createdAt });
  if (payment.gateway_fee_kobo > 0) store.ledger.push({ id: randomUUID(), booking_id: booking.id, payment_id: payment.id, account: 'gateway', direction: 'credit', amount_kobo: payment.gateway_fee_kobo, event: 'payment_succeeded', created_at: createdAt });
  const paymentEvent = recordDomainChange({ eventType: 'payment.succeeded', actor: user, tenantId: booking.tenant_id, aggregateType: 'payment', aggregateId: payment.id, oldState: { status: 'pending' }, newState: { status: payment.status }, payload: { booking_id: booking.id, amount_kobo: payment.amount_kobo, purpose: payment.purpose } });
  if (confirmsBooking) {
    recordDomainChange({ eventType: 'booking.confirmed', actor: user, tenantId: booking.tenant_id, aggregateType: 'booking', aggregateId: booking.id, newState: { status: booking.status, payment_status: booking.payment_status }, correlationId: paymentEvent.correlation_id });
  }
  await processBookingFlowEvent(booking, paymentEvent, user);

  return { success: true, booking };
}

export function getRecoveryCase(user: StoreUser, bookingId: string) {
  const booking = store.bookings.find((item) => item.id === bookingId);
  if (!booking || (user.role === 'client' && booking.client_id !== user.id)) return null;
  if (user.role !== 'client' && user.role !== 'admin' && booking.tenant_id !== user.tenant_id) return null;
  return store.recoveryCases.find((item) => item.booking_id === bookingId) ?? null;
}

export async function acceptRecoveryRecommendation(user: StoreUser, recoveryCaseId: string, recommendationId: string) {
  const recovery = store.recoveryCases.find((item) => item.id === recoveryCaseId);
  const booking = recovery && store.bookings.find((item) => item.id === recovery.booking_id);
  if (!recovery || !booking) return { error: 'Recovery case not found' };
  if (user.role !== 'client' || booking.client_id !== user.id) return { error: 'Forbidden' };
  if (recovery.state === 'ACCEPTED') return { booking, recovery };
  const recommendation = recovery.recommendations.find((item) => item.id === recommendationId && item.status === 'OFFERED');
  if (!recommendation) return { error: 'Recommendation is not available' };
  const conflict = store.bookings.some((item) => item.id !== booking.id && item.provider_id === recommendation.provider_id
    && ACTIVE_STATUSES.includes(item.status) && new Date(recommendation.starts_at) < new Date(item.ends_at)
    && new Date(recommendation.ends_at) > new Date(item.starts_at));
  if (conflict) return { error: 'Replacement slot is no longer available' };
  booking.starts_at = recommendation.starts_at; booking.ends_at = recommendation.ends_at;
  booking.status = 'confirmed'; booking.booking_state = 'CONFIRMED'; booking.hold_state = 'CONVERTED';
  booking.fulfillment_state = 'SCHEDULED'; booking.recovery_state = 'ACCEPTED'; booking.settlement_status = 'pending';
  booking.settlement_state = 'PENDING_ELIGIBILITY';
  recovery.state = 'ACCEPTED'; recommendation.status = 'ACCEPTED';
  recovery.recommendations.filter((item) => item.id !== recommendation.id).forEach((item) => { item.status = 'REJECTED'; });
  const event = recordDomainChange({ eventType: 'booking.confirmed', actor: user, tenantId: booking.tenant_id,
    aggregateType: 'booking', aggregateId: booking.id, newState: { booking_state: booking.booking_state,
      recovery_state: booking.recovery_state, starts_at: booking.starts_at }, payload: { recovery_case_id: recovery.id, recommendation_id: recommendation.id } });
  await processBookingFlowEvent(booking, event, user);
  return { booking, recovery };
}

export function requestRecoveryRefund(user: StoreUser, recoveryCaseId: string) {
  const recovery = store.recoveryCases.find((item) => item.id === recoveryCaseId);
  const booking = recovery && store.bookings.find((item) => item.id === recovery.booking_id);
  if (!recovery || !booking) return { error: 'Recovery case not found' };
  if (user.role !== 'client' || booking.client_id !== user.id) return { error: 'Forbidden' };
  recovery.state = 'REFUND_REQUIRED'; booking.recovery_state = 'REFUND_REQUIRED';
  booking.payment_state = 'REFUND_PENDING'; booking.settlement_state = 'HELD';
  const idempotency_key = `recovery-refund:${booking.id}:${recovery.id}:${recovery.policy_version}`;
  if (!store.events.some((event) => event.event_type === 'recovery.refund.requested' && event.payload.idempotency_key === idempotency_key)) {
    recordDomainChange({ eventType: 'recovery.refund.requested', actor: user, tenantId: booking.tenant_id,
      aggregateType: 'booking', aggregateId: booking.id, newState: { recovery_state: booking.recovery_state,
        payment_state: booking.payment_state, settlement_state: booking.settlement_state }, payload: { recovery_case_id: recovery.id, idempotency_key } });
  }
  return { refund: { status: 'REFUND_REQUESTED', idempotency_key } };
}

export function listBookings(user: StoreUser): StoreBooking[] {
  if (user.role === 'client') {
    return store.bookings.filter((b) => b.client_id === user.id);
  }
  if (user.role === 'artisan') {
    return store.bookings.filter((b) => b.provider_id === user.id);
  }
  // owner: bookings in their tenant
  return store.bookings.filter((b) => b.tenant_id === user.tenant_id);
}

// Artisan allowed transitions
const ARTISAN_TRANSITIONS: Record<string, BookingStatus> = {
  confirmed: 'checked_in',
  checked_in: 'in_progress',
  in_progress: 'completed',
};

// Client allowed source statuses for cancellation
const CLIENT_CANCELLABLE: BookingStatus[] = ['held', 'awaiting_payment', 'confirmed'];

export async function updateBookingStatus(
  user: StoreUser,
  bookingId: string,
  newStatus: string,
): Promise<{ booking?: StoreBooking; error?: string }> {
  const booking = store.bookings.find((b) => b.id === bookingId);
  if (!booking) {
    return { error: 'Booking not found' };
  }

  // Tenant isolation check (clients exempt)
  if (user.role !== 'client' && !assertTenant(user, booking.tenant_id)) {
    return { error: 'Forbidden: tenant mismatch' };
  }

  const current = booking.status;
  if (current === newStatus) return { booking };

  if (user.role === 'artisan') {
    if (newStatus === 'cancelled') {
      if (!['confirmed','checked_in'].includes(current)) return { error: `Cannot cancel booking from ${current}` };
    } else if (newStatus === 'acknowledged') {
      if (current !== 'confirmed' || booking.fulfillment_state !== 'SCHEDULED') return { error: `Cannot acknowledge booking from ${current}` };
    } else if (newStatus === 'no_show') {
      if (current !== 'in_progress' && current !== 'confirmed') {
        return { error: `Cannot transition from ${current} to no_show` };
      }
    } else {
      const allowed = ARTISAN_TRANSITIONS[current];
      if (!allowed || allowed !== (newStatus as BookingStatus)) {
        return { error: `Artisan cannot transition from ${current} to ${newStatus}` };
      }
    }
    // Verify artisan owns this booking
    if (booking.provider_id !== user.id) {
      return { error: 'Forbidden: not your booking' };
    }
  } else if (user.role === 'client') {
    if (newStatus !== 'cancelled') {
      return { error: 'Clients may only cancel bookings' };
    }
    if (!CLIENT_CANCELLABLE.includes(current)) {
      return { error: `Cannot cancel a booking with status ${current}` };
    }
    if (booking.client_id !== user.id) {
      return { error: 'Forbidden: not your booking' };
    }
  } else if (user.role === 'owner') {
    // Owner can do any transition within their tenant — no additional restriction
    if (booking.tenant_id !== user.tenant_id) {
      return { error: 'Forbidden: tenant mismatch' };
    }
  }

  if (newStatus !== 'acknowledged') booking.status = newStatus as BookingStatus;
  if (newStatus === 'cancelled') {
    booking.booking_state = 'CANCELLED'; booking.hold_state = 'RELEASED'; booking.fulfillment_state = 'CANCELLED';
    booking.settlement_state = 'HELD';
    if (user.role === 'artisan') {
      booking.recovery_state = 'REQUIRED';
      if (!store.recoveryCases.some((item) => item.booking_id === booking.id && item.failure_reason === 'PROVIDER_CANCELLATION')) {
        const payment = store.payments.find((item) => item.booking_id === booking.id && item.status === 'success');
        store.recoveryCases.push({ id: randomUUID(), booking_id: booking.id, payment_id: payment?.id ?? '', state: 'REQUIRED',
          failure_reason: 'PROVIDER_CANCELLATION', policy_version: 'recovery-v1', recommendations: [], created_at: new Date().toISOString() });
      }
      createNotification(booking.client_id, 'booking.provider_cancelled', { booking_id: booking.id, recovery_state: 'REQUIRED' });
    }
  } else if (newStatus === 'acknowledged') booking.fulfillment_state = 'PROVIDER_ACKNOWLEDGED';
  else if (newStatus === 'checked_in') booking.fulfillment_state = 'CUSTOMER_CHECKED_IN';
  else if (newStatus === 'in_progress') booking.fulfillment_state = 'IN_PROGRESS';
  else if (newStatus === 'completed') { booking.booking_state = 'COMPLETED'; booking.fulfillment_state = 'COMPLETED'; }
  else if (newStatus === 'no_show') booking.fulfillment_state = 'NO_SHOW';
  const eventName: Record<string, string> = { acknowledged: 'booking.acknowledged', cancelled: 'booking.cancelled', checked_in: 'booking.checked_in', in_progress: 'booking.started', completed: 'booking.completed', no_show: 'booking.no_show' };
  const event = recordDomainChange({ eventType: eventName[newStatus] ?? 'booking.updated', actor: user, tenantId: booking.tenant_id, aggregateType: 'booking', aggregateId: booking.id, oldState: { status: current }, newState: { status: booking.status } });
  if (newStatus === 'completed') {
    const eligibility = evaluateSettlementEligibility({
      paymentConfirmed: booking.payment_status === 'paid', fulfillmentState: booking.fulfillment_state,
      activeRefund: !['NONE', 'FAILED'].includes(booking.refund_state ?? 'NONE'),
      activeDispute: booking.status === 'disputed', activeRecovery: !['NONE', 'RESOLVED', 'ACCEPTED'].includes(booking.recovery_state),
      providerEligible: true, riskPassed: booking.risk_state === 'PASSED',
    });
    booking.settlement_state = eligibility.state;
    booking.settlement_status = eligibility.eligible ? 'available' : 'not_due';
  }
  await processBookingFlowEvent(booking, event, user);

  return { booking };
}

// ---------------------------------------------------------------------------
// Reviews & Gratuities
// ---------------------------------------------------------------------------

export async function submitReview(
  user: StoreUser,
  body: { booking_id: string; rating: number; comment: string },
): Promise<{ review?: StoreReview; error?: string }> {
  const booking = store.bookings.find((b) => b.id === body.booking_id);
  if (!booking) return { error: 'Booking not found' };
  if (booking.client_id !== user.id) return { error: 'Forbidden: not your booking' };
  if (booking.status !== 'completed') return { error: 'Can only review completed bookings' };

  const existing = store.reviews.find((r) => r.booking_id === body.booking_id);
  if (existing) return { error: 'Review already submitted for this booking' };

  if (body.rating < 1 || body.rating > 5) return { error: 'Rating must be between 1 and 5' };

  const review: StoreReview = {
    id: randomUUID(),
    booking_id: body.booking_id,
    provider_id: booking.provider_id,
    client_id: user.id,
    rating: body.rating,
    comment: body.comment,
    created_at: new Date().toISOString(),
  };
  store.reviews.push(review);
  recordDomainChange({ eventType: 'review.submitted', actor: user, tenantId: booking.tenant_id, aggregateType: 'review', aggregateId: review.id, newState: { rating: review.rating }, payload: { booking_id: booking.id } });

  // Update provider aggregate
  const provider = store.providers.find((p) => p.id === booking.provider_id);
  if (provider) {
    const total = provider.total_reviews + 1;
    provider.avg_rating =
      Math.round(((provider.avg_rating * provider.total_reviews + body.rating) / total) * 10) / 10;
    provider.total_reviews = total;
  }

  return { review };
}

export async function submitGratuity(
  user: StoreUser,
  body: { booking_id: string; amount_kobo: number; message?: string },
): Promise<{ gratuity?: StoreGratuity; error?: string }> {
  const booking = store.bookings.find((b) => b.id === body.booking_id);
  if (!booking) return { error: 'Booking not found' };
  if (booking.client_id !== user.id) return { error: 'Forbidden: not your booking' };
  if (booking.status !== 'completed') return { error: 'Can only tip for completed bookings' };
  if (body.amount_kobo <= 0) return { error: 'Tip amount must be positive' };
  const existing = store.gratuities.find((item) => item.booking_id === body.booking_id);
  if (existing) return { gratuity: existing };

  const gratuity: StoreGratuity = {
    id: randomUUID(),
    booking_id: body.booking_id,
    provider_id: booking.provider_id,
    client_id: user.id,
    amount_kobo: body.amount_kobo,
    message: body.message ?? '',
    created_at: new Date().toISOString(),
    payment_status: 'CONFIRMED',
    provider_entitlement_kobo: body.amount_kobo,
    settlement_state: 'ELIGIBLE',
  };
  store.gratuities.push(gratuity);
  store.ledger.push(
    { id: randomUUID(), booking_id: booking.id, payment_id: gratuity.id, account: 'customer', direction: 'debit', amount_kobo: gratuity.amount_kobo, event: 'tip_succeeded', created_at: gratuity.created_at },
    { id: randomUUID(), booking_id: booking.id, payment_id: gratuity.id, account: 'provider', direction: 'credit', amount_kobo: gratuity.amount_kobo, event: 'tip_succeeded', created_at: gratuity.created_at },
  );
  recordDomainChange({ eventType: 'gratuity.received', actor: user, tenantId: booking.tenant_id, aggregateType: 'gratuity', aggregateId: gratuity.id, newState: { amount_kobo: gratuity.amount_kobo }, payload: { booking_id: booking.id, provider_id: booking.provider_id } });
  createNotification(booking.provider_id, 'gratuity.received', { booking_id: booking.id, amount_kobo: gratuity.amount_kobo });
  return { gratuity };
}

export function queueLocalSettlement(user: StoreUser, bookingId: string) {
  const booking = store.bookings.find((item) => item.id === bookingId);
  if (!booking) return { error: 'Booking not found' };
  if (user.role === 'client' || (user.role !== 'admin' && booking.tenant_id !== user.tenant_id && booking.provider_id !== user.id)) return { error: 'Forbidden' };
  const eligibility = evaluateSettlementEligibility({ paymentConfirmed: booking.payment_status === 'paid',
    fulfillmentState: booking.fulfillment_state, activeRefund: !['NONE','FAILED'].includes(booking.refund_state ?? 'NONE'),
    activeDispute: booking.status === 'disputed', activeRecovery: !['NONE','RESOLVED','ACCEPTED'].includes(booking.recovery_state),
    providerEligible: true, riskPassed: booking.risk_state === 'PASSED' });
  if (!eligibility.eligible) return { error: `Settlement blocked: ${eligibility.blockers.join(',')}`, eligibility };
  const existing = store.settlements.find((item) => item.booking_id === booking.id);
  if (existing) return { settlement: existing, cached: true };
  const tips = store.gratuities.filter((item) => item.booking_id === booking.id && item.payment_status === 'CONFIRMED').reduce((sum, item) => sum + item.amount_kobo, 0);
  const amountKobo = (booking.commerce_snapshot?.provider_net_entitlement ?? booking.total_amount_kobo) + tips;
  const command = settlementCommand({ bookingId: booking.id, providerId: booking.provider_id, amountKobo });
  const settlement = { id: randomUUID(), booking_id: booking.id, provider_id: booking.provider_id, tenant_id: booking.tenant_id,
    amount_kobo: amountKobo, state: 'QUEUED' as const, idempotency_key: command.idempotencyKey, attempts: 0, created_at: new Date().toISOString() };
  store.settlements.push(settlement);
  booking.settlement_state = 'QUEUED'; booking.settlement_status = 'pending';
  recordDomainChange({ eventType: 'settlement.queued', actor: user, tenantId: booking.tenant_id, aggregateType: 'settlement', aggregateId: settlement.id,
    newState: { state: settlement.state, amount_kobo: settlement.amount_kobo }, payload: { booking_id: booking.id, idempotency_key: settlement.idempotency_key } });
  return { settlement };
}

export function reconcileLocalPayment(user: StoreUser, bookingId: string, evidence: Parameters<typeof reconcilePayment>[0]) {
  if (user.role !== 'admin') return { error: 'Forbidden' };
  const booking = store.bookings.find((item) => item.id === bookingId);
  if (!booking) return { error: 'Booking not found' };
  const outcome = reconcilePayment(evidence);
  const correlationId = randomUUID();
  for (const type of outcome.exceptions) {
    if (!store.reconciliationExceptions.some((item) => item.booking_id === booking.id && item.type === type)) {
      store.reconciliationExceptions.push({ id: randomUUID(), tenant_id: booking.tenant_id, booking_id: booking.id,
        type, state: 'OPEN', correlation_id: correlationId, created_at: new Date().toISOString() });
    }
  }
  booking.reconciliation_state = outcome.reconciled ? 'MATCHED' : 'EXCEPTION';
  return { ...outcome, correlation_id: correlationId };
}

export function attestLocalOfflinePayment(user: StoreUser, paymentId: string, declaredAmountKobo: number) {
  const payment = store.payments.find((item) => item.id === paymentId && (item.method === 'cash' || item.method === 'pay_at_venue'));
  const booking = payment && store.bookings.find((item) => item.id === payment.booking_id);
  if (!payment || !booking) return { error: 'Offline payment not found' };
  if (user.role === 'client' && booking.client_id === user.id) payment.customer_confirmed_amount_kobo = declaredAmountKobo;
  else if (user.role === 'artisan' && booking.provider_id === user.id) payment.provider_confirmed_amount_kobo = declaredAmountKobo;
  else return { error: 'Forbidden' };
  const bothConfirmed = payment.customer_confirmed_amount_kobo != null && payment.provider_confirmed_amount_kobo != null;
  if (bothConfirmed) {
    const matched = payment.customer_confirmed_amount_kobo === payment.amount_kobo && payment.provider_confirmed_amount_kobo === payment.amount_kobo;
    payment.verification_state = matched ? 'MATCHED' : 'MISMATCH';
    booking.reconciliation_state = matched ? 'MATCHED' : 'EXCEPTION';
    if (matched) {
      payment.status = 'success'; booking.amount_paid_kobo = booking.total_amount_kobo; booking.balance_due_kobo = 0;
      booking.payment_status = 'paid'; booking.payment_state = 'CONFIRMED'; booking.settlement_state = 'PENDING_ELIGIBILITY';
    } else booking.settlement_state = 'HELD';
  }
  return { payment, booking };
}

export function requestLocalAgentAction(user: StoreUser, action: string, policyPassed = false, humanApproved = false) {
  if (user.role !== 'admin') return { error: 'Forbidden' };
  return authorizeAgentAction({ action, policyPassed, humanApproved });
}

// ---------------------------------------------------------------------------
// Dashboards
// ---------------------------------------------------------------------------

export function artisanDashboard(user: StoreUser): object {
  const myBookings = store.bookings.filter((b) => b.provider_id === user.id);
  const completed = myBookings.filter((b) => b.status === 'completed');
  const revenueKobo = completed.reduce((sum, b) => sum + b.total_amount_kobo, 0);

  const myReviews = store.reviews.filter((r) => r.provider_id === user.id);
  const avgRating =
    myReviews.length > 0
      ? Math.round((myReviews.reduce((s, r) => s + r.rating, 0) / myReviews.length) * 10) / 10
      : 0;

  const todayStr = new Date().toISOString().slice(0, 10);
  const bookingsToday = myBookings.filter((b) => b.starts_at.startsWith(todayStr));

  const upcoming = myBookings.filter((b) =>
    ['confirmed', 'held', 'awaiting_payment'].includes(b.status),
  );

  return {
    total_completed: completed.length,
    revenue_kobo: revenueKobo,
    avg_rating: avgRating,
    bookings_today: bookingsToday.length,
    bookings_upcoming: upcoming.length,
  };
}

export function ownerDashboard(user: StoreUser): object {
  if (!user.tenant_id) {
    return { error: 'Owner has no tenant' };
  }
  const tenantBookings = store.bookings.filter((b) => b.tenant_id === user.tenant_id);
  const completed = tenantBookings.filter((b) => b.status === 'completed');
  const cancelled = tenantBookings.filter((b) => b.status === 'cancelled');
  const noShows = tenantBookings.filter((b) => b.status === 'no_show');

  const revenueKobo = completed.reduce((sum, b) => sum + b.total_amount_kobo, 0);
  const total = tenantBookings.length;
  const cancellationRate = total > 0 ? Math.round((cancelled.length / total) * 100) / 100 : 0;
  const noShowRate = total > 0 ? Math.round((noShows.length / total) * 100) / 100 : 0;

  const providerIds = store.providers
    .filter((p) => p.tenant_id === user.tenant_id)
    .map((p) => p.id);
  const tenantReviews = store.reviews.filter((r) => providerIds.includes(r.provider_id));
  const avgRating =
    tenantReviews.length > 0
      ? Math.round(
          (tenantReviews.reduce((s, r) => s + r.rating, 0) / tenantReviews.length) * 10,
        ) / 10
      : 0;

  // Bookings by day (last 7 days)
  const bookingsByDay: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    bookingsByDay[key] = 0;
  }
  for (const b of tenantBookings) {
    const day = b.created_at.slice(0, 10);
    if (day in bookingsByDay) {
      bookingsByDay[day]++;
    }
  }

  const bookingsByDayArray = Object.entries(bookingsByDay).map(([date, count]) => ({
    date,
    count,
    revenue_kobo: completed
      .filter((b) => b.created_at.slice(0, 10) === date)
      .reduce((s, b) => s + b.total_amount_kobo, 0),
  }));

  return {
    kpis: {
      completed_count: completed.length,
      revenue_kobo: revenueKobo,
      cancellation_rate: cancellationRate,
      no_show_rate: noShowRate,
      avg_rating: avgRating,
      bookings_by_day: bookingsByDayArray,
    },
  };
}


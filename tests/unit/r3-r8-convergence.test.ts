import { beforeEach, describe, expect, it } from 'vitest';
import { buildCommerceSnapshot, commerceSnapshotBalances, DEFAULT_COMMERCE_POLICY, type FeeBearer } from '../../apps/web/lib/commerce';
import { advanceSettlement, authorizeAgentAction, authorizeFulfillmentTransition, automationIdempotencyKey, cancellationPolicy, evaluateSettlementEligibility, reconcilePayment, refundCompensationKey, settlementCommand } from '../../apps/web/lib/marketplace-operations';
import { attestLocalOfflinePayment, getAvailableSlots, holdSlot, initPayment, queueLocalSettlement, submitGratuity, submitReview, updateBookingStatus, verifyPayment } from '../../apps/web/lib/local-handlers';
import { store } from '../../apps/web/lib/store';
import fs from 'node:fs';
import { structuredOperationalEvent } from '../../apps/web/lib/observability';

describe('R3 immutable Nigeria-first economics', () => {
  for (const feeBearer of ['CUSTOMER_PAYS','BUSINESS_ABSORBS','SPLIT','PLATFORM_SUBSIDIZES'] as FeeBearer[]) {
    it(`balances ${feeBearer} without hidden fee stacking`, () => {
      const snapshot = buildCommerceSnapshot({ serviceBaseKobo: 1_000_000, addOnsKobo: 100_000, discountKobo: 50_000,
        processingCostKobo: 15_000, transferCostKobo: 2_000, settlementCostKobo: 1_000, tipKobo: 50_000,
        amountPaidKobo: 0, amountDueNowKobo: 300_000, arrangement: 'DEPOSIT', method: 'bank_transfer',
        policy: { ...DEFAULT_COMMERCE_POLICY, version: `test-${feeBearer}`, fee_bearer: feeBearer, platform_fee_bps: 1_000, tip_commission_bps: 0 } });
      expect(commerceSnapshotBalances(snapshot)).toBe(true);
      expect(snapshot.tip_commission).toBe(0);
      expect(snapshot.provider_gross_entitlement).toBe(snapshot.service_price + snapshot.tip);
      expect(snapshot.customer_total).toBe(snapshot.amount_paid + snapshot.amount_outstanding);
    });
  }

  it('caps customer and provider burdens and exposes subsidy/margin', () => {
    const snapshot = buildCommerceSnapshot({ serviceBaseKobo: 200_000, processingCostKobo: 100_000,
      arrangement: 'FULL', method: 'card', amountDueNowKobo: 200_000,
      policy: { ...DEFAULT_COMMERCE_POLICY, fee_bearer: 'SPLIT', customer_fee_bps: 1_000,
        provider_fee_bps: 1_000, customer_fee_cap_kobo: 25_000, provider_fee_cap_kobo: 30_000 } });
    expect(snapshot.customer_fee).toBe(25_000);
    expect(snapshot.provider_fee).toBe(30_000);
    expect(snapshot.subsidy).toBeGreaterThan(0);
    expect(snapshot.kajola_net_revenue).toBeLessThan(snapshot.kajola_gross_revenue);
  });
});

describe('R4-R8 operational invariants', () => {
  it('enforces fulfillment RBAC and explicit completion', () => {
    expect(authorizeFulfillmentTransition('SCHEDULED','PROVIDER_ACKNOWLEDGED','provider').allowed).toBe(true);
    expect(authorizeFulfillmentTransition('SCHEDULED','COMPLETED','provider').allowed).toBe(false);
    expect(authorizeFulfillmentTransition('IN_PROGRESS','COMPLETED','customer').allowed).toBe(false);
    expect(authorizeFulfillmentTransition('IN_PROGRESS','COMPLETED','staff').allowed).toBe(true);
  });

  it('reuses recovery for provider cancellation', () => {
    expect(cancellationPolicy({ cancelledBy: 'PROVIDER', paymentCaptured: true, withinPenaltyWindow: false }))
      .toEqual({ releaseSlot: true, recoveryRequired: true, refundRequired: true, cancellationFeeKobo: 0 });
  });

  it('blocks settlement until every independent predicate passes', () => {
    const blocked = evaluateSettlementEligibility({ paymentConfirmed: true, fulfillmentState: 'IN_PROGRESS', activeRefund: false,
      activeDispute: false, activeRecovery: false, providerEligible: true, riskPassed: true });
    expect(blocked.blockers).toContain('SERVICE_NOT_COMPLETED');
    const eligible = evaluateSettlementEligibility({ paymentConfirmed: true, fulfillmentState: 'COMPLETED', activeRefund: false,
      activeDispute: false, activeRecovery: false, providerEligible: true, riskPassed: true });
    expect(eligible).toEqual({ eligible: true, state: 'ELIGIBLE', blockers: [] });
    expect(settlementCommand({ bookingId: 'b1', providerId: 'p1', amountKobo: 100 }).idempotencyKey)
      .toBe(settlementCommand({ bookingId: 'b1', providerId: 'p1', amountKobo: 100 }).idempotencyKey);
  });

  it('classifies reconciliation mismatch without treating declaration as truth', () => {
    const result = reconcilePayment({ internalExists: true, externalExists: true, internalAmount: 100,
      externalAmount: 90, internalCurrency: 'NGN', externalCurrency: 'USD', offlineUnverified: true });
    expect(result.reconciled).toBe(false);
    expect(result.exceptions).toEqual(['AMOUNT_MISMATCH','CURRENCY_MISMATCH','UNRESOLVED_OFFLINE_PAYMENT']);
  });

  it('retains failed settlement truth and retries without a second command identity', () => {
    expect(advanceSettlement('PROCESSING','FAILURE')).toMatchObject({ allowed: true, state: 'FAILED' });
    expect(advanceSettlement('FAILED','RETRY')).toMatchObject({ allowed: true, state: 'RETRY_REQUIRED' });
    expect(advanceSettlement('RETRY_REQUIRED','CLAIM')).toMatchObject({ allowed: true, state: 'PROCESSING' });
    expect(advanceSettlement('SETTLED','SUCCESS').allowed).toBe(false);
  });

  it('makes refund-after-settlement compensation deterministic across 20 replays', () => {
    expect(new Set(Array.from({ length: 20 }, () => refundCompensationKey('b1','s1','r1'))).size).toBe(1);
  });

  it('deduplicates automation action identities across 20 replays', () => {
    const keys = new Set(Array.from({ length: 20 }, () => automationIdempotencyKey('t1','e1','r1',0)));
    expect(keys.size).toBe(1);
  });

  it('fails unsafe agent actions closed and requires approval for refunds', () => {
    expect(authorizeAgentAction({ action: 'ledger.mutate', policyPassed: true, humanApproved: true }))
      .toMatchObject({ risk: 'FORBIDDEN', allowed: false });
    expect(authorizeAgentAction({ action: 'refund.issue', policyPassed: true, humanApproved: false }).allowed).toBe(false);
    expect(authorizeAgentAction({ action: 'refund.issue', policyPassed: true, humanApproved: true }).allowed).toBe(true);
  });

  it('propagates correlation while redacting credentials recursively', () => {
    const event = structuredOperationalEvent({ event: 'payment.failed', correlation_id: 'corr-1', runtime_mode: 'connected',
      booking_id: 'b1', payment_id: 'p1', metadata: { api_key: 'secret', nested: { auth_token: 'token', safe: 'kept' } } });
    expect(event).toMatchObject({ correlation_id: 'corr-1', booking_id: 'b1', payment_id: 'p1',
      metadata: { api_key: '[REDACTED]', nested: { auth_token: '[REDACTED]', safe: 'kept' } } });
  });

  it('persists database-enforced convergence contracts structurally', () => {
    const sql = fs.readFileSync('supabase/migrations/20260905000000_r3_r8_vertical_convergence.sql','utf8');
    for (const contract of ['IMMUTABLE_COMMERCE_SNAPSHOT','transition_booking_fulfillment','evaluate_booking_settlement',
      'queue_booking_settlement','reconciliation_exceptions','operator_commands','agent_action_requests','risk_class']) {
      expect(sql).toContain(contract);
    }
    expect(sql).toContain("risk_class <> 'FORBIDDEN'");
    expect(sql).toContain('provider_declared_amount=result.customer_declared_amount');
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS customer_total bigint');
    expect(sql).toContain('REVOKE ALL ON FUNCTION');
  });

  it('serves connected checkout from the immutable quote instead of a client amount', () => {
    const bookingsFunction = fs.readFileSync('supabase/functions/bookings/index.ts', 'utf8');
    const paymentsFunction = fs.readFileSync('supabase/functions/payments/index.ts', 'utf8');
    expect(bookingsFunction).toContain(".from('quote_snapshots')");
    expect(bookingsFunction).toContain('previously_paid_kobo: previouslyPaid');
    expect(bookingsFunction).toContain('customer_total_kobo: subtotalDue');
    expect(paymentsFunction).toContain("throw new ApiError('Amount does not match immutable commerce snapshot', 409)");
    expect(paymentsFunction).toContain('const finalAmount = offline || requestedPurpose === \'BALANCE\' ? outstanding');
  });
});

describe('R6 connected local vertical journey', () => {
  beforeEach(() => {
    store.bookings.splice(0); store.payments.splice(0); store.reviews.splice(0); store.gratuities.splice(0);
    store.ledger.splice(0); store.events.splice(0); store.audits.splice(0); store.workflows.splice(0);
    store.recoveryCases.splice(0); store.settlements.splice(0); store.reconciliationExceptions.splice(0);
  });

  it('discovers, holds, pays, fulfills, tips, settles, reviews, and rebooks', async () => {
    const customer = store.users.find((item) => item.id === 'client-1')!;
    const provider = store.users.find((item) => item.id === 'ada-1')!;
    const firstSlot = getAvailableSlots('ada-1','ada-svc-1').find((item) => item.available)!;
    const held = await holdSlot(customer, { provider_id: 'ada-1', service_id: 'ada-svc-1', starts_at: firstSlot.starts_at, ends_at: firstSlot.ends_at });
    expect(held.booking?.hold_state).toBe('ACTIVE');
    const deposit = await initPayment(customer, held.booking!.id, 'bank_transfer', 'deposit');
    await verifyPayment(customer, deposit.reference, held.booking!.id);
    const balance = await initPayment(customer, held.booking!.id, 'card', 'balance');
    await verifyPayment(customer, balance.reference, held.booking!.id);
    expect(held.booking?.payment_status).toBe('paid');
    expect((await updateBookingStatus(provider, held.booking!.id, 'acknowledged')).booking?.fulfillment_state).toBe('PROVIDER_ACKNOWLEDGED');
    await updateBookingStatus(provider, held.booking!.id, 'checked_in');
    await updateBookingStatus(provider, held.booking!.id, 'in_progress');
    await updateBookingStatus(provider, held.booking!.id, 'completed');
    expect((await submitGratuity(customer, { booking_id: held.booking!.id, amount_kobo: 25_000 })).gratuity?.provider_entitlement_kobo).toBe(25_000);
    const settlement = queueLocalSettlement(provider, held.booking!.id);
    expect(settlement.settlement?.state).toBe('QUEUED');
    expect((await submitReview(customer, { booking_id: held.booking!.id, rating: 5, comment: 'Excellent' })).review?.rating).toBe(5);
    const nextSlot = getAvailableSlots('ada-1','ada-svc-1').find((item) => item.available)!;
    expect((await holdSlot(customer, { provider_id: 'ada-1', service_id: 'ada-svc-1', starts_at: nextSlot.starts_at, ends_at: nextSlot.ends_at })).booking).toBeTruthy();
    expect(store.events.map((event) => event.event_type)).toEqual(expect.arrayContaining(['booking.held','payment.succeeded','booking.completed','gratuity.received','settlement.queued','review.submitted']));
  });

  it('keeps cash pending until customer and provider amounts agree', async () => {
    const customer = store.users.find((item) => item.id === 'client-1')!;
    const provider = store.users.find((item) => item.id === 'kofi-1')!;
    const slot = getAvailableSlots('kofi-1','kofi-svc-1').find((item) => item.available)!;
    const booking = (await holdSlot(customer, { provider_id: 'kofi-1', service_id: 'kofi-svc-1', starts_at: slot.starts_at, ends_at: slot.ends_at })).booking!;
    await initPayment(customer, booking.id, 'cash', 'full');
    const payment = store.payments.find((item) => item.booking_id === booking.id)!;
    attestLocalOfflinePayment(provider, payment.id, payment.amount_kobo);
    expect(payment.status).toBe('pending');
    attestLocalOfflinePayment(customer, payment.id, payment.amount_kobo - 100);
    expect(payment.verification_state).toBe('MISMATCH');
    expect(booking.settlement_state).toBe('HELD');
    attestLocalOfflinePayment(customer, payment.id, payment.amount_kobo);
    expect(payment.verification_state).toBe('MATCHED');
    expect(booking.payment_status).toBe('paid');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { acceptRecoveryRecommendation, getAvailableSlots, holdSlot, initPayment, requestRecoveryRefund, verifyPayment } from '../../apps/web/lib/local-handlers';
import { evaluateRecoveryPolicy, recoveryFinancialEffectKey } from '../../apps/web/lib/recovery-policy';
import { store, type StoreUser } from '../../apps/web/lib/store';

const customerA = store.users.find((user) => user.id === 'client-1')!;
const customerB: StoreUser = { id: 'client-r2-b', phone: '+2348000000022', full_name: 'R2 Customer B', role: 'client', tenant_id: null };

function resetRuntimeData() {
  store.bookings.length = 0; store.payments.length = 0; store.ledger.length = 0;
  store.recoveryCases.length = 0; store.events.length = 0; store.audits.length = 0;
  store.workflows.length = 0; store.notifications.length = 0;
}

function firstSlot() {
  const slot = getAvailableSlots('ada-1', 'ada-svc-1').find((candidate) => candidate.available)!;
  return { provider_id: 'ada-1', service_id: 'ada-svc-1', starts_at: slot.starts_at, ends_at: slot.ends_at };
}

describe('R2 transaction-safe booking semantics', () => {
  beforeEach(resetRuntimeData);

  it.each([2, 20, 50])('admits exactly one of %i concurrent claims', async (claimCount) => {
    const slot = firstSlot();
    const started = performance.now();
    const outcomes = await Promise.all(Array.from({ length: claimCount }, (_, index) => holdSlot(index === 0 ? customerA : customerB, slot)));
    const latency = performance.now() - started;
    expect(outcomes.filter((outcome) => outcome.booking)).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.error === 'Slot already taken')).toHaveLength(claimCount - 1);
    expect(latency).toBeLessThan(2_000);
    expect(store.bookings.filter((booking) => ['held', 'awaiting_payment', 'confirmed'].includes(booking.status))).toHaveLength(1);
  });

  it('preserves the later owner and opens recovery for a late confirmed payment', async () => {
    const slot = firstSlot();
    const a = (await holdSlot(customerA, slot)).booking!;
    expect(new Date(a.held_until!).getTime() - new Date(a.held_at!).getTime()).toBe(300_000);
    const intent = await initPayment(customerA, a.id, 'card');
    a.held_until = new Date(Date.now() - 1_000).toISOString();

    const b = (await holdSlot(customerB, slot)).booking!;
    const confirmations = await Promise.all(Array.from({ length: 20 }, () => verifyPayment(customerA, intent.reference, a.id)));
    const recovery = store.recoveryCases.find((item) => item.booking_id === a.id)!;

    expect(confirmations.every((item) => item.success)).toBe(true);
    expect(b.status).toBe('held');
    expect(a.booking_state).toBe('REQUIRES_RECOVERY');
    expect(a.payment_state).toBe('CONFIRMED');
    expect(a.fulfillment_state).toBe('NOT_SCHEDULED');
    expect(a.settlement_state).toBe('HELD');
    expect(a.recovery_state).toBe('AWAITING_CUSTOMER');
    expect(recovery.recommendations.length).toBeGreaterThan(0);
    expect(store.ledger.filter((entry) => entry.payment_id === recovery.payment_id)).toHaveLength(2);
    expect(recovery.state).toBe('AWAITING_CUSTOMER');
  });

  it('requires the owning customer to accept a replacement', async () => {
    const slot = firstSlot();
    const booking = (await holdSlot(customerA, slot)).booking!;
    const intent = await initPayment(customerA, booking.id, 'bank_transfer');
    booking.held_until = new Date(Date.now() - 1_000).toISOString();
    await holdSlot(customerB, slot);
    await verifyPayment(customerA, intent.reference, booking.id);
    const recovery = store.recoveryCases[0];
    const recommendation = recovery.recommendations[0];

    expect((await acceptRecoveryRecommendation(customerB, recovery.id, recommendation.id)).error).toBe('Forbidden');
    expect(booking.booking_state).toBe('REQUIRES_RECOVERY');
    expect((await acceptRecoveryRecommendation(customerA, recovery.id, recommendation.id)).error).toBeUndefined();
    expect(booking.booking_state).toBe('CONFIRMED');
    expect(booking.recovery_state).toBe('ACCEPTED');
  });

  it('records twenty refund retries as one recovery command', async () => {
    const slot = firstSlot();
    const booking = (await holdSlot(customerA, slot)).booking!;
    const intent = await initPayment(customerA, booking.id, 'card');
    booking.held_until = new Date(Date.now() - 1_000).toISOString();
    await holdSlot(customerB, slot); await verifyPayment(customerA, intent.reference, booking.id);
    const recovery = store.recoveryCases[0];
    const results = Array.from({ length: 20 }, () => requestRecoveryRefund(customerA, recovery.id));
    expect(new Set(results.map((item) => item.refund?.idempotency_key)).size).toBe(1);
    expect(store.events.filter((event) => event.event_type === 'recovery.refund.requested')).toHaveLength(1);
    expect(booking.payment_state).toBe('REFUND_PENDING');
    expect(booking.settlement_state).toBe('HELD');
  });

  it('produces one deterministic key for twenty recovery retries', () => {
    const input = { bookingId: 'booking-1', recoveryCaseId: 'recovery-1', policyVersion: 'recovery-v1' };
    const keys = new Set(Array.from({ length: 20 }, () => recoveryFinancialEffectKey(input, 'recovery_subsidy')));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('recovery_subsidy:booking-1:recovery-1:recovery-v1');
    expect(evaluateRecoveryPolicy({ ...input, failureReason: 'SYSTEM_FAILURE', originalPrice: 10_000,
      replacementPrice: 12_000, marketplaceResponsible: true, riskDecision: 'ALLOW', recoveryBudget: 3_000 })).toMatchObject({
        responsibility: 'KAJOLA', customerDelta: 0, kajolaSubsidy: 2_000,
      });
  });

  it('database migration enforces R2 invariants and service-role-only commands', () => {
    const sql = readFileSync(resolve('supabase/migrations/20260904020000_r2_transaction_safe_booking.sql'), 'utf8');
    const webhook = readFileSync(resolve('supabase/functions/payments_webhook/index.ts'), 'utf8');
    const durableRuntime = readFileSync(resolve('apps/web/lib/durable-flow-runtime.ts'), 'utf8');
    expect(sql).toContain("claimed_at + interval '5 minutes'");
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain('bookings_unresolved_recovery_blocks_settlement');
    expect(sql).toContain('idempotency_key text NOT NULL UNIQUE');
    expect(sql).toContain('REVOKE ALL ON FUNCTION process_verified_payment');
    expect(sql).toContain('REVOKE ALL ON FUNCTION accept_recovery_recommendation');
    expect(sql).toContain('REVOKE ALL ON FUNCTION request_recovery_refund');
    expect(webhook).toContain(".rpc('process_verified_payment'");
    expect(webhook).toContain('verifiedAmount === expectedAmount');
    expect(durableRuntime).toContain("event.event_type === 'payment.succeeded'");
    expect(durableRuntime).toContain("booking.booking_state === 'REQUIRES_RECOVERY'");
  });
});

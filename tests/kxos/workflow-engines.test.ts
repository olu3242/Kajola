/**
 * Operating Model Workflow Engines — certification tests
 * Covers the 8 engines from the Kajola Operating Model architecture
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryWorkflowOS } from '@kajola/workflow-os';
import { createInMemoryRuntime } from '@kajola/runtime-os';

describe('Operating Model Workflow Engines', () => {
  let runtime: ReturnType<typeof createInMemoryRuntime>;
  let wfOS: ReturnType<typeof createInMemoryWorkflowOS>;

  const opts = (overrides: Record<string, unknown> = {}) => ({
    tenantId:   'ada-1-tenant',
    triggeredBy: 'test',
    input:      { bookingId: 'bk_test', providerId: 'ada-1', ...overrides },
  });

  beforeEach(() => {
    runtime = createInMemoryRuntime();
    wfOS    = createInMemoryWorkflowOS(runtime.executor);

    // Register all domain handlers the engine tests need
    runtime.executor.register('AcceptBooking',           async (i) => ({ status: 'confirmed', ...i as object }));
    runtime.executor.register('MarkBookingPaid',         async (i) => ({ status: 'paid', ...i as object }));
    runtime.executor.register('RequestReview',           async (i) => ({ requested: true, ...i as object }));
    runtime.executor.register('UpdateTrustScore',        async (i) => ({ updated: true, ...i as object }));
    runtime.executor.register('IssueRefund',             async (i) => ({ refunded: true, ...i as object }));
    runtime.executor.register('VerifyProvider',          async (i) => ({ verified: true, ...i as object }));
    runtime.executor.register('ActivateProvider',        async (i) => ({ activated: true, ...i as object }));
    runtime.executor.register('TagCustomerSegment',      async (i) => ({ tagged: true, ...i as object }));
    runtime.executor.register('SendRetentionOffer',      async (i) => ({ sent: true, ...i as object }));
    runtime.executor.register('MarkProviderEnRoute',     async (i) => ({ status: 'en_route', ...i as object }));
    runtime.executor.register('MarkProviderArrived',     async (i) => ({ status: 'arrived', ...i as object }));
    runtime.executor.register('StartService',            async (i) => ({ status: 'in_progress', ...i as object }));
    runtime.executor.register('UploadServiceEvidence',   async (i) => ({ uploaded: true, ...i as object }));
    runtime.executor.register('CompleteService',         async (i) => ({ status: 'completed', ...i as object }));
    runtime.executor.register('CancelBooking',           async (i) => ({ status: 'cancelled', ...i as object }));
    runtime.executor.register('RecordDepositPaid',       async (i) => ({ recorded: true, deposit: true, ...i as object }));
    runtime.executor.register('RecordBalancePaid',       async (i) => ({ recorded: true, balance: true, ...i as object }));
    runtime.executor.register('RefundDeposit',           async (i) => ({ refunded: true, ...i as object }));
    runtime.executor.register('InitiatePayout',          async (i) => ({ initiated: true, ...i as object }));
    runtime.executor.register('ReleasePayout',           async (i) => ({ released: true, ...i as object }));
    runtime.executor.register('CreatePaymentIntent',     async (i) => ({ paymentId: `pay_${Date.now()}`, ...i as object }));
    runtime.executor.register('ConfirmBooking',          async (i) => ({ status: 'confirmed', ...i as object }));
    runtime.executor.register('SubmitDisputeEvidence',   async (i) => ({ submitted: true, ...i as object }));
    runtime.executor.register('ApplyDisputeResolution',  async (i) => ({ applied: true, ...i as object }));
    runtime.executor.register('CheckInCustomer',         async (i) => ({ status: 'checked_in', ...i as object }));
  });

  // ── 1. Booking Lifecycle Engine ───────────────────────────────────────────
  it('booking lifecycle: accepts booking and settles payment', async () => {
    const run = await wfOS.runner.start('wf_booking_full_lifecycle_v1', opts({
      startsAt: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
      serviceStatus: 'completed',
    }));
    expect(run.status).not.toBe('failed');
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(steps.find((s) => s.stepId === 'accept')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'settle_payment')?.status).toBe('completed');
  });

  // ── 2. Provider Onboarding Engine ────────────────────────────────────────
  it('provider onboarding: reaches kyc approval gate', async () => {
    const run = await wfOS.runner.start('wf_provider_onboard_to_active_v1', opts({
      profileComplete: true,
    }));
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    const kycStep = steps.find((s) => s.stepId === 'kyc_approval');
    expect(kycStep?.status).toBe('completed');
    expect(kycStep?.output).toMatchObject({ approvalStatus: 'pending' });
  });

  // ── 3. Customer Lifecycle Engine ─────────────────────────────────────────
  it('customer lifecycle: at-risk customer gets reactivation offer', async () => {
    const sixtyOneDaysAgo = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
    const run = await wfOS.runner.start('wf_customer_lifecycle_segment_v1', opts({
      customerId:    'cust-1',
      lastBookingAt: sixtyOneDaysAgo,
    }));
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(steps.find((s) => s.stepId === 'tag_segment')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'reactivation')?.status).toBe('completed');
  });

  it('customer lifecycle: active customer skips reactivation', async () => {
    const today = new Date().toISOString();
    const run = await wfOS.runner.start('wf_customer_lifecycle_segment_v1', opts({
      customerId:    'cust-2',
      lastBookingAt: today,
    }));
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    // reactivation step should not have run (condition was false → skip)
    const reactivation = steps.find((s) => s.stepId === 'reactivation');
    expect(reactivation).toBeUndefined();
  });

  // ── 4. Service Delivery Workflow ─────────────────────────────────────────
  it('service delivery: tracks en_route → arrived → started → completed', async () => {
    const run = await wfOS.runner.start('wf_service_field_delivery_v1', opts());
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(steps.find((s) => s.stepId === 'en_route')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'arrived')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'work_started')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'mark_complete')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'update_trust')?.status).toBe('completed');
  });

  it('service delivery: compensates CancelBooking if CompleteService fails', async () => {
    let cancelled = false;
    runtime.executor.register('CompleteService', async () => {
      throw Object.assign(new Error('Service not completed'), { code: 'INVALID', status: 422 });
    });
    runtime.executor.register('CancelBooking', async () => {
      cancelled = true;
      return { status: 'cancelled' };
    });

    const wfOS2 = createInMemoryWorkflowOS(runtime.executor);
    await wfOS2.runner.start('wf_service_field_delivery_v1', opts());
    expect(cancelled).toBe(true);
  });

  // ── 5. Payment Lifecycle Workflow ─────────────────────────────────────────
  it('payment lifecycle: records deposit, reaches payout approval gate', async () => {
    const run = await wfOS.runner.start('wf_payment_deposit_to_payout_v1', opts({
      serviceStatus: 'completed',
    }));
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(steps.find((s) => s.stepId === 'record_deposit')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'initiate_payout')?.status).toBe('completed');
    const approvalStep = steps.find((s) => s.stepId === 'payout_approval');
    expect(approvalStep?.status).toBe('completed');
    expect(approvalStep?.output).toMatchObject({ approvalStatus: 'pending' });
  });

  it('payment lifecycle: refunds deposit when balance payment step fails', async () => {
    let refunded = false;
    runtime.executor.register('RefundDeposit', async () => {
      refunded = true;
      return { refunded: true };
    });
    runtime.executor.register('RecordBalancePaid', async () => {
      throw Object.assign(new Error('Payment failed'), { code: 'PAYMENT_FAILED', status: 402 });
    });

    const wfOS2 = createInMemoryWorkflowOS(runtime.executor);
    await wfOS2.runner.start('wf_payment_deposit_to_payout_v1', opts({ serviceStatus: 'completed' }));
    expect(refunded).toBe(true);
  });

  // ── 6. Quote Workflow ─────────────────────────────────────────────────────
  it('quote workflow: converts accepted quote to confirmed booking', async () => {
    const run = await wfOS.runner.start('wf_quote_convert_to_booking_v1', opts({
      quoteSubmitted: true,
      quoteAccepted:  true,
    }));
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(steps.find((s) => s.stepId === 'create_payment')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'confirm_booking')?.status).toBe('completed');
  });

  it('quote workflow: stops if quote not accepted', async () => {
    const run = await wfOS.runner.start('wf_quote_convert_to_booking_v1', opts({
      quoteSubmitted: true,
      quoteAccepted:  false,
    }));
    expect(run.status).toBe('failed');
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(steps.find((s) => s.stepId === 'confirm_booking')).toBeUndefined();
  });

  // ── 7. Review and Reputation Workflow ─────────────────────────────────────
  it('review workflow: requests review and updates trust score', async () => {
    const run = await wfOS.runner.start('wf_review_collect_and_score_v1', opts({
      reviewSubmitted: false,
    }));
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(steps.find((s) => s.stepId === 'request_review')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'update_trust')?.status).toBe('completed');
  });

  // ── 8. Dispute Resolution Workflow ────────────────────────────────────────
  it('dispute resolution: collects evidence, gates on human review, applies resolution', async () => {
    const run = await wfOS.runner.start('wf_dispute_resolve_v1', opts({
      disputeId: 'disp_test',
    }));
    const steps = [...wfOS.repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(steps.find((s) => s.stepId === 'collect_evidence')?.status).toBe('completed');
    const reviewStep = steps.find((s) => s.stepId === 'human_review');
    expect(reviewStep?.status).toBe('completed');
    expect(reviewStep?.output).toMatchObject({ approvalStatus: 'pending' });
    expect(steps.find((s) => s.stepId === 'apply_resolution')?.status).toBe('completed');
    expect(steps.find((s) => s.stepId === 'update_trust')?.status).toBe('completed');
  });

  // ── 9. All 14 workflows are registered ───────────────────────────────────
  it('all 14 workflows are registered and active', async () => {
    const names = [
      'wf_booking_confirm_appointment_v1',
      'wf_booking_expire_slot_hold_v1',
      'wf_service_complete_engagement_v1',
      'wf_payment_recover_failed_deposit_v1',
      'wf_customer_collect_feedback_v1',
      'wf_trust_incident_review_v1',
      'wf_booking_full_lifecycle_v1',
      'wf_provider_onboard_to_active_v1',
      'wf_customer_lifecycle_segment_v1',
      'wf_service_field_delivery_v1',
      'wf_payment_deposit_to_payout_v1',
      'wf_quote_convert_to_booking_v1',
      'wf_review_collect_and_score_v1',
      'wf_dispute_resolve_v1',
    ];
    for (const name of names) {
      // If start doesn't throw "Workflow not found", it's registered
      await expect(
        wfOS.runner.start(name, opts()).catch((e: Error) => {
          if (e.message.includes('not found')) throw e;
          return {}; // other errors (missing handlers) are fine
        })
      ).resolves.toBeDefined();
    }
  });
});

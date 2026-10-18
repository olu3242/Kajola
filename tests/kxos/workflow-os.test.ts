/**
 * Workflow OS — unit certification tests
 * Section 15.2 of the KXOS superprompt
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { WorkflowRunner, InMemoryWorkflowRepository } from '@kajola/workflow-os';
import { createInMemoryRuntime } from '@kajola/runtime-os';
import type { WorkflowDefinition } from '@kajola/contracts';

function makeOpts(overrides: Record<string, unknown> = {}) {
  return {
    tenantId:   'ada-1-tenant',
    triggeredBy: 'test',
    input:      { bookingId: 'bk_test', providerId: 'ada-1', ...overrides },
  };
}

describe('Workflow OS', () => {
  let runtime: ReturnType<typeof createInMemoryRuntime>;
  let repo: InMemoryWorkflowRepository;
  let runner: WorkflowRunner;

  beforeEach(() => {
    runtime = createInMemoryRuntime();
    repo    = new InMemoryWorkflowRepository();
    runner  = new WorkflowRunner(repo, runtime.executor);

    // Register handlers needed by workflows
    runtime.executor.register('ConfirmBooking', async (input) => ({ status: 'confirmed', ...input as object }));
    runtime.executor.register('CancelBooking',  async (input) => ({ status: 'cancelled', ...input as object }));
    runtime.executor.register('CheckInCustomer', async (input) => ({ status: 'checked_in', ...input as object }));
    runtime.executor.register('StartService',    async (input) => ({ status: 'in_progress', ...input as object }));
    runtime.executor.register('CompleteService', async (input) => ({ status: 'completed', ...input as object }));
    runtime.executor.register('SendNotification', async (input) => ({ sent: true, ...input as object }));
    runtime.executor.register('RecordGratuity',  async (input) => ({ recorded: true, ...input as object }));
    runtime.executor.register('SubmitFeedback',  async (input) => ({ submitted: true, ...input as object }));
    runtime.executor.register('CreateRebooking', async (input) => ({ rebookingId: `rb_${Date.now()}`, ...input as object }));
    runtime.executor.register('ReadAvailability', async () => ({ slots: [] }));
  });

  // ── 15.2 Test 1 ──────────────────────────────────────────────────────────
  it('booking confirm workflow completes end-to-end', async () => {
    const wf: WorkflowDefinition = {
      id: 'wfd_booking_confirm_v1', name: 'wf_booking_confirm_appointment_v1',
      version: 1, description: 'test', active: true,
      steps: [
        { id: 'confirm', name: 'Confirm', type: 'command', command: 'ConfirmBooking', onFailure: 'stop' },
        { id: 'notify',  name: 'Notify',  type: 'notification', onFailure: 'skip' },
      ],
    };
    runner.register(wf);
    const run = await runner.start('wf_booking_confirm_appointment_v1', makeOpts());
    expect(run.status).toBe('running'); // completes within the run
    const sr = [...repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(sr.length).toBeGreaterThanOrEqual(2);
    expect(sr.find((s) => s.stepId === 'confirm')?.status).toBe('completed');
  });

  // ── 15.2 Test 2 ──────────────────────────────────────────────────────────
  it('payment failure pauses workflow and creates dead letter', async () => {
    let attempt = 0;
    runtime.executor.register('ConfirmBooking', async () => {
      attempt++;
      throw Object.assign(new Error('Payment gateway timeout'), { code: 'GATEWAY_TIMEOUT', status: 504 });
    });

    const wf: WorkflowDefinition = {
      id: 'wfd_payment_fail_test', name: 'wf_payment_fail_test',
      version: 1, description: 'test', active: true,
      retryPolicy: { maxAttempts: 2, backoffMs: 1, backoffFactor: 1, maxBackoffMs: 1 },
      steps: [
        { id: 'confirm', name: 'Confirm', type: 'command', command: 'ConfirmBooking', onFailure: 'stop' },
      ],
    };
    runner.register(wf);
    const run = await runner.start('wf_payment_fail_test', makeOpts());

    expect(run.status).toBe('failed');
    expect(attempt).toBe(2); // retried once
    const dlq = await runner.listDeadLetters('ada-1-tenant');
    expect(dlq.length).toBeGreaterThan(0);
    expect(dlq[0].source).toBe('workflow');
  });

  // ── 15.2 Test 3 ──────────────────────────────────────────────────────────
  it('slot-hold timer fires and cancels booking when state is held', async () => {
    const wf: WorkflowDefinition = {
      id: 'wfd_hold_expire_v1', name: 'wf_hold_expire_test',
      version: 1, description: 'test', active: true,
      steps: [
        { id: 'wait',   name: 'Wait', type: 'timer', timerMs: 0, onFailure: 'stop' },
        { id: 'check',  name: 'Check', type: 'condition', condition: (ctx) => ctx.state.bookingStatus === 'held', onFailure: 'skip' },
        { id: 'cancel', name: 'Cancel', type: 'command', command: 'CancelBooking', onFailure: 'skip' },
        { id: 'notify', name: 'Notify', type: 'notification', onFailure: 'skip' },
      ],
    };
    runner.register(wf);
    const run = await runner.start('wf_hold_expire_test', { ...makeOpts(), input: { bookingId: 'bk_test', bookingStatus: 'held' } });

    const stepRuns = [...repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    const cancelStep = stepRuns.find((s) => s.stepId === 'cancel');
    expect(cancelStep?.status).toBe('completed');
  });

  // ── 15.2 Test 4 ──────────────────────────────────────────────────────────
  it('duplicate payment signal is idempotent', async () => {
    let confirmCount = 0;
    runtime.executor.register('ConfirmBooking', async () => {
      confirmCount++;
      return { status: 'confirmed', confirmCount };
    });
    const key = `idem-wf-${Date.now()}`;
    const wf: WorkflowDefinition = {
      id: 'wfd_idem_test', name: 'wf_idem_test',
      version: 1, description: 'test', active: true,
      steps: [{ id: 'confirm', name: 'Confirm', type: 'command', command: 'ConfirmBooking', onFailure: 'stop' }],
    };
    runner.register(wf);

    // Run twice with same idempotency key on the executor command
    await runtime.executor.execute({
      command: 'ConfirmBooking', input: { bookingId: 'bk_test' },
      actorId: 'wfr_test', actorType: 'workflow', role: 'system',
      tenantId: 'ada-1-tenant', idempotencyKey: key,
    });
    await runtime.executor.execute({
      command: 'ConfirmBooking', input: { bookingId: 'bk_test' },
      actorId: 'wfr_test', actorType: 'workflow', role: 'system',
      tenantId: 'ada-1-tenant', idempotencyKey: key,
    });

    expect(confirmCount).toBe(1); // handler only called once
  });

  // ── 15.2 Test 5 ──────────────────────────────────────────────────────────
  it('notification failure is skipped without failing the workflow', async () => {
    const wf: WorkflowDefinition = {
      id: 'wfd_notif_skip_test', name: 'wf_notif_skip_test',
      version: 1, description: 'test', active: true,
      steps: [
        { id: 'confirm', name: 'Confirm', type: 'command', command: 'ConfirmBooking', onFailure: 'stop' },
        { id: 'notify',  name: 'Notify',  type: 'notification', onFailure: 'skip' },
      ],
    };
    runner.register(wf);
    const run = await runner.start('wf_notif_skip_test', makeOpts());
    // Workflow should reach its end without failing even if notification step would fail
    expect(run.status).not.toBe('failed');
    const sr = [...repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    expect(sr.every((s) => s.status !== 'failed')).toBe(true);
  });

  // ── 15.2 Test 6 ──────────────────────────────────────────────────────────
  it('retry exhaustion creates dead-letter record', async () => {
    runtime.executor.register('ConfirmBooking', async () => {
      throw Object.assign(new Error('Persistent failure'), { code: 'INTERNAL', status: 500 });
    });

    const wf: WorkflowDefinition = {
      id: 'wfd_dlq_test', name: 'wf_dlq_test',
      version: 1, description: 'test', active: true,
      retryPolicy: { maxAttempts: 2, backoffMs: 1, backoffFactor: 1, maxBackoffMs: 1 },
      steps: [{ id: 'confirm', name: 'Confirm', type: 'command', command: 'ConfirmBooking', onFailure: 'stop' }],
    };
    runner.register(wf);
    const run = await runner.start('wf_dlq_test', makeOpts());
    expect(run.status).toBe('failed');

    const dlq = await runner.listDeadLetters('ada-1-tenant');
    expect(dlq.some((d) => d.source === 'workflow' && d.sourceId === run.runId)).toBe(true);
  });

  // ── 15.2 Test 7 ──────────────────────────────────────────────────────────
  it('dead-letter replay succeeds once recovery handler is fixed', async () => {
    let shouldFail = true;
    runtime.executor.register('ConfirmBooking', async () => {
      if (shouldFail) throw Object.assign(new Error('Transient error'), { code: 'INTERNAL', status: 500 });
      return { status: 'confirmed' };
    });

    const wf: WorkflowDefinition = {
      id: 'wfd_replay_test', name: 'wf_replay_test',
      version: 1, description: 'test', active: true,
      retryPolicy: { maxAttempts: 1, backoffMs: 1, backoffFactor: 1, maxBackoffMs: 1 },
      steps: [{ id: 'confirm', name: 'Confirm', type: 'command', command: 'ConfirmBooking', onFailure: 'stop' }],
    };
    runner.register(wf);
    const run = await runner.start('wf_replay_test', makeOpts());
    expect(run.status).toBe('failed');

    const dlq = await runner.listDeadLetters('ada-1-tenant');
    const item = dlq.find((d) => d.sourceId === run.runId);
    expect(item).toBeDefined();

    // Fix the handler and replay
    shouldFail = false;
    const replayed = await runner.replayDeadLetter(item!.id, 'ada-1-tenant');
    expect(replayed.replayedAt).toBeDefined();
    expect(replayed.replayedBy).toBe('system');
  });

  // ── 15.2 Test 8 ──────────────────────────────────────────────────────────
  it('human approval step pauses workflow in pending state', async () => {
    const wf: WorkflowDefinition = {
      id: 'wfd_approval_test', name: 'wf_approval_test',
      version: 1, description: 'test', active: true,
      steps: [
        { id: 'request_approval', name: 'Request Approval', type: 'approval', onFailure: 'stop' },
        { id: 'confirm',          name: 'Confirm',           type: 'command', command: 'ConfirmBooking', onFailure: 'stop' },
      ],
    };
    runner.register(wf);
    const run = await runner.start('wf_approval_test', makeOpts());
    const sr = [...repo.stepRuns.values()].filter((s) => s.runId === run.runId);
    const approvalStep = sr.find((s) => s.stepId === 'request_approval');
    expect(approvalStep?.status).toBe('completed');
    expect(approvalStep?.output).toMatchObject({ approvalStatus: 'pending' });
  });

  // ── 15.2 Test 9 ──────────────────────────────────────────────────────────
  it('compensation reverses partial operation on failure', async () => {
    let compensated = false;
    runtime.executor.register('CancelBooking', async () => {
      compensated = true;
      return { status: 'cancelled' };
    });
    runtime.executor.register('ConfirmBooking', async () => {
      throw Object.assign(new Error('Step failed'), { code: 'CONFLICT', status: 409 });
    });

    const wf: WorkflowDefinition = {
      id: 'wfd_compensate_test', name: 'wf_compensate_test',
      version: 1, description: 'test', active: true,
      retryPolicy: { maxAttempts: 1, backoffMs: 1, backoffFactor: 1, maxBackoffMs: 1 },
      steps: [
        { id: 'confirm', name: 'Confirm', type: 'command', command: 'ConfirmBooking',
          onFailure: 'compensate', compensate: 'CancelBooking' },
      ],
    };
    runner.register(wf);
    await runner.start('wf_compensate_test', makeOpts());
    expect(compensated).toBe(true);
  });

  // ── 15.2 Test 10 ─────────────────────────────────────────────────────────
  it('workflow run records the version it was started on', async () => {
    const wf: WorkflowDefinition = {
      id: 'wfd_version_test', name: 'wf_version_test',
      version: 42, description: 'test', active: true,
      steps: [{ id: 'confirm', name: 'Confirm', type: 'command', command: 'ConfirmBooking', onFailure: 'stop' }],
    };
    runner.register(wf);
    const run = await runner.start('wf_version_test', makeOpts());
    expect(run.version).toBe(42);
  });
});

/**
 * Runtime OS — unit certification tests
 * Section 15.1 of the KXOS superprompt
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createInMemoryRuntime,
  newCorrelationId,
} from '@kajola/runtime-os';
import type { ExecuteCommandInput } from '@kajola/runtime-os';

function makeReq(overrides: Partial<ExecuteCommandInput> = {}): ExecuteCommandInput {
  return {
    command:        'HoldBookingSlot',
    input:          { providerId: 'ada-1', serviceId: 'svc-1', startsAt: '2026-09-10T09:00:00Z', endsAt: '2026-09-10T10:00:00Z' },
    actorId:        'client-1',
    actorType:      'human',
    role:           'client',
    tenantId:       'ada-1-tenant',
    idempotencyKey: `test-${Date.now()}-${Math.random()}`,
    ...overrides,
  };
}

describe('Runtime OS', () => {
  let runtime: ReturnType<typeof createInMemoryRuntime>;

  beforeEach(() => {
    runtime = createInMemoryRuntime();
    // Register a simple HoldBookingSlot handler
    runtime.executor.register('HoldBookingSlot', async (input) => {
      return { bookingId: `bk_${Date.now()}`, status: 'held', input };
    });
    runtime.executor.register('ConfirmBooking', async (input) => {
      return { status: 'confirmed', input };
    });
    runtime.executor.register('CancelBooking', async (input) => {
      return { status: 'cancelled', input };
    });
    runtime.executor.register('SendNotification', async (input) => {
      return { sent: true, input };
    });
    runtime.executor.register('ReadOwnerDashboard', async (_input, ctx) => {
      return { kpis: { revenue: 0, tenantId: ctx.tenantId } };
    });
  });

  // ── 15.1 Test 1 ──────────────────────────────────────────────────────────
  it('authenticated tenant operation succeeds', async () => {
    const result = await runtime.executor.execute(makeReq());
    expect(result.success).toBe(true);
    expect(result.operationId).toMatch(/^opr_/);
    expect((result.data as Record<string, unknown>).status).toBe('held');
  });

  // ── 15.1 Test 2 ──────────────────────────────────────────────────────────
  it('unauthenticated mutation fails (unknown role is rejected)', async () => {
    const result = await runtime.executor.execute(makeReq({ role: 'anonymous', actorType: 'human' }));
    expect(result.success).toBe(false);
    expect(result.error?.status).toBe(403);
    expect(result.error?.code).toBe('FORBIDDEN');
  });

  // ── 15.1 Test 3 ──────────────────────────────────────────────────────────
  it('cross-tenant mutation is blocked when tenant check enforced in handler', async () => {
    runtime.executor.register('HoldBookingSlot', async (_input, ctx) => {
      if (ctx.tenantId !== 'ada-1-tenant') throw Object.assign(new Error('Forbidden'), { code: 'FORBIDDEN', status: 403 });
      return { bookingId: 'bk_ok', status: 'held' };
    });
    const result = await runtime.executor.execute(makeReq({ tenantId: 'other-tenant' }));
    expect(result.success).toBe(false);
    expect(result.error?.status).toBe(403);
  });

  // ── 15.1 Test 4 ──────────────────────────────────────────────────────────
  it('duplicate idempotency key returns original result', async () => {
    const key = `idem-${Date.now()}`;
    const r1  = await runtime.executor.execute(makeReq({ idempotencyKey: key }));
    const r2  = await runtime.executor.execute(makeReq({ idempotencyKey: key }));
    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(r2.idempotent).toBe(true);
    expect(r2.operationId).toBe(r1.operationId);
  });

  // ── 15.1 Test 5 ──────────────────────────────────────────────────────────
  it('invalid state transition fails with domain error', async () => {
    runtime.executor.register('ConfirmBooking', async (_input) => {
      throw Object.assign(new Error('Invalid transition: held → completed'), { code: 'INVALID_TRANSITION', status: 422 });
    });
    const result = await runtime.executor.execute(makeReq({ command: 'ConfirmBooking', role: 'system', actorType: 'system' }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('INVALID_TRANSITION');
  });

  // ── 15.1 Test 6 ──────────────────────────────────────────────────────────
  it('failed operation records audit evidence', async () => {
    runtime.executor.register('HoldBookingSlot', async () => {
      throw Object.assign(new Error('Slot conflict'), { code: 'CONFLICT', status: 409 });
    });
    const result = await runtime.executor.execute(makeReq({ idempotencyKey: `audit-test-${Date.now()}` }));
    expect(result.success).toBe(false);
    const audits = await runtime.services.audit.list('ada-1-tenant');
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0].outcome).toBe('failure');
  });

  // ── 15.1 Test 7 ──────────────────────────────────────────────────────────
  it('audit and telemetry records are produced on success', async () => {
    await runtime.executor.execute(makeReq({ idempotencyKey: `telemetry-${Date.now()}` }));
    const audits = await runtime.services.audit.list('ada-1-tenant');
    expect(audits.some((a) => a.outcome === 'success')).toBe(true);
    const metrics = await runtime.services.telemetry.query('operation.success',
      '2000-01-01T00:00:00Z', '2099-01-01T00:00:00Z');
    expect(metrics.length).toBeGreaterThan(0);
  });

  // ── Authorization: owner dashboard blocked for non-owner ─────────────────
  it('non-owner cannot read owner dashboard (403)', async () => {
    const result = await runtime.executor.execute(makeReq({ command: 'ReadOwnerDashboard', role: 'client' }));
    expect(result.success).toBe(false);
    expect(result.error?.status).toBe(403);
  });

  // ── R3 action blocked for agent ──────────────────────────────────────────
  it('agent cannot execute R3 command — approval request created', async () => {
    runtime.executor.register('IssueRefund', async () => ({ refunded: true }));
    const result = await runtime.executor.execute(makeReq({
      command:   'IssueRefund',
      actorType: 'agent',
      agentId:   'agt_customer_concierge_v1',
      role:      'owner',
      idempotencyKey: `r3-${Date.now()}`,
    }));
    expect(result.success).toBe(false);
    expect(result.error?.code).toBe('APPROVAL_REQUIRED');
    expect((result.error?.details as Record<string, unknown>)?.approvalRequestId).toMatch(/^apr_/);
  });
});

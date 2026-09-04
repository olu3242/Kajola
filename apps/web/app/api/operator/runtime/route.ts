import { NextRequest, NextResponse } from 'next/server';
import { isLocalMode } from '@/lib/local-mode';
import { store } from '@/lib/store';
import { listBookingFlows } from '@/lib/booking-flow';
import { createDurableBookingOrchestrator, durableRequest } from '@/lib/durable-flow-runtime';
import { getRuntimeUser } from '@/lib/server-auth';

export async function GET(req: NextRequest) {
  const user = await getRuntimeUser(req);
  if (!user) return NextResponse.json({ code: 'UNAUTHENTICATED', error: 'Authentication required' }, { status: 401 });
  if (!user.isPlatformOperator) return NextResponse.json({ code: 'FORBIDDEN', error: 'Operator access required' }, { status: 403 });
  const checks = {
    database: isLocalMode ? 'local-adapter' : process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'missing',
    auth: isLocalMode ? 'local-adapter' : process.env.SUPABASE_JWT_SECRET ? 'configured' : 'missing',
    marketplace: 'ready', availability: 'ready', booking: 'ready',
    payment: process.env.PAYSTACK_SECRET_KEY ? 'configured' : 'blocked_external',
    notification: process.env.TERMII_API_KEY || process.env.AT_API_KEY ? 'configured' : 'blocked_external',
    workflow: isLocalMode ? 'local-scheduler' : 'database-worker',
    ai: process.env.ANTHROPIC_API_KEY ? 'configured' : 'optional',
  };
  let flows = isLocalMode ? await listBookingFlows() : [];
  let durableEvidence: Record<string, unknown> = {};
  if (!isLocalMode) {
    try {
      const durable = createDurableBookingOrchestrator();
      await durable.ready;
      flows = await durable.repository.findInstances({});
      const [events, audits, ledger, timers, notifications, workers, deadLetters, recoveryCases, bookingTransitions] = await Promise.all([
        durableRequest<unknown[]>('/rest/v1/system_events?select=id&limit=1000'),
        durableRequest<unknown[]>('/rest/v1/flow_audit_entries?select=id&limit=1000'),
        durableRequest<unknown[]>('/rest/v1/financial_ledger_entries?select=id&limit=1000'),
        durableRequest<unknown[]>('/rest/v1/flow_timers?status=eq.SCHEDULED&select=id&limit=1000'),
        durableRequest<unknown[]>('/rest/v1/notifications?select=id,status&limit=1000'),
        durableRequest<unknown[]>('/rest/v1/runtime_worker_heartbeats?select=worker_id,heartbeat_at&limit=20'),
        durableRequest<unknown[]>('/rest/v1/workflow_dead_letters?status=eq.OPEN&select=id&limit=1000'),
        durableRequest<unknown[]>('/rest/v1/recovery_cases?state=in.(REQUIRED,ALTERNATIVES_AVAILABLE,AWAITING_CUSTOMER,REFUND_REQUIRED)&select=id&limit=1000'),
        durableRequest<unknown[]>('/rest/v1/booking_transition_audit?select=id&limit=1000'),
      ]);
      durableEvidence = { events: events.length, audits: audits.length, booking_transition_audits: bookingTransitions.length, ledger_entries: ledger.length, scheduled_workflows: timers.length, notifications: notifications.length, worker_heartbeats: workers, open_dead_letters: deadLetters.length, recovery_backlog: recoveryCases.length, flow_repository: 'supabase' };
    } catch (error) {
      return NextResponse.json({ code: 'DEPENDENCY_UNAVAILABLE', error: error instanceof Error ? error.message : 'Durable runtime unavailable' }, { status: 503 });
    }
  }
  const flowStatus = flows.reduce<Record<string, number>>((result, flow) => {
    result[flow.status] = (result[flow.status] ?? 0) + 1;
    return result;
  }, {});
  const evidence = isLocalMode
    ? { events: store.events.length, audits: store.audits.length, ledger_entries: store.ledger.length, scheduled_workflows: store.workflows.filter((job) => job.status === 'scheduled').length, notifications: store.notifications.length, recovery_backlog: store.recoveryCases.filter((item) => !['ACCEPTED','RESOLVED'].includes(item.state)).length, flow_instances: flows.length, flow_repository: 'local-adapter' }
    : { ...durableEvidence, flow_instances: flows.length };
  return NextResponse.json({ checks, evidence, flow_status: flowStatus, recent_flows: flows.slice(-20).reverse(), recent_events: isLocalMode ? store.events.slice(-20).reverse() : [], recent_audits: isLocalMode ? store.audits.slice(-20).reverse() : [] });
}

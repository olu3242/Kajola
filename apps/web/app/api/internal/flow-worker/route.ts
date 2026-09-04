import { NextRequest, NextResponse } from 'next/server';
import { SupabaseWorkflowWorker, type DurableWorkClaim } from '@kajola/orchestration';
import { isDurableMode, runtimeMode } from '@/lib/local-mode';
import {
  createDurableBookingOrchestrator,
  deliverDurableBookingEvent,
  durableRequest,
  executeBookingClaim,
  type DurableSystemEvent,
} from '@/lib/durable-flow-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const supportedEvents = ['booking.held', 'payment.succeeded', 'booking.confirmed', 'booking.completed'];

export async function POST(req: NextRequest) {
  const expectedToken = process.env.FLOW_WORKER_TOKEN;
  if (!expectedToken || req.headers.get('x-kajola-worker-token') !== expectedToken) {
    return NextResponse.json({ code: 'NOT_FOUND' }, { status: 404 });
  }
  if (!isDurableMode) return NextResponse.json({ code: 'DURABLE_RUNTIME_REQUIRED', mode: runtimeMode }, { status: 503 });

  try {
    const eventResult = await processEvents();
    await durableRequest('/rest/v1/rpc/release_expired_slot_holds', { method: 'POST', body: JSON.stringify({ batch_size: 100 }) });
    const flowRuntime = createDurableBookingOrchestrator();
    await flowRuntime.ready;
    const worker = new SupabaseWorkflowWorker({
      url: process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      workerId: process.env.HOSTNAME ?? `web-${process.pid}`, runtimeMode: runtimeMode as 'sandbox' | 'production',
      deploymentSha: process.env.DEPLOYMENT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA,
    }, executeBookingClaim, async (claim: DurableWorkClaim, output: unknown) => {
      await flowRuntime.orchestrator.completeWork(claim.flow_instance_id, claim.id, output);
    });
    const workResult = await worker.runOnce();
    const resumedTimers = await resumeDueFlows(flowRuntime.orchestrator, flowRuntime.repository);
    return NextResponse.json({ status: 'ok', mode: runtimeMode, events: eventResult, work: workResult, resumed_timers: resumedTimers });
  } catch (error) {
    return NextResponse.json({ code: 'DEPENDENCY_UNAVAILABLE', message: error instanceof Error ? error.message : 'Worker failed' }, { status: 503 });
  }
}

async function processEvents() {
  const filter = supportedEvents.map((event) => `event_type.eq.${event}`).join(',');
  const events = await durableRequest<DurableSystemEvent[]>(`/rest/v1/system_events?orchestration_status=in.(PENDING,RETRYING)&or=(${filter})&select=*&order=created_at.asc&limit=25`);
  let processed = 0;
  let failed = 0;
  for (const event of events) {
    const locked = await durableRequest<DurableSystemEvent[]>(`/rest/v1/system_events?id=eq.${event.id}&orchestration_status=in.(PENDING,RETRYING)&select=*`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ orchestration_status: 'PROCESSING', orchestration_attempts: Number(event.orchestration_attempts ?? 0) + 1 }),
    });
    if (!locked[0]) continue;
    try {
      await deliverDurableBookingEvent(locked[0]);
      await updateEvent(event.id, { orchestration_status: 'PROCESSED', orchestration_error: null });
      processed += 1;
    } catch (error) {
      const attempts = Number(event.orchestration_attempts ?? 0) + 1;
      const terminal = attempts >= 3 || (error instanceof Error && error.message.startsWith('PERMANENT:'));
      await updateEvent(event.id, { orchestration_status: terminal ? 'DEAD_LETTER' : 'RETRYING', orchestration_error: error instanceof Error ? error.message : String(error) });
      if (terminal) await durableRequest('/rest/v1/workflow_dead_letters', {
        method: 'POST', body: JSON.stringify({ tenant_id: event.tenant_id, event_id: event.id, failure_class: 'EVENT_DELIVERY', error_message: error instanceof Error ? error.message : String(error), payload: event.payload, attempts }),
      });
      failed += 1;
    }
  }
  return { claimed: events.length, processed, failed };
}

function updateEvent(id: string, update: Record<string, unknown>) {
  return durableRequest(`/rest/v1/system_events?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(update) });
}

async function resumeDueFlows(orchestrator: ReturnType<typeof createDurableBookingOrchestrator>['orchestrator'], repository: ReturnType<typeof createDurableBookingOrchestrator>['repository']) {
  const scheduled = await repository.findInstances({ status: 'SCHEDULED' });
  let resumed = 0;
  for (const instance of scheduled) {
    const before = instance.version;
    const result = await orchestrator.resumeFlow(instance.id);
    if (result.version > before) resumed += 1;
  }
  return resumed;
}

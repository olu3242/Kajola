import { NextRequest, NextResponse } from 'next/server';
import { bookingOrchestrator, getBookingFlowTrace, listBookingFlows } from '@/lib/booking-flow';
import { isLocalMode } from '@/lib/local-mode';
import { createDurableBookingOrchestrator, durableRequest } from '@/lib/durable-flow-runtime';
import { getRuntimeUser } from '@/lib/server-auth';

async function operator(req: NextRequest) {
  const user = await getRuntimeUser(req);
  if (!user) return { error: NextResponse.json({ code: 'UNAUTHENTICATED', error: 'Authentication required' }, { status: 401 }) };
  if (!user.isPlatformOperator) return { error: NextResponse.json({ code: 'FORBIDDEN', error: 'Operator access required' }, { status: 403 }) };
  return { user, actor: { type: 'OPERATOR' as const, id: user.id, tenantId: user.tenant_id, roles: [user.role] } };
}

export async function GET(req: NextRequest) {
  const auth = await operator(req);
  if ('error' in auth) return auth.error;
  const url = new URL(req.url);
  const flowId = url.searchParams.get('flowId');
  const durable = !isLocalMode ? createDurableBookingOrchestrator() : null;
  if (durable) await durable.ready;
  if (flowId) {
    const trace = durable
      ? await (async () => {
        const flow = await durable.repository.getInstance(flowId);
        if (!flow) return null;
        const [audit, timers, deadLetters, callbacks] = await Promise.all([
          durable.repository.listAudit(flowId), durable.repository.listTimers(flowId),
          durable.repository.listDeadLetters(flowId),
          durableRequest<unknown[]>(`/rest/v1/flow_callback_expectations?flow_instance_id=eq.${encodeURIComponent(flowId)}&select=*&order=created_at.asc`),
        ]);
        return { flow, audit, timers, callbacks, dead_letters: deadLetters };
      })()
      : await getBookingFlowTrace(flowId);
    if (!trace) return NextResponse.json({ code: 'NOT_FOUND', error: 'Flow not found' }, { status: 404 });
    return NextResponse.json({ trace });
  }
  const status = url.searchParams.get('status') ?? undefined;
  const flows = durable
    ? await durable.repository.findInstances({ status })
    : await listBookingFlows({ status });
  return NextResponse.json({ flows, count: flows.length });
}

export async function POST(req: NextRequest) {
  const auth = await operator(req);
  if ('error' in auth) return auth.error;
  const body = await req.json().catch(() => null) as { flowId?: string; action?: string; stepInstanceId?: string; reason?: string } | null;
  if (!body?.flowId || !body.action) return NextResponse.json({ code: 'INVALID_INPUT', error: 'flowId and action are required' }, { status: 400 });
  try {
    const selected = isLocalMode ? bookingOrchestrator : createDurableBookingOrchestrator().orchestrator;
    const instance = body.action === 'resume'
      ? await selected.resumeFlow(body.flowId)
      : body.action === 'retry' && body.stepInstanceId
        ? await selected.retryStep(body.flowId, body.stepInstanceId, auth.actor)
        : body.action === 'cancel'
          ? await selected.cancelFlow(body.flowId, auth.actor, body.reason ?? 'Operator cancellation')
          : body.action === 'compensate'
            ? await selected.compensateFlow(body.flowId, auth.actor)
            : null;
    if (!instance) return NextResponse.json({ code: 'INVALID_ACTION', error: 'Unsupported action or missing stepInstanceId' }, { status: 400 });
    return NextResponse.json({ flow: instance });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Flow action failed';
    return NextResponse.json({ code: message, error: message }, { status: message.includes('NOT_FOUND') ? 404 : 409 });
  }
}

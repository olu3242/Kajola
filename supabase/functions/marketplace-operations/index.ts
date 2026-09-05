import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

serve(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    const db = createSupabaseClient();
    const action = new URL(req.url).pathname.split('/').filter(Boolean)[1] ?? '';
    const body = req.method === 'GET' ? {} : await req.json();
    if (req.method === 'POST' && action === 'settlement-evaluate') return evaluateSettlement(db, auth, body);
    if (req.method === 'POST' && action === 'settlement-queue') return queueSettlement(db, auth, body);
    if (req.method === 'POST' && action === 'offline-attestation') return offlineAttestation(db, auth, body);
    if (req.method === 'POST' && action === 'reconcile') return reconcile(db, auth, body);
    if (req.method === 'POST' && action === 'operator-command') return operatorCommand(db, auth, body);
    if (req.method === 'POST' && action === 'agent-recommendation') return agentRecommendation(db, auth, body);
    if (req.method === 'POST' && action === 'agent-action') return agentAction(db, auth, body);
    return errorResponse('Method not allowed', 405);
  } catch (error) {
    return handleError(error);
  }
});

async function authorizedBooking(db: ReturnType<typeof createSupabaseClient>, auth: any, bookingId: string) {
  const { data: booking, error } = await db.from('bookings').select('*,artisans(user_id)').eq('id', bookingId).single();
  if (error || !booking) throw new ApiError('Booking not found', 404);
  const allowed = auth.role === 'super_admin' || (auth.role === 'tenant_admin' && auth.tenant_id === booking.tenant_id)
    || booking.client_id === auth.sub || booking.user_id === auth.sub || booking.artisans?.user_id === auth.sub;
  if (!allowed) throw new ApiError('Forbidden', 403);
  return booking;
}

async function evaluateSettlement(db: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const bookingId = String(body.booking_id ?? '');
  await authorizedBooking(db, auth, bookingId);
  const { data, error } = await db.rpc('evaluate_booking_settlement', { target_booking_id: bookingId });
  if (error) throw new ApiError(error.message, 409);
  return json({ eligibility: data });
}

async function queueSettlement(db: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const bookingId = String(body.booking_id ?? '');
  const booking = await authorizedBooking(db, auth, bookingId);
  if (!['artisan','tenant_admin','super_admin'].includes(auth.role)) throw new ApiError('Forbidden', 403);
  const requestKey = String(body.idempotency_key ?? `settlement:${bookingId}:${booking.artisan_id}`);
  const { data, error } = await db.rpc('queue_booking_settlement', { target_booking_id: bookingId, request_key: requestKey, target_correlation_id: body.correlation_id ?? crypto.randomUUID() });
  if (error) throw new ApiError(error.message, 409);
  return json({ settlement: Array.isArray(data) ? data[0] : data });
}

async function offlineAttestation(db: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  if (!body.payment_id || !Number.isInteger(Number(body.declared_amount)) || Number(body.declared_amount) < 0) throw new ApiError('payment_id and declared_amount are required', 400);
  const role = auth.role === 'client' ? 'CUSTOMER' : auth.role === 'artisan' ? 'PROVIDER' : null;
  if (!role) throw new ApiError('Only the customer or provider may attest offline payment', 403);
  const { data, error } = await db.rpc('record_offline_payment_attestation', { target_payment_id: body.payment_id,
    target_actor_id: auth.sub, target_actor_role: role, target_declared_amount: Number(body.declared_amount),
    target_evidence: { note: body.note ?? null, correlation_id: body.correlation_id ?? crypto.randomUUID(), actor_role: role } });
  if (error) throw new ApiError(error.message, 409);
  return json({ evidence: Array.isArray(data) ? data[0] : data });
}

async function reconcile(db: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  if (auth.role !== 'super_admin') throw new ApiError('Operator access required', 403);
  const bookingId = String(body.booking_id ?? '');
  const booking = await authorizedBooking(db, auth, bookingId);
  const exceptions: string[] = [];
  if (body.external_exists && !body.internal_exists) exceptions.push('EXTERNAL_PAYMENT_MISSING_INTERNAL');
  if (body.internal_exists && !body.external_exists) exceptions.push('INTERNAL_CONFIRMATION_MISSING_PROOF');
  if (body.internal_exists && body.external_exists && Number(body.internal_amount) !== Number(body.external_amount)) exceptions.push('AMOUNT_MISMATCH');
  if (body.internal_exists && body.external_exists && String(body.internal_currency).toUpperCase() !== String(body.external_currency).toUpperCase()) exceptions.push('CURRENCY_MISMATCH');
  if (body.offline_unverified) exceptions.push('UNRESOLVED_OFFLINE_PAYMENT');
  const correlationId = body.correlation_id ?? crypto.randomUUID();
  for (const type of exceptions) {
    const { error } = await db.from('reconciliation_exceptions').upsert({ tenant_id: booking.tenant_id, booking_id: booking.id,
      exception_type: type, internal_evidence: body.internal_evidence ?? {}, external_evidence: body.external_evidence ?? {},
      correlation_id: correlationId, idempotency_key: `reconcile:${booking.id}:${type}:${body.provider_reference ?? 'none'}`,
    }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    if (error) throw new ApiError(error.message, 500);
  }
  await db.from('bookings').update({ reconciliation_state: exceptions.length ? 'EXCEPTION' : 'MATCHED' }).eq('id', booking.id);
  return json({ reconciled: exceptions.length === 0, exceptions, correlation_id: correlationId });
}

async function operatorCommand(db: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  if (auth.role !== 'super_admin') throw new ApiError('Operator access required', 403);
  if (!body.reason_code || !body.resource_id || !body.command_type) throw new ApiError('reason_code, resource_id and command_type are required', 400);
  const key = String(body.idempotency_key ?? `operator:${body.command_type}:${body.resource_id}:${body.reason_code}`);
  const { data, error } = await db.from('operator_commands').upsert({ tenant_id: body.tenant_id ?? null, actor_id: auth.sub,
    actor_role: auth.role, command_type: body.command_type, resource_type: body.resource_type ?? 'booking', resource_id: body.resource_id,
    reason_code: body.reason_code, correlation_id: body.correlation_id ?? crypto.randomUUID(), before_state: body.before_state ?? {},
    after_state: body.after_state ?? {}, status: 'ACCEPTED', idempotency_key: key,
  }, { onConflict: 'idempotency_key' }).select('*').single();
  if (error) throw new ApiError(error.message, 500);
  return json({ command: data });
}

async function agentRecommendation(db: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  if (auth.role !== 'super_admin') throw new ApiError('Operator access required', 403);
  const configured = Boolean(Deno.env.get('ANTHROPIC_API_KEY'));
  const key = String(body.idempotency_key ?? `agent:${body.recommendation_type}:${body.resource_id}`);
  const { data, error } = await db.from('agent_recommendations').upsert({ tenant_id: body.tenant_id ?? null,
    recommendation_type: body.recommendation_type ?? 'INCIDENT_SUMMARY', resource_type: body.resource_type ?? 'incident',
    resource_id: body.resource_id ?? null, summary: configured ? String(body.summary ?? 'Recommendation requires model execution') : 'AI provider is not configured; no model recommendation was executed.',
    evidence_refs: body.evidence_refs ?? [], model_provider: configured ? 'anthropic' : null,
    runtime_state: configured ? 'AVAILABLE' : 'BLOCKED_EXTERNAL', correlation_id: body.correlation_id ?? crypto.randomUUID(),
    created_by: auth.sub, idempotency_key: key,
  }, { onConflict: 'idempotency_key' }).select('*').single();
  if (error) throw new ApiError(error.message, 500);
  return json({ recommendation: data }, configured ? 201 : 503);
}

async function agentAction(db: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  if (auth.role !== 'super_admin') throw new ApiError('Operator access required', 403);
  const { data, error } = await db.rpc('request_agent_action', { target_recommendation_id: body.recommendation_id ?? null,
    target_tenant_id: body.tenant_id ?? null, target_action: body.action_type, target_actor_id: auth.sub,
    target_correlation_id: body.correlation_id ?? crypto.randomUUID(), request_key: body.idempotency_key ?? `agent-action:${body.action_type}:${body.recommendation_id ?? 'none'}` });
  if (error) throw new ApiError(error.message, 500);
  const request = Array.isArray(data) ? data[0] : data;
  return json({ action_request: request }, request.risk_class === 'FORBIDDEN' ? 403 : 202);
}

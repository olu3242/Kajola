import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

serve(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    const supabase = createSupabaseClient();
    const segments = new URL(req.url).pathname.split('/').filter(Boolean);
    const caseId = segments[1] ?? '';

    if (req.method === 'GET' && caseId) {
      const { data, error } = await supabase.from('recovery_cases')
        .select('*, bookings!inner(client_id,tenant_id,artisans(user_id)), recovery_recommendations(*, booking_slots(start_at,end_at))').eq('id', caseId).single();
      if (error || !data) throw new ApiError('Recovery case not found', 404);
      const allowed = auth.role === 'super_admin'
        || (auth.role === 'client' && data.bookings.client_id === auth.sub)
        || (auth.role === 'tenant_admin' && data.bookings.tenant_id === auth.tenant_id)
        || (auth.role === 'artisan' && data.bookings.artisans?.user_id === auth.sub);
      if (!allowed) throw new ApiError('Forbidden', 403);
      return json({ recovery_case: data });
    }

    if (req.method === 'POST' && caseId && segments[2] === 'accept') {
      if (auth.role !== 'client') throw new ApiError('Only the customer may accept a replacement', 403);
      const body = await req.json();
      if (!body.recommendation_id) throw new ApiError('recommendation_id is required', 400);
      const { data, error } = await supabase.rpc('accept_recovery_recommendation', {
        target_recovery_case_id: caseId,
        target_recommendation_id: body.recommendation_id,
        target_customer_id: auth.sub,
        request_key: String(body.idempotency_key ?? crypto.randomUUID()),
      });
      if (error) {
        const conflict = error.message.includes('SLOT_UNAVAILABLE');
        throw new ApiError(conflict ? 'Replacement slot is no longer available' : error.message, conflict ? 409 : 400);
      }
      return json({ outcome: data });
    }

    if (req.method === 'POST' && caseId && segments[2] === 'refund') {
      if (auth.role !== 'client') throw new ApiError('Only the customer may request this refund', 403);
      const { data: recovery, error: recoveryError } = await supabase.from('recovery_cases').select('booking_id,policy_version').eq('id', caseId).single();
      if (recoveryError || !recovery) throw new ApiError('Recovery case not found', 404);
      const key = `recovery-refund:${recovery.booking_id}:${caseId}:${recovery.policy_version}`;
      const { data: refund, error } = await supabase.rpc('request_recovery_refund', {
        target_recovery_case_id: caseId, target_customer_id: auth.sub, request_key: key,
      });
      if (error) throw new ApiError(error.message, 500);
      return json({ refund });
    }

    return errorResponse('Method not allowed', 405);
  } catch (error) {
    return handleError(error);
  }
});

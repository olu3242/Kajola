import { serve, json, errorResponse, createSupabaseClient, authenticateRequest } from '../../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await authenticateRequest(req);
    const supabase = createSupabaseClient();
    return await handlePaymentHistory(supabase, auth, new URL(req.url).searchParams);
  } catch (err) {
    console.error(err);
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});

async function handlePaymentHistory(supabase: ReturnType<typeof createSupabaseClient>, auth: any, params: URLSearchParams) {
  const status = params.get('status');
  let query = supabase
    .from('payments')
    .select('*, bookings(id, status, service_id, artisan_id), bookings!inner(artisan_id, service_id)');

  if (auth.role === 'client') {
    query = query.eq('initiated_by', auth.sub);
  } else if (auth.role === 'tenant_admin') {
    query = query.eq('tenant_id', auth.tenant_id);
  } else {
    return errorResponse('Forbidden', 403);
  }

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) {
    return errorResponse(error.message, 500);
  }

  return json({ payments: data ?? [] });
}

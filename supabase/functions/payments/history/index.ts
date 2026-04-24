import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'GET') return errorResponse('Method not allowed', 405);
  try {
    const auth = await authenticateRequest(req);
    return await handlePaymentHistory(createSupabaseClient(), auth, new URL(req.url).searchParams);
  } catch (err) {
    return handleError(err);
  }
});

async function handlePaymentHistory(supabase: ReturnType<typeof createSupabaseClient>, auth: any, params: URLSearchParams) {
  const status = params.get('status');
  let query = supabase
    .from('payments')
    .select('*, bookings!inner(id,status,client_id,user_id,tenant_id,service_id,artisan_id)');

  if (auth.role === 'client') {
    query = query.or(`client_id.eq.${auth.sub},user_id.eq.${auth.sub}`, { foreignTable: 'bookings' });
  } else if (auth.role === 'tenant_admin') {
    query = query.eq('tenant_id', auth.tenant_id);
  } else {
    throw new ApiError('Forbidden', 403);
  }

  if (status) query = query.eq('status', status);
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new ApiError(error.message, 500);
  return json({ payments: data ?? [] });
}

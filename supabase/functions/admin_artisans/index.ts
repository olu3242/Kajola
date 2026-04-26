import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

type ApproveInput = { artisan_id: string; verification_id?: string };
type RejectInput = { artisan_id: string; verification_id?: string; notes?: string };

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const action = segments[segments.length - 1];
    const supabase = createSupabaseClient();
    const payload = await authenticateRequest(req);
    if (!['tenant_admin', 'super_admin'].includes(payload.role as string)) {
      return errorResponse('Admin access required', 403);
    }

    if (req.method === 'GET' && action === 'verifications') return await listVerifications(supabase, req);
    if (req.method === 'POST' && action === 'approve') return await approveArtisan(supabase, req);
    if (req.method === 'POST' && action === 'reject') return await rejectArtisan(supabase, req);

    return errorResponse('Not found', 404);
  } catch (err) {
    return handleError(err);
  }
});

async function listVerifications(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const { data, error } = await supabase
    .from('artisan_verifications')
    .select('*, artisans(id, business_name, category, onboarding_status)')
    .eq('status', status)
    .order('created_at', { ascending: true });

  if (error) return errorResponse(error.message, 500);
  return json({ verifications: data ?? [] });
}

async function approveArtisan(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const body = await req.json() as ApproveInput;
  if (!body.artisan_id) return errorResponse('artisan_id is required', 400);

  const update = await supabase.from('artisans').update({
    verified: true,
    is_active: true,
    onboarding_status: 'verified'
  }).eq('id', body.artisan_id).select('*').single();
  if (update.error || !update.data) return errorResponse(update.error?.message || 'Unable to approve artisan', 500);

  if (body.verification_id) {
    await supabase.from('artisan_verifications').update({ status: 'approved', updated_at: new Date().toISOString() }).eq('id', body.verification_id);
  }

  return json({ artisan: update.data });
}

async function rejectArtisan(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const body = await req.json() as RejectInput;
  if (!body.artisan_id) return errorResponse('artisan_id is required', 400);

  const update = await supabase.from('artisans').update({
    verified: false,
    is_active: false,
    onboarding_status: 'rejected'
  }).eq('id', body.artisan_id).select('*').single();
  if (update.error || !update.data) return errorResponse(update.error?.message || 'Unable to reject artisan', 500);

  if (body.verification_id) {
    await supabase.from('artisan_verifications').update({ status: 'rejected', notes: body.notes ?? null, updated_at: new Date().toISOString() }).eq('id', body.verification_id);
  }

  return json({ artisan: update.data });
}

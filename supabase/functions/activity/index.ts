import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

const allowedEvents = new Set(['view', 'click', 'book', 'repeat']);

serve(async (req: Request) => {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);
  try {
    const auth = await authenticateRequest(req);
    const body = await req.json();
    return await recordActivity(createSupabaseClient(), auth, body);
  } catch (err) {
    return handleError(err);
  }
});

async function recordActivity(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { artisan_id, event_type } = body;
  if (!artisan_id || !allowedEvents.has(event_type)) throw new ApiError('artisan_id and valid event_type are required', 400);
  if (auth.role !== 'client') throw new ApiError('Forbidden', 403);

  const { error } = await supabase.from('user_activity').insert({
    user_id: auth.sub,
    artisan_id,
    event_type
  });
  if (error) throw new ApiError(error.message, 500);
  return json({ success: true }, 201);
}

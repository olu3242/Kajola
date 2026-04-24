import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

serve(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    const supabase = createSupabaseClient();
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const action = segments[segments.length - 1];

    if (req.method === 'GET' && (segments.length === 0 || action === 'notifications')) {
      return await listNotifications(supabase, auth, url.searchParams);
    }

    if (req.method === 'PATCH' && action === 'read') {
      return await markNotificationRead(supabase, auth, segments[segments.length - 2]);
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    return handleError(err);
  }
});

async function listNotifications(supabase: ReturnType<typeof createSupabaseClient>, auth: any, params: URLSearchParams) {
  const isRead = params.get('is_read');
  let query = supabase.from('notifications').select('*').eq('user_id', auth.sub).order('created_at', { ascending: false });
  if (isRead === 'true') query = query.eq('is_read', true);
  if (isRead === 'false') query = query.eq('is_read', false);
  const { data, error } = await query.limit(100);
  if (error) throw new ApiError(error.message, 500);
  return json({ notifications: data ?? [] });
}

async function markNotificationRead(supabase: ReturnType<typeof createSupabaseClient>, auth: any, notificationId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .update({ is_read: true, delivered_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', auth.sub)
    .select('*')
    .single();

  if (error) throw new ApiError(error.message, 500);
  return json({ notification: data });
}

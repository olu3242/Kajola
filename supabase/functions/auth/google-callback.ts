import { serve, json, errorResponse, createSupabaseClient, getEnv } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  const body = await req.json();
  const user = body.user;
  if (!user || !user.id) return errorResponse('Invalid user payload', 400);

  const supabase = createSupabaseClient();
  const providerId = user.id;
  const email = user.email ?? null;
  const fullName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.full_name ?? null;
  const avatarUrl = user.user_metadata?.avatar_url ?? user.user_metadata?.picture ?? user.user_metadata?.picture_url ?? null;

  const { data: existingUser, error: existingError } = await supabase.from('users').select('*').eq('auth_uid', providerId).single();
  if (existingError && existingError.code !== 'PGRST116') {
    return errorResponse(existingError.message, 500);
  }

  let userRecord = existingUser;
  if (!userRecord) {
    const { data: createdUser, error: createError } = await supabase.from('users').insert({
      tenant_id: null,
      auth_uid: providerId,
      role: 'client',
      phone: user.phone ?? '',
      email,
      full_name: fullName,
      avatar_url: avatarUrl,
      is_active: true,
      metadata: { provider: 'google', provider_user: user }
    }).select('*').single();

    if (createError || !createdUser) {
      return errorResponse(createError?.message ?? 'Failed to create user', 500);
    }
    userRecord = createdUser;
  }

  return json({ success: true, user: userRecord, redirectTo: '/dashboard' });
});

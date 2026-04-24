import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';
import { emitSystemEvent } from '../automation_helpers.ts';

type ServiceInput = {
  name: string;
  description?: string;
  category?: string;
  duration_minutes: number;
  price_cents: number;
};

type AvailabilityInput = {
  starts_at: string;
  ends_at: string;
  slot_interval_minutes: number;
  max_bookings_per_slot?: number;
};

type VerificationInput = {
  type: 'phone' | 'id' | 'manual';
  notes?: string;
};

type ReferralInput = {
  referred_artisan_id: string;
};

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const action = segments[segments.length - 1];
    const supabase = createSupabaseClient();

    if (req.method === 'POST' && action === 'onboarding') return await handleOnboarding(supabase, req);
    if (req.method === 'POST' && action === 'services') return await handleServices(supabase, req);
    if (req.method === 'POST' && action === 'portfolio') return await handlePortfolio(supabase, req);
    if (req.method === 'POST' && action === 'availability') return await handleAvailability(supabase, req);
    if (req.method === 'POST' && action === 'verification') return await handleVerification(supabase, req);
    if (req.method === 'POST' && action === 'referral') return await handleReferral(supabase, req);
    if (req.method === 'GET' && action === 'dashboard') return await handleDashboard(supabase, req);

    return errorResponse('Not found', 404);
  } catch (err) {
    return handleError(err);
  }
});

async function getCurrentUser(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const payload = await authenticateRequest(req);
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .or(`auth_uid.eq.${payload.sub},id.eq.${payload.sub}`)
    .single();
  if (error || !data) throw new ApiError('Authenticated user not found', 401);
  return { payload, user: data };
}

async function getOrCreateArtisan(supabase: ReturnType<typeof createSupabaseClient>, user: any) {
  const existing = await supabase.from('artisans').select('*').eq('user_id', user.id).maybeSingle();
  if (existing.error) throw new ApiError(existing.error.message, 500);
  if (existing.data) return existing.data;

  const { data, error } = await supabase.from('artisans').insert({
    tenant_id: user.tenant_id,
    user_id: user.id,
    business_name: '',
    category: '',
    profile_media: '[]',
    onboarding_status: 'not_started',
    verified: false,
    is_active: false
  }).select('*').single();

  if (error || !data) throw new ApiError(error?.message ?? 'Unable to create artisan', 500);
  return data;
}

async function handleOnboarding(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const { user } = await getCurrentUser(supabase, req);
  const payload = await req.json();
  const artisan = await getOrCreateArtisan(supabase, user);

  const fields = {
    business_name: payload.business_name?.trim() ?? artisan.business_name,
    category: payload.category?.trim() ?? artisan.category,
    headline: payload.headline?.trim() ?? artisan.headline,
    description: payload.description?.trim() ?? artisan.description,
    latitude: payload.latitude ?? artisan.latitude,
    longitude: payload.longitude ?? artisan.longitude,
    address: payload.address?.trim() ?? artisan.address,
    city: payload.city?.trim() ?? artisan.city,
    state: payload.state?.trim() ?? artisan.state,
    country: payload.country?.trim() ?? artisan.country,
    profile_photo_url: payload.profile_photo_url?.trim() ?? artisan.profile_photo_url,
    onboarding_status: 'profile_created',
    verified: false,
    is_active: false
  };

  const update = await supabase.from('artisans').update(fields).eq('id', artisan.id).select('*').single();
  if (update.error || !update.data) return errorResponse(update.error?.message || 'Unable to save onboarding', 500);

  if (payload.phone) {
    await supabase.from('users').update({ phone: payload.phone }).eq('id', user.id);
  }

  await emitSystemEvent(supabase, user.tenant_id, 'artisan_onboarded', {
    artisan_id: artisan.id,
    user_id: user.id,
    onboarding_status: update.data.onboarding_status
  }, 'artisan_onboarding', user.id, 'artisan', artisan.id);

  return json({ artisan: update.data });
}

async function handleServices(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const { user } = await getCurrentUser(supabase, req);
  const artisan = await getOrCreateArtisan(supabase, user);
  const { services } = await req.json();
  if (!Array.isArray(services) || services.length === 0) return errorResponse('Services are required', 400);

  const rows = services.map((service: ServiceInput) => ({
    tenant_id: user.tenant_id,
    artisan_id: artisan.id,
    name: service.name,
    description: service.description ?? null,
    category: service.category ?? artisan.category,
    duration_minutes: service.duration_minutes,
    price_cents: service.price_cents
  }));

  const insert = await supabase.from('services').insert(rows).select('*');
  if (insert.error) return errorResponse(insert.error.message, 500);

  const update = await supabase.from('artisans').update({ onboarding_status: 'services_added' }).eq('id', artisan.id).select('*').single();
  if (update.error) return errorResponse(update.error.message, 500);

  return json({ services: insert.data, artisan: update.data });
}

async function handlePortfolio(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const { user } = await getCurrentUser(supabase, req);
  const artisan = await getOrCreateArtisan(supabase, user);
  const { portfolio } = await req.json();
  if (!Array.isArray(portfolio)) return errorResponse('Portfolio array required', 400);

  const update = await supabase.from('artisans').update({
    profile_media: portfolio,
    onboarding_status: artisan.onboarding_status === 'not_started' ? 'profile_created' : artisan.onboarding_status
  }).eq('id', artisan.id).select('*').single();

  if (update.error || !update.data) return errorResponse(update.error?.message || 'Unable to save portfolio', 500);
  return json({ artisan: update.data });
}

async function handleAvailability(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const { user } = await getCurrentUser(supabase, req);
  const artisan = await getOrCreateArtisan(supabase, user);
  const { windows } = await req.json();
  if (!Array.isArray(windows) || windows.length === 0) return errorResponse('Availability windows are required', 400);

  await supabase.from('availability_windows').delete().eq('artisan_id', artisan.id);
  const rows = windows.map((window: AvailabilityInput) => ({
    tenant_id: user.tenant_id,
    artisan_id: artisan.id,
    starts_at: window.starts_at,
    ends_at: window.ends_at,
    slot_interval_minutes: window.slot_interval_minutes,
    max_bookings_per_slot: window.max_bookings_per_slot ?? 1
  }));

  const insert = await supabase.from('availability_windows').insert(rows).select('*');
  if (insert.error) return errorResponse(insert.error.message, 500);

  const update = await supabase.from('artisans').update({ onboarding_status: 'verification_pending' }).eq('id', artisan.id).select('*').single();
  if (update.error) return errorResponse(update.error.message, 500);

  return json({ windows: insert.data, artisan: update.data });
}

async function handleVerification(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const { user } = await getCurrentUser(supabase, req);
  const artisan = await getOrCreateArtisan(supabase, user);
  const { type, notes } = await req.json() as VerificationInput;
  if (!type) return errorResponse('Verification type is required', 400);

  const insert = await supabase.from('artisan_verifications').insert({ artisan_id: artisan.id, type, notes }).select('*').single();
  if (insert.error || !insert.data) return errorResponse(insert.error?.message || 'Unable to request verification', 500);

  await supabase.from('artisans').update({ onboarding_status: 'verification_pending' }).eq('id', artisan.id);
  return json({ verification: insert.data });
}

async function handleReferral(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const { user } = await getCurrentUser(supabase, req);
  const artisan = await getOrCreateArtisan(supabase, user);
  const { referred_artisan_id } = await req.json() as ReferralInput;
  if (!referred_artisan_id) return errorResponse('Referred artisan id is required', 400);

  const insert = await supabase.from('artisan_referrals').insert({
    referrer_id: artisan.id,
    referred_artisan_id
  }).select('*').single();
  if (insert.error || !insert.data) return errorResponse(insert.error?.message || 'Unable to create referral', 500);
  return json({ referral: insert.data });
}

async function handleDashboard(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const { user } = await getCurrentUser(supabase, req);
  const artisanResult = await supabase.from('artisans').select('*, artisan_stats(*)').eq('user_id', user.id).single();
  if (artisanResult.error || !artisanResult.data) return errorResponse('Artisan profile not found', 404);
  const artisan = artisanResult.data;
  const bookingIds = await supabase.from('bookings').select('id').eq('artisan_id', artisan.id).in('status', ['completed','confirmed','in_progress']);

  const earnings = bookingIds.error || !bookingIds.data ? 0 : await (() => {
    const ids = bookingIds.data.map((row: any) => row.id);
    if (ids.length === 0) return 0;
    return supabase.from('payments').select('amount_cents').in('booking_id', ids).eq('status', 'successful').then((res) => {
      if (res.error || !res.data) return 0;
      return res.data.reduce((sum: number, row: any) => sum + Number(row.amount_cents ?? 0), 0);
    });
  })();

  const verificationCount = await supabase.from('artisan_verifications').select('*', { count: 'exact' }).eq('artisan_id', artisan.id);
  const referralCount = await supabase.from('artisan_referrals').select('*', { count: 'exact' }).eq('referrer_id', artisan.id);
  const { data: analytics } = await supabase.from('artisan_analytics').select('*').eq('artisan_id', artisan.id).single();

  return json({
    artisan,
    metrics: {
      total_jobs: artisan.artisan_stats?.total_jobs ?? 0,
      completed_jobs: artisan.artisan_stats?.completed_jobs ?? 0,
      trust_score: Number(artisan.artisan_stats?.trust_score ?? 0) || (artisan.verified ? 60 : 0),
      avg_rating: Number(artisan.artisan_stats?.avg_rating ?? 0),
      reviews: artisan.artisan_stats?.total_reviews ?? 0,
      earnings: Number(await earnings),
      profile_score: Number(artisan.profile_score ?? 0),
      onboarding_status: artisan.onboarding_status,
      verification_score: Number(artisan.verification_score ?? 0),
      referrals: referralCount.data?.length ?? 0,
      verification_requests: verificationCount.data?.length ?? 0,
      is_active: artisan.is_active,
      views: Number(analytics?.views ?? 0),
      clicks: Number(analytics?.clicks ?? 0),
      booked: Number(analytics?.bookings ?? 0),
      conversion_rate: Number(analytics?.conversion_rate ?? 0)
    }
  });
}

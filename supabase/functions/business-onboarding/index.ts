import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

serve(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    if (!['artisan', 'provider', 'owner', 'tenant_admin'].includes(auth.role)) throw new ApiError('Forbidden', 403);
    const db = createSupabaseClient();
    const { data: user, error: userError } = await db.from('users').select('id,tenant_id').or(`auth_uid.eq.${auth.sub},id.eq.${auth.sub}`).single();
    if (userError || !user) throw new ApiError('Authenticated user not found', 401);
    const path = new URL(req.url).pathname.split('/').filter(Boolean);
    const action = path[path.length - 1];

    if (req.method === 'GET') return json({ business: await loadAggregate(db, user.id, user.tenant_id) });
    if (req.method === 'PUT' || req.method === 'PATCH') return json({ business: await saveAggregate(db, user, await req.json()) });
    if (req.method === 'POST' && action === 'publish') {
      const existing = await ownedBusiness(db, user.id, user.tenant_id);
      const refreshed = await db.rpc('refresh_business_readiness', { target_business_id: existing.id });
      if (refreshed.error) throw new ApiError(refreshed.error.message, 409);
      const published = await db.rpc('publish_business', { target_business_id: existing.id });
      if (published.error) throw new ApiError(published.error.message, 409);
      return json({ business: published.data });
    }
    return errorResponse('Method not allowed', 405);
  } catch (error) {
    return handleError(error);
  }
});

async function ownedBusiness(db: ReturnType<typeof createSupabaseClient>, userId: string, tenantId: string) {
  const { data, error } = await db.from('businesses').select('*').eq('owner_user_id', userId).eq('tenant_id', tenantId).maybeSingle();
  if (error) throw new ApiError(error.message, 500);
  if (!data) throw new ApiError('Business not found', 404);
  return data;
}

async function loadAggregate(db: ReturnType<typeof createSupabaseClient>, userId: string, tenantId: string) {
  const business = await ownedBusiness(db, userId, tenantId);
  const [branches, services] = await Promise.all([
    db.from('branches').select('*,staff_members(*,staff_availability_windows(*))').eq('business_id', business.id),
    db.from('services').select('*').eq('business_id', business.id),
  ]);
  if (branches.error || services.error) throw new ApiError(branches.error?.message ?? services.error?.message ?? 'Unable to load business', 500);
  return { ...business, branches: branches.data ?? [], services: services.data ?? [] };
}

async function saveAggregate(db: ReturnType<typeof createSupabaseClient>, user: { id: string; tenant_id: string }, input: any) {
  const existing = await db.from('businesses').select('*').eq('owner_user_id', user.id).eq('tenant_id', user.tenant_id).maybeSingle();
  if (existing.error) throw new ApiError(existing.error.message, 500);
  const profile = input.profile ?? input;
  const businessRow = {
    tenant_id: user.tenant_id, owner_user_id: user.id,
    name: String(profile.name ?? existing.data?.name ?? '').trim(),
    category: String(profile.category ?? existing.data?.category ?? '').trim(),
    description: profile.description ?? existing.data?.description ?? null,
    business_type: profile.business_type ?? existing.data?.business_type ?? 'SOLO',
    booking_policy: input.booking_policy ?? existing.data?.booking_policy ?? {},
    payment_policy: input.payment_policy ?? existing.data?.payment_policy ?? {},
    payout_state: input.payout_state ?? existing.data?.payout_state ?? 'NOT_CONFIGURED',
    lifecycle_status: existing.data?.lifecycle_status ?? 'SETUP_IN_PROGRESS', is_active: false,
  };
  if (!businessRow.name || !businessRow.category) throw new ApiError('Business name and category are required', 422);
  const saved = existing.data
    ? await db.from('businesses').update(businessRow).eq('id', existing.data.id).select('*').single()
    : await db.from('businesses').insert(businessRow).select('*').single();
  if (saved.error || !saved.data) throw new ApiError(saved.error?.message ?? 'Unable to save business', 500);
  const businessId = saved.data.id;
  const artisanLookup = await db.from('artisans').select('id').eq('user_id', user.id).maybeSingle();
  if (artisanLookup.error) throw new ApiError(artisanLookup.error.message, 500);
  const artisanResult = artisanLookup.data
    ? await db.from('artisans').update({ business_id: businessId, business_name: businessRow.name, category: businessRow.category }).eq('id', artisanLookup.data.id).select('id').single()
    : await db.from('artisans').insert({ tenant_id: user.tenant_id, user_id: user.id, business_id: businessId, business_name: businessRow.name, category: businessRow.category, is_active: false }).select('id').single();
  if (artisanResult.error || !artisanResult.data) throw new ApiError(artisanResult.error?.message ?? 'Unable to link provider profile', 500);
  const artisanId = artisanResult.data.id;

  if (input.location) {
    const branch = { tenant_id: user.tenant_id, business_id: businessId, name: input.location.name ?? 'Main location', address: input.location.address, city: input.location.city ?? 'Lagos', state: input.location.state ?? 'Lagos State', phone: input.location.phone ?? null };
    if (!branch.address) throw new ApiError('Location address is required', 422);
    const prior = await db.from('branches').select('id').eq('business_id', businessId).order('created_at').limit(1).maybeSingle();
    const result = prior.data ? await db.from('branches').update(branch).eq('id', prior.data.id) : await db.from('branches').insert(branch);
    if (result.error) throw new ApiError(result.error.message, 500);
  }

  if (Array.isArray(input.services)) {
    for (const service of input.services) {
      const row = { tenant_id: user.tenant_id, business_id: businessId, artisan_id: service.artisan_id ?? artisanId, branch_id: service.branch_id ?? null, name: service.name, description: service.description ?? null, category: service.category ?? businessRow.category, duration_minutes: service.duration_minutes, price_cents: service.price_cents, status: 'active', is_active: true };
      const result = service.id ? await db.from('services').update(row).eq('id', service.id).eq('business_id', businessId) : await db.from('services').insert(row);
      if (result.error) throw new ApiError(result.error.message, 500);
    }
  }

  const refreshed = await db.rpc('refresh_business_readiness', { target_business_id: businessId });
  if (refreshed.error) throw new ApiError(refreshed.error.message, 500);
  return loadAggregate(db, user.id, user.tenant_id);
}

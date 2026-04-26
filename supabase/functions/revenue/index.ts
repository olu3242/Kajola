import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';
import { emitSystemEvent } from '../automation_helpers.ts';

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const supabase = createSupabaseClient();
    const auth = await optionalAuth(req);

    if (req.method === 'GET' && segments[0] === 'subscriptions') {
      return await getSubscriptions(supabase, auth);
    }

    if (req.method === 'POST' && segments[0] === 'subscriptions') {
      const authPayload = await authenticateRequest(req);
      return await purchaseSubscription(supabase, authPayload, await req.json());
    }

    if (req.method === 'GET' && segments[0] === 'featured') {
      return await getFeaturedOptions(supabase, auth);
    }

    if (req.method === 'POST' && segments[0] === 'featured') {
      const authPayload = await authenticateRequest(req);
      return await purchaseFeaturedListing(supabase, authPayload, await req.json());
    }

    if (req.method === 'GET' && segments[0] === 'discounts') {
      return await validateDiscountCode(supabase, req);
    }

    if (req.method === 'GET' && segments[0] === 'analytics') {
      const authPayload = await authenticateRequest(req);
      return await getArtisanAnalytics(supabase, authPayload);
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    return handleError(err);
  }
});

async function getSubscriptions(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  const tenant = await loadTenantForAuth(supabase, auth);
  return json({
    subscription: {
      current_tier: tenant.subscription_tier,
      platform_fee_percent: Number(tenant.platform_fee_percent ?? 10),
      plans: [
        { tier: 'free', title: 'Free', description: 'Limited visibility, basic marketplace access', rank_boost: 0, analytics: false },
        { tier: 'pro', title: 'Pro', description: 'Higher ranking boost and analytics insights', rank_boost: 10, analytics: true },
        { tier: 'elite', title: 'Elite', description: 'Top placement, priority leads and premium exposure', rank_boost: 18, analytics: true }
      ]
    }
  });
}

async function purchaseSubscription(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const desiredTier = body.subscription_tier;
  const amount_cents = Number(body.amount_cents ?? 0);
  const currency = body.currency ?? 'NGN';
  if (!['free', 'pro', 'elite'].includes(desiredTier)) {
    throw new ApiError('Invalid subscription tier', 400);
  }
  if (amount_cents <= 0) {
    throw new ApiError('Subscription purchase requires amount_cents', 400);
  }
  const tenant = await loadTenantForAuth(supabase, auth);
  const reference = `subscription_${crypto.randomUUID()}`;

  const { error: updateError } = await supabase.from('tenants').update({
    subscription_tier: desiredTier,
    subscription_updated_at: new Date().toISOString()
  }).eq('id', tenant.id);
  if (updateError) throw new ApiError(updateError.message, 500);

  const { error: txError } = await supabase.from('billing_transactions').insert({
    tenant_id: tenant.id,
    artisan_id: auth.role === 'artisan' ? await getArtisanIdForUser(supabase, auth) : null,
    type: 'subscription',
    amount_cents,
    currency,
    platform_fee_cents: 0,
    net_amount_cents: amount_cents,
    reference,
    status: 'completed',
    metadata: { tier: desiredTier }
  });
  if (txError) throw new ApiError(txError.message, 500);

  await emitSystemEvent(supabase, tenant.id, 'subscription_started', {
    tenant_id: tenant.id,
    user_id: auth.sub,
    subscription_tier: desiredTier,
    amount_cents,
    currency,
    reference
  }, 'revenue', auth.sub, 'tenant', tenant.id);

  return json({ success: true, subscription_tier: desiredTier, reference });
}

async function getFeaturedOptions(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  const response = await supabase.from('featured_listings').select('*, artisans(business_name)').in('status', ['active']).order('ends_at', { ascending: true }).limit(20);
  if (response.error) throw new ApiError(response.error.message, 500);

  const featuredForUser = auth?.sub ? await getActiveFeaturedForUser(supabase, auth) : null;
  return json({ featured: featuredForUser, options: [
    { type: 'boost', title: 'Boost visibility', description: 'Faster exposure in discovery feeds', suggested_amount_cents: 5000, duration_days: 7 },
    { type: 'top_placement', title: 'Top placement', description: 'Featured at the top of search results for a week', suggested_amount_cents: 12000, duration_days: 7 }
  ] });
}

async function purchaseFeaturedListing(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const artisan = await getArtisanProfile(supabase, auth);
  const type = body.type;
  const durationDays = Number(body.duration_days ?? 7);
  const amount_cents = Number(body.amount_cents ?? 0);
  const currency = body.currency ?? 'NGN';
  if (!['boost', 'top_placement'].includes(type)) {
    throw new ApiError('Invalid featured listing type', 400);
  }
  if (durationDays <= 0 || amount_cents <= 0) {
    throw new ApiError('duration_days and amount_cents are required', 400);
  }

  const startsAt = new Date();
  const endsAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
  const purchaseReference = `featured_${crypto.randomUUID()}`;

  const { data: listing, error: insertError } = await supabase.from('featured_listings').insert({
    tenant_id: artisan.tenant_id,
    artisan_id: artisan.id,
    type,
    amount_cents,
    currency,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt.toISOString(),
    purchase_reference: purchaseReference,
    status: 'active'
  }).select().single();
  if (insertError || !listing) throw new ApiError(insertError?.message ?? 'Unable to create featured listing', 500);

  const { error: txError } = await supabase.from('billing_transactions').insert({
    tenant_id: artisan.tenant_id,
    artisan_id: artisan.id,
    featured_listing_id: listing.id,
    type: 'featured_listing',
    amount_cents,
    currency,
    platform_fee_cents: 0,
    net_amount_cents: amount_cents,
    reference: purchaseReference,
    status: 'completed',
    metadata: { duration_days: durationDays }
  });
  if (txError) throw new ApiError(txError.message, 500);

  await emitSystemEvent(supabase, artisan.tenant_id, 'boost_activated', {
    featured_listing_id: listing.id,
    artisan_id: artisan.id,
    user_id: auth.sub,
    type,
    ends_at: listing.ends_at,
    amount_cents,
    currency
  }, 'revenue', auth.sub, 'featured_listing', listing.id);

  return json({ success: true, featured_listing: listing });
}

async function validateDiscountCode(supabase: ReturnType<typeof createSupabaseClient>, req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const tenantId = url.searchParams.get('tenant_id');
  if (!code || !tenantId) {
    return errorResponse('code and tenant_id are required', 400);
  }

  const { data, error } = await supabase.from('discount_codes').select('*').eq('tenant_id', tenantId).ilike('code', code).single();
  if (error || !data || !data.active || data.starts_at > new Date().toISOString() || data.ends_at < new Date().toISOString()) {
    return json({ valid: false, discount_cents: 0, percent_off: 0 }, 200);
  }

  const discount = Number(data.amount_cents ?? 0) || Math.round((Number(data.percent_off ?? 0) / 100) * 100);
  return json({ valid: true, discount_cents: Number(data.amount_cents ?? 0), percent_off: Number(data.percent_off ?? 0), code: data.code, description: data.description, max_uses: data.max_uses, used_count: data.used_count });
}

async function getArtisanAnalytics(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  const artisan = await getArtisanProfile(supabase, auth);
  const { data, error } = await supabase.from('artisan_analytics').select('*').eq('artisan_id', artisan.id).single();
  if (error) throw new ApiError(error.message, 500);
  return json({ analytics: data ?? { artisan_id: artisan.id, views: 0, clicks: 0, bookings: 0, conversion_rate: 0 } });
}

async function loadTenantForAuth(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  if (!auth) throw new ApiError('Unauthorized', 401);
  if (auth.role === 'tenant_admin') {
    const { data, error } = await supabase.from('tenants').select('*').eq('id', auth.tenant_id).single();
    if (error || !data) throw new ApiError('Tenant not found', 404);
    return data;
  }
  const artisan = await getArtisanProfile(supabase, auth);
  const { data, error } = await supabase.from('tenants').select('*').eq('id', artisan.tenant_id).single();
  if (error || !data) throw new ApiError('Tenant not found', 404);
  return data;
}

async function getArtisanProfile(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  const { data, error } = await supabase.from('artisans').select('*').eq('user_id', auth.sub).single();
  if (error || !data) throw new ApiError('Artisan profile not found', 404);
  return data;
}

async function getArtisanIdForUser(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  const artisan = await getArtisanProfile(supabase, auth);
  return artisan.id;
}

async function getActiveFeaturedForUser(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  if (!auth) return null;
  const artisan = await getArtisanProfile(supabase, auth);
  const { data, error } = await supabase.from('featured_listings').select('*').eq('artisan_id', artisan.id).eq('status', 'active');
  if (error) throw new ApiError(error.message, 500);
  return data ?? [];
}

async function optionalAuth(req: Request) {
  try {
    return await authenticateRequest(req);
  } catch {
    return null;
  }
}

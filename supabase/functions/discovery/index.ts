import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'GET') return errorResponse('Method not allowed', 405);
  try {
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const supabase = createSupabaseClient();
    const limit = Math.min(Number(url.searchParams.get('limit') || 12), 30);

    if (segments[1] === 'recommended') {
      const auth = await optionalAuth(req);
      return await getRecommended(supabase, auth, limit);
    }

    if (segments[1] === 'popular') {
      return await getPopular(supabase, limit);
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    return handleError(err);
  }
});

async function optionalAuth(req: Request) {
  try {
    return await authenticateRequest(req);
  } catch {
    return null;
  }
}

async function getRecommended(supabase: ReturnType<typeof createSupabaseClient>, auth: any, limit: number) {
  if (auth?.sub) {
    const { data: cache } = await supabase
      .from('recommendation_cache')
      .select('artisans, expires_at')
      .eq('user_id', auth.sub)
      .eq('section', 'recommended')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (cache?.artisans) return json({ artisans: cache.artisans, cached: true });
  }

  const scored = auth?.sub
    ? await rpcScores(supabase, 'score_recommended_artisans', { target_user_id: auth.sub, result_limit: limit })
    : await rpcScores(supabase, 'score_popular_artisans', { result_limit: limit });

  const artisans = await hydrateArtisans(supabase, scored);
  if (auth?.sub) {
    await supabase.from('recommendation_cache').upsert({
      user_id: auth.sub,
      section: 'recommended',
      artisans,
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    });
  }
  return json({ artisans });
}

async function getPopular(supabase: ReturnType<typeof createSupabaseClient>, limit: number) {
  const scored = await rpcScores(supabase, 'score_popular_artisans', { result_limit: limit });
  return json({ artisans: await hydrateArtisans(supabase, scored) });
}

async function rpcScores(supabase: ReturnType<typeof createSupabaseClient>, fn: string, args: Record<string, unknown>) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new ApiError(error.message, 500);
  return data ?? [];
}

async function hydrateArtisans(supabase: ReturnType<typeof createSupabaseClient>, scores: any[]) {
  const ids = scores.map((score) => score.artisan_id);
  if (ids.length === 0) return [];

  const { data: artisans, error: artisansError } = await supabase
    .from('artisans')
    .select('*, artisan_stats(*)')
    .eq('verified', true)
    .eq('is_active', true)
    .eq('onboarding_status', 'verified')
    .in('id', ids);
  if (artisansError) throw new ApiError(artisansError.message, 500);

  const tenantIds = Array.from(new Set((artisans ?? []).map((artisan: any) => artisan.tenant_id)));
  const featuredRows = await supabase
    .from('featured_listings')
    .select('artisan_id,type,status')
    .in('artisan_id', ids)
    .eq('status', 'active');
  if (featuredRows.error) throw new ApiError(featuredRows.error.message, 500);

  const tenantsResult = await supabase.from('tenants').select('id,subscription_tier').in('id', tenantIds);
  if (tenantsResult.error) throw new ApiError(tenantsResult.error.message, 500);

  const scoreById = new Map(scores.map((score) => [score.artisan_id, score]));
  const featuredByArtisan = new Map((featuredRows.data ?? []).map((row: any) => [row.artisan_id, row]));
  const subscriptionByTenant = new Map((tenantsResult.data ?? []).map((row: any) => [row.id, row.subscription_tier]));

  return (artisans ?? [])
    .map((artisan: any) => {
      const stats = Array.isArray(artisan.artisan_stats) ? artisan.artisan_stats[0] : artisan.artisan_stats;
      const trustScore = Number(stats?.trust_score ?? 0);
      const score = scoreById.get(artisan.id);
      const featured = featuredByArtisan.get(artisan.id);
      const subscriptionTier = subscriptionByTenant.get(artisan.tenant_id) ?? 'free';
      return {
        ...artisan,
        stats: stats ?? null,
        trust_score: trustScore,
        recommendation_score: Number(score?.recommendation_score ?? trustScore),
        reason: score?.reason ?? 'Recommended by quality and availability',
        is_featured: Boolean(featured),
        featured_type: featured?.type ?? null,
        subscription_tier: subscriptionTier,
        badges: [
          trustScore >= 90 ? 'Top Rated' : trustScore >= 75 ? 'Reliable' : null,
          Boolean(featured) ? (featured.type === 'top_placement' ? 'Featured Top' : 'Featured Boost') : null,
          subscriptionTier === 'elite' ? 'Elite Seller' : subscriptionTier === 'pro' ? 'Pro Seller' : null,
          Number(stats?.response_time_avg ?? 0) > 0 && Number(stats?.response_time_avg ?? 0) <= 15 ? 'Fast Responder' : null,
          Number(stats?.total_jobs ?? 0) >= 25 ? 'Most Booked' : null
        ].filter(Boolean)
      };
    })
    .sort((a: any, b: any) => b.recommendation_score - a.recommendation_score);
}

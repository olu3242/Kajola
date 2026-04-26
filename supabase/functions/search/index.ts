import { serve, json, errorResponse, createSupabaseClient, handleError } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(req.url);
  try {
    const supabase = createSupabaseClient();
    return await searchArtisans(supabase, url.searchParams);
  } catch (err) {
    return handleError(err);
  }
});

async function searchArtisans(supabase: ReturnType<typeof createSupabaseClient>, params: URLSearchParams) {
  const category = params.get('category');
  const search = params.get('search');
  const limit = Number(params.get('limit') || 20);
  const offset = Number(params.get('offset') || 0);

  let query = supabase
    .from('artisans')
    .select('*, artisan_stats(*)')
    .eq('verified', true)
    .eq('is_active', true)
    .eq('onboarding_status', 'verified')
    .order('trust_score', { referencedTable: 'artisan_stats', ascending: false, nullsFirst: false })
    .order('total_jobs', { referencedTable: 'artisan_stats', ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (category) query = query.ilike('category', `%${category}%`);
  if (search) query = query.or(`business_name.ilike.%${search}%,headline.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);

  return json({ artisans: (data ?? []).map((artisan: any) => {
    const stats = Array.isArray(artisan.artisan_stats) ? artisan.artisan_stats[0] : artisan.artisan_stats;
    const trustScore = Number(stats?.trust_score ?? 0);
    const baselineScore = artisan.verified && trustScore <= 0 ? 60 : trustScore;
    return {
      ...artisan,
      stats: stats ?? null,
      trust_score: baselineScore,
      badges: [
        artisan.verified && trustScore <= 0 ? 'New but Verified' : null,
        baselineScore >= 90 ? 'Top Rated' : baselineScore >= 75 ? 'Reliable' : null
      ].filter(Boolean)
    };
  }) });
}

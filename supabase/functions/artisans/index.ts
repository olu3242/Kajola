import { serve, json, errorResponse, createSupabaseClient, handleError } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(req.url);
  const artisanId = url.searchParams.get('id');

  try {
    const supabase = createSupabaseClient();

    if (artisanId) {
      return await getArtisanById(supabase, artisanId);
    }

    return await listArtisans(supabase, url.searchParams);
  } catch (err) {
    return handleError(err);
  }
});

async function listArtisans(supabase: ReturnType<typeof createSupabaseClient>, params: URLSearchParams) {
  const category = params.get('category');
  const search = params.get('search');
  const city = params.get('city');
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
  if (city) query = query.ilike('city', `%${city}%`);
  if (search) query = query.or(`business_name.ilike.%${search}%,headline.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);

  return json({ artisans: (data ?? []).map(withTrustBadge) });
}

async function getArtisanById(supabase: ReturnType<typeof createSupabaseClient>, id: string) {
  const { data, error } = await supabase.from('artisans').select('*, artisan_stats(*)').eq('id', id).single();
  if (error || !data) return errorResponse('Artisan not found', 404);
  return json({ artisan: withTrustBadge(data) });
}

function withTrustBadge(artisan: any) {
  const stats = Array.isArray(artisan.artisan_stats) ? artisan.artisan_stats[0] : artisan.artisan_stats;
  const trustScore = Number(stats?.trust_score ?? 0);
  const baselineScore = artisan.verified && trustScore <= 0 ? 60 : trustScore;
  const badges = [
    artisan.verified && trustScore <= 0 ? 'New but Verified' : null,
    baselineScore >= 90 ? 'Top Rated' : baselineScore >= 75 ? 'Reliable' : null,
    Number(stats?.response_time_avg ?? 0) > 0 && Number(stats?.response_time_avg ?? 0) <= 15 ? 'Fast Responder' : null,
    Number(stats?.total_jobs ?? 0) >= 25 ? 'Most Booked' : null
  ].filter(Boolean);
  return { ...artisan, stats: stats ?? null, trust_score: baselineScore, badges };
}

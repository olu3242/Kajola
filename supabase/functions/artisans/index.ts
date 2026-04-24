import { serve, json, errorResponse, createSupabaseClient } from '../_shared.ts';

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
    console.error(err);
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});

async function listArtisans(supabase: ReturnType<typeof createSupabaseClient>, params: URLSearchParams) {
  const category = params.get('category');
  const search = params.get('search');
  const city = params.get('city');
  const limit = Number(params.get('limit') || 20);
  const offset = Number(params.get('offset') || 0);

  let query = supabase.from('artisans').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  if (category) query = query.ilike('category', `%${category}%`);
  if (city) query = query.ilike('city', `%${city}%`);
  if (search) query = query.or(`business_name.ilike.%${search}%,headline.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);

  return json({ artisans: data ?? [] });
}

async function getArtisanById(supabase: ReturnType<typeof createSupabaseClient>, id: string) {
  const { data, error } = await supabase.from('artisans').select('*').eq('id', id).single();
  if (error || !data) return errorResponse('Artisan not found', 404);
  return json({ artisan: data });
}

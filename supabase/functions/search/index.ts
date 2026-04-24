import { serve, json, errorResponse, createSupabaseClient } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(req.url);
  try {
    const supabase = createSupabaseClient();
    return await searchArtisans(supabase, url.searchParams);
  } catch (err) {
    console.error(err);
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});

async function searchArtisans(supabase: ReturnType<typeof createSupabaseClient>, params: URLSearchParams) {
  const category = params.get('category');
  const search = params.get('search');
  const limit = Number(params.get('limit') || 20);
  const offset = Number(params.get('offset') || 0);

  let query = supabase.from('artisans').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1);

  if (category) query = query.ilike('category', `%${category}%`);
  if (search) query = query.or(`business_name.ilike.%${search}%,headline.ilike.%${search}%,description.ilike.%${search}%`);

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);

  return json({ artisans: data ?? [] });
}

import { serve, json, errorResponse, createSupabaseClient } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(req.url);
  const artisanId = url.searchParams.get('artisan_id');
  const serviceId = url.searchParams.get('service_id');
  const limit = Number(url.searchParams.get('limit') || 20);
  const offset = Number(url.searchParams.get('offset') || 0);

  try {
    const supabase = createSupabaseClient();
    if (serviceId) {
      return await getServiceById(supabase, serviceId);
    }
    return await listServices(supabase, artisanId, limit, offset);
  } catch (err) {
    console.error(err);
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});

async function listServices(supabase: ReturnType<typeof createSupabaseClient>, artisanId: string | null, limit: number, offset: number) {
  let query = supabase.from('services').select('*').order('created_at', { ascending: false }).range(offset, offset + limit - 1);
  if (artisanId) query = query.eq('artisan_id', artisanId);

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);
  return json({ services: data ?? [] });
}

async function getServiceById(supabase: ReturnType<typeof createSupabaseClient>, id: string) {
  const { data, error } = await supabase.from('services').select('*').eq('id', id).single();
  if (error || !data) return errorResponse('Service not found', 404);
  return json({ service: data });
}

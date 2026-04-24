import { serve, json, errorResponse, createSupabaseClient } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405);
  }

  const url = new URL(req.url);
  const slotId = url.searchParams.get('slot_id');
  const artisanId = url.searchParams.get('artisan_id');
  const serviceId = url.searchParams.get('service_id');
  const status = url.searchParams.get('status');
  const limit = Number(url.searchParams.get('limit') || 20);
  const offset = Number(url.searchParams.get('offset') || 0);

  try {
    const supabase = createSupabaseClient();
    if (slotId) {
      return await getBookingSlotById(supabase, slotId);
    }
    return await listBookingSlots(supabase, artisanId, serviceId, status, limit, offset);
  } catch (err) {
    console.error(err);
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});

async function listBookingSlots(
  supabase: ReturnType<typeof createSupabaseClient>,
  artisanId: string | null,
  serviceId: string | null,
  status: string | null,
  limit: number,
  offset: number
) {
  let query = supabase.from('booking_slots').select('*').order('start_at', { ascending: true }).range(offset, offset + limit - 1);
  if (artisanId) query = query.eq('artisan_id', artisanId);
  if (serviceId) query = query.eq('service_id', serviceId);
  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return errorResponse(error.message, 500);
  return json({ booking_slots: data ?? [] });
}

async function getBookingSlotById(supabase: ReturnType<typeof createSupabaseClient>, id: string) {
  const { data, error } = await supabase.from('booking_slots').select('*').eq('id', id).single();
  if (error || !data) return errorResponse('Booking slot not found', 404);
  return json({ booking_slot: data });
}

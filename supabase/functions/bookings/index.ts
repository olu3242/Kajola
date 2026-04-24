import { serve, json, errorResponse, createSupabaseClient, authenticateRequest } from '../_shared.ts';

serve(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    const supabase = createSupabaseClient();

    const path = new URL(req.url).pathname;
    const segments = path.split('/').filter(Boolean);

    if (req.method === 'POST' && segments.length === 1) {
      if (auth.role !== 'client') {
        return errorResponse('Forbidden', 403);
      }
      const body = await req.json();
      return await handleCreateBooking(supabase, auth, body);
    }

    if (req.method === 'POST' && segments.length === 3 && segments[2] === 'status') {
      const bookingId = segments[1];
      const body = await req.json();
      return await handleUpdateBookingStatus(supabase, auth, bookingId, body);
    }

    if (req.method === 'GET') {
      const bookingId = segments.length > 1 ? segments[1] : null;
      return bookingId
        ? await handleGetBooking(supabase, auth, bookingId)
        : await handleListBookings(supabase, auth, new URL(req.url).searchParams);
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    console.error(err);
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});

async function handleListBookings(supabase: ReturnType<typeof createSupabaseClient>, auth: any, params: URLSearchParams) {
  const status = params.get('status');
  let query = supabase
    .from('bookings')
    .select('*, services(name, price_cents, currency), artisans(business_name), payments(*)');

  if (auth.role === 'client') {
    query = query.eq('client_id', auth.sub);
  } else if (auth.role === 'tenant_admin') {
    query = query.eq('tenant_id', auth.tenant_id);
  } else {
    return errorResponse('Forbidden', 403);
  }

  if (status) {
    query = query.eq('status', status);
  }

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) {
    return errorResponse(error.message, 500);
  }

  return json({ bookings: data ?? [] });
}

async function handleGetBooking(supabase: ReturnType<typeof createSupabaseClient>, auth: any, bookingId: string) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*, services(name, price_cents, currency), artisans(business_name), payments(*)')
    .eq('id', bookingId)
    .single();

  if (error) {
    return errorResponse(error.message, 500);
  }

  if (!booking) {
    return errorResponse('Booking not found', 404);
  }

  if (auth.role === 'client' && booking.client_id !== auth.sub) {
    return errorResponse('Forbidden', 403);
  }

  if (auth.role === 'tenant_admin' && booking.tenant_id !== auth.tenant_id) {
    return errorResponse('Forbidden', 403);
  }

  return json({ booking });
}

async function handleUpdateBookingStatus(supabase: ReturnType<typeof createSupabaseClient>, auth: any, bookingId: string, body: any) {
  const { status } = body;
  const allowedStatuses = ['pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'];
  if (!status || !allowedStatuses.includes(status)) {
    return errorResponse('Invalid status', 400);
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (bookingError || !booking) {
    return errorResponse('Booking not found', 404);
  }

  if (auth.role === 'client') {
    if (booking.client_id !== auth.sub) {
      return errorResponse('Forbidden', 403);
    }
    if (status !== 'cancelled') {
      return errorResponse('Clients may only cancel bookings', 403);
    }
  } else if (auth.role === 'tenant_admin') {
    if (booking.tenant_id !== auth.tenant_id) {
      return errorResponse('Forbidden', 403);
    }
  } else {
    return errorResponse('Forbidden', 403);
  }

  const { data: updated, error: updateError } = await supabase
    .from('bookings')
    .update({ status })
    .eq('id', bookingId)
    .select()
    .single();

  if (updateError || !updated) {
    return errorResponse(updateError?.message ?? 'Could not update status', 500);
  }

  return json({ booking: updated });
}

async function handleCreateBooking(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { slot_id, service_id, artisan_id, notes } = body;
  if (!slot_id || !service_id || !artisan_id) {
    return errorResponse('slot_id, service_id, and artisan_id are required', 400);
  }

  const client_id = auth.sub as string;
  const tenant_id = auth.tenant_id as string;

  const { data: slot, error: slotError } = await supabase
    .from('booking_slots')
    .select('*')
    .eq('id', slot_id)
    .single();

  if (slotError || !slot) {
    return errorResponse('Booking slot not found', 404);
  }

  if (slot.tenant_id !== tenant_id) {
    return errorResponse('Slot not available for your tenant', 403);
  }

  if (slot.artisan_id !== artisan_id || slot.service_id !== service_id) {
    return errorResponse('Booking details do not match slot', 400);
  }

  if (slot.status !== 'available') {
    return errorResponse('Slot is not available', 409);
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .insert({
      tenant_id,
      slot_id,
      service_id,
      artisan_id,
      client_id,
      status: 'pending',
      notes,
      metadata: {}
    })
    .select()
    .single();

  if (bookingError || !booking) {
    return errorResponse(bookingError?.message ?? 'Could not create booking', 500);
  }

  const { error: slotUpdateError } = await supabase
    .from('booking_slots')
    .update({ status: 'held', held_by_user_id: client_id, booking_id: booking.id })
    .eq('id', slot_id);

  if (slotUpdateError) {
    await supabase.from('bookings').delete().eq('id', booking.id);
    return errorResponse('Failed to lock booking slot', 500);
  }

  return json({ booking });
}

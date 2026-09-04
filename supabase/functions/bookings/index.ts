import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError } from '../_shared.ts';

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

    if ((req.method === 'POST' || req.method === 'PATCH') && segments.length === 3 && segments[2] === 'status') {
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
    return handleError(err);
  }
});

async function handleListBookings(supabase: ReturnType<typeof createSupabaseClient>, auth: any, params: URLSearchParams) {
  const status = params.get('status');
  let query = supabase
    .from('bookings')
    .select('*, services(name, price_cents, currency), artisans(business_name), payments(*), escrow_accounts(*), reviews(id,rating), recovery_cases(*, recovery_recommendations(*, booking_slots(start_at,end_at)))');

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
    .select('*, services(name, price_cents, currency), artisans(business_name), payments(*), escrow_accounts(*), reviews(id,rating), recovery_cases(*, recovery_recommendations(*, booking_slots(start_at,end_at)))')
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
  const allowedStatuses = ['pending', 'awaiting_payment', 'paid', 'confirmed', 'in_progress', 'completed', 'cancelled'];
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
    if (!['pending', 'awaiting_payment', 'confirmed', 'in_progress'].includes(booking.status)) {
      return errorResponse('This booking cannot be cancelled', 409);
    }
  } else if (auth.role === 'tenant_admin') {
    if (booking.tenant_id !== auth.tenant_id) {
      return errorResponse('Forbidden', 403);
    }
  } else {
    return errorResponse('Forbidden', 403);
  }

  const updatePayload: Record<string, unknown> = { status };
  if (status === 'cancelled') updatePayload.cancellation_reason = body.reason ?? 'Cancelled by user';
  const { data: updated, error: updateError } = await supabase
    .from('bookings')
    .update(updatePayload)
    .eq('id', bookingId)
    .select('*, services(name, price_cents, currency), artisans(business_name), payments(*), escrow_accounts(*), reviews(id,rating)')
    .single();

  if (updateError || !updated) {
    return errorResponse(updateError?.message ?? 'Could not update status', 500);
  }

  if (status === 'cancelled') {
    await supabase
      .from('booking_slots')
      .update({ status: 'available', held_by_user_id: null, booking_id: null })
      .eq('id', booking.slot_id);
    await supabase.from('payments').update({ status: 'failed' }).eq('booking_id', bookingId).neq('status', 'successful');
  }

  return json({ booking: updated });
}

async function handleCreateBooking(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { slot_id, service_id, artisan_id, staff_id, notes, payment_mode = 'instant' } = body;
  if (!slot_id || !service_id || !artisan_id) {
    return errorResponse('slot_id, service_id, and artisan_id are required', 400);
  }
  if (!['instant', 'escrow'].includes(payment_mode)) {
    return errorResponse('Invalid payment mode', 400);
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

  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('price_cents, currency')
    .eq('id', service_id)
    .single();

  if (serviceError || !service) {
    return errorResponse('Service not found', 404);
  }

  const suppliedKey = String(body.idempotency_key ?? '');
  const requestKey = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(suppliedKey)
    ? suppliedKey : crypto.randomUUID();
  const existing = await supabase.from('bookings').select('*').eq('idempotency_key', requestKey).eq('tenant_id', tenant_id).maybeSingle();
  if (existing.error) return errorResponse(existing.error.message, 500);
  if (existing.data) return json({ booking: existing.data, cached: true });

  const quoteExpiry = new Date(Date.now() + 5 * 60_000).toISOString();
  const { data: quote, error: quoteError } = await supabase.from('quote_snapshots').insert({
    tenant_id, slot_id, service_id, customer_id: client_id, currency: service.currency ?? 'NGN',
    subtotal: service.price_cents, discount: 0, customer_fee: 0, total: service.price_cents,
    pricing_version: 'booking-v1', expires_at: quoteExpiry,
  }).select('id').single();
  if (quoteError || !quote) return errorResponse(quoteError?.message ?? 'Could not persist quote', 500);

  const { data: held, error: holdError } = await supabase.rpc('create_slot_hold', {
    target_slot_id: slot_id, target_service_id: service_id, target_customer_id: client_id,
    target_tenant_id: tenant_id, target_quote_snapshot_id: quote.id, request_key: requestKey,
    hold_minutes: 5, target_staff_id: staff_id ?? null,
  });
  if (holdError || !held) {
    const conflict = holdError?.message?.includes('SLOT_UNAVAILABLE') || holdError?.code === '23P01';
    return errorResponse(conflict ? 'Slot is not available' : holdError?.message ?? 'Could not hold slot', conflict ? 409 : 500);
  }

  const bookingId = Array.isArray(held) ? held[0]?.id : held.id;
  const { data: booking, error: updateError } = await supabase.from('bookings').update({
    user_id: client_id, payment_mode, total_amount: service.price_cents, notes,
    metadata: { quote_snapshot_id: quote.id, pricing_version: 'booking-v1' },
  }).eq('id', bookingId).select('*').single();
  if (updateError || !booking) return errorResponse(updateError?.message ?? 'Booking hold persisted but response could not be loaded', 500);
  return json({ booking, quote: { id: quote.id, expires_at: quoteExpiry } });
}

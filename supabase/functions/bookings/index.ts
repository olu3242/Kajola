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

  const { data: quote, error: quoteError } = await supabase
    .from('quote_snapshots')
    .select('*')
    .eq('id', booking.quote_snapshot_id)
    .single();
  if (quoteError || !quote) {
    return errorResponse('Immutable commerce snapshot not found', 409);
  }

  const successfulPayments = (booking.payments ?? []).filter((payment: any) =>
    payment.status === 'successful' && String(payment.purpose ?? '').toUpperCase() !== 'TIP'
  );
  const previouslyPaid = successfulPayments.reduce(
    (sum: number, payment: any) => sum + Number(payment.amount_cents ?? payment.amount ?? 0),
    0,
  );
  const remaining = Math.max(0, Number(quote.customer_total) - previouslyPaid);
  const arrangement = String(quote.payment_arrangement ?? 'FULL').toUpperCase();
  const purpose = previouslyPaid > 0
    ? 'balance'
    : ['DEPOSIT', 'PARTIAL'].includes(arrangement) ? 'deposit' : 'full';
  const subtotalDue = purpose === 'deposit'
    ? Math.min(remaining, Number(quote.amount_due_now))
    : remaining;
  const methods = ['bank_transfer', 'card', 'ussd', 'bank_account', 'payment_link', 'pay_at_venue', 'cash'];

  return json({
    booking: {
      ...booking,
      provider_name: booking.artisans?.business_name,
      service_name: booking.services?.name,
    },
    quote: {
      policy_version: quote.policy_version,
      currency: quote.currency,
      purpose,
      service_amount_kobo: Number(quote.service_base) + Number(quote.add_ons) - Number(quote.discount),
      previously_paid_kobo: previouslyPaid,
      subtotal_due_kobo: subtotalDue,
      gateway_fee_kobo: 0,
      platform_fee_kobo: Number(quote.kajola_gross_revenue),
      customer_total_kobo: subtotalDue,
      provider_net_kobo: Number(quote.provider_net_entitlement),
      balance_after_payment_kobo: Math.max(0, remaining - subtotalDue),
      methods,
    },
  });
}

async function handleUpdateBookingStatus(supabase: ReturnType<typeof createSupabaseClient>, auth: any, bookingId: string, body: any) {
  const { status } = body;
  const allowedStatuses = ['acknowledged', 'checked_in', 'in_progress', 'completed', 'cancelled', 'no_show', 'disputed'];
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
    if (!['pending', 'held', 'awaiting_payment', 'confirmed'].includes(booking.status)) {
      return errorResponse('This booking cannot be cancelled', 409);
    }
  } else if (auth.role === 'tenant_admin') {
    if (booking.tenant_id !== auth.tenant_id) {
      return errorResponse('Forbidden', 403);
    }
  } else if (auth.role === 'artisan') {
    const { data: artisan } = await supabase.from('artisans').select('id').eq('id', booking.artisan_id).eq('user_id', auth.sub).maybeSingle();
    if (!artisan) return errorResponse('Forbidden', 403);
  } else {
    return errorResponse('Forbidden', 403);
  }

  const stateMap: Record<string,string> = { acknowledged: 'PROVIDER_ACKNOWLEDGED', checked_in: 'CUSTOMER_CHECKED_IN', in_progress: 'IN_PROGRESS', completed: 'COMPLETED', cancelled: 'CANCELLED', no_show: 'NO_SHOW', disputed: 'DISPUTED' };
  const actorRole = auth.role === 'client' ? 'CUSTOMER' : auth.role === 'artisan' ? 'PROVIDER' : 'TENANT_ADMIN';
  const requestKey = String(body.idempotency_key ?? `fulfillment:${bookingId}:${stateMap[status]}:${auth.sub}`);
  const correlationId = String(body.correlation_id ?? crypto.randomUUID());
  const { data: transitioned, error: updateError } = await supabase.rpc('transition_booking_fulfillment', {
    target_booking_id: bookingId, target_state: stateMap[status], target_actor_id: auth.sub,
    target_actor_role: actorRole, target_reason_code: body.reason_code ?? body.reason ?? 'USER_REQUEST',
    target_correlation_id: correlationId, request_key: requestKey,
  });
  const transitionedBooking = Array.isArray(transitioned) ? transitioned[0] : transitioned;
  const { data: updated } = transitionedBooking
    ? await supabase.from('bookings').select('*, services(name, price_cents, currency), artisans(business_name), payments(*), escrow_accounts(*), reviews(id,rating)').eq('id', bookingId).single()
    : { data: null };

  if (updateError || !updated) {
    return errorResponse(updateError?.message ?? 'Could not update status', 500);
  }

  if (status === 'cancelled') {
    await supabase
      .from('booking_slots')
      .update({ status: 'available', held_by_user_id: null, booking_id: null })
      .eq('id', booking.slot_id);
    const { data: successfulPayment } = await supabase.from('payments').select('id,amount_cents').eq('booking_id', bookingId).eq('status', 'successful').order('created_at', { ascending: false }).limit(1).maybeSingle();
    await supabase.from('cancellation_decisions').upsert({ tenant_id: booking.tenant_id, booking_id: booking.id,
      cancelled_by: auth.role === 'client' ? 'CUSTOMER' : 'PROVIDER', actor_id: auth.sub, policy_version: 'cancellation-v1',
      cancellation_fee: 0, refund_amount: successfulPayment?.amount_cents ?? 0,
      recovery_required: auth.role !== 'client', reason_code: body.reason_code ?? 'USER_REQUEST',
      idempotency_key: `cancellation:${booking.id}:${auth.sub}` }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
    if (auth.role !== 'client') {
      await supabase.from('recovery_cases').upsert({ tenant_id: booking.tenant_id, booking_id: booking.id,
        payment_id: successfulPayment?.id ?? null, failure_reason: 'PROVIDER_CANCELLATION', original_slot_id: booking.slot_id,
        state: 'REQUIRED', policy_version: 'recovery-v1', correlation_id: correlationId,
      }, { onConflict: 'booking_id,failure_reason', ignoreDuplicates: true });
      await supabase.from('bookings').update({ recovery_state: 'REQUIRED', settlement_state: 'HELD' }).eq('id', booking.id);
    }
  }

  if (status === 'completed') {
    const entitlement = await supabase.rpc('freeze_provider_entitlement', { target_booking_id: bookingId });
    if (entitlement.error) return errorResponse(entitlement.error.message, 500);
    await supabase.rpc('evaluate_booking_settlement', { target_booking_id: bookingId });
  }

  return json({ booking: updated });
}

async function handleCreateBooking(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { slot_id, service_id, artisan_id, staff_id, notes, payment_mode = 'instant', payment_arrangement = 'DEPOSIT', payment_method = 'bank_transfer' } = body;
  if (!slot_id || !service_id || !artisan_id) {
    return errorResponse('slot_id, service_id, and artisan_id are required', 400);
  }
  if (!['instant', 'escrow'].includes(payment_mode)) {
    return errorResponse('Invalid payment mode', 400);
  }
  if (!['FULL','DEPOSIT','PARTIAL','PAY_AT_SERVICE','CASH'].includes(payment_arrangement)) return errorResponse('Invalid payment arrangement', 400);
  if (!['card','bank_transfer','payment_link','ussd','bank_account','pay_at_venue','cash'].includes(payment_method)) return errorResponse('Invalid payment method', 400);

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
  const { data: tenant } = await supabase.from('tenants').select('platform_fee_percent').eq('id', tenant_id).single();
  const platformFee = Math.max(0, Math.round(Number(service.price_cents) * Number(tenant?.platform_fee_percent ?? 0) / 100));
  const dueNow = payment_arrangement === 'FULL' ? Number(service.price_cents)
    : payment_arrangement === 'DEPOSIT' || payment_arrangement === 'PARTIAL' ? Math.ceil(Number(service.price_cents) * 0.3) : 0;

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
    pricing_version: 'booking-v2', policy_version: 'ng-commerce-v1', expires_at: quoteExpiry,
    payment_arrangement, payment_method, service_base: service.price_cents, add_ons: 0,
    service_price: service.price_cents, customer_total: service.price_cents,
    provider_fee: platformFee, payment_processing_cost: 0, transfer_cost: 0, settlement_cost: 0,
    tax_if_applicable: 0, tip: 0, subsidy: 0, recovery_credit: 0,
    amount_due_now: dueNow, amount_due_at_service: Number(service.price_cents) - dueNow,
    amount_paid: 0, amount_outstanding: service.price_cents,
    provider_gross_entitlement: service.price_cents, provider_net_entitlement: Number(service.price_cents) - platformFee,
    kajola_gross_revenue: platformFee, kajola_net_revenue: platformFee, settlement_amount: Number(service.price_cents) - platformFee,
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
    metadata: { quote_snapshot_id: quote.id, pricing_version: 'booking-v2', payment_arrangement, payment_method },
  }).eq('id', bookingId).select('*').single();
  if (updateError || !booking) return errorResponse(updateError?.message ?? 'Booking hold persisted but response could not be loaded', 500);
  return json({ booking, quote: { id: quote.id, expires_at: quoteExpiry } });
}

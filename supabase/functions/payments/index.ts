import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';
import { emitSystemEvent } from '../automation_helpers.ts';

type ProviderResult = { ok: boolean; raw: Record<string, unknown>; status: string };

serve(async (req: Request) => {
  try {
    const path = new URL(req.url).pathname;
    const segments = path.split('/').filter(Boolean);

    if (req.method === 'GET' && segments[1] === 'history') {
      const auth = await authenticateRequest(req);
      return handleHistory(createSupabaseClient(), auth);
    }

    if (req.method === 'POST' && segments.length === 1) {
      const auth = await authenticateRequest(req);
      return initiatePayment(createSupabaseClient(), auth, await req.json());
    }

    if (req.method === 'POST' && segments[1] === 'verify') {
      const auth = await authenticateRequest(req);
      return verifyPayment(createSupabaseClient(), auth, await req.json());
    }

    if (req.method === 'POST' && segments[1] === 'retry') {
      const auth = await authenticateRequest(req);
      return retryPayment(createSupabaseClient(), auth, await req.json());
    }

    return errorResponse('Method not allowed', 405);
  } catch (err) {
    return handleError(err);
  }
});

async function handleHistory(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  let query = supabase.from('payments').select('*, bookings!inner(client_id,user_id,tenant_id,payment_mode)').order('created_at', { ascending: false });
  if (auth.role === 'client') {
    query = query.or(`client_id.eq.${auth.sub},user_id.eq.${auth.sub}`, { foreignTable: 'bookings' });
  } else if (auth.role === 'tenant_admin') {
    query = query.eq('tenant_id', auth.tenant_id);
  } else {
    throw new ApiError('Forbidden', 403);
  }
  const { data, error } = await query;
  if (error) throw new ApiError(error.message, 500);
  return json({ payments: data ?? [] });
}

async function initiatePayment(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { booking_id, amount_cents, currency = 'NGN', provider = 'paystack', discount_code } = body;
  if (!booking_id || !amount_cents) throw new ApiError('booking_id and amount_cents are required', 400);
  if (!['paystack', 'stripe'].includes(provider)) throw new ApiError('Unsupported payment provider', 400);

  const booking = await getAuthorizedBooking(supabase, auth, booking_id);
  if (!['pending', 'awaiting_payment'].includes(booking.status)) {
    throw new ApiError('Booking is not payable', 409);
  }

  const tenant = await loadTenantForBooking(supabase, booking.tenant_id);
  const discount = discount_code ? await calculateDiscount(supabase, booking.tenant_id, discount_code, amount_cents) : { amount: 0, id: null, used_count: 0 };
  const finalAmount = Math.max(0, amount_cents - discount.amount);
  const platformFee = Math.max(0, Math.round(finalAmount * Number(tenant.platform_fee_percent ?? 10) / 100));
  const netAmount = Math.max(0, finalAmount - platformFee);

  const reference = `${provider}_${crypto.randomUUID()}`;
  const callbackUrl = `${Deno.env.get('WEB_PAYMENT_CALLBACK_URL') ?? ''}?bookingId=${booking_id}&reference=${reference}`;
  const mobileCallbackUrl = `kajola://payment-success?bookingId=${booking_id}&reference=${reference}`;
  const paymentUrl = await createProviderCheckout(provider, reference, finalAmount, currency, callbackUrl, mobileCallbackUrl);

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      tenant_id: booking.tenant_id,
      booking_id,
      amount_cents: finalAmount,
      amount: finalAmount,
      currency,
      provider,
      provider_reference: reference,
      reference,
      discount_cents: discount.amount,
      discount_code: discount_code ?? null,
      platform_fee_cents: platformFee,
      net_amount_cents: netAmount,
      status: 'initialized',
      metadata: { initiated_by: auth.sub, callback_url: callbackUrl, mobile_callback_url: mobileCallbackUrl }
    })
    .select()
    .single();
  if (error || !payment) throw new ApiError(error?.message ?? 'Failed to create payment record', 500);

  if (discount.id) {
    await supabase.from('discount_codes').update({ used_count: discount.used_count + 1 }).eq('id', discount.id);
  }

  const { data: updatedBooking, error: updateError } = await supabase
    .from('bookings')
    .update({ status: booking.status === 'pending' ? 'awaiting_payment' : booking.status, total_amount: finalAmount, payment_reference: reference })
    .eq('id', booking_id)
    .select()
    .single();
  if (updateError) throw new ApiError(updateError.message, 500);

  return json({ payment, booking: updatedBooking, payment_url: paymentUrl });
}

async function loadTenantForBooking(supabase: ReturnType<typeof createSupabaseClient>, tenantId: string) {
  const { data, error } = await supabase.from('tenants').select('platform_fee_percent').eq('id', tenantId).single();
  if (error || !data) throw new ApiError('Tenant settings not found', 404);
  return data;
}

async function calculateDiscount(supabase: ReturnType<typeof createSupabaseClient>, tenantId: string, code: string, amount: number) {
  const { data, error } = await supabase.from('discount_codes').select('*').eq('tenant_id', tenantId).ilike('code', code).single();
  if (error || !data || !data.active || data.starts_at > new Date().toISOString() || data.ends_at < new Date().toISOString() || (data.max_uses > 0 && data.used_count >= data.max_uses)) {
    return { amount: 0, id: null, used_count: 0 };
  }
  const fixed = Number(data.amount_cents ?? 0);
  const percent = Number(data.percent_off ?? 0);
  const calculated = fixed > 0 ? fixed : Math.round(amount * percent / 100);
  return { amount: Math.min(calculated, amount), id: data.id, used_count: Number(data.used_count ?? 0) };
}

async function verifyPayment(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { reference, bookingId } = body;
  if (!reference || !bookingId) throw new ApiError('reference and bookingId are required', 400);

  const booking = await getAuthorizedBooking(supabase, auth, bookingId);
  const { data: payment, error } = await supabase
    .from('payments')
    .select('*')
    .eq('booking_id', bookingId)
    .eq('reference', reference)
    .single();
  if (error || !payment) throw new ApiError('Payment not found', 404);

  if (payment.status === 'successful') {
    const confirmed = await getBooking(supabase, bookingId);
    return json({ success: true, booking: confirmed, cached: true });
  }

  const result = await verifyWithProvider(payment.provider, reference);
  if (!result.ok) {
    await supabase.from('payments').update({ status: 'failed', raw_response: result.raw }).eq('id', payment.id);
    return json({ success: false, booking, payment_status: 'failed', raw_response: result.raw }, 402);
  }

  const { error: payError } = await supabase
    .from('payments')
    .update({ status: 'successful', raw_response: result.raw, paid_at: new Date().toISOString() })
    .eq('id', payment.id);
  if (payError) throw new ApiError(payError.message, 500);

  await emitSystemEvent(supabase, booking.tenant_id, 'payment_successful', {
    payment_id: payment.id,
    booking_id: bookingId,
    client_id: booking.client_id,
    artisan_id: booking.artisan_id,
    reference: payment.reference,
    amount_cents: payment.amount_cents,
    currency: payment.currency
  }, 'payments', auth.sub, 'payment', payment.id);

  if (booking.payment_mode === 'escrow') {
    const { error: escrowError } = await supabase.rpc('create_booking_escrow', { target_booking_id: bookingId, target_payment_id: payment.id });
    if (escrowError) throw new ApiError(escrowError.message, 500);
    const { error: progressError } = await supabase.rpc('mark_booking_in_progress', { target_booking_id: bookingId });
    if (progressError) throw new ApiError(progressError.message, 500);
  } else {
    const { error: rpcError } = await supabase.rpc('mark_booking_confirmed', { target_booking_id: bookingId });
    if (rpcError) throw new ApiError(rpcError.message, 500);
  }
  return json({ success: true, booking: await getBooking(supabase, bookingId) });
}

async function retryPayment(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { bookingId, provider = 'paystack' } = body;
  if (!bookingId) throw new ApiError('bookingId is required', 400);
  const booking = await getAuthorizedBooking(supabase, auth, bookingId);
  if (!['awaiting_payment', 'pending'].includes(booking.status)) throw new ApiError('Booking cannot be retried', 409);
  await supabase.from('payments').update({ status: 'failed' }).eq('booking_id', bookingId).neq('status', 'successful');
  return initiatePayment(supabase, auth, {
    booking_id: bookingId,
    amount_cents: booking.total_amount || booking.services?.price_cents || 0,
    currency: booking.services?.currency ?? 'NGN',
    provider
  });
}

async function getAuthorizedBooking(supabase: ReturnType<typeof createSupabaseClient>, auth: any, bookingId: string) {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select('*, services(name, price_cents, currency), artisans(business_name)')
    .eq('id', bookingId)
    .single();
  if (error || !booking) throw new ApiError('Booking not found', 404);
  if (auth.role === 'client' && booking.client_id !== auth.sub && booking.user_id !== auth.sub) throw new ApiError('Forbidden', 403);
  if (auth.role === 'tenant_admin' && booking.tenant_id !== auth.tenant_id) throw new ApiError('Forbidden', 403);
  if (!['client', 'tenant_admin'].includes(auth.role)) throw new ApiError('Forbidden', 403);
  return booking;
}

async function getBooking(supabase: ReturnType<typeof createSupabaseClient>, bookingId: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, services(name, price_cents, currency), artisans(business_name), payments(*), escrow_accounts(*)')
    .eq('id', bookingId)
    .single();
  if (error || !data) throw new ApiError('Booking not found', 404);
  return data;
}

async function createProviderCheckout(provider: string, reference: string, amount: number, currency: string, callbackUrl: string, mobileCallbackUrl: string) {
  if (provider === 'paystack' && Deno.env.get('PAYSTACK_SECRET_KEY')) {
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency, reference, callback_url: callbackUrl, metadata: { mobile_callback_url: mobileCallbackUrl } })
    });
    const payload = await res.json();
    if (!res.ok || !payload.status) throw new ApiError(payload.message ?? 'Payment initialization failed', 502);
    return payload.data.authorization_url;
  }
  return `https://paystack.com/pay/${reference}`;
}

async function verifyWithProvider(provider: string, reference: string): Promise<ProviderResult> {
  if (provider === 'paystack') {
    const key = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!key) return { ok: reference.length > 0, status: 'success', raw: { provider, reference, mode: 'local_verified' } };
    const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, { headers: { Authorization: `Bearer ${key}` } });
    const raw = await res.json();
    return { ok: Boolean(res.ok && raw.status && raw.data?.status === 'success'), status: raw.data?.status ?? 'failed', raw };
  }
  if (provider === 'stripe') {
    const key = Deno.env.get('STRIPE_SECRET_KEY');
    if (!key) throw new ApiError('Stripe verification is not configured', 500);
    const res = await fetch(`https://api.stripe.com/v1/payment_intents/${reference}`, { headers: { Authorization: `Bearer ${key}` } });
    const raw = await res.json();
    return { ok: Boolean(res.ok && raw.status === 'succeeded'), status: raw.status ?? 'failed', raw };
  }
  throw new ApiError('Unsupported payment provider', 400);
}

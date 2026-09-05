import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

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
  const booking_id = body.booking_id ?? body.bookingId;
  const paymentMethod = body.payment_method ?? body.method ?? 'bank_transfer';
  const provider = body.provider ?? 'paystack';
  if (!booking_id) throw new ApiError('booking_id is required', 400);
  if (!['card','bank_transfer','payment_link','ussd','bank_account','pay_at_venue','cash'].includes(paymentMethod)) throw new ApiError('Unsupported payment method', 400);
  if (!['paystack'].includes(provider)) throw new ApiError('Unsupported payment provider', 400);

  const booking = await getAuthorizedBooking(supabase, auth, booking_id);
  if (!['held', 'pending', 'awaiting_payment'].includes(booking.status)) {
    throw new ApiError('Booking is not payable', 409);
  }

  const { data: quote, error: quoteError } = await supabase.from('quote_snapshots').select('*').eq('id', booking.quote_snapshot_id).single();
  if (quoteError || !quote) throw new ApiError('Immutable commerce snapshot not found', 409);
  const requestedPurpose = String(body.purpose ?? quote.payment_arrangement ?? 'FULL').toUpperCase();
  if (quote.expires_at <= new Date().toISOString() && requestedPurpose !== 'BALANCE') throw new ApiError('Commerce snapshot expired', 409);
  const { data: priorPayments } = await supabase.from('payments').select('amount_cents').eq('booking_id', booking_id).eq('status', 'successful').neq('purpose', 'TIP');
  const previouslyPaid = (priorPayments ?? []).reduce((sum: number, item: any) => sum + Number(item.amount_cents), 0);
  const outstanding = Math.max(0, Number(quote.customer_total) - previouslyPaid);
  const offline = paymentMethod === 'pay_at_venue' || paymentMethod === 'cash';
  const finalAmount = offline || requestedPurpose === 'BALANCE' ? outstanding : Math.min(outstanding, Number(quote.amount_due_now));
  if (finalAmount <= 0) throw new ApiError('No payment is due', 409);
  if (body.amount_cents != null && Number(body.amount_cents) !== finalAmount) throw new ApiError('Amount does not match immutable commerce snapshot', 409);
  const currency = String(quote.currency).toUpperCase();
  if (body.currency && String(body.currency).toUpperCase() !== currency) throw new ApiError('Currency does not match immutable commerce snapshot', 409);
  const paymentPurpose = offline ? 'OFFLINE' : ['FULL','DEPOSIT','BALANCE'].includes(requestedPurpose) ? requestedPurpose : 'FULL';

  const reference = `${provider}_${crypto.randomUUID()}`;
  const callbackUrl = `${Deno.env.get('WEB_PAYMENT_CALLBACK_URL') ?? ''}?bookingId=${booking_id}&reference=${reference}`;
  const mobileCallbackUrl = `kajola://payment-success?bookingId=${booking_id}&reference=${reference}`;

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
      discount_cents: quote.discount,
      discount_code: null,
      platform_fee_cents: quote.kajola_gross_revenue,
      net_amount_cents: quote.provider_net_entitlement,
      payment_arrangement: quote.payment_arrangement,
      payment_method: paymentMethod,
      expected_amount: finalAmount,
      outstanding_amount: quote.amount_outstanding,
      verification_state: offline ? 'PENDING' : 'PENDING',
      quote_snapshot_id: quote.id,
      purpose: paymentPurpose,
      status: 'initialized',
      metadata: { initiated_by: auth.sub, callback_url: callbackUrl, mobile_callback_url: mobileCallbackUrl }
    })
    .select()
    .single();
  if (error || !payment) throw new ApiError(error?.message ?? 'Failed to create payment record', 500);
  let paymentUrl = `/dashboard/bookings/${booking_id}?payment=offline`;
  if (!offline) {
    try {
      paymentUrl = await createProviderCheckout(provider, reference, finalAmount, currency, callbackUrl, mobileCallbackUrl);
    } catch (error) {
      await supabase.from('payments').update({ status: 'failed', verification_state: 'FAILED' }).eq('id', payment.id);
      throw error;
    }
  }

  const { data: updatedBooking, error: updateError } = await supabase
    .from('bookings')
    .update({ status: offline ? 'confirmed' : ['held', 'pending'].includes(booking.status) ? 'awaiting_payment' : booking.status,
      booking_state: offline ? 'CONFIRMED' : ['held', 'pending'].includes(booking.status) ? 'PENDING_PAYMENT' : booking.booking_state,
      payment_state: offline ? 'NOT_REQUIRED' : 'INTENT_CREATED', fulfillment_state: offline ? 'SCHEDULED' : booking.fulfillment_state,
      hold_state: offline ? 'CONVERTED' : booking.hold_state, reconciliation_state: offline ? 'PENDING' : booking.reconciliation_state,
      total_amount: quote.customer_total, payment_reference: reference })
    .eq('id', booking_id)
    .select()
    .single();
  if (updateError) throw new ApiError(updateError.message, 500);

  return json({ payment, booking: updatedBooking, payment_url: paymentUrl, authorization_url: paymentUrl, reference });
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
  const providerData = (result.raw as any)?.data ?? result.raw;
  const bindingValid = String(providerData?.reference ?? reference) === reference
    && Number(providerData?.amount ?? payment.amount_cents) === Number(payment.amount_cents)
    && String(providerData?.currency ?? payment.currency).toUpperCase() === String(payment.currency).toUpperCase();
  if (!result.ok || !bindingValid) {
    await supabase.from('payments').update({ status: 'failed', raw_response: result.raw }).eq('id', payment.id);
    return json({ success: false, booking, payment_status: 'failed', error: 'Provider verification did not match the payment binding' }, 402);
  }
  const providerEventId = `manual-verify:${payment.id}`;
  const { error: receiptError } = await supabase.from('provider_events').upsert({
    provider: payment.provider,
    provider_event_id: providerEventId,
    event_type: 'server.verify.success',
    provider_reference: reference,
    signature_valid: true,
    payload: result.raw,
    status: 'VERIFIED',
  }, { onConflict: 'provider,provider_event_id', ignoreDuplicates: true });
  if (receiptError) throw new ApiError(receiptError.message, 500);
  const { data: outcome, error: processError } = await supabase.rpc('process_verified_payment', {
    target_payment_id: payment.id,
    target_provider_event_id: providerEventId,
    target_correlation_id: crypto.randomUUID(),
    verification_payload: result.raw,
  });
  if (processError) throw new ApiError(processError.message, 500);
  return json({ success: true, booking: await getBooking(supabase, bookingId), outcome });
}

async function retryPayment(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { bookingId, provider = 'paystack' } = body;
  if (!bookingId) throw new ApiError('bookingId is required', 400);
  const booking = await getAuthorizedBooking(supabase, auth, bookingId);
  if (!['held', 'awaiting_payment', 'pending'].includes(booking.status)) throw new ApiError('Booking cannot be retried', 409);
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
  if (provider === 'paystack') {
    const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!secret) throw new ApiError('DEPENDENCY_UNAVAILABLE: PAYSTACK_SECRET_KEY_MISSING', 503);
    const res = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency, reference, callback_url: callbackUrl, metadata: { mobile_callback_url: mobileCallbackUrl } })
    });
    const payload = await res.json();
    if (!res.ok || !payload.status) throw new ApiError(payload.message ?? 'Payment initialization failed', 502);
    return payload.data.authorization_url;
  }
  throw new ApiError('Unsupported payment provider', 400);
}

async function verifyWithProvider(provider: string, reference: string): Promise<ProviderResult> {
  if (provider === 'paystack') {
    const key = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!key) throw new ApiError('DEPENDENCY_UNAVAILABLE: PAYSTACK_SECRET_KEY_MISSING', 503);
    const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, { headers: { Authorization: `Bearer ${key}` } });
    const raw = await res.json();
    return { ok: Boolean(res.ok && raw.status && raw.data?.status === 'success' && raw.data?.reference === reference), status: raw.data?.status ?? 'failed', raw };
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

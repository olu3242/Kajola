import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

serve(async (req: Request) => {
  try {
    if (req.method !== 'POST') return errorResponse('Method not allowed', 405);
    const auth = await authenticateRequest(req);
    if (auth.role !== 'client') throw new ApiError('Forbidden', 403);
    const body = await req.json();
    const bookingId = String(body.booking_id ?? '');
    const amount = Number(body.amount_kobo);
    if (!bookingId || !Number.isInteger(amount) || amount <= 0) throw new ApiError('booking_id and positive amount_kobo are required', 400);
    const db = createSupabaseClient();
    const { data: booking, error: bookingError } = await db.from('bookings').select('*').eq('id', bookingId).single();
    if (bookingError || !booking) throw new ApiError('Booking not found', 404);
    if (booking.client_id !== auth.sub && booking.user_id !== auth.sub) throw new ApiError('Forbidden', 403);
    if (booking.fulfillment_state !== 'COMPLETED') throw new ApiError('Tips require completed service', 409);

    const requestKey = String(body.idempotency_key ?? `tip:${bookingId}:${auth.sub}`);
    const { data: existing } = await db.from('gratuities').select('*,payments(*)').eq('idempotency_key', requestKey).maybeSingle();
    if (existing) return json({ gratuity: existing, cached: true });
    const { data: gratuity, error: gratuityError } = await db.from('gratuities').insert({
      tenant_id: booking.tenant_id, booking_id: booking.id, customer_id: auth.sub, artisan_id: booking.artisan_id,
      beneficiary_id: booking.artisan_id, amount_kobo: amount, message: String(body.message ?? ''),
      payment_status: 'PENDING', provider_entitlement: amount, settlement_state: 'NOT_ELIGIBLE',
      refund_treatment: 'REFUND_WITH_PAYMENT', idempotency_key: requestKey,
    }).select('*').single();
    if (gratuityError || !gratuity) throw new ApiError(gratuityError?.message ?? 'Could not create tip intent', 500);

    const reference = `tip_${crypto.randomUUID()}`;
    const { data: payment, error: paymentError } = await db.from('payments').insert({
      tenant_id: booking.tenant_id, booking_id: booking.id, gratuity_id: gratuity.id,
      amount_cents: amount, amount, expected_amount: amount, outstanding_amount: amount,
      currency: 'NGN', provider: 'paystack', provider_reference: reference, reference,
      payment_arrangement: 'FULL', payment_method: body.method ?? 'card', purpose: 'TIP', status: 'initialized',
      verification_state: 'PENDING', metadata: { initiated_by: auth.sub, tip_id: gratuity.id },
    }).select('*').single();
    if (paymentError || !payment) throw new ApiError(paymentError?.message ?? 'Could not create tip payment', 500);

    const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!secret) return json({ gratuity, payment, runtime_state: 'BLOCKED_EXTERNAL', error: 'PAYSTACK_SECRET_KEY_MISSING' }, 503);
    const callback = `${Deno.env.get('WEB_PAYMENT_CALLBACK_URL') ?? ''}?bookingId=${booking.id}&reference=${reference}`;
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, currency: 'NGN', reference, callback_url: callback, metadata: { booking_id: booking.id, gratuity_id: gratuity.id } }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.status) {
      await db.from('payments').update({ status: 'failed', verification_state: 'FAILED', raw_response: payload }).eq('id', payment.id);
      throw new ApiError(payload.message ?? 'Tip payment initialization failed', 502);
    }
    return json({ gratuity, payment, reference, authorization_url: payload.data.authorization_url }, 201);
  } catch (error) {
    return handleError(error);
  }
});

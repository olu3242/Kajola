import { serve, json, errorResponse, createSupabaseClient, handleError, ApiError } from '../_shared.ts';
import { emitSystemEvent } from '../automation_helpers.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-paystack-signature') ?? req.headers.get('stripe-signature') ?? '';
    await verifyWebhookSignature(rawBody, signature);
    return await handleWebhook(JSON.parse(rawBody));
  } catch (err) {
    return handleError(err);
  }
});

async function handleWebhook(body: any) {
  const supabase = createSupabaseClient();
  const event = body.event ?? body.type ?? body.status;
  const reference = body.data?.reference ?? body.data?.id ?? body.reference ?? body.provider_reference;
  if (!reference) throw new ApiError('Payment reference missing', 400);

  const { data: payment, error } = await supabase.from('payments').select('*').eq('reference', reference).single();
  if (error || !payment) throw new ApiError('Payment record not found', 404);
  if (payment.status === 'successful') return json({ success: true, cached: true });

  const successful = ['charge.success', 'payment_intent.succeeded', 'success', 'paid', 'completed'].includes(String(event).toLowerCase())
    || ['success', 'succeeded'].includes(String(body.data?.status).toLowerCase());
  const nextStatus = successful ? 'successful' : 'failed';

  const { error: updateError } = await supabase
    .from('payments')
    .update({ status: nextStatus, raw_response: body, paid_at: successful ? new Date().toISOString() : payment.paid_at })
    .eq('id', payment.id);
  if (updateError) throw new ApiError(updateError.message, 500);

  if (successful) {
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('client_id, artisan_id, tenant_id, payment_mode')
      .eq('id', payment.booking_id)
      .single();
    if (bookingError || !booking) throw new ApiError('Booking not found', 404);

    await emitSystemEvent(supabase, booking.tenant_id, 'payment_successful', {
      payment_id: payment.id,
      booking_id: payment.booking_id,
      client_id: booking.client_id,
      artisan_id: booking.artisan_id,
      reference: payment.reference,
      amount_cents: payment.amount_cents,
      currency: payment.currency
    }, 'payments_webhook', 'system', 'payment', payment.id);

    if (booking.payment_mode === 'escrow') {
      const { error: escrowError } = await supabase.rpc('create_booking_escrow', { target_booking_id: payment.booking_id, target_payment_id: payment.id });
      if (escrowError) throw new ApiError(escrowError.message, 500);
      const { error: progressError } = await supabase.rpc('mark_booking_in_progress', { target_booking_id: payment.booking_id });
      if (progressError) throw new ApiError(progressError.message, 500);
    } else {
      const { error: rpcError } = await supabase.rpc('mark_booking_confirmed', { target_booking_id: payment.booking_id });
      if (rpcError) throw new ApiError(rpcError.message, 500);
    }
  } else {
    await supabase.rpc('fail_payment', { target_booking_id: payment.booking_id });
  }

  return json({ success: true });
}

async function verifyWebhookSignature(rawBody: string, signature: string) {
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY') ?? Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return;
  if (!signature) throw new ApiError('Webhook signature missing', 401);

  if (Deno.env.get('PAYSTACK_SECRET_KEY')) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
    const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== signature) throw new ApiError('Invalid webhook signature', 401);
  }
}

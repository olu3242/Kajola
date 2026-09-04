import { serve, json, errorResponse, createSupabaseClient, handleError, ApiError } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-paystack-signature') ?? '';
    await verifyWebhookSignature(rawBody, signature);
    return await handleWebhook(JSON.parse(rawBody), rawBody);
  } catch (err) {
    return handleError(err);
  }
});

async function handleWebhook(body: any, rawBody: string) {
  const supabase = createSupabaseClient();
  const event = body.event ?? body.type ?? body.status;
  const reference = body.data?.reference ?? body.data?.id ?? body.reference ?? body.provider_reference;
  if (!reference) throw new ApiError('Payment reference missing', 400);

  const providerEventId = String(body.data?.id ?? await sha256(`${event}:${reference}:${rawBody}`));
  const { data: accepted, error: eventError } = await supabase.from('provider_events').upsert({
    provider: 'paystack', provider_event_id: providerEventId, event_type: String(event),
    provider_reference: String(reference), signature_valid: true, payload: body, status: 'VERIFIED'
  }, { onConflict: 'provider,provider_event_id', ignoreDuplicates: true }).select('id').maybeSingle();
  if (eventError) throw new ApiError(eventError.message, 500);
  if (!accepted) return json({ success: true, cached: true, event_id: providerEventId });

  const { data: payment, error } = await supabase.from('payments').select('*').eq('reference', reference).single();
  if (error || !payment) throw new ApiError('Payment record not found', 404);
  if (payment.status === 'successful') {
    await markProviderEvent(supabase, providerEventId, 'PROCESSED');
    return json({ success: true, cached: true, event_id: providerEventId });
  }

  const reportedSuccessful = ['charge.success', 'success', 'paid', 'completed'].includes(String(event).toLowerCase())
    || ['success', 'succeeded'].includes(String(body.data?.status).toLowerCase());
  const verification = reportedSuccessful ? await verifyPaystackTransaction(String(reference)) : { ok: false, raw: body };
  const successful = reportedSuccessful && verification.ok;
  const nextStatus = successful ? 'successful' : 'failed';

  const { data: updatedPayments, error: updateError } = await supabase
    .from('payments')
    .update({ status: nextStatus, raw_response: { webhook: body, verification: verification.raw }, paid_at: successful ? new Date().toISOString() : payment.paid_at })
    .eq('id', payment.id).neq('status', 'successful').select('id');
  if (updateError) throw new ApiError(updateError.message, 500);
  if (!updatedPayments?.length) {
    await markProviderEvent(supabase, providerEventId, 'PROCESSED');
    return json({ success: true, cached: true, event_id: providerEventId });
  }

  if (successful) {
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('client_id, artisan_id, tenant_id, payment_mode')
      .eq('id', payment.booking_id)
      .single();
    if (bookingError || !booking) throw new ApiError('Booking not found', 404);

    await recordLedger(supabase, payment, booking);

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

  await markProviderEvent(supabase, providerEventId, successful ? 'PROCESSED' : 'REJECTED', successful ? null : 'Provider verification did not confirm success');

  return json({ success: true, verified: successful, event_id: providerEventId });
}

async function verifyWebhookSignature(rawBody: string, signature: string) {
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!secret) throw new ApiError('DEPENDENCY_UNAVAILABLE: PAYSTACK_SECRET_KEY_MISSING', 503);
  if (!signature) throw new ApiError('Webhook signature missing', 401);
  if (!/^[0-9a-f]{128}$/i.test(signature)) throw new ApiError('Invalid webhook signature', 401);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, ['verify']);
  const bytes = new Uint8Array(signature.match(/.{2}/g)!.map((value) => Number.parseInt(value, 16)));
  const valid = await crypto.subtle.verify('HMAC', key, bytes, new TextEncoder().encode(rawBody));
  if (!valid) throw new ApiError('Invalid webhook signature', 401);
}

async function verifyPaystackTransaction(reference: string) {
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
  if (!secret) throw new ApiError('DEPENDENCY_UNAVAILABLE: PAYSTACK_SECRET_KEY_MISSING', 503);
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secret}` }
  });
  const raw = await response.json();
  return { ok: Boolean(response.ok && raw.status && raw.data?.status === 'success' && raw.data?.reference === reference), raw };
}

async function recordLedger(supabase: ReturnType<typeof createSupabaseClient>, payment: any, booking: any) {
  const amount = Number(payment.amount_cents ?? payment.amount ?? 0);
  const kajolaFee = Number(payment.platform_fee_cents ?? 0);
  const providerReceivable = Number(payment.net_amount_cents ?? Math.max(0, amount - kajolaFee));
  const rows = [
    { entry_type: 'DEPOSIT', direction: 'CREDIT', amount, idempotency_key: `payment:${payment.id}:deposit` },
    ...(kajolaFee > 0 ? [{ entry_type: 'KAJOLA_FEE', direction: 'CREDIT', amount: kajolaFee, idempotency_key: `payment:${payment.id}:kajola-fee` }] : []),
    ...(providerReceivable > 0 ? [{ entry_type: 'PROVIDER_RECEIVABLE', direction: 'CREDIT', amount: providerReceivable, idempotency_key: `payment:${payment.id}:provider-receivable` }] : []),
  ].map((row) => ({ ...row, tenant_id: booking.tenant_id, booking_id: payment.booking_id, payment_id: payment.id, currency: payment.currency ?? 'NGN' }));
  const { error } = await supabase.from('financial_ledger_entries').upsert(rows, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  if (error) throw new ApiError(error.message, 500);
}

async function markProviderEvent(supabase: ReturnType<typeof createSupabaseClient>, providerEventId: string, status: string, errorMessage: string | null = null) {
  await supabase.from('provider_events').update({ status, error_message: errorMessage, processed_at: new Date().toISOString() })
    .eq('provider', 'paystack').eq('provider_event_id', providerEventId);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

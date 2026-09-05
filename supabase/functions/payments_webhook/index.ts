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
  const { error: eventError } = await supabase.from('provider_events').upsert({
    provider: 'paystack', provider_event_id: providerEventId, event_type: String(event),
    provider_reference: String(reference), signature_valid: true, payload: body, status: 'VERIFIED'
  }, { onConflict: 'provider,provider_event_id', ignoreDuplicates: true });
  if (eventError) throw new ApiError(eventError.message, 500);

  // A receipt is not the business effect. Replays must retry VERIFIED/FAILED
  // receipts so a crash between receipt and processing cannot strand money.
  const { data: receipt, error: receiptError } = await supabase.from('provider_events')
    .select('status').eq('provider', 'paystack').eq('provider_event_id', providerEventId).single();
  if (receiptError || !receipt) throw new ApiError(receiptError?.message ?? 'Provider event receipt missing', 500);
  if (receipt.status === 'PROCESSED') return json({ success: true, cached: true, event_id: providerEventId });

  const { data: payment, error } = await supabase.from('payments').select('*').eq('reference', reference).single();
  if (error || !payment) throw new ApiError('Payment record not found', 404);
  const reportedSuccessful = ['charge.success', 'success', 'paid', 'completed'].includes(String(event).toLowerCase())
    || ['success', 'succeeded'].includes(String(body.data?.status).toLowerCase());
  const verification = reportedSuccessful ? await verifyPaystackTransaction(String(reference)) : { ok: false, raw: body };
  const verifiedAmount = Number((verification.raw as any)?.data?.amount ?? -1);
  const verifiedCurrency = String((verification.raw as any)?.data?.currency ?? '').toUpperCase();
  const expectedAmount = Number(payment.amount_cents ?? payment.amount ?? 0);
  const expectedCurrency = String(payment.currency ?? 'NGN').toUpperCase();
  const bindingValid = (verification.raw as any)?.data?.reference === reference
    && verifiedAmount === expectedAmount && verifiedCurrency === expectedCurrency;
  const successful = reportedSuccessful && verification.ok && bindingValid;

  if (successful) {
    const result = payment.purpose === 'TIP'
      ? await supabase.rpc('process_verified_tip', {
          target_payment_id: payment.id, target_provider_event_id: providerEventId,
          target_correlation_id: crypto.randomUUID(),
        })
      : await supabase.rpc('process_verified_payment', {
          target_payment_id: payment.id, target_provider_event_id: providerEventId,
          target_correlation_id: crypto.randomUUID(), verification_payload: verification.raw,
        });
    const { data: outcome, error: processError } = result;
    if (processError) throw new ApiError(processError.message, 500);
    return json({ success: true, verified: true, event_id: providerEventId, outcome });
  } else {
    await supabase.from('payments').update({ status: 'failed', raw_response: { webhook: body, verification: verification.raw } })
      .eq('id', payment.id).neq('status', 'successful');
    if (payment.purpose !== 'TIP') await supabase.rpc('fail_payment', { target_booking_id: payment.booking_id });
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

async function markProviderEvent(supabase: ReturnType<typeof createSupabaseClient>, providerEventId: string, status: string, errorMessage: string | null = null) {
  await supabase.from('provider_events').update({ status, error_message: errorMessage, processed_at: new Date().toISOString() })
    .eq('provider', 'paystack').eq('provider_event_id', providerEventId);
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

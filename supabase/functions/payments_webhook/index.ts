import { serve, json, errorResponse, createSupabaseClient } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const body = await req.json();
    return await handleWebhook(body);
  } catch (err) {
    console.error(err);
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});

async function handleWebhook(body: any) {
  const { provider, provider_reference, status, booking_id, payment_id } = body;
  if (!provider || !provider_reference || !status) {
    return errorResponse('provider, provider_reference, and status are required', 400);
  }

  const supabase = createSupabaseClient();

  const { data: payment, error: paymentError } = await supabase
    .from('payments')
    .select('*')
    .eq('provider_reference', provider_reference)
    .single();

  if (paymentError || !payment) {
    return errorResponse('Payment record not found', 404);
  }

  const newStatus = mapProviderStatus(status);
  const { error: updateError } = await supabase
    .from('payments')
    .update({ status: newStatus, paid_at: newStatus === 'paid' ? new Date().toISOString() : payment.paid_at })
    .eq('id', payment.id);

  if (updateError) {
    return errorResponse('Failed to update payment record', 500);
  }

  if (newStatus === 'paid' && payment.booking_id) {
    await supabase.from('bookings').update({ status: 'confirmed', confirmed_at: new Date().toISOString() }).eq('id', payment.booking_id);
  }

  return json({ success: true });
}

function mapProviderStatus(status: string) {
  switch (status.toLowerCase()) {
    case 'success':
    case 'paid':
    case 'completed':
      return 'paid';
    case 'failed':
      return 'failed';
    case 'pending':
    case 'processing':
      return 'pending';
    default:
      return 'pending';
  }
}

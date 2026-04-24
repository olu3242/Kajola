import { serve, json, errorResponse, createSupabaseClient, authenticateRequest } from '../_shared.ts';

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405);
  }

  try {
    const auth = await authenticateRequest(req);
    if (auth.role !== 'client') {
      return errorResponse('Forbidden', 403);
    }

    const body = await req.json();
    const supabase = createSupabaseClient();
    return await initiatePayment(supabase, auth, body);
  } catch (err) {
    console.error(err);
    return errorResponse(err instanceof Error ? err.message : 'Internal server error', 500);
  }
});

async function initiatePayment(supabase: ReturnType<typeof createSupabaseClient>, auth: any, body: any) {
  const { booking_id, amount_cents, currency = 'NGN', provider = 'paystack' } = body;
  if (!booking_id || !amount_cents) {
    return errorResponse('booking_id and amount_cents are required', 400);
  }

  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', booking_id)
    .single();

  if (bookingError || !booking) {
    return errorResponse('Booking not found', 404);
  }

  if (booking.client_id !== auth.sub) {
    return errorResponse('Unauthorized for booking', 403);
  }

  if (booking.tenant_id !== auth.tenant_id) {
    return errorResponse('Booking not available for your tenant', 403);
  }

  const reference = crypto.randomUUID();
  const paymentUrl = `https://paystack.com/pay/${reference}`;

  const { data: payment, error } = await supabase
    .from('payments')
    .insert({
      tenant_id: booking.tenant_id,
      booking_id,
      amount_cents,
      currency,
      provider,
      provider_reference: reference,
      status: 'pending',
      metadata: { initiated_by: auth.sub }
    })
    .select()
    .single();

  if (error || !payment) {
    return errorResponse(error?.message ?? 'Failed to create payment record', 500);
  }

  return json({ payment, payment_url: paymentUrl });
}

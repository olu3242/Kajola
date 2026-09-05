import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// RETIRED in R3. payments_webhook + process_verified_payment are the only
// authoritative Paystack callback and booking-payment transition path.
serve(() => new Response(JSON.stringify({
  code: 'RETIRED_ENDPOINT',
  error: 'Use the canonical payments_webhook endpoint.',
}), { status: 410, headers: { 'Content-Type': 'application/json' } }));

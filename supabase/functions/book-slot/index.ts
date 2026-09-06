import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// RETIRED in R3. bookings + create_slot_hold are the only authoritative
// quote/hold path; keeping this named endpoint prevents silent dual writes.
serve(() => new Response(JSON.stringify({
  code: 'RETIRED_ENDPOINT',
  error: 'Use the canonical bookings endpoint.',
}), { status: 410, headers: { 'Content-Type': 'application/json' } }));

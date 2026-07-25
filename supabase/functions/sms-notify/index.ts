import { serve, json, errorResponse, createSupabaseClient, getEnv, authenticateRequest, ApiError } from '../_shared.ts';

const TERMII_API_URL = 'https://api.ng.termii.com/api/sms/send';

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }

  if (req.method !== 'POST') return errorResponse('Method not allowed', 405);

  try {
    // Service-to-service calls supply the service role key; client calls use a user JWT
    const authHeader = req.headers.get('authorization') ?? '';
    const isServiceCall = authHeader === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
    if (!isServiceCall) {
      await authenticateRequest(req);
    }

    const { to, message, channel = 'generic' } = await req.json();
    if (!to || !message) return errorResponse('to and message are required', 400);

    const result = await sendSms(to, message, channel);
    return json({ success: true, message_id: result.message_id });
  } catch (err) {
    console.error('sms-notify error:', err);
    if (err instanceof ApiError) return errorResponse(err.message, err.status);
    return errorResponse('Internal error', 500);
  }
});

async function sendSms(
  to: string,
  message: string,
  channel: 'generic' | 'dnd' | 'whatsapp',
): Promise<{ message_id: string }> {
  const apiKey = getEnv('TERMII_API_KEY');
  const senderId = Deno.env.get('TERMII_SENDER_ID') ?? 'Kajola';

  const payload = {
    to,
    from: senderId,
    sms: message,
    type: 'plain',
    api_key: apiKey,
    channel,
  };

  const resp = await fetch(TERMII_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error('Termii error:', resp.status, body);
    throw new ApiError(`SMS delivery failed: ${resp.status}`, 502);
  }

  const data = await resp.json();
  return { message_id: data.message_id ?? data.pinId ?? 'unknown' };
}

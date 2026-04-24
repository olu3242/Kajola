import { serve, json, errorResponse, createSupabaseClient, authenticateRequest, handleError, ApiError } from '../_shared.ts';

type AutomationRulePayload = {
  name?: string;
  trigger_event?: string;
  conditions?: Record<string, unknown>;
  action_type?: string;
  config?: Record<string, unknown>;
  actions?: Array<{ action_type: string; config: Record<string, unknown> }>;
  is_active?: boolean;
};

serve(async (req: Request) => {
  try {
    const auth = await authenticateRequest(req);
    if (!['tenant_admin', 'super_admin'].includes(auth.role as string)) {
      return errorResponse('Forbidden', 403);
    }

    const supabase = createSupabaseClient();
    const url = new URL(req.url);
    const segments = url.pathname.split('/').filter(Boolean);
    const action = segments[segments.length - 1];

    if (req.method === 'GET' && action === 'events') {
      return await listEvents(supabase, url.searchParams, auth);
    }

    if (req.method === 'POST' && segments.includes('events') && action === 'retry') {
      return await retryEvent(supabase, await req.json(), auth);
    }

    if (req.method === 'GET' && (action === 'rules' || action === 'automation-rules')) {
      return await listRules(supabase, url.searchParams, auth);
    }

    if (req.method === 'PATCH' && (segments.includes('rules') || segments.includes('automation-rules'))) {
      const body = await req.json();
      const ruleId = body.id ?? body.rule_id ?? (action !== 'rules' && action !== 'automation-rules' ? action : null);
      if (!ruleId) throw new ApiError('rule id is required', 400);
      return await updateRule(supabase, ruleId, body, auth);
    }

    if (req.method === 'POST' && segments.includes('rules') && action === 'default') {
      return await createDefaultRules(supabase, auth);
    }

    return errorResponse('Not found', 404);
  } catch (err) {
    return handleError(err);
  }
});

async function listEvents(supabase: ReturnType<typeof createSupabaseClient>, params: URLSearchParams, auth: any) {
  const status = params.get('status');
  let query = supabase.from('system_events').select('*').order('created_at', { ascending: false });
  if (auth.role === 'tenant_admin') query = query.eq('tenant_id', auth.tenant_id);
  if (status) query = query.eq('status', status);
  const { data, error } = await query.limit(100);
  if (error) throw new ApiError(error.message, 500);
  return json({ events: data ?? [] });
}

async function retryEvent(supabase: ReturnType<typeof createSupabaseClient>, body: any, auth: any) {
  const eventId = body.event_id as string;
  if (!eventId) throw new ApiError('event_id is required', 400);

  let query = supabase.from('system_events').update({ status: 'pending', retry_count: 0, processed_at: null, error_message: null }).eq('id', eventId);
  if (auth.role === 'tenant_admin') query = query.eq('tenant_id', auth.tenant_id);
  const { error: updateError } = await query;
  if (updateError) throw new ApiError(updateError.message, 500);

  let retryQuery = supabase.from('automation_runs').update({ status: 'pending', attempts: 0, last_error: null }).eq('event_id', eventId).eq('status', 'failed');
  if (auth.role === 'tenant_admin') retryQuery = retryQuery.eq('tenant_id', auth.tenant_id);
  const { error: runError } = await retryQuery;
  if (runError) throw new ApiError(runError.message, 500);

  return json({ success: true, event_id: eventId });
}

async function listRules(supabase: ReturnType<typeof createSupabaseClient>, params: URLSearchParams, auth: any) {
  const triggerEvent = params.get('trigger_event');
  let query = supabase.from('automation_rules').select('*').order('created_at', { ascending: false });
  if (auth.role === 'tenant_admin') query = query.eq('tenant_id', auth.tenant_id);
  if (triggerEvent) query = query.eq('trigger_event', triggerEvent);
  const { data, error } = await query.limit(100);
  if (error) throw new ApiError(error.message, 500);
  return json({ rules: data ?? [] });
}

async function updateRule(supabase: ReturnType<typeof createSupabaseClient>, ruleId: string, body: AutomationRulePayload, auth: any) {
  let query = supabase.from('automation_rules').update(body).eq('id', ruleId);
  if (auth.role === 'tenant_admin') query = query.eq('tenant_id', auth.tenant_id);
  const { data, error } = await query.select('*').single();
  if (error) throw new ApiError(error.message, 500);
  return json({ rule: data });
}

async function createDefaultRules(supabase: ReturnType<typeof createSupabaseClient>, auth: any) {
  const tenant_id = auth.tenant_id as string;
  const rules = [
    {
      name: 'Notify artisan on booking creation',
      trigger_event: 'booking_created',
      conditions: {},
      action_type: 'send_notification',
      config: {
        channel: 'in_app',
        user_id: 'payload.artisan_id',
        title: 'New booking request',
        body: 'You have a new booking request. Confirm it quickly to keep your response time strong.'
      }
    },
    {
      name: 'Send confirmation after payment',
      trigger_event: 'payment_successful',
      conditions: {},
      action_type: 'send_notification',
      config: {
        channel: 'in_app',
        user_id: 'payload.client_id',
        title: 'Booking confirmed',
        body: 'Your payment is successful and your artisan has been notified.'
      }
    },
    {
      name: 'Request review after completion',
      trigger_event: 'booking_completed',
      conditions: {},
      action_type: 'send_notification',
      config: {
        channel: 'in_app',
        user_id: 'payload.client_id',
        title: 'How was the service?',
        body: 'Please rate your artisan and help build trust for future bookings.'
      }
    },
    {
      name: 'Send onboarding tips to new artisans',
      trigger_event: 'artisan_onboarded',
      conditions: {},
      action_type: 'send_notification',
      config: {
        channel: 'in_app',
        user_id: 'payload.user_id',
        title: 'You’re almost live',
        body: 'Complete your profile and add services to start receiving bookings quickly.'
      }
    },
    {
      name: 'Notify artisan after first job complete',
      trigger_event: 'first_booking_completed',
      conditions: {},
      action_type: 'send_notification',
      config: {
        channel: 'in_app',
        user_id: 'payload.artisan_id',
        title: 'First job complete!',
        body: 'Great work — your first completed job has been recorded. Keep the momentum going.'
      }
    }
  ];

  const rulesWithTenant = rules.map((rule) => ({ ...rule, tenant_id }));
  const { data, error } = await supabase.from('automation_rules').insert(rulesWithTenant).select('*');
  if (error) throw new ApiError(error.message, 500);
  return json({ created: data });
}

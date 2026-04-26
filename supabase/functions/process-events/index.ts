import { serve, json, errorResponse, createSupabaseClient, handleError } from '../_shared.ts';
import { executeAction, matchConditions, normalizeActions } from '../automation_helpers.ts';

type SystemEvent = {
  id: string;
  tenant_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  status: string;
  retry_count: number;
  created_at: string;
};

type AutomationRule = {
  id: string;
  trigger_event: string;
  is_active: boolean;
  conditions: Record<string, unknown>;
  action_type?: string;
  config?: Record<string, unknown>;
  actions?: Array<{ action_type: string; config: Record<string, unknown> }>;
};

serve(async (req: Request) => {
  try {
    if (req.method !== 'GET') return errorResponse('Method not allowed', 405);
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), 100);
    const supabase = createSupabaseClient();
    return await processPendingEvents(supabase, limit);
  } catch (err) {
    return handleError(err);
  }
});

async function processPendingEvents(supabase: ReturnType<typeof createSupabaseClient>, limit: number) {
  const { data: events, error } = await supabase
    .from('system_events')
    .select('*')
    .eq('status', 'pending')
    .lt('retry_count', 3)
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) throw new Error(error.message);
  if (!events || events.length === 0) return json({ processed: 0, failed: 0 });

  let processed = 0;
  let failed = 0;

  for (const event of events as SystemEvent[]) {
    const result = await processEvent(supabase, event);
    if (result === 'failed') failed += 1;
    processed += 1;
  }

  return json({ processed, failed });
}

async function processEvent(supabase: ReturnType<typeof createSupabaseClient>, event: SystemEvent) {
  const { data: lock, error: lockError } = await supabase
    .from('system_events')
    .update({ status: 'processing' })
    .eq('id', event.id)
    .eq('status', 'pending')
    .select('id');

  if (lockError) throw new Error(lockError.message);
  if (!lock || lock.length === 0) {
    return 'skipped';
  }

  const { data: rules, error: rulesError } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('trigger_event', event.event_type)
    .eq('is_active', true);

  if (rulesError) {
    await updateEventStatus(supabase, event, 'failed', rulesError.message);
    return 'failed';
  }

  if (!rules || rules.length === 0) {
    await updateEventStatus(supabase, event, 'processed');
    return 'processed';
  }

  let anyFailures = false;

  for (const rule of rules as AutomationRule[]) {
    if (!matchConditions(rule.conditions, event)) continue;

    const ruleRunResult = await processRule(supabase, event, rule);
    if (ruleRunResult === 'failed') {
      anyFailures = true;
    }
  }

  await updateEventStatus(supabase, event, anyFailures ? 'failed' : 'processed');
  return anyFailures ? 'failed' : 'processed';
}

async function processRule(supabase: ReturnType<typeof createSupabaseClient>, event: SystemEvent, rule: AutomationRule) {
  const actions = normalizeActions(rule);
  if (actions.length === 0) return 'skipped';

  const { data: existingRun } = await supabase
    .from('automation_runs')
    .select('*')
    .eq('event_id', event.id)
    .eq('rule_id', rule.id)
    .eq('status', 'completed')
    .maybeSingle();

  if (existingRun) return 'skipped';

  const { data: runData, error: runError } = await supabase
    .from('automation_runs')
    .upsert(
      {
        event_id: event.id,
        rule_id: rule.id,
        tenant_id: event.tenant_id,
        status: 'pending',
        attempts: 1,
        last_error: null
      },
      { onConflict: ['event_id', 'rule_id'] }
    )
    .select('*')
    .single();

  if (runError || !runData) {
    return 'failed';
  }

  const successfulActionIndices = new Set<number>();
  const { data: logs, error: logsError } = await supabase
    .from('automation_logs')
    .select('action_index')
    .eq('event_id', event.id)
    .eq('rule_id', rule.id)
    .eq('status', 'completed');

  if (logs && !logsError) {
    for (const log of logs as Array<{ action_index: number }>) {
      successfulActionIndices.add(log.action_index);
    }
  }

  let ruleFailed = false;

  for (let index = 0; index < actions.length; index += 1) {
    if (successfulActionIndices.has(index)) continue;
    const action = actions[index];
    const actionKey = action.config?.action_key ? String(action.config.action_key) : `${action.action_type}_${index}`;

    try {
      await executeAction(supabase, event, action, runData.attempts);
      await logAction(supabase, event, rule, index, action.action_type, actionKey, 'completed', null, runData.attempts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logAction(supabase, event, rule, index, action.action_type, actionKey, 'failed', message, runData.attempts);
      ruleFailed = true;
      break;
    }
  }

  await supabase.from('automation_runs').update({
    status: ruleFailed ? 'failed' : 'completed',
    last_error: ruleFailed ? `Action failure on rule ${rule.id}` : null,
    updated_at: new Date().toISOString()
  }).eq('id', runData.id);

  return ruleFailed ? 'failed' : 'completed';
}

async function updateEventStatus(supabase: ReturnType<typeof createSupabaseClient>, event: SystemEvent, status: string, errorMessage?: string) {
  const retryCount = status === 'failed' ? Number(event.retry_count ?? 0) + 1 : Number(event.retry_count ?? 0);
  const nextStatus = status === 'failed' && retryCount < 3 ? 'pending' : status;
  const delaySeconds = Math.min(300, 2 ** retryCount * 30);
  await supabase.from('system_events').update({
    status: nextStatus,
    retry_count: retryCount,
    error_message: errorMessage ?? null,
    processed_at: status === 'processed' || nextStatus === 'failed' ? new Date().toISOString() : null,
    created_at: nextStatus === 'pending' ? new Date(Date.now() + delaySeconds * 1000).toISOString() : event.created_at
  }).eq('id', event.id);
  if (errorMessage) {
    await supabase.from('automation_runs').update({ last_error: errorMessage }).eq('event_id', event.id).eq('status', 'failed');
  }
}

async function logAction(
  supabase: ReturnType<typeof createSupabaseClient>,
  event: SystemEvent,
  rule: AutomationRule,
  actionIndex: number,
  actionType: string,
  actionKey: string,
  status: string,
  errorMessage: string | null,
  attempt: number
) {
  const { error } = await supabase.from('automation_logs').upsert({
    tenant_id: event.tenant_id,
    rule_id: rule.id,
    event_id: event.id,
    action_index: actionIndex,
    action_type: actionType,
    action_key: actionKey,
    status,
    error_message: errorMessage,
    attempt: attempt,
    updated_at: new Date().toISOString()
  }, { onConflict: 'event_id,rule_id,action_key' });

  if (error) throw new Error(error.message);
}

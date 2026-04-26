import { ApiError } from './_shared.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';

export type AutomationAction = {
  action_type: string;
  config: Record<string, unknown>;
};

export async function emitSystemEvent(
  supabase: SupabaseClient,
  tenant_id: string,
  eventType: string,
  payload: Record<string, unknown>,
  source = 'automation',
  createdBy = 'system',
  entityType?: string,
  entityId?: string
) {
  const dedup_key = `${eventType}:${entityType ?? 'system'}:${entityId ?? crypto.randomUUID()}`;
  const row = {
    tenant_id,
    event_type: eventType,
    payload,
    source,
    created_by: createdBy,
    entity_type: entityType ?? null,
    entity_id: entityId ?? null,
    status: 'pending',
    dedup_key
  };

  const { error } = await supabase.from('system_events').insert(row);
  if (error && error.code !== '23505') throw new ApiError(error.message, 500);
}

export const emitEvent = emitSystemEvent;

export async function executeAction(
  supabase: SupabaseClient,
  event: any,
  action: AutomationAction,
  runAttempt: number
) {
  const config = resolveConfigObject(action.config, event);
  const actionType = action.action_type;

  switch (actionType) {
    case 'send_notification':
      return sendNotificationAction(supabase, event, config as Record<string, unknown>);
    case 'send_email':
      return sendEmailAction(supabase, event, config as Record<string, unknown>);
    case 'send_whatsapp':
      return sendWhatsAppAction(supabase, event, config as Record<string, unknown>);
    case 'update_record':
      return updateRecordAction(supabase, event, config as Record<string, unknown>);
    case 'trigger_referral_reward':
    case 'trigger_reward':
      return triggerReferralRewardAction(supabase, event, config as Record<string, unknown>);
    case 'assign_featured_boost':
      return assignFeaturedBoostAction(supabase, event, config as Record<string, unknown>);
    default:
      throw new ApiError(`Unsupported automation action: ${actionType}`, 400);
  }
}

export function normalizeActions(rule: any): AutomationAction[] {
  const actions: AutomationAction[] = [];
  if (rule.action_type) {
    actions.push({ action_type: rule.action_type, config: rule.config ?? {} });
  }
  if (Array.isArray(rule.actions)) {
    actions.push(...rule.actions.map((entry: any) => ({ action_type: entry.action_type, config: entry.config ?? {} })));
  }
  return actions;
}

export function matchConditions(conditions: any, event: any) {
  if (!conditions || typeof conditions !== 'object' || Array.isArray(conditions)) {
    return true;
  }

  return Object.entries(conditions).every(([key, expected]) => {
    const actual = getDeepValue(event, key);
    return actual === expected;
  });
}

function resolveConfigObject(value: any, event: any): any {
  if (Array.isArray(value)) {
    return value.map((item) => resolveConfigObject(item, event));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [key, resolveConfigObject(val, event)])
    );
  }
  if (typeof value === 'string') {
    return resolveConfigValue(value, event);
  }
  return value;
}

function resolveConfigValue(value: string, event: any) {
  if (value.startsWith('payload.')) {
    return getDeepValue(event, value.replace(/^payload\./, 'payload.'));
  }
  if (value.startsWith('event.')) {
    return getDeepValue(event, value.replace(/^event\./, ''));
  }
  if (value.startsWith('{{') && value.endsWith('}}')) {
    return resolveTemplate(value, event);
  }
  return resolveTemplate(value, event);
}

function resolveTemplate(template: string, event: any) {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, path) => {
    const result = getDeepValue(event, path.trim());
    return result == null ? '' : String(result);
  });
}

function getDeepValue(obj: any, path: string) {
  if (!path) return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

async function sendNotificationAction(supabase: SupabaseClient, event: any, config: any) {
  const user_id = config.user_id || getDeepValue(event, 'payload.client_id') || getDeepValue(event, 'payload.artisan_id');
  if (!user_id) throw new ApiError('send_notification must include user_id or infer one from event payload', 400);
  const channel = (config.channel as string) ?? 'in_app';
  const title = (config.title as string) ?? `Kajola notification: ${event.event_type}`;
  const body = (config.body as string) ?? `An automation event was triggered for ${event.event_type}.`;
  const payload = config.payload ?? { event: event.event_type };

  const { error } = await supabase.from('notifications').insert({
    tenant_id: event.tenant_id,
    user_id,
    channel,
    title,
    body,
    payload
  });

  if (error) throw new ApiError(error.message, 500);
  return { success: true, channel };
}

async function sendEmailAction(supabase: SupabaseClient, event: any, config: any) {
  const email = config.email || getDeepValue(event, 'payload.email');
  const subject = config.subject as string || `Kajola update: ${event.event_type}`;
  const body = config.body as string || `Your Kajola activity triggered ${event.event_type}.`;

  if (!email) throw new ApiError('send_email must provide an email address', 400);

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (apiKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Kajola <no-reply@kajola.com>',
        to: [email],
        subject,
        html: body
      })
    });
    if (!response.ok) {
      const message = await response.text();
      throw new ApiError(`Email dispatch failed: ${message}`, 500);
    }
  }

  await supabase.from('notifications').insert({
    tenant_id: event.tenant_id,
    user_id: getDeepValue(event, 'payload.client_id') ?? getDeepValue(event, 'payload.artisan_id') ?? null,
    channel: 'email',
    title: subject,
    body,
    payload: { email, event: event.event_type }
  });

  return { success: true, channel: 'email' };
}

async function sendWhatsAppAction(supabase: SupabaseClient, event: any, config: any) {
  const phone = config.phone || getDeepValue(event, 'payload.phone');
  const message = config.message as string || `Your Kajola event ${event.event_type} has triggered.`;
  if (!phone) throw new ApiError('send_whatsapp must provide a phone number', 400);

  await supabase.from('notifications').insert({
    tenant_id: event.tenant_id,
    user_id: getDeepValue(event, 'payload.client_id') ?? getDeepValue(event, 'payload.artisan_id') ?? null,
    channel: 'whatsapp',
    title: `WhatsApp: ${event.event_type}`,
    body: message,
    payload: { phone, event: event.event_type }
  });

  return { success: true, channel: 'whatsapp' };
}

async function updateRecordAction(supabase: SupabaseClient, event: any, config: any) {
  const table = config.table as string;
  const recordId = config.record_id as string || getDeepValue(event, 'entity_id');
  const data = config.data as Record<string, unknown>;

  if (!table || !recordId || !data) throw new ApiError('update_record requires table, record_id, and data', 400);

  const { error } = await supabase.from(table).update(data).eq('id', recordId);
  if (error) throw new ApiError(error.message, 500);
  return { success: true, table, record_id: recordId };
}

async function triggerReferralRewardAction(supabase: SupabaseClient, event: any, config: any) {
  const referralId = config.referral_id as string || getDeepValue(event, 'payload.referral_id');
  const rewardAmount = Number(config.reward_amount ?? 5000);

  if (!referralId) throw new ApiError('trigger_referral_reward requires referral_id', 400);

  const { error } = await supabase.from('artisan_referrals').update({ status: 'completed', reward_earned: rewardAmount }).eq('id', referralId);
  if (error) throw new ApiError(error.message, 500);

  return { success: true, referral_id: referralId, reward_amount: rewardAmount };
}

async function assignFeaturedBoostAction(supabase: SupabaseClient, event: any, config: any) {
  const artisanId = config.artisan_id as string || getDeepValue(event, 'payload.artisan_id');
  const boostValue = config.boost_value ?? 1;
  const expiresAt = config.expires_at as string ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  if (!artisanId) throw new ApiError('assign_featured_boost requires artisan_id', 400);

  const { data: artisan, error: artisanError } = await supabase.from('artisans').select('metadata').eq('id', artisanId).single();
  if (artisanError || !artisan) throw new ApiError(artisanError?.message ?? 'Artisan not found', 500);

  const existingMetadata = artisan.metadata ?? {};
  const metadataUpdate = {
    ...existingMetadata,
    featured_boost: boostValue,
    boost_expires_at: expiresAt
  };

  const { error } = await supabase.from('artisans').update({ metadata: metadataUpdate }).eq('id', artisanId);
  if (error) throw new ApiError(error.message, 500);

  return { success: true, artisan_id: artisanId, featured_boost: boostValue, expires_at: expiresAt };
}

export type AutomationEvent = {
  id: string;
  type: AutomationEventType;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type AutomationEventType =
  | 'booking.created'
  | 'booking.confirmed'
  | 'booking.completed'
  | 'booking.cancelled'
  | 'payment.succeeded'
  | 'payment.failed'
  | 'artisan.approved'
  | 'artisan.suspended'
  | 'review.submitted'
  | 'otp.requested';

export type AutomationConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'not_contains';

export type AutomationCondition = {
  field: string;
  operator: AutomationConditionOperator;
  value: string | number | boolean;
};

export type AutomationActionType =
  | 'send_sms'
  | 'send_push'
  | 'send_email'
  | 'webhook'
  | 'update_record'
  | 'create_notification';

export type AutomationAction = {
  type: AutomationActionType;
  config: Record<string, unknown>;
};

export type AutomationRule = {
  id: string;
  tenant_id: string;
  name: string;
  triggerEvent: AutomationEventType;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AutomationRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export type AutomationRun = {
  id: string;
  tenant_id: string;
  rule_id: string;
  event_id: string;
  status: AutomationRunStatus;
  result: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

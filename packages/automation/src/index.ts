// ── SORF-aligned automation event types ───────────────────────────────────────
// These match the event catalogue in SKILL.md Section 7 and api-patterns.md.
// Every booking platform must handle the SORF baseline events;
// domain-specific events are additive below the baseline.

/** SORF baseline booking lifecycle events */
export type SorfBookingEventType =
  | 'booking.held'        // slot hold created (15-min optimistic hold)
  | 'booking.confirmed'   // deposit paid or free booking confirmed
  | 'booking.checked_in'  // customer arrived; staff marked checked-in
  | 'booking.started'     // service in progress (in_progress state)
  | 'booking.completed'   // service done; payout eligible
  | 'booking.cancelled'   // booking cancelled before start
  | 'booking.no_show'     // customer did not arrive within 30 min
  | 'booking.disputed';   // dispute raised; payout frozen

/** SORF payment lifecycle events */
export type SorfPaymentEventType =
  | 'payment.confirmed'   // payment provider webhook: success
  | 'payment.failed'      // payment provider webhook: failure
  | 'payment.refund_initiated'; // refund started (cancellation or no-show reversal)

/** SORF engagement events */
export type SorfEngagementEventType =
  | 'waitlist.notified'    // DB trigger: next waitlist entry notified of open slot
  | 'waitlist.accepted'    // customer accepted the waitlist offer
  | 'loyalty.credited'     // loyalty points earned on booking completion
  | 'loyalty.tier_upgraded'; // customer reached a new loyalty tier

/** SORF scheduling events (triggered by pg_cron) */
export type SorfScheduledEventType =
  | 'reminder.24h'         // 24h before appointment starts_at
  | 'reminder.2h'          // 2h before appointment starts_at
  | 'hold.expired';        // optimistic hold released by pg_cron

/** SORF AI Operations events */
export type SorfAiEventType =
  | 'ai.noshow_risk'       // daily: high no-show probability flag for tomorrow
  | 'ai.rebook_nudge';     // median re-booking interval elapsed since last completion

/** All SORF event types — union of all baseline categories */
export type SorfEventType =
  | SorfBookingEventType
  | SorfPaymentEventType
  | SorfEngagementEventType
  | SorfScheduledEventType
  | SorfAiEventType;

/** Domain-specific events (add platform-specific events here) */
export type DomainEventType =
  // Equipment rental
  | 'equipment.returned'
  | 'equipment.condition_flagged'
  // Logistics / delivery
  | 'parcel.picked_up'
  | 'parcel.in_transit'
  | 'parcel.delivered'
  | 'parcel.failed_delivery'
  // Ride-hailing / dispatch
  | 'driver.dispatched'
  | 'driver.arrived'
  | 'trip.started'
  | 'trip.completed';

/** Union of all event types (SORF baseline + domain-specific) */
export type AutomationEventType = SorfEventType | DomainEventType | string;

// ── Automation rule engine ─────────────────────────────────────────────────────

export type AutomationConditionOperator =
  | 'eq' | 'neq'
  | 'gt' | 'gte'
  | 'lt' | 'lte'
  | 'contains' | 'not_contains'
  | 'is_null' | 'is_not_null';

export type AutomationCondition = {
  field: string;
  operator: AutomationConditionOperator;
  value: string | number | boolean | null;
};

export type AutomationActionType =
  | 'send_sms'
  | 'send_push'
  | 'send_whatsapp'
  | 'send_email'
  | 'webhook'
  | 'update_record'
  | 'create_notification'
  | 'credit_loyalty_points'
  | 'initiate_payout'
  | 'enqueue_job';

export type AutomationAction = {
  type: AutomationActionType;
  config: Record<string, unknown>;
};

export type AutomationRule = {
  id: string;
  tenant_id: string;
  name: string;
  trigger_event: AutomationEventType;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type AutomationRunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'dead';     // max attempts exceeded

export type AutomationRun = {
  id: string;
  tenant_id: string;
  rule_id: string | null;
  event_type: AutomationEventType;
  idempotency_key: string;
  status: AutomationRunStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
};

export type AutomationEvent = {
  id: string;
  type: AutomationEventType;
  tenant_id: string;
  payload: Record<string, unknown>;
  created_at: string;
};

// ── Idempotency key helpers ────────────────────────────────────────────────────

/** Generate canonical idempotency keys matching the SKILL.md Section 7 patterns */
export const idempotencyKey = {
  bookingEvent:   (bookingId: string, event: SorfBookingEventType) =>
    `booking-${bookingId}-${event.replace('booking.', '')}`,
  paymentEvent:   (txId: string, event: SorfPaymentEventType) =>
    `payment-${txId}-${event.replace('payment.', '')}`,
  reminder:       (bookingId: string, type: '24h' | '2h') =>
    `reminder-${bookingId}-${type}`,
  loyaltyCredit:  (bookingId: string) =>
    `loyalty-${bookingId}-earn`,
  waitlistNotify: (entryId: string) =>
    `waitlist-${entryId}-notify`,
  rebookNudge:    (customerId: string, serviceId: string) =>
    `rebook-${customerId}-${serviceId}`,
};

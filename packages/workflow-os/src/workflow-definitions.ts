import type { WorkflowDefinition } from '@kajola/contracts';

export const WF_BOOKING_CONFIRM: WorkflowDefinition = {
  id: 'wfd_booking_confirm_v1',
  name: 'wf_booking_confirm_appointment_v1',
  version: 1,
  description: 'Confirms a booking after payment verification',
  active: true,
  retryPolicy: { maxAttempts: 3, backoffMs: 2000, backoffFactor: 2, maxBackoffMs: 30_000 },
  steps: [
    { id: 'verify_payment',    name: 'Verify Payment',     type: 'command', command: 'ConfirmBooking', onFailure: 'stop' },
    { id: 'notify_customer',   name: 'Notify Customer',    type: 'notification', onFailure: 'skip' },
    { id: 'notify_provider',   name: 'Notify Provider',    type: 'notification', onFailure: 'skip' },
    { id: 'record_audit',      name: 'Record Audit',       type: 'command', command: 'SendNotification', onFailure: 'skip' },
  ],
};

export const WF_HOLD_EXPIRE: WorkflowDefinition = {
  id: 'wfd_hold_expire_v1',
  name: 'wf_booking_expire_slot_hold_v1',
  version: 1,
  description: 'Releases a slot hold when the timer expires',
  active: true,
  steps: [
    { id: 'wait_expiry',   name: 'Wait Until Expiry', type: 'timer', timerMs: (ctx) => Number(ctx.state.holdDurationMs ?? 15 * 60 * 1000), onFailure: 'stop' },
    { id: 'check_state',   name: 'Check Booking State', type: 'condition', condition: (ctx) => ctx.state.bookingStatus === 'held', onFailure: 'skip' },
    { id: 'cancel_booking', name: 'Cancel Booking',    type: 'command', command: 'CancelBooking', onFailure: 'skip' },
    { id: 'notify',        name: 'Notify Customer',    type: 'notification', onFailure: 'skip' },
  ],
};

export const WF_SERVICE_FULFILLMENT: WorkflowDefinition = {
  id: 'wfd_service_fulfillment_v1',
  name: 'wf_service_complete_engagement_v1',
  version: 1,
  description: 'Orchestrates the complete service delivery lifecycle',
  active: true,
  steps: [
    { id: 'check_in',       name: 'Check In Customer',    type: 'command', command: 'CheckInCustomer',  onFailure: 'stop' },
    { id: 'start_service',  name: 'Start Service',        type: 'command', command: 'StartService',     onFailure: 'stop' },
    { id: 'complete',       name: 'Complete Service',     type: 'command', command: 'CompleteService',  onFailure: 'stop' },
    { id: 'request_tip',    name: 'Request Gratuity',     type: 'notification', onFailure: 'skip' },
    { id: 'request_review', name: 'Request Feedback',     type: 'notification', onFailure: 'skip' },
    { id: 'schedule_followup', name: 'Schedule Follow-up', type: 'timer', timerMs: 24 * 60 * 60 * 1000, onFailure: 'skip' },
  ],
};

export const WF_PAYMENT_RECOVERY: WorkflowDefinition = {
  id: 'wfd_payment_recovery_v1',
  name: 'wf_payment_recover_failed_deposit_v1',
  version: 1,
  description: 'Handles failed payment with retry and slot release',
  active: true,
  retryPolicy: { maxAttempts: 2, backoffMs: 5000, backoffFactor: 2, maxBackoffMs: 60_000 },
  steps: [
    { id: 'notify_failure',  name: 'Notify Payment Failed', type: 'notification', onFailure: 'skip' },
    { id: 'wait_retry',      name: 'Wait for Retry Window', type: 'timer', timerMs: 30 * 60 * 1000, onFailure: 'skip' },
    { id: 'check_payment',   name: 'Check Payment Status',  type: 'condition', condition: (ctx) => ctx.state.paymentRetried === true, onFailure: 'skip' },
    { id: 'release_slot',    name: 'Release Slot',          type: 'command', command: 'CancelBooking', onFailure: 'skip' },
  ],
};

export const WF_CUSTOMER_RETENTION: WorkflowDefinition = {
  id: 'wfd_customer_retention_v1',
  name: 'wf_customer_collect_feedback_v1',
  version: 1,
  description: 'Post-service retention: feedback, recommendation, rebooking',
  active: true,
  steps: [
    { id: 'wait_cooldown',    name: 'Wait Cooldown Period',   type: 'timer', timerMs: 2 * 60 * 60 * 1000, onFailure: 'skip' },
    { id: 'request_feedback', name: 'Request Feedback',       type: 'notification', onFailure: 'skip' },
    { id: 'agent_recommend',  name: 'Agent Rebooking Recommendation', type: 'agent', agentId: 'agt_customer_retention_v1', onFailure: 'skip' },
    { id: 'send_rebook',      name: 'Send Rebooking Offer',   type: 'notification', onFailure: 'skip' },
  ],
};

export const WF_TRUST_INCIDENT: WorkflowDefinition = {
  id: 'wfd_trust_incident_v1',
  name: 'wf_trust_incident_review_v1',
  version: 1,
  description: 'Trust incident review with evidence collection and human approval',
  active: true,
  steps: [
    { id: 'collect_evidence', name: 'Collect Evidence',      type: 'agent', agentId: 'agt_trust_risk_v1', onFailure: 'stop' },
    { id: 'human_review',     name: 'Human Review',          type: 'approval', approvalPolicy: 'owner_required', onFailure: 'stop' },
    { id: 'apply_resolution', name: 'Apply Resolution',      type: 'command', command: 'ResolveApprovalRequest', onFailure: 'stop' },
    { id: 'notify_parties',   name: 'Notify All Parties',    type: 'notification', onFailure: 'skip' },
  ],
};

export const ALL_WORKFLOWS: WorkflowDefinition[] = [
  WF_BOOKING_CONFIRM,
  WF_HOLD_EXPIRE,
  WF_SERVICE_FULFILLMENT,
  WF_PAYMENT_RECOVERY,
  WF_CUSTOMER_RETENTION,
  WF_TRUST_INCIDENT,
];

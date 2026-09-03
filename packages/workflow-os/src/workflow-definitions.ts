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

// ── Operating Model Workflow Engines ──────────────────────────────────────

/**
 * Booking Workflow Engine
 * Full lifecycle: REQUESTED → PENDING_PROVIDER → CONFIRMED → IN_PROGRESS
 *               → COMPLETED → PAID → REVIEWED
 */
export const WF_BOOKING_LIFECYCLE: WorkflowDefinition = {
  id: 'wfd_booking_lifecycle_v1',
  name: 'wf_booking_full_lifecycle_v1',
  version: 1,
  description: 'Full booking lifecycle from request to review',
  active: true,
  retryPolicy: { maxAttempts: 3, backoffMs: 2000, backoffFactor: 2, maxBackoffMs: 60_000 },
  steps: [
    { id: 'accept',           name: 'Accept or Auto-Confirm',     type: 'command', command: 'AcceptBooking', onFailure: 'stop' },
    { id: 'notify_confirm',   name: 'Notify Confirmation',        type: 'notification', onFailure: 'skip' },
    { id: 'reminder_24h',     name: '24h Reminder',               type: 'timer', timerMs: (ctx) => {
        const startsAt = new Date(ctx.state.startsAt as string).getTime();
        return Math.max(0, startsAt - 24 * 60 * 60 * 1000 - Date.now());
      }, onFailure: 'skip' },
    { id: 'remind_parties',   name: 'Day-Before Reminder',        type: 'notification', onFailure: 'skip' },
    { id: 'settle_payment',   name: 'Settle Payment',             type: 'command', command: 'MarkBookingPaid', onFailure: 'stop', compensate: 'IssueRefund' },
    { id: 'request_review',   name: 'Request Review',             type: 'command', command: 'RequestReview', onFailure: 'skip' },
    { id: 'update_trust',     name: 'Update Trust Score',         type: 'command', command: 'UpdateTrustScore', onFailure: 'skip' },
  ],
};

/**
 * Provider Lifecycle Engine
 * REGISTERED → PROFILE_INCOMPLETE → KYC_PENDING → VERIFIED → ACTIVE → HIGH_PERFORMER
 */
export const WF_PROVIDER_ONBOARDING: WorkflowDefinition = {
  id: 'wfd_provider_onboarding_v1',
  name: 'wf_provider_onboard_to_active_v1',
  version: 1,
  description: 'Onboards a new provider from registration through KYC verification to active status',
  active: true,
  steps: [
    { id: 'profile_check',    name: 'Check Profile Completeness', type: 'condition',
        condition: (ctx) => Boolean(ctx.state.profileComplete), onFailure: 'skip' },
    { id: 'profile_reminder', name: 'Profile Completion Reminder', type: 'notification', onFailure: 'skip' },
    { id: 'wait_profile',     name: 'Wait for Profile',           type: 'timer', timerMs: 3 * 24 * 60 * 60 * 1000, onFailure: 'skip' },
    { id: 'kyc_approval',     name: 'KYC Human Approval',         type: 'approval', onFailure: 'stop' },
    { id: 'verify',           name: 'Verify Provider',            type: 'command', command: 'VerifyProvider', onFailure: 'stop' },
    { id: 'activate',         name: 'Activate Provider',          type: 'command', command: 'ActivateProvider', onFailure: 'stop' },
    { id: 'welcome',          name: 'Send Welcome Notification',  type: 'notification', onFailure: 'skip' },
  ],
};

/**
 * Customer Lifecycle Engine
 * VISITOR → REGISTERED → FIRST_BOOKING → REPEAT_CUSTOMER → LOYAL → AT_RISK → REACTIVATED
 */
export const WF_CUSTOMER_LIFECYCLE: WorkflowDefinition = {
  id: 'wfd_customer_lifecycle_v1',
  name: 'wf_customer_lifecycle_segment_v1',
  version: 1,
  description: 'Tags customer lifecycle segment and triggers CRM automations',
  active: true,
  steps: [
    { id: 'tag_segment',      name: 'Tag Customer Segment',        type: 'command', command: 'TagCustomerSegment', onFailure: 'skip' },
    { id: 'check_at_risk',    name: 'Check At-Risk (60d inactive)', type: 'condition',
        condition: (ctx) => {
          const last = ctx.state.lastBookingAt as string | undefined;
          if (!last) return false;
          return Date.now() - new Date(last).getTime() > 60 * 24 * 60 * 60 * 1000;
        }, onFailure: 'skip' },
    { id: 'reactivation',     name: 'Send Reactivation Offer',     type: 'command', command: 'SendRetentionOffer', onFailure: 'skip' },
    { id: 'update_trust',     name: 'Update Trust Score',          type: 'command', command: 'UpdateTrustScore', onFailure: 'skip' },
  ],
};

/**
 * Service Delivery Workflow (Field Services)
 * ASSIGNED → EN_ROUTE → ARRIVED → WORK_STARTED → WORK_COMPLETED → CUSTOMER_CONFIRMED
 */
export const WF_SERVICE_DELIVERY: WorkflowDefinition = {
  id: 'wfd_service_delivery_v1',
  name: 'wf_service_field_delivery_v1',
  version: 1,
  description: 'Field service delivery — tracks provider movement and evidence collection',
  active: true,
  steps: [
    { id: 'en_route',         name: 'Mark Provider En Route',       type: 'command', command: 'MarkProviderEnRoute', onFailure: 'skip' },
    { id: 'notify_eta',       name: 'Notify Customer ETA',          type: 'notification', onFailure: 'skip' },
    { id: 'arrived',          name: 'Mark Provider Arrived',        type: 'command', command: 'MarkProviderArrived', onFailure: 'skip' },
    { id: 'work_started',     name: 'Start Work',                   type: 'command', command: 'StartService', onFailure: 'stop' },
    { id: 'upload_evidence',  name: 'Upload Before/After Evidence', type: 'command', command: 'UploadServiceEvidence', onFailure: 'skip' },
    { id: 'mark_complete',    name: 'Mark Work Completed',          type: 'command', command: 'CompleteService', onFailure: 'compensate', compensate: 'CancelBooking' },
    { id: 'customer_confirm', name: 'Wait for Customer Confirmation', type: 'timer', timerMs: 30 * 60 * 1000, onFailure: 'skip' },
    { id: 'update_trust',     name: 'Update Trust Score',           type: 'command', command: 'UpdateTrustScore', onFailure: 'skip' },
  ],
};

/**
 * Payment Lifecycle Workflow
 * QUOTE → DEPOSIT_REQUIRED → DEPOSIT_PAID → BALANCE_DUE → SERVICE_COMPLETED
 *       → BALANCE_PAID → PAYOUT_PENDING → PAYOUT_COMPLETED
 */
export const WF_PAYMENT_LIFECYCLE: WorkflowDefinition = {
  id: 'wfd_payment_lifecycle_v1',
  name: 'wf_payment_deposit_to_payout_v1',
  version: 1,
  description: 'Full payment lifecycle: deposit collection through artisan payout',
  active: true,
  retryPolicy: { maxAttempts: 3, backoffMs: 5000, backoffFactor: 2, maxBackoffMs: 60_000 },
  steps: [
    { id: 'record_deposit',   name: 'Record Deposit Paid',          type: 'command', command: 'RecordDepositPaid', onFailure: 'compensate', compensate: 'RefundDeposit' },
    { id: 'notify_deposit',   name: 'Notify Deposit Received',      type: 'notification', onFailure: 'skip' },
    { id: 'await_service',    name: 'Check Service Completion',     type: 'condition',
        condition: (ctx) => ctx.state.serviceStatus === 'completed', onFailure: 'stop' },
    { id: 'record_balance',   name: 'Record Balance Paid',          type: 'command', command: 'RecordBalancePaid', onFailure: 'compensate', compensate: 'RefundDeposit' },
    { id: 'initiate_payout',  name: 'Initiate Artisan Payout',      type: 'command', command: 'InitiatePayout', onFailure: 'stop' },
    { id: 'payout_approval',  name: 'Payout Approval Gate',         type: 'approval', onFailure: 'stop' },
    { id: 'release_payout',   name: 'Release Payout',               type: 'command', command: 'ReleasePayout', onFailure: 'stop' },
    { id: 'notify_payout',    name: 'Notify Payout Complete',       type: 'notification', onFailure: 'skip' },
  ],
};

/**
 * Quote Workflow
 * REQUEST_QUOTE → provider submits → customer accepts → deposit → booking confirmed
 * Essential for trades: plumbers, electricians, mechanics, decorators, contractors
 */
export const WF_QUOTE_TO_BOOKING: WorkflowDefinition = {
  id: 'wfd_quote_to_booking_v1',
  name: 'wf_quote_convert_to_booking_v1',
  version: 1,
  description: 'Converts a service quote request into a confirmed booking with deposit',
  active: true,
  steps: [
    { id: 'notify_provider',  name: 'Notify Provider of Quote Request', type: 'notification', onFailure: 'stop' },
    { id: 'wait_quote',       name: 'Wait 24h for Quote',           type: 'timer', timerMs: 24 * 60 * 60 * 1000, onFailure: 'skip' },
    { id: 'check_quote',      name: 'Check Quote Submitted',        type: 'condition',
        condition: (ctx) => Boolean(ctx.state.quoteSubmitted), onFailure: 'skip' },
    { id: 'quote_followup',   name: 'Quote Follow-Up Reminder',     type: 'notification', onFailure: 'skip' },
    { id: 'wait_acceptance',  name: 'Wait 48h for Acceptance',      type: 'timer', timerMs: 48 * 60 * 60 * 1000, onFailure: 'skip' },
    { id: 'check_accepted',   name: 'Check Quote Accepted',         type: 'condition',
        condition: (ctx) => Boolean(ctx.state.quoteAccepted), onFailure: 'stop' },
    { id: 'create_payment',   name: 'Create Payment Intent',        type: 'command', command: 'CreatePaymentIntent', onFailure: 'stop', compensate: 'CancelBooking' },
    { id: 'confirm_booking',  name: 'Confirm Booking',              type: 'command', command: 'ConfirmBooking', onFailure: 'stop', compensate: 'CancelBooking' },
    { id: 'notify_confirm',   name: 'Notify Both Parties',          type: 'notification', onFailure: 'skip' },
  ],
};

/**
 * Review and Reputation Workflow
 * REVIEW_REQUESTED → REVIEW_SUBMITTED → trust/reputation updated → artisan ranking updated
 */
export const WF_REVIEW_REPUTATION: WorkflowDefinition = {
  id: 'wfd_review_reputation_v1',
  name: 'wf_review_collect_and_score_v1',
  version: 1,
  description: 'Collects customer review after service and updates provider trust score',
  active: true,
  steps: [
    { id: 'request_review',   name: 'Request Review (30min post-service)', type: 'command', command: 'RequestReview', onFailure: 'skip' },
    { id: 'wait_review',      name: 'Wait 30min for First Attempt',   type: 'timer', timerMs: 30 * 60 * 1000, onFailure: 'skip' },
    { id: 'check_submitted',  name: 'Check Review Submitted',         type: 'condition',
        condition: (ctx) => Boolean(ctx.state.reviewSubmitted), onFailure: 'skip' },
    { id: 'reminder',         name: 'Send One Reminder',              type: 'notification', onFailure: 'skip' },
    { id: 'wait_reminder',    name: 'Wait 24h After Reminder',        type: 'timer', timerMs: 24 * 60 * 60 * 1000, onFailure: 'skip' },
    { id: 'update_trust',     name: 'Update Trust Score',             type: 'command', command: 'UpdateTrustScore', onFailure: 'skip' },
  ],
};

/**
 * Dispute Workflow
 * DISPUTE_OPENED → evidence collection → provider response → customer response
 *               → Kajola review → resolution → refund/payment decision → audit trail
 */
export const WF_DISPUTE_RESOLUTION: WorkflowDefinition = {
  id: 'wfd_dispute_resolution_v1',
  name: 'wf_dispute_resolve_v1',
  version: 1,
  description: 'Structured dispute resolution with evidence collection and human review gate',
  active: true,
  steps: [
    { id: 'notify_open',       name: 'Notify Dispute Opened',        type: 'notification', onFailure: 'skip' },
    { id: 'collect_evidence',  name: 'Collect Customer Evidence',    type: 'command', command: 'SubmitDisputeEvidence', onFailure: 'stop' },
    { id: 'notify_provider',   name: 'Notify Provider to Respond',  type: 'notification', onFailure: 'skip' },
    { id: 'wait_provider',     name: 'Wait 48h for Provider Response', type: 'timer', timerMs: 48 * 60 * 60 * 1000, onFailure: 'skip' },
    { id: 'human_review',      name: 'Kajola Human Review',          type: 'approval', onFailure: 'stop' },
    { id: 'apply_resolution',  name: 'Apply Resolution',             type: 'command', command: 'ApplyDisputeResolution', onFailure: 'stop' },
    { id: 'issue_refund',      name: 'Issue Refund if Warranted',    type: 'command', command: 'IssueRefund', onFailure: 'skip' },
    { id: 'notify_resolved',   name: 'Notify All Parties Resolved',  type: 'notification', onFailure: 'skip' },
    { id: 'update_trust',      name: 'Update Trust Scores',          type: 'command', command: 'UpdateTrustScore', onFailure: 'skip' },
  ],
};

// ── Registry ───────────────────────────────────────────────────────────────

export const ALL_WORKFLOWS: WorkflowDefinition[] = [
  // P0: Original KXOS workflows
  WF_BOOKING_CONFIRM,
  WF_HOLD_EXPIRE,
  WF_SERVICE_FULFILLMENT,
  WF_PAYMENT_RECOVERY,
  WF_CUSTOMER_RETENTION,
  WF_TRUST_INCIDENT,
  // Operating model engines
  WF_BOOKING_LIFECYCLE,
  WF_PROVIDER_ONBOARDING,
  WF_CUSTOMER_LIFECYCLE,
  WF_SERVICE_DELIVERY,
  WF_PAYMENT_LIFECYCLE,
  WF_QUOTE_TO_BOOKING,
  WF_REVIEW_REPUTATION,
  WF_DISPUTE_RESOLUTION,
];
